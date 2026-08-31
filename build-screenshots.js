// Renders App Store screenshots from the running app.
//
//   node server.js &            (or any host serving the repo root)
//   node build-screenshots.js
//
// Apple wants 6.9" iPhone shots at exactly 1320x2868. That is 440x956 CSS
// pixels at a device pixel ratio of 3, so these are the real interface at the
// real resolution - not a mockup, and not an upscale of something smaller.
//
// Chrome is driven over the DevTools protocol rather than with --screenshot,
// because each frame needs the app put into a specific state first: seed
// localStorage, reload, tap through to a view, let it settle, then capture.
// Node's built-in WebSocket does the talking, so there is nothing to install
// and no screenshot-only code has to ship inside the app.
//
// Two things Apple rejects silently rather than reporting: a wrong pixel size,
// and any alpha channel. Both are asserted at the end, along with a check that
// the frame actually painted - a flat rectangle passes every other test.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE || 'http://localhost:4321';
const OUT = process.env.SHOT_OUT || 'store-assets/screenshots';
const PORT = 9333;

// Overridable so the same pipeline can produce Play's phone frames. Apple
// wants 1320x2868 (2.17:1); Google caps phone screenshots at 2:1, so the
// Android set is rendered at 360x640 CSS - 1080x1920 - instead.
const WIDTH = Number(process.env.SHOT_W || 440);
const HEIGHT = Number(process.env.SHOT_H || 956);
const SCALE = Number(process.env.SHOT_SCALE || 3);   // -> 1320 x 2868
const STATE_KEY = 'lantern.state.v1';

// A plausible history, so the counters read like an app in use rather than
// one opened for the first time. Nothing here overstates what the app does -
// it is the same screen any listener sees after a few weeks.
const today = new Date().toISOString().slice(0, 10);
const BASE_STATE = {
  schema: 3, version: 1, rate: 1, tone: 'soothing',
  voiceByLang: {}, narratorBy: {}, hasListened: true,
  theme: 'dark', autoAdvance: true,
  streak: { count: 12, lastDay: today },
  stats: { seconds: 27 * 3600 + 40 * 60, verses: 4120 },
  read: {
    genesis: [1, 2, 3, 4, 5, 6, 7, 8], psalms: [1, 8, 19, 22, 23, 24, 27, 34, 42, 51, 63, 91, 103, 121, 139],
    john: [1, 2, 3, 4, 5, 6, 7], matthew: [1, 2, 3, 4, 5, 6], romans: [1, 2, 3, 4, 5, 6, 7, 8],
    luke: [1, 2, 3], mark: [1, 2, 3, 4], proverbs: [1, 2, 3, 4, 5],
  },
};

const SHOTS = [
  { name: '1-listening', state: { position: { book: 'psalms', chapter: 23, verse: 2 }, translation: 'kjv' } },
  { name: '2-voices',    state: { position: { book: 'john', chapter: 1, verse: 0 }, translation: 'kjv' }, act: 'voice' },
  { name: '3-library',   state: { position: { book: 'genesis', chapter: 1, verse: 0 }, translation: 'kjv' }, view: 'library' },
  { name: '4-plans',     state: { position: { book: 'genesis', chapter: 1, verse: 0 }, translation: 'kjv' }, view: 'plans' },
  { name: '5-spanish',   state: { position: { book: 'john', chapter: 1, verse: 0 }, translation: 'rvr' } },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

const getJSON = url => new Promise((resolve, reject) => {
  http.get(url, res => {
    let d = '';
    res.on('data', c => (d += c));
    res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
  }).on('error', reject);
});

/** Minimal DevTools client: send a command, await its reply by id. */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let next = 1;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    msg.error ? slot.reject(new Error(msg.error.message)) : slot.resolve(msg.result);
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('devtools socket failed')), { once: true });
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ready, send, close: () => ws.close() };
}

const evaluate = (cdp, expression) =>
  cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
     .then(r => (r.result ? r.result.value : undefined));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.join(process.env.TEMP || '.', 'lantern-shots-profile');
  fs.rmSync(profile, { recursive: true, force: true });

  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try {
      const list = await getJSON(`http://127.0.0.1:${PORT}/json/list`);
      target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* not listening yet */ }
  }
  if (!target) { chrome.kill(); throw new Error('Chrome never exposed a DevTools target'); }

  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: true,
  });

  const results = [];
  for (const shot of SHOTS) {
    process.stdout.write(`  ${shot.name} ... `);

    // Seed state on the app's own origin, then reload so the app boots into it.
    await cdp.send('Page.navigate', { url: BASE + '/' });
    await sleep(1400);
    const state = JSON.stringify({ ...BASE_STATE, ...shot.state });
    await evaluate(cdp, `localStorage.setItem(${JSON.stringify(STATE_KEY)}, ${JSON.stringify(state)}); 1`);
    await cdp.send('Page.reload');
    await sleep(2400);

    if (shot.view) {
      await evaluate(cdp,
        `(document.querySelector('.tabbar button[data-nav="${shot.view}"]')||{click(){}}).click(), 1`);
      await sleep(1300);
    }
    if (shot.act === 'voice') {
      await evaluate(cdp,
        `([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Voice')||{click(){}}).click(), 1`);
      await sleep(1000);
    }

    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.resolve(OUT, shot.name + '.png'), Buffer.from(data, 'base64'));

    const ink = await evaluate(cdp, 'document.body.innerText.trim().length');
    results.push({ shot: shot.name, ink: ink || 0 });
    console.log(`done (${ink || 0} chars on screen)`);
  }

  cdp.close();
  chrome.kill();
  await sleep(400);
  // Chrome can still be releasing its profile; a leftover temp directory is
  // not worth failing a good set of screenshots over.
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* it will age out */ }

  console.log('');
  let bad = 0;
  for (const { shot, ink } of results) {
    const b = fs.readFileSync(path.resolve(OUT, shot + '.png'));
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20), colour = b[25];
    const alpha = colour === 4 || colour === 6;
    const trns = b.includes(Buffer.from('tRNS'));
    const sized = w === WIDTH * SCALE && h === HEIGHT * SCALE;
    const painted = ink > 200;
    const ok = sized && !alpha && !trns && painted;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'BAD '} ${shot.padEnd(13)} ${w}x${h}  colour ${colour}` +
      `${alpha ? ' ALPHA' : ''}${trns ? ' tRNS' : ''}${painted ? '' : ' BLANK'}  ` +
      `${(b.length / 1024).toFixed(0)} KB`);
  }
  if (bad) { console.error(`\n${bad} screenshot(s) unusable`); process.exit(1); }
  console.log(`\nAll frames ${WIDTH * SCALE}x${HEIGHT * SCALE}, RGB with no alpha.`);
})().catch(err => { console.error(err.message); process.exit(1); });
