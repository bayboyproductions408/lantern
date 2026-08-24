# Monetizing Lantern

**Lantern is free for everyone, in full, forever.** No subscription, no premium
tier, no feature gate, no account. Every translation, every reading plan, every
voice, offline download, unlimited bookmarks and an uncapped sleep timer are
available to every listener from the first launch.

Advertising carries the entire business. Nobody pays to hear the Bible.

That decision costs revenue per user and buys three things back: the widest
possible install base, no moral objection from an audience that reacts badly to
paying for scripture, and no paywall-related reviews — which are the reviews that
permanently damage a rating.

---

## 1. What is built

| Channel | Status | Where |
|---|---|---|
| Four ad placements, viewability-aware | Working | `js/monetize.js` |
| 60-second refresh on the player banner | Working, verified | `AdSlot.start()` |
| **Direct-sold sponsorship, priority over network** | Working, none sold yet | `DIRECT_CAMPAIGNS` |
| House-ad fallback for no-fill | Working | `HOUSE_ADS` |
| Opt-in rewarded video | Working, simulated | `showRewardedVideo()` |
| Give tab with tips | Working, sandbox payment | `tip()` |
| **Chapter dedications** | Working | `dedicateChapter()` |
| Impression + contribution accounting | Working | `adStats()` |

Two growth levers were added alongside these, and in an ads-only model growth
*is* monetization: **Spanish** (Reina-Valera 1909, a large and underserved
market), and a **daily verse reminder** plus **shareable verse cards**, which
drive the sessions and installs that the ad revenue is a linear function of.

No ad network is connected yet — `ACTIVE_NETWORK = 'house'`, so only house
creatives serve. Gifts are simulated and no payment is taken.

### The placements

| Slot | Where | Refresh |
|---|---|---|
| `player` | Below the transport controls | 60s |
| `chapterEnd` | After the last verse, never inside the reading | once |
| `library` | After the first genre group | once |
| `search` | After the fifth result | once |

**The player banner is the whole business.** Listening sessions run twenty
minutes and up, so a static banner would earn one impression for an entire
session. Refreshing a *visible* slot every 60 seconds — the minimum interval both
AdSense and AdMob permit — is the difference between one impression and a dozen.

The slot refreshes only while it is genuinely on screen (IntersectionObserver at
a 0.5 threshold) **and** the tab is in the foreground. This is not politeness. An
impression nobody could have seen is worthless to the advertiser and counts as
invalid traffic, which is the fastest way to get an ad account suspended.

---

## 2. Realistic revenue

**Assumptions for sizing, not projections.** At **50,000 monthly active users**:

| Line | Assumption | Per month |
|---|---|---|
| Programmatic banners | 12 sessions/user, ~5 viewable impressions each = 3.0M impressions at $2.50 eCPM | **$7,500** |
| Rewarded video | 5% participate, 4 views each = 10k views at $15 eCPM | **$150** |
| Tips | 0.35% give, $9 average, less fees | **$1,500** |
| | | **≈ $9,150** |

Three honest observations:

**Rewarded video will not move the needle.** At any believable participation rate
it is worth a couple of hundred dollars. Keep it — it costs nothing and gives
people who want to help a way to do it — but do not build a strategy on it.

**Scale is now the entire game.** With no paying tier, revenue is close to linear
in MAU. At 5,000 users this model earns about $900/month. At 500,000 it earns
about $90,000. There is no middle path where a small dedicated audience pays the
bills — that was the option the subscription provided, and it is gone by choice.

**Retention features are now revenue features.** Streaks, plans, resume-position
and the sleep timer are what produce sessions, and sessions are what produce
impressions. Every hour spent making the app stickier now has a direct payoff.

---

## 3. The real upside: sell the inventory directly

Programmatic is the floor, not the ceiling. Banner eCPM of $2.50 is what you get
for letting a network decide what appears. Sold directly, the same slot goes for
**$15–25 CPM** — six to ten times more — because the buyer is paying for a
specific, engaged, brand-safe audience rather than a demographic bucket.

Who buys it: Christian publishers, seminaries, worship-music labels, counselling
services, local megachurches, ministry non-profits. These are advertisers who
actively want this audience and currently struggle to reach it.

At 50k MAU, selling even 20% of inventory direct at $18 CPM adds roughly
**$10,800/month** — more than doubling total revenue, with no change to the
listener's experience. This is the single highest-value thing on the list and it
is a sales problem, not an engineering one. The slot already exists.

**Church sponsorship** is the same idea at local scale: "Today's reading is
brought to you by ⟨church⟩" for a flat monthly fee. It keeps the app free, it is
on-brand, and it is a relationship sale rather than a funnel.

---

## 4. Receiving tips

There is a **Give** tab in the app with the message that we will never charge
anyone to read or hear the Bible, and that tips are appreciated and go into
improving the app and spreading the word of God. Four preset amounts, an "other
amount" option, and three non-financial ways to help.

**Which payment rail you may use is decided by where the app runs, not by
preference.** This trips up almost everyone:

