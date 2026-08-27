// Renders pre-recorded narration for a translation, one file per chapter.
//
//   node build-narration.js kjv cori            all 66 books
//   node build-narration.js kjv cori john       a single book
//   node build-narration.js kjv cori --workers 12
//
// A translation can be read by several narrators, so every render is filed
// under the voice that produced it. Which model each voice uses - and whether
// it needs a speaker id out of a multi-speaker model - lives in
// narration-voices.json, so adding a narrator is a data change, not a code
// change.
//
// Why per-chapter files with a timing map, rather than one file per verse:
// the player tracks position and highlights by verse, so it needs to know
// where each verse begins. Rendering 31,000 loose verse files would give that
// for free but costs 31,000 requests; rendering whole chapters in one pass
// loses the verse boundaries entirely. So each verse is synthesised
// separately, measured, then concatenated into its chapter — one request per
// chapter, with exact verse offsets recorded alongside.
//
// Requires piper and ffmpeg on PATH (or set PIPER / FFMPEG).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PIPER = process.env.PIPER;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
// Where the .onnx models live. PIPER_MODEL still works for a one-off render of
// a model that is not in the registry.
const MODEL_DIR = process.env.PIPER_MODELS;

const argv = process.argv.slice(2).filter(a => a !== '--');
const flag = name => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const positional = argv.filter((a, i) =>
  !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

const TRANSLATION = positional[0] || 'kjv';
const VOICE = positional[1] || null;
const ONLY_BOOK = positional[2] || null;
const WORKERS = Math.max(1, parseInt(flag('--workers') || '1', 10));
const SHARD = flag('--shard');

const REGISTRY = JSON.parse(fs.readFileSync('narration-voices.json', 'utf8'));
const voices = REGISTRY[TRANSLATION];
if (!voices) { console.error(`no voices registered for ${TRANSLATION}`); process.exit(1); }
if (!VOICE || !voices[VOICE]) {
  console.error(`usage: node build-narration.js ${TRANSLATION} <voice> [book]`);
  console.error(`voices: ${Object.keys(voices).filter(v => !v.startsWith('_')).join(', ')}`);
  process.exit(1);
}
const SPEC = voices[VOICE];

const MODEL = process.env.PIPER_MODEL ||
  (MODEL_DIR ? path.join(MODEL_DIR, SPEC.model + '.onnx') : null);
const CONFIG = process.env.PIPER_CONFIG || (MODEL ? MODEL + '.json' : null);

// Matches js/speech.js — the audio must say what the app would have said.
const SMALL_CAPS = /\b(LORD|GOD|JEHOVAH|CHRIST|JESUS|KING OF KINGS)\b/g;
const TITLE_CASE = {
  LORD: 'Lord', GOD: 'God', JEHOVAH: 'Jehovah',
  CHRIST: 'Christ', JESUS: 'Jesus', 'KING OF KINGS': 'King of Kings',
};
function speakable(text, lang) {
  let out = text;
  if (lang === 'en') out = out.replace(SMALL_CAPS, m => TITLE_CASE[m] ?? m);
  return out.replace(/:\s/g, '; ').replace(/\s+/g, ' ').trim();
}

const LANG = TRANSLATION === 'rvr' ? 'es' : 'en';
const OUT_ROOT = path.join('narration', TRANSLATION, VOICE);
const TMP_ROOT = path.join(process.env.TEMP || '.', 'lantern-narration', TRANSLATION, VOICE);

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  return r;
}

function durationOf(file) {
  const r = sh(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration',
                         '-of', 'csv=p=0', file]);
  const d = parseFloat((r.stdout || '').trim());
  if (!isFinite(d)) throw new Error(`could not read duration of ${file}`);
  return d;
}

function renderBook(slug) {
  const book = JSON.parse(fs.readFileSync(path.join('data', TRANSLATION, `${slug}.json`), 'utf8'));
  const tmp = path.join(TMP_ROOT, slug);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  // One JSON line per verse. Explicit output_file keeps the verse -> audio
  // mapping deterministic; piper's default names are timestamps, and a
  // mis-mapped verse would be silently wrong rather than obviously broken.
  const lines = [];
  book.chapters.forEach((verses, ci) => {
    verses.forEach((text, vi) => {
      const out = path.join(tmp, `c${ci + 1}-v${vi + 1}.wav`).replace(/\\/g, '/');
      lines.push(JSON.stringify({
        text: speakable(text, LANG),
        output_file: out,
        ...(SPEC.speaker !== undefined ? { speaker_id: SPEC.speaker } : {}),
      }));
    });
  });

  const started = Date.now();
  // piper resolves its espeak-ng data relative to its own directory, so it has
  // to run from there. Output paths are absolute, so cwd does not affect them.
  const r = sh(PIPER, ['--model', MODEL, '--config', CONFIG, '--json-input'],
               { input: lines.join('\n'), cwd: path.dirname(PIPER) });
  if (r.status !== 0) throw new Error(`piper failed on ${slug}:\n${(r.stderr || '').slice(-500)}`);

  // Concatenate each chapter and record where every verse starts.
  const manifest = { translation: TRANSLATION, voice: VOICE, book: slug, name: book.name, chapters: [] };
  const bookOut = path.join(OUT_ROOT, slug);
  fs.mkdirSync(bookOut, { recursive: true });

  book.chapters.forEach((verses, ci) => {
    const wavs = verses.map((_, vi) => path.join(tmp, `c${ci + 1}-v${vi + 1}.wav`));
    const missing = wavs.filter(w => !fs.existsSync(w));
    if (missing.length) throw new Error(`${slug} ch${ci + 1}: ${missing.length} verse files missing`);

    let t = 0;
    const offsets = wavs.map(w => {
      const start = t;
      t += durationOf(w);
      return Math.round(start * 1000) / 1000;
    });

    const listFile = path.join(tmp, `c${ci + 1}.txt`);
    fs.writeFileSync(listFile, wavs.map(w => `file '${w.replace(/\\/g, '/')}'`).join('\n'));
    const dest = path.join(bookOut, `${ci + 1}.m4a`);
    const enc = sh(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile,
                            '-c:a', 'aac', '-b:a', '32k', '-ac', '1', '-ar', '22050', dest]);
    if (enc.status !== 0) throw new Error(`ffmpeg failed on ${slug} ch${ci + 1}:\n${(enc.stderr || '').slice(-400)}`);

    manifest.chapters.push({
      chapter: ci + 1,
      duration: Math.round(t * 1000) / 1000,
      bytes: fs.statSync(dest).size,
      verses: offsets,
    });
  });

  fs.writeFileSync(path.join(bookOut, 'index.json'), JSON.stringify(manifest));
  fs.rmSync(tmp, { recursive: true, force: true });

  const secs = manifest.chapters.reduce((a, c) => a + c.duration, 0);
  const bytes = manifest.chapters.reduce((a, c) => a + c.bytes, 0);
  return { slug, chapters: manifest.chapters.length, secs, bytes, wall: (Date.now() - started) / 1000 };
}

