// Turns rendered narration into the small manifests that ship inside the app.
//
//   node build-narration-index.js
//
// The audio itself lives on GitHub Releases, which serves range requests but
// no CORS headers — a media element can stream from it, fetch() cannot read
// from it. So the verse offsets travel with the app instead: a catalogue of
// what has been recorded, plus one file of offsets per book. They are small
// (~12 KB a book), they load instantly, and they work offline.
//
// Safe to re-run while rendering is still in progress; it simply publishes
// whatever is finished. Books still rendering are left out of the catalogue,
// so the app falls back to on-device speech for them.

const fs = require('fs');
const path = require('path');

const SRC = 'narration';
const OUT = path.join('data', 'narration');

if (!fs.existsSync(SRC)) {
  console.error(`no ${SRC}/ directory — nothing rendered yet`);
  process.exit(1);
}

// Which release hosts each book, written by upload-narration.js. A book with
// no entry has not been uploaded, and must not be advertised in the catalogue:
// the app would offer a recording it cannot fetch.
const releasesPath = path.join(SRC, 'releases.json');
const hostedOn = fs.existsSync(releasesPath)
  ? JSON.parse(fs.readFileSync(releasesPath, 'utf8'))
  : {};

const catalogue = {};
let books = 0, chapters = 0, seconds = 0, bytes = 0, unhosted = 0;

for (const translation of fs.readdirSync(SRC)) {
  const trDir = path.join(SRC, translation);
  if (!fs.statSync(trDir).isDirectory()) continue;

  const outDir = path.join(OUT, translation);
  fs.mkdirSync(outDir, { recursive: true });

  for (const book of fs.readdirSync(trDir)) {
    const manifestPath = path.join(trDir, book, 'index.json');
    if (!fs.existsSync(manifestPath)) continue;

    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Every chapter's audio must exist, or the app would offer a recording it
    // cannot play. A partially rendered book is simply not published.
    const complete = m.chapters.every(c =>
      fs.existsSync(path.join(trDir, book, `${c.chapter}.m4a`)));
    if (!complete) {
      console.log(`  skipping ${translation}/${book} — audio incomplete`);
      continue;
    }

    const release = hostedOn[`${translation}/${book}`];
    if (!release) {
      unhosted++;
      continue;
    }

    // Drop byte counts; the app only needs where each verse starts.
    const slim = {
      book: m.book,
      name: m.name,
      release,
      chapters: m.chapters.map(c => ({
        chapter: c.chapter,
        duration: c.duration,
        verses: c.verses,
      })),
    };
    fs.writeFileSync(path.join(outDir, `${book}.json`), JSON.stringify(slim));

    (catalogue[translation] ||= {})[book] = m.chapters.length;
    books++;
    chapters += m.chapters.length;
    seconds += m.chapters.reduce((a, c) => a + c.duration, 0);
    bytes += m.chapters.reduce((a, c) => a + (c.bytes || 0), 0);
  }
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'catalogue.json'), JSON.stringify(catalogue));

const manifestBytes = fs.readdirSync(OUT, { recursive: true })
  .map(f => path.join(OUT, f))
  .filter(f => fs.statSync(f).isFile())
  .reduce((a, f) => a + fs.statSync(f).size, 0);

console.log(`published ${books} books, ${chapters} chapters`);
if (unhosted) console.log(`  ${unhosted} rendered but not yet uploaded — withheld from the catalogue`);
for (const [tr, bs] of Object.entries(catalogue)) {
  console.log(`  ${tr}: ${Object.keys(bs).length} books`);
}
console.log(`audio   : ${(seconds / 3600).toFixed(2)} hours, ${(bytes / 1048576).toFixed(1)} MB (hosted)`);
console.log(`manifests: ${(manifestBytes / 1024).toFixed(0)} KB (bundled in the app)`);
