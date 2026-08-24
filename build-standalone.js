// Bundles Lantern into a single self-contained HTML file.
//
// The published page has no server to fetch from, so the scripture is embedded
// and `library.js` reads from that instead of the network.
//
// Modules are flattened into one classic script rather than kept as ES modules.
// An earlier version inlined each module as a `data:text/javascript` URL, which
// works locally but is blocked by the Content-Security-Policy an artifact is
// served under — the page then renders its static shell and never boots. A flat
// bundle has no module URLs for a CSP to reject.
//
// English and Spanish only — all three translations would push the file close
// to the size ceiling for no real gain.

const fs = require('fs');
const path = require('path');

const TRANSLATIONS = ['kjv', 'rvr'];
const OUT = 'dist/lantern.html';

// Leaf modules first: each is evaluated before anything that imports it.
const MODULE_ORDER = [
  'store.js', 'library.js', 'speech.js', 'share.js',
  'monetize.js', 'plans.js', 'notify.js', 'player.js', 'ui.js', 'app.js',
];

/* ── Scripture ────────────────────────────────────────────────── */

function collectData() {
  const data = { indexes: {}, books: {} };
  for (const t of TRANSLATIONS) {
    data.indexes[t] = JSON.parse(fs.readFileSync(`data/${t}-index.json`, 'utf8'));
    data.books[t] = {};
    for (const file of fs.readdirSync(`data/${t}`)) {
      data.books[t][path.basename(file, '.json')] =
        JSON.parse(fs.readFileSync(`data/${t}/${file}`, 'utf8'));
    }
  }
  return data;
}

/* ── Source rewrites ──────────────────────────────────────────── */

function patchLibrary(src) {
  const oldIndex = `export async function loadIndex(translation) {
  if (indexCache.has(translation)) return indexCache.get(translation);
  const res = await fetch(\`data/\${translation}-index.json\`);
  if (!res.ok) throw new Error(\`Could not load the \${translation} index\`);
  const index = await res.json();
  indexCache.set(translation, index);
  return index;
}`;
  const newIndex = `export async function loadIndex(translation) {
  const index = window.__LANTERN__.indexes[translation];
  if (!index) throw new Error(\`Could not load the \${translation} index\`);
  return index;
}`;

  const oldBook = `export async function loadBook(translation, slug) {
  const key = \`\${translation}/\${slug}\`;
  if (bookCache.has(key)) return bookCache.get(key);
  const res = await fetch(\`data/\${translation}/\${slug}.json\`);
  if (!res.ok) throw new Error(\`Could not load \${slug}\`);
  const book = await res.json();
  bookCache.set(key, book);
  // Keep memory bounded on long listening sessions that walk the whole Bible.
  if (bookCache.size > BOOK_CACHE_MAX) bookCache.delete(bookCache.keys().next().value);
  return book;
}`;
  const newBook = `export async function loadBook(translation, slug) {
  const book = window.__LANTERN__.books[translation]?.[slug];
  if (!book) throw new Error(\`Could not load \${slug}\`);
  return book;
}`;

  if (!src.includes(oldIndex)) throw new Error('library.js: loadIndex anchor not found');
  if (!src.includes(oldBook)) throw new Error('library.js: loadBook anchor not found');
  src = src.replace(oldIndex, newIndex).replace(oldBook, newBook);

  const bbe = /  bbe: \{[^}]*\},\n/;
  if (!bbe.test(src)) throw new Error('library.js: bbe entry not found');
  return src.replace(bbe, '');
}

function patchUi(src) {
  // Offline download is meaningless when everything is already in the page.
  const row = "      row('Offline listening', offlineDone ? 'This translation is saved on your device' : 'Save the whole Bible for flights and dead zones',\n        el('span', { class: 'val', text: offlineDone ? 'Saved' : 'Download' }), startDownload),";
  if (!src.includes(row)) throw new Error('ui.js: offline row anchor not found');
  return src.replace(row,
    "      row('Offline listening', 'Every verse is already inside this page', el('span', { class: 'val', text: 'Built in' })),");
}

/* ── Flattening ───────────────────────────────────────────────── */

/**
 * Rewrites one ES module into an IIFE that registers its exports on `__m`.
 *
 * Only the forms this project actually uses are handled — namespace and named
 * imports, and `export function` / `export async function` / `export const`.
 * Anything else throws rather than silently emitting broken output.
 */
function flatten(name, src) {
  const unsupported = src.match(/^export\s+(?!async function|function|const)\S+/m);
  if (unsupported) throw new Error(`${name}: unsupported export form "${unsupported[0]}"`);

  src = src
    .replace(/^import \* as (\w+) from '\.\/([\w.]+)';$/gm, "const $1 = __m['$2'];")
    .replace(/^import \{ ([^}]+) \} from '\.\/([\w.]+)';$/gm, "const { $1 } = __m['$2'];");

  const leftover = src.match(/^import .*$/m);
  if (leftover) throw new Error(`${name}: unhandled import "${leftover[0]}"`);

  const names = [
    ...src.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm),
    ...src.matchAll(/^export\s+const\s+(\w+)/gm),
  ].map(m => m[1]);

  if (!names.length && name !== 'app.js') throw new Error(`${name}: no exports found`);

  src = src.replace(/^export\s+/gm, '');

  return `__m['${name}'] = (function () {\n${src}\nreturn { ${names.join(', ')} };\n})();`;
}

function buildBundle() {
  const parts = MODULE_ORDER.map(name => {
    let src = fs.readFileSync(path.join('js', name), 'utf8');
    if (name === 'library.js') src = patchLibrary(src);
    if (name === 'ui.js') src = patchUi(src);
    // No service worker on a single published page.
    if (name === 'app.js') src = src.replace(/if \('serviceWorker' in navigator\)[\s\S]*$/, '');
    return flatten(name, src);
  });

  return `(function () {\n"use strict";\nconst __m = {};\n\n${parts.join('\n\n')}\n})();`;
}

/* ── Assembly ─────────────────────────────────────────────────── */

function build() {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('styles.css', 'utf8');

  const body = html.match(/<body>([\s\S]*?)<script type="module"/);
  if (!body) throw new Error('index.html: could not find body content');

  const data = collectData();
  const bundle = buildBundle();

  // `</script>` inside a script block would end it early; `<` is escaped so no
  // sequence in the scripture or the code can break out.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  const page = `<title>Lantern</title>
<style>
${css}

/* The artifact host supplies its own body, which has no definite height, so
   percentage heights collapse. Anchor the shell to the viewport instead. */
html, body { height: auto; min-height: 100vh; }
#app { min-height: 100vh; }
</style>

${body[1].trim()}

<script>window.__LANTERN__ = ${json};</script>
<script>
${bundle}
</script>
`;

  fs.mkdirSync('dist', { recursive: true });
  fs.writeFileSync(OUT, page);

  const mb = (Buffer.byteLength(page, 'utf8') / 1048576).toFixed(2);
  const verses = TRANSLATIONS.reduce((n, t) =>
    n + Object.values(data.books[t]).reduce((m, b) =>
      m + b.chapters.reduce((k, ch) => k + ch.length, 0), 0), 0);

  console.log(OUT);
  console.log(`  ${mb} MB`);
  console.log(`  ${TRANSLATIONS.join(', ')} — ${verses.toLocaleString()} verses embedded`);
  console.log(`  ${MODULE_ORDER.length} modules flattened, no data: URLs`);
  if (mb > 15) console.log('  WARNING: close to the 16 MB ceiling');
}

build();
