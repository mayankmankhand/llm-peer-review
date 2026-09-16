#!/usr/bin/env node
'use strict';
//
// test-session-init.js - assertions for .claude/scripts/session-init.js: the plan
// header's start commit and the --scope mode a review reads to find what it
// covers. (issue #182)
//
// Maintainer-only: lives under scripts/, which never ships downstream.
//
// Follows the repo's dependency-free test convention (see test-correction-ledger.js):
// check(name, condition, detail), print, exit non-zero on any failure.
//
// Every repository here is a throwaway under the OS temp folder, built hermetically:
// git reads no global or system config (GIT_CONFIG_GLOBAL=/dev/null,
// GIT_CONFIG_NOSYSTEM=1) and no global excludes file (core.excludesFile=/dev/null,
// since git falls back to ~/.config/git/ignore when that is unset), and the
// repo-local variables a git hook exports are cleared (the list release-check.js
// clears), so neither this machine's git settings nor a push hook can change what a
// fixture looks like. The temp folder's own name holds a space, so every path the
// script handles, remote URLs included, has one.
//
// Each section runs inside a guard, so a section that throws is one failed check
// and the rest still run. That also lets this suite run to the end against an
// older session-init.js, which is how its new cases are shown to fail first.
//
// Usage: node scripts/test-session-init.js

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '..', '.claude', 'scripts', 'session-init.js');

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' :: ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' :: ' + detail : '')); }
}

function section(title, fn) {
  console.log('\n' + title);
  try { fn(); }
  catch (e) { check(title + ' (section ran to the end)', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)); }
}

