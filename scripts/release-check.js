#!/usr/bin/env node
'use strict';
// release-check.js - the maintainer-only release gate for the toolkit repo
// (issue #175). Nothing here ships in plugin/.
//
//   node scripts/release-check.js [--repo <dir>] [--suites <list|glob>]
//                                 [--skip-suites] [--commit <sha>]
//                                 [--pushing-tag <tag>[:<sha>]]...
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
//                    of paths, repo-relative or absolute, each may use * or ?
//                    in its file name); --skip-suites skips the check.
//   2. Build       - `node scripts/build-plugin.js --check` exits 0 (plugin/
//                    matches its source). Skipped with a note when the repo has
//                    no build-plugin.js (the tests' scratch repos).
//   T. Tag version - only with --pushing-tag: each pushed tag must be exactly
//                    v<plugin.json version> of the commit the tag points at.
//   3. Version     - compares the checked commit with the previous release: the
//                    nearest v* tag reachable from it that does NOT point at
//                    the commit itself (so the release commit, already tagged,
//                    is compared with the release before it, not with itself).
//                    If plugin/ changed since that tag, plugin.json's version
//                    at the commit must be strictly greater than the tag's. No
//                    previous tag passes with a note.
//   4. Marketplace - the `tk` entry in .claude-plugin/marketplace.json must be
//                    a git-subdir source on path "plugin" pinned to ref
//                    v<plugin.json version>, so users install the tagged tree.
//
// Which commit checks 3 and 4 read: HEAD by default (a manual run). The hook
// names what is actually being pushed instead, because the pushed commit need
// not be HEAD (`git push origin other-branch:main`):
//   --commit <sha>             the commit being pushed to main (repeatable).
//   --pushing-tag <tag>[:<sha>] a pushed tag (repeatable); <sha> is the local
//                              object being pushed (the hook passes it, since
//                              `git push origin X:refs/tags/v1` need not match
//                              any local tag); without it the local tag is read.
// Each distinct commit named gets its own checks 3 and 4, read from committed
// state (`git show <sha>:<path>`). The suites and the build check always run on
// the working tree. --repo points every check at another clone (tests).
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
const USAGE = 'usage: node scripts/release-check.js [--repo <dir>] [--suites <list|glob>] [--skip-suites] [--commit <sha>] [--pushing-tag <tag>[:<sha>]]...';
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
  const o = { repo: process.cwd(), suites: null, skipSuites: false, commits: [], tags: [] };
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
    else if (a === '--commit') o.commits.push(value());
    else if (a === '--pushing-tag') {
      // A tag name can never contain ':' (git refname rules), so the first
      // colon always separates the name from the pushed object.
      const v = value();
      const at = v.indexOf(':');
      const tag = (at < 0 ? v : v.slice(0, at)).replace(/^refs\/tags\//, '');
      if (!tag || (at >= 0 && !v.slice(at + 1))) usage('bad --pushing-tag ' + v + ' (expected <tag> or <tag>:<sha>)');
      o.tags.push({ tag, rev: at < 0 ? 'refs/tags/' + tag : v.slice(at + 1) });
    }
    else if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    else usage('unknown argument ' + a);
  }
  return o;
}

