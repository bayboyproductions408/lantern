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
// streams fine — but fetch() of anything on that host is blocked, so the verse
// offsets cannot be fetched from beside the audio and travel separately.
// A release holds at most 1000 assets and the KJV alone needs 1189 chapters,
// so books are spread across several releases. Each book's manifest records
// which one holds it, and under what filename.
const RELEASES = 'https://github.com/bayboyproductions408/lantern/releases/download';

// A translation can be read by several narrators. The default narrator's verse
// offsets are bundled in the app so listening works with no network at all;
// the others are fetched from GitHub Pages, which — unlike Releases — does send
// CORS headers. Bundling all of them instead would add megabytes of JSON to
// the download for choices most listeners never make.
const PAGES = 'https://bayboyproductions408.github.io/lantern/data/narration';

/* ── What has been recorded ───────────────────────────────────── */

let catalogue = null;          // { kjv: { voices: [...], books: { john: 21 } } }
let cataloguePromise = null;
const manifests = new Map();   // `${translation}/${voice}/${book}` -> manifest

/** Loads the list of recorded books once. Never rejects: no catalogue simply
 *  means no narration, which is a supported state rather than an error. */
export function loadCatalogue() {
  if (cataloguePromise) return cataloguePromise;
  cataloguePromise = fetch('data/narration/catalogue.json')
    .then(r => (r.ok ? r.json() : null))
    .then(j => { catalogue = j; refresh(); return j; })
    .catch(() => { catalogue = null; refresh(); return null; });
  return cataloguePromise;
}

