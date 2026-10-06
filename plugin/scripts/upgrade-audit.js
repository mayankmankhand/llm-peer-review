#!/usr/bin/env node
'use strict';
// upgrade-audit.js - the deterministic half of /tk:upgrade (issue #167, Step 6;
// repairs and safe receipts, issues #172 and #174; repair edge cases, finding
// keys and the rollback record, issues #179 and #183).
//
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade-audit.js [--project <dir>]
//        [--plugin-root <dir>] [--conventions <file>] [--from <version>]
//        [--stamp [--refuted <file>]]
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade-audit.js --rollback-to <x.y.z>
//
// Reads the conventions document (the plugin's skills/shared/conventions.md by
// default), selects every convention whose `Since` version lies in the range
// (installed, current], plus every convention marked `Runs: every upgrade`,
// inventories the files the PROJECT owns (everything under .claude/commands,
// agents, skills and rules, plus CLAUDE.md - the plugin's own files never sit
// in the project), runs each convention's detector over its scope, and prints
// one candidate finding per line as JSONL on stdout. Each finding carries a
// runnable receipt, so the /tk:upgrade skill can hand them straight to the M2
// audit. A one-line summary goes to stderr.
//
// The range starts at the last version whose conventions this project has been
// audited against, read from .claude/.toolkit-state.json: `auditedVersion` when
// a previous /tk:upgrade stamped it, else `previousVersion` (a copy-install
// migration records the version it came from there, so the first upgrade after
// a migration audits everything since that copy-install rather than nothing),
// else `version`. The first of those keys that names a value decides, and the
// value is validated with the version helpers session-start.js uses: a value of
// any other shape is no usable start, so every convention up to the plugin
// version applies, and it is never echoed. --from overrides all three; with no
// state file at all every convention applies. `--stamp` is the end of a clean
// /tk:upgrade run: it sets `version` and `auditedVersion` to the plugin version
// and exits, and it refuses (one line, exit 0, nothing written) when the state
// already records a newer version than the plugin, so a stamp never lowers it.
// After recording, it also raises the version stamp of .claude/rules/toolkit.md
// when that file's text is the shipped seed's and its stamp is older (review
// fix R4): only the version inside the stamp line changes, never downward,
// never when the text differs, and a rerun finds nothing left to raise. Last,
// it writes the permission rows C-9 offers back as lost into the offered-rows
// record (see recordLostRowOffers), so none is offered again in this working
// copy; the audit run itself writes nothing.
//
// `--rollback-to <x.y.z>` (issue #183) is the one path that lowers the record:
// run from the project root while this release is still the running plugin,
// before an older release is reinstalled, it sets each of auditedVersion,
// previousVersion and version that is above the target to the target (the older
// release's version guard and its --stamp read them), prints each change, and
// refuses with exit 1 when there is nothing it may lower (see rollbackRecord).
//
// Convention format (one section each, parsed here and written by hand there):
//
//   ### C-12: Criteria reach a worker by preload, not by paste
//   - **Since:** 7.0.0
//   - **Runs:** every upgrade            (optional: skip the range filter)
//   - **Scope:** prompt-files            (prompt-files | prompt-files+claude-md | prompt-files+session-files | claude-md | agents | settings-local | seed-stamp | seed-lines | seed-blocks | lessons | local-edits | review-kinds)
//   - **Detector:** regex                (regex | seed-stamp | dead-permissions | permission-rows | seed-lines | seed-blocks | lessons-shape | unscoped-names | local-edits | agent-tools | review-kinds | agent-models | manual)
//   - **Looks behind:** `PASTE THE SKILL'S REVIEW CRITERIA`
//   - **Looks behind:** `subagent_type=(tk:)?review-finder`
//   - **Fix:** dispatch the typed finder for the kind; move any pasted criteria into a skill it preloads
//
// `Looks behind` may repeat; each backticked value is a JavaScript regular
// expression applied per line. The non-regex detectors need no pattern:
// seed-stamp reports the seeded rules file when its stamp is unusable, or when
// the stamp is older than the plugin version AND its text, stamp line left out,
// differs from the plugin's shipped seed/rules-toolkit.md (a file whose text is
// the seed's is current whatever its stamp says), dead-permissions lists settings.local.json entries that point at
// removed scripts, permission-rows compares settings.local.json with the
// plugin's shipped seed (rows it lacks, retired rows it still has, and a
// `defaultMode` of acceptEdits as a question for the user, asked only when the
// range crosses the convention's Since) and with the migration record (rows of
// the project's own its `deadPermissions` list says it removed although their
// script stayed), comparing rows by permissionRowKey and leaving out every row
// the offered-rows record lists, seed-lines finds lines an older seed wrote into
// .gitattributes, .gitignore and artifacts/README.md, lines there that name a
// toolkit .claude/ path the project does not have (with the comment lines
// directly above such a .gitignore line), plus lines of the project's own a
// 7.0.x migration dropped from a file it replaced (still in the backup folder)
// and a migration record git still tracks (it asks git and reads only row
// counts from the record), unscoped-names finds toolkit command, skill and agent
// names used without the tk: scope in the project's prompt files and in the
// files its sessions read (CLAUDE.md, .claude/CLAUDE.md and CLAUDE.local.md at
// warn, LESSONS.md and DESIGN-PROFILE.md at suggest), local-edits reads
// .claude/.toolkit-migration.json, and agent-tools reads every project-owned
// agent whose name or description says it is a finder, reviewer, critic,
// skeptic, verifier, judge, or auditor and flags one with no `tools:` line or
// with Edit, Write, or NotebookEdit in it. agent-models (C-14) holds the
// project's own files to the model routing rule: an agent in one of those roles,
// or one a review kind names, with no `model:` line; a dispatch of a toolkit
// finder or the map helper whose block names no model; and a dispatch of a
// toolkit judge whose block names one (see c14Block and c14Names). seed-blocks
// (C-15) reads the files setup seeded (CLAUDE.md, LESSONS.md, DESIGN-PROFILE.md
// and .claude/toolkit/README.md) block by block (SEED_FILES, blocksOf) and
// flags a block that equals one an older seed shipped, per the plugin's
// seed/historical-seed-blocks.txt, and not the current seed's, with the
// current seed's nearest block as the fix (a file that is an older seed's line
// for line is one finding), plus ${CLAUDE_PLUGIN_ROOT} in a file of the
// project's own, where Claude Code never expands it. lessons-shape (C-16) reads
// LESSONS.md and flags a bullet beyond one sentence or 300 characters while
// LESSONS-detail.md is absent, and a bullet whose bold lead is in the plugin's
// seed/toolkit-lesson-leads.txt, the toolkit's own lessons that the
// copy-installers wrote into projects. `manual` is not run here at all: the
// /tk:upgrade skill judges those by hand (a judgment no grep expresses) and
// emits findings in the same shape.
//
// Every finding carries a stable `key` (issue #179): the same finding has the
// same key on every run, so /tk:upgrade's rerun decides FIXED by the key.
// Receipts run through bash in the project root and check what their detector
// checks, read from the same bytes (see the receipt builders), so after a
// correct fix a receipt comes back without its evidence exactly when the rerun
// drops the key. Every value a receipt names (a pattern, a file, a line, a
// permission row) is single-quoted by shq(): a pattern with a backtick, `$` or
// `"` in it would otherwise break the command and kill a true finding as
// RECEIPT FAILED.
//
// Exit codes: 0 (findings are data, zero is a valid count; a refused stamp is
// also 0), 1 on error or on a refused rollback.
// Dependency-free, like every script under .claude/scripts/.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// Kept byte-identical to the copies in setup-project.js, pre-push-check.js and
// session-start.js, and pinned there by scripts/test-session-start.js. Each
// script under .claude/scripts/ is self-contained so it can ship and run on its
// own, so this is a fourth copy rather than the first cross-require (#203).
const PLUGIN_UPDATE_STEPS = 'run `claude plugin marketplace update llm-peer-review`, then `claude plugin update tk@llm-peer-review`'
  + ' (for a plugin installed for this project only, the same update with `--scope project`: `claude plugin update tk@llm-peer-review --scope project`),'
  + ' then restart Claude Code';

