// Builds a signed Android bundle ready for Play, in one command.
//
//   npm run android:release              test ads (default)
//   npm run android:release -- --live    live ads
//
// This exists so shipping Android never depends on CI. The release workflow
// needs four repository secrets to be pasted in before it can sign anything;
// this path signs locally from the keystore already on the machine, so a
// release can go out today and the secrets stay a convenience rather than a
// blocker.
//
// Every check the workflow runs is repeated here, because a local build that
// skips them is how an unsigned or test-ad bundle reaches Play.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const LIVE = process.argv.includes('--live');
const JAVA_HOME = process.env.JAVA_HOME || 'C:/Dom/Claude/dev-tools/jdk21/jdk-21.0.12.1+1';
const ANDROID_HOME = process.env.ANDROID_HOME || 'C:/Dom/Claude/dev-tools/android-sdk';
const AAB = 'android/app/build/outputs/bundle/release/app-release.aab';
const TEST_APP_ID = 'ca-app-pub-3940256099942544~3347511713';

function run(cmd, args, opts = {}) {
  // Joined into one string rather than passed as an args array: with shell
  // enabled Node concatenates them anyway and warns about it, and npx needs
  // the shell on Windows.
  const r = spawnSync([cmd, ...args].join(' '), [], {
    stdio: 'inherit', shell: true,
    env: { ...process.env, JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME },
    ...opts,
  });
  if (r.status !== 0) {
    console.error(`\nfailed: ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
}

function die(msg) { console.error(`\n${msg}`); process.exit(1); }

// Capacitor 8 will not compile on Java 17 - it fails with "invalid source
// release: 21" well into the build, which is a slow way to learn this.
const javaVersion = spawnSync(path.join(JAVA_HOME, 'bin', 'java.exe'), ['-version'],
  { encoding: 'utf8' });
const vtext = (javaVersion.stderr || '') + (javaVersion.stdout || '');
const major = Number((vtext.match(/version "(\d+)/) || [])[1]);
if (!major) die(`could not run java from JAVA_HOME=${JAVA_HOME}`);
if (major < 21) die(`Capacitor 8 needs Java 21; JAVA_HOME points at Java ${major}`);

console.log(`\nBuilding Lantern for Play — ads: ${LIVE ? 'LIVE' : 'test'}\n`);

run('node', ['build-www.js', 'android'], { env: { ...process.env, LANTERN_ADS: LIVE ? 'live' : 'test' } });

// The rewrite is done by build-www.js; this proves it actually landed.
const admob = fs.readFileSync('www/js/ads-admob.js', 'utf8');
if (LIVE && /const TESTING = true;/.test(admob)) {
  die('live ads requested but the bundle still has test mode on');
}
if (!LIVE && !/const TESTING = true;/.test(admob)) {
  die('test ads requested but the bundle has test mode off');
}

const manifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
if (LIVE && manifest.includes(TEST_APP_ID)) {
  die('live ads requested but AndroidManifest.xml still has the AdMob TEST application id');
}

run('npx', ['cap', 'sync', 'android']);
// Resolved rather than bare: Windows does not search the working directory for
// executables, so "gradlew.bat" alone is simply not found.
const gradlew = path.resolve('android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
run(`"${gradlew}"`, ['bundleRelease', '--console=plain'], { cwd: 'android' });

if (!fs.existsSync(AAB)) die('gradle finished but produced no bundle');

// Play rejects an unsigned or debug-signed bundle, and an unsigned build
// otherwise succeeds quietly and fails later on upload.
const verify = spawnSync(path.join(JAVA_HOME, 'bin', 'jarsigner.exe'),
  ['-verify', AAB], { encoding: 'utf8' });
if (!/jar verified/i.test(verify.stdout || '')) {
  die('the bundle is not signed - check dev-tools/android-signing/lantern/keystore.properties');
}

const mb = (fs.statSync(AAB).size / 1048576).toFixed(1);
console.log(`\nsigned bundle ready — ${mb} MB`);
console.log(`  ${path.resolve(AAB)}`);
console.log(`  ads: ${LIVE ? 'LIVE' : 'test'}`);
console.log('\nUpload it at https://play.google.com/console — remember the version code must increase.');
