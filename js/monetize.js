// Monetization: advertising, plus a voluntary tip jar.
//
// PRODUCT RULE: the app is free for everyone, in full. There is no subscription,
// no premium tier, no feature gate and no account. Every translation, every
// reading plan, every voice, offline download, unlimited bookmarks and an
// uncapped sleep timer are available to every listener. Advertising carries the
// entire business, so the ad code below is the revenue engine and is built
// accordingly — viewability-aware, refreshed on a timer, and never intrusive.
//
// The tip jar stays because it withholds nothing from anyone: it is a way for
// people who want to give to do so, not a way to unlock anything.

import * as store from './store.js';

/* ── Ad placements ────────────────────────────────────────────── */

// `refreshSeconds: 0` means render once and leave it alone.
//
// Only the player slot refreshes. Listening sessions run long — twenty minutes
// and up — so one static banner would earn a single impression for the whole
// session. A 60-second refresh on a *visible* slot is the standard interval
// permitted by AdSense and AdMob, and it is where most of the revenue lives.
export const PLACEMENTS = {
  player: { id: 'player', refreshSeconds: 60, label: 'Player banner' },
  chapterEnd: { id: 'chapterEnd', refreshSeconds: 0, label: 'End of chapter' },
  library: { id: 'library', refreshSeconds: 0, label: 'Library' },
  search: { id: 'search', refreshSeconds: 0, label: 'Search results' },
};

/* ── House inventory ──────────────────────────────────────────── */

// Shown when the network has no fill, which is a routine occurrence — often
// 5–20% of requests. Without house ads those slots collapse to blank space, so
// this inventory is what keeps the layout intact and earns something anyway.
// Each creative declares when it can actually be delivered. A house ad whose
// button cannot do what it says is worse than an empty slot: on a store build
// it reads as a broken feature, which is a straightforward App Review
// rejection under guideline 2.1.
const HOUSE_ADS = [
  {
    title: 'Keep Lantern free for everyone',
    body: 'No subscription, no locked chapters. Gifts and ads pay the bills.',
    cta: 'Give',
    action: 'tip',
    // Absent from store builds, where there is nowhere for the button to go.
    available: () => donationsAvailable(),
  },
  {
    title: 'Support with a short video',
    body: 'Watch one advert on purpose instead of a dozen in passing.',
    cta: 'Watch',
    action: 'rewarded',
    // With no ad network wired up there is no video to play, and promising one
    // then showing nothing is exactly the sort of thing review looks for.
    available: () => !isHouseOnly(),
  },
  {
    title: 'Read the whole Bible this year',
    body: 'A paced daily plan, about 14 minutes of listening a day.',
    cta: 'Start',
    action: 'plans',
    available: () => true,
  },
  {
    title: 'Listen anywhere',
    body: 'Save every translation to your device and listen with no signal.',
    cta: 'Download',
    action: 'offline',
    // Native builds already carry the scripture in the app bundle, so there is
    // nothing left to download.
    available: () => !detectedNative() && PLATFORM_TARGET === 'web',
  },
];

let houseCursor = 0;

function nextHouseAd() {
  const usable = HOUSE_ADS.filter(ad => ad.available());
  if (!usable.length) return null;
  return usable[houseCursor++ % usable.length];
}

/* ── Direct-sold sponsorship ──────────────────────────────────── */

// Inventory sold directly to a sponsor rather than through a network. This is
// the highest-value slot in the app: sold direct it fetches roughly $15–25 CPM
// against about $2.50 programmatic, and you keep control of exactly what appears
// beside scripture — which is worth as much as the money.
//
// Add campaigns here and they take priority over the network. Buyers worth
// approaching: churches, Christian publishers, seminaries, worship labels,
// counselling services.
const DIRECT_CAMPAIGNS = [
  // {
  //   id: 'grace-chapel-2026-09',
  //   advertiser: 'Grace Chapel',
  //   title: 'Sundays at Grace Chapel',
  //   body: 'Two services every Sunday in Pasadena. All are welcome.',
  //   cta: 'Visit',
  //   url: 'https://example.org',
  //   placements: ['player', 'chapterEnd'],
  //   start: '2026-09-01',
  //   end: '2026-09-30',
  //   weight: 1,
  // },
];

