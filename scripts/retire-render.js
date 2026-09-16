// Retires the narration render once every registered narrator is published.
//
//   node scripts/retire-render.js            (refuses unless all voices are live)
//   node scripts/retire-render.js --status   (report only, changes nothing)
//
// Nineteen narrators is the set. When the last one lands, the render queue
// exits clean, the supervisor sees "queue not running" and restarts it every
// two minutes, and each run scans nineteen finished voices and exits again -
// forever. Harmless, pointless, and it fills both logs. This ends it, but only
// once there is nothing left to render AND nothing left to publish: it checks
// the committed catalogue (data/narration/catalogue.json), which only lists a
// voice after `publish-narration.js --push` has hosted all 66 books. Retiring
// on the render count alone would be wrong - a reboot between Jonah finishing
// and Jonah publishing would then find no supervisor to restart the uploader.
//
// What it does, in order: stop the queue, its workers, piper and any uploader;
// stop the supervisor; delete the Startup-folder entry that relaunches it at
// logon. The scripts stay in the repo. Idempotent - safe to run again.
//
// The supervisor is found by the literal text `-File <full path to
// supervise-narration.ps1>` in its command line. A looser `*supervise-narration*`
// once matched the very shell that launched it (the path was inside a -Command
// string), and the mutex guard built on that pattern made every supervisor
// exit at birth. The path reaches PowerShell through an environment variable
// so no quoting or backslash escaping is involved at all.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const STATUS_ONLY = process.argv.includes('--status');
const STARTUP_CMD = path.join(process.env.APPDATA || '',
  'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'lantern-narration-jobs.cmd');
const SUPERVISOR_PS1 = path.join(REPO, 'scripts', 'supervise-narration.ps1');

function ps(cmd) {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', cmd], {
    encoding: 'utf8',
    env: { ...process.env, LANTERN_SUPERVISOR: SUPERVISOR_PS1, LANTERN_SELF_PID: String(process.pid) },
  });
  return (r.stdout || '').trim();
}

// Every voice the registry knows, as translation/voice.
const registry = JSON.parse(fs.readFileSync(path.join(REPO, 'narration-voices.json'), 'utf8'));
const registered = [];
for (const [tr, voices] of Object.entries(registry)) {
  if (tr.startsWith('_')) continue;
  for (const v of Object.keys(voices)) if (!v.startsWith('_')) registered.push(`${tr}/${v}`);
}

// Every voice the committed catalogue advertises.
const catPath = path.join(REPO, 'data', 'narration', 'catalogue.json');
const catalogue = fs.existsSync(catPath) ? JSON.parse(fs.readFileSync(catPath, 'utf8')) : {};
const live = new Set();
for (const [tr, entry] of Object.entries(catalogue)) {
  for (const v of (entry.voices || [])) live.add(`${tr}/${v.id}`);
}

const missing = registered.filter(id => !live.has(id));
console.log(`registered ${registered.length}, published ${registered.length - missing.length}` +
  (missing.length ? `, not yet published: ${missing.join(', ')}` : ''));

if (missing.length) {
  console.log('not retiring - the render still has work, or a finished voice is not published yet');
  process.exit(2);
}
if (STATUS_ONLY) { console.log('all published; --status given, changing nothing'); process.exit(0); }

// 1. Render processes. Parent (queue) first so it cannot react to its children dying.
const stopped = ps(`
  $self = [int]$env:LANTERN_SELF_PID
  $n = 0
  foreach ($pat in @('*render-queue*','*build-narration*','*upload-narration*')) {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
      Where-Object { $_.CommandLine -like $pat -and $_.ProcessId -ne $self } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }
  }
  Get-Process piper -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue; $n++ }
  $n`);
console.log(`stopped ${stopped || 0} render/upload process(es)`);

// 2. The supervisor, by the literal "-File <path>" in its command line.
const sup = ps(`
  $p = $env:LANTERN_SUPERVISOR
  $self = [int]$env:LANTERN_SELF_PID
  $n = 0
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.ProcessId -ne $self -and ($_.CommandLine -like "*-File $p*" -or $_.CommandLine -like "*-File \`"$p\`"*") } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }
  $n`);
console.log(`stopped ${sup || 0} supervisor process(es)`);

// 3. The Startup entry, so nothing relaunches it at the next logon.
if (fs.existsSync(STARTUP_CMD)) { fs.unlinkSync(STARTUP_CMD); console.log(`removed ${STARTUP_CMD}`); }
else console.log('Startup entry already absent');

console.log('render retired. All registered narrators are published; nothing is left to render.');
