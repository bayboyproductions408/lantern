// Pre-recorded narration playback.
//
// The player drives listening one verse at a time, so this engine exposes the
// same shape the speech engine does: ask for a verse, get a promise that
// settles when that verse is done. Underneath, a whole chapter is a single
// audio file and playback simply runs on — each verse resolves as the
// playhead crosses into the next one. Seeking only happens when the listener
// jumps, so ordinary listening is gapless rather than a series of restarts.
//
// Audio is optional at every point. If a chapter has no recording, or the
// device is offline, the caller falls back to on-device speech and the app
// keeps working exactly as before.

// Audio is served from GitHub Releases, which supports range requests but
// sends no CORS headers. A media element does not need them, so the audio
// streams fine — but fetch() of anything on that host is blocked. The verse
// offsets therefore ship inside the app rather than being fetched alongside
// the audio, which also makes them instant and available offline.
const BASE = 'https://github.com/bayboyproductions408/lantern/releases/download/narration-v1';

/* ── What has been recorded ───────────────────────────────────── */

let catalogue = null;          // { kjv: { john: 21, ... }, ... }
let cataloguePromise = null;
const manifests = new Map();   // `${translation}/${book}` -> manifest

/** Loads the list of recorded books once. Never rejects: no catalogue simply
 *  means no narration, which is a supported state rather than an error. */
export function loadCatalogue() {
  if (cataloguePromise) return cataloguePromise;
  cataloguePromise = fetch('data/narration/catalogue.json')
    .then(r => (r.ok ? r.json() : null))
    .then(j => { catalogue = j; return j; })
    .catch(() => { catalogue = null; return null; });
  return cataloguePromise;
}

/** True when this exact chapter has a recording. Synchronous by design: the
 *  player asks per verse and must not stall on a network round trip. */
export function has(translation, book, chapter) {
  const chapters = catalogue?.[translation]?.[book];
  return Boolean(chapters) && chapter >= 1 && chapter <= chapters;
}

export function anyFor(translation) {
  return Boolean(catalogue?.[translation] && Object.keys(catalogue[translation]).length);
}

/* ── Current chapter ──────────────────────────────────────────── */

let el = null;                 // the single <audio> element, reused
let loaded = null;             // { translation, book, chapter, offsets, duration }
let token = 0;                 // bumped on cancel, like the speech engine

function audio() {
  if (el) return el;
  el = new Audio();
  el.preload = 'auto';
  // Scripture is speech; this keeps it playing when the screen locks.
  el.setAttribute('playsinline', '');
  return el;
}

/** Fetches a chapter's audio and its verse offsets. Resolves false when the
 *  chapter has no recording or the network is unavailable. */
export async function prepare(translation, book, chapter) {
  if (loaded && loaded.translation === translation &&
      loaded.book === book && loaded.chapter === chapter) {
    return true;
  }
  if (!has(translation, book, chapter)) return false;

  try {
    const key = `${translation}/${book}`;
    let manifest = manifests.get(key);
    if (!manifest) {
      const res = await fetch(`data/narration/${translation}/${book}.json`);
      if (!res.ok) return false;
      manifest = await res.json();
      manifests.set(key, manifest);
    }
    const entry = manifest.chapters.find(c => c.chapter === chapter);
    if (!entry) return false;

    // Confirm the recording actually loads before committing to it. The
    // catalogue can legitimately run ahead of the uploaded audio, and a
    // chapter that 404s must fall back to speech rather than stop playback.
    const a = audio();
    a.src = `${BASE}/${translation}-${book}-${chapter}.m4a`;
    a.load();

    const ok = await new Promise(resolve => {
      const done = v => {
        clearTimeout(timer);
        a.removeEventListener('loadedmetadata', onOk);
        a.removeEventListener('error', onFail);
        resolve(v);
      };
      const onOk = () => done(true);
      const onFail = () => done(false);
      const timer = setTimeout(() => done(false), 8000);
      a.addEventListener('loadedmetadata', onOk);
      a.addEventListener('error', onFail);
    });
    if (!ok) { loaded = null; return false; }

    loaded = { translation, book, chapter, offsets: entry.verses, duration: entry.duration };
    return true;
  } catch {
    return false;
  }
}

/** Where a verse ends: the next verse's start, or the end of the chapter. */
function endOf(index) {
  if (!loaded) return 0;
  const next = loaded.offsets[index + 1];
  return next === undefined ? loaded.duration : next;
}

/**
 * Plays one verse. Resolves true when it finishes, false if cancelled or if
 * playback could not start — the caller treats false as "stop here".
 */
export function playVerse(index, { rate = 1 } = {}) {
  if (!loaded || index < 0 || index >= loaded.offsets.length) return Promise.resolve(false);

  const mine = ++token;
  const a = audio();
  const start = loaded.offsets[index];
  const stop = endOf(index);

  a.playbackRate = rate;

  // Only seek when the playhead is not already inside this verse, so
  // continuous listening does not restart the decoder on every verse.
  const drift = Math.abs(a.currentTime - start);
  if (a.paused || drift > 0.35) a.currentTime = start;

  return new Promise(resolve => {
    let timer = null;
    const done = ok => {
      if (timer) clearInterval(timer);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('error', onError);
      resolve(ok);
    };
    const onEnded = () => done(mine === token);
    const onError = () => done(false);

    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onError);

    // timeupdate only fires about four times a second, which is too coarse to
    // land on a verse boundary cleanly, so the boundary is polled instead.
    timer = setInterval(() => {
      if (mine !== token) return done(false);
      if (a.currentTime >= stop - 0.02) done(true);
    }, 40);

    a.play().catch(() => done(false));
  });
}

export function cancel() {
  token++;
  if (el && !el.paused) el.pause();
}

/** Releases the current chapter so the next prepare() refetches. */
export function reset() {
  cancel();
  loaded = null;
  if (el) { el.removeAttribute('src'); el.load(); }
}

export function isLoaded() {
  return Boolean(loaded);
}
