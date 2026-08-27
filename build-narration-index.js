// Turns rendered narration into the small manifests that ship inside the app.
//
//   node build-narration-index.js
//
// The audio itself lives on GitHub Releases, which serves range requests but
// no CORS headers — a media element can stream from it, fetch() cannot read
// from it. So the verse offsets travel separately: a catalogue of what has
// been recorded, plus one file of offsets per book.
//
// Where those offsets live depends on the narrator. The default narrator's
// manifests are bundled in the app, so listening works with no network at all.
// Every other narrator's manifests are fetched on demand from GitHub Pages,
// which does send CORS headers — fifteen narrators would otherwise add ~6 MB
// of JSON to the download for choices most listeners never make.
//
// A narrator is advertised only once it covers every book of its translation.
// A half-rendered voice would swap narrator mid-book as the listener crossed
// into a chapter it had not reached, which is worse than not offering it yet.
//
// Safe to re-run while rendering is still in progress; it publishes whatever
// is finished and withholds the rest.

const fs = require('fs');
const path = require('path');

const SRC = 'narration';
const OUT = path.join('data', 'narration');
const REGISTRY = JSON.parse(fs.readFileSync('narration-voices.json', 'utf8'));

if (!fs.existsSync(SRC)) {
  console.error(`no ${SRC}/ directory — nothing rendered yet`);
  process.exit(1);
}

// Which release hosts each book, written by upload-narration.js. A book with
// no entry has not been uploaded, and must not be advertised: the app would
// offer a recording it cannot fetch.
const releasesPath = path.join(SRC, 'releases.json');
const hostedOn = fs.existsSync(releasesPath)
  ? JSON.parse(fs.readFileSync(releasesPath, 'utf8'))
  : {};

/** Matches upload-narration.js. The first two narrators predate voices and
 *  keep their original asset names, so the prefix is recorded per book rather
 *  than rebuilt by the app. */
function prefixFor(translation, voice, book) {
  const spec = REGISTRY[translation]?.[voice];
  return spec?.legacyNames ? `${translation}-${book}` : `${translation}-${voice}-${book}`;
}

/** Every book slug a translation is supposed to have. */
function expectedBooks(translation) {
  const index = JSON.parse(fs.readFileSync(path.join('data', `${translation}-index.json`), 'utf8'));
  return (index.books || index).map(b => b.slug || b);
}

const catalogue = {};
let published = 0, chapters = 0, seconds = 0, bytes = 0;
const notes = [];

for (const translation of fs.readdirSync(SRC)) {
  const trDir = path.join(SRC, translation);
  if (!fs.statSync(trDir).isDirectory()) continue;
  if (!REGISTRY[translation]) { notes.push(`${translation}: not in narration-voices.json`); continue; }

  const wanted = expectedBooks(translation);
  const voicesOut = [];
  let booksOut = null;

  for (const voice of fs.readdirSync(trDir)) {
    const voiceDir = path.join(trDir, voice);
    if (!fs.statSync(voiceDir).isDirectory()) continue;

    const spec = REGISTRY[translation][voice];
    if (!spec) { notes.push(`${translation}/${voice}: rendered but not registered — skipped`); continue; }

    // Gather the books that are rendered, complete on disk, and hosted.
    const ready = new Map();
    for (const book of wanted) {
      const bookDir = path.join(voiceDir, book);
      const manifestPath = path.join(bookDir, 'index.json');
      if (!fs.existsSync(manifestPath)) continue;

      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const complete = m.chapters.every(c => fs.existsSync(path.join(bookDir, `${c.chapter}.m4a`)));
      if (!complete) continue;

      const release = hostedOn[`${translation}/${voice}/${book}`];
      if (!release) continue;

      ready.set(book, { m, release });
    }

    if (ready.size < wanted.length) {
      notes.push(`${translation}/${voice}: ${ready.size}/${wanted.length} books ready — withheld`);
      continue;
    }

    // Complete: write this narrator's manifests.
    const outDir = path.join(OUT, translation, voice);
    fs.mkdirSync(outDir, { recursive: true });

    for (const [book, { m, release }] of ready) {
      const slim = {
        book: m.book,
        name: m.name,
        release,
        prefix: prefixFor(translation, voice, book),
        // Drop byte counts; the app only needs where each verse starts.
        chapters: m.chapters.map(c => ({
          chapter: c.chapter,
          duration: c.duration,
          verses: c.verses,
        })),
      };
      fs.writeFileSync(path.join(outDir, `${book}.json`), JSON.stringify(slim));
      chapters += m.chapters.length;
      seconds += m.chapters.reduce((a, c) => a + c.duration, 0);
      bytes += m.chapters.reduce((a, c) => a + (c.bytes || 0), 0);
    }

    booksOut ||= Object.fromEntries([...ready].map(([b, { m }]) => [b, m.chapters.length]));
    voicesOut.push({
      id: voice,
      name: spec.name,
      origin: spec.origin,
      licence: spec.licence,
      ...(spec.default ? { default: true } : {}),
    });
    published++;
  }

  if (!voicesOut.length) continue;

  // The default narrator first; the rest alphabetically, so the list the
  // listener sees is stable between builds rather than filesystem order.
  voicesOut.sort((a, b) =>
    (b.default ? 1 : 0) - (a.default ? 1 : 0) || a.name.localeCompare(b.name));

  catalogue[translation] = { voices: voicesOut, books: booksOut };
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'catalogue.json'), JSON.stringify(catalogue));

function sizeOf(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? sizeOf(p) : fs.statSync(p).size;
  }
  return total;
}

console.log(`published ${published} narrator${published === 1 ? '' : 's'}, ${chapters} chapters`);
for (const [tr, entry] of Object.entries(catalogue)) {
  const names = entry.voices.map(v => v.name + (v.default ? ' (default)' : '')).join(', ');
  console.log(`  ${tr}: ${Object.keys(entry.books).length} books — ${names}`);
}
for (const n of notes) console.log(`  · ${n}`);

const bundled = Object.entries(catalogue).reduce((a, [tr, e]) => {
  const d = e.voices.find(v => v.default);
  return a + (d ? sizeOf(path.join(OUT, tr, d.id)) : 0);
}, 0);
console.log(`audio    : ${(seconds / 3600).toFixed(2)} hours, ${(bytes / 1048576).toFixed(1)} MB (hosted)`);
console.log(`manifests: ${(sizeOf(OUT) / 1024).toFixed(0)} KB total, ${(bundled / 1024).toFixed(0)} KB bundled in the app`);
