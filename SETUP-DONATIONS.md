# Donations — set up to keep the most money

Everything on the app side is built and tuned for maximum retention. There is one
step only you can do: **create the payment account.** That needs your identity
and bank details, so it is not something I can or should do for you — I have not
handled and will not ask for those.

Once you have a payment page URL, you paste it into one place and it goes live.

---

## The five levers, in order of how much money they keep

**1. Register as a nonprofit — by far the biggest.**
This is not a small optimisation. A registered 501(c)(3) gets:

| | For-profit | Nonprofit |
|---|---|---|
| Stripe | 2.9% + 30¢ | **2.2% + 30¢** |
| PayPal | 2.89% + 49¢ | **1.99% + 49¢**, or **0%** via PayPal Giving Fund |
| App Store / Play donations | **70%** (must use in-app purchase) | **~97%** (exempt) |

The app-store line is the one that matters most. As a for-profit developer, every
donation through an iOS or Android build loses 30% — with no way around it. As a
nonprofit you keep ~97% on the same donation, permanently. For an app whose whole
purpose is giving scripture away free, this is worth an accountant's time before
you submit to either store. Set `nonprofit: true` in the config once done.

**2. Monthly giving.** A recurring donor is worth several times a one-off, and it
is the difference between income and a handful of gifts. The Give tab now leads
with **Monthly** whenever monthly links exist, because whichever option is shown
first is the one most people take. This is the highest-value set of links to
create.

**3. Let donors cover the fee.** A "cover the processing fee" toggle is now on
the one-time tab. On a $10 gift it is the difference between $9.41 and the full
$10 arriving. It is off by default and clearly labelled optional — pre-ticking it
would be a dark pattern, and this audience would notice.

**4. Use Stripe or PayPal, not a tip platform.** Buy Me a Coffee takes 5% on top
of processing. Ko-fi takes 0% and is the fastest to set up, so it is a fine
starting point, but Stripe direct is the most professional result and you own the
customer relationship.

**5. The amounts start at $5, not $3.** The flat per-transaction fee is what
makes small gifts inefficient:

| Gift | You keep | % |
|---|---|---|
| $3 | $2.61 | 87.1% |
| **$5** | $4.55 | 91.1% |
| **$10** | $9.41 | 94.1% |
| **$25** | $23.98 | 95.9% |
| **$50** | $48.25 | 96.5% |

Presets are now $5 / $10 / $25 / $50. Raising the floor from $3 recovers four
points on the smallest gifts, and the higher ladder anchors people upward.

---

## Step 1 — Create the account

**Stripe** (recommended): sign up at <https://dashboard.stripe.com/register> and
complete activation with your business details and payout bank account.

**Ko-fi** (fastest, ~10 minutes): sign up at <https://ko-fi.com>, then connect
Stripe or PayPal under **Settings → Payments**.

**PayPal**: a **PayPal.me** link works immediately and accepts any amount.

---

## Step 2 — Create the payment pages

In Stripe: **Product catalogue → Payment links → Create link**.

| Link | Type | Priority |
|---|---|---|
| "Customers choose what to pay" | One-off, custom amount | **Required** — everything falls back to it |
| $5 / $10 / $25 / $50 | One-off, fixed price | Nice to have |
| $5 / $10 / $25 **monthly** | **Recurring** — set billing to monthly | **Highest value** |

Subscriptions need fixed prices, which is why monthly needs its own three links.

Use **Test mode** while setting up so nothing real is charged, then swap in the
live URLs before you ship.

---

## Step 3 — Paste them in

Open `js/monetize.js`, find the block marked **DONATION SETUP**:

```js
export const DONATIONS = {
  provider: 'stripe',

  custom: 'https://buy.stripe.com/...',            // the one that matters

  amounts: {
    5:  'https://buy.stripe.com/...',
    10: 'https://buy.stripe.com/...',
    25: 'https://buy.stripe.com/...',
    50: 'https://buy.stripe.com/...',
  },

  monthly: {
    5:  'https://buy.stripe.com/...',
    10: 'https://buy.stripe.com/...',
    25: 'https://buy.stripe.com/...',
  },

  offerFeeCover: true,
  nonprofit: false,        // set true once registered — it changes the maths
};
```

**The `custom` link alone is enough to start.** Anything left empty falls back to
it. Links must begin with `https://` or the app refuses them.

---

## Step 4 — Check it

Open the **Give** tab. It reports exactly where the setup stands:

- **"Setup — not receiving yet"** — nothing connected, buttons are in demo mode,
  nothing is charged.
- **"Setup — partly done"** — it lists precisely what is missing, including
  whether monthly links exist.
- **No setup card** — fully configured. The line under the amounts reads
  "Secure payment via Stripe — about 97% reaches the app".

Then tap an amount and confirm your real payment page opens.

---

## Two things to know

**The in-app donation total stays at zero until you add a webhook.** A card
payment cannot be confirmed from a browser, so the app deliberately does not
count a gift it cannot verify — telling someone they gave when the payment may
have failed is worse than showing nothing. To count them, have a backend listen
for Stripe's `checkout.session.completed`. The money reaches you either way; only
the counter waits.

**Never ship these links inside an iOS or Android build.** Both stores require
their own in-app purchase for donations to a for-profit developer, and linking
out is an automatic rejection. The app guards this two ways: set `PLATFORM_TARGET`
to `'ios'` or `'android'` for store builds, and runtime detection of a native
wrapper forces in-app purchase even if that flag is wrong. Both must say "web"
before an external link is ever offered.
