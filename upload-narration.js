// Uploads rendered narration to a GitHub Release.
//
//   set LANTERN_GH_TOKEN=...        (fine-grained, Contents: read+write)
//   node upload-narration.js
//
// GitHub Releases is the host because it is free, CDN-backed, serves range
// requests so seeking works, and — unlike committing the audio — leaves the
// repository small. It sends no CORS headers, which is why only the audio
// lives here; the verse offsets ship inside the app.
//
// Resumable by design: assets already present are skipped, so an interrupted
// run costs nothing and re-running after rendering more books uploads only
// the new ones.

const fs = require('fs');
const path = require('path');
const https = require('https');

// setx writes to the user environment, but processes already running do not
// inherit it — so a token set after this session began is invisible to
// process.env. Fall back to reading the stored value directly. It is passed
// straight into the request and never printed.
function storedToken() {
  if (process.env.LANTERN_GH_TOKEN) return process.env.LANTERN_GH_TOKEN;
  if (process.platform !== 'win32') return null;
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      '[Environment]::GetEnvironmentVariable("LANTERN_GH_TOKEN","User")'],
      { encoding: 'utf8' });
    const v = (out || '').trim();
    return v || null;
  } catch {
    return null;
  }
}

const TOKEN = storedToken();
const OWNER = 'bayboyproductions408';
const REPO = 'lantern';
const TAG = 'narration-v1';
const SRC = 'narration';

if (!TOKEN) {
  console.error('LANTERN_GH_TOKEN is not set.');
  console.error('Create a fine-grained token limited to this repo with Contents: read and write,');
  console.error('then set it in your shell. It is read from the environment and never stored here.');
  process.exit(1);
}

function api(method, url, { body, headers = {}, raw } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request({
      method,
      host: u.host,
      path: u.pathname + u.search,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'User-Agent': 'lantern-narration-upload',
        Accept: 'application/vnd.github+json',
        ...headers,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) {
          return reject(new Error(`${method} ${u.pathname} -> ${res.statusCode} ${text.slice(0, 200)}`));
        }
        try { resolve(text ? JSON.parse(text) : {}); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    if (raw) req.end(raw); else if (body) req.end(JSON.stringify(body)); else req.end();
  });
}

async function getOrCreateRelease() {
  try {
    return await api('GET', `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
  } catch {
    console.log(`creating release ${TAG}`);
    return api('POST', `https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
      headers: { 'Content-Type': 'application/json' },
      body: {
        tag_name: TAG,
        name: 'Lantern narration v1',
        body: 'Pre-recorded chapter narration streamed by the Lantern app. '
            + 'Voices: en_GB-cori (public domain), es_ES-davefx (CC0), rendered with Piper.',
        draft: false,
        prerelease: false,
      },
    });
  }
}

async function existingAssets(releaseId) {
  const names = new Map();
  for (let page = 1; ; page++) {
    const batch = await api('GET',
      `https://api.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?per_page=100&page=${page}`);
    if (!batch.length) break;
    for (const a of batch) names.set(a.name, a.size);
    if (batch.length < 100) break;
  }
  return names;
}

function collect() {
  const files = [];
  if (!fs.existsSync(SRC)) return files;
  for (const translation of fs.readdirSync(SRC)) {
    const trDir = path.join(SRC, translation);
    if (!fs.statSync(trDir).isDirectory()) continue;
    for (const book of fs.readdirSync(trDir)) {
      const bookDir = path.join(trDir, book);
      if (!fs.statSync(bookDir).isDirectory()) continue;
      // Only publish books whose manifest says they are complete.
      const manifestPath = path.join(bookDir, 'index.json');
      if (!fs.existsSync(manifestPath)) continue;
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const c of m.chapters) {
        const file = path.join(bookDir, `${c.chapter}.m4a`);
        if (fs.existsSync(file)) {
          files.push({ file, name: `${translation}-${book}-${c.chapter}.m4a` });
        }
      }
    }
  }
  return files;
}

(async () => {
  const release = await getOrCreateRelease();
  console.log(`release ${TAG} id=${release.id}`);

  const have = await existingAssets(release.id);
  console.log(`already uploaded: ${have.size} assets`);

  const files = collect();
  const todo = files.filter(f => {
    const size = have.get(f.name);
    // Re-upload anything whose size does not match — a truncated asset is
    // worse than a missing one, because the app would try to play it.
    return size === undefined || size !== fs.statSync(f.file).size;
  });
  console.log(`to upload: ${todo.length} of ${files.length}\n`);

  let done = 0, bytes = 0;
  for (const f of todo) {
    if (have.has(f.name)) {
      const stale = (await api('GET',
        `https://api.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?per_page=100`))
        .find(a => a.name === f.name);
      if (stale) await api('DELETE',
        `https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${stale.id}`);
    }
    const data = fs.readFileSync(f.file);
    await api('POST',
      `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(f.name)}`,
      { headers: { 'Content-Type': 'audio/mp4', 'Content-Length': data.length }, raw: data });
    done++; bytes += data.length;
    if (done % 25 === 0 || done === todo.length) {
      console.log(`  ${done}/${todo.length}  ${(bytes / 1048576).toFixed(1)} MB`);
    }
  }
  console.log(`\nuploaded ${done} files, ${(bytes / 1048576).toFixed(1)} MB`);
  console.log(`base URL: https://github.com/${OWNER}/${REPO}/releases/download/${TAG}/`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
