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
// Two managed root files hold user content too and are never removed (issue
// #174): a migration line-merges .gitattributes like .gitignore (a Git LFS rule
// a project added survives), and artifacts/README.md is written only when absent.
//
// State and the version guard (issue #174): a fresh setup also records
// `auditedVersion` (its seed already satisfies the running version, so it is
// audited by construction); a migration does not, so session-start.js asks for
// /tk:upgrade. A re-run on a project already on the plugin raises `version` and
// `at` to the running version when it is newer, never lowers them, and never
// changes an existing `auditedVersion` or `previousVersion`. When neither exists
// (every fresh 7.0.x install, whose setup did not write auditedVersion),
// `version` itself is the audit reference, so the raise first copies the old
// `version` (and `at`) into `auditedVersion` (and `auditedAt`): otherwise the
// raise would silently empty /tk:upgrade's audit range and hide its notice.
// Every version read from the project is validated by the helpers shared with
// session-start.js and pre-push-check.js: a value of any other shape is never
// compared as a version and never echoed into the report.
//
// The migration record (.claude/.toolkit-migration.json) carries a count of the
// dead permission rows it removed, never the rows: they come from the
// gitignored settings.local.json and hold this machine's paths, and the backup
// folder's copy of that file already keeps them. The seed gitignores the record.
//
// The undo line: a migration keeps its fixed line. Every other run that created
// or changed something ends with an `Undo:` line built from what the run
// actually wrote: the files and folders it created (delete), the tracked files
// it changed that were clean before (`git checkout --`), and the changed files
// git holds no copy of as they were (restore by hand). A run that changed
// nothing prints no undo line. Paths are project-relative and shell-quoted.
//
// Exit codes: 0 done (or nothing to do), 1 error, 3 paged (a decision is
// needed: locally modified files, provenance unknown, or a dirty tree).
// --dry-run prints the same report and exit code and writes nothing.
//
// Dependency-free, like every script under .claude/scripts/. Run directly it
// sets up the project; required, it only exports the undo-line helpers for
// scripts/test-setup-project.js.

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
// Managed paths a migration keeps instead of removing: each can carry lines or
// text the user added, which a remove-and-reseed would silently delete.
const KEEP_ON_MIGRATION = ['.gitattributes', 'artifacts/README.md'];
// A permission row is dead when it can no longer allow anything real. Two kinds:
// the toolkit's own legacy row shapes (an absolute-path browse.js pipe that an
// old installer injected, the pre-skill review-commands row), and any row that
// names a script under .claude/scripts/ which will not exist in the project once
// this run finishes. The plugin's commands carry their own allowed-tools, so a
// row for a removed toolkit script is dead; a row for a script the project still
// has, its own custom tool included, is live and kept. The first version treated
// every .claude/scripts/ row as dead and deleted a kept custom script's row on
// every run (review of the v7.0.0 release, R2).
const LEGACY_DEAD_PERMISSION = [
  /^Bash\((echo|cat) \* \| node \/[^)]*\/(\.claude\/)?scripts\/browse\.js \*\)$/,
  /^Skill\(review-commands(:\*)?\)$/,
];
function deadPermission(row, willExist) {
  if (LEGACY_DEAD_PERMISSION.some(re => re.test(row))) return true;
  const m = /(?:^|[\s(])\.claude\/scripts\/([^\s)'"*]+)/.exec(row);
  return m !== null && !willExist('.claude/scripts/' + m[1]);
}

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
  // Read the status NUL-separated and untrimmed. The shared git() helper trims
  // its output, which strips the leading space of a first line like
  // " M .claude/settings.json" and shifts every column, so the exemption below
  // never matched a TRACKED settings file (found by the suite after the v7.0.0
  // tag; both live migrations had an untracked one). -z also leaves paths with
  // spaces unquoted. Entry shape: "XY path"; a rename or copy (X is R or C)
  // is followed by one more NUL-terminated token, the original path.
  let out;
  try { out = execFileSync('git', ['status', '--porcelain', '-z'], { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return false; }
  const tokens = out.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (entry.length < 4) continue;
    if (entry[0] === 'R' || entry[0] === 'C') i++; // skip the original path of a rename or copy
    if (entry.slice(3) !== '.claude/settings.json') return true;
  }
  return false;
}
// >>> version helpers (issue #174) >>>
// Byte-identical in session-start.js, pre-push-check.js and setup-project.js,
// from this marker to the closing one. Each script must run on its own (the
// pre-push check is also copied alone into non-plugin installs), so there is no
// shared module; scripts/test-pre-push-check.js fails when the copies drift.
//
// A version is only ever taken from a string of one fixed, harmless shape:
// dotted numbers (one to four parts), an optional -suffix of letters, digits and
// dots, at most 32 characters. The state file these read is committed to the
// project, so a cloned repository controls it, and session-start.js prints the
// version into Claude's context: any other text there would be injected into
// it. A value of any other shape is no usable version - never printed, never
// compared, never a block.
const VERSION_SHAPE = /^\d+(\.\d+){0,3}(-[0-9A-Za-z.]+)?$/;
const VERSION_MAX_LENGTH = 32;
// The version as a safe string (surrounding whitespace dropped), or null.
function validVersion(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length <= VERSION_MAX_LENGTH && VERSION_SHAPE.test(t) ? t : null;
}
// Dotted numeric parts, any -suffix ignored: 7.0.1 < 7.1.0 < 7.10.0. Null for
// anything validVersion refuses, so a malformed value never produces a verdict.
function parseVersion(v) {
  const t = validVersion(v);
  return t === null ? null : t.split('-')[0].split('.').map(Number);
}
// -1, 0 or 1 as a is older than, equal to, or newer than b; null when either is unusable.
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null || pb === null) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
// The version a project is recorded at: auditedVersion (a /tk:upgrade stamped
// it, or a fresh setup wrote it), else previousVersion (a migration's old
// copy-install version), else version. The first key that names a version
// decides, validated: null when none names one or that value is unusable (no
// fall-through to a later key, so a malformed stamp cannot pick the reference).
function referenceVersion(state) {
  if (!state || typeof state !== 'object') return null;
  for (const key of ['auditedVersion', 'previousVersion', 'version']) {
    if (typeof state[key] === 'string' && state[key].trim() !== '') return validVersion(state[key]);
  }
  return null;
}
// <<< version helpers <<<
const parseableVersion = (v) => parseVersion(v) !== null;
// A version read from the project (the state file, a manifest, VERSION) as
// report text. This report reaches Claude through the /tk:setup skill, and a
// cloned repository controls those files, so only a validated version is ever
// shown, with the prefix; anything else is named, never echoed.
// (referenceVersion stays in the block to keep the copies identical; this
// script reads the state keys one by one.)
function shownVersion(v, prefix) {
  if (typeof v !== 'string' || v.trim() === '') return 'no version';
  const t = validVersion(v);
  return t === null ? 'an unreadable version' : (prefix || '') + t;
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
// A project-relative path as shell text: bare when every character is safe,
// otherwise single-quoted (an inner single quote becomes '\'').
function shellQuote(rel) {
  return /^[A-Za-z0-9_.\/@%+=:,-]+$/.test(rel) ? rel : "'" + rel.replace(/'/g, "'\\''") + "'";
}
// The undo line for a fresh or plugin-mode run, or null when the run changed
// nothing. `u`: isRepo, created (files), createdDirs (deepest first), checkout
// (tracked files that were clean before), byHand (changed files git cannot restore).
function undoLine(u) {
  const q = (list) => list.map(shellQuote).join(' ');
  if (!u.created.length && !u.createdDirs.length && !u.checkout.length && !u.byHand.length) return null;
  const parts = [];
  if (!u.isRepo) parts.push('not a git repository, so there is no git undo');
  if (u.created.length) parts.push('delete ' + q(u.created));
  if (u.createdDirs.length) parts.push('then remove the new folders if empty: ' + q(u.createdDirs));
  if (u.checkout.length) parts.push('git checkout -- ' + q(u.checkout));
  if (u.byHand.length) parts.push('restore by hand (git holds no copy of them as they were): ' + q(u.byHand));
  return 'Undo: ' + parts.join(' ; ');
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
    plugin: 'already on the plugin (' + shownVersion(state && state.version, 'v') + ') - seed check only',
    'migrate-manifest': 'migration from copy-install ' + shownVersion(previousVersion, 'v') + ' (manifest present)',
    'migrate-unknown': 'migration from copy-install ' + shownVersion(previousVersion, 'v') + ' (NO manifest: provenance unknown)',
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
      // Kept and merged below, so nothing of the user's is lost and an edit to
      // one of them is no reason to page.
      if (KEEP_ON_MIGRATION.includes(rel)) continue;
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
    // artifacts/README.md is never removed by a migration (KEEP_ON_MIGRATION),
    // so the absent-after-removal rule below writes it only when it is absent.
    // .gitattributes is not listed here: it is line-merged further down.
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
  // Lines compare trimmed, against the file AND the lines already queued, so a
  // line the seed carries (seed/gitignore lists .claude/settings.local.json, and
  // the line below guarantees it for older seeds) is never written twice.
  const ignoreSeen = new Set(curIgnore.map(l => l.trim()));
  const ignoreAdd = [];
  for (const l of seedIgnore.concat(['.claude/settings.local.json'])) {
    const t = l.trim();
    if (t === '' || t.startsWith('#') || ignoreSeen.has(t)) continue;
    ignoreSeen.add(t);
    ignoreAdd.push(l);
  }

  // .gitattributes (issue #174). Absent: the seed is written whole, comments
  // included, as before. Present during a migration: every existing line stays
  // and only the seed's missing rules are appended (the old remove-and-reseed
  // replaced the file, so the merge is what a migration owes it; lines compare
  // with whitespace collapsed, so a rule spaced differently is not added twice).
  // Present on a fresh or plugin run: untouched, as it always was - the project
  // chose its own attributes and a new `* text=auto` could renormalize its files.
  const seedAttrsText = fs.readFileSync(path.join(seedDir, 'gitattributes'), 'utf8');
  const attrsExists = fs.existsSync(P('.gitattributes'));
  const curAttrs = attrsExists ? fs.readFileSync(P('.gitattributes'), 'utf8').split(/\r?\n/) : [];
  const attrKey = (l) => l.trim().replace(/\s+/g, ' ');
  const curAttrKeys = new Set(curAttrs.map(attrKey));
  const attrsAdd = attrsExists && migrating
    ? seedAttrsText.split(/\r?\n/).filter(l => l.trim() !== '' && !l.trim().startsWith('#') && !curAttrKeys.has(attrKey(l)))
    : [];

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
  const willExist = (rel) => fs.existsSync(P(rel)) && !willRemove.has(rel);
  const seedAllow = ((seedLocal.permissions && seedLocal.permissions.allow) || []).filter(p => !deadPermission(p, willExist));
  const local = readJson(P('.claude/settings.local.json'), null);
  const localBefore = local ? JSON.stringify(local) : null;
  const localNext = local || { permissions: { allow: [] } };
  localNext.permissions = localNext.permissions || {};
  localNext.permissions.allow = localNext.permissions.allow || [];
  const deadPerms = localNext.permissions.allow.filter(p => deadPermission(p, willExist));
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
  say('  .gitattributes: ' + (!attrsExists ? 'create from the seed' : migrating ? attrsAdd.length + ' lines to add (your lines are kept)' : 'already present (yours, untouched)'));
  const stateCmp = mode === 'plugin' ? compareVersions(version, state.version) : null;
  const stateRaise = mode === 'plugin' && (stateCmp === 1 || (stateCmp === null && parseableVersion(version) && !parseableVersion(state.version)));
  // The reference rule session-start.js and upgrade-audit.js read is
  // auditedVersion, else previousVersion, else version. With only `version` set,
  // raising it would move the reference, so the old value is kept as auditedVersion.
  const namesVersion = (v) => typeof v === 'string' && v.trim() !== '';
  const stateBackfill = stateRaise && !namesVersion(state.auditedVersion) && !namesVersion(state.previousVersion) && parseableVersion(state.version);
  if (mode === 'plugin') {
    say('  .claude/.toolkit-state.json: ' + (stateRaise ? shownVersion(state.version, 'version ') + ' -> ' + version
      + (stateBackfill ? ' (auditedVersion ' + validVersion(state.version) + ' recorded, so /tk:upgrade still audits from it)' : '')
      : shownVersion(state.version, 'version ') + ' kept' + (stateCmp === -1 ? ' (this plugin is older; a recorded version is never lowered)' : '')));
  }
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
  // What the undo line of a fresh or plugin-mode run needs, taken before anything
  // is written: the bytes of every file this run may write, whether each folder
  // it may create already exists, and for a tracked file whether it was clean
  // (a `git checkout --` would also discard an uncommitted edit made before the run).
  const mayWrite = seedWrite.map(s => s[0]).concat(['.gitignore', '.gitattributes', '.claude/settings.json', '.claude/settings.local.json', STATE_REL]);
  const bytesBefore = new Map(mayWrite.map(rel => [rel, fs.existsSync(P(rel)) ? fs.readFileSync(P(rel)) : null]));
  const mayCreateDirs = new Set(['plans', 'artifacts']);
  for (const rel of mayWrite) for (let d = path.posix.dirname(rel); d !== '.'; d = path.posix.dirname(d)) mayCreateDirs.add(d);
  const dirsBefore = new Map([...mayCreateDirs].map(d => [d, fs.existsSync(P(d))]));
  const cleanTracked = new Set();
  if (!migrating && top !== null) {
    const tracked = (git(['ls-files', '-z', '--', ...mayWrite], project) || '').split('\0').filter(Boolean);
    for (const rel of tracked) if (git(['diff', '--quiet', '--', rel], project) !== null) cleanTracked.add(rel);
  }

  let backupDir = null;
  if (migrating && (removed.length || localChanged || settingsChanged || ignoreAdd.length || attrsAdd.length)) {
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
    for (const rel of ['.claude/settings.local.json', '.claude/settings.json', '.gitignore', '.gitattributes']) backup(rel);
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
  if (!attrsExists) {
    fs.writeFileSync(P('.gitattributes'), seedAttrsText);
  } else if (attrsAdd.length) {
    const prefix = curAttrs.length && curAttrs[curAttrs.length - 1] !== '' ? '\n' : '';
    fs.appendFileSync(P('.gitattributes'), prefix + '\n# Added by the LLM Peer Review toolkit (/tk:setup)\n' + attrsAdd.join('\n') + '\n');
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
  // A fresh seed satisfies the running version by construction, so it is
  // audited at that version; a migration's custom files are not, and /tk:upgrade
  // stamps them after its audit.
  if (mode === 'fresh') { stateNext.auditedVersion = version; stateNext.auditedAt = stateNext.at; }
  if (mode !== 'plugin') {
    fs.writeFileSync(P(STATE_REL), JSON.stringify(stateNext, null, 2) + '\n');
  } else if (stateRaise) {
    // Re-run on the plugin: raise version and at, every other key as it was
    // (an existing auditedVersion and previousVersion included). When version
    // was the audit reference, its old value moves into auditedVersion first so
    // the reference stays put. An equal or older plugin writes nothing, which
    // keeps a repeat run idempotent.
    const backfill = stateBackfill ? Object.assign({ auditedVersion: validVersion(state.version) }, typeof state.at === 'string' ? { auditedAt: state.at } : {}) : {};
    fs.writeFileSync(P(STATE_REL), JSON.stringify(Object.assign({}, state, backfill, { version, at: stateNext.at }), null, 2) + '\n');
  }
  if (migrating) {
    fs.writeFileSync(P(MIGRATION_REL), JSON.stringify({
      at: stateNext.at, from: previousVersion, to: version, backupDir: backupDir ? path.relative(project, backupDir) : null,
      // A count, never the rows (see the header): the backup folder keeps them.
      removed, custom, deadPermissionCount: deadPerms.length,
      modified: modified.map(rel => ({ rel, backup: backupDir ? path.relative(project, path.join(backupDir, rel)) : null, pluginCopy: rel.startsWith('.claude/') ? rel.replace(/^\.claude\//, '') : null })),
    }, null, 2) + '\n');
  }

  // --- 6. Report ------------------------------------------------------------------
  say('');
  say('Done.');
  if (backupDir) say('  Backup: ' + path.relative(project, backupDir) + ' (every removed file, plus the settings, .gitignore and .gitattributes as they were)');
  if (migrating) {
    // The state and migration files are new and untracked, so `git checkout`
    // leaves them behind; left in place they would make the next run think the
    // project is already on the plugin.
    say('  Undo: git checkout -- .claude VERSION .gitattributes .gitignore ; then delete the seeded files listed above plus ' + STATE_REL + ' and ' + MIGRATION_REL + ', or restore from the backup folder.');
    say('  Next: run /tk:upgrade to audit your custom files against the ' + version + ' conventions' + (modified.length ? ' (it will carry your ' + modified.length + ' local edit(s) as findings)' : '') + '.');
  } else {
    say(mode === 'fresh' ? '  Next: /tk:explore. The codebase map generates on first use.' : '  Nothing to migrate; seed checked.');
    // Compared by bytes after the writes, so only what this run really created
    // or changed is named; a folder counts when it did not exist before.
    const created = [];
    const checkout = [];
    const byHand = [];
    for (const rel of mayWrite) {
      const was = bytesBefore.get(rel);
      if (!fs.existsSync(P(rel))) continue;
      if (was === null) created.push(rel);
      else if (!was.equals(fs.readFileSync(P(rel)))) (cleanTracked.has(rel) ? checkout : byHand).push(rel);
    }
    const createdDirs = [...dirsBefore].filter(([d, existed]) => !existed && fs.existsSync(P(d))).map(([d]) => d + '/')
      .sort((a, b) => (b.split('/').length - a.split('/').length) || a.localeCompare(b));
    const undo = undoLine({ isRepo: top !== null, created, createdDirs, checkout, byHand });
    if (undo) say('  ' + undo);
  }
  process.stdout.write(out.join('\n') + '\n');
}

if (require.main === module) main();

module.exports = { shellQuote, undoLine };
