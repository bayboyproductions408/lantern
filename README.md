# Lantern

**The Bible, read aloud. Open the app, press one button, start listening.**

A progressive web app that reads scripture out loud from wherever you left off.
No account, no sign-up, works offline, and every verse is free.

> *"Thy word is a lamp unto my feet, and a light unto my path."* — Psalm 119:105

---

## Running it

```bash
node server.js
```

Then open <http://localhost:4321>. There is no build step and no dependencies —
the whole app is static files.

To regenerate the scripture data from source (only needed if you change the
cleaning rules):

```bash
node build-data.js
```

---

## What it does

**Press play and it keeps going.** Playback rolls verse to verse, chapter to
chapter, book to book — Malachi 4 into Matthew 1, Revelation 22 back to Genesis 1
— until you stop it or the sleep timer does.

**It remembers.** Your exact verse position is written on every advance, so
reopening the app puts the play button right where you were.

**Follow along or don't.** The spoken verse is highlighted and scrolls into view,
but the moment you scroll by hand it stops fighting you for four seconds. Tap any
verse to jump there.

**It reads like a person, not a robot.** Each verse is broken into clauses and
spoken with real pauses between them, weighted by punctuation, with a longer rest
between verses. Three tone presets — **Soothing** (the default), Natural and
Brisk — set pacing, pitch and pause length. See [NARRATION.md](NARRATION.md).

**Share a verse as an image.** A rendered card, sized for social, via the share
sheet with a download fallback.

**A daily verse, if you want one.** One notification at a time you choose,
following whichever translation you read. Never a nag about days missed.

**Everything else**: full-text search across all 31,100 verses, a library browser
grouped by genre, eight reading plans, bookmarks, a sleep timer, adjustable
speed, dark and light themes, a Give tab with chapter dedications, and
lock-screen / headset controls via the Media Session API.

---

## The texts

Three complete translations are bundled, all **public domain** — chosen precisely
for that reason, so the full text ships inside the app with no licensing exposure:

- **King James Version** (1611) — 31,100 verses
- **Bible in Basic English** (1965) — 31,104 verses, plain vocabulary
- **Reina-Valera 1909** (Spanish) — 31,102 verses

The Spanish text was verified as the **1909** edition rather than the
copyrighted **1960** one before it was bundled: it uses the archaic "crió" in
Genesis 1:1 where the 1960 reads "creó", and the old accented preposition "á" in
12,841 verses. Reina-Valera 1960 is under copyright and must not be substituted.

Book slugs are always derived from the English names, so a book keeps one
identity across every translation. Saved positions, bookmarks and reading plans
all key on the slug, which is what lets someone switch to Spanish mid-chapter and
stay exactly where they were.

`build-data.js` cleans the raw source: translator-supplied words (marked `{was}`)
are kept as ordinary text, while marginal glosses (`{lemma: Heb. ...}`) are
stripped, since reading a footnote aloud mid-verse is jarring. It also computes
per-chapter word counts, which is what lets reading plans balance days by
*listening time* rather than chapter count — Psalm 119 is nearly forty times
longer than Psalm 117.

---

## How it is put together

```
index.html          app shell
styles.css          all styling, themed via CSS custom properties
server.js           dependency-free static server
build-data.js       source text → cleaned per-book JSON + index
sw.js               service worker: offline shell + permanent scripture cache
js/
  app.js            boot
  ui.js             all rendering and event wiring
  player.js         playback controller — owns position, drives speech
  speech.js         Web Speech API wrapper
  library.js        scripture loading, navigation, search
  plans.js          reading plan generation and progress
  store.js          persisted state (one localStorage key)
  monetize.js       ad slots, direct campaigns, rewarded video, tips, dedications
  notify.js         daily verse reminder
  share.js          verse card rendered to a canvas
data/
  kjv/*.json        66 books, one file each, lazily loaded
  kjv-index.json    book metadata + per-chapter word counts (19 KB)
  bbe/… rvr/…
```

Books load on demand and the cache is capped at 16, so walking the entire Bible
in one sitting doesn't grow memory without bound.

### What shaped `speech.js`

1. **There is no way to ask for a pause.** The Web Speech API does not support
   SSML, so the only way to produce silence is to stop speaking. Verses are split
   into one utterance per clause with a measured gap between them, weighted by
   the punctuation that ended the clause. This is the main reason the reading
   sounds human rather than mechanical.
2. **Voices load asynchronously** and the first `getVoices()` call usually returns
   nothing. Resolved with a `voiceschanged` listener plus a polling backstop for
   Safari, which sometimes never fires the event.
3. **Chrome silently kills utterances longer than ~15 seconds.** Clauses are
   capped at 200 characters, which keeps every utterance well under the limit. A
   periodic `resume()` revives the queue on long sessions.
4. **`cancel()` fires the pending `onend` handlers**, which is indistinguishable
   from real completion. A generation token tells the two apart, so pausing
   doesn't cause a phantom advance to the next verse.