/** An eligible campaign for this placement today, chosen by weight. */
function pickDirect(placementId) {
  const today = new Date().toISOString().slice(0, 10);
  const eligible = DIRECT_CAMPAIGNS.filter(c =>
    c.placements.includes(placementId) &&
    (!c.start || c.start <= today) &&
    (!c.end || c.end >= today));

  if (!eligible.length) return null;

  const total = eligible.reduce((n, c) => n + (c.weight ?? 1), 0);
  let roll = Math.random() * total;
  for (const campaign of eligible) {
    roll -= campaign.weight ?? 1;
    if (roll <= 0) return campaign;
  }
  return eligible[0];
}

export function directCampaignCount() {
  return DIRECT_CAMPAIGNS.length;
}

/* ── Ad network adapter ───────────────────────────────────────── */

// Swap ACTIVE_NETWORK once an account exists. Every adapter returns a DOM node
// or null for no-fill; the slot machinery handles the fallback.
const AD_NETWORKS = {
  /** Serves only the house inventory. Correct behaviour, zero revenue. */
  house: {
    label: 'House ads only (no network connected)',
    async request() {
      return null; // always no-fill, so the house creative renders
    },
  },

  // adsense: for the web build. Insert the <ins class="adsbygoogle"> element
  //   with your data-ad-client / data-ad-slot, then call
  //   (adsbygoogle = window.adsbygoogle || []).push({}). Requires the AdSense
  //   script tag in index.html and a site review before it serves live ads.
  //
  // admob: for the Capacitor-wrapped build. Use @capacitor-community/admob —
  //   BannerAd.show() for the player slot and RewardedAd for the opt-in video.
  //   AdMob pays materially better than AdSense on mobile inventory, and the
  //   AdMob account already set up for Flappy Birdies can carry this app too.
};

const ACTIVE_NETWORK = 'house';

export function networkLabel() {
  return AD_NETWORKS[ACTIVE_NETWORK].label;
}

export function isHouseOnly() {
  return ACTIVE_NETWORK === 'house';
}

/* ── Impression accounting ────────────────────────────────────── */

export function recordImpression() {
  const ads = store.get().ads;
  store.set({ ads: { ...ads, impressions: ads.impressions + 1 } });
}

export function recordRewarded() {
  const ads = store.get().ads;
  store.set({ ads: { ...ads, rewarded: ads.rewarded + 1 } });
}

export function adStats() {
  return store.get().ads;
}

/* ── Ad slot ──────────────────────────────────────────────────── */

const liveSlots = new Set();

/**
 * A single ad position on screen.
 *
 * Refreshes only while genuinely on screen and while the tab is in the
 * foreground. An impression nobody could have seen is worthless to an
 * advertiser and, once a network is connected, actively harmful — invalid
 * traffic is the fastest way to get an ad account suspended.
 */
class AdSlot {
  constructor(el, placement, onAction) {
    this.el = el;
    this.placement = placement;
    this.onAction = onAction;
    this.visible = false;
    this.timer = null;

    this.observer = new IntersectionObserver(
      entries => {
        this.visible = entries[0].isIntersecting;
        this.visible ? this.start() : this.stop();
      },
      { threshold: 0.5 }
    );
    this.observer.observe(el);

    this.onVisibility = () => (document.hidden ? this.stop() : this.visible && this.start());
    document.addEventListener('visibilitychange', this.onVisibility);

    this.render();
    liveSlots.add(this);
  }

