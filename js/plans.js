// Reading plans.
//
// Plans are generated from the book index rather than hand-written, so each day
// holds a similar amount of *listening time* instead of a similar number of
// chapters. That matters: Psalm 119 is nearly forty times longer than Psalm 117.

import { loadIndex, secondsFor } from './library.js';
import * as store from './store.js';

/* ── Generators ───────────────────────────────────────────────── */

function chaptersOf(index, predicate = () => true) {
  const out = [];
  for (const book of index) {
    if (!predicate(book)) continue;
    for (let c = 1; c <= book.chapters; c++) {
      out.push({ slug: book.slug, name: book.name, chapter: c, words: book.chapterWords[c - 1] });
    }
  }
  return out;
}

/** Splits a chapter list into `days` groups of roughly equal word count. */
function balance(chapters, days) {
  const total = chapters.reduce((n, c) => n + c.words, 0);
  const target = total / days;
  const out = [];
  let current = [];
  let cumulative = 0;

  for (const ch of chapters) {
    current.push(ch);
    cumulative += ch.words;
    if (cumulative >= target * (out.length + 1) && out.length < days - 1) {
      out.push(current);
      current = [];
    }
  }
  if (current.length) out.push(current);
  return out;
}

function bySlug(index, slugs) {
  const set = new Set(slugs);
  return chaptersOf(index, b => set.has(b.slug));
}

/** Turns explicit references into one-chapter days. */
function curated(index, refs) {
  const lookup = new Map(index.map(b => [b.slug, b]));
  return refs.map(([slug, chapter]) => {
    const book = lookup.get(slug);
    return [{ slug, name: book.name, chapter, words: book.chapterWords[chapter - 1] }];
  });
}

/* ── Catalogue ────────────────────────────────────────────────── */

export const PLANS = [
  {
    id: 'bible-year',
    title: 'The Whole Bible in a Year',
    subtitle: 'Genesis to Revelation, paced evenly',
    days: 365,
    build: index => balance(chaptersOf(index), 365),
  },
  {
    id: 'nt-90',
    title: 'The New Testament in 90 Days',
    subtitle: 'Matthew through Revelation',
    days: 90,
    build: index => balance(chaptersOf(index, b => b.testament === 'NT'), 90),
  },
  {
    id: 'psalms-proverbs',
    title: 'Psalms & Proverbs in a Month',
    subtitle: 'A psalm set and a proverb each day',
    days: 31,
    build: index => {
      const psalmDays = balance(bySlug(index, ['psalms']), 31);
      const proverbs = bySlug(index, ['proverbs']);
      return psalmDays.map((day, i) => (proverbs[i] ? [...day, proverbs[i]] : day));
    },
  },
  {
    id: 'gospels-30',
    title: 'The Gospels in 30 Days',
    subtitle: 'Matthew, Mark, Luke and John',
    days: 30,
    build: index => balance(bySlug(index, ['matthew', 'mark', 'luke', 'john']), 30),
  },
  {
    id: 'wisdom-40',
    title: 'Wisdom in 40 Days',
    subtitle: 'Job, Proverbs, Ecclesiastes, Song of Solomon',
    days: 40,
    build: index =>
      balance(bySlug(index, ['job', 'proverbs', 'ecclesiastes', 'song-of-solomon']), 40),
  },
  {
    id: 'peace-7',
    title: 'Peace in Anxious Days',
    subtitle: 'One passage a day for a hard week',
    days: 7,
    build: index =>
      curated(index, [
        ['philippians', 4], ['psalms', 23], ['matthew', 6], ['psalms', 46],
        ['john', 14], ['isaiah', 41], ['1-peter', 5],
      ]),
  },
  {
    id: 'grief-7',
    title: 'Comfort in Grief',
    subtitle: 'Seven readings for a season of loss',
    days: 7,
    build: index =>
      curated(index, [
        ['psalms', 34], ['lamentations', 3], ['john', 11], ['2-corinthians', 1],
        ['psalms', 42], ['romans', 8], ['revelation', 21],
      ]),
  },
  {
    id: 'gratitude-7',
    title: 'A Week of Thanksgiving',
    subtitle: 'Readings on gratitude and praise',
    days: 7,
    build: index =>
      curated(index, [
        ['psalms', 100], ['psalms', 103], ['colossians', 3], ['1-thessalonians', 5],
        ['psalms', 136], ['ephesians', 1], ['psalms', 145],
      ]),
  },
];

export function getPlan(id) {
  return PLANS.find(p => p.id === id) || null;
}

/* ── Building and caching ─────────────────────────────────────── */

const dayCache = new Map();

export async function planDays(id, translation) {
  const key = `${id}/${translation}`;
  if (dayCache.has(key)) return dayCache.get(key);

  const plan = getPlan(id);
  if (!plan) return [];
  const index = await loadIndex(translation);
  const days = plan.build(index);
  dayCache.set(key, days);
  return days;
}

export function dayLabel(day) {
  if (!day?.length) return '';
  // Collapse consecutive chapters of one book: "Genesis 1-3, Psalms 4".
  const parts = [];
  let run = null;

  for (const ch of day) {
    if (run && run.slug === ch.slug && ch.chapter === run.end + 1) {
      run.end = ch.chapter;
      continue;
    }
    if (run) parts.push(run);
    run = { slug: ch.slug, name: ch.name, start: ch.chapter, end: ch.chapter };
  }
  if (run) parts.push(run);

  return parts
    .map(p => (p.start === p.end ? `${p.name} ${p.start}` : `${p.name} ${p.start}–${p.end}`))
    .join(', ');
}

export function dayMinutes(day, rate = 1) {
  const words = day.reduce((n, c) => n + c.words, 0);
  return Math.max(1, Math.round(secondsFor(words, rate) / 60));
}

/* ── Progress ─────────────────────────────────────────────────── */

export function startPlan(id) {
  store.set({ plan: { id, startedAt: Date.now(), day: 1, done: [] } });
}

export function stopPlan() {
  store.set({ plan: null });
}

export function activePlan() {
  const p = store.get().plan;
  return p ? { ...p, meta: getPlan(p.id) } : null;
}

export function completeDay(dayNumber) {
  const p = store.get().plan;
  if (!p || p.done.includes(dayNumber)) return;
  const done = [...p.done, dayNumber];
  const meta = getPlan(p.id);
  const next = Math.min(dayNumber + 1, meta ? meta.days : dayNumber + 1);
  store.set({ plan: { ...p, done, day: next } });
}

export function setDay(dayNumber) {
  const p = store.get().plan;
  if (!p) return;
  store.set({ plan: { ...p, day: dayNumber } });
}
