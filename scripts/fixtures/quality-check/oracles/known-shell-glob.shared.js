'use strict';
// Running the backup for the two backup-script oracles. Not an oracle itself.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { packageJson, npmRun } = require('./lib.js');

// npm run backup when package.json has the script; else the script itself; else
// null (no backup command is left). Returns { status, out, err }.
function runBackup(tree) {
  const pkg = packageJson(tree);
  if (pkg && pkg.scripts && pkg.scripts.backup) return npmRun(tree, 'backup');
  if (!fs.existsSync(path.join(tree, 'scripts', 'rotate-backups.sh'))) return null;
  const r = spawnSync('bash', ['scripts/rotate-backups.sh'], { cwd: tree, encoding: 'utf8', timeout: 30000 });
  return { status: r.status === null ? 124 : r.status, out: r.stdout || '', err: (r.stderr || '') + (r.error ? '\n' + r.error.message : '') };
}

function backupFiles(tree) {
  const dir = path.join(tree, 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^notes-.*\.json$/.test(f)).sort() : [];
}

module.exports = { runBackup, backupFiles };