5. **Engines mispronounce scripture.** `LORD` in small caps gets spelled out
   letter by letter by many voices. `speakable()` rewrites such text for the
   synthesiser only — what is displayed never changes.

---

## Monetization

**The app is free for everyone, in full.** No subscription, no premium tier, no
feature gate, no account. Every translation, plan, voice, offline download,
unlimited bookmarks and an uncapped sleep timer ship to every listener.

Advertising carries the business. Four placements (player banner, end of chapter,
library, search) serve through a viewability-aware slot that refreshes only while
genuinely on screen and in the foreground, with house creatives as the no-fill
fallback. There is also an opt-in rewarded video and a tip jar — neither unlocks
anything, because there is nothing locked.

Those placements are the **web** build's, and no network is connected to them
yet (`ACTIVE_NETWORK = 'house'` in `js/monetize.js`); gifts there are simulated.
The **native** builds are different: `js/ads-admob.js` runs a real AdMob banner
through the Google Mobile Ads SDK, requested non-personalised (`npa=1`) so no
advertising identifier is used for tracking and no App Tracking Transparency
prompt is needed.

`TESTING` in `js/ads-admob.js` decides whether that banner earns anything, and
the ad mode is a release-time input rather than a source constant. See
[RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md) §4 before shipping — a build sent
out with test units looks perfectly healthy and earns nothing.

See [MONETIZATION.md](MONETIZATION.md) for the revenue model, the placement rules
that keep ads from angering people, and why direct-sold sponsorship is worth six
to ten times programmatic.

---

## Verified

Checked in-browser against a running server:

- Boot restores position and renders Genesis 1 with all 31 verses
- Chapter rollover in both directions, including Genesis↔Revelation wrap and
  Exodus 1:1 stepping back to Genesis 50:26
- Verse chunking splits a long verse into 112/144-character pieces
- "Bible in a Year" produces 365 days averaging 13.9 min (range 6–22)
- Search finds Psalms 119:105 for "lamp unto my feet" across all 66 books in 44 ms
- Ad slot refreshes 4 times in 3.4s at a 1s interval, stops dead while
  backgrounded, clears its timer on destroy, and rotates all house creatives
- No gate anywhere: all 8 plans start immediately, sleep timer accepts 120 min,
  40 bookmarks store without complaint
- Clause splitting weights pauses by punctuation, folds short mid-sentence
  fragments, and never folds across a full stop; long verses stay under the
  200-character utterance cap
- `speakable()` rewrites small-caps `LORD`/`GOD` so voices stop spelling them out
- Give tab renders with five amounts, an "other" option and three non-financial
  ways to help; tone presets switch live
- Spanish source verified as the public-domain 1909 edition before bundling;
  switching translation mid-chapter keeps the position (John 3:16 → Juan 3:16)
  and Spanish book names and genre labels render
- Verse of the day is stable for a given date, differs the next day, and follows
  the translation into Spanish (Hebrews 11:1 → Hebreos 11:1)
- Share card renders 1080×1080 with auto-fitted, wrapped text
- Dedications appear above the reading they belong to and nowhere else
- Tip rail fails safe: runtime detection of a native wrapper forces in-app
  purchase even when the build flag still says web

## Known gaps

- **Service worker registration is blocked inside the Claude preview pane.** The
  file serves correctly (200, right MIME, secure context), so this is an
  environment restriction, not a code fault — offline mode needs verifying in a
  normal browser. Registration failure is caught and the app carries on.
- **Only basic voices exist on this machine.** The three Windows SAPI voices
  (David, Mark, Zira) are the robotic ones, and no amount of pacing fixes the
  underlying synthesis. Opening Lantern in **Microsoft Edge** exposes Microsoft's
  "Natural" neural voices and costs nothing. The real fix is pre-rendered neural
  narration — about **$66 one-time** for the whole KJV. Both covered in
  [NARRATION.md](NARRATION.md).
- **Ad refresh needs a real browser to confirm end to end.** The preview pane
  reports `visibilityState: "hidden"` and never composites, so
  IntersectionObserver never fires there. The refresh logic was verified by
  driving the slot directly; the on-screen detection itself still wants a
  normal browser.
- **No Spanish voices on this machine.** `speech.voices('es')` returns zero, so
  the Reina-Valera can be read but not spoken here. The voice picker says so
  plainly rather than failing silently. Any device with Spanish TTS installed
  works; this is also the strongest argument for pre-rendered narration, which
  removes the dependency on whatever voices a device happens to have.
- **Daily reminders only fire while the app is open**, plus a catch-up on the
  next launch. A web page cannot schedule a background notification. Reliable
  delivery needs either Web Push with a server, or — far simpler —
  `@capacitor/local-notifications` once wrapped, which schedules on-device with
  no server at all.
- **Icons are SVG-only.** Some Android install prompts want a 192px and 512px
  PNG. Needs generating before store submission.
- **Background audio on mobile web is unreliable** — screen-lock behaviour varies
  by browser. This is the strongest argument for wrapping the app with Capacitor
  for the app stores rather than shipping PWA-only. AdMob also pays materially
  better than AdSense on mobile inventory.
