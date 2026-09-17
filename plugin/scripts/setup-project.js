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
//   copy-install     no manifest (an install from before v5.5.0), recognized by
//   (no manifest)    .claude/commands/review.md beside VERSION (unless the
//                    rules file carries a 7.x stamp), or, for an install from
//                    before VERSION was copied into projects, a
//                    .claude/rules/toolkit.md that carries the old installer's
//                    managed-file comment (see copyInstallMarkers).
//                    The shipped managed-paths.json says which paths the
//                    installers managed, the helper scripts early ones copied
//                    to the project's root scripts/ folder included; every
//                    present one is provenance unknown, so the run pages
//                    before touching anything, and --force proceeds. A root
//                    helper script is swept only when its content (carriage
//                    returns ignored) matches a copy the toolkit shipped, as
//                    listed in managed-paths.json's historicalHelperHashes;
//                    any other file of that name is the project's own, kept
//                    with its permission rows and named (issue #180). With no
//                    VERSION of the toolkit's the old version is the stamp's,
//                    and a stamp that names no usable version is recorded as
//                    `unknown`, so /tk:upgrade audits every convention instead
//                    of none.
//
// Which VERSION is the toolkit's (see versionFileOwner): projects commonly keep
// a VERSION of their own at the root, so on every migration a VERSION file is
// the old copy-install's only when the install shape says the installer wrote
// it: the manifest lists it, .claude/commands/review.md sits beside it, or it
// holds exactly the version the rules-file stamp names. Any other VERSION is
// the project's: never removed or backed up, never on the undo line, never read
// as the old toolkit version. The report names VERSION whenever it is removed.
//
// A migration refuses to start on a dirty git tree (or outside a repo) unless
// --force (an untracked or modified .claude/settings.json alone is not dirty:
// the plugin install writes it), because the undo line it prints relies on git holding the tree as it was. It removes
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
// /tk:upgrade. That holds only for a project really new to the toolkit: this
// run wrote the rules file and found no plugin-era stamp. A project with no
// state file whose .claude/rules/toolkit.md already carries a 7.x stamp (a
// clone whose git ignores the state file) was set up on the plugin before, so
// the stamp's version, validated, becomes `previousVersion` and no
// `auditedVersion` is written: the version guard and /tk:upgrade then measure
// from that stamp (review of 7.1.0, R1). When that stamp is newer than the
// running plugin, the guard blocks pushes until the plugin is updated, and the
// report says so and sends the user to update the plugin, not to /tk:explore.
// In that case `version` records the stamp's version too, never the older
// running one: `upgrade-audit.js --stamp` refuses only when the state already
// records a newer `version` or `auditedVersion`, so an older `version` would let
// a /tk:upgrade on the older plugin write that older version as audited, which
// becomes the reference and silently lifts the block the report promised.
// A re-run on a project already on the
// plugin raises `version` and `at` to the running version when it is newer,
// never lowers them, and never changes an existing `auditedVersion` or
// `previousVersion`. When neither exists
// (every fresh 7.0.x install, whose setup did not write auditedVersion),
// `version` itself is the audit reference, so the raise first copies the old
// `version` (and `at`) into `auditedVersion` (and `auditedAt`): otherwise the
// raise would silently empty /tk:upgrade's audit range and hide its notice.
// When that old `version` is unreadable or missing there is no reference to
// keep, which /tk:upgrade reads as "audit every convention", so the raise
// records `previousVersion: 'unknown'` instead (the literal a migration uses for
// an unknown copy-install version) and the audit still covers everything
// (review of 7.1.0, R9).
// Every version read from the project is validated by the helpers shared with
// session-start.js and pre-push-check.js: a value of any other shape is never
// compared as a version and never echoed into the report.
//
// The migration record (.claude/.toolkit-migration.json) carries a count of the
// dead permission rows it removed, never the rows: they come from the
// gitignored settings.local.json and hold this machine's paths, and the backup
// folder's copy of that file already keeps them. The seed gitignores the record.
//
// Settings files (issue #180). .claude/settings.local.json is gitignored, so git
// holds no copy of it, and .claude/settings.json can carry uncommitted edits:
// every run that changes either one first copies it into a backup folder (the
// migration's .toolkit-backup-<stamp>-plugin name, made unique per run), so the
// undo line copies it back instead of saying "restore by hand". Outside a
// migration that folder holds only those files, is made only when an existing
// one changes, and no migration record is written. A settings file that is not
// valid JSON, or whose shape the merge cannot keep (permissions.allow not a
// list, say), is never replaced: the run pages with nothing written, in every
// mode, and --force skips that file byte for byte. A rewritten file keeps its
// own indentation, line endings and byte order mark. The report names the
// permission rows it adds and removes (JSON-escaped, at most ten, then a count).
//
// Offered rows (issue #180). A toolkit row the owner deleted stays deleted: the
// offered-rows record in the working copy's git directory (see its block below)
// lists every seed row this working copy was offered, and a listed row is not
// added again. A row counts as present in either spelling (`:*` or ` *`, for
// Bash and PowerShell rules) and in any permissions list: allow, ask or deny.
// With no record yet, missing rows are added one last time and named. When
// settings.local.json itself is missing the record does not filter: a missing
// file holds no decision of the owner's (a `git clean -x` removes it too), so
// every seed row is offered again. Outside a git repository nothing is
// recorded, and a missing row is added and named on every run. The record is
// not part of the undo line, which restores the working tree: after undoing a
// run that added rows to an existing file, the next run names those rows as
// offered before and says how to be offered them again.
//
// The undo line: every run that created, changed or deleted something prints an
// `Undo:` line built per path from what the run actually did, the same way on a
// migration and on a fresh or plugin-mode run, and ordered so that following it
// left to right restores the tree as it was: first `git checkout --` the tracked
// files the run changed or deleted (only paths git tracks, so the checkout never
// aborts on an unmatched pathspec; a tracked file that was clean, or missing from
// the working tree, before the run), then delete the files it created that git
// does not track, then remove the folders it created if empty, then copy back
// from the backup folder every other file it changed or deleted (an untracked or
// ignored file, or a tracked one with uncommitted edits) that the backup holds,
// then restore by hand the rest, then remove the backup folder. A run that
// changed nothing prints no undo line. Paths are project-relative and
// shell-quoted.
//
// Exit codes: 0 done (or nothing to do), 1 error, 3 paged (a decision is
// needed: locally modified files, provenance unknown, a dirty tree, or a
// settings file setup cannot merge without replacing it).
// --dry-run prints the same report and exit code and writes nothing.
//
// Dependency-free, like every script under .claude/scripts/. Run directly it
// sets up the project; required, it only exports the undo-line, copy-install
// marker, VERSION-owner, dead-permission, offered-rows, settings-format and
// backup-folder helpers for scripts/test-setup-project.js.

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
// every run (review of the v7.0.0 release, R2). The script name stops before a
// colon that ends it: Claude Code's "don't ask again" dialog wrote rows as
// `Bash(node .claude/scripts/our-report.js:*)` (it now writes the ` *` form,
// the same rule; see permissionRowKey), and reading that name as
// `our-report.js:` deleted a kept script's row on every run the same way.
// upgrade-audit.js carries the same regex; its test fails when the copies drift.
//
// Early installers copied their helper scripts to the project's ROOT scripts/
// folder (`node scripts/ask-gpt.js *`). A row for one of those counts as dead the
// same way, but only for the exact root paths the shipped managed-paths list
// names (`rootScripts`): projects commonly own a scripts/ folder, and a row for
// any other script there is the project's own and never touched.
const LEGACY_DEAD_PERMISSION = [
  // An old copy-install's absolute browse.js pipe row. Not a plugin cache row
  // (7.3.1 review, R1): those carry this machine's cache folder and are live.
  /^Bash\((echo|cat) \* \| node \/(?![^)]*\/plugins\/cache\/[^/)]+\/tk\/\*\/scripts\/browse\.js \*\)$)[^)]*\/(\.claude\/)?scripts\/browse\.js \*\)$/,
  /^Skill\(review-commands(:\*)?\)$/,
];
const ROOT_SCRIPT_ROW = /(?:^|[\s(])(?:\.\/)?scripts\/([^\s)'"*\/]+?):?(?=[\s)'"*]|$)/;
function deadPermission(row, willExist, rootScripts) {
  // The legacy shapes are written in the ` *` spelling, so a row is compared by
  // its permissionRowKey: the `:*` twin of the browse.js pipe is dead too (#180).
  if (LEGACY_DEAD_PERMISSION.some(re => re.test(permissionRowKey(row)))) return true;
  const m = /(?:^|[\s(])\.claude\/scripts\/([^\s)'"*]+?):?(?=[\s)'"*]|$)/.exec(row);
  if (m !== null) return !willExist('.claude/scripts/' + m[1]);
  const r = ROOT_SCRIPT_ROW.exec(row);
  return r !== null && !!rootScripts && rootScripts.has('scripts/' + r[1]) && !willExist('scripts/' + r[1]);
}
// >>> offered permission rows (issue #180) >>>
// Byte-identical in setup-project.js and upgrade-audit.js, from this marker to
// the closing one. Each script runs on its own (there is no shared module), so
// the block is copied; scripts/test-upgrade-audit.js fails when the copies drift.
//
// One rule, two spellings. Claude Code matches `Bash(ls:*)` exactly as it
// matches `Bash(ls *)`, so a Bash or PowerShell rule ending in `:*)` is the
// same rule as the one ending in ` *)`, and rows compare by permissionRowKey,
// which writes the ` *)` form. Only those two tools: in `Skill(tk:explore:*)` or
// `WebFetch(domain:github.com)` the colon belongs to the rule, so every other
// row compares exactly as written.
//
// The offered-rows record lists every toolkit seed permission row this working
// copy has been offered (found in its .claude/settings.local.json, or added
// there by /tk:setup), so a row the owner deleted afterwards is not offered
// again: /tk:setup does not add it back, and /tk:upgrade (C-9) does not report
// it missing. It lives in the working copy's git directory, at the path
// `git rev-parse --git-path tk-offered-rows.json` prints from the project, so
// git never commits it, no ignore line is needed, and a clone or another
// worktree starts with no record and is offered the rows again. Outside a git
// repository there is no record and nothing is remembered.
//
// Shape (version 1): { "version": 1, "offered": ["Bash(git add *)", ...] },
// where `offered` holds permissionRowKey values, sorted, each once. A missing
// file reads as status 'absent'. A file that cannot be read, is not valid JSON,
// or has any other shape reads as 'unreadable', which a caller treats as no
// record: the rows are offered once more and a new record is written.
const OFFERED_ROWS_FILE = 'tk-offered-rows.json';
const OFFERED_ROWS_VERSION = 1;
// The comparison key of a permission row: the row as written, except that a
// Bash or PowerShell rule ending in `:*)` gets the ` *)` ending. Null for a
// value that is not a string (no row).
function permissionRowKey(row) {
  if (typeof row !== 'string') return null;
  const m = /^(Bash|PowerShell)\(([\s\S]*):\*\)$/.exec(row);
  return m === null ? row : m[1] + '(' + m[2] + ' *)';
}
// The record's absolute path for the working copy at `dir`, or null outside a
// git repository (or when git cannot be run).
function offeredRowsPath(dir) {
  let out;
  try { out = execFileSync('git', ['rev-parse', '--git-path', OFFERED_ROWS_FILE], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return null; }
  const printed = out.replace(/\r?\n$/, '');
  return printed === '' ? null : path.resolve(dir, printed);
}
// { status: 'absent' | 'unreadable' | 'ok', keys }: `keys` is a Set of the
// recorded keys, empty unless the status is 'ok'.
function readOfferedRows(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) { return { status: e && e.code === 'ENOENT' ? 'absent' : 'unreadable', keys: new Set() }; }
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  const ok = data !== null && typeof data === 'object' && !Array.isArray(data) && data.version === OFFERED_ROWS_VERSION
    && Array.isArray(data.offered) && data.offered.every(k => typeof k === 'string');
  return ok ? { status: 'ok', keys: new Set(data.offered.map(permissionRowKey)) } : { status: 'unreadable', keys: new Set() };
}
// Writes the record listing `keys` (any iterable of keys, sorted and each kept
// once here) through a temporary file renamed over the record, so a reader
// never sees half a file. True when written, false when it could not be.
function writeOfferedRows(file, keys) {
  const offered = [...new Set(keys)].filter(k => typeof k === 'string').sort();
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify({ version: OFFERED_ROWS_VERSION, offered }, null, 2) + '\n');
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch (e2) { /* nothing left to clean */ }
    return false;
  }
}
// The plugin's own script rows (issues #185, #188, and the 7.3.1 review, R1).
// A plugin command types its scripts at the path ${CLAUDE_PLUGIN_ROOT} expands
// to, the versioned cache folder, so the seed names that folder with the
// placeholder <tk-plugin-cache>, which stands for the folder that holds every
// installed tk version. It is filled in with this machine's own folder, never a
// leading wildcard: a row starting `node */...` also matched
// `node -e "<code>" /.../scripts/x.js`, so inline code ran unasked (measured).
// With the full folder in front, only a command that runs a file inside it
// matches. Returns the rows with the placeholder filled in, and drops those rows
// when the plugin does not run from the cache (a --plugin-dir build), where no
// folder can be named safely.
const PLUGIN_CACHE_MARK = '<tk-plugin-cache>';
function pluginCacheFolder(pluginRoot) {
  const root = typeof pluginRoot === 'string' ? pluginRoot.replace(/[\\/]+$/, '') : '';
  const m = /^(.*[\\/]plugins[\\/]cache[\\/][^\\/]+[\\/]tk)[\\/][^\\/]+$/.exec(root);
  return m === null ? null : m[1].split('\\').join('/');
}
function fillPluginCache(rows, pluginRoot) {
  const folder = pluginCacheFolder(pluginRoot);
  return rows.filter(r => typeof r === 'string').flatMap(r => {
    if (!r.includes(PLUGIN_CACHE_MARK)) return [r];
    return folder === null ? [] : [r.split(PLUGIN_CACHE_MARK).join(folder)];
  });
}
// <<< offered permission rows <<<

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
// The one plugin update instruction (issue #183), used by the version notice in
// session-start.js, the version block in pre-push-check.js and the stamp report
// in setup-project.js, and quoted word for word by the docs. The marketplace
// update comes first: measured on Claude Code 2.1.270, `claude plugin update`
// alone does not fetch a GitHub marketplace's cached catalog, so a new release
// tag is not seen until `claude plugin marketplace update` has run. A plugin
// installed for one project only takes the same update with --scope project.
// It reads as the middle of a sentence: each caller adds the words before it
// and the punctuation after it.
const PLUGIN_UPDATE_STEPS = 'run `claude plugin marketplace update llm-peer-review`, then `claude plugin update tk@llm-peer-review`'
  + ' (for a plugin installed for this project only, the same update with `--scope project`: `claude plugin update tk@llm-peer-review --scope project`),'
  + ' then restart Claude Code';
// <<< version helpers <<<
// >>> copy-install markers (7.1.0) >>>
// Byte-identical in setup-project.js and session-start.js, from this marker to
// the closing one (it uses the version helpers above);
// scripts/test-session-start.js fails when the copies drift.
//
// The files an old copy-install left in one folder, each something a project of
// its own would not have by accident:
//   manifest     .claude/.toolkit-manifest.json, written by installers from v5.5.0;
//   versionFile  VERSION beside .claude/commands/review.md (setup.sh copied
//                VERSION into projects from v4.0, setup.ps1 only from v5.1);
//   stamp        a .claude/rules/toolkit.md carrying the managed-file comment
//                the installers wrote into it: `<!-- Toolkit version: X |
//                Managed by LLM Peer Review` from v1.4, or before that `<!-- This
//                file is managed by the LLM Peer Review toolkit.` This is how an
//                install from before VERSION was copied into projects is
//                recognized. It needs no review.md beside it: the toolkit
//                shipped no review.md command for part of that era (removed in
//                v2, back in v3.5), and the comment alone is the toolkit's own.
// A stamp naming 7.0.0 or later is no marker, and it also cancels versionFile:
// /tk:setup seeds that same file stamped with the plugin version, and the
// toolkit's own repository carries it beside its own VERSION and review.md,
// while every installer that wrote a 7.x stamp also wrote a manifest, which
// stays a marker. A project with its own review.md and no marker has none.
// Only the presence of VERSION is read here, never its content, and a marker
// says nothing about whose VERSION it is (setup-project.js's versionFileOwner
// decides that for a migration).
// Returns { manifest, versionFile, stamp }, stamp null or { version } where
// version is validated (null when the stamp names no usable version).
const COPY_STAMP = /<!-- Toolkit version: ([^|\r\n]*)\| Managed by LLM Peer Review/;
const COPY_STAMP_EARLY = /<!-- This file is managed by the LLM Peer Review toolkit\./;
const COPY_STAMP_READ_BYTES = 4096;
function copyInstallMarkers(dir) {
  const isFile = (rel) => { try { return fs.statSync(path.join(dir, rel)).isFile(); } catch (e) { return false; } };
  const found = { manifest: isFile(path.join('.claude', '.toolkit-manifest.json')), versionFile: false, stamp: null };
  let pluginStamp = false;
  const rules = path.join('.claude', 'rules', 'toolkit.md');
  if (isFile(rules)) {
    let head = null;
    try {
      const fd = fs.openSync(path.join(dir, rules), 'r');
      try {
        const buf = Buffer.alloc(COPY_STAMP_READ_BYTES);
        head = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0));
      } finally { fs.closeSync(fd); }
    } catch (e) { head = null; }
    const m = head === null ? null : COPY_STAMP.exec(head);
    if (m) {
      const v = validVersion(m[1]);
      if (v !== null && compareVersions(v, '7.0.0') !== -1) pluginStamp = true;
      else found.stamp = { version: v };
    } else if (head !== null && COPY_STAMP_EARLY.test(head)) {
      found.stamp = { version: null };
    }
  }
  found.versionFile = !pluginStamp && isFile(path.join('.claude', 'commands', 'review.md')) && isFile('VERSION');
  return found;
}
// <<< copy-install markers <<<
// Whose VERSION file sits at the project root, for a migration: why it is the
// old copy-install's, or null when it is the project's own. Apps commonly keep
// a VERSION of their own, and an early install recognized by its rules-file
// stamp alone used to take that file for the toolkit's: its release number
// became previousVersion, --force deleted it, and a number above the plugin's
// then made the version guard block every push. So it is the toolkit's only
// when the install shape says the installer wrote it:
//   'manifest'  the copy-install manifest lists VERSION;
//   'review'    it sits beside .claude/commands/review.md (the versionFile
//               marker, which a 7.x stamp already cancels);
//   'stamp'     its trimmed content is exactly the version the old rules-file
//               stamp names (a validated one; a stamp naming none matches nothing).
// `markers` is copyInstallMarkers' result, `manifest` the parsed manifest or
// null, `versionText` the file's trimmed content or null when there is no file.
function versionFileOwner(markers, manifest, versionText) {
  if (typeof versionText !== 'string') return null;
  const files = manifest && manifest.files && typeof manifest.files === 'object' ? manifest.files : null;
  if (files && Object.prototype.hasOwnProperty.call(files, 'VERSION')) return 'manifest';
  if (markers && markers.versionFile) return 'review';
  if (markers && markers.stamp && markers.stamp.version !== null && versionText === markers.stamp.version) return 'stamp';
  return null;
}
const VERSION_OWNER_REASON = {
  manifest: 'the copy-install manifest lists it',
  review: 'it sits beside .claude/commands/review.md',
  stamp: 'it holds the same version as the toolkit stamp in .claude/rules/toolkit.md',
};
// The version a plugin-era stamp in dir's .claude/rules/toolkit.md names (7.0.0
// or later, validated), or null. copyInstallMarkers reads the same stamp but
// treats a 7.x one as no marker and reports nothing about it, and its block
// must stay byte-identical with session-start.js, so the fresh branch reads it
// here. Found with no state file, it means the project was set up on the plugin
// before (a clone whose git ignores the state file), so it is not new.
function pluginEraStamp(dir) {
  const abs = path.join(dir, '.claude', 'rules', 'toolkit.md');
  let head = null;
  try {
    if (!fs.statSync(abs).isFile()) return null;
    const fd = fs.openSync(abs, 'r');
    try {
      const buf = Buffer.alloc(COPY_STAMP_READ_BYTES);
      head = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0));
    } finally { fs.closeSync(fd); }
  } catch (e) { return null; }
  const m = COPY_STAMP.exec(head);
  const v = m ? validVersion(m[1]) : null;
  return v !== null && compareVersions(v, '7.0.0') !== -1 ? v : null;
}
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
// How a JSON file is laid out, so a rewrite keeps it (issue #180): the
// indentation of its least indented line (two spaces when no line is indented,
// which covers a new file), CRLF line endings when it has any, and a leading
// byte order mark when it has one.
function jsonFormat(text) {
  let indent = null;
  for (const m of text.matchAll(/^([ \t]+)\S/gm)) if (indent === null || m[1].length < indent.length) indent = m[1];
  return { indent: indent === null ? '  ' : indent, eol: text.includes('\r\n') ? '\r\n' : '\n', bom: text.charCodeAt(0) === 0xFEFF ? String.fromCharCode(0xFEFF) : '' };
}
// JSON text for `value` in `format` (jsonFormat), ending in a line break.
// JSON.stringify puts a line break only between tokens, never inside a string,
// so every one of them can take the file's own line ending.
function formatJson(value, format) {
  return format.bom + JSON.stringify(value, null, format.indent).split('\n').join(format.eol) + format.eol;
}
const isJsonObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// What the settings.local.json merge needs (issue #180): an object whose
// `permissions`, when present, is an object, whose `allow` and
// `additionalDirectories`, when present, are lists. A non-list `allow` threw a
// TypeError in the merge before this check.
function localSettingsProblem(data) {
  if (!isJsonObject(data)) return 'is not a JSON object';
  if (data.permissions === undefined) return null;
  if (!isJsonObject(data.permissions)) return 'has a "permissions" value that is not an object';
  for (const key of ['allow', 'additionalDirectories']) {
    if (data.permissions[key] !== undefined && !Array.isArray(data.permissions[key])) return 'has a "permissions.' + key + '" value that is not a list';
  }
  return null;
}
// What the settings.json key merge needs: an object whose two plugin keys,
// when present, are objects (a string there made the merge throw, and a list
// silently never gained the plugin keys).
function sharedSettingsProblem(data) {
  if (!isJsonObject(data)) return 'is not a JSON object';
  for (const key of ['extraKnownMarketplaces', 'enabledPlugins']) {
    if (data[key] !== undefined && !isJsonObject(data[key])) return 'has an "' + key + '" value that is not an object';
  }
  return null;
}
// A settings file this run may merge into, read so that nothing in it is lost
// (issue #180; readJson's silent fallback let a file with one trailing comma
// be replaced by the seed). Returns { exists, data, problem, format }: `data`
// is the parsed object, null when the file is absent or has a problem;
// `problem` is null or fixed text saying why the file cannot be merged (it
// cannot be read, is not valid JSON, or `shapeProblem` refuses it), never a
// quote of the file, which a cloned repository controls for settings.json and
// this report reaches Claude; `format` is how the file is written back.
function readSettings(abs, shapeProblem) {
  if (!fs.existsSync(abs)) return { exists: false, data: null, problem: null, format: jsonFormat('') };
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch (e) { return { exists: true, data: null, problem: 'cannot be read', format: jsonFormat('') }; }
  const format = jsonFormat(text);
  let data;
  try { data = JSON.parse(format.bom ? text.slice(1) : text); } catch (e) { return { exists: true, data: null, problem: 'is not valid JSON', format }; }
  const problem = shapeProblem(data);
  return { exists: true, data: problem === null ? data : null, problem, format };
}
// Permission rows as report text (issue #180): each JSON-escaped, so no row can
// carry a line break into the report, at most ROWS_NAMED of them, then a count.
const ROWS_NAMED = 10;
function namedRows(rows) {
  const shown = rows.slice(0, ROWS_NAMED).map(r => JSON.stringify(r)).join(', ');
  return rows.length > ROWS_NAMED ? shown + ' and ' + (rows.length - ROWS_NAMED) + ' more' : shown;
}
// The CR-stripped sha256 values of every copy of the root helper script `rel`
// the toolkit ever shipped, from the shipped managed-paths.json field
// `historicalHelperHashes` ({ "scripts/browse.js": ["<sha256>", ...], ... }).
// A missing or malformed field or entry lists none, so the file is kept.
function helperHashes(field, rel) {
  const list = isJsonObject(field) && Object.prototype.hasOwnProperty.call(field, rel) ? field[rel] : null;
  return new Set(Array.isArray(list) ? list.filter(h => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)) : []);
}
// Makes the backup folder at the project root and returns its path:
// .toolkit-backup-<UTC yyyymmdd-hhmmss>-plugin, or -2-plugin, -3-plugin and so
// on when that name is taken (issue #180). The folder is made without
// `recursive`, which fails when it already exists, so two runs in the same
// second never share a folder and no run writes into an older backup.
function createBackupDir(project, now) {
  const stamp = (now || new Date()).toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  for (let n = 1; n <= 1000; n++) {
    const dir = path.join(project, '.toolkit-backup-' + stamp + (n === 1 ? '' : '-' + n) + '-plugin');
    try { fs.mkdirSync(dir); return dir; } catch (e) { if (!e || e.code !== 'EEXIST') throw e; }
  }
  throw new Error('no free backup folder name for ' + stamp);
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
// The undo line of any run, or null when the run changed nothing. `u`: isRepo,
// checkout (tracked files to `git checkout --`), created (untracked files to
// delete), createdDirs (deepest first), restore (files to copy back from
// backupDir), byHand (changed files nothing here holds a copy of), backupDir
// (the backup folder, removed last), notRestored (folders deleted for good).
// Missing lists count as empty. Clauses run left to right in that order, and
// "then" joins each action to the one before it, never the first (a run whose
// only change is a new folder, plans/ recreated on a re-run, starts with the
// folder clause).
function undoLine(u) {
  const q = (list) => list.map(shellQuote).join(' ');
  const L = (k) => Array.isArray(u[k]) ? u[k] : [];
  const actions = [];
  if (L('checkout').length) actions.push('git checkout -- ' + q(L('checkout')));
  if (L('created').length) actions.push('delete ' + q(L('created')));
  if (L('createdDirs').length) actions.push('remove the new folders if empty: ' + q(L('createdDirs')));
  if (L('restore').length) actions.push('copy back from the backup folder ' + shellQuote(u.backupDir + '/') + ': ' + q(L('restore')));
  if (L('byHand').length) actions.push('restore by hand (git holds no copy of them as they were): ' + q(L('byHand')));
  if (u.backupDir) actions.push('remove the backup folder: ' + shellQuote(u.backupDir + '/'));
  const notes = L('notRestored').length ? ['not restored (reinstall the packages only if you still need them): ' + q(L('notRestored'))] : [];
  if (!actions.length && !notes.length) return null;
  const parts = [];
  if (!u.isRepo) parts.push('not a git repository, so there is no git undo');
  actions.forEach((a, i) => parts.push((i ? 'then ' : '') + a));
  return 'Undo: ' + parts.concat(notes).join(' ; ');
}
// NUL-separated path output of a git command, pathspecs read literally (so a
// name with a glob character matches only itself); [] outside a repo or on error.
function gitPaths(args, cwd) {
  try {
    return execFileSync('git', ['--literal-pathspecs', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
      .split('\0').filter(Boolean);
  } catch (e) { return []; }
}
const readIfFile = (abs) => { try { return fs.statSync(abs).isFile() ? fs.readFileSync(abs) : null; } catch (e) { return null; } };
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
  const managedPaths = readJson(path.join(pluginRoot, 'managed-paths.json'), { paths: [] });
  const managedShipped = managedPaths.paths;
  // The root scripts/ files early installers copied, exactly as the shipped list names them.
  const ROOT_SCRIPTS = new Set(managedShipped.filter(rel => /^scripts\/[^/]+$/.test(rel)));
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
  const markers = copyInstallMarkers(project);
  const versionFileBytes = readIfFile(P('VERSION'));
  const hasVersionFile = versionFileBytes !== null;
  let mode;
  if (state) mode = 'plugin';
  else if (manifest && manifest.files) mode = 'migrate-manifest';
  else if (markers.versionFile || markers.stamp) mode = 'migrate-unknown';
  else mode = 'fresh';
  // The toolkit's VERSION, or none: a project's own VERSION is never read as
  // the old toolkit version, never removed, never backed up (versionFileOwner).
  const versionOwner = versionFileOwner(markers, manifest, hasVersionFile ? versionFileBytes.toString('utf8').trim() : null);
  const toolkitVersionFile = versionOwner !== null;
  // No VERSION of the toolkit's (none at all, or the project's own): an install
  // from before VERSION was copied into projects, whose version is the rules
  // file's stamp, validated; a stamp that names none is recorded as `unknown`,
  // which no reader takes for a version, so /tk:upgrade audits every convention
  // rather than none (a null would fall through to the plugin version and empty
  // its range). A migrate-unknown run without the toolkit's VERSION always has
  // the stamp: the other marker, VERSION beside review.md, makes it the toolkit's.
  const fromStamp = mode === 'migrate-unknown' && !toolkitVersionFile;
  const previousVersion = manifest && manifest.toolkitVersion ? manifest.toolkitVersion
    : toolkitVersionFile ? versionFileBytes.toString('utf8').trim()
    : fromStamp ? (markers.stamp.version || 'unknown') : null;
  const shownPrevious = fromStamp && !markers.stamp.version ? 'of an unknown version' : shownVersion(previousVersion, 'v');
  // A fresh-looking project whose rules file already carries a plugin-era
  // stamp: set up on the plugin before, its state file missing (R1).
  const priorPluginStamp = mode === 'fresh' ? pluginEraStamp(project) : null;
  // How that stamp stands against this plugin: -1 the project is behind (audit
  // the range), 0 level, 1 a newer plugin seeded it, which the version guard
  // blocks pushes on until this plugin is updated, so the report says so.
  const priorStampCmp = priorPluginStamp !== null ? compareVersions(priorPluginStamp, version) : null;

  say('LLM Peer Review toolkit - project setup (plugin ' + PLUGIN + '@' + MARKETPLACE + ' v' + version + ')');
  say('  Project: ' + project);
  say('  Install type: ' + ({
    plugin: 'already on the plugin (' + shownVersion(state && state.version, 'v') + ') - seed check only',
    'migrate-manifest': 'migration from copy-install ' + shownPrevious + ' (manifest present)',
    'migrate-unknown': 'migration from copy-install ' + shownPrevious + ' (NO manifest: provenance unknown)',
    fresh: 'fresh install',
  })[mode]);
  if (fromStamp) {
    say('  ' + (hasVersionFile ? 'No VERSION file of the toolkit\'s' : 'No VERSION file') + ': recognized by the toolkit stamp in .claude/rules/toolkit.md (an install from before VERSION was copied into projects); '
      + (markers.stamp.version ? 'its version is read from that stamp.' : 'the stamp names no version, so it is recorded as unknown and /tk:upgrade audits every convention.'));
  }
  if (priorPluginStamp !== null) {
    say('  No .claude/.toolkit-state.json, but .claude/rules/toolkit.md already carries the plugin\'s stamp ' + priorPluginStamp
      + ': this project was set up on the plugin before (a clone whose git ignores the state file looks like this). previousVersion '
      + priorPluginStamp + (priorStampCmp === 1 ? ' and version ' + priorPluginStamp + ' (never lower than the stamp) are' : ' is') + ' recorded and no audited version, '
      + (priorStampCmp === 1 ? 'but this plugin (v' + version + ') is older than that stamp: pushes from this project will be blocked by the pre-push check until the plugin is updated. To update it, '
          + PLUGIN_UPDATE_STEPS + '.'
        : priorStampCmp === 0 ? 'which is this plugin\'s own version, so /tk:upgrade has no conventions to audit.'
        : 'so /tk:upgrade audits from ' + priorPluginStamp + '.'));
  }
  if (opts.dryRun) say('  Dry run: nothing will be written.');

  // --- 2. Migration plan -----------------------------------------------------
  const removed = [];       // rels to delete (backed up first)
  const modified = [];      // locally modified managed files (rel)
  const custom = [];        // files kept in managed dirs
  const rootKept = [];      // root helper-script names whose content is the project's own (#180)
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
      // The shipped list names VERSION, but only the toolkit's own is swept.
      if (rel === 'VERSION' && !toolkitVersionFile) continue;
      // A root helper script is the toolkit's only when its content matches a
      // copy the toolkit shipped (issue #180): projects commonly own a
      // scripts/browse.js, and the name alone once swept it. Anything else
      // stays, and so does its permission row, since the file will still exist.
      if (mode === 'migrate-unknown' && ROOT_SCRIPTS.has(rel) && !helperHashes(managedPaths.historicalHelperHashes, rel).has(sha256NoCR(P(rel)))) {
        rootKept.push(rel);
        continue;
      }
      if (mode === 'migrate-manifest') {
        if (sha256NoCR(P(rel)) !== manifest.files[rel]) modified.push(rel);
      }
      removed.push(rel);
    }
    for (const rel of [MANIFEST_REL].concat(toolkitVersionFile ? ['VERSION'] : [])) if (readIfFile(P(rel)) !== null && !removed.includes(rel)) removed.push(rel);
    const managedSet = new Set(removed);
    for (const dir of MANAGED_DIRS) for (const rel of walkFiles(P(dir), dir, [])) if (!managedSet.has(rel)) custom.push(rel);
    if (modified.length && !opts.force) paged = true;
    if (mode === 'migrate-unknown' && !opts.force) paged = true;

    say('  Managed toolkit files to remove: ' + removed.length + (mode === 'migrate-unknown' ? ' (from the shipped managed-paths list; none can be verified against a manifest)' : ''));
    const rootRemoved = removed.filter(rel => ROOT_SCRIPTS.has(rel));
    if (rootRemoved.length) say('  Among them, helper scripts an early installer copied to the root scripts/ folder, each matching a copy the toolkit shipped (every other file there is yours, untouched): ' + rootRemoved.join(', '));
    if (rootKept.length) {
      const one = rootKept.length === 1;
      say('  Kept as your own: ' + rootKept.join(', ') + ' in the root scripts/ folder ' + (one ? 'carries the name of a helper script' : 'carry the names of helper scripts') + ' an early installer copied there, but '
        + (one ? 'its' : 'their') + ' content matches no copy the toolkit shipped, so ' + (one ? 'it stays untouched, and so do its' : 'they stay untouched, and so do their') + ' permission rows.');
    }
    // Named either way, so the owner can object before a project's own VERSION goes.
    if (removed.includes('VERSION')) {
      say('  Among them, VERSION at the project root, as the toolkit\'s because ' + VERSION_OWNER_REASON[versionOwner]
        + '. If VERSION is your project\'s own file, stop here and say so (a finished run keeps a copy in the backup folder).');
    } else if (hasVersionFile) {
      say('  VERSION at the project root is yours, kept untouched and not read as the toolkit version: no manifest lists it, no .claude/commands/review.md sits beside it, and it does not hold the toolkit stamp\'s version.');
    }
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
  // A fresh run is audited at the running version only when the project is
  // really new to the toolkit: this run seeds the rules file, and no plugin-era
  // stamp was there before it (R1). A rules file this run does not write is not
  // known to satisfy the running version, so nothing claims it was audited.
  const rulesSeeded = seedWrite.some(s => s[0] === '.claude/rules/toolkit.md');
  const freshAudited = mode === 'fresh' && rulesSeeded && priorPluginStamp === null;
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

  // .claude/settings.json key merge (the plugin registration for collaborators).
  // A settings file the merge cannot keep whole is never replaced (issue #180):
  // the run pages, and with --force the file is skipped, byte for byte.
  const sharedRead = readSettings(P('.claude/settings.json'), sharedSettingsProblem);
  const settings = sharedRead.problem === null ? (sharedRead.data || {}) : null;
  let settingsChanged = false;
  if (settings !== null) {
    const settingsBefore = JSON.stringify(settings);
    settings.extraKnownMarketplaces = settings.extraKnownMarketplaces || {};
    settings.extraKnownMarketplaces[MARKETPLACE] = settings.extraKnownMarketplaces[MARKETPLACE] || { source: { source: 'github', repo: MARKETPLACE_REPO } };
    settings.enabledPlugins = settings.enabledPlugins || {};
    settings.enabledPlugins[PLUGIN + '@' + MARKETPLACE] = true;
    settingsChanged = JSON.stringify(settings) !== settingsBefore;
  }

  // settings.local.json: baseline merge minus the script entries, dead entries out
  const seedLocal = readJson(path.join(seedDir, 'settings.local.json'), { permissions: { allow: [] } });
  const willExist = (rel) => fs.existsSync(P(rel)) && !willRemove.has(rel);
  const seedAllow = fillPluginCache((seedLocal.permissions && seedLocal.permissions.allow) || [], pluginRoot).filter(p => typeof p === 'string' && !deadPermission(p, willExist, ROOT_SCRIPTS));
  // Seed ask rows (issue #192): Claude Code asks before these even when an allow
  // row matches, so the broad `Bash(git push *)` never lets a force push through
  // unasked. They merge exactly like allow rows, into the project's ask list.
  const seedAsk = ((seedLocal.permissions && seedLocal.permissions.ask) || []).filter(p => typeof p === 'string');
  const localRead = readSettings(P('.claude/settings.local.json'), localSettingsProblem);
  const localSkip = localRead.problem !== null;
  const local = localSkip ? null : localRead.data;
  if ((sharedRead.problem !== null || localSkip) && !opts.force) paged = true;
  // The offered-rows record (issue #180; see its block above): null outside a
  // git repository, where nothing is recorded.
  const recordFile = top !== null ? offeredRowsPath(project) : null;
  const record = recordFile !== null ? readOfferedRows(recordFile) : { status: 'absent', keys: new Set() };
  const recordShown = recordFile === null ? null
    : (() => { const rel = path.relative(project, recordFile); return rel.startsWith('..') || path.isAbsolute(rel) ? recordFile : rel.split(path.sep).join('/'); })();
  const deadPerms = [];
  const addedPerms = [];
  const addedAsk = [];      // the added rows that go to the ask list, a subset of addedPerms
  const heldBack = [];      // seed rows left out: this working copy was offered them before
  let localNext = null;
  let localChanged = false;
  let offeredNext = null;   // the keys the record lists after this run, or null when it is not written
  if (!localSkip) {
    const localBefore = local ? JSON.stringify(local) : null;
    localNext = local || { permissions: { allow: [] } };
    localNext.permissions = localNext.permissions || {};
    localNext.permissions.allow = localNext.permissions.allow || [];
    deadPerms.push(...localNext.permissions.allow.filter(p => deadPermission(p, willExist, ROOT_SCRIPTS)));
    localNext.permissions.allow = localNext.permissions.allow.filter(p => !deadPerms.includes(p));
    // A seed row is present when any permissions list holds it in either
    // spelling: `Bash(git status:*)` is `Bash(git status *)` (issue #179), and a
    // row the owner moved to ask or deny is their decision too.
    const present = new Set(['allow', 'ask', 'deny'].flatMap(k => (Array.isArray(localNext.permissions[k]) ? localNext.permissions[k] : [])).map(permissionRowKey));
    // The record filters only rows missing from a file that exists: a missing
    // file holds no decision of the owner's, so every seed row is offered again.
    const offeredBefore = record.status === 'ok' && local !== null ? record.keys : new Set();
    const seedKeys = new Set();
    for (const [list, rows] of [['allow', seedAllow], ['ask', seedAsk]]) {
      for (const p of rows) {
        const k = permissionRowKey(p);
        if (seedKeys.has(k)) continue;
        seedKeys.add(k);
        if (present.has(k)) continue;
        if (offeredBefore.has(k)) heldBack.push(p);
        else {
          addedPerms.push(p);
          if (list === 'ask') addedAsk.push(p);
        }
      }
    }
    localNext.permissions.allow.push(...addedPerms.filter(p => !addedAsk.includes(p)));
    if (addedAsk.length) {
      localNext.permissions.ask = Array.isArray(localNext.permissions.ask) ? localNext.permissions.ask : [];
      localNext.permissions.ask.push(...addedAsk);
    }
    if (seedLocal.defaultMode && !localNext.defaultMode) localNext.defaultMode = seedLocal.defaultMode;
    if (seedLocal.permissions && seedLocal.permissions.additionalDirectories) {
      localNext.permissions.additionalDirectories = localNext.permissions.additionalDirectories || [];
      for (const d of seedLocal.permissions.additionalDirectories) if (!localNext.permissions.additionalDirectories.includes(d)) localNext.permissions.additionalDirectories.push(d);
    }
    localChanged = JSON.stringify(localNext) !== localBefore;
    // Every seed row was present, added, or offered before, so after this run
    // each one counts as offered, beside every row an earlier run recorded.
    if (recordFile !== null) offeredNext = new Set([...(record.status === 'ok' ? record.keys : []), ...seedKeys]);
  }
  const recordChanged = offeredNext !== null && (record.status !== 'ok' || offeredNext.size !== record.keys.size);

  say('  Seed files to write: ' + (seedWrite.length ? seedWrite.map(s => s[0]).join(', ') : '(none)'));
  if (seedSkip.length) say('  Seed files already present (yours, untouched): ' + seedSkip.join(', '));
  if (mode === 'fresh' && !rulesSeeded && priorPluginStamp === null) say('  .claude/rules/toolkit.md is already present with no toolkit stamp, so it is not seeded and no audited version is recorded.');
  say('  .gitignore lines to add: ' + ignoreAdd.length);
  say('  .gitattributes: ' + (!attrsExists ? 'create from the seed' : migrating ? attrsAdd.length + ' lines to add (your lines are kept)' : 'already present (yours, untouched)'));
  const stateCmp = mode === 'plugin' ? compareVersions(version, state.version) : null;
  const stateRaise = mode === 'plugin' && (stateCmp === 1 || (stateCmp === null && parseableVersion(version) && !parseableVersion(state.version)));
  // The reference rule session-start.js and upgrade-audit.js read is
  // auditedVersion, else previousVersion, else version. With only `version` set,
  // raising it would move the reference, so the old value is kept as auditedVersion.
  const namesVersion = (v) => typeof v === 'string' && v.trim() !== '';
  const stateBackfill = stateRaise && !namesVersion(state.auditedVersion) && !namesVersion(state.previousVersion) && parseableVersion(state.version);
  // The same raise over an unreadable or missing `version`: there was no usable
  // reference, which /tk:upgrade reads as "audit every convention". Raising
  // `version` alone would make it the reference and empty the range, so
  // previousVersion records `unknown`, which no reader takes for a version (R9).
  const stateUnknownStart = stateRaise && !namesVersion(state.auditedVersion) && !namesVersion(state.previousVersion) && !parseableVersion(state.version);
  if (mode === 'plugin') {
    say('  .claude/.toolkit-state.json: ' + (stateRaise ? shownVersion(state.version, 'version ') + ' -> ' + version
      + (stateBackfill ? ' (auditedVersion ' + validVersion(state.version) + ' recorded, so /tk:upgrade still audits from it)' : '')
      + (stateUnknownStart ? ' (previousVersion recorded as unknown, so /tk:upgrade still audits every convention)' : '')
      : shownVersion(state.version, 'version ') + ' kept' + (stateCmp === -1 ? ' (this plugin is older; a recorded version is never lowered)' : '')));
  }
  // A settings file setup cannot merge (issue #180): named with a fixed reason, never quoted.
  const cannotMerge = (read, what) => (opts.force
    ? 'skipped (--force): the file ' + read.problem + ', so it is left exactly as it is and ' + what
    : 'cannot be merged: the file ' + read.problem + ', and setup never replaces a settings file it cannot merge, so it pages instead (see below)');
  say('  .claude/settings.json: ' + (sharedRead.problem !== null ? cannotMerge(sharedRead, 'the plugin is not registered in it')
    : settingsChanged ? 'register marketplace ' + MARKETPLACE + ' and enable ' + PLUGIN + ' (the first push will page on this change: that is the tripwire doing its job)' : 'already registers the plugin'));
  if (localSkip) say('  .claude/settings.local.json: ' + cannotMerge(localRead, 'no permission row is added or removed'));
  else {
    say('  .claude/settings.local.json: ' + (local ? 'merge' : 'create') + ' (' + addedPerms.length + ' entries added, ' + deadPerms.length + ' dead script entries removed)');
    // The rows by name (issue #180): the counts alone left a removed row named nowhere.
    if (addedPerms.length) say('    added: ' + namedRows(addedPerms));
    if (addedAsk.length) say('    of those, added to the ask list (Claude asks before these even when an allow row matches): ' + namedRows(addedAsk));
    if (deadPerms.length) say('    removed: ' + namedRows(deadPerms));
    if (heldBack.length) {
      say('    not added again (' + heldBack.length + '), because this working copy was offered ' + (heldBack.length === 1 ? 'it' : 'them') + ' before and the file no longer has '
        + (heldBack.length === 1 ? 'it' : 'them') + ' (add a row back by hand to have it, or delete ' + recordShown + ' to be offered every missing row again): ' + namedRows(heldBack));
    }
    if (recordFile === null && addedPerms.length) say('    Not a git repository, so nothing records which toolkit rows were offered: a row you delete is added again, and named here, on every run.');
    if (recordFile !== null && record.status !== 'ok') {
      say('  Offered-rows record: ' + (record.status === 'absent' ? 'none yet' : recordShown + ' is unreadable and counts as none') + ', so every missing toolkit row is added this once. '
        + 'The record (' + recordShown + ', inside the git directory, never committed) then lists every toolkit row offered here, and a row you delete afterwards stays deleted in this working copy.');
    }
  }

  // --- 4. Page or proceed --------------------------------------------------------
  if (paged) {
    say('');
    say('PAGED - nothing was written. Decide, then re-run:');
    if (modified.length) say('  - keep going and let the backup hold your edits: add --force');
    if (mode === 'migrate-unknown') say('  - no manifest to verify against: add --force to sweep the listed paths, or run the v6 installer once first to get a manifest');
    for (const [rel, read] of [['.claude/settings.json', sharedRead], ['.claude/settings.local.json', localRead]]) {
      if (read.problem === null) continue;
      say('  - ' + rel + ' ' + read.problem + ': fix it by hand' + (read.problem === 'is not valid JSON' ? ' (a trailing comma or a missing quote is the usual cause)' : '')
        + ' and re-run, or add --force to leave that file exactly as it is and set up everything else');
    }
    if (migrating && (top === null || dirtyTree(project))) say('  - commit or stash your changes first (or add --force)');
    process.stdout.write(out.join('\n') + '\n');
    process.exit(3);
  }
  if (opts.dryRun) { process.stdout.write(out.join('\n') + '\n'); process.exit(0); }

  // --- 5. Apply --------------------------------------------------------------------
  // What the undo line needs, taken before anything is written: the bytes of
  // every file this run may write or delete, whether each folder it may create
  // already exists, which of those files git tracks, and which tracked ones
  // differ from the index (a `git checkout --` restores the index copy, so it
  // would also discard an uncommitted edit made before the run).
  const mayWrite = seedWrite.map(s => s[0]).concat(['.gitignore', '.gitattributes', '.claude/settings.json', '.claude/settings.local.json', STATE_REL]);
  const touched = [...new Set(removed.concat(mayWrite, migrating ? [MIGRATION_REL] : []))];
  const bytesBefore = new Map(touched.map(rel => [rel, readIfFile(P(rel))]));
  const mayCreateDirs = new Set(['plans', 'artifacts']);
  for (const rel of touched) for (let d = path.posix.dirname(rel); d !== '.'; d = path.posix.dirname(d)) mayCreateDirs.add(d);
  const dirsBefore = new Map([...mayCreateDirs].map(d => [d, fs.existsSync(P(d))]));
  const isRepo = top !== null;
  const trackedBefore = new Set(isRepo ? gitPaths(['ls-files', '-z', '--', ...touched], project) : []);
  const unstagedBefore = new Set(isRepo && trackedBefore.size ? gitPaths(['diff', '--name-only', '-z', '--', ...trackedBefore], project) : []);
  // The old copy-install's packages, deleted whole below: git restores them only
  // when it tracks them and they are unchanged; anything else there is gone.
  const NODE_MODULES = '.claude/scripts/node_modules';
  let nodeModules = null;
  if (migrating && fs.existsSync(P(NODE_MODULES))) {
    const trackedNm = isRepo ? gitPaths(['ls-files', '-z', '--', NODE_MODULES], project) : [];
    const untrackedNm = isRepo ? gitPaths(['ls-files', '-z', '--others', '--', NODE_MODULES], project) : ['(not a repository)'];
    const unstagedNm = trackedNm.length ? gitPaths(['diff', '--name-only', '-z', '--', NODE_MODULES], project) : [];
    nodeModules = { checkout: trackedNm.length > 0 && unstagedNm.length === 0, lost: untrackedNm.length > 0 || unstagedNm.length > 0 };
  }

  let backupDir = null;
  const backup = (rel) => {
    if (!fs.existsSync(P(rel))) return;
    const dest = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(P(rel), dest);
  };
  // Outside a migration the backup holds only the settings files this run
  // changes, and exists only when one of them already existed (issue #180): a
  // plugin-mode re-run rewrote a gitignored settings.local.json with no copy.
  const settingsBackedUp = migrating ? [] : [['.claude/settings.local.json', localChanged], ['.claude/settings.json', settingsChanged]]
    .filter(([rel, changes]) => changes && fs.existsSync(P(rel))).map(([rel]) => rel);
  if (settingsBackedUp.length) {
    backupDir = createBackupDir(project);
    for (const rel of settingsBackedUp) backup(rel);
  }
  if (migrating && (removed.length || localChanged || settingsChanged || ignoreAdd.length || attrsAdd.length)) {
    backupDir = createBackupDir(project);
    for (const rel of removed) backup(rel);
    for (const rel of ['.claude/settings.local.json', '.claude/settings.json', '.gitignore', '.gitattributes']) backup(rel);
    for (const rel of removed) {
      fs.rmSync(P(rel), { force: true });
      // A root scripts/ file an early installer copied can leave scripts/ empty.
      removeEmptyDirsUpTo(path.dirname(P(rel)), rel.startsWith('.claude/') ? P('.claude') : project);
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
  // Written back in each file's own layout (issue #180): its indentation, line
  // endings and byte order mark, two spaces for a new file.
  if (settingsChanged) { fs.mkdirSync(P('.claude'), { recursive: true }); fs.writeFileSync(P('.claude/settings.json'), formatJson(settings, sharedRead.format)); }
  if (localChanged) { fs.mkdirSync(P('.claude'), { recursive: true }); fs.writeFileSync(P('.claude/settings.local.json'), formatJson(localNext, localRead.format)); }
  // The offered-rows record, after the settings file it describes. A git
  // directory that refuses the write costs only the memory of these offers.
  const recordWritten = recordChanged ? writeOfferedRows(recordFile, offeredNext) : null;
  // The version a new state file records: the running plugin's, except over a
  // plugin-era stamp newer than it, which is recorded instead so nothing this
  // project carries is lowered and a --stamp on the older plugin refuses (R1).
  const stateVersion = priorStampCmp === 1 ? priorPluginStamp : version;
  const stateNext = {
    version: stateVersion,
    path: mode === 'plugin' ? (state.path || 'plugin') : (migrating ? 'copy-migrated' : 'plugin'),
    at: new Date().toISOString(),
    marketplace: MARKETPLACE,
    plugin: PLUGIN,
    previousVersion: mode === 'plugin' ? (state.previousVersion || null) : priorPluginStamp !== null ? priorPluginStamp : previousVersion,
  };
  // A fresh seed satisfies the running version by construction, so it is
  // audited at that version; a migration's custom files are not, and /tk:upgrade
  // stamps them after its audit. Neither is a project whose rules file was
  // already there (freshAudited), which /tk:upgrade audits from its stamp.
  if (freshAudited) { stateNext.auditedVersion = version; stateNext.auditedAt = stateNext.at; }
  if (mode !== 'plugin') {
    fs.writeFileSync(P(STATE_REL), JSON.stringify(stateNext, null, 2) + '\n');
  } else if (stateRaise) {
    // Re-run on the plugin: raise version and at, every other key as it was
    // (an existing auditedVersion and previousVersion included). When version
    // was the audit reference, its old value moves into auditedVersion first so
    // the reference stays put; when version was unusable, previousVersion
    // records `unknown` so the audit still covers everything. An equal or older
    // plugin writes nothing, which keeps a repeat run idempotent.
    const backfill = stateBackfill ? Object.assign({ auditedVersion: validVersion(state.version) }, typeof state.at === 'string' ? { auditedAt: state.at } : {})
      : stateUnknownStart ? { previousVersion: 'unknown' } : {};
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
  if (backupDir) {
    say('  Backup: ' + path.relative(project, backupDir) + (migrating ? ' (every removed file, plus the settings, .gitignore and .gitattributes as they were)'
      : ' (' + settingsBackedUp.join(' and ') + ' as ' + (settingsBackedUp.length === 1 ? 'it was' : 'they were') + ' before this run)'));
  }
  if (recordWritten === false) say('  Offered-rows record: ' + recordShown + ' could not be written, so a toolkit row you delete can be added again on the next run.');
  // One undo line for every mode, compared by bytes after the writes, so only
  // what this run really created, changed or deleted is named; a folder counts
  // when it did not exist before. The state and migration files a migration
  // writes are new and untracked, so they land in the delete list: left in
  // place they would make the next run think the project is already on the plugin.
  const backupRel = backupDir ? path.relative(project, backupDir).split(path.sep).join('/') : null;
  const u = classifyUndo(touched.map(rel => {
    const before = bytesBefore.get(rel);
    const backupCopy = backupDir ? readIfFile(path.join(backupDir, rel)) : null;
    return { rel, before, after: readIfFile(P(rel)), tracked: trackedBefore.has(rel), unstaged: unstagedBefore.has(rel), backupHolds: before !== null && backupCopy !== null && backupCopy.equals(before) };
  }));
  if (nodeModules && !fs.existsSync(P(NODE_MODULES))) {
    if (nodeModules.checkout) u.checkout.push(NODE_MODULES);
    if (nodeModules.lost) u.notRestored = [NODE_MODULES + '/'];
  }
  u.isRepo = isRepo;
  u.backupDir = backupRel;
  u.createdDirs = [...dirsBefore].filter(([d, existed]) => !existed && fs.existsSync(P(d))).map(([d]) => d + '/')
    .sort((a, b) => (b.split('/').length - a.split('/').length) || a.localeCompare(b));
  const undo = undoLine(u);
  if (migrating) {
    if (undo) say('  ' + undo);
    say('  Next: run /tk:upgrade to audit your custom files against the ' + version + ' conventions' + (modified.length ? ' (it will carry your ' + modified.length + ' local edit(s) as findings)' : '') + '.');
  } else {
    say(mode !== 'fresh' ? '  Nothing to migrate; seed checked.'
      : priorStampCmp === -1 ? '  Next: run /tk:upgrade to audit this project\'s own files from ' + priorPluginStamp + ' against the ' + version + ' conventions.'
      : priorStampCmp === 1 ? '  Next: update the plugin to ' + priorPluginStamp + ' or later: ' + PLUGIN_UPDATE_STEPS + '. Pushes stay blocked until then.'
      : '  Next: /tk:explore. The codebase map generates on first use.');
    if (undo) say('  ' + undo);
  }
  process.stdout.write(out.join('\n') + '\n');
}

// Which undo list each path the run touched belongs to. `entries`: { rel,
// before, after (Buffers, null when no file), tracked (git tracked it before the
// run), unstaged (its working copy differed from the index before the run, a
// deletion included), backupHolds (the backup folder holds its bytes as they
// were) }. An unchanged path is in no list. A tracked path goes to checkout when
// the index copy is what it was: clean before, or missing from the working tree
// (a file deleted to be reseeded is restored, never deleted). An untracked path
// the run created is deleted. Every other change is copied back from the backup
// when it holds the file, else restored by hand.
function classifyUndo(entries) {
  const u = { checkout: [], created: [], restore: [], byHand: [] };
  for (const e of entries) {
    if (e.before === null && e.after === null) continue;
    if (e.before !== null && e.after !== null && e.before.equals(e.after)) continue;
    if (e.tracked && (e.before === null || !e.unstaged)) u.checkout.push(e.rel);
    else if (e.before === null) u.created.push(e.rel);
    else if (e.backupHolds) u.restore.push(e.rel);
    else u.byHand.push(e.rel);
  }
  return u;
}

if (require.main === module) main();

module.exports = {
  shellQuote, undoLine, classifyUndo, copyInstallMarkers, versionFileOwner, deadPermission,
  permissionRowKey, offeredRowsPath, readOfferedRows, writeOfferedRows, jsonFormat, formatJson, namedRows, createBackupDir,
};
