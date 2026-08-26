// Playback controller: owns the listening position and drives the speech engine
// verse by verse, rolling into the next chapter and book without stopping.

import * as speech from './speech.js';
import * as narration from './narration.js';
import * as store from './store.js';
import * as lib from './library.js';

const listeners = { change: new Set(), state: new Set(), error: new Set() };

export function on(event, fn) {
  listeners[event].add(fn);
  return () => listeners[event].delete(fn);
}

function emit(event, payload) {
  listeners[event].forEach(fn => fn(payload));
}

/* ── Current position ─────────────────────────────────────────── */

let chapterData = null;   // { name, slug, chapter, verses }
let playing = false;
let runId = 0;
let sleepTimer = null;
let sleepUntil = null;
let stopAtChapterEnd = false;
// Which engine actually read the last verse. Narration substituting itself
// invisibly is what made a broken build indistinguishable from a working one,
// so the reader is told which voice it is hearing.
let source = null;             // 'recording' | 'device' | null

export function current() {
  const { position, translation } = store.get();
  return {
    translation,
    book: position.book,
    chapter: position.chapter,
    verse: position.verse,
    name: chapterData?.name ?? '',
    verses: chapterData?.verses ?? [],
    ref: chapterData ? `${chapterData.name} ${chapterData.chapter}` : '',
    loaded: Boolean(chapterData),
    source,
  };
}

export function isPlaying() {
  return playing;
}

async function ensureChapter() {
  const { translation, position } = store.get();
  if (
    chapterData &&
    chapterData.slug === position.book &&
    chapterData.chapter === position.chapter &&
    chapterData.translation === translation
  ) {
    return chapterData;
  }
  const data = await lib.loadChapter(translation, position.book, position.chapter);
  chapterData = { ...data, translation };
  return chapterData;
}

/** Loads the stored position without starting playback. */
export async function init() {
  // Fire and forget: which chapters are narrated is only needed by the time
  // playback starts, and a failed lookup just means the speech fallback.
  narration.loadCatalogue();
  try {
    await ensureChapter();
  } catch {
    // A stale or corrupted position should never brick the app.
    store.set({ position: { book: 'genesis', chapter: 1, verse: 0 } });
    await ensureChapter();
  }
  emit('change', current());
  return current();
}

/* ── Navigation ───────────────────────────────────────────────── */

export async function goTo(book, chapter, verse = 0, { play: shouldPlay = null } = {}) {
  const wasPlaying = shouldPlay === null ? playing : shouldPlay;
  stop({ silent: true });

  store.set({ position: { book, chapter, verse } });
  try {
    await ensureChapter();
  } catch (err) {
    emit('error', err);
    return;
  }
  emit('change', current());
  if (wasPlaying) play();
}

export async function stepChapter(delta) {
  const { translation, position } = store.get();
  const next = await lib.stepChapter(translation, position.book, position.chapter, delta);
  await goTo(next.slug, next.chapter, 0);
}

export function stepVerse(delta) {
  const pos = store.get().position;
  const target = pos.verse + delta;

  if (target < 0) return stepChapterToEnd();
  if (chapterData && target >= chapterData.verses.length) return stepChapter(1);

  store.set({ position: { ...pos, verse: target } });
  emit('change', current());
  if (playing) restart();
}

/** Backwards past verse 1 lands on the last verse of the previous chapter. */
async function stepChapterToEnd() {
  const { translation, position } = store.get();
  const prev = await lib.stepChapter(translation, position.book, position.chapter, -1);
  const data = await lib.loadChapter(translation, prev.slug, prev.chapter);
  await goTo(prev.slug, prev.chapter, Math.max(0, data.verses.length - 1));
}

export function setTranslation(id) {
  const pos = store.get().position;
  store.set({ translation: id });
  chapterData = null;
  // The loaded recording belongs to the old translation.
  narration.reset();
  goTo(pos.book, pos.chapter, pos.verse);
}

/* ── Transport ────────────────────────────────────────────────── */

export function toggle() {
  return playing ? pause() : play();
}

export function play() {
  if (playing) return;
  if (!speech.supported) {
    emit('error', new Error('This browser cannot speak text aloud.'));
    return;
  }
  playing = true;
  store.set({ hasListened: true });
  store.touchStreak();
  document.body.classList.add('is-playing');
  emit('state', true);
  run();
}

export function pause() {
  if (!playing) return;
  playing = false;
  runId++;
  speech.cancel();
  narration.cancel();
  document.body.classList.remove('is-playing');
  emit('state', false);
}

function stop({ silent = false } = {}) {
  playing = false;
  runId++;
  speech.cancel();
  narration.cancel();
  document.body.classList.remove('is-playing');
  if (!silent) emit('state', false);
}

/** Cancels the in-flight utterance and picks the loop back up in place. */
function restart() {
  runId++;
  speech.cancel();
  narration.cancel();
  if (playing) run();
}

