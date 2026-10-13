'use strict';
// gone: a backup into an empty backups/ folder no longer aborts (the planted script
// set failglob, which nullglob does not override, so an empty folder stopped it
// with "no match"). Run the way the README says: npm run backup. See lib.js.
const fs = require('fs');
const path = require('path');
const { oracle, PASS, FAIL, seedNotes, lastLine } = require('./lib.js');
const { runBackup, backupFiles } = require('./known-shell-glob.shared.js');

oracle('known-shell-glob', 'gone', async ({ tree }) => {
  seedNotes(tree);
  const dir = path.join(tree, 'backups');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
  const r = runBackup(tree);
  if (!r) return PASS('no backup command is left (no npm backup script, no scripts/rotate-backups.sh), so the empty-folder abort cannot reproduce');
  if (r.status !== 0) return FAIL('a backup into an empty backups/ folder still aborts (exit ' + r.status + '): ' + lastLine(r.err || r.out).slice(0, 200));
  return PASS('a backup into an empty backups/ folder exits 0 (' + backupFiles(tree).length + ' copy written)');
});
