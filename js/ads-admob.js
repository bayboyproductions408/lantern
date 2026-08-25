// AdMob banner for the native builds.
//
// This does not plug into the in-page ad slots, and it cannot: AdMob's banner
// is a native view the plugin overlays on top of the webview, not a DOM node
// that can be inserted into a container. So the two kinds of inventory live in
// different places, which suits them —
//
//   AdMob        one adaptive banner pinned to the bottom of the screen
//   direct-sold  the in-page slots, where the creative is ours and controlled
//
// Nothing here runs on the web build; there the slots carry house and
// direct-sold creatives only.

// The app ships as plain ES modules with no bundler, so a bare specifier like
// '@capacitor-community/admob' would not resolve in the browser. Capacitor
// registers every native plugin on a global, which is the accessible form
// here. The enum values below are the plugin's own string constants.
const plugin = () => window.Capacitor?.Plugins?.AdMob ?? null;

const ADAPTIVE_BANNER = 'ADAPTIVE_BANNER';
const BOTTOM_CENTER = 'BOTTOM_CENTER';
const EVENT_SIZE_CHANGED = 'bannerAdSizeChanged';
const EVENT_FAILED = 'bannerAdFailedToLoad';

/* ── Ad units ─────────────────────────────────────────────────── */

// Google's public test units. They always fill and earn nothing, which is
// exactly what is wanted until the real units exist: serving live ads to your
// own device during development — or worse, tapping one — is how AdMob
// accounts get suspended.
//
// Replace with the real unit from the AdMob console and set TESTING to false.
const TEST_BANNER = {
  ios: 'ca-app-pub-3940256099942544/2934735716',
  android: 'ca-app-pub-3940256099942544/6300978111',
};

const LIVE_BANNER = {
  ios: 'ca-app-pub-9072066961806430/4272820839',
  android: '',    // created when the Play build is registered
};

// Test mode stays on for TestFlight. Real ads served to your own device — and
// especially a tap on one — is invalid traffic, and it is the usual way AdMob
// accounts get suspended. This flips to false in the build that goes to the
// App Store, not before.
const TESTING = true;

// Non-personalised ads. This is a deliberate default, not an oversight: it
// avoids the App Tracking Transparency prompt entirely, keeps the app clear of
// the advertising identifier, and keeps the privacy disclosures honest and
// simple. It earns less than personalised inventory. Flip it only alongside
// adding an ATT prompt and updating the App Store privacy labels.
const NON_PERSONALISED = true;

/* ── State ────────────────────────────────────────────────────── */

let started = false;
let visible = false;

function platform() {
  const cap = window.Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return cap.getPlatform?.() ?? null;
}

function unitFor(p) {
  const table = TESTING ? TEST_BANNER : LIVE_BANNER;
  return table[p] || '';
}

export function supported() {
  const p = platform();
  return Boolean(p && unitFor(p) && plugin());
}

/* ── Layout ───────────────────────────────────────────────────── */

// The banner sits over the bottom of the webview, which is where the tab bar
// is. The plugin reports the height it actually used, so the app is padded by
// exactly that rather than by a guess that would be wrong on some devices.
function reserve(height) {
  document.documentElement.style.setProperty('--ad-banner-height', `${height || 0}px`);
  document.body.classList.toggle('has-ad-banner', Boolean(height));
}

/* ── Lifecycle ────────────────────────────────────────────────── */

export async function start() {
  if (started || !supported()) return false;
  started = true;

  try {
    const admob = plugin();
    await admob.initialize({ initializeForTesting: TESTING });

    admob.addListener(EVENT_SIZE_CHANGED, info => {
      reserve(Number(info?.height) || 0);
    });
    // A failed load must not leave a gap where no ad is showing.
    admob.addListener(EVENT_FAILED, () => reserve(0));

    await show();
    return true;
  } catch {
    // Ads must never take the reader down with them.
    started = false;
    reserve(0);
    return false;
  }
}

export async function show() {
  const p = platform();
  const admob = plugin();
  if (!p || !admob || visible) return;
  try {
    await admob.showBanner({
      adId: unitFor(p),
      adSize: ADAPTIVE_BANNER,
      position: BOTTOM_CENTER,
      isTesting: TESTING,
      npa: NON_PERSONALISED,
      margin: 0,
    });
    visible = true;
  } catch {
    reserve(0);
  }
}

export async function hide() {
  if (!visible) return;
  try { await plugin()?.hideBanner(); } catch { /* nothing to hide */ }
  visible = false;
  reserve(0);
}

/** True once a banner is actually on screen. */
export function isShowing() {
  return visible;
}
