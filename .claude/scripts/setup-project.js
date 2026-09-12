#!/usr/bin/env node
'use strict';
// setup-project.js - seed a project for the toolkit plugin, or migrate a
// copy-install onto it. Run by the /tk:setup skill; ships inside the plugin.
//
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/setup-project.js [--dry-run] [--force]
//        [--project <dir>] [--plugin-root <dir>]
//
// Three situations, detected from the project (issue #167, plan Step 5):
//
//   fresh            no toolkit files: write the seed, register the plugin.
//   copy-install     .claude/.toolkit-manifest.json is present: the installer
//                    script put the toolkit's files into this project. Classify
//                    every managed file against the manifest hash exactly as the
//                    installer does (sha256 over the file with carriage returns
//                    stripped), PAGE on any locally modified one, then back up,
//                    remove, reseed, and register the plugin.
//   copy-install     VERSION and .claude/commands/review.md are present but no
//   (no manifest)    manifest (an install from before v5.5.0): the shipped
//                    managed-paths.json says which paths the installer managed;
//                    every present one is provenance unknown, so the run pages
//                    before touching anything, and --force proceeds.
//
// A migration refuses to start on a dirty git tree (or outside a repo) unless
// --force (an untracked or modified .claude/settings.json alone is not dirty:
// the plugin install writes it), because `git checkout` plus the backup folder is the undo. It removes
// first and seeds second (the manifest lists four root files the seed also
// writes; the other order deleted them), key-merges .claude/settings.json (the
// marketplace pointer is what tells a collaborator to install the plugin; a
// write-when-absent would skip every project that already has one), line-merges
// .gitignore, strips permission entries that point at removed scripts, deletes
// the stale .claude/scripts/node_modules, and writes .claude/.toolkit-state.json
// with one schema on both paths. Custom files in the managed directories are
// never touched: only paths the manifest (or managed-paths.json) names go.
//
// Exit codes: 0 done (or nothing to do), 1 error, 3 paged (a decision is
// needed: locally modified files, provenance unknown, or a dirty tree).
// --dry-run prints the same report and exit code and writes nothing.
//
// Dependency-free, like every script under .claude/scripts/.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const MARKETPLACE = 'llm-peer-review';
const MARKETPLACE_REPO = 'mayankmankhand/llm-peer-review';
const PLUGIN = 'tk';
const STATE_REL = '.claude/.toolkit-state.json';
const MANIFEST_REL = '.claude/.toolkit-manifest.json';
const MIGRATION_REL = '.claude/.toolkit-migration.json';
const MANAGED_DIRS = ['.claude/commands', '.claude/agents', '.claude/skills', '.claude/scripts', '.claude/rules'];
// Permission entries that pointed at the copy-installed scripts. The plugin's
// commands carry their own allowed-tools now, so these are dead after a move.
const DEAD_PERMISSION = [
  /\.claude\/scripts\//,
  /^Bash\((echo|cat) \* \| node \/[^)]*\/(\.claude\/)?scripts\/browse\.js \*\)$/,
  /^Skill\(review-commands(:\*)?\)$/,
];

function parseArgs(argv) {
  const o = { dryRun: false, force: false, project: '', pluginRoot: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--force') o.force = true;
    else if (a === '--project') o.project = argv[++i];
    else if (a === '--plugin-root') o.pluginRoot = argv[++i];
    else { console.error('setup-project: unknown argument ' + a); process.exit(1); }
  }
  return o;
}