/* ── Run ──────────────────────────────────────────────────────── */

if (!PIPER || !MODEL) {
  console.error('Set PIPER (path to piper.exe) and PIPER_MODELS (directory of .onnx files).');
  process.exit(1);
}
if (!fs.existsSync(MODEL)) { console.error(`no such model: ${MODEL}`); process.exit(1); }

const index = JSON.parse(fs.readFileSync(path.join('data', `${TRANSLATION}-index.json`), 'utf8'));
const slugs = (index.books || index).map(b => b.slug || b);
const todo = ONLY_BOOK ? slugs.filter(s => s === ONLY_BOOK) : slugs;
if (!todo.length) { console.error(`no such book: ${ONLY_BOOK}`); process.exit(1); }

/** A book counts as done only if its manifest covers every chapter and each
 *  chapter's audio is actually on disk — a run killed mid-book must redo it. */
function alreadyRendered(slug) {
  const manifestPath = path.join(OUT_ROOT, slug, 'index.json');
  if (!fs.existsSync(manifestPath)) return false;
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const src = JSON.parse(fs.readFileSync(path.join('data', TRANSLATION, `${slug}.json`), 'utf8'));
    if (m.chapters.length !== src.chapters.length) return false;
    return m.chapters.every(c => fs.existsSync(path.join(OUT_ROOT, slug, `${c.chapter}.m4a`)));
  } catch {
    return false;
  }
}

fs.mkdirSync(OUT_ROOT, { recursive: true });

// Piper is single-threaded, so one process leaves fifteen cores idle and a
// whole-Bible render takes most of a day. Books are independent, so the work
// shards across processes - each child takes every Nth book, and the parent
// only reports. Sharding by book rather than by chapter keeps each book's
// manifest written by exactly one process.
if (WORKERS > 1 && !SHARD) {
  const { spawn } = require('child_process');
  const pending = todo.filter(s => !alreadyRendered(s));
  if (!pending.length) {
    console.log('every book already rendered');
    process.exit(0);
  }
  const n = Math.min(WORKERS, pending.length);
  console.log(`${pending.length} books to render for ${TRANSLATION}/${VOICE} across ${n} workers
`);

  let done = 0, failed = 0;
  const started = Date.now();
  const children = [];
  for (let i = 0; i < n; i++) {
    const args = [__filename, TRANSLATION, VOICE, '--shard', `${i}/${n}`];
    const c = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    c.stdout.on('data', d => {
      buf += d;
      const parts = buf.split(/\r?\n/);
      buf = parts.pop();
      for (const line of parts) if (line.trim()) console.log(`[${i}] ${line}`);
    });
    c.stderr.on('data', d => process.stderr.write(`[${i}] ${d}`));
    c.on('exit', code => {
      if (code !== 0) failed++;
      if (++done === n) {
        const mins = ((Date.now() - started) / 60000).toFixed(1);
        console.log(`
all workers finished in ${mins} min${failed ? `, ${failed} failed` : ''}`);
        process.exit(failed ? 1 : 0);
      }
    });
    children.push(c);
  }
  const stop = () => children.forEach(c => c.kill());
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return;
}

let shardIndex = 0, shardCount = 1;
if (SHARD) {
  const [i, n] = SHARD.split('/').map(Number);
  shardIndex = i; shardCount = n;
}

let totalSecs = 0, totalBytes = 0;
for (const [n, slug] of todo.entries()) {
  if (shardCount > 1 && n % shardCount !== shardIndex) continue;
  if (alreadyRendered(slug)) {
    console.log(`${slug.padEnd(18)} already rendered, skipping`);
    continue;
  }
  const r = renderBook(slug);
  totalSecs += r.secs; totalBytes += r.bytes;
  console.log(
    `${r.slug.padEnd(18)} ${String(r.chapters).padStart(3)} ch  ` +
    `${(r.secs / 60).toFixed(1).padStart(6)} min audio  ` +
    `${(r.bytes / 1048576).toFixed(1).padStart(6)} MB  ` +
    `rendered in ${r.wall.toFixed(0)}s`
  );
}
console.log(`\ntotal: ${(totalSecs / 3600).toFixed(2)} hours, ${(totalBytes / 1048576).toFixed(1)} MB`);