const PROJECT_PROMPT_DIRS = ['.claude/commands', '.claude/agents', '.claude/skills', '.claude/rules'];
const SEED_RULES = '.claude/rules/toolkit.md';
const STATE_REL = '.claude/.toolkit-state.json';
const MIGRATION_REL = '.claude/.toolkit-migration.json';
const MANIFEST_REL = '.claude/.toolkit-manifest.json';
const LOCAL_SETTINGS = '.claude/settings.local.json';
// The plugin's list of the paths a copy-install managed (C-10 reads its
// .claude/ entries as toolkit files a line may still name).
const MANAGED_PATHS = 'managed-paths.json';
// Files a session reads beside the prompt files (C-11, issue #179), with the
// severity of a finding in each: Claude Code loads the three CLAUDE files as
// instructions, so a stale name there steers every session (warn); session-init.js
// bundles LESSONS.md for the loop commands and /tk:explore reads DESIGN-PROFILE.md
// before design work, where a stale name is context rather than an instruction
// (suggest). LESSONS-detail.md stays out: it is opened on demand, and the 7.0.x
// seed copy of it names toolkit commands in dozens of historical write-ups.
const SESSION_READ_FILES = [['CLAUDE.md', 'warn'], ['.claude/CLAUDE.md', 'warn'], ['CLAUDE.local.md', 'warn'], ['LESSONS.md', 'suggest'], ['DESIGN-PROFILE.md', 'suggest']];
// The toolkit repository: a migrated file's base is its tagged copy there.
const TOOLKIT_REPO_URL = 'https://github.com/mayankmankhand/llm-peer-review';
// Same rule as setup-project.js: a legacy toolkit row shape, or a row naming a
// script under .claude/scripts/ that the project does not have. A custom
// script's row is live (review of the v7.0.0 release, R2). The script name
// stops before a colon that ends it: Claude Code writes "don't ask again" rows
// as `Bash(node .claude/scripts/our-report.js:*)`, and reading that name as
// `our-report.js:` made a kept script's row look dead.
const LEGACY_DEAD_PERMISSION = [
  // An old copy-install's absolute browse.js pipe row. Not a plugin cache row
  // (7.3.1 review, R1): those carry this machine's cache folder and are live.
  /^Bash\((echo|cat) \* \| node \/(?![^)]*\/plugins\/cache\/[^/)]+\/tk\/\*\/scripts\/browse\.js \*\)$)[^)]*\/(\.claude\/)?scripts\/browse\.js \*\)$/,
  /^Skill\(review-commands(:\*)?\)$/,
];
function deadPermission(row, exists) {
  // The legacy shapes are written in the ` *` spelling, so a row is compared by
  // its permissionRowKey, as setup-project.js does: the `:*` twin of the
  // browse.js pipe is dead too (issue #179).
  if (LEGACY_DEAD_PERMISSION.some(re => re.test(permissionRowKey(row)))) return true;
  const m = /(?:^|[\s(])\.claude\/scripts\/([^\s)'"*]+?):?(?=[\s)'"*]|$)/.exec(row);
  return m !== null && !exists('.claude/scripts/' + m[1]);
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

// >>> refuted finding keys (issue #213) >>>
// The refuted record lists the keys of findings the /tk:upgrade audit killed
// (tier 1 RECEIPT FAILED, tier 2 REFUTED, tier 3 REFUTED 2/3 or 3/3) in this
// working copy, so the next audit does not report them again: a history line
// that C-11 flags and a skeptic refutes was otherwise flagged, refuted and
// flagged again on every upgrade. A finding's key digests the line it is about
// (see keyMaker below), so a changed line is a new finding and is reported. A
// fix the owner declined is not a kill and is never written here, which is why
// a declined C-7, C-15 or C-16 finding still comes back as those conventions
// promise. Like the offered-rows record it lives in the git directory (`git
// rev-parse --git-path tk-refuted-findings.json`), never committed, so a fresh
// clone reports everything once more. Only --stamp writes it, from the file
// --refuted names (one key per line); the audit reads it, says how many
// findings it suppressed, and treats a record it cannot read as empty, saying
// so once. The block is written beside the offered-rows one rather than
// folded into it because that block must stay byte-identical to its copy in
// setup-project.js.
//
// Shape (version 1): { "version": 1, "refuted": ["C-11:CLAUDE.md:0123456789ab", ...] },
// sorted, each key once.
const REFUTED_FILE = 'tk-refuted-findings.json';
const REFUTED_VERSION = 1;
// The record's absolute path for the working copy at `dir`, or null outside a
// git repository (or when git cannot be run).
function refutedRecordPath(dir) {
  let out;
  try { out = execFileSync('git', ['rev-parse', '--git-path', REFUTED_FILE], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return null; }
  const printed = out.replace(/\r?\n$/, '');
  return printed === '' ? null : path.resolve(dir, printed);
}
// { status: 'absent' | 'unreadable' | 'ok', keys }: a Set of the recorded
// keys, empty unless the status is 'ok'.
function readRefutedKeys(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) { return { status: e && e.code === 'ENOENT' ? 'absent' : 'unreadable', keys: new Set() }; }
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  const ok = data !== null && typeof data === 'object' && !Array.isArray(data) && data.version === REFUTED_VERSION
    && Array.isArray(data.refuted) && data.refuted.every(k => typeof k === 'string');
  return ok ? { status: 'ok', keys: new Set(data.refuted) } : { status: 'unreadable', keys: new Set() };
}
// Writes the record listing `keys` (sorted, each once) through a temporary
// file renamed over the record. True when written.
function writeRefutedKeys(file, keys) {
  const refuted = [...new Set(keys)].filter(k => typeof k === 'string' && k !== '').sort();
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify({ version: REFUTED_VERSION, refuted }, null, 2) + '\n');
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch (e2) { /* nothing left to clean */ }
    return false;
  }
}
// The keys in a --refuted file: one per line, blanks dropped, a byte order
// mark and CRLF endings tolerated. Null when the file cannot be read.
function readRefutedFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
  return text.replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
}
// The end of a clean /tk:upgrade, after --stamp recorded the version: the
// killed keys join the record. Nothing is written for an empty list.
function recordRefutedKeys(project, keys) {
  if (!keys.length) return;
  const file = refutedRecordPath(project);
  if (file === null) {
    console.error('upgrade-audit: not a git repository, so the ' + keys.length + ' refuted finding key' + (keys.length === 1 ? ' is' : 's are') + ' not recorded: the next audit reports ' + (keys.length === 1 ? 'it' : 'them') + ' again');
    return;
  }
  const record = readRefutedKeys(file);
  const known = record.status === 'ok' ? record.keys : new Set();
  const fresh = keys.filter(k => !known.has(k));
  if (!fresh.length) { console.error('upgrade-audit: every refuted finding key was already in the refuted record'); return; }
  if (!writeRefutedKeys(file, [...known, ...fresh])) {
    console.error('upgrade-audit: could not write the refuted record, so the next audit reports the ' + fresh.length + ' refuted finding' + (fresh.length === 1 ? '' : 's') + ' again');
    return;
  }
  console.error('upgrade-audit: recorded ' + fresh.length + ' refuted finding key' + (fresh.length === 1 ? '' : 's') + ' in the refuted record, so the next audit skips ' + (fresh.length === 1 ? 'it while its line stays' : 'them while their lines stay') + ' unchanged');
}
// <<< refuted finding keys <<<
// The project script a permission row runs, as a plain project-relative path
// under .claude/scripts/, or null. The relative form is the extraction
// deadPermission uses (the same regex, copied from setup-project.js;
// scripts/test-upgrade-audit.js fails when the copies drift), and the absolute
// form ends the name the same way. An absolute path counts only inside this
// project root. The root is found in the row as a literal, as this script knows
// it and as its real path, quoted or not (issue #183): a path read as a token
// ended at its first blank, so a project folder with a space in its name never
// parsed. A row naming the root through another spelling (a symlinked temp or
// home folder with no blank in it) still counts when its real path is inside
// the root, so a row naming a script in some other checkout never qualifies.
const ROW_SCRIPT_REL = /(?:^|[\s(])\.claude\/scripts\/([^\s)'"*]+?):?(?=[\s)'"*]|$)/;
const ROW_SCRIPT_ABS = /(?:^|[\s(])(\/[^\s)'"*]*\/\.claude\/scripts\/[^\s)'"*]+?):?(?=[\s)'"*]|$)/;
const ROW_SCRIPT_NAME = /^([^\s)'"*]+?):?(?=[\s)'"*]|$)/;
function rowScriptRel(row, project) {
  const m = ROW_SCRIPT_REL.exec(row);
  if (m) { const rel = '.claude/scripts/' + m[1]; return safeRel(rel) ? rel : null; }
  const real = (p) => { try { return fs.realpathSync(p); } catch (e) { return null; } };
  for (const root of [...new Set([project, real(project)])]) {
    if (!root) continue;
    const lead = root.replace(/\/+$/, '') + '/.claude/scripts/';
    for (let at = row.indexOf(lead); at !== -1; at = row.indexOf(lead, at + 1)) {
      // The root starts a word of the row: the row's start, a blank, `(`, `=`, a
      // quote, or the extra slash of a `//` rule form right after one of those.
      const boundary = (k) => k < 0 || /[\s("'=]/.test(row[k]);
      if (!(boundary(at - 1) || (row[at - 1] === '/' && boundary(at - 2)))) continue;
      const name = ROW_SCRIPT_NAME.exec(row.slice(at + lead.length));
      const rel = name ? '.claude/scripts/' + name[1] : null;
      if (rel !== null && safeRel(rel)) return rel;
    }
  }
  const a = ROW_SCRIPT_ABS.exec(row);
  if (!a) return null;
  const written = path.resolve(a[1]);
  for (const [root, abs] of [[project, written], [real(project), written], [real(project), real(written)]]) {
    if (!root || !abs) continue;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (rel.startsWith('.claude/scripts/') && safeRel(rel)) return rel;
  }
  return null;
}
// Does a permission row name an absolute path? A token that starts at the
// filesystem root (`/home/...`, or Claude Code's `//home/...` rule form) or at a
// Windows drive (`C:\`, `C:/`). Used only to count such rows, never to echo one.
const ABSOLUTE_IN_ROW = /(?:^|[\s(='"])(?:\/+[^\s)'"*]|[A-Za-z]:[\\/])/;
function isFile(abs) { try { return fs.statSync(abs).isFile(); } catch (e) { return false; } }
// Single-quote a string for a POSIX shell, so a receipt can name rows verbatim.
function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
// A project-relative path from a record the project controls (the migration
// file): plain path characters only, no absolute path, no `..` segment. Anything
// else is skipped rather than echoed into a finding.
function safeRel(p) {
  return typeof p === 'string' && p.length <= 400 && /^[A-Za-z0-9._@+-]+(\/[A-Za-z0-9._@+-]+)*$/.test(p) && !p.split('/').includes('..');
}
// The same path with Windows separators turned into forward slashes, when the
// result is safe: setup-project.js records paths with path.relative, which
// writes backslashes on native Windows. Normalizing first keeps the checks
// that matter (a leading slash, a drive letter's colon, a `..` segment all still
// fail safeRel). Null for anything unsafe.
function safeRelPath(p) {
  if (typeof p !== 'string') return null;
  const n = p.replace(/\\/g, '/');
  return safeRel(n) ? n : null;
}

// The version helpers, copied function for function from the block in
// session-start.js (issue #174) so this script runs on its own;
// scripts/test-upgrade-audit.js fails when these copies drift from that block.
// A version read from the project is only ever used in one fixed, harmless
// shape, and a value of any other shape is never compared and never echoed.
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

// --stamp [--refuted <file>]: the file names the keys of the findings this
// run's audit killed, one per line, and the stamp records them in the refuted
// record (see recordRefutedKeys). It is read before anything is written, so a
// path that cannot be read stops the run with the state file untouched.
const USAGE = 'usage: node upgrade-audit.js [--project <dir>] [--plugin-root <dir>] [--conventions <file>] [--from <version>] [--stamp [--refuted <file>]]\n'
  + '       node upgrade-audit.js [--project <dir>] --rollback-to <x.y.z>';

function parseArgs(argv) {
  const o = { project: '', pluginRoot: '', conventions: '', from: '', stamp: false, refuted: null, rollbackTo: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') o.project = argv[++i];
    else if (a === '--plugin-root') o.pluginRoot = argv[++i];
    else if (a === '--conventions') o.conventions = argv[++i];
    else if (a === '--from') o.from = argv[++i];
    else if (a === '--stamp') o.stamp = true;
    else if (a === '--refuted') o.refuted = argv[++i] === undefined ? '' : argv[i];
    else if (a === '--rollback-to') o.rollbackTo = argv[++i] === undefined ? '' : argv[i];
    else if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    else { console.error('upgrade-audit: unknown argument ' + a + '\n' + USAGE); process.exit(1); }
  }
  if (o.rollbackTo !== null && o.stamp) { console.error('upgrade-audit: --rollback-to lowers the record and --stamp raises it; run one of them\n' + USAGE); process.exit(1); }
  if (o.refuted !== null && !o.stamp) { console.error('upgrade-audit: --refuted names the keys the audit killed for --stamp to record; run it with --stamp\n' + USAGE); process.exit(1); }
  if (o.refuted === '') { console.error('upgrade-audit: --refuted takes the path of a file with one finding key per line\n' + USAGE); process.exit(1); }
  return o;
}
function git(args, cwd) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return null; }
}
function readJson(abs, fallback) { try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { return fallback; } }
function readLines(abs) { try { return fs.readFileSync(abs, 'utf8').split(/\r?\n/); } catch (e) { return null; } }
function readText(abs) { try { return fs.readFileSync(abs, 'utf8'); } catch (e) { return null; } }

// The seeded rules file's stamp (C-7): the first line carrying
// `<!-- Toolkit version: X`, the match the stamp check has always read.
const RULES_STAMP = /<!-- Toolkit version: ([^ |]+)/;
// The replacement scripts/setup/bump-version.sh makes on a stamp (setup-project.js
// makes the same one when it seeds the file), applied here to the stamp line alone.
const RULES_STAMP_BUMP = /<!-- Toolkit version: [^|]+\|/;
const RULES_SEED = path.join('seed', 'rules-toolkit.md');
// The rules text as C-7 compares it (review fix R4): trailing blanks and a CR
// dropped from each line, the stamp line left out, blank lines at the end
// dropped. CRLF endings, a trailing space and an older stamp are no difference,
// and neither is the seed's own stamp, which can lag the plugin version. The
// receipt reads both files with RULES_BODY_AWK, which does the same steps in
// the same order, so the receipt's diff and this comparison always agree.
// The project section (issue #199): the seed ends at the first line that starts,
// after any blanks, with `<!-- Project section:`. That line and everything under
// it is the project's own text, so it is left out of both files; a file with no
// marker compares whole. The blank lines left above the marker are dropped by the
// trailing-blank rule, in the JS and in the awk alike.
const RULES_PROJECT_MARKER = /^[ \t]*<!-- Project section:/;
function rulesBody(text) {
  let lines = String(text).split('\n');
  const at = lines.findIndex(l => RULES_STAMP.test(l));
  if (at >= 0) lines.splice(at, 1);
  const cut = lines.findIndex(l => RULES_PROJECT_MARKER.test(l));
  if (cut >= 0) lines = lines.slice(0, cut);
  const out = lines.map(l => l.replace(/[ \t\r]+$/, ''));
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}
const RULES_BODY_AWK = '!s && /<!-- Toolkit version: [^ |]+/ { s = 1; next } /^[ \\t]*<!-- Project section:/ { exit } { sub(/[ \\t\\r]+$/, "") } $0 == "" { b++; next } { for (; b > 0; b--) print ""; print }';
function rulesMatchSeed(text, seedText) { return rulesBody(text) === rulesBody(seedText); }
// The stamp half of --stamp for the rules file: when its text is the shipped
// seed's and its stamp is older than the plugin, rewrite only the version in
// the stamp line. The file is read and written as latin1, so every other byte
// (CRLF endings, a byte order mark, any non-ASCII text) goes back exactly as it
// was. A missing file, no seed, an unusable, equal or newer stamp, or text that
// differs leaves the file alone, so a rerun is a no-op.
function restampRules(P, pluginRoot, toVersion) {
  const abs = P(SEED_RULES);
  if (!isFile(abs)) return;
  const seedText = readText(path.join(pluginRoot, RULES_SEED));
  const text = readText(abs);
  if (seedText === null || text === null) return;
  const m = RULES_STAMP.exec(text);
  const stamped = m ? validVersion(m[1]) : null;
  if (stamped === null || compareVersions(stamped, toVersion) >= 0 || !rulesMatchSeed(text, seedText)) return;
  const lines = fs.readFileSync(abs, 'latin1').split('\n');
  const at = lines.findIndex(l => RULES_STAMP.test(l));
  const line = at < 0 ? '' : lines[at].replace(RULES_STAMP_BUMP, '<!-- Toolkit version: ' + toVersion + ' |');
  if (at < 0 || line === lines[at]) return;
  lines[at] = line;
  try { fs.writeFileSync(abs, lines.join('\n'), 'latin1'); } catch (e) {
    console.error('upgrade-audit: could not restamp ' + SEED_RULES + ' (' + (e.code || 'write failed') + ')');
    process.exitCode = 1;
    return;
  }
  console.error('upgrade-audit: restamped ' + SEED_RULES + ' from ' + stamped + ' to ' + toVersion + ': its text matches the shipped seed');
}

function parseConventions(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const h = /^###\s+(C-\d+):\s*(.+?)\s*$/.exec(raw);
    if (h) { cur = { id: h[1], title: h[2], since: '0.0.0', always: false, scope: 'prompt-files', detector: 'regex', patterns: [], fix: '' }; out.push(cur); continue; }
    if (!cur) continue;
    const b = /^-\s+\*\*([A-Za-z ]+):\*\*\s*(.*)$/.exec(raw);
    if (!b) continue;
    const key = b[1].toLowerCase().trim(); const val = b[2].trim();
    if (key === 'since') cur.since = val;
    // `Runs: every upgrade` exempts a convention from the range filter: a check
    // that must hold after every update, whatever version the project came from.
    else if (key === 'runs') cur.always = /^every upgrade\b/i.test(val);
    else if (key === 'scope') cur.scope = val;
    else if (key === 'detector') cur.detector = val;
    else if (key === 'looks behind') { const m = /`(.+)`/.exec(val); if (m) cur.patterns.push(m[1]); }
    else if (key === 'fix') cur.fix = val;
  }
  return out;
}

// Does a folder hold any file, node_modules folders aside?
function hasFilesUnder(dir) {
  let names; try { names = fs.readdirSync(dir); } catch (e) { return false; }
  return names.some(name => {
    if (name === 'node_modules') return false;
    const abs = path.join(dir, name);
    let st; try { st = fs.statSync(abs); } catch (e) { return false; }
    return st.isDirectory() ? hasFilesUnder(abs) : true;
  });
}

function walkFiles(dir, rel, out) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const r = rel + '/' + name;
    if (name === 'node_modules' || name.startsWith('.toolkit-')) continue;
    if (fs.statSync(abs).isDirectory()) walkFiles(abs, r, out); else out.push(r);
  }
  return out;
}

// The command, skill and agent names under a root laid out like the plugin
// (commands/*.md, skills/<name>/SKILL.md, agents/*.md): each file or folder
// name, plus a frontmatter `name:` when it differs. Used on the plugin root for
// the names a project must scope with tk:, and on the project's .claude/ for
// the names the project owns itself (never flagged: they are its own pieces).
function frontmatterName(abs) {
  let text; try { text = fs.readFileSync(abs, 'utf8'); } catch (e) { return null; }
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const m = fm && /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(fm[1]);
  return m ? m[1] : null;
}
function piecesUnder(root) {
  const names = new Set();
  const list = (dir) => { try { return fs.readdirSync(dir).sort(); } catch (e) { return []; } };
  for (const n of list(path.join(root, 'commands'))) if (n.endsWith('.md')) names.add(n.slice(0, -3));
  for (const n of list(path.join(root, 'agents'))) if (n.endsWith('.md')) { names.add(n.slice(0, -3)); names.add(frontmatterName(path.join(root, 'agents', n))); }
  for (const d of list(path.join(root, 'skills'))) {
    const skill = path.join(root, 'skills', d, 'SKILL.md');
    if (d !== 'shared' && fs.existsSync(skill)) { names.add(d); names.add(frontmatterName(skill)); }
  }
  return [...names].filter(n => typeof n === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(n));
}

// Unscoped toolkit names on one line (C-11). URLs are blanked first, so a path
// segment of a link is never a mention. A slash mention needs a boundary before
// the slash (not a word character, dot, slash, colon, tilde, dash, backslash,
// @, $, brace, closing bracket or paren, %, #, =, &, ?, +, * or <, so file
// paths, globs, variables, closing tags such as </document> and `and/or` prose
// stay out) and after the name (not a word character, dash or slash, and not a
// dot that starts a file extension). A scoped `/tk:review` never matches: the
// name there follows a colon.
const URL_RE = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>"'`]*|\bwww\.[^\s<>"'`]*/g;
// The text just before a slash that makes `/<name>` a root-relative path, not
// a mention: a markdown link target `](` or reference definition `[x]: `, an
// attribute value (`href="`, `src='`, `to=`), a CSS `url(`, an HTTP route
// after its method (`GET /index`), or a directory after a shell command that
// takes one (`cd /worktree`). A mention in prose, a code span or parentheses
// such as "(run /review)" keeps its match.
const PATH_BEFORE_SLASH = /(?:\]\(\s*<?|^\s*\[[^\]]+\]:\s*<?|=\s*["']?|\burl\(\s*["']?|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+|(?:^|[\s;&|`(])(?:cd|pushd|ls|cat|mkdir|rm|rmdir|cp|mv|touch)(?:\s+-[A-Za-z-]+)*\s+)$/;
function unscopedMatchers(names) {
  const alt = names.slice().sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return [
    { re: new RegExp('\\bSkill\\(\\s*["\'`]?(' + alt + ')(?![\\w-])', 'g'), grep: (m) => m[0], show: (m) => 'Skill(' + m[1] + ')' },
    { re: new RegExp('\\bsubagent_type\\s*[=:]\\s*["\'`]?(' + alt + ')(?![\\w-])', 'g'), grep: (m) => m[0], show: (m) => 'subagent_type=' + m[1] },
    { re: new RegExp('(^|[^\\w./:~\\\\@$})\\]%#=&?+*<-])\\/(' + alt + ')(?![\\w/-]|\\.\\w)', 'g'), grep: (m) => '/' + m[2], show: (m) => '/' + m[2],
      path: (text, m) => PATH_BEFORE_SLASH.test(text.slice(0, m.index + m[1].length)) },
  ];
}
// History, not instructions (C-11, issue #187): a line that records past work
// names a command as it was typed then, and scoping it rewrites the record. A
// lessons file is history as a whole; elsewhere a line is history when, after
// any list marker and optional bold, it starts with an ISO date or a version.
// A heading does not exempt the lines under it, so a live instruction under
// "## Setup (2026-09-12)" is still flagged.
const HISTORY_FILES = new Set(['LESSONS.md', 'LESSONS-detail.md']);
const HISTORY_LINE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*|__)?(?:\d{4}-\d{2}-\d{2}|v\d+\.\d+\.\d+)(?![\w.-])/;
// Each hit as { grep, show }: the exact text on the line (the receipt's fixed
// string) and the name as a reader would write it.
function unscopedTokens(line, matchers) {
  const text = line.replace(URL_RE, (u) => ' '.repeat(u.length));
  const tokens = [];
  for (const { re, grep, show, path: isPath } of matchers) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (isPath && isPath(text, m)) continue;
      const t = { grep: grep(m), show: show(m) };
      if (!tokens.some(x => x.grep === t.grep)) tokens.push(t);
    }
  }
  return tokens;
}

// One .gitignore line as a rule: whether it is a negation (`!`), and its
// matcher for one path level. Null for a comment or a blank. The pattern rule
// is the one gitignoreLineMatches in scripts/build-plugin.js uses on the seed:
// a trailing slash matches directories only; a pattern with an inner slash is
// anchored to the root, any other pattern matches a name at any depth; `**`,
// `*`, `?` glob.
function gitignoreRule(line) {
  let p = line.replace(/\s+$/, '');
  if (!p || p.startsWith('#')) return null;
  const negate = p.startsWith('!');
  if (negate) p = p.slice(1);
  if (!p) return null;
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.replace(/\/+$/, '');
  const anchored = p.includes('/');
  p = p.replace(/^\//, '');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const whole = new RegExp('^' + re + '$');
  // Level i is the path's first i segments; every level but the last is a directory.
  const matchesAt = (parts, i) => {
    if (dirOnly && i >= parts.length) return false;
    return whole.test(anchored ? parts.slice(0, i).join('/') : parts[i - 1]);
  };
  return { negate, matchesAt };
}
// The first level of `rel` a rule matches: 'dir' for a parent directory (so
// the whole folder is ignored), 'file' for the file itself, null for neither.
function gitignoreLevel(rule, rel) {
  const parts = rel.split('/');
  for (let i = 1; i <= parts.length; i++) if (rule.matchesAt(parts, i)) return i < parts.length ? 'dir' : 'file';
  return null;
}
// Does the whole .gitignore ignore `rel`, as git decides it? Directories are
// checked from the top: at each level the last matching line wins, a negation
// included, and once a parent directory is ignored nothing inside it can be
// re-included. So `.claude/.toolkit-*.json` followed by
// `!.claude/.toolkit-state.json` leaves the state file tracked, while
// `.claude/` followed by the same negation does not.
function gitignoreIgnores(lines, rel) {
  const rules = lines.map(gitignoreRule);
  const parts = rel.split('/');
  for (let i = 1; i <= parts.length; i++) {
    let last = null;
    for (const rule of rules) if (rule !== null && rule.matchesAt(parts, i)) last = rule;
    if (last !== null && !last.negate) return true;
  }
  return false;
}

// Stale seeded lines (C-10): the project file, the shipped seed it came from,
// and which of its lines an older seed wrote that the current one does not.
// `fragment` is the text of a copy-install line an older seed wrote. `scripts`
// is the .gitattributes rule for .claude/scripts/: a migration keeps a
// project's own scripts there (C-8 treats their rows as live), and the rule
// keeps their line endings right, so it is stale only once the folder holds no
// files. Beside these, a line of any of the three files is stale when it names a
// toolkit .claude/ path the project does not have (see claudePathTokens), and in
// .gitignore (`comments`) the comment lines directly above a stale line belong
// to its finding, so no fix strands half of a comment.
const STALE_SEED_FILES = [
  { rel: '.gitattributes', seed: 'gitattributes', fragment: () => false, scripts: (l) => l.includes('.claude/scripts/') },
  { rel: '.gitignore', seed: 'gitignore', fragment: (l) => l.includes('.claude/.toolkit-manifest.json') || l.includes('Toolkit install manifest (auto-generated by setup') || l.includes('preserved by setup.sh'), harmful: stateFileIgnorers, comments: true },
  { rel: 'artifacts/README.md', seed: 'artifacts-README.md', fragment: (l) => l.includes('.claude/scripts/render-html.js') },
];
// The .claude/ paths a line names (C-10, issue #179): a token that starts
// `.claude/` (or `./.claude/`) right after a character no path continues
// through, so a home or plugin path such as
// `~/.claude/plugins/data/tk-llm-peer-review/current/scripts/render-html.js`,
// whose .claude follows a slash, is never one; and that ends on a character a
// file name ends with, so the period closing a sentence stays out. A caller
// compares each token with the toolkit's paths exactly, so a longer path such as
// `.claude/scripts/render-html.js.bak` is never taken for a toolkit file.
const CLAUDE_PATH_TOKEN = /(?<![\w.\/~$@%+-])(?:\.\/)?(\.claude\/[\w.@+\/-]*[\w@+-])/g;
function claudePathTokens(line) {
  const out = [];
  CLAUDE_PATH_TOKEN.lastIndex = 0;
  let m;
  while ((m = CLAUDE_PATH_TOKEN.exec(line)) !== null) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}
// The .gitignore lines that keep the state file out of git, by index, each with
// the level it matches ('dir' when it ignores the .claude folder itself, 'file'
// when it ignores the state file). None when the file as a whole leaves the
// state file tracked, for example through a later negation line.
function stateFileIgnorers(lines) {
  const out = new Map();
  if (!gitignoreIgnores(lines, STATE_REL)) return out;
  lines.forEach((line, i) => {
    const rule = gitignoreRule(line);
    const level = rule === null || rule.negate ? null : gitignoreLevel(rule, STATE_REL);
    if (level !== null) out.set(i, level);
  });
  return out;
}
// The shipped seed's line that replaces a stale one: the seed line opening with
// the same three words, else (issue #179) one closing with the same three words,
// which is how the seed reworded a line that named a copy-install path in its
// middle (`See .claude/rules/html-outputs.md for the full HTML output policy.`).
// None means the current seed dropped the line.
function seedReplacement(line, seedLines) {
  const words = (s) => s.trim().split(/\s+/);
  const head = (s) => words(s).slice(0, 3).join(' ');
  const tail = (s) => words(s).slice(-3).join(' ');
  const others = (seedLines || []).filter(s => s.trim() !== '' && s.trim() !== line.trim());
  return others.find(s => head(s) === head(line))
    || (words(line).length >= 3 ? others.find(s => words(s).length >= 3 && tail(s) === tail(line)) : null)
    || null;
}
// The seed's comment lines directly above its line reading `rule` (trimmed), in
// order, or null: what a stale comment block above that rule becomes.
function seedCommentsAbove(rule, seedLines) {
  const at = (seedLines || []).findIndex(s => s.trim() === rule.trim());
  let top = at;
  while (top > 0 && seedLines[top - 1].startsWith('#')) top--;
  return at > 0 && top < at ? seedLines.slice(top, at) : null;
}

// Lost project lines (C-10): files a 7.0.x migration replaced whole (it removed
// the file, then reseeded it), so a line of the project's own survives only in
// the backup folder. 7.1.0's setup line-merges these files instead
// (KEEP_ON_MIGRATION in setup-project.js), so only a 7.0.x record names one.
// Each entry names the shipped seed and every rule line an earlier toolkit
// release put in that file; a backup line in neither, and not in the live file,
// is the project's own. Adding another replaced file is one more entry.
//
// Every rule line the installers copied as a project's .gitattributes, from
// git history: the toolkit repository's own .gitattributes at v4.5.1, v4.6.0,
// v5.0.0, v5.2.0, v5.5.0, v6.0.0, v6.1.0, v6.1.1, v6.2.0, v6.3.0, v6.3.1,
// v6.3.2 and v6.3.3 (scripts/setup/setup.sh and setup.ps1 copy
// $TOOLKIT_ROOT/.gitattributes), and plugin/seed/gitattributes at v7.0.0 and
// v7.0.1. v0-web-app and v1.0.0 shipped none. Comments and blanks are skipped
// anyway, so only rules are listed.
const SHIPPED_GITATTRIBUTES = ['* text=auto', '*.sh text eol=lf', 'scripts/** text eol=lf', '.claude/scripts/** text eol=lf'];
const REPLACED_ON_MIGRATION = [
  { rel: '.gitattributes', seed: 'gitattributes', shipped: SHIPPED_GITATTRIBUTES },
];
// A line as git reads an attributes rule: CR, a leading UTF-8 byte order mark
// (git ignores one at the start of .gitattributes), surrounding blanks and
// repeated blanks do not matter. The receipt normalizes the same way (tr -d '\r',
// then awk drops a leading mark and '$1=$1' collapses spaces and tabs), so the
// two always agree.
function lineKey(l) { return String(l).replace(/\r/g, '').replace(/^\uFEFF/, '').replace(/^[ \t]+|[ \t]+$/g, '').replace(/[ \t]+/g, ' '); }
// The backup copy of a replaced file, as a project-relative path, when the
// record names the file (under `modified` with its backup path, or under
// `removed` as a bare path whose copy sits at the same path in the backup
// folder) and that copy exists; null otherwise. C-10 reads it for lost lines,
// and C-6 words its advice by whether it exists, so the two never disagree.
function replacedBackup(P, migration, rel) {
  if (!migration) return null;
  const backupDir = safeRelPath(migration.backupDir);
  const backups = [];
  for (const m of Array.isArray(migration.modified) ? migration.modified : []) {
    if (!m || safeRelPath(m.rel) !== rel) continue;
    const b = safeRelPath(m.backup);
    if (b) backups.push(b); else if (backupDir) backups.push(backupDir + '/' + rel);
  }
  for (const r of Array.isArray(migration.removed) ? migration.removed : []) {
    if (safeRelPath(r) === rel && backupDir) backups.push(backupDir + '/' + rel);
  }
  return backups.find(b => isFile(P(b))) || null;
}
// For each replaced file whose backup copy exists: the backup's lines of the
// project's own that the live file lacks, as { rel, backup, lost }.
function lostProjectLines(P, migration, pluginRoot) {
  const out = [];
  if (!migration) return out;
  for (const file of REPLACED_ON_MIGRATION) {
    const backup = replacedBackup(P, migration, file.rel);
    if (!backup) continue;
    const known = new Set([...(readLines(path.join(pluginRoot, 'seed', file.seed)) || []), ...file.shipped, ...(readLines(P(file.rel)) || [])].map(lineKey));
    const lost = [];
    for (const line of readLines(P(backup)) || []) {
      const key = lineKey(line);
      if (key === '' || key.startsWith('#') || known.has(key) || lost.includes(key)) continue;
      lost.push(key);
    }
    if (lost.length) out.push({ rel: file.rel, backup, lost });
  }
  return out;
}

// The line of a "defaultMode" key in settings JSON, by where it sits: `top` for
// the root object, `permissions` for the permissions object, so a file carrying
// both points each finding at its own line. A small scan that tracks the key
// each open object sits under; the last key of a spelling wins, as in JSON.parse.
function defaultModeLines(text) {
  const out = {};
  const stack = [];
  const colon = /\s*:/y;
  let key = null;
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') line++;
    else if (ch === '"') {
      let j = i + 1;
      let s = '';
      while (j < text.length && text[j] !== '"') { if (text[j] === '\\') j++; s += text[j]; j++; }
      i = j;
      colon.lastIndex = j + 1;
      if (!colon.test(text)) continue;
      key = s;
      if (s !== 'defaultMode') continue;
      if (stack.length === 1) out.top = line;
      else if (stack.length === 2 && stack[1] === 'permissions') out.permissions = line;
    } else if (ch === '{') { stack.push(key); key = null; }
    else if (ch === '[') { stack.push('['); key = null; }
    else if (ch === '}' || ch === ']') { stack.pop(); key = null; }
    else if (ch === ',') key = null;
  }
  return out;
}

// --- Finding keys and receipts (issue #179) -------------------------------------
// A finding's key: its convention, its file, what it is about, and for a finding
// about one line a digest of that line's text (and of the pattern that matched
// it). A line number never goes in, so a finding keeps its key while lines above
// it come and go, and /tk:upgrade's rerun decides FIXED by the key. The n-th
// identical line of one file gets `#n`, and its receipt asks for n copies.
function digest(s) { return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12); }
function keyMaker() {
  const seen = new Map();
  return (base) => { const n = (seen.get(base) || 0) + 1; seen.set(base, n); return { key: n === 1 ? base : base + '#' + n, n }; };
}