function git(args, cwd) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch (e) { return null; }
}
function sha256NoCR(abs) {
  const buf = fs.readFileSync(abs);
  const stripped = Buffer.from(buf.toString('latin1').replace(/\r/g, ''), 'latin1');
  return crypto.createHash('sha256').update(stripped).digest('hex');
}
// A tree is dirty when git status reports anything EXCEPT .claude/settings.json:
// `claude plugin install -s project` writes that file (the enabledPlugins entry)
// moments before /tk:setup runs, and this script key-merges it anyway, so an
// untracked or modified settings.json is the expected state, not in-progress
// work the undo line would miss (found on the first dogfood migration, #167).
function dirtyTree(project) {
  const out = git(['status', '--porcelain'], project) || '';
  return out.split('\n').some(l => l.trim() !== '' && l.slice(3).trim() !== '.claude/settings.json');
}
function readJson(abs, fallback) {
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { return fallback; }
}
function walkFiles(dir, rel, out) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const r = rel + '/' + name;
    if (name === 'node_modules') continue;
    if (fs.statSync(abs).isDirectory()) walkFiles(abs, r, out); else out.push(r);
  }
  return out;
}
function removeEmptyDirsUpTo(dir, stopAt) {
  let d = dir;
  while (d !== stopAt && d.startsWith(stopAt)) {
    if (!fs.existsSync(d)) { d = path.dirname(d); continue; }
    if (fs.readdirSync(d).length > 0) break;
    fs.rmdirSync(d);
    d = path.dirname(d);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pluginRoot = path.resolve(opts.pluginRoot || path.join(__dirname, '..'));
  const seedDir = path.join(pluginRoot, 'seed');
  const pluginMeta = readJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), {});
  const version = pluginMeta.version || '0.0.0';
  const managedShipped = readJson(path.join(pluginRoot, 'managed-paths.json'), { paths: [] }).paths;
  const cwd = opts.project ? path.resolve(opts.project) : process.cwd();
  const top = git(['rev-parse', '--show-toplevel'], cwd);
  const project = top || cwd;
  const P = (rel) => path.join(project, rel);
  const out = [];
  const say = (line) => out.push(line);

  if (!fs.existsSync(seedDir)) { console.error('setup-project: seed folder missing at ' + seedDir + ' (is this a generated plugin?)'); process.exit(1); }

  // --- 1. Detect -------------------------------------------------------------
  const state = readJson(P(STATE_REL), null);
  const manifest = readJson(P(MANIFEST_REL), null);
  const looksCopyInstalled = fs.existsSync(P('VERSION')) && fs.existsSync(P('.claude/commands/review.md'));
  let mode;
  if (state) mode = 'plugin';
  else if (manifest && manifest.files) mode = 'migrate-manifest';
  else if (looksCopyInstalled) mode = 'migrate-unknown';
  else mode = 'fresh';
  const previousVersion = manifest && manifest.toolkitVersion ? manifest.toolkitVersion
    : (fs.existsSync(P('VERSION')) ? fs.readFileSync(P('VERSION'), 'utf8').trim() : null);

  say('LLM Peer Review toolkit - project setup (plugin ' + PLUGIN + '@' + MARKETPLACE + ' v' + version + ')');
  say('  Project: ' + project);
  say('  Install type: ' + ({
    plugin: 'already on the plugin (v' + (state && state.version) + ') - seed check only',
    'migrate-manifest': 'migration from copy-install v' + previousVersion + ' (manifest present)',
    'migrate-unknown': 'migration from copy-install v' + previousVersion + ' (NO manifest: provenance unknown)',
    fresh: 'fresh install',
  })[mode]);
  if (opts.dryRun) say('  Dry run: nothing will be written.');

  // --- 2. Migration plan -----------------------------------------------------
  const removed = [];       // rels to delete (backed up first)
  const modified = [];      // locally modified managed files (rel)
  const custom = [];        // files kept in managed dirs
  let paged = false;
  const migrating = mode === 'migrate-manifest' || mode === 'migrate-unknown';
  if (migrating) {
    const isRepo = top !== null;
    const dirty = isRepo ? dirtyTree(project) : false;
    if (!isRepo) { say('  Not a git repository: there is no `git checkout` undo for a migration.'); if (!opts.force) paged = true; }
    if (dirty) { say('  The git tree has uncommitted changes. Commit or stash first, so the undo line below is exact.'); if (!opts.force) paged = true; }
    const managed = mode === 'migrate-manifest' ? Object.keys(manifest.files) : managedShipped;
    for (const rel of managed) {
      if (!fs.existsSync(P(rel)) || fs.statSync(P(rel)).isDirectory()) continue;
      if (mode === 'migrate-manifest') {
        if (sha256NoCR(P(rel)) !== manifest.files[rel]) modified.push(rel);
      }
      removed.push(rel);
    }
    for (const rel of [MANIFEST_REL, 'VERSION']) if (fs.existsSync(P(rel)) && !removed.includes(rel)) removed.push(rel);
    const managedSet = new Set(removed);
    for (const dir of MANAGED_DIRS) for (const rel of walkFiles(P(dir), dir, [])) if (!managedSet.has(rel)) custom.push(rel);
    if (modified.length && !opts.force) paged = true;
    if (mode === 'migrate-unknown' && !opts.force) paged = true;

    say('  Managed toolkit files to remove: ' + removed.length + (mode === 'migrate-unknown' ? ' (from the shipped managed-paths list; none can be verified against a manifest)' : ''));
    if (modified.length) {
      say('  Locally modified toolkit files (' + modified.length + '), the ones a plugin cannot carry:');
      for (const rel of modified) say('    - ' + rel + '  (your edit is kept in the backup folder; the plugin\'s copy takes over. File the change upstream to keep it.)');
    }
    say('  Custom files in toolkit folders (kept byte for byte): ' + (custom.length ? '' : '(none)'));
    for (const rel of custom) say('    - ' + rel);
    if (fs.existsSync(P('.claude/scripts/node_modules'))) say('  Stale .claude/scripts/node_modules will be deleted (the plugin carries its own packages).');
  }

  // --- 3. Seed plan ------------------------------------------------------------
  const seedFiles = {
    'CLAUDE.md': 'CLAUDE.md',
    'LESSONS.md': 'LESSONS.md',
    'DESIGN-PROFILE.md': 'DESIGN-PROFILE.md',
    '.env.local.example': 'env.local.example',
    '.gitattributes': 'gitattributes',
    'artifacts/README.md': 'artifacts-README.md',
    '.claude/rules/toolkit.md': 'rules-toolkit.md',
  };
  const lessonsPreexisted = fs.existsSync(P('LESSONS.md'));
  const willRemove = new Set(removed);
  const seedWrite = [];
  const seedSkip = [];
  for (const [rel, seedName] of Object.entries(seedFiles)) {
    const absentAfterRemoval = !fs.existsSync(P(rel)) || willRemove.has(rel);
    if (absentAfterRemoval) seedWrite.push([rel, seedName]); else seedSkip.push(rel);
  }
  if (!lessonsPreexisted && !fs.existsSync(P('LESSONS-detail.md'))) seedWrite.push(['LESSONS-detail.md', 'LESSONS-detail.md']);
  // Version-stamp the seeded rules file so /tk:upgrade can tell when it is behind.
  const stampRules = (text) => text.replace(/<!-- Toolkit version: [^|]+\|/, '<!-- Toolkit version: ' + version + ' |');

  // .gitignore line merge
  const seedIgnore = fs.readFileSync(path.join(seedDir, 'gitignore'), 'utf8').split(/\r?\n/);
  const curIgnore = fs.existsSync(P('.gitignore')) ? fs.readFileSync(P('.gitignore'), 'utf8').split(/\r?\n/) : [];
  const ignoreAdd = seedIgnore.filter(l => l.trim() !== '' && !l.startsWith('#') && !curIgnore.includes(l));
  if (!curIgnore.includes('.claude/settings.local.json')) ignoreAdd.push('.claude/settings.local.json');

  // .claude/settings.json key merge (the plugin registration for collaborators)
  const settings = readJson(P('.claude/settings.json'), {});
  const settingsBefore = JSON.stringify(settings);
  settings.extraKnownMarketplaces = settings.extraKnownMarketplaces || {};
  settings.extraKnownMarketplaces[MARKETPLACE] = settings.extraKnownMarketplaces[MARKETPLACE] || { source: { source: 'github', repo: MARKETPLACE_REPO } };
  settings.enabledPlugins = settings.enabledPlugins || {};
  settings.enabledPlugins[PLUGIN + '@' + MARKETPLACE] = true;
  const settingsChanged = JSON.stringify(settings) !== settingsBefore;

  // settings.local.json: baseline merge minus the script entries, dead entries out
  const seedLocal = readJson(path.join(seedDir, 'settings.local.json'), { permissions: { allow: [] } });
  const seedAllow = ((seedLocal.permissions && seedLocal.permissions.allow) || []).filter(p => !DEAD_PERMISSION.some(re => re.test(p)));
  const local = readJson(P('.claude/settings.local.json'), null);
  const localBefore = local ? JSON.stringify(local) : null;
  const localNext = local || { permissions: { allow: [] } };
  localNext.permissions = localNext.permissions || {};
  localNext.permissions.allow = localNext.permissions.allow || [];
  const deadPerms = localNext.permissions.allow.filter(p => DEAD_PERMISSION.some(re => re.test(p)));
  localNext.permissions.allow = localNext.permissions.allow.filter(p => !deadPerms.includes(p));
  const addedPerms = seedAllow.filter(p => !localNext.permissions.allow.includes(p));
  localNext.permissions.allow.push(...addedPerms);
  if (seedLocal.defaultMode && !localNext.defaultMode) localNext.defaultMode = seedLocal.defaultMode;
  if (seedLocal.permissions && seedLocal.permissions.additionalDirectories) {
    localNext.permissions.additionalDirectories = localNext.permissions.additionalDirectories || [];
    for (const d of seedLocal.permissions.additionalDirectories) if (!localNext.permissions.additionalDirectories.includes(d)) localNext.permissions.additionalDirectories.push(d);
  }
  const localChanged = JSON.stringify(localNext) !== localBefore;

  say('  Seed files to write: ' + (seedWrite.length ? seedWrite.map(s => s[0]).join(', ') : '(none)'));
  if (seedSkip.length) say('  Seed files already present (yours, untouched): ' + seedSkip.join(', '));
  say('  .gitignore lines to add: ' + ignoreAdd.length);
  say('  .claude/settings.json: ' + (settingsChanged ? 'register marketplace ' + MARKETPLACE + ' and enable ' + PLUGIN + ' (the first push will page on this change: that is the tripwire doing its job)' : 'already registers the plugin'));
  say('  .claude/settings.local.json: ' + (local ? 'merge' : 'create') + ' (' + addedPerms.length + ' entries added, ' + deadPerms.length + ' dead script entries removed)');

  // --- 4. Page or proceed --------------------------------------------------------
  if (paged) {
    say('');
    say('PAGED - nothing was written. Decide, then re-run:');
    if (modified.length) say('  - keep going and let the backup hold your edits: add --force');
    if (mode === 'migrate-unknown') say('  - no manifest to verify against: add --force to sweep the listed paths, or run the v6 installer once first to get a manifest');
    if (migrating && (top === null || dirtyTree(project))) say('  - commit or stash your changes first (or add --force)');
    process.stdout.write(out.join('\n') + '\n');
    process.exit(3);
  }
  if (opts.dryRun) { process.stdout.write(out.join('\n') + '\n'); process.exit(0); }

  // --- 5. Apply --------------------------------------------------------------------
  let backupDir = null;
  if (migrating && (removed.length || localChanged || settingsChanged || ignoreAdd.length)) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    backupDir = P('.toolkit-backup-' + stamp + '-plugin');
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = (rel) => {
      if (!fs.existsSync(P(rel))) return;
      const dest = path.join(backupDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(P(rel), dest);
    };
    for (const rel of removed) backup(rel);
    for (const rel of ['.claude/settings.local.json', '.claude/settings.json', '.gitignore']) backup(rel);
    for (const rel of removed) {
      fs.rmSync(P(rel), { force: true });
      removeEmptyDirsUpTo(path.dirname(P(rel)), P('.claude'));
    }
    fs.rmSync(P('.claude/scripts/node_modules'), { recursive: true, force: true });
    removeEmptyDirsUpTo(P('.claude/scripts'), P('.claude'));
  }
  for (const [rel, seedName] of seedWrite) {
    let content = fs.readFileSync(path.join(seedDir, seedName));
    if (rel === '.claude/rules/toolkit.md') content = Buffer.from(stampRules(content.toString('utf8')), 'utf8');
    fs.mkdirSync(path.dirname(P(rel)), { recursive: true });
    fs.writeFileSync(P(rel), content);
  }
  fs.mkdirSync(P('plans'), { recursive: true });
  fs.mkdirSync(P('artifacts'), { recursive: true });
  if (ignoreAdd.length) {
    const prefix = curIgnore.length && curIgnore[curIgnore.length - 1] !== '' ? '\n' : '';
    fs.appendFileSync(P('.gitignore'), prefix + '\n# Added by the LLM Peer Review toolkit (/tk:setup)\n' + ignoreAdd.join('\n') + '\n');
  }
  if (settingsChanged) { fs.mkdirSync(P('.claude'), { recursive: true }); fs.writeFileSync(P('.claude/settings.json'), JSON.stringify(settings, null, 2) + '\n'); }
  if (localChanged) { fs.mkdirSync(P('.claude'), { recursive: true }); fs.writeFileSync(P('.claude/settings.local.json'), JSON.stringify(localNext, null, 2) + '\n'); }
  const stateNext = {
    version,
    path: mode === 'plugin' ? (state.path || 'plugin') : (migrating ? 'copy-migrated' : 'plugin'),
    at: new Date().toISOString(),
    marketplace: MARKETPLACE,
    plugin: PLUGIN,
    previousVersion: mode === 'plugin' ? (state.previousVersion || null) : previousVersion,
  };
  if (mode !== 'plugin') fs.writeFileSync(P(STATE_REL), JSON.stringify(stateNext, null, 2) + '\n');
  if (migrating) {
    fs.writeFileSync(P(MIGRATION_REL), JSON.stringify({
      at: stateNext.at, from: previousVersion, to: version, backupDir: backupDir ? path.relative(project, backupDir) : null,
      removed, custom, deadPermissions: deadPerms,
      modified: modified.map(rel => ({ rel, backup: backupDir ? path.relative(project, path.join(backupDir, rel)) : null, pluginCopy: rel.startsWith('.claude/') ? rel.replace(/^\.claude\//, '') : null })),
    }, null, 2) + '\n');
  }

  // --- 6. Report ------------------------------------------------------------------
  say('');
  say('Done.');
  if (backupDir) say('  Backup: ' + path.relative(project, backupDir) + ' (every removed file, plus the settings and .gitignore as they were)');
  if (migrating) {
    say('  Undo: git checkout -- .claude VERSION .gitattributes .gitignore ; then delete the seeded files listed above, or restore from the backup folder.');
    say('  Next: run /tk:upgrade to audit your custom files against the ' + version + ' conventions' + (modified.length ? ' (it will carry your ' + modified.length + ' local edit(s) as findings)' : '') + '.');
  } else if (mode === 'fresh') {
    say('  Next: /tk:explore. The codebase map generates on first use.');
  } else {
    say('  Nothing to migrate; seed checked.');
  }
  process.stdout.write(out.join('\n') + '\n');
}

main();
