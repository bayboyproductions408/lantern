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
const SRC = 'narration';

// A release holds at most 1000 assets — a hard GitHub limit, and the KJV alone
// needs 1189 chapters. So books are packed across numbered releases, and which
// release holds a given book is recorded in that book's manifest so the app can
// find it. Assignment is derived from what is actually on GitHub rather than
// from local bookkeeping, so a half-finished run self-corrects on the next one.
const TAG_PREFIX = 'narration-v';
const MAX_ASSETS = 1000;
// Leave headroom so a book is never split across two releases.
const SAFE_LIMIT = 960;

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

async function getOrCreateRelease(n) {
  const tag = `${TAG_PREFIX}${n}`;
  try {
    return await api('GET', `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${tag}`);
  } catch {
    console.log(`creating release ${tag}`);
    return api('POST', `https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
      headers: { 'Content-Type': 'application/json' },
      body: {
        tag_name: tag,
        name: `Lantern narration ${tag}`,
        body: 'Pre-recorded chapter narration streamed by the Lantern app. '
            + 'Voices: en_GB-cori (public domain), es_ES-davefx (CC0), rendered with Piper. '
            + 'Split across releases because GitHub caps a release at 1000 assets.',
        draft: false,
        prerelease: false,
      },
    });
  }
}

async function assetsOf(releaseId) {
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

/** Every narration release that already exists, lowest number first. */
async function loadReleases() {
  const all = await api('GET', `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`);
  const mine = all
    .filter(r => r.tag_name.startsWith(TAG_PREFIX))
    .map(r => ({ n: Number(r.tag_name.slice(TAG_PREFIX.length)) || 0, id: r.id, tag: r.tag_name }))
    .sort((a, b) => a.n - b.n);
  for (const r of mine) r.assets = await assetsOf(r.id);
  return mine;
}

/** Books, each with the chapter files it needs hosted. Grouped rather than
 *  flat so a book is never split across two releases — the app resolves one
 *  release per book. */
const REGISTRY = JSON.parse(fs.readFileSync('narration-voices.json', 'utf8'));

/** The asset basename a book's chapters are stored under.
 *
 *  The first two narrators were uploaded before Lantern had more than one
 *  voice, so their ~2,100 assets are named without a voice. Renaming them
 *  would mean re-uploading gigabytes to no benefit, so those two keep their
 *  original names and every later narrator carries its voice in the name.
 *  The manifest records whichever prefix applies, so the app never has to
 *  know this history. */
function prefixFor(translation, voice, book) {
  const spec = REGISTRY[translation] && REGISTRY[translation][voice];
  return spec && spec.legacyNames
    ? `${translation}-${book}`
    : `${translation}-${voice}-${book}`;
}

function collect() {
  const books = [];
  if (!fs.existsSync(SRC)) return books;
  for (const translation of fs.readdirSync(SRC)) {
    const trDir = path.join(SRC, translation);
    if (!fs.statSync(trDir).isDirectory()) continue;
    for (const voice of fs.readdirSync(trDir)) {
      const voiceDir = path.join(trDir, voice);
      if (!fs.statSync(voiceDir).isDirectory()) continue;
      for (const book of fs.readdirSync(voiceDir)) {
        const bookDir = path.join(voiceDir, book);
        if (!fs.statSync(bookDir).isDirectory()) continue;
        // Only publish books whose manifest says they are complete.
        const manifestPath = path.join(bookDir, 'index.json');
        if (!fs.existsSync(manifestPath)) continue;
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const prefix = prefixFor(translation, voice, book);
        const files = [];
        let complete = true;
        for (const c of m.chapters) {
          const file = path.join(bookDir, `${c.chapter}.m4a`);
          if (!fs.existsSync(file)) { complete = false; break; }
          files.push({ file, name: `${prefix}-${c.chapter}.m4a`, size: fs.statSync(file).size });
        }
        if (complete) books.push({ key: `${translation}/${voice}/${book}`, translation, voice, book, files });
      }
    }
  }
  return books;
}

/** Where a book already lives in full, if anywhere. A book counts as hosted
 *  only when every chapter is present at the right size — a truncated asset is
 *  worse than a missing one, because the app would try to play it. */
function homeOf(book, releases) {
  return releases.find(r => book.files.every(f => r.assets.get(f.name) === f.size)) || null;
}

(async () => {
  const releases = await loadReleases();
  for (const r of releases) console.log(`${r.tag}: ${r.assets.size} assets`);

  const books = collect();
  console.log(`\n${books.length} complete books on disk\n`);

  const assignment = {};
  let uploaded = 0, bytes = 0, skipped = 0;

  for (const book of books) {
    const home = homeOf(book, releases);
    if (home) { assignment[book.key] = home.tag; skipped++; continue; }

    // Somewhere with room for the whole book, or a new release.
    let target = releases.find(r => r.assets.size + book.files.length <= SAFE_LIMIT);
    if (!target) {
      const next = (releases.at(-1)?.n ?? 0) + 1;
      const created = await getOrCreateRelease(next);
      target = { n: next, id: created.id, tag: created.tag_name, assets: await assetsOf(created.id) };
      releases.push(target);
      releases.sort((a, b) => a.n - b.n);
    }

    for (const f of book.files) {
      if (target.assets.get(f.name) === f.size) continue;
      if (target.assets.has(f.name)) {
        const stale = (await api('GET',
          `https://api.github.com/repos/${OWNER}/${REPO}/releases/${target.id}/assets?per_page=100`))
          .find(a => a.name === f.name);
        if (stale) await api('DELETE',
          `https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${stale.id}`);
      }
      const data = fs.readFileSync(f.file);
      await api('POST',
        `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${target.id}/assets?name=${encodeURIComponent(f.name)}`,
        { headers: { 'Content-Type': 'audio/mp4', 'Content-Length': data.length }, raw: data });
      target.assets.set(f.name, data.length);
      uploaded++; bytes += data.length;
    }
    assignment[book.key] = target.tag;
    console.log(`  ${book.key.padEnd(22)} -> ${target.tag}  (${target.assets.size} assets)`);
  }

  // The app needs to know which release holds each book; this is folded into
  // the per-book manifests by build-narration-index.js.
  fs.writeFileSync(path.join(SRC, 'releases.json'), JSON.stringify(assignment, null, 2));

  console.log(`\nalready hosted: ${skipped} books`);
  console.log(`uploaded ${uploaded} files, ${(bytes / 1048576).toFixed(1)} MB`);
  for (const r of releases) console.log(`  ${r.tag}: ${r.assets.size}/${MAX_ASSETS} assets`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
