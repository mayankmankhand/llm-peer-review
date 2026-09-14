#!/usr/bin/env node
'use strict';
// release-check.js - the maintainer-only release gate for the toolkit repo
// (issue #175). Nothing here ships in plugin/.
//
//   node scripts/release-check.js [--repo <dir>] [--suites <list|glob>]
//                                 [--skip-suites]
//
// Why it exists: the toolkit ships as the `tk` plugin, and Claude Code caches a
// plugin by its version. Commits that changed plugin/ without bumping
// plugin/.claude-plugin/plugin.json never reached existing installs, and
// nothing ran the test suites automatically. This script is the one gate the
// pre-push hook (scripts/git-hooks/pre-push) runs before a push to main or a
// release tag. Each check prints one `ok` or `FAIL` line with its reason:
//
//   1. Suites      - every scripts/test-*.js except this script's own test, one
//                    `node <file>` each. ONLY the exit code counts: a past
//                    release misread a failure summary as passes, so no output
//                    is ever parsed. --suites overrides the set (a comma list
//                    of repo-relative paths, each may use * or ? in its file
//                    name); --skip-suites skips the check.
//   2. Build       - `node scripts/build-plugin.js --check` exits 0 (plugin/
//                    matches its source). Skipped with a note when the repo has
//                    no build-plugin.js (the tests' scratch repos).
//   3. Version     - if plugin/ changed since the last v* tag reachable from
//                    HEAD, plugin.json's version at HEAD must differ from the
//                    tag's. No tag at all passes with a note.
//   4. Marketplace - the `tk` entry in .claude-plugin/marketplace.json must be
//                    a git-subdir source on path "plugin" pinned to ref
//                    v<plugin.json version>, so users install the tagged tree.
//
// Checks 3 and 4 read committed state (HEAD); the suites and the build check
// run on the working tree. --repo points every check at another clone (tests).
//
// Dependency-free; git and node run through spawnSync with argument arrays
// (no shell interpolation).
//
// Exit codes: 0 every check passed
//             1 at least one check failed (block the release or push)
//             2 usage error (unknown argument, missing value)

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OWN_TEST = 'scripts/test-release-check.js';
// Git exports GIT_DIR (and, with --git-dir/--work-tree, GIT_WORK_TREE) to a
// hook when the push comes from a linked worktree. Inherited by a suite, it
// would point the suite's scratch `git init` and `git commit` at the real
// repository. So every child runs without git's repo-local variables (the list
// git itself clears when it crosses into another repo) and finds its
// repository from its working directory instead.
const LOCAL_REPO_ENV = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX',
  'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
];
const CHILD_ENV = Object.assign({}, process.env);
for (const k of LOCAL_REPO_ENV) delete CHILD_ENV[k];
// A hung suite must not hang a push forever; 10 minutes is far above any
// suite's real runtime.
const SUITE_TIMEOUT_MS = 10 * 60 * 1000;

function parseArgs(argv) {
  const o = { repo: process.cwd(), suites: null, skipSuites: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) usage('missing value for ' + a);
      return v;
    };
    if (a === '--repo') o.repo = path.resolve(value());
    else if (a === '--suites') o.suites = value();
    else if (a === '--skip-suites') o.skipSuites = true;
    else if (a === '--help' || a === '-h') { console.log('usage: node scripts/release-check.js [--repo <dir>] [--suites <list|glob>] [--skip-suites]'); process.exit(0); }
    else usage('unknown argument ' + a);
  }
  return o;
}

function usage(msg) {
  console.error('release-check: ' + msg);
  console.error('usage: node scripts/release-check.js [--repo <dir>] [--suites <list|glob>] [--skip-suites]');
  process.exit(2);
}

const opts = parseArgs(process.argv.slice(2));
// Always work from the top of the worktree. Run from a subfolder (or with
// --repo naming one), `git diff -- plugin/` would read <subfolder>/plugin/,
// find no change, and pass an unbumped release; the build check would look for
// <subfolder>/scripts/build-plugin.js and skip itself. Outside any git repo the
// given folder is kept and check 3 reports that.
const REPO = (() => {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: opts.repo, env: CHILD_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const top = r.status === 0 ? (r.stdout || '').trim() : '';
  return top ? path.resolve(top) : opts.repo;
})();
const results = [];

