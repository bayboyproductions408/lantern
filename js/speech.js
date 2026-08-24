// Text-to-speech wrapper around the Web Speech API.
//
// Browser speech engines sound mechanical by default, mostly because they are
// tuned for UI announcements: fast, flat, and with no room to breathe. Three
// things here do most of the work of making a reading sound like a person:
//
//   1. Prosody — a slower rate and slightly lowered pitch (see TONES).
//   2. Silence — real pauses between clauses and between verses. This is the
//      single biggest improvement, and browsers give no other way to get it
//      since SSML is not supported.
//   3. Pronunciation — scripture contains text that engines reliably mangle,
//      most notably "LORD" in small caps, which many voices spell out letter
//      by letter. See `speakable()`.
//
// Three browser quirks also shape this file:
//   - Voices load asynchronously; the first getVoices() is usually empty.
//   - Chrome silently stops an utterance running longer than ~15 seconds.
//   - cancel() fires pending `onend` handlers, which looks like completion.

const synth = window.speechSynthesis;

export const supported = Boolean(synth) && typeof SpeechSynthesisUtterance !== 'undefined';

/* ── Tone presets ─────────────────────────────────────────────── */

// `rateScale` multiplies the listener's own speed setting, so "0.9×" still
// means nine tenths of whatever tone they picked.
export const TONES = {
  soothing: {
    id: 'soothing',
    label: 'Soothing',
    note: 'Unhurried and low, for late nights and sleep',
    rateScale: 0.86,
    pitch: 0.94,
    clausePause: 420,
    versePause: 750,
  },
  natural: {
    id: 'natural',
    label: 'Natural',
    note: 'The pace of someone reading aloud to you',
    rateScale: 1,
    pitch: 1,
    clausePause: 220,
    versePause: 380,
  },
  brisk: {
    id: 'brisk',
    label: 'Brisk',
    note: 'Straight through, for covering ground',
    rateScale: 1.18,
    pitch: 1,
    clausePause: 90,
    versePause: 150,
  },
};

export function tone(id) {
  return TONES[id] || TONES.soothing;
}

/* ── Pronunciation ────────────────────────────────────────────── */

// Words that speech engines read as initialisms because they are fully
// capitalised. Rendered text keeps its original capitalisation — only what is
// handed to the synthesiser changes.
const SMALL_CAPS = /\b(LORD|GOD|JEHOVAH|CHRIST|JESUS|KING OF KINGS)\b/g;

const TITLE_CASE = {
  LORD: 'Lord',
  GOD: 'God',
  JEHOVAH: 'Jehovah',
  CHRIST: 'Christ',
  JESUS: 'Jesus',
  'KING OF KINGS': 'King of Kings',
};

