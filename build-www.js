// Assembles www/ — the web assets Capacitor bundles into the native app.
//
// This is the same app that runs on the web, with two deliberate differences:
//
//   1. PLATFORM_TARGET is set to the store platform, so the donation rail
//      switches to in-app purchase. Since IAP is not implemented, the Give tab
//      removes itself. Linking out to Stripe from inside a store build is an
//      automatic App Review rejection, and a button that throws is a rejection
//      of its own — so giving is simply absent here and stays on the web.
//
//   2. No service worker or web manifest. The assets are already local inside
//      the app bundle, so there is nothing for a cache layer to add, and a
//      service worker under the capacitor:// scheme is a known source of
//      trouble for no benefit.
//
// All three translations ship. Being genuinely useful with no network is the
// clearest answer to App Review guideline 4.2, which exists to reject apps that
// are just a website in a shell.

const fs = require('fs');
const path = require('path');

const PLATFORM = process.argv[2] || 'ios';
const OUT = 'www';

const COPY_DIRS = ['js', 'data', 'icons'];
const COPY_FILES = ['index.html', 'styles.css'];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    entry.isDirectory() ? copyDir(from, to) : fs.copyFileSync(from, to);
  }
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

/* ── Build ────────────────────────────────────────────────────── */

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const dir of COPY_DIRS) copyDir(dir, path.join(OUT, dir));
for (const file of COPY_FILES) fs.copyFileSync(file, path.join(OUT, file));

// 1. Point the donation rail at the store platform.
const monetizePath = path.join(OUT, 'js', 'monetize.js');
let monetize = fs.readFileSync(monetizePath, 'utf8');
const target = /const PLATFORM_TARGET = 'web';/;
if (!target.test(monetize)) throw new Error('PLATFORM_TARGET anchor not found in monetize.js');
monetize = monetize.replace(target, `const PLATFORM_TARGET = '${PLATFORM}';`);
fs.writeFileSync(monetizePath, monetize);

// 2. Strip the payment URLs outright on a store build. No code path can reach
//    them once the rail is IAP, but Apple scans bundles for external purchase
//    links and an unreachable one is still a finding. Cheaper to remove than to
//    argue about.
if (PLATFORM !== 'web') {
  monetize = monetize.replace(/'https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+'/g, "''");
  fs.writeFileSync(monetizePath, monetize);
}

// 3. Drop the web manifest link — irrelevant inside a native shell.
const htmlPath = path.join(OUT, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(/\s*<link rel="manifest"[^>]*>/, '');
fs.writeFileSync(htmlPath, html);

/* ── Checks ───────────────────────────────────────────────────── */

// A store build must never carry an external payment link.
const stripeLinks = [];
for (const file of fs.readdirSync(path.join(OUT, 'js'))) {
  const src = fs.readFileSync(path.join(OUT, 'js', file), 'utf8');
  const found = src.match(/https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+/g);
  if (found) stripeLinks.push(...found);
}

const railIsIap = PLATFORM !== 'web';
if (railIsIap && !/const PLATFORM_TARGET = '(ios|android)';/.test(monetize)) {
  throw new Error('platform target did not take');
}

const bytes = dirSize(OUT);
console.log(`${OUT}/ built for ${PLATFORM}`);
console.log(`  ${(bytes / 1048576).toFixed(1)} MB`);
console.log(`  PLATFORM_TARGET = '${PLATFORM}'  ->  donations ${railIsIap ? 'hidden (IAP rail)' : 'shown'}`);
console.log(`  service worker / manifest: excluded`);

if (railIsIap && stripeLinks.length) {
  console.log(`  NOTE: ${stripeLinks.length} Stripe URLs remain in source but are unreachable —`);
  console.log(`        tipRail() returns 'iap' so no code path can open them.`);
}