function report(name, ok, reason) {
  results.push(ok);
  console.log((ok ? '  ok   ' : '  FAIL ') + name + ' - ' + reason);
}

function git(args) {
  const r = spawnSync('git', args, { cwd: REPO, env: CHILD_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

// A file name pattern with * and ? only, matched against one directory's
// entries. Enough for "stubs/test-*.js"; no ** and no directory wildcards.
function expandSuites(spec) {
  const files = [];
  for (const item of spec.split(',').map(s => s.trim()).filter(Boolean)) {
    if (!/[*?]/.test(path.basename(item))) { files.push(item); continue; }
    const dir = path.dirname(item);
    const re = new RegExp('^' + path.basename(item).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    const abs = path.join(REPO, dir);
    const names = fs.existsSync(abs) ? fs.readdirSync(abs).filter(n => re.test(n)).sort() : [];
    for (const n of names) files.push(dir === '.' ? n : dir + '/' + n);
  }
  return files;
}

function defaultSuites() {
  const dir = path.join(REPO, 'scripts');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(n => /^test-.*\.js$/.test(n)).sort()
    .map(n => 'scripts/' + n).filter(rel => rel !== OWN_TEST);
}

// Print the end of a failing suite's output as context for the human. The
// verdict itself already came from the exit code.
function tail(text, lines) {
  const all = text.replace(/\s+$/, '').split('\n');
  return all.slice(-lines).map(l => '         | ' + l).join('\n');
}

// --- 1. suites -----------------------------------------------------------------
function checkSuites() {
  if (opts.skipSuites) { report('suites', true, 'skipped (--skip-suites)'); return; }
  const suites = opts.suites !== null ? expandSuites(opts.suites) : defaultSuites();
  if (suites.length === 0) { report('suites', false, 'no suites found' + (opts.suites !== null ? ' for --suites ' + opts.suites : ' under scripts/test-*.js')); return; }
  const failed = [];
  for (const rel of suites) {
    const abs = path.resolve(REPO, rel);
    if (!fs.existsSync(abs)) { failed.push(rel); console.log('         ' + rel + ': missing'); continue; }
    const r = spawnSync('node', [abs], {
      cwd: REPO, env: CHILD_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024, timeout: SUITE_TIMEOUT_MS,
    });
    // status is null when the suite was killed (timeout, signal) or never
    // started; that is a failure, never a pass.
    const code = r.status === null ? (r.error ? 'error ' + r.error.code : 'signal ' + r.signal) : r.status;
    console.log('         ' + rel + ': exit ' + code);
    if (r.status !== 0) {
      failed.push(rel);
      const out = (r.stdout || '') + (r.stderr || '');
      if (out.trim()) console.log(tail(out, 15));
    }
  }
  if (failed.length) report('suites', false, failed.length + ' of ' + suites.length + ' suites exited non-zero: ' + failed.join(', '));
  else report('suites', true, suites.length + ' suites exited 0');
}

// --- 2. build check --------------------------------------------------------------
function checkBuild() {
  const script = path.join(REPO, 'scripts', 'build-plugin.js');
  if (!fs.existsSync(script)) { report('build', true, 'skipped: no scripts/build-plugin.js in this repo'); return; }
  const r = spawnSync('node', [script, '--check'], { cwd: REPO, env: CHILD_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 0) { report('build', true, 'build-plugin.js --check exited 0 (plugin/ matches its source)'); return; }
  const out = (r.stdout || '') + (r.stderr || '');
  if (out.trim()) console.log(tail(out, 15));
  report('build', false, 'build-plugin.js --check exited ' + r.status + '; plugin/ is stale, run node scripts/build-plugin.js and commit');
}

// plugin.json's version as committed at HEAD, or null with a reason.
function headPluginVersion() {
  const r = git(['show', 'HEAD:plugin/.claude-plugin/plugin.json']);
  if (r.status !== 0) return { version: null, why: 'plugin/.claude-plugin/plugin.json is not committed at HEAD' };
  try {
    const v = JSON.parse(r.out).version;
    if (typeof v !== 'string' || !v) return { version: null, why: 'plugin/.claude-plugin/plugin.json at HEAD has no version' };
    return { version: v, why: '' };
  } catch (e) {
    return { version: null, why: 'plugin/.claude-plugin/plugin.json at HEAD is not valid JSON (' + e.message + ')' };
  }
}

// --- 3. version bump ---------------------------------------------------------------
function checkVersionBump(head) {
  const name = 'version bump';
  if (git(['rev-parse', '--verify', '-q', 'HEAD']).status !== 0) { report(name, false, 'no commit at HEAD (not a git repo, or an empty one)'); return; }
  const d = git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*']);
  if (d.status !== 0) { report(name, true, 'no v* release tag reachable from HEAD; nothing to compare (first release)'); return; }
  const tag = d.out;
  const tagVersion = tag.replace(/^v/, '');
  // :(top) anchors the pathspec at the repo root whatever the cwd, a second
  // guard behind REPO already being the top level.
  const diff = git(['diff', '--quiet', tag, 'HEAD', '--', ':(top)plugin/']);
  if (diff.status !== 0 && diff.status !== 1) { report(name, false, 'git diff ' + tag + ' HEAD -- plugin/ failed (exit ' + diff.status + '): ' + diff.err); return; }
  const changed = diff.status === 1;
  if (!changed) { report(name, true, 'plugin/ unchanged since ' + tag); return; }
  if (head.version === null) { report(name, false, 'plugin/ changed since ' + tag + ' but ' + head.why); return; }
  const headVersion = head.version;
  if (headVersion === tagVersion) {
    report(name, false, 'plugin/ changed since ' + tag + ' without a version bump; existing installs would never receive it');
    return;
  }
  report(name, true, 'plugin/ changed since ' + tag + ' and plugin.json moved ' + tagVersion + ' -> ' + headVersion);
}

// --- 4. marketplace ref --------------------------------------------------------------
function checkMarketplace(head) {
  const name = 'marketplace ref';
  if (head.version === null) { report(name, false, 'cannot derive the expected ref: ' + head.why); return; }
  const expectedRef = 'v' + head.version;
  const expected = 'source {"source": "git-subdir", "path": "plugin", "ref": "' + expectedRef + '"}';
  const r = git(['show', 'HEAD:.claude-plugin/marketplace.json']);
  if (r.status !== 0) { report(name, false, '.claude-plugin/marketplace.json is not committed at HEAD; expected the tk entry to have ' + expected); return; }
  let market;
  try { market = JSON.parse(r.out); } catch (e) { report(name, false, '.claude-plugin/marketplace.json at HEAD is not valid JSON (' + e.message + ')'); return; }
  const entry = Array.isArray(market.plugins) ? market.plugins.find(p => p && p.name === 'tk') : undefined;
  if (!entry) { report(name, false, 'no plugin named tk in .claude-plugin/marketplace.json at HEAD; expected one with ' + expected); return; }
  const s = entry.source;
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    report(name, false, 'tk source is ' + JSON.stringify(s) + ' (installs whatever plugin/ holds on the default branch); expected ' + expected);
    return;
  }
  const wrong = [];
  if (s.source !== 'git-subdir') wrong.push('source is ' + JSON.stringify(s.source));
  if (s.path !== 'plugin') wrong.push('path is ' + JSON.stringify(s.path));
  if (s.ref !== expectedRef) wrong.push('ref is ' + JSON.stringify(s.ref));
  if (wrong.length) { report(name, false, 'tk ' + wrong.join(', ') + '; expected ' + expected); return; }
  report(name, true, 'tk installs git-subdir plugin at ' + expectedRef);
}

console.log('release-check: ' + REPO);
checkSuites();
checkBuild();
const head = headPluginVersion();
checkVersionBump(head);
checkMarketplace(head);
const failedCount = results.filter(ok => !ok).length;
console.log('release-check: ' + (results.length - failedCount) + ' passed, ' + failedCount + ' failed');
process.exit(failedCount ? 1 : 0);