/** Rewrites a verse into something a speech engine pronounces correctly. */
export function speakable(text, lang = 'en') {
  let out = text;
  // The small-caps convention for the divine name is an English-typography
  // thing; the Spanish text writes "Jehová" normally and needs no such fix.
  if (lang === 'en') out = out.replace(SMALL_CAPS, m => TITLE_CASE[m] ?? m);
  return out
    // A colon marks a strong mid-verse break in these editions. Engines tend to
    // run straight through it, so make it a break they do respect.
    .replace(/:\s/g, '; ')
    // Collapse the spacing left by any of the above.
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── Voices ───────────────────────────────────────────────────── */

let voiceList = [];
let voicesResolved = null;

// Ranked best first. Neural voices are a different class of quality and are
// worth surfacing at the top of the picker.
const NEURAL = /natural|neural|wavenet|studio|journey|polyglot/i;
const ENHANCED = /premium|enhanced|siri|eloquence/i;
const NETWORK = /google|online|remote/i;

// Voices pinned to the top for a specific language, because they sound markedly
// better than anything else that language usually offers. The local Microsoft
// Spanish voices are noticeably robotic next to Google's network voice, so
// Spanish gets an explicit preference rather than relying on the general
// ranking below.
const PREFERRED_BY_LANG = {
  es: [/google\s+espa[ñn]ol/i, /google.*spanish/i],
};

function isPreferred(voice) {
  const lang = (voice.lang || '').slice(0, 2).toLowerCase();
  return (PREFERRED_BY_LANG[lang] || []).some(re => re.test(voice.name || ''));
}

function score(voice) {
  const name = voice.name || '';
  if (isPreferred(voice)) return { quality: 'neural', rank: -1 };
  if (NEURAL.test(name)) return { quality: 'neural', rank: 0 };
  if (ENHANCED.test(name)) return { quality: 'enhanced', rank: 1 };
  if (NETWORK.test(name) || !voice.localService) return { quality: 'enhanced', rank: 2 };
  return { quality: 'standard', rank: 3 };
}

function classify(voice) {
  const { quality, rank } = score(voice);
  return {
    voice,
    uri: voice.voiceURI,
    name: voice.name,
    lang: voice.lang,
    quality,
    rank,
  };
}

function readVoices() {
  voiceList = (synth.getVoices() || [])
    .filter(v => v.lang)
    .map(classify)
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return voiceList;
}

/* ── Late-arriving voices ─────────────────────────────────────── */

// Chrome publishes its local voices first and its network-backed Google voices
// in a later `voiceschanged` event — sometimes seconds later. Anything that
// picked a default from the first list would be stuck with a lesser voice, so
// the list is re-read every time it changes and subscribers are told.
const voiceWatchers = new Set();

export function onVoicesChanged(fn) {
  voiceWatchers.add(fn);
  return () => voiceWatchers.delete(fn);
}

if (supported) {
  synth.addEventListener('voiceschanged', () => {
    const before = voiceList.length;
    readVoices();
    if (voiceList.length !== before) voiceWatchers.forEach(fn => fn(voiceList));
  });
}

/** Resolves once the browser has actually published its voice list. */
export function ready() {
  if (!supported) return Promise.resolve([]);
  if (voicesResolved) return voicesResolved;

  voicesResolved = new Promise(resolve => {
    if (readVoices().length) return resolve(voiceList);

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      readVoices();
      resolve(voiceList);
    };
    synth.addEventListener('voiceschanged', finish, { once: true });
    // Safari sometimes never fires the event; poll briefly as a backstop.
    let tries = 0;
    const poll = setInterval(() => {
      if (readVoices().length || ++tries > 20) {
        clearInterval(poll);
        finish();
      }
    }, 150);
  });

  return voicesResolved;
}

/** Voices for one language, best first. Pass no language for all of them. */
export function voices(lang) {
  if (!voiceList.length) readVoices();
  if (!lang) return voiceList;
  return voiceList.filter(v => v.lang.toLowerCase().startsWith(lang));
}

export function findVoice(uri) {
  return voices().find(v => v.uri === uri) || null;
}

/** The best voice the device offers for a language. */
export function bestVoice(lang) {
  return voices(lang)[0] || voices()[0] || null;
}

/** True when a language has nothing better than a basic system voice. */
export function onlyBasicVoices(lang) {
  const list = voices(lang);
  return list.length > 0 && list.every(v => v.quality === 'standard');
}

/* ── Chunking ─────────────────────────────────────────────────── */

const MAX_CHUNK = 200;
// Below this, a mid-sentence fragment is too short to deserve a pause of its
// own — running it into the next clause avoids a staccato delivery. A fragment
// that ends a sentence is never folded, however short: a full stop always earns
// its breath, which is what carries the cadence of poetry like the Psalms.
const MIN_CHUNK = 30;

/**
 * How long to rest after a piece, as a multiple of the tone's clause pause.
 * A full stop earns a real breath; a semicolon earns half of one; a piece cut
 * mid-clause purely for length earns almost nothing, because no pause belongs
 * there at all.
 */
function gapAfter(text) {
  const last = text.trim().slice(-1);
  if ('.!?'.includes(last)) return 1;
  if (';:'.includes(last)) return 0.6;
  return 0.25;
}

/**
 * Splits a verse into one utterance per clause.
 *
 * Each clause is spoken separately so a pause can be placed between them —
 * pauses are the main thing that makes synthesised speech sound human, and the
 * Web Speech API offers no other way to insert one. Keeping clauses apart also
 * holds every utterance well under Chrome's ~15 second cutoff.
 *
 * Returns `[{ text, gap }]`.
 */
