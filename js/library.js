// Access layer over the bundled scripture files.
//
// Every text source is public domain by deliberate choice, so the full text can
// be shipped inside the app with no licensing exposure:
//   kjv — King James Version (1611)
//   bbe — The Bible in Basic English (1965)
//   rvr — Reina-Valera 1909 (not the copyrighted 1960 edition)

export const TRANSLATIONS = {
  kjv: { id: 'kjv', abbr: 'KJV', name: 'King James Version', note: 'Classic, poetic English', lang: 'en' },
  bbe: { id: 'bbe', abbr: 'BBE', name: 'Bible in Basic English', note: 'Plain, simple vocabulary', lang: 'en' },
  rvr: { id: 'rvr', abbr: 'RVR', name: 'Reina-Valera 1909', note: 'La Biblia en español', lang: 'es' },
};

export function langOf(translationId) {
  return TRANSLATIONS[translationId]?.lang ?? 'en';
}

const indexCache = new Map();   // translation -> book index array
const bookCache = new Map();    // "translation/slug" -> book object
const BOOK_CACHE_MAX = 16;

export async function loadIndex(translation) {
  if (indexCache.has(translation)) return indexCache.get(translation);
  const res = await fetch(`data/${translation}-index.json`);
  if (!res.ok) throw new Error(`Could not load the ${translation} index`);
  const index = await res.json();
  indexCache.set(translation, index);
  return index;
}

export async function loadBook(translation, slug) {
  const key = `${translation}/${slug}`;
  if (bookCache.has(key)) return bookCache.get(key);
  const res = await fetch(`data/${translation}/${slug}.json`);
  if (!res.ok) throw new Error(`Could not load ${slug}`);
  const book = await res.json();
  bookCache.set(key, book);
  // Keep memory bounded on long listening sessions that walk the whole Bible.
  if (bookCache.size > BOOK_CACHE_MAX) bookCache.delete(bookCache.keys().next().value);
  return book;
}

export async function loadChapter(translation, slug, chapter) {
  const book = await loadBook(translation, slug);
  const verses = book.chapters[chapter - 1];
  if (!verses) throw new Error(`${book.name} has no chapter ${chapter}`);
  return { book, name: book.name, slug, chapter, verses };
}

export async function bookMeta(translation, slug) {
  const index = await loadIndex(translation);
  return index.find(b => b.slug === slug);
}

export function refString(bookName, chapter) {
  return `${bookName} ${chapter}`;
}

/* ── Canonical navigation ─────────────────────────────────────── */

/** Step forward or back one chapter, rolling over book boundaries. */
export async function stepChapter(translation, slug, chapter, delta) {
  const index = await loadIndex(translation);
  const i = index.findIndex(b => b.slug === slug);
  if (i < 0) return { slug, chapter };

  let bookIndex = i;
  let next = chapter + delta;

  while (next < 1) {
    bookIndex = (bookIndex - 1 + index.length) % index.length;
    next += index[bookIndex].chapters;
  }
  while (next > index[bookIndex].chapters) {
    next -= index[bookIndex].chapters;
    bookIndex = (bookIndex + 1) % index.length;
  }
  return { slug: index[bookIndex].slug, chapter: next };
}

/** Rough spoken length, used for plan pacing and time-remaining labels. */
const WORDS_PER_SECOND = 2.6;

export function secondsFor(words, rate = 1) {
  return Math.round(words / (WORDS_PER_SECOND * rate));
}

export function formatDuration(seconds) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} hr ${rem} min` : `${h} hr`;
}

/* ── Bulk operations (offline download + search) ──────────────── */

/**
 * Pulls every book of a translation through fetch so the service worker
 * caches it. Doubles as the offline download and as the search warm-up.
 */
export async function fetchAllBooks(translation, onProgress) {
  const index = await loadIndex(translation);
  const out = [];
  const CONCURRENCY = 6;
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < index.length) {
      const meta = index[cursor++];
      const book = await loadBook(translation, meta.slug);
      out.push(book);
      done++;
      onProgress?.(done, index.length);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // loadBook resolves out of order; restore canonical order for search results.
  const order = new Map(index.map((b, i) => [b.slug, i]));
  out.sort((a, b) => order.get(a.slug) - order.get(b.slug));
  return out;
}

export async function search(translation, query, onProgress, limit = 200) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  const books = await fetchAllBooks(translation, onProgress);
  const results = [];

  for (const book of books) {
    book.chapters.forEach((verses, ci) => {
      verses.forEach((text, vi) => {
        const lower = text.toLowerCase();
        if (terms.every(t => lower.includes(t))) {
          results.push({ slug: book.slug, name: book.name, chapter: ci + 1, verse: vi, text });
        }
      });
    });
    if (results.length >= limit) return results.slice(0, limit);
  }
  return results;
}