// Receipts read the bytes their detector read and apply the detector's own
// condition, so after a correct fix a receipt comes back without its evidence
// exactly when the rerun drops the finding's key (issue #179; before, a whole-file
// grep kept printing a line the fix had not touched). Each program below is
// fixed text: every value a receipt names reaches it as a single-quoted argument
// or environment value, never spliced into the program. Where no shell tool can
// apply the condition (which permissions list holds a row), the receipt reads
// the JSON with node, which every toolkit run already has.
//
// One line, as the detectors split lines (a trailing CR dropped): prints each
// line whose text is exactly that line's, the way grep -n prints it, and exits 0
// only when at least N of them are there.
const LINE_AWK = String.raw`BEGIN { l = ENVIRON["L"]; n = ENVIRON["N"] + 0 } { sub(/\r$/, "") } $0 == l { c++; print NR ":" $0 } END { exit c < n }`;
function lineCheck(rel, line, n) { return 'L=' + shq(line) + ' N=' + n + ' awk ' + shq(LINE_AWK) + ' < ' + shq(rel); }
// A regex convention's hit: the line is there, and the pattern matches that
// line's own text.
function regexCheck(rel, line, n, pattern) { return lineCheck(rel, line, n) + " && printf '%s\\n' " + shq(line) + ' | grep -q -E -e ' + shq(pattern); }
// A .gitignore line that keeps the state file out of git (C-10): the line is
// there, and the file as a whole still ignores .claude/.toolkit-state.json as
// gitignoreRule and gitignoreIgnores judge it (at each of the path's two levels
// the last matching line wins, the folder level first). The suite runs this
// program and the JS over the same files, so the two cannot drift unnoticed.
const STATE_IGNORED_AWK = String.raw`function g(p,  r, i, c) { r = ""; for (i = 1; i <= length(p); i++) { c = substr(p, i, 1); if (c == "*" && substr(p, i + 1, 1) == "*") { if (substr(p, i + 2, 1) == "/") { r = r "(.*/)?"; i += 2 } else { r = r ".*"; i++ } } else if (c == "*") { r = r "[^/]*" } else if (c == "?") { r = r "[^/]" } else if (index(".+^$(){}|[]\\", c)) { r = r "\\" c } else { r = r c } } return "^" r "$" } BEGIN { l = ENVIRON["L"]; n = ENVIRON["N"] + 0 } { sub(/\r$/, "") } $0 == l { c++; print NR ":" $0 } { p = $0; sub(/[ \t\f\v]+$/, "", p); if (p == "" || substr(p, 1, 1) == "#") { next } x = substr(p, 1, 1) == "!"; if (x) { p = substr(p, 2) } if (p == "") { next } d = p ~ /\/$/; sub(/\/+$/, "", p); a = index(p, "/") > 0; sub(/^\//, "", p); r = g(p); if (".claude" ~ r) { s1 = x ? "n" : "i" } if (!d && (a ? ".claude/.toolkit-state.json" : ".toolkit-state.json") ~ r) { s2 = x ? "n" : "i" } } END { exit !(c >= n && (s1 == "i" || s2 == "i")) }`;
// An agent file's frontmatter as C-5, C-12 and C-14 read it: its name, its
// description, its model ('' when no model line carries a value), the index of
// the tools line among the frontmatter lines (-1 when absent), and the edit
// tools that line and its list items grant.
function agentFrontmatter(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const head = fm ? fm[1].split(/\r?\n/) : [];
  const field = (k) => { const m = head.find(l => new RegExp('^' + k + ':').test(l)); return m ? m.replace(new RegExp('^' + k + ':'), '').trim() : ''; };
  const toolsIdx = head.findIndex(l => /^tools:/.test(l));
  let tools = '';
  if (toolsIdx >= 0) { tools = head[toolsIdx].replace(/^tools:/, '').trim(); for (let i = toolsIdx + 1; i < head.length && /^\s+-\s/.test(head[i]); i++) tools += ' ' + head[i].replace(/^\s+-\s*/, ''); }
  return { name: field('name'), description: field('description'), model: field('model'), toolsIdx, edits: tools.split(/[\s,]+/).filter(x => /^(Edit|Write|NotebookEdit)$/.test(x)) };
}
// The roles C-5 covers by name or description. C-12 covers an agent a review
// kind names whatever it is called, and leaves these to C-5 so one agent is
// never reported twice.
const JUDGE_ROLE = /finder|review|critic|skeptic|verif|judge|audit/i;
// The project's own review kinds (C-12, issue #199): table rows /tk:review
// appends to its detection table, `| What changed | Specialist | Finder agent |`.
const REVIEW_KINDS = '.claude/toolkit/review-kinds.md';
// A table row's cells: split on a bar no backslash escapes, the outer bars dropped.
function tableCells(line) { return line.trim().replace(/^\|/, '').replace(/\|[ \t\r]*$/, '').split(/(?<!\\)\|/).map(s => s.trim()); }
function stateFileCheck(rel, line, n) { return 'L=' + shq(line) + ' N=' + n + ' awk ' + shq(STATE_IGNORED_AWK) + ' < ' + shq(rel); }
// A finder or judge agent's frontmatter (C-5), read as agent-tools reads it:
// line 1 exactly `---` (a CR allowed), line 2 always inside, then up to the
// first later line that starts with `---`, a trailing CR dropped. TOOLS_EDIT_AWK
// prints the first tools line and the list items right after it, and exits 0
// only when Edit, Write or NotebookEdit is among them; TOOLS_NONE_AWK prints the
// frontmatter and exits 0 only while no tools line is in it (a missing or
// unclosed frontmatter has none).
const TOOLS_EDIT_AWK = String.raw`NR == 1 { if ($0 != "---" && $0 != "---\r") { exit } o = 1; next } o && NR > 2 && /^---/ { e = 1; exit } o { sub(/\r$/, ""); h[++k] = $0 } END { if (!e) { exit 1 } for (i = 1; i <= k; i++) { if (h[i] ~ /^tools:/) { t = i; break } } if (!t) { exit 1 } v = substr(h[t], 7); ln = t + 1; print ln ":" h[t]; for (j = t + 1; j <= k && h[j] ~ /^[ \t]+-[ \t]/; j++) { w = h[j]; ln = j + 1; print ln ":" w; sub(/^[ \t]+-[ \t]*/, "", w); v = v " " w } m = split(v, a, /[ \t,]+/); for (i = 1; i <= m; i++) { if (a[i] == "Edit" || a[i] == "Write" || a[i] == "NotebookEdit") { print "edit tool: " a[i]; z = 1 } } exit !z }`;
// Does any agent file answer to the name W (C-12's missing-agent receipt)? Read as
// the detector reads it (review of #199, R9 and R10): the name a file declares in
// its frontmatter, and its file name only when it declares none. The frontmatter
// is line 1 exactly `---` up to the first later line that starts with `---`; a
// `name:` line anywhere else is prose. Exits 0 only while no file answers to W.
const AGENT_NAMED_AWK = String.raw`function fin() { if (f != "" && (d != "" ? d : b) == ENVIRON["W"]) found = 1 } FNR == 1 { fin(); f = FILENAME; b = f; sub(/.*\//, "", b); sub(/\.md$/, "", b); d = ""; c = ""; o = ($0 == "---" || $0 == "---\r"); e = 0; next } o && !e && /^---/ { e = 1; d = c; next } o && !e && /^name:/ && c == "" { c = $0; sub(/^name:/, "", c); sub(/^[ \t]+/, "", c); sub(/[ \t\r]+$/, "", c) } END { fin(); exit found }`;
const TOOLS_NONE_AWK = String.raw`{ x = $0; sub(/\r$/, "", x) } NR == 1 { print NR ": " x; if ($0 != "---" && $0 != "---\r") { exit } o = 1; next } o && NR > 2 && /^---/ { e = 1; print NR ": " x; exit } o { print NR ": " x; if (x ~ /^tools:/) { t = 1 } } END { exit (e && t) }`;
// C-14 (issue #209) holds a project's own files to the model routing rule in
// model-routing.md: a judge runs on the session model, a finder never above the
// session that dispatches it, and a call to a judge names no model. The name
// lists mirror scripts/test-model-roster.js, which holds the toolkit's own files
// to the same rule; test-upgrade-audit.js fails when this copy drifts from the
// toolkit's agents or from that test's JUDGES.
const C14_FINDERS = ['code', 'security', 'ux', 'plan', 'commands', 'deps', 'browser', 'copy'].map(k => 'review-' + k + '-finder').concat('index-mapper');
const C14_JUDGES = ['audit-skeptic', 'fix-verifier', 'plan-critic', 'design-critic', 'design-comparer'];
// A toolkit agent given to subagent_type, `tk:` scoped (group 1) or bare. The
// name must end there, so `index-mapper-v2` or another plugin's
// `other:plan-critic` is no match.
const C14_TARGET = new RegExp('subagent_type\\s*[=:]\\s*["\'`]?(tk:)?(' + C14_FINDERS.concat(C14_JUDGES).join('|') + ')(?![\\w-])', 'g');
// One dispatch's block (C-14): its own line and the lines after it, up to the
// next line that dispatches any agent, inside its paragraph, which ends at a
// blank line, a heading or a `---` line; the paragraph's first dispatch also
// takes the lines above it. So each model line belongs to exactly one call, and
// a paragraph holding a finder call and a judge call never mixes them up.
// Returns [from, to], both inclusive. Self-contained on purpose: C14_CALL_JS
// pastes its source into the receipt, so the receipt runs this very code.
function c14Block(lines, at) {
  const stop = (l) => /^\s*$/.test(l) || /^\s*#/.test(l) || /^\s*---\s*$/.test(l);
  const dispatches = (l) => /subagent_type\s*[=:]/.test(l) && !/^\s*\|/.test(l);
  let start = at;
  while (start > 0 && !stop(lines[start - 1])) start--;
  let end = at;
  while (end + 1 < lines.length && !stop(lines[end + 1])) end++;
  const from = lines.slice(start, at).some(dispatches) ? at : start;
  let to = at;
  while (to < end && !dispatches(lines[to + 1])) to++;
  return [from, to];
}
// Does a dispatch's block name a model (C-14)? On any line of the block a model
// parameter does: `model` with `=` or `:` and any value but `inherit`, which is
// no per-call value (a call written with it runs the agent file's model). For a
// judge call an alias on the dispatch line does too, so a doubtful judge call is
// reported and the audit decides. For a finder call an alias alone never
// counts, so a passing mention such as "it runs on Opus" cannot hide a call
// that passes no model; three more forms count as passing one there: `model`
// followed directly by an alias, `model` in backticks, and models.perRole, the
// words of the toolkit's own clause. They never make a judge call a finding, so
// a line that says not to pass a `model` is left alone. Self-contained, like
// c14Block.
function c14Names(lines, at, from, to, judge) {
  const alias = /\b(sonnet|opus|haiku|fable)\b/i;
  const param = /\bmodel\s*[=:]\s*["'`]?(?!inherit\b)[a-z]/i;
  const passed = /`model`|\bmodels\.perRole\b|\bmodel[\s"'`]{1,3}(sonnet|opus|haiku|fable)\b/i;
  if (judge && alias.test(lines[at])) return true;
  for (let i = from; i <= to; i++) if (param.test(lines[i]) || (!judge && passed.test(lines[i]))) return true;
  return false;
}
// The receipt for a C-14 dispatch finding, run with F (the file), L (the
// dispatch line), N (which line reading L, counted from the top) and K (finder
// or judge) in its environment: it prints the dispatch's block and exits 0 only
// while the finding's condition holds (a finder's block names no model, a
// judge's names one), so it fails once the fix lands, also when the fix adds
// the model on a line of its own and leaves the dispatch line as it was.
const C14_CALL_JS = 'const fs = require("fs"); ' + c14Block + ' ' + c14Names + ' ' + String.raw`const lines = fs.readFileSync(process.env.F, "utf8").split(/\r?\n/); const n = Number(process.env.N); let at = -1; for (let i = 0, c = 0; i < lines.length; i++) if (lines[i] === process.env.L && ++c === n) { at = i; break; } if (at < 0) { console.log("no line " + n + " of " + process.env.F + " reads the dispatch line"); process.exit(1); } const [from, to] = c14Block(lines, at); for (let i = from; i <= to; i++) console.log((i + 1) + ": " + lines[i]); const judge = process.env.K === "judge"; process.exit(c14Names(lines, at, from, to, judge) === judge ? 0 : 1);`;
function c14CallCheck(rel, line, n, judge) { return 'F=' + shq(rel) + ' L=' + shq(line) + ' N=' + n + ' K=' + (judge ? 'judge' : 'finder') + ' node -e ' + shq(C14_CALL_JS); }
// An agent's frontmatter with no model (C-14), read as agentFrontmatter reads
// it, the way TOOLS_NONE_AWK reads the tools line: it prints the frontmatter and
// exits 0 only while its first `model:` line carries no value or there is none
// (a missing or unclosed frontmatter has none).
const MODEL_NONE_AWK = String.raw`{ x = $0; sub(/\r$/, "", x) } NR == 1 { print NR ": " x; if ($0 != "---" && $0 != "---\r") { exit } o = 1; next } o && NR > 2 && /^---/ { e = 1; print NR ": " x; exit } o { print NR ": " x; if (!s && x ~ /^model:/) { s = 1; if (x ~ /^model:[ \t]*[^ \t]/) { t = 1 } } } END { exit (e && t) }`;
// The agent names the rows of the project's review-kinds file give, read as
// C-12 reads them: a row of three cells whose third gives subagent_type a name
// without a scope. A row C-12 reports for another reason still names its agent
// here, because C-14 asks only whether that agent states a model.
function reviewKindNames(P) {
  const names = new Set();
  if (!isFile(P(REVIEW_KINDS))) return names;
  const lines = fs.readFileSync(P(REVIEW_KINDS), 'utf8').split(/\r?\n/);
  const isRow = (l) => /^[ \t]*\|/.test(l);
  const isRule = (l) => isRow(l) && tableCells(l).every(x => /^:?-+:?$/.test(x));
  lines.forEach((line, i) => {
    if (!isRow(line) || isRule(line) || (i + 1 < lines.length && isRule(lines[i + 1]))) return;
    const cells = tableCells(line);
    const m = cells.length === 3 ? /subagent_type\s*[=:]\s*["'`]?([A-Za-z0-9:_-]+)/.exec(cells[2]) : null;
    if (m && !/:/.test(m[1])) names.add(m[1]);
  });
  return names;
}
// The seeded rules file's stamp (C-7), read as the seed-stamp detector reads it:
// the first line carrying `<!-- Toolkit version: `, the version up to a blank or
// `|`, trimmed and held to the version shape. It prints that line and exits 0
// only when the version is below T or unusable. (RULES_STAMP reads the whole
// text, so a version that ran to its line's end with no blank after it would run
// on into the next line there; no release writes a stamp that way.)
const STAMP_BEHIND_AWK = String.raw`!f && match($0, /<!-- Toolkit version: [^ |]+/) { f = 1; v = substr($0, RSTART + 22, RLENGTH - 22); x = $0; sub(/\r$/, "", x); print NR ":" x } END { if (!f) { print "no line carries the stamp <!-- Toolkit version: -->"; exit 0 } sub(/^[ \t\r]+/, "", v); sub(/[ \t\r]+$/, "", v); if (length(v) > 32 || v !~ /^[0-9]+(\.[0-9]+)?(\.[0-9]+)?(\.[0-9]+)?(-[0-9A-Za-z.]+)?$/) { exit 0 } split(v, s, "-"); p = split(s[1], a, "."); q = split(ENVIRON["T"], b, "."); for (i = 1; i <= (p > q ? p : q); i++) { x = (i <= p ? a[i] : 0) + 0; y = (i <= q ? b[i] : 0) + 0; if (x != y) { exit x > y } } exit 1 }`;
function stampBehindCheck(toVersion) { return 'T=' + shq(toVersion) + ' awk ' + shq(STAMP_BEHIND_AWK) + ' < ' + shq(SEED_RULES); }
// A settings.local.json list finding, read as the detectors read the file: the
// JSON, each permissions list holding its strings. No grep can tell which list a
// row sits in, and a row the owner moved to deny or ask is their decision.
const SETTINGS_JS = String.raw`const fs = require("fs"); let s = null; try { s = JSON.parse(fs.readFileSync(".claude/settings.local.json", "utf8")); } catch (e) { s = null; } const p = s !== null && typeof s === "object" && s.permissions !== null && typeof s.permissions === "object" ? s.permissions : {}; const list = (k) => (Array.isArray(p[k]) ? p[k].filter((x) => typeof x === "string") : []); const said = (label, out) => { out.forEach(([r]) => console.log(label + ": " + r)); process.exit(out.length ? 0 : 1); };`;
// Rows still in permissions.allow exactly as written, each with the script it
// names that must still be gone (C-8's dead entries) or none (C-9's retired
// rows, C-11's bare Skill rows).
function allowRowsCheck(label, pairs) {
  return 'node -e ' + shq(SETTINGS_JS + String.raw` said(process.argv[1], JSON.parse(process.argv[2]).filter(([r, f]) => list("allow").includes(r) && !(f && fs.existsSync(f))));`) + ' ' + shq(label) + ' ' + shq(JSON.stringify(pairs));
}
// Rows no permissions list holds in either spelling (C-9's missing and lost
// rows), each with the project script it runs, when it runs one, still a file.
// Rows compare by permissionRowKey's rule. The offered-rows record is not read:
// only /tk:setup and --stamp write it, and setup adds every row it records, so
// between an audit and its rerun the record never decides a listed row alone.
function absentRowsCheck(label, pairs) {
  return 'node -e ' + shq(SETTINGS_JS + String.raw` const key = (r) => { const m = /^(Bash|PowerShell)\(([\s\S]*):\*\)$/.exec(r); return m === null ? r : m[1] + "(" + m[2] + " *)"; }; const have = new Set(["allow", "ask", "deny"].flatMap((k) => list(k)).map(key)); said(process.argv[1], JSON.parse(process.argv[2]).filter(([r, f]) => !have.has(key(r)) && (!f || (fs.existsSync(f) && fs.statSync(f).isFile()))));`) + ' ' + shq(label) + ' ' + shq(JSON.stringify(pairs));
}
// acceptEdits where the finding says it sits (C-9): grep shows the line, and node
// exits 0 only while the key still reads acceptEdits at that level of the JSON,
// so moving a top-level key under permissions clears the top-level receipt.
function defaultModeCheck(where) {
  return 'grep -n -E -e ' + shq('"defaultMode"[[:space:]]*:[[:space:]]*"acceptEdits"') + ' -- ' + shq(LOCAL_SETTINGS) + ' ; node -e ' + shq(String.raw`const fs = require("fs"); let s = null; try { s = JSON.parse(fs.readFileSync(".claude/settings.local.json", "utf8")); } catch (e) { s = null; } const top = process.argv[1] === "top"; const o = s !== null && typeof s === "object" ? (top ? s : s.permissions) : null; const on = o !== null && o !== undefined && typeof o === "object" && o.defaultMode === "acceptEdits"; console.log((top ? "top level" : "under permissions") + ": " + (on ? "acceptEdits" : "not acceptEdits")); process.exit(on ? 0 : 1);`) + ' ' + where;
}

// The permissions lists of a parsed settings file, each holding its strings.
function settingsLists(settings) {
  const p = settings && typeof settings === 'object' && settings.permissions && typeof settings.permissions === 'object' ? settings.permissions : {};
  const list = (k) => (Array.isArray(p[k]) ? p[k].filter(x => typeof x === 'string') : []);
  return { allow: list('allow'), ask: list('ask'), deny: list('deny') };
}
// The copy-install migration's record, when it is a readable JSON object.
// Missing or malformed, it is no record: nothing that reads it reports.
function readMigration(P) {
  const read = readJson(P(MIGRATION_REL), null);
  return read && typeof read === 'object' && !Array.isArray(read) ? read : null;
}
// The shipped seed's retired permission rows (issue #173), by permissionRowKey,
// so `Bash(xdg-open:*)` is the retired `Bash(xdg-open *)` (issue #179); `#` lines
// are comments. Null when the plugin root ships no list.
function readRetiredKeys(pluginRoot) {
  const lines = readLines(path.join(pluginRoot, 'seed', 'retired-permission-rows.txt'));
  return lines === null ? null : new Set(lines.filter(l => l !== '' && !l.startsWith('#')).map(permissionRowKey));
}
// The rows of the project's own a migration removed although their script
// stayed (C-9, issue #179). Only a record's `deadPermissions` list names the
// rows a migration removed: 7.0.0 and 7.0.1 wrote one (7.0.0 listed every
// .claude/scripts/ row, 7.0.1 only the rows it found dead), while 7.1.0 and
// later keep a count, and a count names no row. The backup copy of
// settings.local.json is no source: it holds every row the file had before the
// migration, the ones the migration kept included, so a kept row the owner
// deleted afterwards read as lost. A row counts when it runs a file under this
// project's .claude/scripts/ that exists now (an absolute path only inside this
// project), the retired list does not name it, and setup would not remove it
// again as dead. Rows compare by permissionRowKey, so two spellings of one rule
// are one candidate, kept in the spelling the record lists first.
function lostRowCandidates(P, project, migration, retiredKeys) {
  const out = [];
  const exists = (rel) => fs.existsSync(P(rel));
  for (const row of Array.isArray(migration.deadPermissions) ? migration.deadPermissions : []) {
    if (typeof row !== 'string') continue;
    const key = permissionRowKey(row);
    const rel = rowScriptRel(row, project);
    if (rel === null || !isFile(P(rel)) || retiredKeys.has(key) || deadPermission(row, exists) || out.some(x => x.key === key)) continue;
    out.push({ row, rel, key });
  }
  return out;
}
// The end of a clean /tk:upgrade, after --stamp records the version: every
// candidate lostRowCandidates names goes into the offered-rows record, whether
// the file has the row now (put back by this run's fix, or never lost) or not
// (the owner declined it), as /tk:setup records a seed row that was present. So
// a row the owner removes afterwards is not offered again in this working copy,
// and a fresh clone, with no record, is offered it once. The audit run itself
// never writes the record: /tk:upgrade reruns the audit to decide FIXED, and a
// row recorded at the first run would drop out of the rerun whether or not its
// fix was applied. Nothing is recorded outside a git repository, with no record
// in the migration's rows, or while settings.local.json is missing or is no
// readable JSON object (no decision of the owner's can sit in it).
function recordLostRowOffers(P, project, pluginRoot) {
  const migration = readMigration(P);
  const retiredKeys = readRetiredKeys(pluginRoot);
  const local = readJson(P(LOCAL_SETTINGS), null);
  if (migration === null || retiredKeys === null || local === null || typeof local !== 'object' || Array.isArray(local)) return;
  const candidates = lostRowCandidates(P, project, migration, retiredKeys);
  const file = candidates.length ? offeredRowsPath(project) : null;
  if (file === null) return;
  const record = readOfferedRows(file);
  const known = record.status === 'ok' ? record.keys : new Set();
  const fresh = candidates.filter(x => !known.has(x.key));
  if (!fresh.length) return;
  if (!writeOfferedRows(file, [...known, ...fresh.map(x => x.key)])) {
    console.error('upgrade-audit: could not write the offered-rows record, so C-9 may offer the same ' + (fresh.length === 1 ? 'row' : fresh.length + ' rows') + ' again');
    return;
  }
  console.error('upgrade-audit: recorded ' + (fresh.length === 1 ? '1 permission row' : fresh.length + ' permission rows') + ' of the project\'s own that C-9 offers back in the offered-rows record, so this working copy is not offered '
    + (fresh.length === 1 ? 'it' : 'them') + ' again');
}

// --rollback-to <x.y.z> (issue #183): the one path that lowers the recorded
// version. Run it from the project root while this release is still the running
// plugin and before the older release is reinstalled. That older release reads
// three keys: its version guard (the session-start.js notice and the
// pre-push-check.js block) takes the first present key of auditedVersion,
// previousVersion and version and blocks every push while that version is newer
// than itself, and its --stamp refuses to write while auditedVersion or version
// is newer, so a newer `version` alone would end every /tk:upgrade on it without
// its stamp. Neither ever lowers a key. So each of the three keys whose version
// is above the target is set to the target, and every other key, a key whose
// value is no usable version included, stays exactly as it was. It prints each
// key it changed, before and after. It refuses, with exit 1 and nothing written,
// when the target is not a plain x.y.z version, when there is no readable state
// file, and when no key records a usable version above the target. --stamp
// alone still never lowers anything.
function rollbackRecord(P, target) {
  const refuse = (why) => { console.error('upgrade-audit: not rolling back: ' + why); process.exit(1); };
  if (!/^\d+\.\d+\.\d+$/.test(target) || validVersion(target) === null) refuse('--rollback-to takes a release version such as 7.1.0');
  if (!fs.existsSync(P(STATE_REL))) refuse('this project has no ' + STATE_REL + ', so there is no recorded version to lower');
  const state = readJson(P(STATE_REL), null);
  if (state === null || typeof state !== 'object' || Array.isArray(state)) refuse(STATE_REL + ' is not a readable JSON object');
  const keys = ['auditedVersion', 'previousVersion', 'version'];
  if (keys.every(k => validVersion(state[k]) === null)) refuse(STATE_REL + ' records no usable version');
  const next = Object.assign({}, state);
  const changed = [];
  for (const k of keys) {
    const v = validVersion(state[k]);
    if (v !== null && compareVersions(v, target) === 1) { next[k] = target; changed.push(k + ': ' + v + ' -> ' + target); }
  }
  if (!changed.length) refuse(STATE_REL + ' records no version above ' + target + '; a rollback only lowers the record');
  try { fs.writeFileSync(P(STATE_REL), JSON.stringify(next, null, 2) + '\n'); } catch (e) { refuse('could not write ' + STATE_REL + ' (' + (e.code || 'write failed') + ')'); }
  console.error('upgrade-audit: rolled back ' + STATE_REL + ' to ' + target + ':');
  for (const line of changed) console.error('upgrade-audit:   ' + line);
  // The state file is committed so every collaborator's guard reads the same record.
  console.error('upgrade-audit: every other key is as it was. Commit ' + STATE_REL + ', then reinstall the ' + target + ' release: its version guard accepts a recorded version equal to its own.');
}

// --- seeded blocks (C-15) and the lessons index (C-16) --------------------------
// The text units the toolkit's project seeds are made of, read one way here and
// by scripts/seed-history.js, the maintainer script that writes the two history
// seeds from the seed files at every release tag (it requires this file for
// these readers; the audit runs only when the script is invoked directly):
//   seed/historical-seed-blocks.txt  one line per block, and per whole file, an
//                                    older release's seed shipped: hash, kind,
//                                    project file, first release
//   seed/toolkit-lesson-leads.txt    every bold lead the toolkit's own
//                                    LESSONS.md has carried
// A seeded block is one text unit a seed shipped. Three kinds:
//   opening-comment  the first HTML comment of the file (DESIGN-PROFILE.md and
//                    LESSONS.md: the comment that explains the file)
//   comments         every HTML comment of the file (CLAUDE.md: one per section)
//   paragraphs       every paragraph of the file, blank-line separated, a fenced
//                    code block never split (.claude/toolkit/README.md)
// A block equal to a block an older seed shipped, and not to the current
// seed's, is seed text that fell behind; a block equal to no seed version is
// the owner's own text and is never reported. Lines are compared with the byte
// order mark, the CR and trailing whitespace dropped, so a file saved with
// Windows line endings is the same seed.
const HISTORY_FILE = 'historical-seed-blocks.txt';
const LEADS_FILE = 'toolkit-lesson-leads.txt';
const HASH_LENGTH = 16;
// The project files setup seeds: the project path, the seed each comes from
// under the plugin's seed/ folder, the block kind, and every repository path a
// release may have shipped that seed at, newest layout first: the seed/ folder
// from v7.1.0, the committed plugin/seed/ copies of v7.0.x, and before the seed
// folder existed the repository's own root CLAUDE.md and LESSONS.md, which the
// copy-installers copied into projects, plus the copy-install's design profile
// template (v6.2.0 on).
const SEED_FILES = [
  { rel: 'CLAUDE.md', seed: 'CLAUDE.md', kind: 'comments', history: ['seed/CLAUDE.md', 'plugin/seed/CLAUDE.md', 'CLAUDE.md'] },
  { rel: 'LESSONS.md', seed: 'LESSONS.md', kind: 'opening-comment', history: ['seed/LESSONS.md', 'plugin/seed/LESSONS.md', 'LESSONS.md'] },
  { rel: 'DESIGN-PROFILE.md', seed: 'DESIGN-PROFILE.md', kind: 'opening-comment', history: ['seed/DESIGN-PROFILE.md', 'plugin/seed/DESIGN-PROFILE.md', '.claude/skills/shared/design-profile-template.md'] },
  { rel: '.claude/toolkit/README.md', seed: 'toolkit-README.md', kind: 'paragraphs', history: ['seed/toolkit-README.md', 'plugin/seed/toolkit-README.md'] },
];
const KIND_WORD = { 'opening-comment': 'the comment that explains the file', comments: 'a section comment', paragraphs: 'a paragraph' };
// The repository paths the toolkit's own lessons file has lived at: the root
// file every copy-installer copies into a fresh project, and the plugin seed of
// v7.0.x, which carried the same lessons (from v7.1.0 the seed is blank).
const LESSON_SOURCES = ['LESSONS.md', 'plugin/seed/LESSONS.md', 'seed/LESSONS.md'];
const PLUGIN_ROOT_VAR = '${CLAUDE_PLUGIN_ROOT}';
const STABLE_PLUGIN_PATH = '~/.claude/plugins/data/tk-llm-peer-review/current';
// How alike (Dice, below) a current block must be to an older one to be
// offered as its replacement.
const NEAR_BLOCK = 0.3;

function normalizeLines(text) {
  return String(text).replace(/^\uFEFF/, '').split('\n').map(l => l.replace(/\r$/, '').replace(/[ \t]+$/, ''));
}
function hashLines(lines) {
  return crypto.createHash('sha256').update(lines.join('\n') + '\n').digest('hex').slice(0, HASH_LENGTH);
}
// The whole file, trailing blank lines dropped, so a missing final newline does
// not make it a different file.
function fileHash(lines) {
  const l = lines.slice();
  while (l.length && l[l.length - 1] === '') l.pop();
  return hashLines(l);
}
// A block: 1-based first and last line, and the lines themselves.
function blockSpan(lines, a, b) { return { start: a + 1, end: b + 1, lines: lines.slice(a, b + 1) }; }
// HTML comments: from a line that opens with <!-- (after indentation) to the
// first line that holds -->, the same line for a one-line comment.
function commentBlocks(lines) {
  const out = [];
  let open = -1;
  for (let i = 0; i < lines.length; i++) {
    if (open < 0) {
      if (!/^\s*<!--/.test(lines[i])) continue;
      open = i;
    }
    if (lines[i].includes('-->')) { out.push(blockSpan(lines, open, i)); open = -1; }
  }
  return out;
}
// Paragraphs: runs of non-blank lines. A fenced code block belongs to the
// paragraph it starts in, blank lines inside it included.
function paragraphBlocks(lines) {
  const out = [];
  let start = -1;
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '' && !fenced) {
      if (start >= 0) { out.push(blockSpan(lines, start, i - 1)); start = -1; }
      continue;
    }
    if (start < 0) start = i;
    if (/^\s*(```|~~~)/.test(lines[i])) fenced = !fenced;
  }
  if (start >= 0) {
    let end = lines.length - 1;
    while (end > start && lines[end].trim() === '') end--;
    out.push(blockSpan(lines, start, end));
  }
  return out;
}
function blocksOf(kind, lines) {
  if (kind === 'comments') return commentBlocks(lines);
  if (kind === 'opening-comment') return commentBlocks(lines).slice(0, 1);
  if (kind === 'paragraphs') return paragraphBlocks(lines);
  throw new Error('upgrade-audit: unknown block kind ' + kind);
}
// How alike two blocks are, as the Dice coefficient of their word sets.
function similarity(a, b) {
  const words = (ls) => new Set(ls.join(' ').toLowerCase().match(/[a-z0-9][a-z0-9'.-]*/g) || []);
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return (2 * both) / (A.size + B.size);
}
// One entry per line of the history seed, `<hash> <block|file> <project path>
// <first release>`; comment lines start with #. Returns project file -> hash ->
// { kind, release }; the first line for a hash wins.
function parseHistory(text) {
  const byFile = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [hash, kind, rel, release] = line.split(/\s+/);
    if (!hash || !kind || !rel || !release) continue;
    if (!byFile.has(rel)) byFile.set(rel, new Map());
    const m = byFile.get(rel);
    if (!m.has(hash)) m.set(hash, { kind, release });
  }
  return byFile;
}
// The receipt for a block (or, with A=0, the whole file): prints its lines
// numbered, then `hash <h>`, and exits 0 only while the hash is still H. The
// same normalization as normalizeLines and fileHash, so a fix that changes one
// character of the block, or moves it, fails the receipt.
const BLOCK_JS = 'const fs=require("fs"),c=require("crypto");'
  + 'const L=fs.readFileSync(process.env.F,"utf8").replace(/^\\uFEFF/,"").split("\\n").map(l=>l.replace(/\\r$/,"").replace(/[ \\t]+$/,""));'
  + 'const a=+process.env.A,b=+process.env.B;const s=a?L.slice(a-1,b):L.slice();if(!a)while(s.length&&s[s.length-1]==="")s.pop();'
  + 's.forEach((l,i)=>console.log((a?a+i:i+1)+":"+l));'
  + 'const h=c.createHash("sha256").update(s.join("\\n")+"\\n").digest("hex").slice(0,' + HASH_LENGTH + ');console.log("hash "+h);process.exit(h===process.env.H?0:1)';
function blockCheck(rel, a, b, h) { return 'F=' + shq(rel) + ' A=' + a + ' B=' + b + ' H=' + shq(h) + ' node -e ' + shq(BLOCK_JS); }

// The bullets of a lessons index, HTML comments skipped (the seed's own comment
// shows an example bullet): each with its first and last line, its text (the
// continuation lines joined) and its bold lead when it opens with one.
function lessonBullets(lines) {
  const out = [];
  let inComment = false;
  let cur = null;
  const flush = () => { if (cur) { out.push(cur); cur = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inComment) { if (line.includes('-->')) inComment = false; continue; }
    if (/^\s*<!--/.test(line)) { flush(); if (!line.includes('-->')) inComment = true; continue; }
    const m = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (m) { flush(); cur = { start: i + 1, end: i + 1, text: m[1].trim() }; continue; }
    if (cur && line.trim() !== '' && !/^\s*#/.test(line)) { cur.text += ' ' + line.trim(); cur.end = i + 1; continue; }
    flush();
  }
  flush();
  for (const b of out) { const lead = /^\*\*(.+?)\*\*/.exec(b.text); b.lead = lead ? lead[1].trim() : null; }
  return out;
}
// A lead as compared: case, spacing and a closing period or colon set aside.
function leadKey(lead) { return String(lead).toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.:!]+$/, '').trim(); }
// Beyond one sentence, or over 300 characters: the index is the always-read
// surface, so a write-up there costs every session. A sentence ends at a
// period, question or exclamation mark (closing quotes, stars or a backtick
// allowed after it) followed by whitespace and more text. A period right
// after a single letter (e.g., i.e., a.m.) is an abbreviation, not an end, so
// a one-sentence bullet that uses one is not reported (review fix R4).
const SENTENCE_BREAK = /(?:[!?]|(?<!(?:^|[^A-Za-z])[A-Za-z])\.)[\]"')*`]*[ \t]+[^ \t]/g;
const LONG_BULLET_CHARS = 300;
function isLongBullet(text) { return text.length > LONG_BULLET_CHARS || (text.match(SENTENCE_BREAK) || []).length > 0; }
// The receipt for the long-bullet finding: the same reading in awk (comments
// skipped, continuation lines joined, the same sentence break and abbreviation
// rule), printing each
// bullet beyond the rule as `<line>: <text>` and exiting 0 only while one is
// left. The caller prefixes the test that LESSONS-detail.md is still absent.
const LONG_BULLETS_AWK = String.raw`function brk(t,  n, i, m, pre) { n = 0; i = 1; while (match(substr(t, i), /[.!?][]"')*` + '`' + String.raw`]*[ \t]+[^ \t]/)) { m = i + RSTART - 1; pre = substr(t, 1, m - 1); if (!(substr(t, m, 1) == "." && pre ~ /(^|[^A-Za-z])[A-Za-z]$/)) n++; i = m + RLENGTH - 1 } return n }
function flush() { if (b) { if (length(t) > ` + LONG_BULLET_CHARS + String.raw` || brk(t) > 0) { print s ": " substr(t, 1, 160); f = 1 } b = 0 } }
{ sub(/[ \t\r]+$/, "") }
c { if (index($0, "-->")) c = 0; next }
/^[ \t]*<!--/ { flush(); if (!index($0, "-->")) c = 1; next }
/^[ \t]*[-*+][ \t]+/ { flush(); s = NR; t = $0; sub(/^[ \t]*[-*+][ \t]+/, "", t); b = 1; next }
b && $0 !~ /^[ \t]*$/ && $0 !~ /^[ \t]*#/ { x = $0; sub(/^[ \t]+/, "", x); t = t " " x; next }
{ flush() }
END { flush(); exit !f }`;

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cwd = opts.project ? path.resolve(opts.project) : process.cwd();
  const project = git(['rev-parse', '--show-toplevel'], cwd) || cwd;
  const P = (rel) => path.join(project, rel);
  if (opts.rollbackTo !== null) { rollbackRecord(P, opts.rollbackTo); return; }
  const pluginRoot = path.resolve(opts.pluginRoot || path.join(__dirname, '..'));
  const conventionsPath = opts.conventions || path.join(pluginRoot, 'skills', 'shared', 'conventions.md');
  const toVersion = validVersion(readJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), {}).version);
  if (toVersion === null) { console.error('upgrade-audit: no usable version in ' + path.join(pluginRoot, '.claude-plugin', 'plugin.json')); process.exit(1); }
  const state = readJson(P(STATE_REL), null);
  if (opts.stamp) {
    // The --refuted file is read before anything is written, so a bad path
    // stops the run with the state file untouched.
    const refutedKeys = opts.refuted === null ? [] : readRefutedFile(path.resolve(opts.refuted));
    if (refutedKeys === null) { console.error('upgrade-audit: the --refuted file could not be read: ' + opts.refuted); process.exit(1); }
    // A stamp never lowers the record: a project audited (or set up) on a
    // newer plugin than this one keeps what it has. Only validated versions are
    // compared or printed.
    const recorded = state && typeof state === 'object' ? [validVersion(state.auditedVersion), validVersion(state.version)].filter(v => v !== null && compareVersions(v, toVersion) === 1) : [];
    if (recorded.length) {
      console.error('upgrade-audit: not stamping: ' + STATE_REL + ' already records ' + recorded[0] + ', newer than this plugin (' + toVersion + ')');
      return;
    }
    // The end of a clean /tk:upgrade: this project is now audited up to the
    // plugin version, so the next run's range starts here.
    const next = Object.assign({}, state || {}, { version: toVersion, auditedVersion: toVersion, auditedAt: new Date().toISOString() });
    fs.mkdirSync(path.dirname(P(STATE_REL)), { recursive: true });
    fs.writeFileSync(P(STATE_REL), JSON.stringify(next, null, 2) + '\n');
    console.error('upgrade-audit: stamped ' + STATE_REL + ' as audited up to ' + toVersion);
    // A rules file whose text is the shipped seed's is current (C-7 does not
    // report it), so its stamp follows the audit. One whose text differs keeps
    // its stamp, and C-7 reports it again on the next upgrade.
    restampRules(P, pluginRoot, toVersion);
    recordLostRowOffers(P, project, pluginRoot);
    recordRefutedKeys(project, refutedKeys);
    return;
  }
  if (!fs.existsSync(conventionsPath)) { console.error('upgrade-audit: conventions file not found: ' + conventionsPath); process.exit(1); }
  if (opts.from && validVersion(opts.from) === null) { console.error('upgrade-audit: --from takes a version such as 7.0.0'); process.exit(1); }
  // A recorded value of the wrong shape is no usable start: every convention up
  // to the plugin version applies, as with no state file, and the value is
  // never printed.
  const recordedFrom = referenceVersion(state);
  const unusableRecord = !opts.from && recordedFrom === null && state !== null && ['auditedVersion', 'previousVersion', 'version'].some(k => typeof state[k] === 'string' && state[k].trim() !== '');
  const fromVersion = opts.from ? validVersion(opts.from) : recordedFrom;

  const all = parseConventions(fs.readFileSync(conventionsPath, 'utf8'));
  for (const c of all) if (validVersion(c.since) === null) { console.error('upgrade-audit: bad Since in ' + c.id); process.exit(1); }
  const afterFrom = (c) => fromVersion === null || compareVersions(c.since, fromVersion) > 0;
  const inRange = all.filter(c => (c.always || afterFrom(c)) && compareVersions(c.since, toVersion) <= 0);

  // Inventory: everything the project owns in the toolkit folders, plus CLAUDE.md
  // and (for C-11, issue #179) the other files its sessions read.
  const promptFiles = [];
  for (const dir of PROJECT_PROMPT_DIRS) for (const rel of walkFiles(P(dir), dir, [])) if (rel !== SEED_RULES && /\.md$/.test(rel)) promptFiles.push(rel);
  const claudeMd = fs.existsSync(P('CLAUDE.md')) ? ['CLAUDE.md'] : [];
  const sessionFiles = SESSION_READ_FILES.map(([rel]) => rel).filter(rel => isFile(P(rel)));
  const scopeFiles = { 'prompt-files': promptFiles, 'claude-md': claudeMd, 'prompt-files+claude-md': [...promptFiles, ...claudeMd], 'prompt-files+session-files': [...promptFiles, ...sessionFiles] };
  const sessionSeverity = new Map(SESSION_READ_FILES);
  const notes = [];
  // The refuted record (issue #213): findings whose key it lists are left out
  // of the output below, and the summary counts them.
  const refutedFile = refutedRecordPath(project);
  const refutedRecord = refutedFile === null ? { status: 'absent', keys: new Set() } : readRefutedKeys(refutedFile);
  if (refutedRecord.status === 'unreadable') notes.push('the refuted record ' + refutedFile + ' could not be read, so it suppresses nothing this run');
  const retiredKeys = readRetiredKeys(pluginRoot);
  const localExists = fs.existsSync(P(LOCAL_SETTINGS));
  const local = readJson(P(LOCAL_SETTINGS), null);
  const localAllow = (local && local.permissions && Array.isArray(local.permissions.allow) ? local.permissions.allow : []).filter(p => typeof p === 'string');
  const exists = (rel) => fs.existsSync(P(rel));
  const migration = readMigration(P);
  const migrationName = () => { const to = migration ? validVersion(migration.to) : null; return to ? 'the ' + to + ' migration' : 'the migration from the copy-install'; };

  const findings = [];
  const emit = (f) => findings.push(f);
  const claim = keyMaker();
  for (const c of inRange) {
    if (c.detector === 'regex') {
      const files = scopeFiles[c.scope] || [];
      for (const rel of files) {
        const lines = fs.readFileSync(P(rel), 'utf8').split(/\r?\n/);
        for (const pat of c.patterns) {
          let re; try { re = new RegExp(pat); } catch (e) { console.error('upgrade-audit: bad pattern in ' + c.id + ': ' + pat); process.exit(1); }
          lines.forEach((line, i) => {
            if (!re.test(line)) return;
            const { key, n } = claim(c.id + ':' + rel + ':' + digest(pat + '\n' + line));
            emit({ id: c.id, key, severity: 'warn', convention: c.title, file: { relPath: rel, line: i + 1 },
              what: 'Should fix. ' + rel + ' line ' + (i + 1) + ' is behind convention ' + c.id + ' (' + c.title + ').',
              fix: c.fix, since: c.since,
              receipt: { check: regexCheck(rel, line, n, pat), expect: 'line ' + (i + 1) + ' matches: ' + line.trim().slice(0, 120) } });
          });
        }
      }
    } else if (c.detector === 'seed-stamp') {
      if (fs.existsSync(P(SEED_RULES))) {
        const text = fs.readFileSync(P(SEED_RULES), 'utf8');
        const m = RULES_STAMP.exec(text);
        const stamped = m ? validVersion(m[1]) : null;
        const seedAbs = path.join(pluginRoot, RULES_SEED);
        const seedText = stamped === null ? null : readText(seedAbs);
        // A stamp at or above the plugin version is current, as it always was.
        // An older stamp is a finding only when the text differs from the
        // shipped seed (review fix R4): every release moves the stamp, so the
        // stamp alone would report every project on every release. With no
        // shipped seed to compare, or no usable stamp, the stamp alone decides.
        const behind = stamped === null || compareVersions(stamped, toVersion) < 0;
        if (behind && stamped !== null && seedText === null) notes.push(c.id + ': no shipped seed/rules-toolkit.md under the plugin root, so the rules text was not compared and the stamp alone decides');
        if (behind && seedText !== null) {
          const at = text.split('\n').findIndex(l => RULES_STAMP.test(l)) + 1;
          if (!rulesMatchSeed(text, seedText)) emit({ id: c.id, key: claim(c.id + ':' + SEED_RULES + ':rules-text').key, severity: 'warn', convention: c.title, file: { relPath: SEED_RULES, line: at },
            what: 'Should fix. The seeded rules file\'s text differs from the rules seed this plugin (' + toVersion + ') ships: the seeded rules text changed since the project\'s copy (stamped ' + stamped + ') was written, or the project edited its copy. The comparison leaves the stamp line out of both files, so the seed file\'s own stamp plays no part.',
            fix: (c.fix || 'merge the shipped seed text into the rules file by hand and update its stamp, or delete the file and run /tk:setup for a fresh seed')
              + (seedText.split('\n').some(l => RULES_PROJECT_MARKER.test(l)) && !text.split('\n').some(l => RULES_PROJECT_MARKER.test(l))
                ? '; this file has no project marker: copy the seed\'s `<!-- Project section:` line to the end of the seeded text and move your own lines under it, where they are never compared' : ''), since: c.since,
            // Both halves of the detector: the stamp is still below the plugin
            // version (issue #179), and the text still differs. diff exits 1 on
            // a difference, so the check turns that 1 into a 0. An unreadable
            // input would make awk print nothing and diff exit 1 too, so both
            // files are tested first: a missing seed (a plugin update removed
            // its cache directory) or a run from the wrong directory fails the
            // receipt instead of confirming the finding.
            receipt: { check: 'if test -f ' + shq(seedAbs) + ' && test -r ' + shq(seedAbs) + ' && test -f ' + shq(SEED_RULES) + ' && test -r ' + shq(SEED_RULES)
                + ' ; then ' + stampBehindCheck(toVersion) + ' && { diff <(awk ' + shq(RULES_BODY_AWK) + ' ' + shq(seedAbs) + ') <(awk ' + shq(RULES_BODY_AWK) + ' ' + shq(SEED_RULES) + ') ; test $? -eq 1 ; } ; else echo ' + shq('receipt: cannot read the shipped seed or the project rules file') + ' >&2 ; false ; fi',
              expect: 'line ' + at + ' shows the stamp ' + stamped + ', below ' + toVersion + ' (the stamp check passes only while the stamp is below it); diff then prints the lines where the shipped seed (<) and the project copy (>) differ, with the stamp line and everything from the project marker down left out of both, trailing blanks and CR ignored; the check exits 0 only when they differ, and exits non-zero when either file cannot be read' } });
        } else if (behind) emit({ id: c.id, key: claim(c.id + ':' + SEED_RULES + ':stamp').key, severity: 'warn', convention: c.title, file: { relPath: SEED_RULES, line: 3 },
          what: 'Should fix. The seeded rules file is stamped ' + (stamped || 'with no usable version') + ' while the plugin is ' + toVersion + '.',
          fix: c.fix || 'delete the rules file and run /tk:setup for a fresh seed, or merge the new seed text by hand and update the stamp', since: c.since,
          receipt: { check: stampBehindCheck(toVersion), expect: 'the stamp line, whose version is below ' + toVersion + ' or not a usable version (or a line saying no line carries the stamp); the check exits 0 only then' } });
      }
    } else if (c.detector === 'dead-permissions') {
      const dead = localAllow.filter(p => deadPermission(p, exists));
      // The script each dead row names, which must still be gone; a legacy
      // shape names none and is dead as long as it is there.
      const scriptOf = (p) => (LEGACY_DEAD_PERMISSION.some(re => re.test(permissionRowKey(p))) ? '' : '.claude/scripts/' + ROW_SCRIPT_REL.exec(p)[1]);
      if (dead.length) emit({ id: c.id, key: claim(c.id + ':' + LOCAL_SETTINGS + ':dead-rows').key, severity: 'suggest', convention: c.title, file: { relPath: LOCAL_SETTINGS },
        what: 'Optional. ' + dead.length + ' permission entr' + (dead.length === 1 ? 'y points' : 'ies point') + ' at scripts the plugin no longer places in the project.',
        fix: c.fix || 'remove them; the plugin commands carry their own allowed-tools', since: c.since,
        fields: [{ label: 'Entries', value: dead.join(' ; ') }],
        receipt: { check: allowRowsCheck('dead', dead.map(p => [p, scriptOf(p)])), expect: dead.length + ' line(s) reading dead: <row>, one per listed entry still in "permissions.allow" whose script is still gone' } });
    } else if (c.detector === 'permission-rows') {
      if (localExists && local === null) { notes.push(c.id + ' skipped: ' + LOCAL_SETTINGS + ' is not readable JSON'); continue; }
      // Rows compare by permissionRowKey (issue #179): Claude Code matches
      // `Bash(git status:*)` exactly as `Bash(git status *)`. A row counts as
      // present in any permissions list, allow, ask or deny, as setup counts it.
      const lists = settingsLists(local);
      const present = new Set([...lists.allow, ...lists.ask, ...lists.deny].map(permissionRowKey));
      // The offered-rows record shared with /tk:setup (issue #180): a row this
      // working copy was offered before is not reported again. It filters only
      // a file that exists, as setup does: a missing settings.local.json holds
      // no decision of the owner's. Unreadable, it counts as no record.
      const recordFile = localExists ? offeredRowsPath(project) : null;
      const record = recordFile === null ? { status: 'absent', keys: new Set() } : readOfferedRows(recordFile);
      const offered = record.status === 'ok' ? record.keys : new Set();
      // (a) Toolkit rows the project lacks, filtered exactly as setup filters
      //     the seed before its merge, so re-running /tk:setup adds each one.
      const seed = readJson(path.join(pluginRoot, 'seed', 'settings.local.json'), null);
      if (seed === null) notes.push(c.id + ': no shipped seed settings under the plugin root, missing rows not checked');
      else {
        const seedAllow = fillPluginCache(seed.permissions && Array.isArray(seed.permissions.allow) ? seed.permissions.allow : [], pluginRoot)
          .filter(p => typeof p === 'string' && !deadPermission(p, exists));
        const seedKeys = new Set();
        // A seed row is reported only when no list holds it and it was never offered here.
        const notYet = (k) => !present.has(k) && !offered.has(k);
        const missing = seedAllow.filter(p => { const k = permissionRowKey(p); if (seedKeys.has(k)) return false; seedKeys.add(k); return notYet(k); });
        if (!localExists) emit({ id: c.id, key: claim(c.id + ':' + LOCAL_SETTINGS + ':no-file').key, severity: 'suggest', convention: c.title, file: { relPath: LOCAL_SETTINGS },
          what: 'Optional. The project has no ' + LOCAL_SETTINGS + ', so none of the toolkit\'s ' + seedAllow.length + ' permission rows are granted.',
          fix: 're-run /tk:setup, which writes the file from the shipped seed', since: c.since,
          receipt: { check: 'test ! -e ' + shq(LOCAL_SETTINGS) + ' && echo ' + shq('absent: ' + LOCAL_SETTINGS), expect: 'absent: ' + LOCAL_SETTINGS } });
        else if (missing.length) emit({ id: c.id, key: claim(c.id + ':' + LOCAL_SETTINGS + ':missing-rows').key, severity: 'suggest', convention: c.title, file: { relPath: LOCAL_SETTINGS },
          what: 'Optional. ' + LOCAL_SETTINGS + ' lacks ' + missing.length + ' permission row' + (missing.length === 1 ? '' : 's') + ' the shipped toolkit seed carries, so those steps ask for permission.',
          fix: 're-run /tk:setup, which merges the missing toolkit rows into ' + LOCAL_SETTINGS + ' and keeps every row of yours', since: c.since,
          fields: [{ label: 'Missing rows', value: missing.join(' ; ') }],
          receipt: { check: absentRowsCheck('missing', missing.map(p => [p, ''])),
            expect: missing.length + ' line(s) reading missing: <row>, one per toolkit row that no permissions list (allow, ask or deny) holds in either spelling' } });
        // Seed ask rows the project lacks (issue #192): without them the broad
        // `Bash(git push *)` allow row lets a force push run unasked, so this is
        // its own Should fix finding, filtered like the allow rows above.
        const seedAsk = (seed.permissions && Array.isArray(seed.permissions.ask) ? seed.permissions.ask : []).filter(p => typeof p === 'string');
        const missingAsk = seedAsk.filter(p => { const k = permissionRowKey(p); if (seedKeys.has(k)) return false; seedKeys.add(k); return notYet(k); });
        if (localExists && missingAsk.length) emit({ id: c.id, key: claim(c.id + ':' + LOCAL_SETTINGS + ':missing-ask-rows').key, severity: 'warn', convention: c.title, file: { relPath: LOCAL_SETTINGS },
          what: 'Should fix. ' + LOCAL_SETTINGS + ' lacks ' + missingAsk.length + ' ask row' + (missingAsk.length === 1 ? '' : 's') + ' the shipped toolkit seed carries, so a force push matches the allow row for git push and runs without asking.',
          fix: 're-run /tk:setup, which merges the missing rows into "permissions.ask" in ' + LOCAL_SETTINGS + ' and keeps every row of yours', since: c.since,
          fields: [{ label: 'Missing ask rows', value: missingAsk.join(' ; ') }],
          receipt: { check: absentRowsCheck('missing', missingAsk.map(p => [p, ''])),
            expect: missingAsk.length + ' line(s) reading missing: <row>, one per toolkit ask row that no permissions list (allow, ask or deny) holds in either spelling' } });
      }
      // (b) Rows the shipped retired list names, in either spelling:
      //     maintainer-only grants, old copy-install script rows and unscoped
      //     Skill rows an older seed wrote.
      if (retiredKeys === null) notes.push(c.id + ': no retired-permission-rows.txt under the plugin root, retired rows not checked');
      else {
        // A retired Skill row naming a command, skill or agent the project owns
        // is the project's own grant (the same exemption C-11 makes), so it stays.
        const owned = new Set(piecesUnder(P('.claude')));
        const ownRow = (p) => { const m = /^Skill\(([a-z0-9-]+)(:\*)?\)$/.exec(p); return m !== null && owned.has(m[1]); };
        const still = lists.allow.filter(p => retiredKeys.has(permissionRowKey(p)) && !ownRow(p));
        // One finding for every retired row (issue #198 undid #186's per-reason
        // groups). `Bash(npm install *)`, the one row a project might still need,
        // is not on the retired list at all, so nothing here asks to remove it.
        if (still.length) emit({ id: c.id, key: claim(c.id + ':' + LOCAL_SETTINGS + ':retired-rows').key, severity: 'warn', convention: c.title, file: { relPath: LOCAL_SETTINGS },
          what: 'Should fix. ' + LOCAL_SETTINGS + ' still carries ' + still.length + ' permission row' + (still.length === 1 ? '' : 's') + ' the toolkit seed retired: grants for the toolkit\'s own repository or rows that no longer match anything.',
          fix: 'remove the listed rows from ' + LOCAL_SETTINGS + '; the current seed does not carry them and the plugin commands carry their own permissions', since: c.since,
          fields: [{ label: 'Retired rows', value: still.join(' ; ') }],
          receipt: { check: allowRowsCheck('retired', still.map(p => [p, ''])), expect: still.length + ' line(s) reading retired: <row>, one per listed row still in "permissions.allow"' } });
      }
      // (c) acceptEdits: a question, never an auto-fix, worded for where the key
      //     sits. The 7.0.x seed wrote it at the top level, where Claude Code
      //     does not document it (defaultMode belongs under permissions), so it
      //     may never have taken effect; under permissions it auto-accepts every
      //     file edit, which a user may have chosen. The rest of C-9 runs on every
      //     upgrade; this question is asked only when the range crosses the
      //     convention's Since (issue #179), so an answer is never asked twice.
      const modeAt = [];
      if (afterFrom(c) && local && local.defaultMode === 'acceptEdits') modeAt.push({ key: 'top',
        what: 'Optional. ' + LOCAL_SETTINGS + ' has a top-level "defaultMode": "acceptEdits", a leftover key an older toolkit seed wrote. Claude Code documents defaultMode under "permissions", so where it sits it may have no effect.',
        fix: 'a question for the user, never an auto-fix: ask whether to delete the leftover key, or move it under "permissions" if they want file edits auto-accepted; change nothing without their answer' });
      if (afterFrom(c) && local && local.permissions && local.permissions.defaultMode === 'acceptEdits') modeAt.push({ key: 'permissions',
        what: 'Optional. ' + LOCAL_SETTINGS + ' sets "defaultMode": "acceptEdits" under "permissions", which auto-accepts every file edit without a prompt.',
        fix: 'a question for the user, never an auto-fix: ask whether auto-accepting file edits is wanted; remove the key only on their answer' });
      if (modeAt.length) {
        const lineOf = defaultModeLines(fs.readFileSync(P(LOCAL_SETTINGS), 'utf8'));
        for (const { key: where, what, fix } of modeAt) {
          const at = lineOf[where];
          emit({ id: c.id, key: claim(c.id + ':' + LOCAL_SETTINGS + ':default-mode-' + where).key, severity: 'suggest', convention: c.title, file: Object.assign({ relPath: LOCAL_SETTINGS }, at ? { line: at } : {}),
            what, fix, since: c.since,
            receipt: { check: defaultModeCheck(where), expect: 'the defaultMode line' + (at ? ' (line ' + at + ')' : '') + ', then "' + (where === 'top' ? 'top level' : 'under permissions') + ': acceptEdits"; the check exits 0 only while the key there still reads acceptEdits' } });
        }
      }
      // (d) Rows of the project's own a migration removed although their script
      //     stayed: 7.0.0 treated every .claude/scripts/ row as dead (7.0.1
      //     dropped one only when its script was gone), so a kept custom script
      //     lost its grant. Only the rows the migration record's
      //     deadPermissions list names are candidates (see lostRowCandidates),
      //     and one is reported only while no permissions list holds it in
      //     either spelling (a row the user moved to deny or ask stays where they
      //     put it) and the offered-rows record does not list it. The rows may
      //     carry this machine's absolute paths, so they appear only inside this
      //     project's own finding, never in a note.
      if (migration) {
        if (retiredKeys === null) notes.push(c.id + ': no retired-permission-rows.txt under the plugin root, rows a migration removed not checked');
        else {
          const lostRows = lostRowCandidates(P, project, migration, retiredKeys).filter(x => !present.has(x.key) && !offered.has(x.key));
          const n = lostRows.length;
          // Where else the rows can still be read: the migration's backup copy of
          // the file, named only for the rows it holds (it may be gone).
          const backupDir = safeRelPath(migration.backupDir);
          const backupKeys = new Set(settingsLists(backupDir ? readJson(P(backupDir + '/' + LOCAL_SETTINGS), null) : null).allow.map(permissionRowKey));
          const inBackup = lostRows.filter(x => backupKeys.has(x.key)).length;
          const them = (k) => (k === 1 ? 'it' : 'them');
          const source = 'the migration record ' + MIGRATION_REL + ' lists ' + them(n)
            + (inBackup === 0 ? '' : ', and the migration\'s backup copy of ' + LOCAL_SETTINGS + ' still has ' + (inBackup === n ? them(n) : inBackup + ' of them'));
          if (n) emit({ id: c.id, key: claim(c.id + ':' + LOCAL_SETTINGS + ':lost-rows').key, severity: 'warn', convention: c.title, file: { relPath: LOCAL_SETTINGS },
            what: 'Should fix. ' + LOCAL_SETTINGS + ' lost ' + (n === 1 ? 'a permission row' : n + ' permission rows') + ' of the project\'s own: ' + migrationName() + ' removed '
              + (n === 1 ? 'it although the script it runs is' : 'them although the script each one runs is') + ' still in the project, so running ' + (n === 1 ? 'that script asks' : 'those scripts ask') + ' for permission again.',
            fix: 'add each listed row back to "permissions.allow" in ' + LOCAL_SETTINGS + ', exactly as listed (' + source + '); leave every other row as it is', since: c.since,
            fields: [{ label: 'Lost rows', value: lostRows.map(x => x.row).join(' ; ') }],
            receipt: { check: absentRowsCheck('restorable', lostRows.map(x => [x.row, x.rel])),
              expect: n + ' line(s) reading restorable: <row>, one per lost row whose script file exists and which no permissions list holds in either spelling' } });
        }
      }
    } else if (c.detector === 'seed-lines') {
      let keeps = null;
      const keepsScripts = () => (keeps === null ? (keeps = hasFilesUnder(P('.claude/scripts'))) : keeps);
      // (#179) The .claude/ paths of toolkit files a line may name: every one the
      // plugin's managed-paths.json lists (what the copy-installers placed in a
      // project) and every one the migration record's `removed` names. A line
      // naming one the project does not have points at nothing under the plugin.
      const managed = readJson(path.join(pluginRoot, MANAGED_PATHS), null);
      if (managed === null) notes.push(c.id + ': no ' + MANAGED_PATHS + ' under the plugin root, so only the migration record names removed toolkit paths');
      const toolkitPaths = new Set([...(managed && Array.isArray(managed.paths) ? managed.paths : []), ...(migration && Array.isArray(migration.removed) ? migration.removed : [])]
        .map(safeRelPath).filter(p => p !== null && p.startsWith('.claude/')));
      for (const sf of STALE_SEED_FILES) {
        const lines = readLines(P(sf.rel));
        if (lines === null) continue;
        const seedLines = readLines(path.join(pluginRoot, 'seed', sf.seed));
        const harmful = sf.harmful ? sf.harmful(lines) : new Map();
        const lastFileLevel = [...harmful].filter(([, level]) => level === 'file').map(([i]) => i).pop();
        const NEGATION = '!' + STATE_REL;
        // Why each line is stale, worked out for every line first, so the comment
        // lines above one stop at a line that has a finding of its own.
        const why = lines.map((line) => {
          if (line.trim() === '') return null;
          const named = claudePathTokens(line).filter(t => toolkitPaths.has(t));
          const absent = named.filter(t => !exists(t));
          const fragment = sf.fragment(line);
          const scripts = !!sf.scripts && sf.scripts(line);
          return fragment || (scripts && !keepsScripts()) || absent.length ? { named, absent, fragment, scripts } : null;
        });
        lines.forEach((line, i) => {
          if (line.trim() === '' || !(why[i] || harmful.has(i))) return;
          if (harmful.has(i)) {
            // A line that ignores the state file may be the user's own broad
            // pattern (.claude/, *.json), so it is never deleted: deleting it
            // would un-ignore everything else it covers. A pattern that
            // matches the file is kept with a negation after it; one that
            // matches the .claude folder cannot be negated (git never
            // re-includes a file inside an ignored folder), so it is a question.
            const dir = harmful.get(i) === 'dir';
            const { key, n } = claim(c.id + ':' + sf.rel + ':state-file:' + digest(line));
            emit({ id: c.id, key, severity: 'warn', convention: c.title, file: { relPath: sf.rel, line: i + 1 },
              what: 'Should fix. ' + sf.rel + ' line ' + (i + 1) + ' ignores ' + (dir ? 'the whole .claude folder, and with it ' : '') + STATE_REL + ', the state file the version guard and /tk:upgrade read, so it never reaches collaborators.',
              fix: dir
                ? 'a question for the user, never an auto-fix: git cannot re-include a file inside an ignored folder, so ask how they want the line narrowed (for `.claude/`, `.claude/*` keeps everything inside ignored) with `' + NEGATION + '` on a line after it; never delete the line'
                : 'keep the line and add `' + NEGATION + '` on a line after ' + (i === lastFileLevel ? 'it' : 'line ' + (lastFileLevel + 1) + ', the last line that ignores the state file') + ', which re-includes only the state file; never delete the line, which would un-ignore everything else it covers',
              since: c.since, fields: [{ label: 'Negation line', value: NEGATION }],
              // The fix keeps the line, so the line alone proves nothing after
              // it (issue #179): the receipt also judges the whole .gitignore.
              receipt: { check: stateFileCheck(sf.rel, line, n), expect: 'line ' + (i + 1) + ' matches: ' + line.trim().slice(0, 120) + '; the check exits 0 only while the .gitignore as a whole still ignores ' + STATE_REL } });
            return;
          }
          const w = why[i];
          // The comment lines directly above a stale .gitignore line belong to it
          // (issue #179): the v6.3.3 seed's correction-ledger comment named
          // .claude/scripts/pre-push-check.js on its last line, and flagging that
          // line alone stranded the four above it. The block stops at a blank, a
          // rule, or a line that has its own finding.
          let top = i;
          if (sf.comments) while (top > 0 && lines[top - 1].startsWith('#') && !why[top - 1] && !harmful.has(top - 1)) top--;
          let span = [top, i];
          let replacement = null;
          if (line.startsWith('#') && top < i) {
            // A comment block becomes the seed's comment lines above the rule
            // that follows it, or goes when the seed has none there.
            const below = lines[i + 1];
            if (below !== undefined && below.trim() !== '' && !below.startsWith('#')) replacement = seedCommentsAbove(below, seedLines);
          } else {
            const one = seedReplacement(line, seedLines);
            // A replaced line keeps the comment lines above it, which still
            // describe what replaces it.
            if (one !== null) { replacement = [one]; span = [i, i]; }
          }
          // The receipt: the line is still there, and one reason for the finding
          // still holds. A copy-install fragment is a reason for as long as the
          // line is there; a named toolkit path is one while any it names is
          // still missing; the .gitattributes scripts rule while the folder
          // still holds no files (hasFilesUnder: node_modules left out).
          const { key, n } = claim(c.id + ':' + sf.rel + ':line:' + digest(line));
          const reasons = w.fragment ? [] : w.named.map(t => 'test ! -e ' + shq(t))
            .concat(w.scripts ? ['! find -L .claude/scripts -type f ! -name node_modules ! -path ' + shq('*/node_modules/*') + ' 2>/dev/null | grep -q .'] : []);
          const range = span[0] === span[1] ? 'the line' : 'lines ' + (span[0] + 1) + ' to ' + (span[1] + 1);
          const plural = replacement !== null && replacement.length > 1;
          emit({ id: c.id, key, severity: 'suggest', convention: c.title, file: { relPath: sf.rel, line: i + 1 },
            what: 'Optional. ' + sf.rel + ' line ' + (i + 1) + (w.absent.length
              ? ' names ' + w.absent.join(' and ') + ', ' + (w.absent.length === 1 ? 'a toolkit file' : 'toolkit files') + ' this project does not have (the plugin keeps its own files outside the project), so the line points at nothing.'
              : ' is a line an older toolkit seed wrote that names the copy-install layout.')
              + (span[0] < i ? ' ' + (i - span[0] === 1 ? 'Line ' + (span[0] + 1) + ' directly above it is a comment line' : 'Lines ' + (span[0] + 1) + ' to ' + i + ' directly above it are comment lines') + ' that belong to it.' : ''),
            fix: replacement !== null
              ? 'replace ' + range + ' with the shipped seed\'s line' + (plural ? 's' : '') + ' (Seed line' + (plural ? 's below, in order' : ' below') + ')'
              : 'delete ' + range + ': the shipped seed has no line in ' + (span[0] === span[1] ? 'its' : 'their') + ' place',
            since: c.since,
            fields: replacement !== null ? [{ label: plural ? 'Seed lines' : 'Seed line', value: replacement.map(s => s.trim()).join(' ; ') }] : undefined,
            receipt: { check: lineCheck(sf.rel, line, n) + (reasons.length ? ' && { ' + reasons.join(' || ') + ' ; }' : ''),
              expect: 'line ' + (i + 1) + ' matches: ' + line.trim().slice(0, 120) + (reasons.length ? '; the check exits 0 only while ' + [w.named.length ? 'a toolkit path it names is still missing' : null, w.scripts ? '.claude/scripts/ still holds no files' : null].filter(Boolean).join(' or ') : '') } });
        });
      }
      // Lines of the project's own a 7.0.x migration dropped from a file it
      // replaced (a Git LFS rule in .gitattributes, say), still in the backup.
      // The receipt prints one `lost:` line per listed line that the backup
      // copy has and the live file lacks, both read as lineKey reads them (CR
      // dropped, a leading byte order mark dropped, blanks collapsed); a
      // missing live file lacks every line. stderr is redirected before the
      // input, so a missing file prints no shell error. It exits 0 only while it
      // printed a line (issue #179: a loop's own status was 0 with every line
      // back).
      for (const { rel, backup, lost } of lostProjectLines(P, migration, pluginRoot)) {
        const n = lost.length;
        const norm = (file) => "tr -d '\\r' 2>/dev/null < " + shq(file) + " | awk -v b=\"$b\" 'index($0, b) == 1 { $0 = substr($0, length(b) + 1) } { $1 = $1; print }' | grep -q -x -F -e \"$l\"";
        emit({ id: c.id, key: claim(c.id + ':' + rel + ':lost-lines').key, severity: 'warn', convention: c.title, file: { relPath: rel },
          what: 'Should fix. ' + rel + ' lost ' + (n === 1 ? 'a line' : n + ' lines') + ' of the project\'s own: ' + migrationName() + ' replaced the file with the toolkit seed and dropped '
            + (n === 1 ? 'it' : 'them') + '; the backup copy ' + backup + ' still has ' + (n === 1 ? 'it' : 'them') + '.',
          fix: 'append the listed line' + (n === 1 ? '' : 's') + ' back to ' + rel + ', exactly as listed; keep every line the file has now', since: c.since,
          fields: [{ label: 'Lost lines', value: lost.join(' ; ') }, { label: 'Backup copy', value: backup }],
          receipt: { check: "b=$(printf '\\357\\273\\277'); s=1; for l in " + lost.map(shq).join(' ') + '; do if ' + norm(backup) + ' && ! { ' + norm(rel) + '; }; then printf \'lost: %s\\n\' "$l"; s=0; fi; done; test "$s" -eq 0',
            expect: n + ' line(s) reading lost: <line>, one per listed line the backup copy has and ' + rel + ' lacks; the check exits 0 only while one is still lacking' } });
      }
      // A migration record git still tracks. A 7.0.x migration wrote the record
      // and projects committed it; 7.0.0 and 7.0.1 records list the permission
      // rows the migration removed, some with this machine's absolute paths, so
      // every later commit of the file carries them. 7.1.0's seed gitignores the
      // record, but ignoring a file never untracks one git already has. Git
      // itself decides (not a git repository, or no git at all: git() returns
      // null and nothing is reported), and the finding names only counts from
      // the record, never a row. The lost-row and lost-line checks read the
      // record from disk, so untracking it changes neither.
      const tracked = git(['ls-files', '--error-unmatch', '--', MIGRATION_REL], project);
      if (tracked !== null && tracked.split(/\r?\n/).includes(MIGRATION_REL)) {
        const rows = migration && Array.isArray(migration.deadPermissions) ? migration.deadPermissions.filter(p => typeof p === 'string') : null;
        const absolute = rows ? rows.filter(p => ABSOLUTE_IN_ROW.test(p)).length : 0;
        // Split the way the other C-10 findings split: a copy that spreads this
        // machine's paths through every commit does harm (warn); a copy in the
        // count format, or with no absolute path, is only clutter (suggest).
        const warn = absolute > 0;
        // Only a .gitignore reaches collaborators: .git/info/exclude and a
        // global excludes file (core.excludesFile) stay on this machine. Whether
        // a .gitignore ignores the record is git's answer from the .gitignore
        // files alone (issue #183): `ls-files -c -i --exclude-per-directory`
        // reads each folder's .gitignore, nested files, folder patterns and
        // negations included, and no other source. check-ignore -v, which also
        // judges a tracked file, only names the line: it reads every source, and
        // once this machine's own settings ignore the .claude folder it names
        // those instead of the project's line. Its verbose output is
        // `source:line:pattern<TAB>path`, the source relative to the top level
        // (an absolute or ../ path for a file outside the work tree), and it
        // also prints a winning `!` negation, which does not ignore the file.
        const why = git(['check-ignore', '-v', '--no-index', '--', MIGRATION_REL], project);
        const m = why === null ? null : /^(.*?):(\d+):(.*)\t/.exec(why.split(/\r?\n/)[0]);
        const listed = git(['ls-files', '-c', '-i', '--exclude-per-directory=.gitignore', '--', MIGRATION_REL], project);
        const inGitignore = listed !== null && listed.split(/\r?\n/).includes(MIGRATION_REL);
        const full = (git(['rev-parse', '--show-prefix'], project) || '') + MIGRATION_REL;
        const byGitignore = inGitignore && !!m && !m[3].startsWith('!') && (m[1] === '.gitignore'
          || (m[1].endsWith('/.gitignore') && full.startsWith(m[1].slice(0, -'.gitignore'.length))));
        const ignoredElsewhere = !inGitignore && !!m && !m[3].startsWith('!');
        // (A source git quotes, for unusual characters, never matches: the fix
        // then says a .gitignore ignores the file without naming its line.)
        const holds = rows === null
          ? (migration ? ' This copy holds no permission rows.' : '')
          : ' This copy lists ' + (rows.length === 1 ? '1 permission row' : rows.length + ' permission rows') + ', '
            + (absolute === 0 ? 'none with an absolute path' : absolute + (rows.length === 1 ? '' : ' of them') + ' with an absolute path on this machine') + '.';
        emit({ id: c.id, key: claim(c.id + ':' + MIGRATION_REL + ':tracked').key, severity: warn ? 'warn' : 'suggest', convention: c.title, file: { relPath: MIGRATION_REL },
          what: (warn ? 'Should fix. ' : 'Optional. ') + 'The migration record ' + MIGRATION_REL + ' is committed to git. It only matters on this machine (it pairs with the migration\'s backup folder, which git ignores), and older versions of it list this machine\'s permission rows, which every commit of the file would share.' + holds,
          fix: 'stop tracking the record and keep the file: run `git rm --cached ' + MIGRATION_REL + '` from the project root (the file stays on disk); '
            + (byGitignore
              ? m[1] + ' line ' + m[2] + ' already ignores the file, so it stays out of later commits'
              : inGitignore
                ? 'a .gitignore of the project already ignores the file, so it stays out of later commits'
                : 'add the seed\'s line `' + MIGRATION_REL + '` to .gitignore (re-running /tk:setup merges it) so it stays out of later commits'
                  + (ignoredElsewhere ? ' for every collaborator (git ignores it here only through this machine\'s own settings, .git/info/exclude or a global excludes file, which collaborators never get)' : ''))
            + '. Earlier commits keep their copy of the file; rewriting git history to remove it is a separate step the owner decides, never part of this fix.',
          since: c.since, fields: [{ label: 'Command', value: 'git rm --cached ' + MIGRATION_REL }],
          receipt: { check: 'git ls-files --error-unmatch -- ' + shq(MIGRATION_REL), expect: 'one line, ' + MIGRATION_REL + ', which git prints only because it tracks the file' } });
      }
    } else if (c.detector === 'unscoped-names') {
      const owned = new Set(piecesUnder(P('.claude')));
      const names = piecesUnder(pluginRoot).filter(n => !owned.has(n));
      if (!names.length) { notes.push(c.id + ': no command, skill or agent names under the plugin root'); continue; }
      const matchers = unscopedMatchers(names);
      for (const rel of scopeFiles[c.scope] || scopeFiles['prompt-files+claude-md']) {
        // A file a session reads carries its own severity (SESSION_READ_FILES);
        // every prompt file is warn.
        const severity = sessionSeverity.get(rel) || 'warn';
        const lines = fs.readFileSync(P(rel), 'utf8').split(/\r?\n/);
        // A lessons file records past work, so it is history as a whole (issue #187).
        if (HISTORY_FILES.has(rel)) continue;
        lines.forEach((line, i) => {
          if (HISTORY_LINE.test(line)) return;
          const tokens = unscopedTokens(line, matchers);
          if (!tokens.length) return;
          const { key, n } = claim(c.id + ':' + rel + ':' + digest(line));
          emit({ id: c.id, key, severity, convention: c.title, file: { relPath: rel, line: i + 1 },
            what: (severity === 'warn' ? 'Should fix. ' : 'Optional. ') + rel + ' line ' + (i + 1) + ' names a toolkit piece without the tk: scope (' + tokens.map(t => t.show).join(', ') + '), which does not resolve under the plugin.',
            fix: c.fix || 'scope the name with tk:', since: c.since,
            // The line itself (issue #179): a whole-file grep for the name also
            // matched docs/review.md on another line and outlived the fix.
            receipt: { check: lineCheck(rel, line, n), expect: 'line ' + (i + 1) + ' matches: ' + line.trim().slice(0, 120) } });
        });
      }
      // Bare Skill rows in the permissions list never match a tk: skill. A row
      // the retired list names is left to the permission-rows convention, whose
      // fix removes it.
      const nameSet = new Set(names);
      const bare = localAllow.filter(p => { const m = /^Skill\(([a-z0-9-]+)(:\*)?\)$/.exec(p); return m !== null && nameSet.has(m[1]) && !(retiredKeys && retiredKeys.has(permissionRowKey(p))); });
      if (bare.length) emit({ id: c.id, key: claim(c.id + ':' + LOCAL_SETTINGS + ':bare-skill-rows').key, severity: 'warn', convention: c.title, file: { relPath: LOCAL_SETTINGS },
        what: 'Should fix. ' + LOCAL_SETTINGS + ' carries ' + bare.length + ' Skill permission row' + (bare.length === 1 ? '' : 's') + ' without the tk: scope, which never match a plugin skill.',
        fix: 'scope each row with tk: (Skill(tk:<name>)), or drop it when the tk: row is already in the list', since: c.since,
        fields: [{ label: 'Rows', value: bare.join(' ; ') }],
        receipt: { check: allowRowsCheck('unscoped', bare.map(p => [p, ''])), expect: bare.length + ' line(s) reading unscoped: <row>, one per listed row still in "permissions.allow"' } });
    } else if (c.detector === 'agent-tools') {
      for (const rel of promptFiles.filter(r => r.startsWith('.claude/agents/'))) {
        const { name, description, toolsIdx, edits } = agentFrontmatter(fs.readFileSync(P(rel), 'utf8'));
        if (!JUDGE_ROLE.test((name || path.basename(rel, '.md')) + ' ' + description)) continue;
        if (toolsIdx >= 0 && !edits.length) continue;
        // The receipt reads the frontmatter as the detector does (issue #179): a
        // grep for any tools: line kept matching `tools: Read, Grep` after the
        // fix, and a list item anywhere in the body counted as a tool.
        emit({ id: c.id, key: claim(c.id + ':' + rel + ':edit-access').key, severity: 'warn', convention: c.title, file: { relPath: rel, line: toolsIdx >= 0 ? toolsIdx + 2 : 1 },
          what: 'Should fix. ' + rel + (toolsIdx >= 0 ? ' grants ' + edits.join(', ') + ' to a finder or judge role, so it can change files before any audit judges its output.' : ' declares no tools list, so its finder or judge role gets every tool, Edit included.'),
          fix: c.fix || 'declare tools: Read, Grep, Glob (Bash only for read-only checks); a finder or judge never edits', since: c.since,
          receipt: toolsIdx >= 0
            ? { check: 'awk ' + shq(TOOLS_EDIT_AWK) + ' < ' + shq(rel), expect: 'the frontmatter tools line and its list items, then an edit tool line naming Edit, Write or NotebookEdit; the check exits 0 only while an edit tool is in the list' }
            : { check: 'awk ' + shq(TOOLS_NONE_AWK) + ' < ' + shq(rel), expect: 'the frontmatter lines, none of them a tools: line; the check exits 0 only while the frontmatter has no tools line' } });
      }
    } else if (c.detector === 'review-kinds') {
      // Absent means the project adds no review kind: nothing to check.
      if (isFile(P(REVIEW_KINDS))) {
        const lines = fs.readFileSync(P(REVIEW_KINDS), 'utf8').split(/\r?\n/);
        const isRow = (l) => /^[ \t]*\|/.test(l);
        const isRule = (l) => isRow(l) && tableCells(l).every(x => /^:?-+:?$/.test(x));
        const agents = promptFiles.filter(r => r.startsWith('.claude/agents/')).map(rel => ({ rel, fm: agentFrontmatter(fs.readFileSync(P(rel), 'utf8')) }));
        lines.forEach((line, i) => {
          // The header is the row right above the rule line; both are skipped.
          if (!isRow(line) || isRule(line) || (i + 1 < lines.length && isRule(lines[i + 1]))) return;
          const at = { relPath: REVIEW_KINDS, line: i + 1 };
          const row = (slug, what, check, expect) => {
            const { key, n } = claim(c.id + ':' + REVIEW_KINDS + ':' + slug + ':' + digest(line));
            emit({ id: c.id, key, severity: 'warn', convention: c.title, file: at, what: 'Should fix. ' + REVIEW_KINDS + ' line ' + (i + 1) + ' ' + what,
              fix: c.fix || 'add the agent under .claude/agents/ with an output contract and no edit tools, fix the row\'s three cells, or remove the row', since: c.since,
              receipt: { check: lineCheck(REVIEW_KINDS, line, n) + (check ? ' && ' + check : ''), expect: 'line ' + (i + 1) + ' as written: ' + line.trim().slice(0, 120) + (expect ? '; ' + expect : '') } });
          };
          const cells = tableCells(line);
          if (cells.length !== 3) return row('cells', 'has ' + cells.length + ' cell(s), not the three /tk:review reads (What changed, Specialist, Finder agent), so the kind is never dispatched.');
          const m = /subagent_type\s*[=:]\s*["'`]?([A-Za-z0-9:_-]+)/.exec(cells[2]);
          if (!m) return row('agent-cell', 'names no agent in its third cell (expected `subagent_type=<name>`), so the kind is never dispatched.');
          const name = m[1];
          if (/:/.test(name)) return row('scoped', 'names `' + name + '`, a plugin agent: a project review kind names an agent of the project\'s own under .claude/agents/, and the toolkit\'s kinds are already in the table.');
          // The name a file declares wins; its file name counts only when it
          // declares none, which is how C-5 names an agent too.
          const hit = agents.find(a => (a.fm.name || path.basename(a.rel, '.md')) === name);
          if (!hit) return row('missing', 'names the agent `' + name + '`, which no file under .claude/agents/ defines, so /tk:review skips the kind.',
            '{ test ! -d .claude/agents || W=' + shq(name) + ' find .claude/agents -type f -name ' + shq('*.md') + ' -exec awk ' + shq(AGENT_NAMED_AWK) + ' {} + ; }',
            'the check exits 0 only while no agent file declares name: ' + name + ' in its frontmatter, or is named ' + name + '.md while declaring no name');
          // An agent C-5 covers by its role is left to C-5, but only in a run
          // where C-5 is in range: C-5 ranges from 7.0.0, so on a later upgrade
          // nothing else would report an agent added since.
          if (inRange.some(x => x.detector === 'agent-tools') && JUDGE_ROLE.test((hit.fm.name || path.basename(hit.rel, '.md')) + ' ' + hit.fm.description)) return;
          if (hit.fm.toolsIdx >= 0 && !hit.fm.edits.length) return;
          row('edit-access', 'dispatches `' + name + '` (' + hit.rel + ') as a finder, and that agent ' + (hit.fm.toolsIdx >= 0 ? 'is granted ' + hit.fm.edits.join(', ') : 'declares no tools list, so it gets every tool, Edit included') + ': it can change files before the audit judges its findings. Its output contract is C-4\'s to judge.',
            'awk ' + shq(hit.fm.toolsIdx >= 0 ? TOOLS_EDIT_AWK : TOOLS_NONE_AWK) + ' < ' + shq(hit.rel),
            hit.fm.toolsIdx >= 0 ? 'then the agent\'s tools line with an edit tool in it; the check exits 0 only while one is there' : 'then the agent\'s frontmatter with no tools: line; the check exits 0 only while it has none');
        });
      }
    } else if (c.detector === 'agent-models') {
      const agents = promptFiles.filter(r => r.startsWith('.claude/agents/')).map(rel => ({ rel, fm: agentFrontmatter(fs.readFileSync(P(rel), 'utf8')) }));
      // The name an agent answers to: the one it declares, else its file name,
      // which is how C-12 finds the agent a review kind names.
      const answersTo = (a) => a.fm.name || path.basename(a.rel, '.md');
      const kinds = reviewKindNames(P);
      // An agent with no model follows CLAUDE_CODE_SUBAGENT_MODEL. Reported once
      // per file, when its role or a review kind says it judges work; a model
      // line with any value is the project's choice.
      for (const a of agents) {
        if (a.fm.model) continue;
        const role = JUDGE_ROLE.test(answersTo(a) + ' ' + a.fm.description);
        if (!role && !kinds.has(answersTo(a))) continue;
        emit({ id: c.id, key: claim(c.id + ':' + a.rel + ':no-model').key, severity: 'warn', convention: c.title, file: { relPath: a.rel, line: 1 },
          what: 'Should fix. ' + a.rel + ' declares no model, so ' + (role ? 'this finder or judge role' : 'the agent a review kind in ' + REVIEW_KINDS + ' names') + ' follows CLAUDE_CODE_SUBAGENT_MODEL whenever a user sets it, which can move it below the session model whose work it judges.',
          fix: 'add model: inherit to its frontmatter to keep it on the session model, or name the model you want', since: c.since,
          receipt: { check: 'awk ' + shq(MODEL_NONE_AWK) + ' < ' + shq(a.rel), expect: 'the frontmatter lines, none of them a model: line with a value; the check exits 0 only while the frontmatter declares no model' } });
      }
      // Dispatch lines. A bare name an agent of the project's own answers to is
      // that agent, never the toolkit's, so it is left alone.
      const owned = new Set(agents.map(answersTo));
      for (const rel of promptFiles) {
        const lines = fs.readFileSync(P(rel), 'utf8').split(/\r?\n/);
        lines.forEach((line, i) => {
          if (/^\s*\|/.test(line)) return; // a table row names agents; it dispatches none
          const seen = new Set();
          for (const m of line.matchAll(C14_TARGET)) {
            const name = m[2];
            if ((!m[1] && owned.has(name)) || seen.has(name)) continue;
            seen.add(name);
            const judge = C14_JUDGES.includes(name);
            const [from, to] = c14Block(lines, i);
            if (c14Names(lines, i, from, to, judge) !== judge) continue;
            // The receipt finds its line by text and by which line of that text
            // it is, counted from the top, so of two identical lines it reads
            // its own even when only one of them is a finding.
            const occurrence = lines.slice(0, i + 1).filter(l => l === line).length;
            emit({ id: c.id, key: claim(c.id + ':' + rel + ':' + (judge ? 'judge-call' : 'finder-call') + ':' + name + ':' + digest(line)).key, severity: 'warn', convention: c.title, file: { relPath: rel, line: i + 1 },
              what: judge
                ? 'Should fix. ' + rel + ' line ' + (i + 1) + ' names a model for ' + name + ', a toolkit judge: a model named in a call overrides the judge\'s model: inherit, which can move it below the work it judges.'
                : 'Should fix. ' + rel + ' line ' + (i + 1) + ' dispatches ' + name + ' with no model, so it runs on that agent file\'s model from any session, and from a session below that model it works above the judges that audit it.',
              fix: judge
                ? 'take the model off the call; the judge stays on the session model through its own model: inherit'
                : 'pass model set to its models.perRole value from node ~/.claude/plugins/data/tk-llm-peer-review/current/scripts/session-init.js --models, where session, or a model above your own, means your own model family\'s alias',
              since: c.since,
              receipt: { check: c14CallCheck(rel, line, occurrence, judge), expect: 'the dispatch\'s block, one numbered line each; the check exits 0 only while the block ' + (judge ? 'names a model for the judge' : 'names no model for the finder') } });
          }
        });
      }
    } else if (c.detector === 'seed-blocks') {
      // (C-15) The seeded files of the project's own, block by block, against
      // the plugin's current seed and the history of what older seeds shipped.
      const historyText = readText(path.join(pluginRoot, 'seed', HISTORY_FILE));
      const history = historyText === null ? null : parseHistory(historyText);
      if (history === null) notes.push(c.id + ': no seed/' + HISTORY_FILE + ' under the plugin root, so older seed text is not recognised');
      const waits = 'a file of the project\'s own, so the edit waits for the batch page\'s approval';
      for (const sf of SEED_FILES) {
        // Read as scripts/seed-history.js hashed the history: the byte order
        // mark, a CR and trailing blanks dropped, or a file saved with any of
        // them would never match an older seed (review fix R10).
        const text = history === null ? null : readText(P(sf.rel));
        const lines = text === null ? null : normalizeLines(text);
        if (lines === null) continue;
        const seedText = readText(path.join(pluginRoot, 'seed', sf.seed));
        const seedLines = seedText === null ? null : normalizeLines(seedText);
        if (seedLines === null) { notes.push(c.id + ': no seed/' + sf.seed + ' under the plugin root'); continue; }
        const older = history.get(sf.rel);
        if (!older) continue;
        const seedPath = path.join(pluginRoot, 'seed', sf.seed);
        const current = blocksOf(sf.kind, seedLines);
        const currentHashes = new Set(current.map(b => hashLines(b.lines)));
        // The whole file first: one that is an older seed's line for line is
        // one finding, not one per block.
        const whole = fileHash(lines);
        const wholeHit = older.get(whole);
        if (wholeHit && wholeHit.kind === 'file' && whole !== fileHash(seedLines)) {
          emit({ id: c.id, key: claim(c.id + ':' + sf.rel + ':file').key, severity: 'suggest', convention: c.title, file: { relPath: sf.rel, line: 1 },
            what: 'Optional. ' + sf.rel + ' is, line for line, the file the ' + wholeHit.release + ' seed wrote, and the current seed\'s text differs.',
            fix: 'replace the file with the current seed, ' + seedPath + ', or keep it as it is: nothing in it is yours yet; ' + waits, since: c.since,
            fields: [{ label: 'Seed file', value: seedPath }],
            receipt: { check: blockCheck(sf.rel, 0, 0, whole), expect: 'the file\'s lines, numbered, then "hash ' + whole + '", the hash of the file as the ' + wholeHit.release + ' seed wrote it; the check exits 0 only while the hash still matches' } });
          continue;
        }
        for (const b of blocksOf(sf.kind, lines)) {
          const h = hashLines(b.lines);
          const hit = older.get(h);
          if (!hit || hit.kind !== 'block' || currentHashes.has(h)) continue;
          // The current seed's nearest block is the replacement; with none
          // near, the seed file itself is named.
          let near = null;
          let score = 0;
          for (const cb of current) { const s = similarity(b.lines, cb.lines); if (s > score) { score = s; near = cb; } }
          if (score < NEAR_BLOCK) near = null;
          const lineRange = (x) => (x.start === x.end ? 'line ' + x.start : 'lines ' + x.start + ' to ' + x.end);
          const range = lineRange(b);
          emit({ id: c.id, key: claim(c.id + ':' + sf.rel + ':block:' + h).key, severity: 'suggest', convention: c.title, file: { relPath: sf.rel, line: b.start },
            what: 'Optional. ' + sf.rel + ' ' + range + ' ' + (b.start === b.end ? 'is' : 'are') + ' a block the ' + hit.release + ' seed wrote (' + KIND_WORD[sf.kind] + '), and the current seed\'s text there differs.',
            fix: near
              ? 'replace ' + range + ' with ' + lineRange(near) + ' of the current seed, ' + seedPath + ' (Seed block below), or keep yours; ' + waits
              : 'the current seed has no block near this one: read ' + seedPath + ' and take the text that fits, or keep yours; ' + waits,
            since: c.since,
            fields: near
              ? [{ label: 'Seed file', value: seedPath + ' ' + lineRange(near) }, { label: 'Seed block', value: near.lines.map(s => s.trim()).join(' ; ') }]
              : [{ label: 'Seed file', value: seedPath }],
            receipt: { check: blockCheck(sf.rel, b.start, b.end, h), expect: range + ', numbered, then "hash ' + h + '", the hash of the block as the ' + hit.release + ' seed wrote it; the check exits 0 only while the hash still matches' } });
        }
      }
      // ${CLAUDE_PLUGIN_ROOT} outside the plugin: Claude Code expands it only in
      // the plugin's own files, so in a file of the project's it names nothing.
      // Every file a session reads at its severity, the detail and artifacts
      // files beside them, and the project's prompt files at warn.
      const seen = new Set();
      const rootFiles = SESSION_READ_FILES.concat([['LESSONS-detail.md', 'suggest'], ['artifacts/README.md', 'suggest']], promptFiles.map(r => [r, 'warn']));
      for (const [rel, severity] of rootFiles) {
        if (seen.has(rel) || !isFile(P(rel))) continue;
        seen.add(rel);
        const prompt = promptFiles.includes(rel);
        fs.readFileSync(P(rel), 'utf8').split(/\r?\n/).forEach((line, i) => {
          if (!line.includes(PLUGIN_ROOT_VAR)) return;
          const { key, n } = claim(c.id + ':' + rel + ':plugin-root:' + digest(line));
          emit({ id: c.id, key, severity, convention: c.title, file: { relPath: rel, line: i + 1 },
            what: (severity === 'warn' ? 'Should fix. ' : 'Optional. ') + rel + ' line ' + (i + 1) + ' names ' + PLUGIN_ROOT_VAR + ', which Claude Code expands only inside the plugin\'s own files, so from this file it points at nothing.',
            fix: 'replace ' + PLUGIN_ROOT_VAR + ' with the stable path ' + STABLE_PLUGIN_PATH + (prompt ? '' : '; ' + waits), since: c.since,
            receipt: { check: lineCheck(rel, line, n), expect: 'line ' + (i + 1) + ' matches: ' + line.trim().slice(0, 120) } });
        });
      }
    } else if (c.detector === 'lessons-shape') {
      // (C-16) The lessons index: one-liners, and none of the toolkit's own.
      const lines = readLines(P('LESSONS.md'));
      if (lines !== null) {
        const bullets = lessonBullets(lines);
        const waits = 'files of the project\'s own, so the edit waits for the batch page\'s approval';
        // Write-ups in the index, while there is no detail file to hold them.
        const long = isFile(P('LESSONS-detail.md')) ? [] : bullets.filter(b => isLongBullet(b.text));
        if (long.length) {
          const n = long.length;
          emit({ id: c.id, key: claim(c.id + ':LESSONS.md:long-bullets').key, severity: 'warn', convention: c.title, file: { relPath: 'LESSONS.md', line: long[0].start },
            what: 'Should fix. LESSONS.md holds ' + (n === 1 ? 'a bullet' : n + ' bullets') + ' beyond one sentence or over ' + LONG_BULLET_CHARS + ' characters while LESSONS-detail.md is absent, so every session reads the write-ups instead of a one-line index.',
            fix: 'create LESSONS-detail.md from the plugin seed (' + path.join(pluginRoot, 'seed', 'LESSONS-detail.md') + ') and move each listed bullet\'s write-up there under the same bold lead, leaving one bold line in the index; ' + waits, since: c.since,
            fields: [{ label: 'Lines', value: long.map(b => String(b.start)).join(', ') }],
            receipt: { check: 'test ! -e LESSONS-detail.md && awk ' + shq(LONG_BULLETS_AWK) + ' < LESSONS.md', expect: 'one line per bullet beyond one sentence or over ' + LONG_BULLET_CHARS + ' characters, as <line>: <text>; the check exits 0 only while LESSONS-detail.md is absent and such a bullet remains' } });
        }
        // The toolkit's own lessons, carried in by a copy-install.
        const leadsPath = path.join(pluginRoot, 'seed', LEADS_FILE);
        const leadLines = readLines(leadsPath);
        if (leadLines === null) notes.push(c.id + ': no seed/' + LEADS_FILE + ' under the plugin root, so inherited lessons are not checked');
        else {
          const leads = new Set(leadLines.filter(l => l.trim() && !l.startsWith('#')).map(leadKey));
          const inherited = bullets.filter(b => b.lead && leads.has(leadKey(b.lead)));
          if (inherited.length) {
            const n = inherited.length;
            emit({ id: c.id, key: claim(c.id + ':LESSONS.md:inherited').key, severity: 'warn', convention: c.title, file: { relPath: 'LESSONS.md', line: inherited[0].start },
              what: 'Should fix. LESSONS.md carries ' + (n === 1 ? 'a lesson' : n + ' lessons') + ' of the toolkit\'s own: the copy-install\'s installer wrote the toolkit\'s lessons file into projects, so ' + (n === 1 ? 'it describes' : 'these describe') + ' the toolkit\'s history, not this project\'s.',
              fix: 'remove each listed bullet, and its write-up under the same bold lead in LESSONS-detail.md when it is there; keep any you rely on; ' + waits, since: c.since,
              fields: [{ label: 'Lines', value: inherited.map(b => String(b.start)).join(', ') }, { label: 'Leads', value: inherited.slice(0, 12).map(b => b.lead).join(' ; ') + (n > 12 ? ' ; and ' + (n - 12) + ' more' : '') }],
              // The leads as compared: a closing period or colon set aside, case ignored.
              receipt: { check: 'grep -v ' + shq('^#') + ' -- ' + shq(leadsPath) + ' | sed ' + shq('s/[.:!]*$//') + ' | grep -n -i -F -f - -- LESSONS.md', expect: 'each LESSONS.md line that holds a lead from the toolkit\'s own lessons list, numbered; the check exits 0 only while one remains' } });
          }
        }
      }
    } else if (c.detector === 'local-edits') {
      // The evidence of a local edit is the copy-install's own record: the
      // migration file lists the path, and the manifest the old installer wrote
      // (kept in the backup folder) holds the hash it installed, which the
      // backup copy no longer matches. The current plugin copy is never the
      // base: it also carries every toolkit change since that install.
      const mig = migration;
      const from = validVersion(mig && mig.from) || validVersion(state && state.previousVersion);
      const backupDir = mig ? safeRelPath(mig.backupDir) : null;
      const manifestBackup = backupDir ? backupDir + '/' + MANIFEST_REL : null;
      let skipped = 0;
      for (const m of (mig && Array.isArray(mig.modified) ? mig.modified : [])) {
        const rel = m ? safeRelPath(m.rel) : null;
        if (rel === null) { skipped++; continue; }
        const backup = safeRelPath(m.backup);
        const tagged = from ? TOOLKIT_REPO_URL + '/blob/v' + from + '/' + rel : null;
        // The record and the manifest hold the path as it was written, so the
        // greps look for that spelling as it sits in a JSON file (a Windows
        // backslash doubled); the backup file itself is opened by its
        // normalized path, which bash takes on every platform.
        const recorded = JSON.stringify(m.rel).slice(1, -1);
        const checks = ['grep -n -F -e ' + shq(recorded) + ' -- ' + MIGRATION_REL];
        const hashes = backup && manifestBackup && fs.existsSync(P(backup)) && fs.existsSync(P(manifestBackup));
        if (hashes) {
          checks.push('grep -n -F -e ' + shq('"' + recorded + '": "') + ' -- ' + shq(manifestBackup));
          checks.push("tr -d '\\r' < " + shq(backup) + ' | { sha256sum 2>/dev/null || shasum -a 256; }');
        }
        // The convention's fix and the tagged base are two sentences.
        const baseFix = c.fix || 'compare your backup with the toolkit file at the tag it came from, never with the current plugin copy';
        const where = from ? 'the ' + from + ' copy-install' : 'a copy-install';
        // A file C-10 checks for lost lines (REPLACED_ON_MIGRATION, today only
        // .gitattributes) is not a toolkit script: the plugin ships no copy of
        // it (setup records its pluginCopy as null), it belongs to the project,
        // and a 7.0.x migration replaced it with the toolkit seed. "File it
        // upstream or carry it as a project-owned script" is wrong advice there,
        // so its fix says whose file it is and claims only what was checked.
        // With the backup copy, C-10 compared it line by line: the fix names how
        // many lines C-10 lists to put back, or says it found none and what it
        // does not count. Without the backup copy nothing was compared, so the
        // fix says the toolkit cannot tell and asks the user to check. The
        // finding is reworded rather than suppressed in favour of C-10, which
        // lists only lines still missing, so the record's evidence stays in the
        // audit either way. Every other entry (artifacts/README.md, VERSION,
        // anything under .claude/) has no line-level check behind it, so it
        // keeps the convention's advice and its tagged base unchanged.
        const replaced = REPLACED_ON_MIGRATION.find(x => x.rel === rel);
        const replacedCopy = replaced ? replacedBackup(P, migration, rel) : null;
        let ownFix = null;
        if (replaced) {
          const head = rel + ' belongs to the project, not the toolkit, so nothing goes upstream and nothing is carried as a script: the migration replaced it with the toolkit seed';
          const found = replacedCopy ? lostProjectLines(P, migration, pluginRoot).find(x => x.rel === rel) : null;
          const k = found ? found.lost.length : 0;
          ownFix = !replacedCopy
            ? head + ', and its backup copy is gone, so the toolkit cannot tell which lines were the project\'s. Ask the user to check whether a rule of theirs (a Git LFS line, for example) is missing from ' + rel + ', and add back any they name.'
            : k
              ? head + ' and dropped ' + (k === 1 ? 'a line' : k + ' lines') + ' of yours that the backup copy ' + replacedCopy + ' still has. Append back the ' + (k === 1 ? 'line' : k + ' lines') + ' the C-10 finding for ' + rel + ' lists.'
              : head + '. C-10 compared the backup copy ' + replacedCopy + ' with the live file and lists no line to put back: every line of the backup copy is blank, a comment, or already in the live file, the shipped seed, or a copy of the file an earlier toolkit release shipped.';
        }
        emit({ id: c.id, key: claim(c.id + ':' + rel).key, severity: 'warn', convention: c.title, file: { relPath: rel },
          what: 'Should fix. ' + rel + (replaced ? ', a file of the project\'s own, carried a local edit the toolkit seed replaced during the migration from ' : ' carried a local edit the plugin copy replaced during the migration from ') + where + '.',
          fix: replaced ? ownFix : tagged ? baseFix.replace(/[.\s]+$/, '') + '. Base for your backup: ' + tagged : baseFix, since: c.since,
          fields: [{ label: 'Your copy', value: backup || '(no backup recorded)' },
            { label: 'Toolkit copy it came from', value: tagged || '(no usable copy-install version recorded)' }],
          receipt: { check: checks.join(' ; '),
            expect: hashes ? 'the migration record lists the file; the manifest line holds the hash the copy-install wrote, and the hash of your backup copy printed after it differs, which is the local edit'
              : 'the migration record lists the file as locally modified' } });
      }
      if (skipped) notes.push(c.id + ': skipped ' + skipped + ' migration record(s) whose path is not a plain project path');
    }
  }
  // A finding the audit killed on an earlier upgrade stays out while its key,
  // which digests its line, is unchanged; the summary says how many.
  const reported = findings.filter(f => !refutedRecord.keys.has(f.key));
  const suppressed = findings.length - reported.length;
  for (const f of reported) process.stdout.write(JSON.stringify(f) + '\n');
  const start = fromVersion || (unusableRecord ? 'start (the recorded version is unusable)' : 'start');
  for (const n of notes) console.error('upgrade-audit: ' + n);
  console.error('upgrade-audit: ' + reported.length + ' candidate finding(s); ' + inRange.length + ' of ' + all.length + ' convention(s) in range ' + start + ' -> ' + toVersion + (inRange.length ? ' [' + inRange.map(c => c.id).join(', ') + ']' : '') + '; ' + promptFiles.length + ' project-owned prompt file(s); ' + suppressed + ' suppressed by the refuted record');
  // Zero findings over an empty range is the run that reads the same whether
  // the plugin is current or five releases behind: the range is measured
  // against the INSTALLED plugin and never against the latest release (#203).
  // Gate on `fromVersion`, not on `start`, which falls back to a sentence when
  // no usable version was recorded and must never read as equal to toVersion.
  // Compare as versions, not as text, the way every other check in this file
  // does: validVersion accepts `7.1` and a `-rc` suffix, and string equality
  // would call those different from `7.1.0` and so stay silent on exactly the
  // empty range this line exists for. compareVersions returns null when either
  // value is unusable, which is never 0, so it carries the old guard too.
  if (reported.length === 0 && compareVersions(fromVersion, toVersion) === 0) {
    console.error('upgrade-audit: nothing changed here. If you expected it to, the plugin itself may be older than the latest release: ' + PLUGIN_UPDATE_STEPS + '.');
  }
}

// The seeded-block and lessons readers, for scripts/seed-history.js (the
// maintainer script that writes the two history seeds) and its tests, so the
// history is hashed exactly as the audit hashes a project's file. The audit
// itself runs only when this script is invoked.
module.exports = { SEED_FILES, LESSON_SOURCES, HASH_LENGTH, normalizeLines, hashLines, fileHash, blocksOf, similarity, lessonBullets, leadKey, isLongBullet, LONG_BULLET_CHARS, SENTENCE_BREAK, parseHistory };

if (require.main === module) main();
