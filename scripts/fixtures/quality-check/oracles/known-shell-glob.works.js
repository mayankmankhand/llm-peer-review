'use strict';
// works: the backup still rotates: with nine copies in backups/ it removes the
// three oldest and writes a new copy of data/notes.json, keeping 7; with two it
// removes nothing. The empty-folder case is the gone oracle's.
const fs = require('fs');
const path = require('path');
const { oracle, PASS, FAIL, seedNotes, lastLine } = require('./lib.js');
const { runBackup, backupFiles } = require('./known-shell-glob.shared.js');

function fill(tree, n) {
  const dir = path.join(tree, 'backups');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
  const names = [];
  for (let i = 1; i <= n; i++) {
    const name = 'notes-20260101-00000' + i + '.json';
    fs.writeFileSync(path.join(dir, name), JSON.stringify({ copy: i }) + '\n');
    names.push(name);
  }
  return names;
}

function check(tree, old, keep) {
  const r = runBackup(tree);
  if (!r) return 'no backup command is left (no npm backup script, no scripts/rotate-backups.sh)';
  if (r.status !== 0) return 'npm run backup exited ' + r.status + ' with ' + old.length + ' copies: ' + lastLine(r.err || r.out).slice(0, 200);
  const now = backupFiles(tree);
  const kept = old.slice(old.length - keep);
  const added = now.filter(f => !old.includes(f));
  const data = fs.readFileSync(path.join(tree, 'data', 'notes.json'));
  if (kept.some(f => !now.includes(f)) || old.slice(0, old.length - keep).some(f => now.includes(f))) {
    return 'with ' + old.length + ' copies it kept [' + now.filter(f => old.includes(f)).join(', ') + '], want the newest ' + keep;
  }
  if (added.length !== 1) return 'with ' + old.length + ' copies it wrote ' + added.length + ' new copies, want 1';
  if (!fs.readFileSync(path.join(tree, 'backups', added[0])).equals(data)) return 'the new copy ' + added[0] + ' is not data/notes.json';
  return null;
}

oracle('known-shell-glob', 'works', async ({ tree }) => {
  seedNotes(tree);
  const nine = check(tree, fill(tree, 9), 6);
  if (nine) return FAIL(nine);
  const two = check(tree, fill(tree, 2), 2);
  if (two) return FAIL(two);
  return PASS('nine copies become the newest six plus a new copy of data/notes.json; two copies are all kept');
});
