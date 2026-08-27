// One-time move from one-narrator-per-translation to many.
//
//   node migrate-narration-voices.js [--apply]
//
// Renders used to live at narration/<translation>/<book>/. A translation can
// now carry several narrators, so they move to
// narration/<translation>/<voice>/<book>/ and the release map is rekeyed to
// match. Nothing is re-encoded and nothing is re-uploaded: this is a rename
// plus a rewritten index, so the 2 GB already on disk and the ~2,100 assets
// already hosted are both kept exactly as they are.
//
// Runs as a dry run unless --apply is passed, and refuses to start if the
// destination already exists.

const fs = require('fs');
const path = require('path');

const SRC = 'narration';
const APPLY = process.argv.includes('--apply');

// The narrator each translation was rendered with before voices existed.
const LEGACY = { kjv: 'cori', rvr: 'davefx' };

if (!fs.existsSync(SRC)) {
  console.error(`no ${SRC}/ — nothing to migrate`);
  process.exit(1);
}

const moves = [];
for (const translation of fs.readdirSync(SRC)) {
  const trDir = path.join(SRC, translation);
  if (!fs.statSync(trDir).isDirectory()) continue;

  const voice = LEGACY[translation];
  if (!voice) {
    console.error(`! ${translation} has no legacy voice recorded — add it to LEGACY first`);
    process.exit(1);
  }

  for (const entry of fs.readdirSync(trDir)) {
    const from = path.join(trDir, entry);
    if (!fs.statSync(from).isDirectory()) continue;
    // Already migrated: the voice directory is the only child that is itself
    // a voice name, and it holds books rather than chapters.
    if (entry === voice) { console.log(`  ${translation}/${entry} already a voice directory`); continue; }
    moves.push({ from, to: path.join(trDir, voice, entry), translation, voice, book: entry });
  }
}

if (!moves.length) {
  console.log('nothing to move');
} else {
  console.log(`${moves.length} book directories to move`);
  console.log(`  e.g. ${moves[0].from}  ->  ${moves[0].to}`);
}

// Rekey the release map: "kjv/john" becomes "kjv/cori/john".
const relPath = path.join(SRC, 'releases.json');
let rekeyed = null;
if (fs.existsSync(relPath)) {
  const old = JSON.parse(fs.readFileSync(relPath, 'utf8'));
  rekeyed = {};
  for (const [key, tag] of Object.entries(old)) {
    const parts = key.split('/');
    if (parts.length === 3) { rekeyed[key] = tag; continue; }   // already migrated
    const [tr, book] = parts;
    rekeyed[`${tr}/${LEGACY[tr]}/${book}`] = tag;
  }
  console.log(`releases.json: ${Object.keys(old).length} entries rekeyed`);
}

if (!APPLY) {
  console.log('\ndry run — pass --apply to perform the move');
  process.exit(0);
}

for (const m of moves) {
  if (fs.existsSync(m.to)) {
    console.error(`! ${m.to} already exists — stopping rather than merging`);
    process.exit(1);
  }
}

for (const m of moves) {
  fs.mkdirSync(path.dirname(m.to), { recursive: true });
  fs.renameSync(m.from, m.to);
}
console.log(`moved ${moves.length} book directories`);

if (rekeyed) {
  fs.writeFileSync(relPath, JSON.stringify(rekeyed, null, 1));
  console.log('rewrote releases.json');
}
