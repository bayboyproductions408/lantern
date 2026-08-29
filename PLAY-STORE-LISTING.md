# Google Play listing — Lantern

Everything the Play Console asks for, ready to paste. Character counts are
checked against Google's limits, which differ from Apple's.

- **Package:** `com.bayboyproductions.lantern`
- **Privacy Policy URL:** <https://bayboyproductions408.github.io/lantern/privacy.html>
- **Support email:** bayboyproductions408@gmail.com
- **Website:** <https://bayboyproductions408.github.io/lantern/>

The copy below deliberately leads with recorded narration rather than with
"offline", which is how the App Store listing was written. That listing predates
the narrators, and reading the Bible in a real human voice is now the strongest
thing this app does — it is the reason it exists rather than a feature of it.

---

## App name (30 max)

```
Lantern: Audio Bible
```

## Short description (80 max)

Shown under the title in search results, and the single most-read line.

```
The Bible read aloud by real narrators. Free, offline, no account, no paywall.
```

## Full description (4000 max)

```
Lantern reads the Bible aloud in a real, recorded human voice.

Open it, press play, and listening begins from exactly where you stopped —
chapter after chapter, book after book, for as long as you want to listen.

No account. No subscription. No paywall. Nobody should have to pay to hear the
Bible.

PEOPLE, NOT ROBOTS
Every chapter is narrated, not read out by a robotic text-to-speech voice. Pick
whichever narrator you would rather listen to, and Lantern remembers your
choice. More narrators are added over time and appear on their own — you do not
need to update the app to hear them.

PICK UP WHERE YOU LEFT OFF
Lantern remembers your place automatically. Close it mid-verse, come back days
later, and it resumes on the same line.

THE WHOLE BIBLE, FREE
All 66 books of the Old and New Testaments, with nothing locked, nothing to
unlock, and no chapter held back.

THREE TRANSLATIONS
- King James Version
- Bible in Basic English — plain, simple wording
- Reina-Valera (1909) — in Spanish, read by a Spanish narrator

Switch translation mid-chapter and Lantern keeps your exact place.

SLEEP TIMER
Stop after a chosen number of minutes, or at the end of the current chapter, and
fall asleep to scripture without the app running all night.

READING PLANS
Read the whole Bible in a year at about fourteen minutes a day, the New
Testament in ninety days, the Gospels in thirty, or shorter plans for a hard
week — grief, anxiety, thanksgiving.

ALSO INSIDE
- A verse of the day
- Bookmarks and a daily listening streak
- Shareable verse images
- Adjustable reading speed
- Follow-along highlighting, verse by verse

WORKS WITHOUT SIGNAL
Every translation's text is stored inside the app, so you can read anywhere with
no connection at all. Recorded narration streams and needs a connection; without
one, your device reads the text aloud instead, so Lantern never goes silent.

PRIVATE BY DESIGN
No accounts. Your reading position, bookmarks and settings are saved on your
device. We cannot see what you read or listen to.

Lantern is free and paid for by advertising, so it can stay free for everyone.

All included translations are in the public domain.
```

## Category and tags

- **Category:** Books & Reference
- **Tags:** Bible, Audiobooks, Religion, Reference

## Content rating questionnaire

Answer as **Everyone**. Every content question is None: no violence, no
language, no sexuality, no controlled substances, no user-generated content, no
user interaction, no location sharing.

Two questions that must be answered accurately because the app now carries ads:

- **Does your app contain ads?** Yes.
- **Ads shown to children?** The app is not directed at children; ads are
  non-personalised.

## Data safety form

This must match the iOS privacy labels and the published privacy policy, which
already describe AdMob.

- **Data collected:** Yes — by the advertising SDK, not by Lantern itself.
- **Device or other IDs** — collected, shared with third parties, for
  Advertising or marketing. Not required to use the app.
- **App activity (app interactions)** — collected, shared, for Advertising or
  marketing.
- **Approximate location** — collected, shared, for Advertising or marketing.
- **Crash logs and diagnostics** — collected, for App functionality.
- **Data is encrypted in transit:** Yes.
- **Users can request deletion:** No account exists, so there is nothing stored
  server-side to delete; the policy says so.

**Never claim "no data collected"** on this form. It was true before AdMob and
is not true now, and the privacy policy already promises otherwise.

## Ads declaration

The app **contains ads**. Declare it — Play cross-checks against the SDKs it
finds in the bundle, and a wrong answer here is a policy strike.

## Target audience

18 and over. Lantern is not designed for children, which keeps it out of the
Families programme and its extra requirements.

## Release notes (500 max) — first release

```
First release. The whole Bible, read aloud by recorded narrators, free and with
no account.
```

---

## Before the first upload

1. **Version code must increase with every upload.** The release workflow takes
   it as an input for exactly that reason; Play rejects a repeat.
2. **The AdMob application id in AndroidManifest.xml is still Google's test
   id**, because no Android app exists in the AdMob console yet. Create it,
   paste the real id, and only then run the workflow with `ads=live` — the
   workflow fails a live build that still carries the test id.
3. **Play requires a signed bundle**, and the upload key must never change once
   the app is published. The keystore is `lantern_upload.p12`; losing it means
   losing the ability to update the app.
