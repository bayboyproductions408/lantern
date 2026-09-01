// Publishes every narrator that has finished rendering.
//
//   node scripts/publish-narration.js           (dry run - shows what would go live)
//   node scripts/publish-narration.js --push    (uploads, rebuilds, commits, pushes)
//
// The render queue only renders. Uploading the audio, rebuilding the manifests
// and pushing them are three separate steps that were being done by hand after
// each voice, which meant a finished narrator could sit on disk indefinitely
// while the queue moved on to the next one. Ten voices at ~7.7 hours each is a
// lot of compute to leave unreachable, so this collapses the three steps into
// one command that is safe to run at any point, including mid-render.
//
// Every step it calls is already idempotent: the uploader skips assets that are
// already hosted, and build-narration-index.js advertises only the voices that
// cover all 66 books and withholds the rest. Running this while a render is
// half way through a voice is therefore harmless - that voice simply is not
// published yet.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'narration');
const OUT = path.join(REPO, 'data', 'narration');
const PUSH = process.argv.includes('--push');
const SKIP_UPLOAD = process.argv.includes('--skip-upload');

const BOOKS_PER_TRANSLATION = 66;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28, ...opts,
  });
  if (r.error) throw new Error(`${cmd} ${args.join(' ')}: ${r.error.message}`);
  return r;
}

const git = (...args) => run('git', args).stdout.trim();

/** Voices with every book rendered, as `translation/voice`. */
function renderedVoices() {
  if (!fs.existsSync(SRC)) return [];
  const done = [];
  for (const tr of fs.readdirSync(SRC)) {
    const trDir = path.join(SRC, tr);
    if (!fs.statSync(trDir).isDirectory()) continue;
    for (const voice of fs.readdirSync(trDir)) {
      const dir = path.join(trDir, voice);
      if (!fs.statSync(dir).isDirectory()) continue;
      const books = fs.readdirSync(dir).length;
      done.push({ id: `${tr}/${voice}`, books, complete: books >= BOOKS_PER_TRANSLATION });
    }
  }
  return done.sort((a, b) => b.books - a.books);
}

/** Voices the published catalogue currently advertises. */
function publishedVoices() {
  const file = path.join(OUT, 'catalogue.json');
  if (!fs.existsSync(file)) return new Set();
  const cat = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = new Set();
  for (const [tr, o] of Object.entries(cat)) {
    for (const v of o.voices || []) out.add(`${tr}/${v.id ?? v.name.toLowerCase()}`);
  }
  return out;
}

(async () => {
  const rendered = renderedVoices();
  const before = publishedVoices();

  console.log('rendered on disk:');
  for (const v of rendered) {
    const mark = v.complete ? 'complete' : `${v.books}/${BOOKS_PER_TRANSLATION}`;
    console.log(`  ${v.id.padEnd(16)} ${mark}`);
  }
  console.log(`\npublished now: ${[...before].join(', ') || '(none)'}`);

  const waiting = rendered.filter(v => v.complete && !before.has(v.id));
  if (!waiting.length) {
    console.log('\nnothing finished that is not already published.');
    if (!PUSH) return;
  } else {
    console.log(`\nready to publish: ${waiting.map(v => v.id).join(', ')}`);
  }

  if (!SKIP_UPLOAD) {
    console.log('\nuploading audio (skips anything already hosted)...');
    const up = run(process.execPath, ['upload-narration.js'], { stdio: 'inherit' });
    if (up.status !== 0) { console.error('upload failed; stopping before publish'); process.exit(1); }
  }

  console.log('\nrebuilding manifests...');
  const idx = run(process.execPath, ['build-narration-index.js'], { stdio: 'inherit' });
  if (idx.status !== 0) { console.error('index build failed'); process.exit(1); }

  const changed = git('status', '--porcelain', '--', 'data/narration');
  if (!changed) { console.log('\nmanifests unchanged - nothing to publish.'); return; }

  console.log('\nmanifest changes:');
  console.log(changed.split('\n').slice(0, 20).join('\n'));

  const after = publishedVoices();
  const added = [...after].filter(v => !before.has(v));
  console.log(`\ncatalogue would advertise: ${[...after].join(', ')}`);
  if (added.length) console.log(`newly advertised: ${added.join(', ')}`);

  if (!PUSH) {
    console.log('\ndry run - nothing committed. Re-run with --push to publish.');
    return;
  }

  const subject = added.length
    ? `Publish ${added.map(v => v.split('/')[1]).join(', ')} to the narrator catalogue`
    : 'Refresh the narration manifests';

  run('git', ['add', '--', 'data/narration'], { stdio: 'inherit' });
  const commit = run('git', ['commit', '-m', subject], { stdio: 'inherit' });
  if (commit.status !== 0) { console.error('commit failed'); process.exit(1); }

  // HEAD:main, never `origin main`. Work happens on a side branch here, and
  // `git push origin main` pushes whatever the local `main` ref points at -
  // which, when it has not moved, is a successful no-op that reports success
  // while the commit stays local. That silently stranded three commits once.
  const push = run('git', ['push', 'origin', 'HEAD:main'], { stdio: 'inherit' });
  if (push.status !== 0) { console.error('push failed'); process.exit(1); }

  console.log('\npushed. GitHub Pages serves the new catalogue within a minute or two,');
  console.log('and installed copies pick it up on their next catalogue refresh.');
})().catch(e => { console.error(e.message); process.exit(1); });
