// Converts the raw public-domain source JSON into per-book chapter files
// plus a lightweight index the app loads on boot.
//
// Every bundled text is public domain by deliberate choice:
//   kjv — King James Version (1611)
//   bbe — The Bible in Basic English (1965)
//   rvr — Reina-Valera 1909. Verified as the 1909 rather than the copyrighted
//         1960 edition by its archaic forms ("crió" in Genesis 1:1, and the
//         accented preposition "á" in 12,841 verses).

const fs = require('fs');
const path = require('path');

const EN_NAMES = ['Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth','1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra','Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon','Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos','Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah','Malachi','Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians','2 Corinthians','Galatians','Ephesians','Philippians','Colossians','1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon','Hebrews','James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation'];

const ES_NAMES = ['Génesis','Éxodo','Levítico','Números','Deuteronomio','Josué','Jueces','Rut','1 Samuel','2 Samuel','1 Reyes','2 Reyes','1 Crónicas','2 Crónicas','Esdras','Nehemías','Ester','Job','Salmos','Proverbios','Eclesiastés','Cantares','Isaías','Jeremías','Lamentaciones','Ezequiel','Daniel','Oseas','Joel','Amós','Abdías','Jonás','Miqueas','Nahúm','Habacuc','Sofonías','Hageo','Zacarías','Malaquías','Mateo','Marcos','Lucas','Juan','Hechos','Romanos','1 Corintios','2 Corintios','Gálatas','Efesios','Filipenses','Colosenses','1 Tesalonicenses','2 Tesalonicenses','1 Timoteo','2 Timoteo','Tito','Filemón','Hebreos','Santiago','1 Pedro','2 Pedro','1 Juan','2 Juan','3 Juan','Judas','Apocalipsis'];

// [genreKey, firstBookIndex] runs, in canonical order.
const GENRE_RUNS = [['law',0],['history',5],['wisdom',17],['majorProphets',22],['minorProphets',27],['gospels',39],['history',43],['paul',44],['general',57],['prophecy',65]];

const GENRE_LABELS = {
  en: { law:'Law', history:'History', wisdom:'Wisdom', majorProphets:'Major Prophets', minorProphets:'Minor Prophets', gospels:'Gospels', paul:"Paul's Letters", general:'General Letters', prophecy:'Prophecy' },
  es: { law:'Ley', history:'Historia', wisdom:'Sabiduría', majorProphets:'Profetas Mayores', minorProphets:'Profetas Menores', gospels:'Evangelios', paul:'Cartas de Pablo', general:'Cartas Generales', prophecy:'Profecía' },
};

const TRANSLATIONS = [
  { id: 'kjv', file: '_source/_raw_kjv.json', lang: 'en', names: EN_NAMES },
  { id: 'bbe', file: '_source/_raw_bbe.json', lang: 'en', names: EN_NAMES },
  { id: 'rvr', file: '_source/_raw_es.json', lang: 'es', names: ES_NAMES },
];

// Words that are legitimately set in full capitals and must not be lowercased.
const PROTECTED_CAPS = new Set(['LORD', 'GOD', 'JEHOVAH', 'JESUS', 'CHRIST']);

function genreKeyFor(i) {
  let key = 'law';
  for (const [name, start] of GENRE_RUNS) if (i >= start) key = name;
  return key;
}

// Slugs are always derived from the English names so that a book keeps the same
// identity in every translation. Saved positions, bookmarks and reading plans
// all key on the slug, so switching translation must not move the listener.
function slugFor(englishName) {
  return englishName.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Cleans one verse.
 *
 * The sources mark translator-supplied words as {was} and marginal glosses as
 * {lemma: Heb. ...}. Glosses must not be spoken aloud, so they are dropped;
 * supplied words are kept as ordinary text.
 */
function clean(verse) {
  return verse
    .replace(/\{[^}]*:[^}]*\}/g, '')
    .replace(/\{([^}]*)\}/g, '$1')
    // Both editions set the opening word of a chapter or paragraph in full
    // capitals. Left alone, speech engines read those letter by letter
    // ("EMPERO" as E-M-P-E-R-O), so restore normal casing.
    .replace(/^([A-ZÁÉÍÓÚÑÜ]{2,})\b/, m =>
      PROTECTED_CAPS.has(m) ? m : m[0] + m.slice(1).toLowerCase())
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function wordCount(s) {
  return s.split(/\s+/).filter(Boolean).length;
}

function build({ id, file, lang, names }) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const books = JSON.parse(raw);
  if (books.length !== 66) throw new Error(`${id}: expected 66 books, got ${books.length}`);

  const outDir = path.join('data', id);
  fs.mkdirSync(outDir, { recursive: true });

  const index = [];
  let totalWords = 0, totalVerses = 0;

  books.forEach((book, i) => {
    const name = names[i];
    const slug = slugFor(EN_NAMES[i]);
    const chapters = book.chapters.map(ch => ch.map(clean));
    const verseCounts = chapters.map(ch => ch.length);
    // Per-chapter word counts let reading plans balance days by listening time
    // rather than by chapter count, which varies wildly (Psalm 117 vs Psalm 119).
    const chapterWords = chapters.map(ch => ch.reduce((s, v) => s + wordCount(v), 0));
    const words = chapterWords.reduce((a, b) => a + b, 0);

    totalWords += words;
    totalVerses += verseCounts.reduce((a, b) => a + b, 0);

    fs.writeFileSync(path.join(outDir, `${slug}.json`), JSON.stringify({ slug, name, chapters }));

    index.push({
      slug, name, order: i + 1,
      abbrev: book.abbrev,
      testament: i < 39 ? 'OT' : 'NT',
      genre: GENRE_LABELS[lang][genreKeyFor(i)],
      chapters: chapters.length,
      verseCounts,
      chapterWords,
      words,
    });
  });

  fs.writeFileSync(path.join('data', `${id}-index.json`), JSON.stringify(index));
  console.log(`${id} (${lang}): 66 books, ${totalVerses} verses, ${totalWords} words`);
  return index;
}

const built = {};
for (const t of TRANSLATIONS) {
  if (!fs.existsSync(t.file)) {
    console.log(`${t.id}: source missing at ${t.file} — skipped`);
    continue;
  }
  built[t.id] = build(t);
}

/* ── Checks ───────────────────────────────────────────────────── */

const check = (id, slug, chapters, verses1) => {
  const b = built[id]?.find(x => x.slug === slug);
  if (!b) return;
  const ok = b.chapters === chapters && b.verseCounts[0] === verses1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}/${slug}: ${b.chapters} chapters, ch1 has ${b.verseCounts[0]} verses`);
};
check('kjv', 'genesis', 50, 31);
check('kjv', 'psalms', 150, 6);
check('kjv', 'revelation', 22, 20);
check('rvr', 'genesis', 50, 31);
check('rvr', 'revelation', 22, 20);

// Slugs must be identical across translations or switching would lose the
// listener's place.
const slugSets = Object.entries(built).map(([id, idx]) => [id, idx.map(b => b.slug).join('|')]);
const allMatch = slugSets.every(([, s]) => s === slugSets[0][1]);
console.log(`${allMatch ? 'ok  ' : 'FAIL'} slugs identical across all translations`);

// The all-caps opening must be gone.
for (const id of Object.keys(built)) {
  const gen = JSON.parse(fs.readFileSync(path.join('data', id, 'genesis.json'), 'utf8'));
  console.log(`     ${id} Genesis 1:1 -> ${gen.chapters[0][0].slice(0, 58)}`);
}
