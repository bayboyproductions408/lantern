// Renders a queue of narrators, one after another, and holds the machine awake
// while it works.
//
//   node scripts/render-queue.js kjv:abel rvr:pilar ...
//
// This replaces the bash driver. The shell version worked perfectly when run in
// the foreground and silently did nothing when launched detached from
// PowerShell - between the login-shell cd, the missing /usr/bin on PATH, and
// the redirect quoting there were three separate ways for it to vanish without
// writing a line to the log. Node launches detached reliably, so the queue
// lives here instead and bash is out of the path entirely.
//
// Resumable: build-narration.js skips books already on disk, so passing the
// whole queue every time costs seconds and never repeats finished work.

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SCRATCH = 'C:/Users/domhe/AppData/Local/Temp/claude/C--Dom-Claude-BibleAudio/bb5f9ad2-c3cf-44d3-9e5f-4610869c8080/scratchpad';
const FFDIR = 'C:/Users/domhe/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin';

const WORKERS = Number(process.env.WORKERS || 4);
const LOG = path.join(REPO, 'render.log');

const env = {
  ...process.env,
  PIPER: `${SCRATCH}/piper/piper/piper.exe`,
  PIPER_MODELS: `${SCRATCH}/piper`,
  FFMPEG: `${FFDIR}/ffmpeg.exe`,
  FFPROBE: `${FFDIR}/ffprobe.exe`,
  // Measured: piper already saturates every core from one process, and extra
  // threads per process only make the workers fight each other.
  OMP_NUM_THREADS: '1',
  ORT_INTRA_OP_NUM_THREADS: '1',
};

function log(line) {
  const stamp = new Date().toTimeString().slice(0, 8);
  fs.appendFileSync(LOG, `${stamp} ${line}\n`);
}

const queue = process.argv.slice(2);
if (!queue.length) {
  console.error('usage: node scripts/render-queue.js <translation>:<voice> ...');
  process.exit(1);
}

// Hold the machine awake for as long as this queue runs. Process-scoped, so
// Windows releases it automatically when this exits - nothing to restore.
const awake = spawn('powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(REPO, 'keep-awake.ps1')],
  { cwd: REPO, stdio: 'ignore' });

const stopAwake = () => { try { awake.kill(); } catch { /* already gone */ } };
process.on('exit', stopAwake);
process.on('SIGINT', () => { stopAwake(); process.exit(130); });
process.on('SIGTERM', () => { stopAwake(); process.exit(143); });

log(`queue started: ${queue.join(' ')} (${WORKERS} workers)`);

for (const pair of queue) {
  const [translation, voice] = pair.split(':');
  if (!translation || !voice) { log(`skipping malformed queue entry "${pair}"`); continue; }

  log(`=== ${translation}/${voice} ===`);
  const started = Date.now();
  const r = spawnSync(process.execPath,
    ['build-narration.js', translation, voice, '--workers', String(WORKERS)],
    { cwd: REPO, env, encoding: 'utf8', maxBuffer: 1 << 28 });

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  for (const line of (r.stdout || '').split(/\r?\n/)) if (line.trim()) log(line);
  if (r.status !== 0) {
    log(`!! ${translation}/${voice} failed (exit ${r.status}) after ${mins} min`);
    for (const line of (r.stderr || '').split(/\r?\n/).slice(-8)) if (line.trim()) log(`   ${line}`);
  } else {
    log(`${translation}/${voice} finished in ${mins} min`);
  }
}

log('queue finished');
stopAwake();