async function run() {
  const mine = ++runId;

  while (mine === runId && playing) {
    let data;
    try {
      data = await ensureChapter();
    } catch (err) {
      emit('error', err);
      return stop();
    }
    if (mine !== runId) return;

    const pos = store.get().position;
    const verseIndex = Math.min(pos.verse, data.verses.length - 1);
    const text = data.verses[verseIndex];

    emit('change', current());
    updateMediaSession();

    const { rate, voiceByLang, tone, translation } = store.get();
    const lang = lib.langOf(translation);

    // A recording is always preferred, but never required: books that have
    // not been narrated yet, and any device that is offline, fall through to
    // on-device speech and the app behaves exactly as it did before.
    const recorded = await narration.prepare(translation, data.slug, data.chapter);
    if (mine !== runId || !playing) return;

    let finished = false;
    let spoken = true;              // whether the synthesiser did the reading

    if (recorded) {
      const outcome = await narration.playVerse(verseIndex, { rate });
      if (mine !== runId || !playing) return;
      // A cancellation is the listener pausing or skipping — stop quietly. A
      // failure is the recording not playing, which must not end the session:
      // fall through and let the synthesiser read this verse instead.
      if (outcome === 'cancelled') return;
      if (outcome === 'done') { finished = true; spoken = false; }
    }

    source = finished ? 'recording' : 'device';
    emit('change', current());

    if (!finished) {
      // Only an explicit choice is stored; otherwise take the best voice the
      // device currently offers, which may have improved since the app opened.
      const voiceURI = voiceByLang[lang] ?? speech.bestVoice(lang)?.uri;
      finished = await speech.speak(text, { rate, voiceURI, toneId: tone, lang });
    }
    if (mine !== runId || !playing) return;
    if (!finished) return;

    // A beat between verses, so the reading does not run together. The
    // recording already carries its own pacing, so this applies only to the
    // synthesised fallback.
    if (spoken) {
      const settled = await speech.pause(speech.tone(tone).versePause);
      if (!settled || mine !== runId || !playing) return;
    }

    store.addStats(lib.secondsFor(text.split(/\s+/).length, rate), 1);

    const isLastVerse = verseIndex >= data.verses.length - 1;
    if (!isLastVerse) {
      store.set({ position: { ...pos, verse: verseIndex + 1 } });
      continue;
    }

    // Chapter finished.
    store.markChapterRead(data.slug, data.chapter);

    if (stopAtChapterEnd) {
      stopAtChapterEnd = false;
      clearSleep();
      return stop();
    }
    if (!store.get().autoAdvance) return stop();

    const next = await lib.stepChapter(store.get().translation, data.slug, data.chapter, 1);
    if (mine !== runId) return;
    store.set({ position: { book: next.slug, chapter: next.chapter, verse: 0 } });
  }
}

/* ── Settings that affect live playback ───────────────────────── */

export function setRate(rate) {
  store.set({ rate });
  if (playing) restart();
}

export function setVoice(uri) {
  const lang = lib.langOf(store.get().translation);
  store.set({ voiceByLang: { ...store.get().voiceByLang, [lang]: uri } });
  if (playing) restart();
}

export function setTone(id) {
  store.set({ tone: id });
  if (playing) restart();
}

/* ── Sleep timer ──────────────────────────────────────────────── */

export function setSleep(value) {
  clearSleep();

  if (value === 'chapter') {
    stopAtChapterEnd = true;
    emit('change', current());
    return;
  }
  if (!value) return;

  const capped = value;
  sleepUntil = Date.now() + capped * 60000;
  sleepTimer = setTimeout(() => {
    sleepUntil = null;
    pause();
    emit('change', current());
  }, capped * 60000);
  emit('change', current());
}

export function clearSleep() {
  clearTimeout(sleepTimer);
  sleepTimer = null;
  sleepUntil = null;
  stopAtChapterEnd = false;
}

export function sleepStatus() {
  if (stopAtChapterEnd) return { kind: 'chapter', label: 'Stopping at the end of this chapter' };
  if (!sleepUntil) return null;
  const mins = Math.max(1, Math.ceil((sleepUntil - Date.now()) / 60000));
  return { kind: 'timer', minutes: mins, label: `Sleep in about ${mins} min` };
}

/* ── Lock screen / headset controls ───────────────────────────── */

function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const c = current();
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: c.ref,
      artist: lib.TRANSLATIONS[c.translation]?.name ?? '',
      album: 'Lantern',
    });
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  } catch {
    /* not all browsers accept every field */
  }
}

export function bindMediaKeys() {
  if (!('mediaSession' in navigator)) return;
  const actions = {
    play: () => play(),
    pause: () => pause(),
    previoustrack: () => stepChapter(-1),
    nexttrack: () => stepChapter(1),
  };
  for (const [action, handler] of Object.entries(actions)) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* unsupported action */
    }
  }
}
