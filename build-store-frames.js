// Composes the raw app captures into App Store marketing frames.
//
//   node build-screenshots.js      (produces the raw UI captures)
//   node build-store-frames.js     (wraps them with a headline)
//
// The store page needs a headline on each frame - a bare UI capture converts
// badly - but the UI underneath has to be the real, current interface. So the
// headline is composed around the capture rather than the capture being
// redrawn: whatever the app actually looks like is what ships.
//
// Same output contract as the raw captures: exactly 1320x2868, RGB, no alpha.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SRC = process.env.SHOT_SRC || 'store-assets/screenshots';
const OUT = process.env.FRAME_OUT || 'store-assets/frames';
const PORT = 9334;

// Overridable so the same pipeline can produce Play's phone frames. Apple
// wants 1320x2868 (2.17:1); Google caps phone screenshots at 2:1, so the
// Android set is rendered at 360x640 CSS - 1080x1920 - instead.
const WIDTH = Number(process.env.SHOT_W || 440);
const HEIGHT = Number(process.env.SHOT_H || 956);
const SCALE = Number(process.env.SHOT_SCALE || 3);

const FRAMES = [
  { src: '1-listening.png', head: 'The Bible, read aloud',      sub: 'Press play and listen from where you left off' },
  // Cropped just below the second narrator: the line under it names whichever
  // device voice would fill in offline, and the capture machine is Chrome, so
  // it reads "Google UK English Female" - a voice no iPhone has. Cropping is
  // honest; naming an Apple voice the capture never produced would not be.
  { src: '2-voices.png',    head: 'People, not robots',          sub: 'Real recorded narrators — pick who reads to you', cropBottom: 320 },
  { src: '3-library.png',   head: 'All 66 books',                sub: 'Every chapter, free, with nothing locked away' },
  { src: '4-plans.png',     head: 'Read the whole Bible',        sub: 'Paced plans, about 14 minutes of listening a day' },
  { src: '5-spanish.png',   head: 'También en español',          sub: 'Reina-Valera, leída por un narrador de verdad' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = url => new Promise((resolve, reject) => {
  http.get(url, res => {
    let d = '';
    res.on('data', c => (d += c));
    res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
  }).on('error', reject);
});

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

// The app's own palette, so the frames read as part of the product rather than
// a marketing wrapper bolted around it.
const shotWidth = Math.round(WIDTH * 0.80);

const page = (head, sub, dataUri, shotH) => `<!doctype html>
<meta charset="utf-8">
<!-- Without this, Chrome lays the page out at its 980px mobile fallback width
     and then scales the result down, which is why the frame kept rendering as
     a small picture floating in a large empty background. -->
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Spectral:wght@600&family=IBM+Plex+Sans:wght@400;500&display=swap">
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;width:100vw;height:100vh;overflow:hidden}
  body{
    background:linear-gradient(180deg,#1c1815 0%,#14110f 55%);
    display:flex;flex-direction:column;align-items:center;
    font-family:"IBM Plex Sans",system-ui,sans-serif;
  }
  h1{
    font-family:Spectral,Georgia,serif;font-weight:600;
    font-size:33px;line-height:1.1;letter-spacing:-.01em;
    color:#f0e7d9;margin:38px 30px 0;text-align:center;text-wrap:balance;
  }
  p{
    margin:11px 38px 0;font-size:14px;line-height:1.4;
    color:#9a8d7e;text-align:center;
  }
  /* Sized from the capture's own aspect rather than left to flex: a flexible
     box grew taller than the image and framed a slab of empty background
     under every screen. SHOT_W and SHOT_H are computed, so the frame is
     exactly the picture. */
  .shot{
    margin-top:22px;width:${shotWidth}px;height:${shotH}px;
    border-radius:24px;overflow:hidden;
    border:1px solid #3a312a;
    box-shadow:0 20px 50px rgba(0,0,0,.55);
  }
  .shot img{display:block;width:100%;height:auto}
</style>
<h1>${head}</h1>
<p>${sub}</p>
<div class="shot"><img src="${dataUri}"></div>
`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.join(process.env.TEMP || '.', 'lantern-frames-profile');
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
    } catch { /* not up yet */ }
  }
  if (!target) { chrome.kill(); throw new Error('Chrome never exposed a DevTools target'); }

  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: true,
  });

  const made = [];
  for (const f of FRAMES) {
    process.stdout.write(`  ${f.src} -> ${f.head} ... `);
    const raw = fs.readFileSync(path.join(SRC, f.src));
    // PNG header: width at byte 16, height at byte 20.
    const srcW = raw.readUInt32BE(16), srcH = raw.readUInt32BE(20);
    const scale = shotWidth / srcW;
    const shotH = Math.round((srcH - (f.cropBottom || 0)) * scale);
    const html = page(f.head, f.sub, 'data:image/png;base64,' + raw.toString('base64'), shotH);
    const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);

    await cdp.send('Page.navigate', { url });
    // A data: navigation drops the metrics override, so it is re-applied once
    // the page exists rather than only being set up front.
    await sleep(600);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: true,
    });
    await sleep(1600);   // let the webfonts land before capturing

    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const out = path.resolve(OUT, f.src);
    fs.writeFileSync(out, Buffer.from(data, 'base64'));
    made.push({ name: f.src, file: out });
    console.log('done');
  }

  cdp.close();
  chrome.kill();
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ages out */ }

  console.log('');
  let bad = 0;
  for (const m of made) {
    const b = fs.readFileSync(m.file);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20), colour = b[25];
    const alpha = colour === 4 || colour === 6;
    const ok = w === WIDTH * SCALE && h === HEIGHT * SCALE && !alpha;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'BAD '} ${m.name.padEnd(16)} ${w}x${h}  colour ${colour}${alpha ? ' ALPHA' : ''}  ${(b.length / 1024).toFixed(0)} KB`);
  }
  if (bad) { console.error(`\n${bad} frame(s) unusable`); process.exit(1); }
  console.log(`\n${made.length} frames in ${OUT}/`);
})().catch(err => { console.error(err.message); process.exit(1); });