// --- a hermetic git ---------------------------------------------------------
const LOCAL_REPO_ENV = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX',
  'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
];
const ENV = Object.assign({}, process.env);
for (const k of LOCAL_REPO_ENV) delete ENV[k];
Object.assign(ENV, {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.excludesFile',
  GIT_CONFIG_VALUE_0: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
});

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'session init test-'));
process.on('exit', function () {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

function git(cwd, args, extraEnv) {
  const r = spawnSync('git', args, { cwd: cwd, env: Object.assign({}, ENV, extraEnv || {}), encoding: 'utf-8' });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' failed: ' + (r.stderr || (r.error && r.error.message) || 'exit ' + r.status).trim());
  return r.stdout;
}

// Commits get distinct, increasing dates, so "newest first" never rests on a tie.
let clock = 1767225600; // 2026-01-01T00:00:00Z
function commitAll(repo, message) {
  git(repo, ['add', '-A']);
  const when = clock + ' +0000';
  clock += 60;
  git(repo, ['commit', '-q', '-m', message], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

function newRepo(label) {
  const dir = path.join(TMP, label);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['-c', 'init.defaultBranch=main', 'init', '-q']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'tag.gpgsign', 'false']);
  return dir;
}

function bareRemote(label) {
  const dir = path.join(TMP, label + '.git');
  git(TMP, ['-c', 'init.defaultBranch=main', 'init', '-q', '--bare', dir]);
  return dir;
}

function write(repo, rel, content) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function lines(n, word) {
  let s = '';
  for (let i = 1; i <= n; i++) s += (word || 'line') + ' ' + i + '\n';
  return s;
}

// --- running the script -----------------------------------------------------
function runScript(args, cwd, extraEnv) {
  const r = spawnSync(process.execPath, [SCRIPT].concat(args), {
    cwd: cwd, env: Object.assign({}, ENV, extraEnv || {}), encoding: 'utf-8',
  });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', parsed: json !== null && typeof json === 'object', json: json || {} };
}

function scope(repo, arg, opts) {
  const o = opts || {};
  return runScript(['--scope'].concat(arg === undefined ? [] : [arg]), o.cwd || repo, o.env);
}

// Safe reads, so output without these fields fails a check instead of throwing.
function dig(obj, keys) {
  return keys.split('.').reduce(function (o, k) { return o !== null && typeof o === 'object' ? o[k] : undefined; }, obj);
}
function list(o, where) {
  const v = dig(o.json, where);
  return Array.isArray(v) ? v : null;
}
function entry(files, p) {
  return (files || []).filter(function (f) { return f && f.path === p; })[0] || null;
}
function paths(files) {
  return (files || []).map(function (f) { return f && f.path; });
}
function sameList(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every(function (x, i) { return x === b[i]; });
}
function brief(o) {
  const j = o.json || {};
  return JSON.stringify({ status: o.status, source: j.source, reason: j.reason, error: j.error, message: j.message }).slice(0, 300);
}

console.log('\nsession-init.js\n');

// --- 1. the plan header's start commit, and the default output's keys --------
section('1. plans[].startCommit and the no-argument output', function () {
  const repo = newRepo('plans');
  write(repo, 'README.md', 'x\n');
  commitAll(repo, 'init');
  const FULL = 'abcdef0123456789abcdef0123456789abcdef01';
  write(repo, 'plans/PLAN-a.md', '# Plan A\n\n**Overall Progress:** `40%`\n**Start commit:** 1a2b3c4\n\n## TLDR\nText.\n');
  // The spelling appears, but only inside a sentence: not a header line.
  write(repo, 'plans/PLAN-b.md', '# Plan B\n\n**Overall Progress:** `0%`\n\n## TLDR\n/execute writes `**Start commit:** 1a2b3c4` once.\n');
  write(repo, 'plans/PLAN-c.md', '# Plan C\r\n\r\n**Overall Progress:** `10%`\r\n**Start commit:** ' + FULL + '\r\n\r\n## TLDR\r\n');
  write(repo, 'plans/PLAN-d.md', '# Plan D\n**Start commit:** 1a2b3c\n');
  write(repo, 'plans/PLAN-e.md', '# Plan E\n**Start commit:** 1a2b3c4 (v7.1.0)\n');
  write(repo, 'plans/PLAN-f.md', '# Plan F\n**Start commit:** not-a-sha\n');
  write(repo, 'plans/PLAN-g.md', '# Plan G\n**Start commit:** ABCDEF1\n');

  const r = runScript([], repo);
  check('the no-argument run exits 0 with one JSON object', r.status === 0 && r.parsed, r.stderr);
  const byName = {};
  (Array.isArray(r.json.plans) ? r.json.plans : []).forEach(function (p) { byName[p.name] = p; });
  const plan = function (n) { return byName[n] || {}; };

  check('a **Start commit:** header line gives plans[].startCommit', plan('PLAN-a.md').startCommit === '1a2b3c4',
    JSON.stringify(plan('PLAN-a.md')));
  check('a plan without the line has startCommit null, present in the entry',
    'startCommit' in plan('PLAN-b.md') && plan('PLAN-b.md').startCommit === null,
    'a mention inside a sentence must not count: ' + JSON.stringify(plan('PLAN-b.md')));
  check('a 40-character sha on a CRLF line parses', plan('PLAN-c.md').startCommit === FULL, JSON.stringify(plan('PLAN-c.md')));
  check('six hex characters are not a start commit', 'startCommit' in plan('PLAN-d.md') && plan('PLAN-d.md').startCommit === null,
    JSON.stringify(plan('PLAN-d.md')));
  check('text after the sha means no start commit', 'startCommit' in plan('PLAN-e.md') && plan('PLAN-e.md').startCommit === null,
    JSON.stringify(plan('PLAN-e.md')));
  check('a value that is not hex is not a start commit', 'startCommit' in plan('PLAN-f.md') && plan('PLAN-f.md').startCommit === null,
    JSON.stringify(plan('PLAN-f.md')));
  check('an upper-case sha is reported in lower case', plan('PLAN-g.md').startCommit === 'abcdef1', JSON.stringify(plan('PLAN-g.md')));
  check('startCommit does not disturb progress or status', plan('PLAN-a.md').progress === 40 && plan('PLAN-a.md').status === 'in-progress',
    JSON.stringify(plan('PLAN-a.md')));

  const KEYS = ['generatedAt', 'cwd', 'worktree', 'map', 'lessons', 'plans', 'newestPlan'];
  const keys = Object.keys(r.json);
  check('the no-argument output keeps exactly its top-level keys', sameList(keys.slice().sort(), KEYS.slice().sort()), keys.join(','));
  check('each plan entry is name, progress, status and startCommit',
    Object.keys(plan('PLAN-a.md')).join(',') === 'name,progress,status,startCommit', Object.keys(plan('PLAN-a.md')).join(','));
  check('worktree and newestPlan are still reported',
    r.json.worktree && r.json.worktree.isWorktree === false && typeof r.json.newestPlan === 'string', JSON.stringify(r.json.worktree));

  const unknown = runScript(['--bogus'], repo);
  check('an unknown argument prints one JSON object with an error and exits 0',
    unknown.status === 0 && unknown.parsed && typeof unknown.json.error === 'string', unknown.stdout.slice(0, 200));
});

// --- 2. an argument range -----------------------------------------------------
section('2. --scope <base>..<end>', function () {
  const repo = newRepo('argument');
  write(repo, 'a.txt', lines(5));
  const c1 = commitAll(repo, 'first');
  write(repo, 'a.txt', lines(8));
  const c2 = commitAll(repo, 'second');
  write(repo, 'docs/b.md', lines(4));
  const c3 = commitAll(repo, 'third');

  const o = scope(repo, c1.slice(0, 7) + '..HEAD');
  check('--scope exits 0 and prints exactly one JSON object', o.status === 0 && o.parsed, o.stderr || o.stdout.slice(0, 200));
  check('an argument range reports source "argument"', o.json.source === 'argument', brief(o));
  check('the base resolves to its full sha', dig(o.json, 'range.base') === c1, dig(o.json, 'range.base'));
  check('the end resolves to the full sha of HEAD', dig(o.json, 'range.end') === c3, dig(o.json, 'range.end'));
  check('the range counts its commits', dig(o.json, 'range.commitCount') === 2, dig(o.json, 'range.commitCount'));
  const commits = list(o, 'range.commits') || [];
  check('the commit list is newest first, with subjects',
    sameList(commits.map(function (c) { return c.sha; }), [c3, c2]) && commits[0].subject === 'third' && commits[1].subject === 'second',
    JSON.stringify(commits));
  const files = list(o, 'range.files');
  const a = entry(files, 'a.txt');
  const b = entry(files, 'docs/b.md');
  check('the range lists each changed file with its line counts',
    !!a && a.added === 3 && a.deleted === 0 && a.binary === false && !!b && b.added === 4 && files.length === 2, JSON.stringify(files));
  check('the range sums its added and deleted lines', dig(o.json, 'range.added') === 7 && dig(o.json, 'range.deleted') === 0);
  check('an argument range is never capped', dig(o.json, 'range.capped') === false && dig(o.json, 'range.omitted') === 0 &&
    dig(o.json, 'range.fullBase') === c1 && dig(o.json, 'range.baseFrom') === 'argument', JSON.stringify(o.json.range));
  check('a clean tree reports empty staged, unstaged and untracked lists',
    sameList(list(o, 'uncommitted.staged.files'), []) && sameList(list(o, 'uncommitted.unstaged.files'), []) &&
    sameList(list(o, 'uncommitted.untracked.files'), []), JSON.stringify(o.json.uncommitted));
  check('totals.lines counts the range on a clean tree', dig(o.json, 'totals.lines') === 7 && dig(o.json, 'totals.fileCount') === 2,
    JSON.stringify(o.json.totals));

  git(repo, ['tag', '-a', 'v1.0', '-m', 'release', c2]);
  const t = scope(repo, 'v1.0..');
  check('an annotated tag base peels to its commit, and an empty end means HEAD',
    t.json.source === 'argument' && dig(t.json, 'range.base') === c2 && dig(t.json, 'range.end') === c3 &&
    dig(t.json, 'range.commitCount') === 1 && dig(t.json, 'range.baseRef') === 'v1.0', brief(t));
});

// --- 3. a base that is not an ancestor, and ranges that are refused -----------
section('3. not an ancestor, a bad revision, and malformed ranges', function () {
  const repo = newRepo('not-ancestor');
  write(repo, 'a.txt', 'a\n');
  const c1 = commitAll(repo, 'root');
  git(repo, ['checkout', '-q', '-b', 'side']);
  write(repo, 'side.txt', 'side\n');
  const s1 = commitAll(repo, 'side work');
  git(repo, ['checkout', '-q', 'main']);
  write(repo, 'main.txt', 'main\n');
  commitAll(repo, 'main work');
  write(repo, 'untracked.txt', lines(2));

  const o = scope(repo, s1 + '..HEAD');
  check('a base that is not an ancestor of the end gives source "none", reason "not-ancestor"',
    o.status === 0 && o.json.source === 'none' && o.json.reason === 'not-ancestor', brief(o));
  check('a "none" answer has no range and a plain message', o.json.range === null && typeof o.json.message === 'string' && o.json.message.length > 0,
    brief(o));
  check('a "none" answer still reports uncommitted work and totals',
    !!entry(list(o, 'uncommitted.untracked.files'), 'untracked.txt') && dig(o.json, 'totals.lines') === 2, JSON.stringify(o.json.totals));

  const bad = scope(repo, 'no-such-ref..HEAD');
  check('a side that names no commit gives reason "bad-revision"', bad.json.source === 'none' && bad.json.reason === 'bad-revision', brief(bad));
  const three = scope(repo, c1 + '...HEAD');
  check('three dots are refused as "invalid-range"', three.json.source === 'none' && three.json.reason === 'invalid-range', brief(three));
  const noDots = scope(repo, 'main');
  check('an argument with no ".." is refused as "invalid-range"', noDots.json.reason === 'invalid-range', brief(noDots));
  const dash = scope(repo, '--output=x..HEAD');
  check('a side starting with "-" is refused before git sees it',
    dash.json.reason === 'invalid-range' && !fs.existsSync(path.join(repo, 'x')), brief(dash));
  const two = runScript(['--scope', c1 + '..HEAD', 'extra'], repo);
  check('two arguments print an error object and exit 0', two.status === 0 && two.parsed && typeof two.json.error === 'string', brief(two));
});

// --- 4. a clean tree with an upstream -------------------------------------------
section('4. no argument: a branch with an upstream', function () {
  const remote = bareRemote('upstream remote');
  const repo = newRepo('upstream');
  write(repo, 'base.txt', 'base\n');
  const b = commitAll(repo, 'base');
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', '-q', '-u', 'origin', 'main']);

  const level = scope(repo);
  check('a clean tree level with its upstream: source "unpushed" with no commits',
    level.status === 0 && level.json.source === 'unpushed' && dig(level.json, 'range.commitCount') === 0 &&
    dig(level.json, 'range.base') === b && dig(level.json, 'range.end') === b && dig(level.json, 'totals.lines') === 0, brief(level));
  check('the base names the upstream it came from',
    dig(level.json, 'range.baseFrom') === 'upstream' && dig(level.json, 'range.baseRef') === 'refs/remotes/origin/main' &&
    dig(level.json, 'range.endRef') === 'HEAD', JSON.stringify(level.json.range));

  write(repo, 'one.txt', lines(2));
  const u1 = commitAll(repo, 'one');
  write(repo, 'two.txt', lines(3));
  const u2 = commitAll(repo, 'two');
  const ahead = scope(repo);
  check('unpushed commits on a clean tree are measured from the upstream',
    ahead.json.source === 'unpushed' && dig(ahead.json, 'range.base') === b && dig(ahead.json, 'range.end') === u2 &&
    dig(ahead.json, 'range.commitCount') === 2 && dig(ahead.json, 'range.capped') === false && dig(ahead.json, 'range.omitted') === 0,
    brief(ahead) + ' ' + JSON.stringify(ahead.json.range));
  check('the unpushed commits are named, newest first',
    sameList((list(ahead, 'range.commits') || []).map(function (c) { return c.sha; }), [u2, u1]));
  check('the unpushed range lists its files and the total counts them',
    sameList(paths(list(ahead, 'range.files')), ['one.txt', 'two.txt']) && dig(ahead.json, 'totals.lines') === 5,
    JSON.stringify(ahead.json.totals));
  check('head describes the branch', dig(ahead.json, 'head.branch') === 'main' && dig(ahead.json, 'head.commit') === u2 &&
    dig(ahead.json, 'head.detached') === false && dig(ahead.json, 'head.unborn') === false, JSON.stringify(ahead.json.head));
});

// --- 5. no upstream, but a remote default branch --------------------------------
section('5. no argument: no upstream, a remote default branch', function () {
  const remote = bareRemote('default remote');
  const repo = newRepo('default-branch');
  write(repo, 'm.txt', 'main\n');
  const m1 = commitAll(repo, 'main');
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', '-q', 'origin', 'main']);
  git(repo, ['checkout', '-q', '-b', 'feature']);
  write(repo, 'f1.txt', 'f1\n');
  const f1 = commitAll(repo, 'f1');
  write(repo, 'f2.txt', 'f2\n');
  commitAll(repo, 'f2');
  write(repo, 'f3.txt', 'f3\n');
  commitAll(repo, 'f3');

  const o = scope(repo);
  check('with no upstream, the base is the merge-base with origin/main',
    o.json.source === 'unpushed' && dig(o.json, 'range.baseFrom') === 'default-branch' &&
    dig(o.json, 'range.baseRef') === 'refs/remotes/origin/main' && dig(o.json, 'range.base') === m1 && dig(o.json, 'range.commitCount') === 3,
    brief(o) + ' ' + JSON.stringify(o.json.range));

  git(repo, ['push', '-q', 'origin', f1 + ':refs/heads/trunk']);
  git(repo, ['remote', 'set-head', 'origin', 'trunk']);
  const viaHead = scope(repo);
  check('origin/HEAD names the default branch ahead of origin/main',
    dig(viaHead.json, 'range.baseRef') === 'refs/remotes/origin/trunk' && dig(viaHead.json, 'range.base') === f1 &&
    dig(viaHead.json, 'range.commitCount') === 2, JSON.stringify(viaHead.json.range));

  git(repo, ['branch', '--set-upstream-to=main']);
  const localUp = scope(repo);
  check('an upstream that is a local branch is not trusted',
    dig(localUp.json, 'range.baseFrom') === 'default-branch' && dig(localUp.json, 'range.base') === f1, JSON.stringify(localUp.json.range));

  git(repo, ['remote', 'rename', 'origin', 'github']);
  const lone = scope(repo);
  check('a lone remote not named origin stands in for origin',
    lone.json.source === 'unpushed' && dig(lone.json, 'range.baseRef') === 'refs/remotes/github/trunk' && dig(lone.json, 'range.base') === f1,
    brief(lone) + ' ' + JSON.stringify(lone.json.range));
});

// --- 6. no remote at all; detached and unborn HEADs --------------------------
section('6. no argument: no remote, a detached HEAD, an unborn HEAD', function () {
  const repo = newRepo('no-remote');
  write(repo, 'a.txt', 'a\n');
  const c1 = commitAll(repo, 'one');
  write(repo, 'b.txt', 'b\n');
  commitAll(repo, 'two');
  write(repo, 'notes.txt', lines(3));

  const o = scope(repo);
  check('no remote gives source "none", reason "no-remote"', o.status === 0 && o.json.source === 'none' && o.json.reason === 'no-remote', brief(o));
  check('with no remote, uncommitted work is still counted',
    (entry(list(o, 'uncommitted.untracked.files'), 'notes.txt') || {}).added === 3 && dig(o.json, 'totals.lines') === 3,
    JSON.stringify(o.json.uncommitted));

  git(repo, ['checkout', '-q', '--detach', 'HEAD']);
  const det = scope(repo);
  check('a detached HEAD gives reason "detached-head"',
    det.json.source === 'none' && det.json.reason === 'detached-head' && dig(det.json, 'head.detached') === true, brief(det));
  const detArg = scope(repo, c1 + '..HEAD');
  check('an argument range still works on a detached HEAD',
    detArg.json.source === 'argument' && dig(detArg.json, 'range.commitCount') === 1, brief(detArg));

  const unborn = newRepo('unborn');
  write(unborn, 'first.txt', lines(4));
  git(unborn, ['add', 'first.txt']);
  const u = scope(unborn);
  check('a branch with no commits gives reason "unborn-head"',
    u.json.source === 'none' && u.json.reason === 'unborn-head' && dig(u.json, 'head.unborn') === true && dig(u.json, 'head.branch') === 'main',
    brief(u));
  check('on an unborn branch, staged files count against the empty tree',
    (entry(list(u, 'uncommitted.staged.files'), 'first.txt') || {}).added === 4 && dig(u.json, 'totals.lines') === 4,
    JSON.stringify(u.json.uncommitted));
});

// --- 7. 25 unpushed commits -------------------------------------------------------
section('7. no argument: 25 unpushed commits', function () {
  const remote = bareRemote('cap remote');
  const repo = newRepo('cap');
  write(repo, 'base.txt', 'base\n');
  const b = commitAll(repo, 'base');
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', '-q', '-u', 'origin', 'main']);
  const shas = [];
  for (let i = 1; i <= 25; i++) {
    write(repo, 'c' + String(i).padStart(2, '0') + '.txt', 'commit ' + i + '\n');
    shas.push(commitAll(repo, 'commit ' + i));
  }

  const o = scope(repo);
  const newest = shas.slice(5).reverse(); // commits 25 down to 6
  check('25 unpushed commits: the newest 20 are listed, newest first',
    sameList((list(o, 'range.commits') || []).map(function (c) { return c.sha; }), newest),
    JSON.stringify((list(o, 'range.commits') || []).map(function (c) { return c.subject; })));
  check('25 unpushed commits: capped is true and omitted is 5',
    dig(o.json, 'range.capped') === true && dig(o.json, 'range.omitted') === 5, JSON.stringify(o.json.range && { capped: o.json.range.capped, omitted: o.json.range.omitted }));
  check('the capped range starts at HEAD~20 and keeps the real base in fullBase',
    dig(o.json, 'range.base') === shas[4] && dig(o.json, 'range.fullBase') === b && dig(o.json, 'range.commitCount') === 20,
    JSON.stringify(o.json.range && { base: o.json.range.base, fullBase: o.json.range.fullBase, commitCount: o.json.range.commitCount }));
  const files = list(o, 'range.files') || [];
  check('the capped range counts only the newest 20 commits\' files',
    files.length === 20 && files.every(function (f) { return /^c(0[6-9]|1\d|2[0-5])\.txt$/.test(f.path); }) && dig(o.json, 'totals.lines') === 20,
    JSON.stringify(paths(files)));

  const all = scope(repo, b + '..HEAD');
  check('the same 25 commits passed as a range are all reviewed; only the list stops at 20',
    all.json.source === 'argument' && dig(all.json, 'range.commitCount') === 25 && (list(all, 'range.commits') || []).length === 20 &&
    dig(all.json, 'range.capped') === false && (list(all, 'range.files') || []).length === 25, brief(all));

  // A branch that merged the remote's main partway along. HEAD~20 (first parents)
  // predates the merge, so it lacks the real base: starting the review there would
  // pull main's already-pushed commit in through the merge. The cap stands down and
  // the whole unpushed range is reviewed instead.
  const mergeRemote = bareRemote('merge remote');
  const merged = newRepo('cap-merge');
  write(merged, 'o.txt', 'o\n');
  commitAll(merged, 'O');
  git(merged, ['remote', 'add', 'origin', mergeRemote]);
  git(merged, ['push', '-q', 'origin', 'main']);
  git(merged, ['checkout', '-q', '-b', 'feature']);
  git(merged, ['checkout', '-q', 'main']);
  write(merged, 'm0.txt', 'pushed on main\n');
  const m0 = commitAll(merged, 'M0');
  git(merged, ['push', '-q', 'origin', 'main']);
  git(merged, ['checkout', '-q', 'feature']);
  for (let i = 1; i <= 24; i++) {
    write(merged, 'f' + String(i).padStart(2, '0') + '.txt', 'feature ' + i + '\n');
    commitAll(merged, 'f' + i);
  }
  const when = clock + ' +0000';
  clock += 60;
  git(merged, ['merge', '-q', '--no-ff', '--no-edit', 'refs/remotes/origin/main'], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
  write(merged, 'f25.txt', 'feature 25\n');
  commitAll(merged, 'f25');
  const m = scope(merged);
  check('when HEAD~20 lacks the real base (a merge), the cap stands down and the whole range is reviewed',
    m.json.source === 'unpushed' && dig(m.json, 'range.base') === m0 && dig(m.json, 'range.capped') === false &&
    dig(m.json, 'range.omitted') === 0 && dig(m.json, 'range.commitCount') === 26 &&
    !entry(list(m, 'range.files'), 'm0.txt'),
    brief(m) + ' ' + JSON.stringify(m.json.range && { base: m.json.range.base, capped: m.json.range.capped, commitCount: m.json.range.commitCount, files: paths(m.json.range.files).length }));
});

// --- 8 + 9. the size gate's counts: staged, unstaged, untracked, binaries -------
section('8. staged, unstaged and untracked lines all count', function () {
  const repo = newRepo('size-gate');
  write(repo, '.claude/commands/own.md', lines(10));
  commitAll(repo, 'own command');
  write(repo, '.claude/commands/own.md', lines(10) + lines(60, 'staged'));
  git(repo, ['add', '.claude/commands/own.md']);
  write(repo, '.claude/commands/own.md', lines(10) + lines(60, 'staged') + lines(5, 'unstaged'));
  write(repo, '.claude/commands/new.md', lines(80, 'new'));

  const o = scope(repo);
  const staged = entry(list(o, 'uncommitted.staged.files'), '.claude/commands/own.md');
  const unstaged = entry(list(o, 'uncommitted.unstaged.files'), '.claude/commands/own.md');
  const untracked = entry(list(o, 'uncommitted.untracked.files'), '.claude/commands/new.md');
  check('a staged 60-line edit is counted', !!staged && staged.added === 60 && staged.deleted === 0 && dig(o.json, 'uncommitted.staged.added') === 60,
    JSON.stringify(o.json.uncommitted && o.json.uncommitted.staged));
  check('an unstaged edit on top of it is counted on its own', !!unstaged && unstaged.added === 5 && dig(o.json, 'uncommitted.unstaged.added') === 5,
    JSON.stringify(o.json.uncommitted && o.json.uncommitted.unstaged));
  check('an untracked 80-line file is counted', !!untracked && untracked.added === 80 && untracked.deleted === 0 && untracked.binary === false,
    JSON.stringify(o.json.uncommitted && o.json.uncommitted.untracked));
  check('the size gate total adds staged, unstaged and untracked lines', dig(o.json, 'totals.lines') === 145 && dig(o.json, 'totals.fileCount') === 2,
    JSON.stringify(o.json.totals));
});

section('9. binary files count as files with null line counts', function () {
  const repo = newRepo('binary');
  write(repo, 'readme.txt', 'text\n');
  const c1 = commitAll(repo, 'text');
  const blob = Buffer.alloc(64, 0);
  blob[0] = 0x89; blob[1] = 0x50;
  write(repo, 'icon.bin', blob);
  commitAll(repo, 'binary');
  write(repo, 'logo.png', blob);
  git(repo, ['add', 'logo.png']);
  write(repo, 'raw.dat', blob);
  write(repo, 'tail.txt', 'one\ntwo');

  const o = scope(repo, c1 + '..HEAD');
  const committed = entry(list(o, 'range.files'), 'icon.bin');
  const staged = entry(list(o, 'uncommitted.staged.files'), 'logo.png');
  const untracked = entry(list(o, 'uncommitted.untracked.files'), 'raw.dat');
  const tail = entry(list(o, 'uncommitted.untracked.files'), 'tail.txt');
  check('a committed binary has null line counts', !!committed && committed.binary === true && committed.added === null && committed.deleted === null,
    JSON.stringify(committed));
  check('a staged binary has null line counts', !!staged && staged.binary === true && staged.added === null && staged.deleted === null,
    JSON.stringify(staged));
  check('an untracked binary has null line counts', !!untracked && untracked.binary === true && untracked.added === null,
    JSON.stringify(untracked));
  check('an untracked last line with no newline still counts', !!tail && tail.added === 2 && tail.binary === false, JSON.stringify(tail));
  check('binaries count as files but add no lines',
    dig(o.json, 'totals.binaryCount') === 3 && dig(o.json, 'totals.fileCount') === 4 && dig(o.json, 'totals.lines') === 2,
    JSON.stringify(o.json.totals));
});

// --- 10. names with a space and non-ASCII characters --------------------------
section('10. paths with a space and non-ASCII names survive intact', function () {
  const repo = newRepo('names');
  write(repo, 'plain.txt', 'x\n');
  const c1 = commitAll(repo, 'init');
  write(repo, 'docs/with space/café notes.md', lines(3));
  commitAll(repo, 'names');
  git(repo, ['mv', 'docs/with space/café notes.md', 'docs/with space/résumé.md']);
  write(repo, 'naïve file.txt', lines(2));
  git(repo, ['add', 'naïve file.txt']);
  write(repo, '日本 語.txt', lines(4));

  const o = scope(repo, c1 + '..HEAD');
  check('a committed path with a space and a non-ASCII name survives',
    (entry(list(o, 'range.files'), 'docs/with space/café notes.md') || {}).added === 3, JSON.stringify(list(o, 'range.files')));
  const renamed = entry(list(o, 'uncommitted.staged.files'), 'docs/with space/résumé.md');
  check('a staged rename keeps both names intact',
    !!renamed && renamed.oldPath === 'docs/with space/café notes.md' && renamed.added === 0 && renamed.deleted === 0,
    JSON.stringify(list(o, 'uncommitted.staged.files')));
  check('a staged non-ASCII path with a space survives', (entry(list(o, 'uncommitted.staged.files'), 'naïve file.txt') || {}).added === 2,
    JSON.stringify(list(o, 'uncommitted.staged.files')));
  check('an untracked non-ASCII path with a space is found and read',
    (entry(list(o, 'uncommitted.untracked.files'), '日本 語.txt') || {}).added === 4, JSON.stringify(list(o, 'uncommitted.untracked.files')));

  fs.mkdirSync(path.join(repo, 'docs', 'sub'), { recursive: true });
  const fromSub = scope(repo, c1 + '..HEAD', { cwd: path.join(repo, 'docs', 'sub') });
  check('run from a subfolder, paths stay relative to the root and untracked files elsewhere are listed',
    fromSub.json.root === fs.realpathSync(repo) && !!entry(list(fromSub, 'uncommitted.untracked.files'), '日本 語.txt'),
    String(fromSub.json.root));
});

// --- 11. read-only, and the fail-soft error --------------------------------------
section('11. --scope never writes, and fails soft', function () {
  const repo = newRepo('read-only');
  write(repo, 'f.txt', 'same\n');
  const blob = Buffer.alloc(32, 0);
  write(repo, 'image.bin', blob);
  commitAll(repo, 'files');
  // Touch both files without changing them, so the index's stat data is stale.
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(repo, 'f.txt'), later, later);
  fs.utimesSync(path.join(repo, 'image.bin'), later, later);
  const index = path.join(repo, '.git', 'index');
  const before = fs.readFileSync(index);

  const o = scope(repo);
  check('--scope leaves .git/index byte-identical when files were only touched', fs.readFileSync(index).equals(before),
    'porcelain git diff refreshes and rewrites the index');
  check('a file that was only touched is not reported as unstaged, binary or not',
    sameList(list(o, 'uncommitted.unstaged.files'), []), JSON.stringify(list(o, 'uncommitted.unstaged.files')));

  const outside = path.join(TMP, 'not a repo');
  fs.mkdirSync(outside, { recursive: true });
  const e = scope(outside, undefined, { env: { GIT_CEILING_DIRECTORIES: TMP } });
  check('outside a git working tree: exit 0 and one JSON object with an error field',
    e.status === 0 && e.parsed && typeof e.json.error === 'string' && e.json.source === 'none', brief(e));
});

// --- 12. the newest plan's start commit comes first (#184) ---------------------
// A review typed with no range used to take the newest unpushed commits and never
// look at the plan. Now the newest plan's start commit wins while some commit
// after it is unpushed; once every one of them is on the remote the plan counts as
// shipped and the unpushed fallback runs, naming the plan's range to pass.
section('12. no argument: the newest plan\'s start commit (#184)', function () {
  const remote = bareRemote('plan remote');
  const repo = newRepo('plan-source');
  write(repo, 'base.txt', 'base\n');
  // plans/ is gitignored in a real project, so the plan file is never a commit
  // of its own and never blocks a checkout.
  write(repo, '.gitignore', 'plans/\n');
  const b = commitAll(repo, 'base');
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', '-q', '-u', 'origin', 'main']);
  const planFile = 'plans/PLAN-issue-9.md';
  function withStart(sha) {
    return '# Plan\n\n**Overall Progress:** `50%`\n**Start commit:** ' + sha + '\n\n## Tasks\n';
  }
  write(repo, planFile, withStart(b));
  write(repo, 'one.txt', lines(2));
  const u1 = commitAll(repo, 'one');
  write(repo, 'two.txt', lines(3));
  const u2 = commitAll(repo, 'two');

  const used = scope(repo);
  check('unpushed commits after the plan\'s start: source "plan", from the start to HEAD, never capped',
    used.status === 0 && used.json.source === 'plan' && dig(used.json, 'range.base') === b && dig(used.json, 'range.end') === u2 &&
    dig(used.json, 'range.commitCount') === 2 && dig(used.json, 'range.baseFrom') === 'plan' && dig(used.json, 'range.baseRef') === 'PLAN-issue-9.md' &&
    dig(used.json, 'range.endRef') === 'HEAD' && dig(used.json, 'range.capped') === false && dig(used.json, 'range.omitted') === 0,
    brief(used) + ' ' + JSON.stringify(used.json.range));
  check('the plan object names the file, the full start sha, its commits and the unpushed count',
    dig(used.json, 'plan.name') === 'PLAN-issue-9.md' && dig(used.json, 'plan.startCommit') === b && dig(used.json, 'plan.commits') === 2 &&
    dig(used.json, 'plan.unpushed') === 2 && dig(used.json, 'plan.reason') === undefined && used.json.message === null,
    JSON.stringify(used.json.plan));
  check('the plan\'s commits are named newest first and its files listed',
    sameList((list(used, 'range.commits') || []).map(function (c) { return c.sha; }), [u2, u1]) &&
    sameList(paths(list(used, 'range.files')), ['one.txt', 'two.txt']) && dig(used.json, 'totals.lines') === 5,
    JSON.stringify(used.json.range));
  const arg = scope(repo, u1 + '..HEAD');
  check('an argument range wins over the plan, and reports no plan',
    arg.json.source === 'argument' && dig(arg.json, 'range.commitCount') === 1 && arg.json.plan === null, brief(arg));

  git(repo, ['push', '-q', 'origin', 'main']);
  const shipped = scope(repo);
  check('every commit after the start pushed: source "unpushed" with no commits and plan.reason "plan-shipped"',
    shipped.json.source === 'unpushed' && dig(shipped.json, 'range.commitCount') === 0 && dig(shipped.json, 'plan.reason') === 'plan-shipped' &&
    dig(shipped.json, 'plan.commits') === 2 && dig(shipped.json, 'plan.startCommit') === b,
    brief(shipped) + ' ' + JSON.stringify(shipped.json.plan));
  check('the shipped plan\'s message names the range to pass and how many commits it holds',
    typeof shipped.json.message === 'string' && shipped.json.message.indexOf('/review ' + b.slice(0, 7) + '..HEAD') !== -1 &&
    /\b2 commits\b/.test(shipped.json.message) && shipped.json.message.indexOf('PLAN-issue-9.md') !== -1,
    String(shipped.json.message));

  write(repo, 'three.txt', 'three\n');
  const u3 = commitAll(repo, 'three');
  write(repo, planFile, withStart('0123456789abcdef0123456789abcdef01234567'));
  const missing = scope(repo);
  check('a start sha that names no commit falls through to unpushed with "plan-start-missing"',
    missing.json.source === 'unpushed' && dig(missing.json, 'range.commitCount') === 1 && dig(missing.json, 'plan.reason') === 'plan-start-missing' &&
    missing.json.message === null, brief(missing) + ' ' + JSON.stringify(missing.json.plan));

  git(repo, ['checkout', '-q', '-b', 'side', b]);
  write(repo, 'side.txt', 'side\n');
  const s1 = commitAll(repo, 'side');
  git(repo, ['checkout', '-q', 'main']);
  write(repo, planFile, withStart(s1));
  const notAncestor = scope(repo);
  check('a start that is not an ancestor of HEAD falls through with "plan-start-not-ancestor"',
    notAncestor.json.source === 'unpushed' && dig(notAncestor.json, 'plan.reason') === 'plan-start-not-ancestor' &&
    dig(notAncestor.json, 'range.commitCount') === 1, brief(notAncestor) + ' ' + JSON.stringify(notAncestor.json.plan));

  write(repo, planFile, withStart(u3));
  const atHead = scope(repo);
  check('a start equal to HEAD falls through with "plan-no-commits"',
    atHead.json.source === 'unpushed' && dig(atHead.json, 'plan.reason') === 'plan-no-commits' && dig(atHead.json, 'range.commitCount') === 1,
    brief(atHead) + ' ' + JSON.stringify(atHead.json.plan));

  // The newest plan by modification time has no start line; the older one does
  // and is not consulted.
  write(repo, planFile, withStart(b));
  const hourAgo = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(path.join(repo, planFile), hourAgo, hourAgo);
  write(repo, 'plans/PLAN-issue-10.md', '# Plan\n\n**Overall Progress:** `0%`\n\n## Tasks\n');
  const noStart = scope(repo);
  check('the newest plan without a start line falls through with "plan-no-start"; the older plan is not used',
    noStart.json.source === 'unpushed' && dig(noStart.json, 'plan.name') === 'PLAN-issue-10.md' && dig(noStart.json, 'plan.reason') === 'plan-no-start' &&
    dig(noStart.json, 'plan.startCommit') === null && dig(noStart.json, 'range.commitCount') === 1,
    brief(noStart) + ' ' + JSON.stringify(noStart.json.plan));
  fs.rmSync(path.join(repo, 'plans/PLAN-issue-10.md'));

  // A start before the remote's merge-base with one unpushed commit after it: the
  // whole span, uncapped, by decision (the unpushed source would have capped at 20).
  for (let i = 4; i <= 22; i++) {
    write(repo, 'n' + i + '.txt', i + '\n');
    commitAll(repo, 'n' + i);
  }
  git(repo, ['push', '-q', 'origin', 'main']);
  write(repo, 'last.txt', 'last\n');
  const last = commitAll(repo, 'last');
  const span = scope(repo);
  check('a start before the merge-base with one unpushed commit after it: the whole span, uncapped',
    span.json.source === 'plan' && dig(span.json, 'range.base') === b && dig(span.json, 'range.end') === last &&
    dig(span.json, 'range.commitCount') === 23 && dig(span.json, 'range.capped') === false && dig(span.json, 'range.omitted') === 0 &&
    dig(span.json, 'plan.commits') === 23 && dig(span.json, 'plan.unpushed') === 1,
    brief(span) + ' ' + JSON.stringify(span.json.plan));
  check('the span still lists only the newest 20 commits, like an argument range',
    (list(span, 'range.commits') || []).length === 20 && (list(span, 'range.commits') || [])[0].sha === last,
    String((list(span, 'range.commits') || []).length));

  git(repo, ['remote', 'remove', 'origin']);
  const noRemote = scope(repo);
  check('with no remote every commit after the start counts as unpushed: source "plan"',
    noRemote.json.source === 'plan' && dig(noRemote.json, 'range.commitCount') === 23 && dig(noRemote.json, 'plan.unpushed') === 23,
    brief(noRemote) + ' ' + JSON.stringify(noRemote.json.plan));

  const bare = newRepo('no-plans');
  write(bare, 'a.txt', 'a\n');
  commitAll(bare, 'one');
  const np = scope(bare);
  check('no plans folder: plan is null and the unpushed rules apply as before',
    np.json.plan === null && np.json.source === 'none' && np.json.reason === 'no-remote', brief(np));
});

console.log('');
if (failures.length === 0) {
  console.log(passed + ' checks passed.\n');
  process.exit(0);
}
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach(function (f) { console.log('  - ' + f); });
console.log('');
process.exit(1);
