# Making the reading sound human

The complaint that started this: the voices were painful to listen to.

There are two separate problems behind that, and they have very different fixes.
The first is *delivery* — pacing, pitch, pauses, pronunciation — and it has been
fixed in the app. The second is *voice quality*, which is bounded by what the
device provides and cannot be fixed in JavaScript at all.

---

## What was fixed in the app

### 1. Real pauses

This is the single biggest improvement. Browser speech engines run straight
through punctuation because they are built to announce interface text, not to
read aloud. The Web Speech API has no support for SSML, so there is no way to ask
for a pause — the only way to get silence is to stop speaking.

So each verse is now split into one utterance per clause, with a measured gap
between them, and the length of that gap depends on the punctuation:

| Ends with | Rest |
|---|---|
| `.` `!` `?` | full pause |
| `;` `:` | 60% |
| cut mid-clause for length only | 25% |

A fragment shorter than 30 characters folds into the next clause so the delivery
does not turn staccato — **unless it ends a sentence**, because a full stop
always earns its breath. That rule is what carries the cadence of the Psalms,
where clauses are short and the pauses are the poetry.

There is also a longer rest between verses.

### 2. Prosody presets

Three tones, on the player and in Settings. **Soothing is the default.**

| Tone | Rate | Pitch | Clause pause | Verse pause |
|---|---|---|---|---|
| Soothing | ×0.86 | 0.94 | 420 ms | 750 ms |
| Natural | ×1.0 | 1.0 | 220 ms | 380 ms |
| Brisk | ×1.18 | 1.0 | 90 ms | 150 ms |

Slower and slightly lower is most of what separates "reading to you" from
"reading at you". The listener's own speed setting multiplies the tone, so
0.9× still means nine tenths of whatever tone they picked.

### 3. Pronunciation

Scripture contains text that speech engines reliably mangle. The worst offender
is `LORD` in small caps, which appears thousands of times in the KJV and which
many engines spell out letter by letter — a genuinely jarring sound. `speakable()`
rewrites these for the synthesiser only; the displayed text is untouched.

Colons are also converted to semicolons for speech, because engines respect a
semicolon as a break and tend to run straight through a colon.

### 4. Better voice selection

Voices are now ranked and the best one is chosen by default, listed best first in
the picker as **Lifelike**, **Better** or **Basic**. When a device offers nothing
but basic voices, the picker says so and explains where better ones come from.

---

## The part that cannot be fixed in code

**This machine has only the three basic Windows SAPI voices** (David, Mark,
Zira). They are the robotic ones. No amount of pacing makes them sound like a
person, because the underlying synthesis is twenty-year-old concatenative
technology.

Two ways to get a genuinely better voice:

**Free, immediately — open Lantern in Microsoft Edge.** Edge exposes Microsoft's
"Natural" neural voices (Aria, Guy, Jenny and others), which are in a completely
different class and are already ranked to the top of the picker. Chrome on
Windows does not expose them. This costs nothing and is worth trying before
anything else.

**Install additional voices** in Windows Settings → Time & Language → Speech.

---

## The real fix: pre-rendered neural narration

If you want the app to sound like a person reading, the answer is to stop
synthesising on the device and serve pre-rendered audio files instead. This is
what every premium Bible audio app does.

Measured from the actual bundled text:

| | KJV | BBE |
|---|---|---|
| Characters | 4,113,209 | 4,145,780 |
| Audio at an unhurried pace | ~85 hours | ~90 hours |

**Costs, stated up front — nothing here is enabled, and none of it is spent
unless you choose to:**

| Service | Rate | One-time cost for the whole KJV |
|---|---|---|
| Google Cloud TTS (Neural2) | $16 / million chars | **~$66** |
| Azure Neural TTS | $16 / million chars | **~$66** |
| Amazon Polly Neural | $16 / million chars | **~$66** |
| Google Chirp 3 HD | $30 / million chars | **~$123** |
| ElevenLabs | ~$150 / million chars | **~$617** |

Add roughly **2.4 GB** of storage per translation at 64 kbps mono, and CDN
bandwidth on top.

The headline is that **about $66 one-time buys the entire Bible in a good neural
voice.** You render it once, you own the files, and there is no per-play cost
ever again. Verify current rates before committing — these are list prices and
they move.

A human narrator is the other option and sounds better still, but 85 hours of
studio time is a different order of expense entirely, and public-domain
recordings of the KJV already exist if that route appeals.

### How it would slot in

`js/speech.js` is isolated behind a small interface — `speak(text, opts)` that
resolves when finished, plus `cancel()`. An audio-file source implements the same
two methods against an `<audio>` element and everything upstream, including the
verse highlighting and the sleep timer, keeps working unchanged.

Render per verse rather than per chapter. It costs the same, and it preserves
verse-level highlighting, resume-position and the tap-to-jump behaviour that the
app is built around.