  start() {
    if (this.timer || document.hidden || !this.placement.refreshSeconds) return;
    this.timer = setInterval(() => this.render(), this.placement.refreshSeconds * 1000);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async render() {
    // Direct-sold first — it pays several times what the network does and is
    // the only inventory whose content you actually control.
    const direct = pickDirect(this.placement.id);
    if (direct) {
      this.el.innerHTML = '';
      this.el.append(this.directCreative(direct));
      recordImpression();
      return;
    }

    let creative = null;
    try {
      creative = await AD_NETWORKS[ACTIVE_NETWORK].request(this.placement);
    } catch {
      creative = null; // a network error must never break the reader
    }

    this.el.innerHTML = '';
    const filled = creative || this.houseCreative();

    // Nothing to show: collapse the slot rather than leaving a labelled but
    // empty box beside the scripture, and do not count an impression for an
    // advert nobody saw.
    this.el.hidden = !filled;
    if (!filled) return;

    this.el.append(filled);
    recordImpression();
  }

  directCreative(campaign) {
    const wrap = document.createElement('div');
    wrap.className = 'ad';

    const body = document.createElement('div');
    body.className = 'ad-body';

    const label = document.createElement('span');
    label.className = 'ad-label';
    label.textContent = `Sponsored by ${campaign.advertiser}`;

    const title = document.createElement('b');
    title.textContent = campaign.title;

    const copy = document.createElement('small');
    copy.textContent = campaign.body;

    body.append(label, title, copy);

    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = campaign.cta;
    btn.addEventListener('click', () => window.open(campaign.url, '_blank', 'noopener'));

    wrap.append(body, btn);
    return wrap;
  }

  houseCreative() {
    const ad = nextHouseAd();
    if (!ad) return null;

    const wrap = document.createElement('div');
    wrap.className = 'ad';

    const body = document.createElement('div');
    body.className = 'ad-body';

    const label = document.createElement('span');
    label.className = 'ad-label';
    label.textContent = 'Sponsored';

    const title = document.createElement('b');
    title.textContent = ad.title;

    const copy = document.createElement('small');
    copy.textContent = ad.body;

    body.append(label, title, copy);

    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = ad.cta;
    btn.addEventListener('click', () => this.onAction?.(ad.action));

    wrap.append(body, btn);
    return wrap;
  }

  destroy() {
    this.stop();
    this.observer.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    liveSlots.delete(this);
  }
}

const slotsByElement = new WeakMap();

/** Mounts (or re-mounts) an ad slot on an element. */
export function mountAdSlot(el, placement, onAction) {
  if (!el) return null;
  slotsByElement.get(el)?.destroy();
  const slot = new AdSlot(el, placement, onAction);
  slotsByElement.set(el, slot);
  return slot;
}

export function destroyAdSlot(el) {
  slotsByElement.get(el)?.destroy();
  slotsByElement.delete(el);
}

/* ── Rewarded video ───────────────────────────────────────────── */

// Opt-in, never triggered automatically. This is the single highest-value ad
// format — rewarded eCPMs run several times a banner's — and it generates no
// resentment precisely because the listener chose it. Here it rewards nothing
// but the knowledge that it helped, since there is nothing locked to unlock.
export async function showRewardedVideo() {
  // A real build hands off to AdMob RewardedAd / AdSense rewarded here and
  // resolves on the reward callback.
  await new Promise(r => setTimeout(r, 1200));
  recordRewarded();
  return { rewarded: true, simulated: isHouseOnly() };
}

/* ── Tips ─────────────────────────────────────────────────────── */

export const TIP_AMOUNTS = [5, 10, 25, 50];
export const MONTHLY_AMOUNTS = [5, 10, 25];

// ── Choosing a rail ──────────────────────────────────────────────
//
// Which payment rail is allowed is decided by where the app is running, not by
// preference:
//
//   Web / installed PWA → Stripe. ~2.9% + 30¢, so about 97% reaches you. This
//     is by far the best economics and is what the app uses today.
//
//   iOS App Store → Apple requires In-App Purchase for tips to a for-profit
//     developer: 30%, or 15% under the Small Business Program (under $1M/yr).
//     Linking out to Stripe or PayPal from inside an iOS build is a guaranteed
//     rejection, so the rail switches automatically when wrapped.
//
//   Google Play → the same, with the same rates.
//
//   Registered nonprofits are the exception on BOTH stores: an approved
//     501(c)(3) may collect donations by other means and keep ~97%. Given what
//     this app is for, that route is worth looking into — it is the difference
//     between keeping 70% and keeping 97% of every gift.
//
// ═══════════════════════════════════════════════════════════════════
//  DONATION SETUP — this is the only block you need to edit to go live.
//  Full walkthrough in SETUP-DONATIONS.md.
// ═══════════════════════════════════════════════════════════════════
//
// Every supported provider works the same way: it gives you a hosted payment
// page at a URL, and the app opens it. No backend, no API keys in the client,
// nothing secret shipped to the browser.
//
// Paste your links below and the Give tab goes live automatically. Leave them
// empty and it stays in demo mode, where nothing is charged.
export const DONATIONS = {
  // 'stripe' | 'paypal' | 'kofi' | 'buymeacoffee'
  provider: 'stripe',

  // The one link you genuinely need: a 'customer chooses what to pay' page.
  // Every amount can fall back to it, so donations work with this alone.
  //
  // These are LIVE Stripe links - real money moves through them.
  custom: 'https://buy.stripe.com/7sYcN69YH2Or1k73nUaZi00',

  // Fixed-price one-off pages.
  amounts: {
    5: 'https://buy.stripe.com/9B64gA9YHex97Iv7EaaZi04',
    10: 'https://buy.stripe.com/9B6eVedaT74He6T2jQaZi05',
    25: 'https://buy.stripe.com/7sYcN6b2L4Wzgf13nUaZi06',
    50: 'https://buy.stripe.com/5kQ3cw5IrfBdd2P3nUaZi07',
  },

  // Monthly subscriptions - the highest-value links here.
  monthly: {
    5: 'https://buy.stripe.com/28E14o3Aj60D9QD0bIaZi01',
    10: 'https://buy.stripe.com/aFacN64En88L0g3aQmaZi02',
    25: 'https://buy.stripe.com/3cIaEYb2L0Gj1k7cYuaZi03',
  },

  // Whether to offer the donor the option of covering the processing fee.
  offerFeeCover: true,

  // If you have registered as a nonprofit, set this — it lowers the fee shown
  // and, more importantly, it is the single biggest thing you can do for how
  // much of each gift you keep. See SETUP-DONATIONS.md.
  nonprofit: false,
};

/* ── Fee model ────────────────────────────────────────────────── */

// Percentage plus a flat per-transaction charge. The flat part is what makes
// small gifts inefficient, and is the whole reason the presets start at $5.
const FEE_MODELS = {
  stripe: { percent: 0.029, flat: 0.30, nonprofitPercent: 0.022 },
  paypal: { percent: 0.0289, flat: 0.49, nonprofitPercent: 0.0199 },
  kofi: { percent: 0.029, flat: 0.30, nonprofitPercent: 0.022 },
  buymeacoffee: { percent: 0.079, flat: 0.30, nonprofitPercent: 0.079 },
};

function feeModel() {
  const model = FEE_MODELS[DONATIONS.provider] ?? FEE_MODELS.stripe;
  const percent = DONATIONS.nonprofit ? model.nonprofitPercent : model.percent;
  return { percent, flat: model.flat };
}

/** What actually reaches the app from a gift of `amount`. */
export function netFrom(amount) {
  const { percent, flat } = feeModel();
  return Math.max(0, amount - (amount * percent + flat));
}

/** What the donor pays so that exactly `amount` reaches the app. */
export function grossFor(amount) {
  const { percent, flat } = feeModel();
  return Math.ceil(((amount + flat) / (1 - percent)) * 100) / 100;
}

export function feeSummary() {
  const { percent, flat } = feeModel();
  return `${(percent * 100).toFixed(2)}% + ${Math.round(flat * 100)}¢`;
}

export const DONATION_PROVIDERS = {
  stripe: {
    label: 'Stripe',
    keeps: 'about 97%',
    fee: '2.9% + 30¢',
    note: 'Best rate. Needs a Stripe account and a bank account.',
  },
  paypal: {
    label: 'PayPal',
    keeps: 'about 97%',
    fee: '2.89% + 49¢',
    note: 'Familiar to donors. A PayPal.me link works, and registered charities pay no fee.',
  },
  kofi: {
    label: 'Ko-fi',
    keeps: 'about 97%',
    fee: '0% platform fee',
    note: 'Fastest to set up. Ko-fi takes nothing on one-off gifts; only the processor charges.',
  },
  buymeacoffee: {
    label: 'Buy Me a Coffee',
    keeps: 'about 92%',
    fee: '5% platform fee',
    note: 'Very quick to set up, but the platform fee is the highest here.',
  },
};

function linkFor(amount, { monthly = false, feeCovered = false } = {}) {
  if (monthly) return DONATIONS.monthly[amount] || '';
  // A fee-covered gift is not one of the fixed prices, so it has to go through
  // the choose-your-own page with the exact figure shown to the donor.
  if (feeCovered) return DONATIONS.custom || '';
  return (amount != null && DONATIONS.amounts[amount]) || DONATIONS.custom || '';
}

/**
 * Whether donations are actually wired up, and what is missing if not.
 * Surfaced in the Give tab so a half-finished setup is never mistaken for a
 * working one.
 */
export function donationStatus() {
  const provider = DONATION_PROVIDERS[DONATIONS.provider];
  const presets = Object.values(DONATIONS.amounts).filter(Boolean).length;
  const monthly = Object.values(DONATIONS.monthly).filter(Boolean).length;
  const hasCustom = Boolean(DONATIONS.custom);

  const missing = [];
  if (!provider) missing.push(`Unknown provider "${DONATIONS.provider}"`);
  if (!hasCustom) missing.push('No "choose your own amount" link — this is the one that matters');
  if (presets < TIP_AMOUNTS.length) {
    missing.push(`${TIP_AMOUNTS.length - presets} of ${TIP_AMOUNTS.length} one-off amounts have no link`);
  }
  if (!monthly) missing.push('No monthly links — recurring gifts are worth several times a one-off');

  const all = { ...DONATIONS.amounts, ...DONATIONS.monthly, custom: DONATIONS.custom };
  const bad = Object.entries(all)
    .filter(([, url]) => url && !/^https:\/\//.test(url))
    .map(([key]) => key);
  if (bad.length) missing.push(`Not an https link: ${bad.join(', ')}`);

  return {
    ready: (hasCustom || presets > 0) && !bad.length,
    provider: provider?.label ?? DONATIONS.provider,
    providerInfo: provider ?? null,
    presets,
    monthly,
    hasCustom,
    monthlyReady: monthly > 0,
    nonprofit: DONATIONS.nonprofit,
    fee: feeSummary(),
    missing,
  };
}

export function canCoverFee() {
  return DONATIONS.offerFeeCover && Boolean(DONATIONS.custom);
}

// Set this for the build you are shipping. It is the primary guard, because a
// build flag cannot fail the way runtime detection can.
//
//   'web'     — browser or installed PWA. Stripe is permitted and is the best
//               option available: about 97% of each tip reaches you.
//   'ios'     — App Store build. In-app purchase only. Linking out to Stripe or
//               PayPal from inside an iOS build is a guaranteed rejection.
//   'android' — Play Store build. Play Billing only.
const PLATFORM_TARGET = 'web';

function detectedNative() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

/**
 * Chooses the payment rail.
 *
 * Fails safe: EITHER the build flag or runtime detection saying "native" is
 * enough to force in-app purchase. Getting this wrong in the permissive
 * direction costs an App Store rejection, so both signals must say "web"
 * before an external payment link is ever offered.
 */
export function tipRail() {
  if (PLATFORM_TARGET !== 'web' || detectedNative()) return 'iap';
  if (donationStatus().ready) return 'link';
  return 'sandbox';
}

/**
 * Whether donations can be offered at all in this build.
 *
 * Apple and Google require their own in-app purchase for donations to a
 * for-profit developer, and linking out to Stripe from inside a store build is
 * an automatic rejection. Until IAP is actually implemented, a wrapped build
 * hides giving entirely rather than shipping a button that cannot work -- a
 * broken feature is its own rejection under App Review guideline 2.1.
 */
export function donationsAvailable() {
  return tipRail() !== 'iap';
}

export function tipRailLabel() {
  const rail = tipRail();
  if (rail === 'iap') return 'In-app purchase, as the app stores require';
  if (rail === 'sandbox') return 'Demo mode — no payment is taken and no card is charged';
  const status = donationStatus();
  return `Secure payment via ${status.provider} — ${status.providerInfo?.keeps ?? 'most'} reaches the app`;
}

/**
 * Starts a tip.
 *
 * Stripe returns `pending`: a card payment cannot be confirmed from the client,
 * so nothing is recorded as given until a webhook confirms it. Counting an
 * unconfirmed payment would be lying to the user about their own generosity.
 */
export async function tip(amount, options = {}) {
  const rail = tipRail();

  if (rail === 'link') {
    const url = linkFor(amount, options);
    if (!url) {
      throw new Error(options.monthly
        ? 'Monthly giving is not set up yet.'
        : 'No payment page is set up for that amount yet.');
    }
    window.open(url, '_blank', 'noopener');
    return { amount, pending: true, rail, ...options };
  }

  if (rail === 'iap') {
    // Wrapped builds hand off to RevenueCat / StoreKit with consumable
    // products named lantern.tip.3, lantern.tip.7 and so on.
    throw new Error('In-app purchase is not wired up in this build yet.');
  }

  await new Promise(r => setTimeout(r, 900));
  const receipt = { amount, at: Date.now(), sandbox: true };
  const giving = store.get().giving;
  store.set({ giving: { tips: [...giving.tips, receipt] } });
  return receipt;
}

export function totalTipped() {
  return store.get().giving.tips.reduce((sum, t) => sum + t.amount, 0);
}

/* ── Chapter dedications ──────────────────────────────────────── */

// Dedicating a reading — "in memory of", "for my mother" — earns money without
// anyone feeling sold to, because it reads as a feature rather than a
// transaction. It suits this audience far better than a banner ever will.

export const DEDICATION_AMOUNTS = [10, 25, 50];

export async function dedicateChapter({ book, chapter, ref, name, message, amount }) {
  if (!name?.trim()) throw new Error('Please enter a name for the dedication.');

  const result = await tip(amount);
  // A pending card payment must not create a dedication that was never paid for.
  if (result.pending) return result;

  const dedication = {
    id: `${book}-${chapter}-${Date.now()}`,
    book, chapter, ref,
    name: name.trim().slice(0, 60),
    message: (message || '').trim().slice(0, 140),
    amount,
    at: Date.now(),
  };
  store.set({ dedications: [dedication, ...store.get().dedications] });
  return { ...result, dedication };
}

export function dedicationFor(book, chapter) {
  return store.get().dedications.find(d => d.book === book && d.chapter === chapter) || null;
}

export function dedications() {
  return store.get().dedications;
}

export function tipCount() {
  return store.get().giving.tips.length;
}