export function chunk(text) {
  const clauses = text.match(/[^.!?;:]+[.!?;:]*\s*/g) || [text];
  const pieces = [];

  for (const raw of clauses) {
    const clause = raw.trim();
    if (!clause) continue;

    if (clause.length <= MAX_CHUNK) {
      pieces.push({ text: clause, gap: gapAfter(clause) });
      continue;
    }

    // Too long for one utterance: break on commas, then on spaces.
    let rest = clause;
    while (rest.length > MAX_CHUNK) {
      const comma = rest.lastIndexOf(',', MAX_CHUNK);
      const at = comma > MAX_CHUNK * 0.4 ? comma + 1 : rest.lastIndexOf(' ', MAX_CHUNK);
      const cut = rest.slice(0, at > 0 ? at : MAX_CHUNK);
      pieces.push({ text: cut.trim(), gap: gapAfter(cut) });
      rest = rest.slice(cut.length);
    }
    if (rest.trim()) pieces.push({ text: rest.trim(), gap: gapAfter(rest) });
  }

  // Fold very short mid-sentence fragments into the piece that follows them.
  const out = [];
  for (const piece of pieces) {
    const prev = out[out.length - 1];
    const foldable = prev && prev.text.length < MIN_CHUNK && prev.gap < 1;
    if (foldable) {
      prev.text = `${prev.text} ${piece.text}`;
      prev.gap = piece.gap;
    } else {
      out.push({ ...piece });
    }
  }
  return out;
}

/* ── Playback ─────────────────────────────────────────────────── */

let generation = 0;
let watchdog = null;

function stopWatchdog() {
  clearInterval(watchdog);
  watchdog = null;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/**
 * Speaks `text` to completion, with a pause between clauses.
 * Resolves true when it finished, false when a later cancel() interrupted it.
 */
export function speak(text, { rate = 1, voiceURI = null, toneId = 'soothing', lang = 'en' } = {}) {
  if (!supported) return Promise.resolve(false);

  cancel();
  const mine = ++generation;
  const settings = tone(toneId);
  const pieces = chunk(speakable(text, lang));
  if (!pieces.length) return Promise.resolve(true);

  return new Promise(resolve => {
    let i = 0;

    const next = async () => {
      if (mine !== generation) return resolve(false);
      if (i >= pieces.length) {
        stopWatchdog();
        return resolve(true);
      }

      // Let the previous clause land before starting the next one. This is
      // what stops the reading sounding like it is racing.
      if (i > 0) {
        await wait(settings.clausePause * pieces[i - 1].gap);
        if (mine !== generation) return resolve(false);
      }

      const u = new SpeechSynthesisUtterance(pieces[i++].text);
      u.rate = Math.min(2, Math.max(0.5, rate * settings.rateScale));
      u.pitch = settings.pitch;
      const found = voiceURI ? findVoice(voiceURI) : null;
      if (found) {
        u.voice = found.voice;
        u.lang = found.lang;
      }

      u.onend = () => {
        if (mine === generation) next();
      };
      u.onerror = event => {
        if (mine !== generation) return resolve(false);
        if (event.error === 'interrupted' || event.error === 'canceled') return resolve(false);
        next();
      };

      synth.speak(u);
    };

    stopWatchdog();
    // Chrome parks the queue on long sessions; a periodic resume revives it.
    watchdog = setInterval(() => {
      if (mine !== generation) return stopWatchdog();
      if (synth.speaking && !synth.paused) synth.resume();
    }, 8000);

    next();
  });
}

/** A cancellable gap, used by the player between verses. */
export function pause(ms) {
  const mine = generation;
  return new Promise(resolve => {
    setTimeout(() => resolve(mine === generation), ms);
  });
}

export function cancel() {
  generation++;
  stopWatchdog();
  if (supported) {
    try {
      synth.cancel();
    } catch {
      /* Safari throws if nothing is queued */
    }
  }
}

/**
 * Browsers require a user gesture before audio may start. Speaking a silent
 * utterance inside the first tap unlocks the queue for the rest of the session.
 */
export function unlock() {
  if (!supported) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
  } catch {
    /* not fatal */
  }
}
