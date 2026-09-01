# Release checklist — Lantern

What to do, in order, when shipping a build. Every item here exists because
something went wrong once; the notes say what, so the step is worth trusting
rather than skipping.

---

## 1. Before you build

- [ ] `git status` clean, and `origin/main` is the commit you mean to ship.
- [ ] Decide the ad mode. **Test ads earn nothing.** See §4 before choosing.
- [ ] If a narrator finished since the last release, `npm run narration:publish`
      (dry run) then `-- --push`. Narrators reach installed copies through the
      catalogue, not the binary, so this does not need a store release — but it
      does need doing, because rendering alone publishes nothing.

## 2. iOS

    (GitHub Actions → "iOS Release (TestFlight)" → Run workflow)

- [ ] Branch `main`, version set, **ads = `live`** for anything going to the App
      Store.
- [ ] Watch the run reach **Upload to TestFlight**. Archive and export succeeding
      proves nothing about the API key — a bad `ASC_API_KEY_P8` fails *after* a
      clean archive with `Failed to load AuthKey file. (-39)`, which reads like a
      signing fault and is not one.
- [ ] `ASC_API_KEY_P8` is the **raw PEM text**, armor lines included, never
      base64. `ASC_ISSUER_ID` belongs to the team and never changes on rotation.
- [ ] Never revoke an old ASC key until a run has gone green on the new one.
      Apple lets each `.p8` be downloaded exactly once, and overwriting the
      secret destroys your only copy of the old one.

## 3. Google Play

    npm run android:release -- --live

- [ ] Confirm the merged manifest still carries
      `com.google.android.gms.permission.AD_ID`. The Advertising ID declaration
      says it does, and Play blocks the release if declaration and artifact
      disagree.
- [ ] **Production needs a completed closed test first.** This is a personal
      developer account: 12 testers opted in continuously for 14 days, then an
      application that is itself reviewed. That is a hard two-week floor — plan
      the launch date backwards from it.

## 4. Ads — the step that gets missed

Getting this wrong is silent. The app looks fine and earns nothing.

- [ ] **Ship `--live`.** `TESTING = true` in `js/ads-admob.js` swaps in Google's
      test unit ids (`ca-app-pub-3940256099942544/…`). Those bill to Google's
      test account, so your own console shows zero.
- [ ] **The day the app goes live, link it to its store listing in AdMob.**
      Until then every app sits at *"Limited ad serving — Add store to lift
      limit."* AdMob's store search only finds published apps, so this cannot be
      done in advance. It is the single most-missed step on this account.
- [ ] Leave `app-ads.txt` alone. It is already correct at
      <https://bayboyproductions408.github.io/app-ads.txt>. If AdMob says "No ad
      requests with app-ads.txt yet", that is *not* a file problem — AdMob learns
      the domain from the linked store listing, so an unlinked app can never be
      crawled.

**Diagnosing "ads are not working", in one question: how many requests?**

| Requests | Meaning |
| --- | --- |
| 0 | Your app never asked. Test unit ids, or the ad code is not running. |
| > 0, low match rate | AdMob's side. Limited ad serving, or no fill yet. |

Checking that first would have saved a long hunt on another app that was live
with zero requests the whole time.

## 5. After approval

- [ ] Link the AdMob app to the store listing (§4). Yes, again — it is the one
      that gets missed.
- [ ] Watch the developer email. A Guideline 2.1 "Information Needed" message
      from Apple is a *question*, not a defect, and a version sits Rejected until
      someone answers it. Answers live in App Review Information → Notes.
- [ ] Confirm the live catalogue still serves: the app's narrator list comes from
      GitHub Pages at runtime, so a broken catalogue makes a shipped build look
      like it lost its narrators.

## Traps worth re-reading

- **`git push origin HEAD:main`, never `git push origin main`.** Work happens on
  a side branch here. Pushing a local `main` ref that has not moved is a
  successful no-op that reports success while the commit stays local. It
  stranded three commits once.
- **Windows reboots kill the render.** The queue dies with no line in
  `render.log`, so the symptom is silence, not an error. A Startup-folder entry
  restarts it at logon; if progress looks stalled, compare `LastBootUpTime`
  against the log before assuming a crash.
- **Say only what is true in store copy.** "Every chapter is narrated" shipped
  once while Bible in Basic English had no recording at all and fell back to the
  device voice. Re-check the claims whenever a narrator or translation changes.