// Listeners are told when the narrator list grows, so a screen already on
// display can redraw rather than showing yesterday's choices.
const watchers = new Set();
export function onCatalogueChange(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

/**
 * Picks up narrators that finished recording after this version shipped.
 *
 * The bundled copy is used immediately — it is instant and works offline — and
 * a fresher copy is then fetched from GitHub Pages in the background. Without
 * this, every new narrator would need its own App Store release, which is
 * thirteen reviews to deliver thirteen voices whose audio is already hosted.
 * Failure is silent by design: no network simply means the narrators this
 * version shipped with.
 */
function refresh() {
  fetch(`${PAGES}/catalogue.json`, { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : null))
    .then(fresh => {
      if (!fresh) return;
      const before = JSON.stringify(catalogue);
      // Only ever adopt a catalogue that is at least as complete as the bundled
      // one. A truncated or half-published file must not remove a narrator the
      // listener is part way through a book with — and "at least as complete"
      // has to be measured against what shipped, not against what arrived, or a
      // file missing a translation entirely counts as no regression at all.
      const grew = Object.keys(catalogue ?? {}).every(tr =>
        (fresh[tr]?.voices?.length ?? 0) >= (catalogue[tr]?.voices?.length ?? 0));
      if (!grew) { note('remote catalogue smaller than bundled — ignored'); return; }
      catalogue = fresh;
      if (JSON.stringify(catalogue) !== before) {
        note('catalogue refreshed from Pages');
        watchers.forEach(fn => { try { fn(); } catch { /* a listener must not break the rest */ } });
      }
    })
    .catch(() => { /* offline: the bundled catalogue stands */ });
}

/** True when this exact chapter has a recording. Synchronous by design: the
 *  player asks per verse and must not stall on a network round trip. */
export function has(translation, book, chapter) {
  const chapters = catalogue?.[translation]?.books?.[book];
  return Boolean(chapters) && chapter >= 1 && chapter <= chapters;
}

export function anyFor(translation) {
  return voicesFor(translation).length > 0;
}

/** Every narrator who has recorded this translation in full. A narrator part
 *  way through recording is not listed — see build-narration-index.js. */
export function voicesFor(translation) {
  return catalogue?.[translation]?.voices ?? [];
}

/** The narrator used when the listener has not chosen one, and the one who
 *  covers any chapter a chosen narrator turns out not to reach. */
export function defaultVoice(translation) {
  const list = voicesFor(translation);
  return list.find(v => v.default) ?? list[0] ?? null;
}

/** Resolves a stored choice against what is actually available now. A voice
 *  can disappear between releases; falling back beats playing nothing. */
export function resolveVoice(translation, wanted) {
  const list = voicesFor(translation);
  return list.find(v => v.id === wanted) ?? defaultVoice(translation);
}

/* ── Current chapter ──────────────────────────────────────────── */

let el = null;                 // the single <audio> element, reused
let loaded = null;             // { translation, book, chapter, offsets, duration }
let token = 0;                 // bumped on cancel, like the speech engine
let unlocked = false;          // has a user gesture released media playback yet
let lastNote = 'not started';  // surfaced in Settings, so a device can report
                               // what happened instead of failing invisibly

function note(msg) { lastNote = msg; }

/** What the engine last did. Shown in Settings — narration failing silently is
 *  exactly the bug that hid a broken build twice, so it is made visible. */
export function status() {
  return {
    catalogue: catalogue ? `${Object.keys(catalogue).length} translations` : 'not loaded',
    unlocked,
    chapter: loaded ? `${loaded.translation}/${loaded.using}/${loaded.book} ${loaded.chapter}` : 'none',
    last: lastNote,
  };
}

/**
 * iOS refuses to load or play media unless a user gesture started it, and that
 * permission attaches to the element, not the page. So the very first tap on
 * play must touch this element directly; afterwards it can be driven from code.
 * Must be called synchronously from the gesture handler — an await first, and
 * the gesture is already spent.
 */
export function unlock() {
  if (unlocked) return;
  const a = audio();
  try {
    const p = a.play();
    if (p && p.then) {
      p.then(() => { a.pause(); unlocked = true; note('audio unlocked'); })
       .catch(() => { note('unlock rejected — will retry on next play'); });
    } else {
      a.pause(); unlocked = true; note('audio unlocked');
    }
  } catch {
    note('unlock threw');
  }
}

function audio() {
  if (el) return el;
  el = new Audio();
  el.preload = 'auto';
  // Scripture is speech; this keeps it playing when the screen locks.
  el.setAttribute('playsinline', '');
  return el;
}

let objectUrl = null;          // blob URL currently held, so it can be freed

function revokeCurrent() {
  if (objectUrl) {
    try { URL.revokeObjectURL(objectUrl); } catch { /* already gone */ }
    objectUrl = null;
  }
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * A source the media element will actually accept.
 *
 * GitHub serves release assets as `application/octet-stream` with
 * `Content-Disposition: attachment`. Desktop browsers sniff the content and
 * play it anyway; iOS honours the header and refuses, which is why the audio
 * downloaded on device but never played. On native the bytes are therefore
 * fetched through Capacitor's HTTP plugin — which also sidesteps the missing
 * CORS headers — and handed to the element as a blob typed audio/mp4.
 */
async function sourceFor(url) {
  if (!window.Capacitor?.isNativePlatform?.()) return url;

  const http = window.Capacitor?.Plugins?.CapacitorHttp;
  if (!http) { note('CapacitorHttp unavailable — using url'); return url; }

  try {
    const res = await http.get({ url, responseType: 'blob' });
    const data = res && res.data;
    if (!data) { note('native fetch returned no data'); return null; }
    const blob = typeof data === 'string'
      ? base64ToBlob(data, 'audio/mp4')
      : new Blob([data], { type: 'audio/mp4' });
    if (!blob.size) { note('native fetch returned empty blob'); return null; }
    return URL.createObjectURL(blob);
  } catch (err) {
    note(`native fetch failed: ${err && err.message ? err.message : err}`);
    return null;
  }
}

/**
 * A book's verse offsets, for one narrator.
 *
 * The default narrator's manifests ship inside the app, so they resolve
 * offline and instantly. Every other narrator's are fetched from GitHub Pages
 * the first time that book is played and then kept for the session. Returns
 * null rather than throwing: a manifest that cannot be reached means falling
 * back to the default narrator, not failing the chapter.
 */
async function manifestFor(translation, voice, book) {
  const key = `${translation}/${voice}/${book}`;
  if (manifests.has(key)) return manifests.get(key);

  const bundled = defaultVoice(translation)?.id === voice;
  const url = bundled
    ? `data/narration/${translation}/${voice}/${book}.json`
    : `${PAGES}/${translation}/${voice}/${book}.json`;

  try {
    const res = await fetch(url);
    if (!res.ok) { note(`manifest ${key}: HTTP ${res.status}`); return null; }
    const m = await res.json();
    manifests.set(key, m);
    return m;
  } catch (err) {
    note(`manifest ${key} failed: ${err && err.message ? err.message : err}`);
    return null;
  }
}

/**
 * Fetches a chapter's audio and its verse offsets for the chosen narrator.
 *
 * Resolves false when the chapter has no recording at all or the audio cannot
 * be fetched. A chosen narrator whose manifest cannot be reached — offline, on
 * a first play of an alternate voice — falls back to the default narrator
 * rather than dropping to the synthesiser: another person reading is always
 * closer to what the listener wanted than a robot reading.
 */
export async function prepare(translation, book, chapter, wanted = null) {
  const voice = (resolveVoice(translation, wanted) ?? {}).id;
  if (!voice) return false;

  if (loaded && loaded.translation === translation && loaded.voice === voice &&
      loaded.book === book && loaded.chapter === chapter) {
    return true;
  }
  if (!has(translation, book, chapter)) return false;

  try {
    let using = voice;
    let manifest = await manifestFor(translation, using, book);
    if (!manifest) {
      const fallback = defaultVoice(translation)?.id;
      if (!fallback || fallback === using) return false;
      note(`falling back to ${fallback}`);
      using = fallback;
      manifest = await manifestFor(translation, using, book);
      if (!manifest) return false;
    }

    const entry = manifest.chapters.find(c => c.chapter === chapter);
    if (!entry) return false;

    if (!manifest.release) { note('book has no release assigned'); return false; }

    // The asset prefix is recorded per book rather than rebuilt here: the two
    // narrators that predate voices keep their original filenames.
    const prefix = manifest.prefix ?? `${translation}-${book}`;
    const url = `${RELEASES}/${manifest.release}/${prefix}-${chapter}.m4a`;
    const src = await sourceFor(url);
    if (!src) { loaded = null; return false; }

    // Deliberately no wait for loadedmetadata. iOS will not load media outside
    // a user gesture — preload is ignored and load() does nothing — so waiting
    // for metadata timed out on every chapter. The recording is committed to
    // optimistically; if it turns out not to play, playVerse reports it and
    // the caller falls back for that verse instead.
    const a = audio();
    revokeCurrent();
    objectUrl = src.startsWith('blob:') ? src : null;
    a.src = src;
    a.load();

    // `voice` is the narrator asked for, `using` the one actually loaded; they
    // differ only on a fallback. Keying on `voice` stops prepare() reloading
    // the same audio every verse when a fallback is in force.
    loaded = { translation, voice, using, book, chapter, offsets: entry.verses, duration: entry.duration };
    note(`prepared ${translation}/${using}/${book} ${chapter}${objectUrl ? ' (blob)' : ' (url)'}`);
    return true;
  } catch (err) {
    note(`prepare failed: ${err && err.message ? err.message : err}`);
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
  if (!loaded || index < 0 || index >= loaded.offsets.length) {
    return Promise.resolve('failed');
  }

  const mine = ++token;
  const a = audio();
  const start = loaded.offsets[index];
  const stop = endOf(index);

  a.playbackRate = rate;

  // Only seek when the playhead is not already inside this verse, so
  // continuous listening does not restart the decoder on every verse.
  const drift = Math.abs(a.currentTime - start);
  if (a.paused || drift > 0.35) {
    // Seeking before any data has arrived throws; the playhead lands where it
    // can and the boundary poll below corrects once metadata is in.
    try { a.currentTime = start; } catch { /* not seekable yet */ }
  }

  return new Promise(resolve => {
    let timer = null;
    // 'failed' and 'cancelled' are distinct: a failure should fall back to
    // speech for this verse, a cancellation should stop quietly. Collapsing
    // them is what let a broken audio path masquerade as a user pause.
    const done = outcome => {
      if (timer) clearInterval(timer);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('error', onError);
      resolve(outcome);
    };
    const onEnded = () => done(mine === token ? 'done' : 'cancelled');
    const onError = () => { note('audio element error'); done('failed'); };

    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onError);

    // If nothing has started playing at all, treat it as a failure rather than
    // hanging — on iOS this is what a blocked or missing download looks like.
    const stall = setTimeout(() => {
      if (a.paused || a.readyState === 0) { note('audio never started'); done('failed'); }
    }, 6000);
    const clearStall = () => clearTimeout(stall);

    // timeupdate only fires about four times a second, which is too coarse to
    // land on a verse boundary cleanly, so the boundary is polled instead.
    timer = setInterval(() => {
      if (mine !== token) { clearStall(); return done('cancelled'); }
      if (a.readyState > 0 && a.currentTime >= stop - 0.02) { clearStall(); done('done'); }
    }, 40);

    a.play().then(() => {
      // The pre-emptive unlock often rejects because no source was set yet.
      // Playback starting here is the authoritative signal, so correct the
      // note rather than leaving a stale failure on the diagnostics row.
      unlocked = true;
      note(`playing ${loaded.translation}/${loaded.using}/${loaded.book} ${loaded.chapter}`);
    }).catch(err => {
      clearStall();
      note(`play rejected: ${err && err.name ? err.name : 'unknown'}`);
      done('failed');
    });
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
  revokeCurrent();
  if (el) { el.removeAttribute('src'); el.load(); }
}

export function isLoaded() {
  return Boolean(loaded);
}

/** The narrator actually playing, which is not always the one chosen — a
 *  fallback is exactly the case the listener should be able to see. */
export function playingVoice() {
  return loaded ? loaded.using : null;
}
