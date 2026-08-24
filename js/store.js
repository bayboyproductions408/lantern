// Persisted app state. Everything lives in one localStorage key so a single
// read on boot is enough to restore exactly where the listener left off.

const KEY = 'lantern.state.v1';

const SCHEMA = 2;

const DEFAULTS = {
  schema: SCHEMA,
  version: 1,
  translation: 'kjv',
  position: { book: 'genesis', chapter: 1, verse: 0 },
  rate: 1,
  tone: 'soothing',      // prosody preset; see speech.js TONES
  voiceByLang: {},         // { en: voiceURI, es: voiceURI }
  theme: 'dark',
  autoAdvance: true,
  hasListened: false,
  bookmarks: [],
  read: {},                  // { bookSlug: [chapterNumbers] }
  plan: null,                // { id, startedAt, day, done: [dayNumbers] }
  streak: { count: 0, lastDay: null },
  stats: { seconds: 0, verses: 0 },
  giving: { tips: [] },          // voluntary gifts; unlocks nothing
  ads: { impressions: 0, rewarded: 0 },
  dedications: [],           // chapter dedications the listener has paid for
  reminder: { enabled: false, hour: 7, minute: 0, lastShown: null },
  offline: [],               // translations fully downloaded
};

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return clone(DEFAULTS);
    // Shallow-merge over defaults so a state saved by an older build still
    // boots after new keys are added.
    const saved = JSON.parse(raw);
    const merged = { ...clone(DEFAULTS), ...saved };

    // Schema 1 stored an automatically chosen voice, which latched whatever the
    // browser had published at that instant — usually a basic local voice,
    // since Chrome reveals its better network voices a moment later. Those
    // saved defaults are indistinguishable from a deliberate choice, so drop
    // them once and let the app pick again.
    if (saved.schema !== SCHEMA) {
      merged.voiceByLang = {};
      merged.schema = SCHEMA;
    }
    return merged;
  } catch {
    return clone(DEFAULTS);
  }
}

let state = load();
const listeners = new Set();

export function get() {
  return state;
}

export function set(patch) {
  state = { ...state, ...patch };
  save();
  listeners.forEach(fn => fn(state));
  return state;
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* quota or private mode — the session still works, it just will not resume */
    }
  }, 120);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ── Derived helpers ──────────────────────────────────────────── */

export function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** Called whenever audio actually plays. Keeps the daily streak honest. */
export function touchStreak() {
  const d = today();
  const s = state.streak;
  if (s.lastDay === d) return s;
  const next = s.lastDay && daysBetween(s.lastDay, d) === 1 ? s.count + 1 : 1;
  set({ streak: { count: next, lastDay: d } });
  return state.streak;
}

export function addStats(seconds, verses) {
  set({ stats: { seconds: state.stats.seconds + seconds, verses: state.stats.verses + verses } });
}

export function markChapterRead(book, chapter) {
  const read = { ...state.read };
  const list = read[book] ? [...read[book]] : [];
  if (!list.includes(chapter)) {
    list.push(chapter);
    read[book] = list;
    set({ read });
  }
}

export function isChapterRead(book, chapter) {
  return Boolean(state.read[book]?.includes(chapter));
}

export function chaptersReadCount() {
  return Object.values(state.read).reduce((n, list) => n + list.length, 0);
}

export function toggleBookmark(entry) {
  const match = b =>
    b.book === entry.book && b.chapter === entry.chapter && b.verse === entry.verse;
  const existing = state.bookmarks.find(match);
  if (existing) {
    set({ bookmarks: state.bookmarks.filter(b => !match(b)) });
    return false;
  }
  set({ bookmarks: [{ ...entry, at: Date.now() }, ...state.bookmarks] });
  return true;
}

export function hasBookmark(book, chapter, verse) {
  return state.bookmarks.some(b => b.book === book && b.chapter === chapter && b.verse === verse);
}

export function reset() {
  state = clone(DEFAULTS);
  save();
  listeners.forEach(fn => fn(state));
}
