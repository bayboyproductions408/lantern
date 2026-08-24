// Daily verse reminder.
//
// One gentle notification at a time the listener picks. Deliberately not a
// streak-guilt mechanism: it never says anything is being lost, never counts
// days missed, and never fires more than once a day.
//
// LIMITATION: a web page can only schedule a notification while it is open.
// Genuinely reliable background delivery needs either Web Push with a server
// sending it, or — far simpler — native local notifications once the app is
// wrapped with Capacitor (@capacitor/local-notifications), which schedules on
// the device and needs no server at all. Until then this fires when the app is
// open at the right time, plus a catch-up on the next launch after a missed day.

import * as store from './store.js';
import * as lib from './library.js';

// Well-known passages of encouragement, cycled by day. References only — the
// text is read from the bundled translation, so this follows the listener's
// language automatically.
const DAILY = [
  ['john', 3, 16], ['psalms', 23, 1], ['philippians', 4, 13], ['romans', 8, 28],
  ['proverbs', 3, 5], ['isaiah', 41, 10], ['joshua', 1, 9], ['jeremiah', 29, 11],
  ['matthew', 11, 28], ['psalms', 46, 1], ['2-corinthians', 12, 9], ['hebrews', 11, 1],
  ['1-corinthians', 13, 4], ['galatians', 5, 22], ['ephesians', 2, 8], ['psalms', 119, 105],
  ['isaiah', 40, 31], ['romans', 12, 2], ['matthew', 6, 33], ['psalms', 27, 1],
  ['1-peter', 5, 7], ['james', 1, 5], ['john', 14, 27], ['psalms', 34, 18],
  ['lamentations', 3, 22], ['colossians', 3, 23], ['1-john', 4, 19], ['psalms', 121, 1],
  ['micah', 6, 8], ['2-timothy', 1, 7], ['psalms', 100, 4], ['revelation', 21, 4],
];

export function supported() {
  return typeof Notification !== 'undefined';
}

export function permission() {
  return supported() ? Notification.permission : 'unsupported';
}

/** Which passage belongs to a given date. Stable for everyone, every year. */
export function verseOfTheDay(date = new Date()) {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 86400000);
  const [book, chapter, verse] = DAILY[dayOfYear % DAILY.length];
  return { book, chapter, verse };
}

export async function loadVerseOfTheDay(translation, date = new Date()) {
  const { book, chapter, verse } = verseOfTheDay(date);
  const data = await lib.loadChapter(translation, book, chapter);
  return {
    book, chapter,
    verse: verse - 1,
    ref: `${data.name} ${chapter}:${verse}`,
    text: data.verses[verse - 1] ?? data.verses[0],
  };
}

export async function enable(hour = 7, minute = 0) {
  if (!supported()) throw new Error('This browser cannot show notifications.');

  const result = await Notification.requestPermission();
  if (result !== 'granted') {
    throw new Error('Notifications were not allowed. You can turn them on in your browser settings.');
  }

  store.set({ reminder: { enabled: true, hour, minute, lastShown: null } });
  schedule();
  return true;
}

export function disable() {
  clearTimeout(timer);
  timer = null;
  store.set({ reminder: { ...store.get().reminder, enabled: false } });
}

export function setTime(hour, minute) {
  store.set({ reminder: { ...store.get().reminder, hour, minute } });
  schedule();
}

/* ── Scheduling ───────────────────────────────────────────────── */

let timer = null;

function nextOccurrence(hour, minute) {
  const now = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

/** Arms the next reminder. Safe to call repeatedly. */
export function schedule() {
  clearTimeout(timer);
  timer = null;

  const r = store.get().reminder;
  if (!r?.enabled || permission() !== 'granted') return;

  const next = nextOccurrence(r.hour, r.minute);
  const delay = next.getTime() - Date.now();

  // setTimeout is unreliable beyond a few hours in a backgrounded tab, so
  // re-arm in steps rather than sleeping for a whole day at once.
  const step = Math.min(delay, 30 * 60 * 1000);
  timer = setTimeout(() => (step === delay ? fire() : schedule()), step);
}

async function fire() {
  const r = store.get().reminder;
  const today = store.today();
  if (!r?.enabled || r.lastShown === today) return schedule();

  try {
    const daily = await loadVerseOfTheDay(store.get().translation);
    new Notification(daily.ref, {
      body: daily.text.length > 160 ? `${daily.text.slice(0, 160)}…` : daily.text,
      icon: 'icons/icon.svg',
      badge: 'icons/icon.svg',
      tag: 'lantern-daily',
    }).onclick = () => window.focus();
    store.set({ reminder: { ...r, lastShown: today } });
  } catch {
    /* a failed reminder must never disturb playback */
  }
  schedule();
}

/**
 * Called on launch. If today's reminder time has already passed and nothing was
 * shown, show it now rather than silently skipping the day.
 */
export function catchUp() {
  const r = store.get().reminder;
  if (!r?.enabled || permission() !== 'granted') return;

  const due = new Date();
  due.setHours(r.hour, r.minute, 0, 0);
  if (Date.now() >= due.getTime() && r.lastShown !== store.today()) fire();
  else schedule();
}
