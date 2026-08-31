// Renders the 1024x500 feature graphic Play shows at the top of the listing.
//
//   node scripts/build-feature-graphic.js
//
// Composed in the app's own palette and typefaces so the store page and the
// product look like one thing. Deliberately holds a single line: the graphic
// is scaled down hard in Play's own UI, and anything smaller than the headline
// is unreadable by the time a listener sees it.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'store-assets/play/feature-graphic.png';
const PORT = 9336;
const W = 1024, H = 500;

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

const icon = fs.readFileSync('assets/icon.png').toString('base64');

const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Spectral:wght@600&family=IBM+Plex+Sans:wght@400&display=swap">
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;width:100vw;height:100vh;overflow:hidden}
  body{
    background:
      radial-gradient(120% 140% at 22% 45%, rgba(227,174,85,.16) 0%, rgba(227,174,85,0) 55%),
      linear-gradient(115deg,#1d1916 0%,#14110f 60%);
    display:flex;align-items:center;gap:44px;
    padding:0 68px;
    font-family:"IBM Plex Sans",system-ui,sans-serif;
  }
  .mark{width:150px;height:150px;border-radius:34px;flex:none;
        box-shadow:0 18px 44px rgba(0,0,0,.55)}
  h1{
    font-family:Spectral,Georgia,serif;font-weight:600;
    font-size:62px;line-height:1.04;letter-spacing:-.015em;
    color:#f2eade;margin:0;
  }
  p{margin:14px 0 0;font-size:23px;line-height:1.35;color:#a5978a}
</style>
<img class="mark" src="data:image/png;base64,${icon}">
<div>
  <h1>The Bible, read aloud</h1>
  <p>Recorded narrators. Free, offline, no account.</p>
</div>
`;

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const profile = path.join(process.env.TEMP || '.', 'lantern-feature-profile');
  fs.rmSync(profile, { recursive: true, force: true });

  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank',
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
  await cdp.send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
  await sleep(600);
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await sleep(1600);

  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(data, 'base64'));

  cdp.close();
  chrome.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ages out */ }

  const b = fs.readFileSync(OUT);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  if (w !== W || h !== H) { console.error(`wrong size: ${w}x${h}, wanted ${W}x${H}`); process.exit(1); }
  console.log(`feature graphic ${w}x${h}, ${(b.length / 1024).toFixed(0)} KB`);
})().catch(e => { console.error(e.message); process.exit(1); });