function usage(msg) {
  console.error('release-check: ' + msg);
  console.error(USAGE);
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
// A relative directory is read under the repo root, an absolute one as given.
function expandSuites(spec) {
  const files = [];
  for (const item of spec.split(',').map(s => s.trim()).filter(Boolean)) {
    if (!/[*?]/.test(path.basename(item))) { files.push(item); continue; }
    const dir = path.dirname(item);
    const re = new RegExp('^' + path.basename(item).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    const abs = path.resolve(REPO, dir);
    const names = fs.existsSync(abs) ? fs.readdirSync(abs).filter(n => re.test(n)).sort() : [];
    for (const n of names) files.push(path.isAbsolute(dir) ? path.join(dir, n) : dir === '.' ? n : dir + '/' + n);
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

// Semver precedence: X.Y.Z numerically, then a release outranks any
// prerelease of it, then prerelease identifiers left to right (numeric ones
// numerically and below alphanumeric ones). Build metadata is ignored.
// Returns <0, 0, >0, or null when either side is not X.Y.Z[-pre][+build].
function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v);
    return m ? { core: [m[1], m[2], m[3]].map(Number), pre: m[4] ? m[4].split('.') : [] } : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
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

// The commit a revision names (peeling an annotated tag), or null.
function resolveCommit(rev) {
  const r = git(['rev-parse', '--verify', '-q', rev + '^{commit}']);
  return r.status === 0 && r.out ? r.out : null;
}

// plugin.json's version as committed at `sha`, or null with a reason.
function pluginVersionAt(sha, label) {
  const r = git(['show', sha + ':plugin/.claude-plugin/plugin.json']);
  if (r.status !== 0) return { version: null, why: 'plugin/.claude-plugin/plugin.json is not committed at ' + label };
  try {
    const v = JSON.parse(r.out).version;
    if (typeof v !== 'string' || !v) return { version: null, why: 'plugin/.claude-plugin/plugin.json at ' + label + ' has no version' };
    return { version: v, why: '' };
  } catch (e) {
    return { version: null, why: 'plugin/.claude-plugin/plugin.json at ' + label + ' is not valid JSON (' + e.message + ')' };
  }
}

// --- T. pushed tag names the version ---------------------------------------------------
function checkTag(t, sha, found) {
  const name = 'tag version';
  if (!sha) { report(name, false, 'pushed tag ' + t.tag + ': cannot resolve ' + t.rev + ' to a commit'); return; }
  if (found.version === null) { report(name, false, 'pushed tag ' + t.tag + ': ' + found.why); return; }
  if (t.tag !== 'v' + found.version) {
    report(name, false, 'pushed tag ' + t.tag + ' does not match plugin.json version ' + found.version + ' at ' + sha.slice(0, 12) + '; expected tag v' + found.version);
    return;
  }
  report(name, true, 'pushed tag ' + t.tag + ' matches plugin.json version at ' + sha.slice(0, 12));
}

// --- 3. version bump ---------------------------------------------------------------
function checkVersionBump(target) {
  const name = 'version bump';
  const at = target.label + ': ';
  const sha = target.sha;
  // The previous release: the nearest v* tag reachable from the commit, with
  // every tag ON the commit excluded. Plain `describe` would return the release
  // commit's own tag, diff the commit with itself, and pass having compared
  // nothing. Tag names cannot hold glob characters, so each is a literal
  // --exclude pattern.
  const onCommit = git(['tag', '--points-at', sha, '--list', 'v[0-9]*']);
  if (onCommit.status !== 0) { report(name, false, at + 'git tag --points-at failed (exit ' + onCommit.status + '): ' + onCommit.err); return; }
  const exclude = [];
  for (const t of onCommit.out.split('\n').filter(Boolean)) exclude.push('--exclude', t);
  const d = git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', ...exclude, sha]);
  if (d.status !== 0) { report(name, true, at + 'no earlier v* release tag reachable; nothing to compare (first release)'); return; }
  const tag = d.out;
  const tagVersion = tag.replace(/^v/, '');
  // :(top) anchors the pathspec at the repo root whatever the cwd, a second
  // guard behind REPO already being the top level.
  const diff = git(['diff', '--quiet', tag, sha, '--', ':(top)plugin/']);
  if (diff.status !== 0 && diff.status !== 1) { report(name, false, at + 'git diff ' + tag + ' ' + sha.slice(0, 12) + ' -- plugin/ failed (exit ' + diff.status + '): ' + diff.err); return; }
  if (diff.status === 0) { report(name, true, at + 'plugin/ unchanged since ' + tag); return; }
  if (target.found.version === null) { report(name, false, at + 'plugin/ changed since ' + tag + ' but ' + target.found.why); return; }
  const version = target.found.version;
  const cmp = compareVersions(version, tagVersion);
  if (cmp === null) {
    report(name, false, at + 'plugin/ changed since ' + tag + ' but cannot compare plugin.json ' + JSON.stringify(version) + ' with tag version ' + JSON.stringify(tagVersion) + ' (expected X.Y.Z)');
    return;
  }
  if (cmp === 0) {
    report(name, false, at + 'plugin/ changed since ' + tag + ' without a version bump; existing installs would never receive it');
    return;
  }
  if (cmp < 0) {
    report(name, false, at + 'plugin/ changed since ' + tag + ' but plugin.json moved backwards ' + tagVersion + ' -> ' + version + '; the version must be greater than ' + tagVersion);
    return;
  }
  report(name, true, at + 'plugin/ changed since ' + tag + ' and plugin.json moved ' + tagVersion + ' -> ' + version);
}

// --- 4. marketplace ref --------------------------------------------------------------
function checkMarketplace(target) {
  const name = 'marketplace ref';
  const at = target.label + ': ';
  if (target.found.version === null) { report(name, false, at + 'cannot derive the expected ref: ' + target.found.why); return; }
  const expectedRef = 'v' + target.found.version;
  const expected = 'source {"source": "git-subdir", "path": "plugin", "ref": "' + expectedRef + '"}';
  const r = git(['show', target.sha + ':.claude-plugin/marketplace.json']);
  if (r.status !== 0) { report(name, false, at + '.claude-plugin/marketplace.json is not committed; expected the tk entry to have ' + expected); return; }
  let market;
  try { market = JSON.parse(r.out); } catch (e) { report(name, false, at + '.claude-plugin/marketplace.json is not valid JSON (' + e.message + ')'); return; }
  const entry = Array.isArray(market.plugins) ? market.plugins.find(p => p && p.name === 'tk') : undefined;
  if (!entry) { report(name, false, at + 'no plugin named tk in .claude-plugin/marketplace.json; expected one with ' + expected); return; }
  const s = entry.source;
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    report(name, false, at + 'tk source is ' + JSON.stringify(s) + ' (installs whatever plugin/ holds on the default branch); expected ' + expected);
    return;
  }
  const wrong = [];
  if (s.source !== 'git-subdir') wrong.push('source is ' + JSON.stringify(s.source));
  if (s.path !== 'plugin') wrong.push('path is ' + JSON.stringify(s.path));
  if (s.ref !== expectedRef) wrong.push('ref is ' + JSON.stringify(s.ref));
  if (wrong.length) { report(name, false, at + 'tk ' + wrong.join(', ') + '; expected ' + expected); return; }
  report(name, true, at + 'tk installs git-subdir plugin at ' + expectedRef);
}

// Checks T, 3 and 4. Every commit named by --commit or --pushing-tag is
// checked once, labelled with how it was named; with neither, HEAD.
function checkCommits() {
  const targets = [];
  const add = (sha, label) => {
    const known = targets.find(t => t.sha === sha);
    if (known) { known.label += ', ' + label; return known; }
    const t = { sha, label, found: pluginVersionAt(sha, sha.slice(0, 12)) };
    targets.push(t);
    return t;
  };
  const unresolved = (what) => {
    report('version bump', false, what + ': cannot resolve to a commit (not a git repo, an empty one, or an unknown object)');
    report('marketplace ref', false, what + ': cannot resolve to a commit, so there is no committed marketplace.json to read');
  };
  for (const t of opts.tags) {
    const sha = resolveCommit(t.rev);
    const target = sha ? add(sha, 'tag ' + t.tag) : null;
    checkTag(t, sha, target ? target.found : null);
  }
  for (const c of opts.commits) {
    const sha = resolveCommit(c);
    if (sha) add(sha, 'commit ' + sha.slice(0, 12)); else unresolved('commit ' + c);
  }
  if (!opts.tags.length && !opts.commits.length) {
    const sha = resolveCommit('HEAD');
    if (sha) add(sha, 'HEAD'); else unresolved('HEAD');
  }
  for (const t of targets) {
    checkVersionBump(t);
    checkMarketplace(t);
  }
}

console.log('release-check: ' + REPO);
checkSuites();
checkBuild();
checkCommits();
const failedCount = results.filter(ok => !ok).length;
console.log('release-check: ' + (results.length - failedCount) + ' passed, ' + failedCount + ' failed');
process.exit(failedCount ? 1 : 0);