| Where | Rail you must use | You keep |
|---|---|---|
| Web / installed PWA | **Stripe** | ~97% (2.9% + 30¢) |
| iOS App Store | Apple In-App Purchase | 70%, or **85%** under the Small Business Program |
| Google Play | Google Play Billing | 70%, or **85%** under 15% tier |
| Either store, as a registered nonprofit | Stripe or any processor | **~97%** |

Linking out to Stripe or PayPal from inside an iOS build is a **guaranteed
rejection**. `tipRail()` in `js/monetize.js` detects a Capacitor wrapper and
switches rails automatically, so this cannot be got wrong by accident.

### Recommended: Stripe Payment Links

For the web build this is the best option available, and it needs no backend and
no API key in the client:

1. In the Stripe Dashboard, create a Payment Link for each amount ($3, $7, $15,
   $40) plus one "customer chooses what to pay" link.
2. Paste the five URLs into `STRIPE_LINKS` in `js/monetize.js`.
3. Done — the Give tab switches from demo mode to live automatically.

Stripe charges **2.9% + 30¢ per payment**, no monthly fee. On a $7 tip you keep
about $6.50. Note that the flat 30¢ hurts small tips disproportionately — a $3
tip nets $2.61 — which is why the presets start at $3 rather than $1.

**Nothing is counted as given until it is confirmed.** A card payment cannot be
verified from the browser, so `tip()` returns `pending` for the Stripe rail and
the total shown in the app does not move. Counting an unconfirmed payment would
be telling the user something false about their own generosity. To record tips
properly, add a Stripe webhook on `checkout.session.completed`.

### Worth investigating: nonprofit status

Both Apple and Google carve out an exception for registered nonprofits, who may
collect **donations** through ordinary payment processing instead of in-app
purchase. For an app whose entire purpose is giving away scripture, that is a
plausible route — and it is the difference between keeping 70% and keeping 97%
of every gift, on both stores, permanently. Worth a conversation with an
accountant before submitting to either store.

---

## 5. Connecting a network

`js/monetize.js` has an `AD_NETWORKS` object and an `ACTIVE_NETWORK` constant.
Each adapter returns a DOM node, or `null` for no-fill — the house creative then
renders automatically, which is why the layout never collapses.

**AdSense** for the web build. Insert the `<ins class="adsbygoogle">` element with
your client and slot IDs and push to `adsbygoogle`. Needs the script tag in
`index.html` and a site review before live ads serve.

**AdMob** for the Capacitor-wrapped build, via
`@capacitor-community/admob` — `BannerAd` for the player slot and `RewardedAd`
for the opt-in video. AdMob pays materially better than AdSense on mobile
inventory, and the AdMob account already running for Flappy Birdies can carry
this app too.

Expect a policy review. Religious content is brand-safe and generally approved
without difficulty, but the app must not place ads where they could be mistaken
for content — which is why no slot sits inside the reader.

---

## 6. Rules that keep ads from angering people

These are the difference between an ad-supported app people tolerate and one they
uninstall.

- **Never audio ads.** An advert interrupting a reading of the Psalms would do
  more damage than every banner combined earns.
- **Never interstitials**, especially not on launch. The promise is "open it and
  press play".
- **Never inside the reader.** Ads sit after the chapter, not between verses.
- **Never on the sleep surface.** Someone falling asleep to scripture is not an
  impression opportunity.
- **Nothing that looks like content.** The `Sponsored` label stays.
- **One slot per screen.** Density is where ad-supported apps go wrong.

If a network starts serving something inappropriate next to scripture — gambling,
weight loss, anything predatory — block those categories in the network console
immediately. A screenshot of a bad ad beside a Bible verse spreads further than
any marketing you will ever buy.

---

## 7. Chapter dedications

Someone can dedicate a reading — "in memory of", "for my mother" — at $10, $25 or
$50. The dedication then appears above that chapter whenever they open it.

This is the one revenue line here that people are likely to feel *good* about
paying for, because it reads as a feature rather than a transaction, and because
it attaches money to something that already matters to them. It suits a
devotional audience far better than any banner will.

Currently the dedication is stored on the device, so it is private to the person
who gave it. Two obvious extensions once there is a backend: make dedications
public so a chapter can carry many, and let one be given as a gift to someone
else — which is both a better product and a free acquisition channel.

---

## 8. What to do next, in order

1. **Ship it and grow MAU.** Nothing else matters until there is an audience;
   the model is linear in users.
2. **Connect AdMob and wrap with Capacitor.** Mobile inventory pays better, the
   stores are where the audience is, and wrapping also fixes background audio and
   makes daily reminders reliable.
3. **Sell one direct sponsorship.** Even a single church or publisher proves the
   rate and is worth more than thousands of programmatic impressions. The slot
   already exists — `DIRECT_CAMPAIGNS` takes an entry and serves it ahead of the
   network.
4. **Add more languages.** Portuguese and the other public-domain texts run
   through the same pipeline as Spanish did. Each one multiplies the audience
   that the whole model scales with.
5. **Keep the Give tab visible but quiet.** It is worth real money and costs
   nobody anything.
6. **Invest in retention.** Sessions are the product now.
