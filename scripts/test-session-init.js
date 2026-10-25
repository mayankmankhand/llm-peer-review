#!/usr/bin/env node
'use strict';
//
// test-session-init.js - assertions for .claude/scripts/session-init.js: the plan
// header's start commit, the --scope mode a review reads to find what it covers
// (issue #182), the models object every output carries (issue #205), and the
// worktree test from a subfolder (issue #226).
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

  const KEYS = ['generatedAt', 'cwd', 'worktree', 'map', 'lessons', 'plans', 'newestPlan', 'models'];
  const keys = Object.keys(r.json);
  check('the no-argument output keeps exactly its top-level keys', sameList(keys.slice().sort(), KEYS.slice().sort()), keys.join(','));
  check('each plan entry is name, progress, status, startCommit and models',
    Object.keys(plan('PLAN-a.md')).join(',') === 'name,progress,status,startCommit,models', Object.keys(plan('PLAN-a.md')).join(','));
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
    typeof shipped.json.message === 'string' && shipped.json.message.indexOf(b.slice(0, 7) + '..HEAD') !== -1 && shipped.json.message.indexOf('/review') === -1 &&
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

  fs.mkdirSync(path.join(repo, 'sub'), { recursive: true });
  const fromSub = scope(repo, undefined, { cwd: path.join(repo, 'sub') });
  check('a run from a subfolder still finds the plan (review of #184, R7)',
    fromSub.json.source === 'plan' && dig(fromSub.json, 'plan.name') === noRemote.json.plan.name, brief(fromSub));

  const bare = newRepo('no-plans');
  write(bare, 'a.txt', 'a\n');
  commitAll(bare, 'one');
  const np = scope(bare);
  check('no plans folder: plan is null and the unpushed rules apply as before',
    np.json.plan === null && np.json.source === 'none' && np.json.reason === 'no-remote', brief(np));
});

// --- 13. the review's starting snapshot (#202) ----------------------------------
// /review used to measure "the diff of the fixes" from the pinned end, so work that
// was already uncommitted when the review began reached the fix verifier as if it
// were a fix. --scope now records uncommitted.baseline, the id `git stash create`
// prints, and the fix diff is `git diff <baseline>`. These cases pin what that id
// must do, and that making it changes nothing a person or a later command can see.
section('13. uncommitted.baseline: the starting snapshot (#202)', function () {
  function diffNames(repo, id) {
    return git(repo, ['diff', '--name-only', id]).split('\n').filter(Boolean);
  }
  function visible(repo, files) {
    return JSON.stringify({
      status: git(repo, ['status', '--porcelain', '--untracked-files=all']),
      stashes: git(repo, ['stash', 'list']),
      refs: git(repo, ['for-each-ref']),
      head: git(repo, ['rev-parse', 'HEAD']),
      files: files.map(function (f) { return fs.readFileSync(path.join(repo, f), 'utf-8'); }),
    });
  }

  // (a) a clean tree
  const repo = newRepo('baseline');
  write(repo, 'kept.txt', lines(3));
  write(repo, 'staged.txt', lines(3));
  write(repo, 'edited.txt', lines(3));
  commitAll(repo, 'start');
  const clean = scope(repo);
  check('a clean tree: baseline is null and there is no baselineError',
    clean.status === 0 && clean.parsed && dig(clean.json, 'uncommitted.baseline') === null &&
    !('baselineError' in (clean.json.uncommitted || {})), JSON.stringify(clean.json.uncommitted));

  // only an untracked file: still nothing tracked to snapshot
  write(repo, 'notes.txt', lines(2, 'note'));
  const onlyNew = scope(repo);
  check('only an untracked file: baseline is null and there is no baselineError',
    dig(onlyNew.json, 'uncommitted.baseline') === null && !('baselineError' in (onlyNew.json.uncommitted || {})),
    JSON.stringify(onlyNew.json.uncommitted));

  // (b) and (c) a dirty tree: one staged edit, one unstaged edit, one untracked file
  write(repo, 'staged.txt', lines(3) + 'staged before the review\n');
  git(repo, ['add', 'staged.txt']);
  write(repo, 'edited.txt', lines(3) + 'edited before the review\n');
  const watched = ['kept.txt', 'staged.txt', 'edited.txt', 'notes.txt'];
  const before = visible(repo, watched);
  const dirty = scope(repo);
  const id = dig(dirty.json, 'uncommitted.baseline');
  check('a dirty tree: baseline is a full commit id, with no baselineError',
    dirty.status === 0 && typeof id === 'string' && /^[0-9a-f]{40}$/.test(id) &&
    !('baselineError' in (dirty.json.uncommitted || {})), JSON.stringify(dirty.json.uncommitted));
  if (typeof id !== 'string') throw new Error('no baseline id, so the cases that diff against it cannot run');

  check('the call changes nothing visible: status, stash list, refs, HEAD and file contents are identical',
    visible(repo, watched) === before, 'before ' + before + ' after ' + visible(repo, watched));
  check('the id names a commit git can read', git(repo, ['cat-file', '-t', id]).trim() === 'commit');
  check('git diff <baseline> is empty right after the call', sameList(diffNames(repo, id), []), diffNames(repo, id).join(','));
  check('the snapshot holds the staged and the unstaged edit',
    git(repo, ['show', id + ':staged.txt']).indexOf('staged before the review') !== -1 &&
    git(repo, ['show', id + ':edited.txt']).indexOf('edited before the review') !== -1);

  // (d) the untracked file is recorded by the list, not by the snapshot
  check('an untracked file present at the start is still in the untracked list',
    sameList(paths(list(dirty, 'uncommitted.untracked.files')), ['notes.txt']),
    JSON.stringify(paths(list(dirty, 'uncommitted.untracked.files'))));
  check('staged and unstaged lists are reported beside the baseline as before',
    sameList(paths(list(dirty, 'uncommitted.staged.files')), ['staged.txt']) &&
    sameList(paths(list(dirty, 'uncommitted.unstaged.files')), ['edited.txt']), JSON.stringify(dirty.json.uncommitted));

  // (b) a later edit (the "fix") is all the diff shows, committed or not
  write(repo, 'kept.txt', lines(3) + 'the fix\n');
  check('after a later edit, git diff <baseline> shows only that file',
    sameList(diffNames(repo, id), ['kept.txt']), diffNames(repo, id).join(','));
  const fixDiff = git(repo, ['diff', id]);
  check('and only that edit: the work from before the review is not in the diff',
    fixDiff.indexOf('+the fix') !== -1 && fixDiff.indexOf('before the review') === -1, fixDiff);
  git(repo, ['add', 'kept.txt']);
  const when = clock + ' +0000';
  clock += 60;
  git(repo, ['commit', '-q', '-m', 'Fix it', '--', 'kept.txt'], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
  check('once that edit is COMMITTED, git diff <baseline> still shows only that file',
    sameList(diffNames(repo, id), ['kept.txt']), diffNames(repo, id).join(','));
  const unrelated = git(repo, ['diff', 'HEAD']);
  check('(while git diff HEAD, the old measure, now misses the fix and shows the earlier work)',
    unrelated.indexOf('+the fix') === -1 && unrelated.indexOf('before the review') !== -1, unrelated);

  // (e) unmerged paths: git stash create refuses, the scope still succeeds
  const merge = newRepo('baseline-unmerged');
  write(merge, 'f.txt', 'base\n');
  commitAll(merge, 'base');
  git(merge, ['checkout', '-q', '-b', 'other']);
  write(merge, 'f.txt', 'theirs\n');
  commitAll(merge, 'theirs');
  git(merge, ['checkout', '-q', 'main']);
  write(merge, 'f.txt', 'ours\n');
  commitAll(merge, 'ours');
  const m = spawnSync('git', ['merge', 'other'], { cwd: merge, env: ENV, encoding: 'utf-8' });
  check('(fixture) the merge stopped on a conflict', m.status !== 0 && /^UU f\.txt/m.test(git(merge, ['status', '--porcelain'])),
    'merge exit ' + m.status);
  const conflicted = fs.readFileSync(path.join(merge, 'f.txt'), 'utf-8');
  const u = scope(merge);
  const err = dig(u.json, 'uncommitted.baselineError');
  check('unmerged paths: exit 0, normal JSON, baseline null, and a one-line baselineError string',
    u.status === 0 && u.parsed && !('error' in u.json) && dig(u.json, 'uncommitted.baseline') === null &&
    typeof err === 'string' && err.length > 0 && err.indexOf('\n') === -1 && err.indexOf('git stash create') === 0,
    brief(u) + ' ' + JSON.stringify(u.json.uncommitted));
  check('unmerged paths: the rest of the scope is still reported',
    Array.isArray(list(u, 'uncommitted.staged.files')) && u.json.totals !== null && typeof u.json.totals === 'object',
    JSON.stringify(u.json.totals));
  check('unmerged paths: the conflict is left exactly as it was',
    fs.readFileSync(path.join(merge, 'f.txt'), 'utf-8') === conflicted && /^UU f\.txt/m.test(git(merge, ['status', '--porcelain'])));

  // a held index lock: stash create exits 1 and prints nothing; the scope still succeeds
  const locked = newRepo('baseline-locked');
  write(locked, 'f.txt', 'one\n');
  commitAll(locked, 'one');
  write(locked, 'f.txt', 'two\n');
  fs.writeFileSync(path.join(locked, '.git', 'index.lock'), '');
  const l = scope(locked);
  fs.rmSync(path.join(locked, '.git', 'index.lock'), { force: true });
  check('another git command holding the index lock: exit 0, baseline null, a baselineError string',
    l.status === 0 && l.parsed && dig(l.json, 'uncommitted.baseline') === null &&
    typeof dig(l.json, 'uncommitted.baselineError') === 'string' && sameList(paths(list(l, 'uncommitted.unstaged.files')), ['f.txt']),
    brief(l) + ' ' + JSON.stringify(l.json.uncommitted));
});

// --- 14. the model mode (#205) ------------------------------------------------
// Which model each helper runs on: a --mode flag (a command's "mode:" word) wins,
// then the newest plan's Models line while that plan is unfinished, then fit. Fit
// reads each moving role's model from the agent files beside the script, so these
// checks run a plugin-shaped copy (plugin/scripts/ beside plugin/agents/) whose
// agent files they control, instead of reading this repo's own roster.
section('14. the model mode: flag, then an unfinished plan, then fit (#205)', function () {
  const FINDERS = ['review-code-finder', 'review-security-finder', 'review-ux-finder', 'review-plan-finder',
    'review-commands-finder', 'review-deps-finder', 'review-browser-finder', 'review-copy-finder'];
  const JUDGES = ['audit-skeptic', 'fix-verifier', 'plan-critic', 'design-critic', 'design-comparer', 'decision-checker'];
  const plugin = path.join(TMP, 'plugin layout', 'plugin');
  const copy = path.join(plugin, 'scripts', 'session-init.js');
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.copyFileSync(SCRIPT, copy);
  function agent(name, modelLine) {
    write(plugin, 'agents/' + name + '.md', '---\nname: ' + name + '\ndescription: test agent\ntools: Read\n' + (modelLine === null ? '' : 'model: ' + modelLine + '\n') + 'effort: high\n---\n\nBody.\n');
  }
  // Fit's values come from these files: a sonnet finder, an opus finder, one that
  // inherits, one with no model line, one naming a full model id (not an alias).
  agent('review-code-finder', 'sonnet');
  agent('review-security-finder', 'opus');
  agent('review-ux-finder', 'inherit');
  agent('review-plan-finder', null);
  agent('review-commands-finder', 'claude-sonnet-5-5');
  agent('index-mapper', 'sonnet');
  for (const j of JUDGES) agent(j, 'inherit');
  // The extractor keeps its agent file's model in every mode (issue 221): pinned here so
  // the three mode checks below can tell a kept file model from "session".
  agent('correction-extractor', 'haiku');
  function models(repo, args) {
    const r = spawnSync(process.execPath, [copy].concat(args), { cwd: repo, env: ENV, encoding: 'utf-8' });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
    return { status: r.status, json: json || {}, m: (json && json.models) || {} };
  }

  const remote = bareRemote('models remote');
  const repo = newRepo('models');
  write(repo, 'base.txt', 'base\n');
  write(repo, '.gitignore', 'plans/\n');
  const b = commitAll(repo, 'base');
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', '-q', '-u', 'origin', 'main']);

  const none = models(repo, ['--models']);
  check('no flag and no plan: fit, from the default, built on opus',
    none.status === 0 && none.m.mode === 'fit' && none.m.source === 'default' && none.m.plan === null && none.m.buildModel === 'opus' && none.m.warning === undefined,
    JSON.stringify(none.m));
  check('fit reads each moving role from the agent file beside the script: an alias as written, anything else as "session"',
    none.m.perRole && none.m.perRole['review-code-finder'] === 'sonnet' && none.m.perRole['review-security-finder'] === 'opus' &&
    none.m.perRole['review-ux-finder'] === 'session' && none.m.perRole['review-plan-finder'] === 'session' &&
    none.m.perRole['review-commands-finder'] === 'session' && none.m.perRole['review-deps-finder'] === 'session' &&
    none.m.perRole['index-mapper'] === 'sonnet',
    JSON.stringify(none.m.perRole));
  check('the judges are "session" in fit', JUDGES.every(function (j) { return none.m.perRole[j] === 'session'; }), JSON.stringify(none.m.perRole));
  check('fit: the extractor reads its agent file\'s model', none.m.perRole['correction-extractor'] === 'haiku', JSON.stringify(none.m.perRole));
  check('--models prints only generatedAt, cwd and models', sameList(Object.keys(none.json).sort(), ['cwd', 'generatedAt', 'models']), JSON.stringify(Object.keys(none.json)));

  const best = models(repo, ['--models', '--mode', 'best']);
  check('--mode best: every finder and every judge on "session", built on the session model',
    best.m.mode === 'best' && best.m.source === 'argument' && best.m.buildModel === 'session' &&
    FINDERS.concat(JUDGES).every(function (r) { return best.m.perRole[r] === 'session'; }),
    JSON.stringify(best.m));
  check('--mode best: the extractor keeps its agent file\'s model', best.m.perRole['correction-extractor'] === 'haiku', JSON.stringify(best.m.perRole));
  // #208: best leaves the map helper on its agent file's model, exactly as fit reads it.
  check('--mode best: the map helper keeps its agent file\'s model, the same value fit gives it',
    best.m.perRole && best.m.perRole['index-mapper'] === 'sonnet' && best.m.perRole['index-mapper'] === none.m.perRole['index-mapper'],
    JSON.stringify(best.m.perRole));
  const mapperUnder = function (modelLine) {
    if (modelLine === undefined) fs.rmSync(path.join(plugin, 'agents', 'index-mapper.md'), { force: true });
    else agent('index-mapper', modelLine);
    return models(repo, ['--models', '--mode', 'best']).m.perRole || {};
  };
  const inheritBest = mapperUnder('inherit');
  const noLineBest = mapperUnder(null);
  const missingBest = mapperUnder(undefined);
  agent('index-mapper', 'sonnet');
  check('--mode best: a map helper file reading inherit, with no model line, or missing reads as "session"',
    inheritBest['index-mapper'] === 'session' && noLineBest['index-mapper'] === 'session' && missingBest['index-mapper'] === 'session',
    JSON.stringify([inheritBest['index-mapper'], noLineBest['index-mapper'], missingBest['index-mapper']]));
  const cheap = models(repo, ['--mode', 'cheap', '--models']);
  check('--mode cheap (before --models too): the finders and the mapper on sonnet, the judges still "session"',
    cheap.m.mode === 'cheap' && cheap.m.source === 'argument' && cheap.m.buildModel === 'opus' &&
    FINDERS.concat(['index-mapper']).every(function (r) { return cheap.m.perRole[r] === 'sonnet'; }) &&
    JUDGES.every(function (j) { return cheap.m.perRole[j] === 'session'; }),
    JSON.stringify(cheap.m));
  check('--mode cheap: the extractor keeps its agent file\'s model', cheap.m.perRole['correction-extractor'] === 'haiku', JSON.stringify(cheap.m.perRole));
  const typo = models(repo, ['--models', '--mode', 'cheep']);
  check('an unknown mode is ignored with a warning naming it', typo.m.mode === 'fit' && typo.m.source === 'default' && /"cheep" is not a mode/.test(typo.m.warning || ''), JSON.stringify(typo.m));
  const bare = models(repo, ['--models', '--mode']);
  check('--mode with no value is a warning, not a failure', bare.status === 0 && bare.m.mode === 'fit' && /--mode needs a value/.test(bare.m.warning || ''), JSON.stringify(bare.m));

  // The newest plan's Models line, while the plan is unfinished.
  const planFile = 'plans/PLAN-issue-77.md';
  function plan(modeWord, start, progress) {
    return '# Plan\n\n**Overall Progress:** `' + (progress || 0) + '%`\n' + (modeWord === null ? '' : '**Models:** ' + modeWord + '\n') +
      (start ? '**Start commit:** ' + start + '\n' : '') + '\n## Tasks\n';
  }
  write(repo, planFile, plan('cheap', null));
  const fresh = models(repo, ['--models']);
  check('a plan not begun (no Start commit): its mode, from the plan, naming the file',
    fresh.m.mode === 'cheap' && fresh.m.source === 'plan' && fresh.m.plan === 'PLAN-issue-77.md', JSON.stringify(fresh.m));
  check('a flag still wins over the plan', models(repo, ['--models', '--mode', 'best']).m.mode === 'best');
  write(repo, planFile, plan('cheap', b, 10));
  const begun = models(repo, ['--models']);
  check('begun with no commit after its start yet: the plan\'s mode still applies', begun.m.mode === 'cheap' && begun.m.source === 'plan', JSON.stringify(begun.m));
  write(repo, 'one.txt', 'one\n');
  commitAll(repo, 'one');
  write(repo, planFile, plan('cheap', b, 100));
  const finished = models(repo, ['--models']);
  check('at 100% with commits not yet pushed (the cycle\'s own review and docs): the plan\'s mode still applies',
    finished.m.mode === 'cheap' && finished.m.source === 'plan', JSON.stringify(finished.m));
  const viaScope = models(repo, ['--scope']);
  check('--scope carries the same models beside its range', viaScope.json.source === 'plan' && viaScope.m.mode === 'cheap' && viaScope.m.source === 'plan', JSON.stringify(viaScope.m));
  const viaStart = models(repo, []);
  check('the session-start object carries models, and its plans[] entry carries the Models word',
    viaStart.m.mode === 'cheap' && (viaStart.json.plans || []).some(function (p) { return p.name === 'PLAN-issue-77.md' && p.models === 'cheap'; }),
    JSON.stringify(viaStart.json.plans));
  git(repo, ['push', '-q', 'origin', 'main']);
  const shipped = models(repo, ['--models']);
  check('once every commit after the start is pushed, the plan has shipped and the mode lapses to fit',
    shipped.m.mode === 'fit' && shipped.m.source === 'default' && shipped.m.plan === null, JSON.stringify(shipped.m));

  write(repo, 'two.txt', 'two\n');
  commitAll(repo, 'two');
  write(repo, planFile, plan('turbo', null));
  const odd = models(repo, ['--models']);
  check('a Models line naming no mode is ignored with a warning', odd.m.mode === 'fit' && /names the mode "turbo"/.test(odd.m.warning || ''), JSON.stringify(odd.m));
  write(repo, planFile, plan('cheap', '0123456789abcdef0123456789abcdef01234567'));
  const stray = models(repo, ['--models']);
  check('a start commit that names no commit: the plan is not about this branch, so fit', stray.m.mode === 'fit' && stray.m.source === 'default', JSON.stringify(stray.m));

  // Only the newest plan counts: an older plan's line never applies.
  write(repo, planFile, plan('cheap', null));
  write(repo, 'plans/PLAN-issue-78.md', plan(null, null));
  const older = path.join(repo, planFile);
  const past = Date.now() / 1000 - 3600;
  fs.utimesSync(older, past, past);
  const newestWins = models(repo, ['--models']);
  check('a newer plan without a Models line hides an older plan\'s line', newestWins.m.mode === 'fit' && newestWins.m.source === 'default', JSON.stringify(newestWins.m));

  const scoped = models(repo, ['--scope', b + '..HEAD', '--mode', 'best']);
  const scoped2 = models(repo, ['--mode', 'best', '--scope', b + '..HEAD']);
  check('--mode beside --scope <range>, before or after it, leaves the range as typed',
    scoped.json.source === 'argument' && dig(scoped.json, 'range.base') === b && scoped.m.mode === 'best' &&
    scoped2.json.source === 'argument' && dig(scoped2.json, 'range.base') === b && scoped2.m.mode === 'best',
    brief(scoped) + ' ' + brief(scoped2));

  const outside = path.join(TMP, 'not a repo');
  fs.mkdirSync(outside, { recursive: true });
  const loose = models(outside, ['--models', '--mode', 'cheap']);
  check('outside a git checkout: still one JSON object, the flag still applies', loose.status === 0 && loose.m.mode === 'cheap' && loose.m.source === 'argument', JSON.stringify(loose.json));
});

// --- 15. scopeLine: the one line /review prints first (#208) ---------------------
// The script builds the line, so /review only prints it: every shape, each source's
// why-clause, the capped note, and the Models part, which the quality check's mode
// line pattern must find (MODE_RE in scripts/quality-check.js, copied below).
section('15. scopeLine: the line /review prints first (#208)', function () {
  const MODE_RE = /\bModels\b\W{0,6}(best|fit|cheap)\b/i;
  const seen = [];
  function line(o) {
    const l = typeof o.json.scopeLine === 'string' ? o.json.scopeLine : '';
    seen.push(l);
    return l;
  }
  const short = function (sha) { return sha.slice(0, 7); };

  // A range argument: one commit on a clean tree, then with uncommitted work.
  const repo = newRepo('line-argument');
  write(repo, 'a.txt', 'a\n');
  const c1 = commitAll(repo, 'one');
  write(repo, 'b.txt', 'b\n');
  const c2 = commitAll(repo, 'two');
  const one = line(scope(repo, c1 + '..HEAD'));
  check('a range argument: the count (one commit), the short range, the why, and the default mode',
    one === 'Reviewing 1 commit (`' + short(c1) + '..' + short(c2) + '`), the range passed in. Models: fit (the default).', one);
  write(repo, 'c.txt', 'c\n');
  const dirty = line(scope(repo, c1 + '..HEAD'));
  check('uncommitted work adds ", plus uncommitted work"', /, the range passed in, plus uncommitted work\. Models: fit \(the default\)\.$/.test(dirty), dirty);
  const worded = line(runScript(['--scope', c1 + '..HEAD', '--mode', 'cheap'], repo));
  check('a mode: word ends the line with that mode and where it came from', /\. Models: cheap \(from the mode: word\)\.$/.test(worded), worded);
  const typo = line(runScript(['--scope', c1 + '..HEAD', '--mode', 'cheep'], repo));
  check('a models warning follows the Models part', /\. Models: fit \(the default\)\. "cheep" is not a mode/.test(typo), typo);
  const bad = line(scope(repo, 'no-such-ref..HEAD'));
  check('a range argument that resolves to nothing says why it cannot be reviewed', /^That range cannot be reviewed: \S.*\. Models: fit/.test(bad), bad);
  const failed = line(runScript(['--scope', c1 + '..HEAD', 'extra'], repo));
  check('a failure says no commit range was checked, and that only uncommitted work is reviewed',
    /^No commit range was checked: \S.* Reviewing uncommitted work only\. Models: fit/.test(failed), failed);

  // No remote: uncommitted work only, with the message saying why there is no range.
  const lone = newRepo('line-no-remote');
  write(lone, 'a.txt', 'a\n');
  commitAll(lone, 'one');
  write(lone, 'b.txt', 'b\n');
  const solo = scope(lone);
  const soloLine = line(solo);
  check('no commits in range with uncommitted work: "uncommitted work only", then the message',
    soloLine === 'Reviewing uncommitted work only; no commits in range. ' + String(solo.json.message).trim().replace(/([^.!?])$/, '$1.') + ' Models: fit (the default).',
    soloLine);

  // No argument, an upstream: nothing, then unpushed commits, then a plan in each state.
  const remote = bareRemote('line remote');
  const up = newRepo('line-upstream');
  write(up, '.gitignore', 'plans/\n');
  const b = commitAll(up, 'base');
  git(up, ['remote', 'add', 'origin', remote]);
  git(up, ['push', '-q', '-u', 'origin', 'main']);
  const nothing = line(scope(up));
  check('no commits and nothing uncommitted: "Nothing to review", and no message to add',
    nothing === 'Nothing to review: no commits in range and no uncommitted changes. Models: fit (the default).', nothing);
  write(up, 'one.txt', 'one\n');
  commitAll(up, 'one');
  write(up, 'two.txt', 'two\n');
  const u2 = commitAll(up, 'two');
  const unpushed = line(scope(up));
  check('unpushed commits with no plan: "your unpushed commits; no plan names a start commit"',
    unpushed === 'Reviewing 2 commits (`' + short(b) + '..' + short(u2) + '`), your unpushed commits; no plan names a start commit. Models: fit (the default).', unpushed);

  const planFile = 'plans/PLAN-issue-9.md';
  const plan = function (start, modeWord) {
    return '# Plan\n\n**Overall Progress:** `50%`\n' + (modeWord ? '**Models:** ' + modeWord + '\n' : '') + (start ? '**Start commit:** ' + start + '\n' : '') + '\n## Tasks\n';
  };
  write(up, planFile, plan(b));
  const viaPlan = line(scope(up));
  check('the plan source: "from `<plan>`\'s start commit, M of them unpushed"',
    viaPlan === 'Reviewing 2 commits (`' + short(b) + '..' + short(u2) + '`), from `PLAN-issue-9.md`\'s start commit, 2 of them unpushed. Models: fit (the default).', viaPlan);
  write(up, planFile, plan(b, 'cheap'));
  const planMode = line(scope(up));
  check('a plan\'s Models line ends the line with "from <plan>"', /\. Models: cheap \(from PLAN-issue-9\.md\)\.$/.test(planMode), planMode);
  write(up, planFile, plan(null));
  const noStart = line(scope(up));
  check('a plan passed over is named, with the reason in words',
    /, your unpushed commits; `PLAN-issue-9\.md` was passed over because it has no start commit yet\. Models: fit/.test(noStart), noStart);
  write(up, planFile, plan('0123456789abcdef0123456789abcdef01234567'));
  const missing = line(scope(up));
  check('a start commit not in this repository reads as its own reason', /was passed over because its start commit is not in this repository\./.test(missing), missing);
  write(up, planFile, plan(b));
  git(up, ['push', '-q', 'origin', 'main']);
  const shipped = scope(up);
  const shippedLine = line(shipped);
  check('a shipped plan: "Nothing to review", then the message naming the range to pass',
    /^Nothing to review: no commits in range and no uncommitted changes\. The newest plan PLAN-issue-9\.md starts at [0-9a-f]{7} .*pass [0-9a-f]{7}\.\.HEAD as the review's range to cover them\. Models: fit \(the default\)\.$/.test(shippedLine),
    shippedLine);

  // More than 20 unpushed commits: the capped note, with the full base to pass.
  for (let i = 1; i <= 22; i++) {
    write(up, 'n' + i + '.txt', 'n' + i + '\n');
    commitAll(up, 'n' + i);
  }
  fs.rmSync(path.join(up, planFile), { force: true });
  const capped = scope(up);
  const cappedLine = line(capped);
  check('a capped range adds how many older commits were left out and the range that includes them',
    /^Reviewing 20 commits \(`[0-9a-f]{7}\.\.[0-9a-f]{7}`\), your unpushed commits; no plan names a start commit\. 2 older unpushed commits were left out; pass `[0-9a-f]{40}\.\.HEAD` as the review's range to include them\. Models: fit/.test(cappedLine) &&
    cappedLine.indexOf('pass `' + dig(capped.json, 'range.fullBase') + '..HEAD`') !== -1,
    cappedLine);
  // The plugin build copies scripts unchanged, so a command name in a line would
  // miss the plugin's tk: prefix (review of the #208 cycle, R1): name no command.
  check('no scope line names a slash command', seen.every(function (l) { return !/`\/[a-z]/.test(l); }),
    JSON.stringify(seen.filter(function (l) { return /`\/[a-z]/.test(l); })));

  check('every line is one line and carries a Models part the quality check finds',
    seen.length > 0 && seen.every(function (l) { return l.length > 0 && !/[\r\n]/.test(l) && MODE_RE.test(l); }),
    JSON.stringify(seen.filter(function (l) { return !l || /[\r\n]/.test(l) || !MODE_RE.test(l); })));
});

// --- 16. map.malformed: the finalize byte tests, run on the live map (#221) ---
// generate-index.js --finalize checks the temp map's bytes, first line and title
// and never looks at the live file again; the commands that read the map were
// left to judge "malformed" by eye. The script now runs those same three tests
// on the live map, so a command reads one boolean (triage spot G7).
section('16. map.malformed: the three finalize byte tests on the live map (#221)', function () {
  const repo = newRepo('map');
  write(repo, 'README.md', 'x\n');
  const head = commitAll(repo, 'init');
  const MAP = 'CODEBASE_MAP.md';
  const body = '\n## System Overview\n\nA throwaway repository with one file, kept here so the map has a module to describe ' +
    'and enough bytes to clear the size floor the finalize step applies to a freshly written map.\n\n' +
    '## Module Guide\n\n- README.md: the one file.\n';
  const valid = '<!-- Generated: 2026-01-01 -->\n<!-- Commit: ' + head + ' -->\n\n# Codebase Map\n' + body;
  const wrongFirst = '# Codebase Map\n<!-- Generated: 2026-01-01 -->\n' + body;
  const noTitle = '<!-- Generated: 2026-01-01 -->\n\n# Codebase map\n' + body;
  check('the fixtures that must pass the size test are over 200 bytes',
    Buffer.byteLength(valid) > 200 && Buffer.byteLength(wrongFirst) > 200 && Buffer.byteLength(noTitle) > 200,
    [valid, wrongFirst, noTitle].map(function (s) { return Buffer.byteLength(s); }).join(','));

  const none = runScript([], repo);
  check('no map: exists is false and malformed is false',
    dig(none.json, 'map.exists') === false && dig(none.json, 'map.malformed') === false, JSON.stringify(none.json.map));

  write(repo, MAP, valid);
  const ok = runScript([], repo);
  check('a valid map (over 200 bytes, the Generated first line, the title) is not malformed',
    dig(ok.json, 'map.exists') === true && dig(ok.json, 'map.malformed') === false, JSON.stringify(ok.json.map));
  check('the valid map still reports its commit and freshness beside the verdict',
    dig(ok.json, 'map.commit') === head && dig(ok.json, 'map.commitsBehind') === 0 && dig(ok.json, 'map.stale') === false,
    JSON.stringify(ok.json.map));

  write(repo, MAP, '<!-- Generated: 2026-01-01 -->\n# Codebase Map\n');
  const tiny = runScript([], repo);
  check('a file of 200 bytes or fewer is malformed, header and title or not',
    dig(tiny.json, 'map.exists') === true && dig(tiny.json, 'map.malformed') === true, JSON.stringify(tiny.json.map));

  write(repo, MAP, wrongFirst);
  const wf = runScript([], repo);
  check('a first line that is not the Generated header is malformed, whatever follows it',
    dig(wf.json, 'map.malformed') === true, JSON.stringify(wf.json.map));

  write(repo, MAP, noTitle);
  const nt = runScript([], repo);
  check('a map without the exact "# Codebase Map" line is malformed (the title test is exact, as in finalize)',
    dig(nt.json, 'map.malformed') === true, JSON.stringify(nt.json.map));

  // Finalize allows trailing spaces after the title and reads CRLF files; so
  // does the verdict, or the two would disagree on a map written on Windows.
  write(repo, MAP, valid.replace('# Codebase Map\n', '# Codebase Map  \n').replace(/\n/g, '\r\n'));
  const crlf = runScript([], repo);
  check('a CRLF map with trailing spaces after the title still passes',
    dig(crlf.json, 'map.malformed') === false, JSON.stringify(crlf.json.map));
});

section('17. worktree.isWorktree from a subfolder (#226)', function () {
  // From a subfolder of the main copy git prints --git-dir absolute and
  // --git-common-dir relative, so comparing the raw strings called the main copy
  // a worktree. Each case runs from the root and from a subfolder.
  const repo = newRepo('wt-main');
  write(repo, 'sub/deep/file.txt', 'x\n');
  commitAll(repo, 'init');
  const wt = path.join(TMP, 'wt-linked');
  git(repo, ['worktree', 'add', '-q', '-b', 'wt-branch', wt]);
  fs.mkdirSync(path.join(wt, 'sub'), { recursive: true });
  const at = function (cwd) { return runScript([], cwd).json.worktree || {}; };
  const sub = at(path.join(repo, 'sub', 'deep'));
  check('fixture: from the subfolder git prints the two dirs differently',
    typeof sub.gitDir === 'string' && typeof sub.commonDir === 'string' && sub.gitDir !== sub.commonDir, JSON.stringify(sub));
  check('the main copy is not a worktree at its root', at(repo).isWorktree === false, JSON.stringify(at(repo)));
  check('the main copy is not a worktree from a subfolder', sub.isWorktree === false, JSON.stringify(sub));
  check('a linked worktree is a worktree at its root', at(wt).isWorktree === true, JSON.stringify(at(wt)));
  check('a linked worktree is a worktree from a subfolder', at(path.join(wt, 'sub')).isWorktree === true, JSON.stringify(at(path.join(wt, 'sub'))));
});

section('250 issue-branch: worktree.issueBranch answers the branch-name check (#250)', function () {
  // /explore, /create-plan and /document asked `git rev-parse ... | grep -Eq ...; echo $?`,
  // which stops a default-mode session twice (the $? and the unrowed grep). The
  // script answers the same regex as a yes/no field instead.
  const repo = newRepo('issue-branch');
  write(repo, 'a.txt', 'a\n');
  commitAll(repo, 'init');
  const ib = function (cwd) { return dig(runScript([], cwd).json, 'worktree.issueBranch'); };
  check('250 issue-branch: false on main', ib(repo) === false, JSON.stringify(ib(repo)));
  git(repo, ['checkout', '-q', '-b', 'worktree-250-five-gaps']);
  check('250 issue-branch: true on worktree-250-five-gaps', ib(repo) === true, JSON.stringify(ib(repo)));
  git(repo, ['checkout', '-q', '-b', 'worktree-250']);
  check('250 issue-branch: false on worktree-250, which has no label', ib(repo) === false, JSON.stringify(ib(repo)));
  git(repo, ['checkout', '-q', '--detach']);
  check('250 issue-branch: false on a detached HEAD', ib(repo) === false, JSON.stringify(ib(repo)));
  const wt = path.join(TMP, 'issue-branch-linked');
  git(repo, ['worktree', 'add', '-q', '-b', 'worktree-7-linked-copy', wt]);
  check('250 issue-branch: true in a linked worktree on worktree-7-linked-copy', ib(wt) === true, JSON.stringify(ib(wt)));
  const plain = path.join(TMP, 'issue-branch-no-git');
  fs.mkdirSync(plain, { recursive: true });
  check('250 issue-branch: false outside a git working tree', ib(plain) === false, JSON.stringify(ib(plain)));
});

section('250 scope out: --scope --out saves the scope itself, only under reports/receipts/ (#250)', function () {
  // /review saved its scope with a `>` redirect, which asks in default mode even
  // when the script's own row allows it. --out writes the file from the script.
  // Because the session-init rows allow any arguments, --out must never write
  // anywhere else: not outside reports/receipts/, not through a symlink.
  const repo = newRepo('scope-out');
  write(repo, 'a.txt', 'a\n');
  const c1 = commitAll(repo, 'one');
  write(repo, 'b.txt', 'b\n');
  commitAll(repo, 'two');
  write(repo, 'c.txt', 'uncommitted\n');
  const outside = path.join(TMP, 'scope-out-outside');
  fs.mkdirSync(outside, { recursive: true });
  const exists = function (p) { try { fs.lstatSync(p); return true; } catch (e) { return false; } };
  const one = function (x) { return String(x).replace(/\s+/g, ' ').slice(0, 160); };
  const readJson = function (p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };

  const r = runScript(['--scope', c1 + '..HEAD', '--out', 'reports/receipts/t/scope.json'], repo);
  const saved = readJson(path.join(repo, 'reports', 'receipts', 't', 'scope.json'));
  check('250 scope out: the full scope is written, its folders made',
    saved !== null && typeof saved.scopeLine === 'string' && Array.isArray(dig(saved, 'range.files')) && Array.isArray(dig(saved, 'uncommitted.untracked.files')),
    one(JSON.stringify(saved)));
  check('250 scope out: the printed object names the file and carries the key fields',
    r.json.savedTo === 'reports/receipts/t/scope.json' && saved !== null && r.json.scopeLine === saved.scopeLine &&
      dig(r.json, 'range.base') === dig(saved, 'range.base') && dig(r.json, 'range.end') === dig(saved, 'range.end') && r.json.totals !== undefined,
    one(r.stdout));
  check('250 scope out: the printed object leaves out every file and commit list',
    r.parsed && !/"(files|commits)":/.test(r.stdout), one(r.stdout));
  const moved = runScript(['--out', 'reports/receipts/t2/scope.json', '--scope'], repo);
  check('250 scope out: --out may come before --scope', moved.json.savedTo === 'reports/receipts/t2/scope.json' && exists(path.join(repo, 'reports', 'receipts', 't2', 'scope.json')), one(moved.stdout));

  const refused = function (label, out, cwd, mustNotExist) {
    const x = runScript(['--scope', '--out', out], cwd || repo);
    check('250 scope out: refused, ' + label,
      typeof x.json.outError === 'string' && typeof x.json.scopeLine === 'string' && x.json.savedTo === undefined && !exists(mustNotExist),
      one(x.stdout));
  };
  refused('a path outside reports/receipts/ (../x.json)', '../x.json', repo, path.join(TMP, 'x.json'));
  refused('an absolute path elsewhere', path.join(outside, 'abs.json'), repo, path.join(outside, 'abs.json'));
  refused('a name without .json', 'reports/receipts/t/scope.txt', repo, path.join(repo, 'reports', 'receipts', 't', 'scope.txt'));
  fs.mkdirSync(path.join(repo, 'reports', 'receipts'), { recursive: true });
  fs.symlinkSync(outside, path.join(repo, 'reports', 'receipts', 'link'));
  refused('a symlinked folder inside reports/receipts/ that leads outside', 'reports/receipts/link/scope.json', repo, path.join(outside, 'scope.json'));
  fs.mkdirSync(path.join(repo, 'reports', 'receipts', 's'), { recursive: true });
  const victim = path.join(outside, 'victim.json');
  fs.writeFileSync(victim, 'keep\n');
  fs.symlinkSync(victim, path.join(repo, 'reports', 'receipts', 's', 'scope.json'));
  const v = runScript(['--scope', '--out', 'reports/receipts/s/scope.json'], repo);
  check('250 scope out: refused, an existing scope.json that is a symlink to a file outside, which is left unchanged',
    typeof v.json.outError === 'string' && fs.readFileSync(victim, 'utf8') === 'keep\n', one(v.stdout));

  const linked = newRepo('scope-out-linked-receipts');
  write(linked, 'a.txt', 'a\n');
  commitAll(linked, 'one');
  const away = path.join(TMP, 'scope-out-away');
  fs.mkdirSync(away, { recursive: true });
  fs.mkdirSync(path.join(linked, 'reports'), { recursive: true });
  fs.symlinkSync(away, path.join(linked, 'reports', 'receipts'));
  refused('reports/receipts itself a symlink to outside, with no folder made there', 'reports/receipts/t/scope.json', linked, path.join(away, 't'));

  const lone = runScript(['--out', 'reports/receipts/lone/scope.json'], repo);
  check('250 scope out: --out without --scope is the one-object error, and writes nothing',
    typeof lone.json.error === 'string' && /--out/.test(lone.json.error) && !exists(path.join(repo, 'reports', 'receipts', 'lone')), one(lone.stdout));
  const bare = runScript(['--scope', '--out'], repo);
  check('250 scope out: --out with no path is refused, and the scope still prints',
    typeof bare.json.outError === 'string' && typeof bare.json.scopeLine === 'string', one(bare.stdout));
});

section('The 16,000-character budget holds as a total (review R13)', function () {
  // Each part under its own 8 KB cap can still sum past the budget: an inline
  // LESSONS.md and a long map overview together. The total is measured, and the
  // output shrinks in a fixed order until it fits.
  const repo = newRepo('budget-total');
  let lessons = '# Lessons Learned (Index)\n\n';
  while (Buffer.byteLength(lessons) < 7900) lessons += '- **A one-line lesson with "quotes" and a path like src/a/b.js, written the long way.**\n';
  write(repo, 'LESSONS.md', lessons);
  let overview = '';
  while (Buffer.byteLength(overview) < 7900) overview += 'The system reads its plans and lessons at startup and hands commands one JSON object to act on.\n';
  write(repo, 'CODEBASE_MAP.md', '<!-- Generated: 2026-10-13 | Commit: abc1234 -->\n# Codebase Map\n\n## System Overview\n\n' + overview + '\n## Module Guide\n\n- x\n');
  for (let i = 1; i <= 50; i++) write(repo, 'plans/PLAN-issue-' + (300 + i) + '.md', '# Plan ' + i + '\n\n**Overall Progress:** `100%`\n**Models:** fit\n');
  commitAll(repo, 'init');
  const out = runScript([], repo);
  check('output parses', out.parsed, out.stderr.slice(0, 200));
  check('stdout stays under 16,000 characters when lessons and overview are each just under 8 KB', out.stdout.length < 16000, 'length ' + out.stdout.length);
  const L = out.json.lessons || {};
  check('the budget turns the inline lessons into a handle first, and the note says why',
    L.content === undefined && L.bytes === Buffer.byteLength(lessons) && typeof L.head === 'string' && /size budget/.test(L.note || ''), JSON.stringify({ content: typeof L.content, bytes: L.bytes, note: L.note }));
  const cover = rangeCoverage(lessons, L.ranges);
  check('253 ranges: the size-budget handle carries ranges that cover the whole file in order', cover.ok, cover.why);
});

// #253: how a lessons handle's ranges cover the file. They must start at line 1, run
// in order with no gap or overlap, end on the last line, and hold 28,500 bytes or
// fewer each, except a single line over that, which gets a range of its own.
function rangeCoverage(text, ranges) {
  const lines = text.split(/(?<=\n)/);
  if (!Array.isArray(ranges) || ranges.length === 0) return { ok: false, why: 'ranges ' + JSON.stringify(ranges) };
  let next = 1;
  for (const r of ranges) {
    if (r.from !== next || !(r.to >= r.from)) return { ok: false, why: 'range ' + JSON.stringify(r) + ' should start at line ' + next };
    const bytes = Buffer.byteLength(lines.slice(r.from - 1, r.to).join(''));
    if (bytes > 28500 && r.to !== r.from) return { ok: false, why: 'range ' + JSON.stringify(r) + ' holds ' + bytes + ' bytes' };
    next = r.to + 1;
  }
  if (next !== lines.length + 1) return { ok: false, why: 'ranges end on line ' + (next - 1) + ' of ' + lines.length };
  return { ok: true, why: JSON.stringify(ranges) };
}

section('A lessons handle lists every line to read (#253)', function () {
  // One line over 28,500 bytes cannot be split at a line end, so it is read alone.
  const repo = newRepo('ranges-long-line');
  const lessons = '# Lessons\n\n- **short**\n' + '- **' + 'x'.repeat(30000) + '**\n' + '- **after**\n';
  write(repo, 'LESSONS.md', lessons);
  commitAll(repo, 'init');
  const out = runScript([], repo);
  const L = (out.json && out.json.lessons) || {};
  const cover = rangeCoverage(lessons, L.ranges);
  check('253 ranges: a single line over 28,500 bytes gets a range of its own', cover.ok && (L.ranges || []).some(r => r.from === 4 && r.to === 4), cover.why);
});

section('Output fits under the host\'s cut (harness research, P6-C1)', function () {
  // Claude Code replaces a Bash result over about 30 KB with a 2 KB preview, so a
  // command that reads this script's stdout loses everything past the preview. The
  // budget is half that cut, and the fields a command acts on come first.
  const repo = newRepo('budget');
  let lessons = '# Lessons Learned (Index)\n\n## What I Learned\n\n';
  for (let i = 1; i <= 400; i++) lessons += '- **Lesson ' + i + ': a one-line takeaway written the way the real index writes them.**\n';
  write(repo, 'LESSONS.md', lessons);
  write(repo, 'LESSONS-detail.md', 'detail\n');
  for (let i = 1; i <= 80; i++) {
    write(repo, 'plans/PLAN-issue-' + (100 + i) + '.md', '# Plan ' + i + '\n\n**Overall Progress:** `' + (i % 3 === 0 ? 50 : 100) + '%`\n**Models:** fit\n\n## Tasks\n- [x] 🟩 **Step 1: x**\n');
    const when = new Date((clock + i * 60) * 1000);
    fs.utimesSync(path.join(repo, 'plans', 'PLAN-issue-' + (100 + i) + '.md'), when, when);
  }
  const base = commitAll(repo, 'init');
  for (let i = 1; i <= 260; i++) write(repo, 'src/module-' + i + '/file-with-a-long-enough-name-' + i + '.js', 'export const x' + i + ' = ' + i + ';\n');
  commitAll(repo, 'add 260 files');
  write(repo, 'src/module-1/uncommitted.js', 'pending\n');
  write(repo, 'LESSONS-detail.md', 'detail, edited\n'); // a tracked change, so the snapshot is made

  const start = runScript([], repo);
  check('default output parses', start.parsed, start.stderr.slice(0, 200));
  check('default stdout is under 16,000 characters with 80 plans and a 400-line LESSONS.md', start.stdout.length < 16000, 'length ' + start.stdout.length);
  const at = (key) => start.stdout.indexOf('"' + key + '"');
  check('newestPlan and models come before lessons and plans', at('newestPlan') > -1 && at('models') > -1 && at('newestPlan') < at('lessons') && at('models') < at('lessons') && at('models') < at('plans'),
    'offsets newestPlan ' + at('newestPlan') + ', models ' + at('models') + ', lessons ' + at('lessons') + ', plans ' + at('plans'));
  const L = start.json.lessons || {};
  check('a LESSONS.md over 8 KB becomes a handle: path, bytes, lines and head, no content',
    L.exists === true && L.path === 'LESSONS.md' && L.content === undefined && L.bytes === Buffer.byteLength(lessons) && L.lines === 404 && typeof L.head === 'string' && lessons.startsWith(L.head) && L.head.length <= 1500 && L.head.endsWith('\n'),
    JSON.stringify({ path: L.path, bytes: L.bytes, lines: L.lines, head: (L.head || '').length, content: typeof L.content }));
  // #253: the 404-line fixture is about 33.5 KB, so it takes two reads.
  const cover = rangeCoverage(lessons, L.ranges);
  check('253 ranges: the handle\'s ranges cover lines 1 to 404 in order, each 28,500 bytes or fewer, in at least 2 reads',
    cover.ok && L.ranges.length >= 2 && L.ranges[L.ranges.length - 1].to === 404, cover.why);
  check('253 ranges: the note says to read every range with the Read tool', /Read tool/.test(L.note || '') && /ranges/.test(L.note || ''), String(L.note));
  const plans = start.json.plans || [];
  check('the newest 10 plans keep full entries, the next 40 keep names, the rest are counted',
    plans.length === 50 && plans.slice(0, 10).every((x) => typeof x.progress === 'number' && typeof x.status === 'string') && plans.slice(10).every((x) => Object.keys(x).join() === 'name') && start.json.plansOmitted === 30 && plans[0].name === 'PLAN-issue-180.md',
    'count ' + plans.length + ', omitted ' + start.json.plansOmitted + ', first ' + (plans[0] && plans[0].name));
  check('newestPlan still names the newest plan', start.json.newestPlan === 'PLAN-issue-180.md', String(start.json.newestPlan));

  const sc = scope(repo, base + '..HEAD');
  const head = sc.stdout.slice(0, 2000);
  check('--scope output parses with a 260-file range', sc.parsed && sc.json.range && sc.json.range.files && sc.json.range.files.length === 260, sc.stderr.slice(0, 200));
  check('scopeLine sits inside the first 2,000 bytes of --scope', head.indexOf('"scopeLine"') > -1, 'scopeLine at ' + sc.stdout.indexOf('"scopeLine"'));
  check('uncommitted.baseline sits inside the first 2,000 bytes of --scope', head.indexOf('"baseline"') > -1 && sc.json.uncommitted && typeof sc.json.uncommitted.baseline === 'string',
    'baseline at ' + sc.stdout.indexOf('"baseline"'));
  const rangeAt = sc.stdout.indexOf('"range"');
  const rangeFiles = sc.stdout.indexOf('"files"', rangeAt);
  check('the range\'s base and end sit inside the first 2,000 bytes, its file list after them',
    rangeAt > -1 && head.indexOf('"base"', rangeAt) > -1 && head.indexOf('"end"', rangeAt) > -1 && rangeFiles > sc.stdout.indexOf('"end"', rangeAt),
    'range ' + rangeAt + ', base ' + sc.stdout.indexOf('"base"', rangeAt) + ', end ' + sc.stdout.indexOf('"end"', rangeAt) + ', files ' + rangeFiles);
  const small = newRepo('budget-small');
  write(small, 'LESSONS.md', '# Lessons\n\n- **one**\n');
  commitAll(small, 'init');
  const s2 = runScript([], small);
  check('a small LESSONS.md still comes back whole as content', s2.json.lessons && s2.json.lessons.content === '# Lessons\n\n- **one**\n', JSON.stringify(s2.json.lessons));
  check('a short map overview comes back whole, with no cut note', s2.json.map && s2.json.map.exists === false, JSON.stringify(s2.json.map));

  // The map's System Overview is the other field that carries a file's text.
  const big = newRepo('budget-map');
  write(big, 'README.md', 'x\n');
  const bigHead = commitAll(big, 'init');
  let overview = '';
  for (let i = 1; i <= 120; i++) overview += 'Overview line ' + i + ' describes one part of a large system in a sentence of ordinary length.\n';
  write(big, 'CODEBASE_MAP.md', '<!-- Generated: 2026-01-01 -->\n<!-- Commit: ' + bigHead + ' -->\n\n# Codebase Map\n\n## System Overview\n\n' + overview + '\n## Module Guide\n\n- README.md: the one file.\n');
  const m = runScript([], big);
  const mo = (m.json.map || {}).overview || '';
  check('a map overview over 8 KB is cut to its opening, at a line end, with one sentence saying so',
    Buffer.byteLength(overview) > 8192 && mo.length <= 1500 && overview.startsWith(mo) && typeof m.json.map.overviewCut === 'string' && /CODEBASE_MAP\.md/.test(m.json.map.overviewCut),
    'overview ' + mo.length + ' chars, overviewCut ' + JSON.stringify(m.json.map.overviewCut));
  check('the cut map is still sound and fresh', m.json.map.malformed === false && m.json.map.commitsBehind === 0, JSON.stringify(m.json.map).slice(0, 200));
});

// --- 265: where /document's cycle window starts -------------------------------------
// A fresh worktree has no cycle marker of its own, and /document's fallback after
// it (the last merged PR) reached 59 commits back. --cycle-start tries the working
// copy's marker, then the newest plan's Start commit, then the main copy's marker,
// each only when HEAD contains it.
section('265 cycle-start: the working copy\'s marker, the newest plan, the main copy\'s marker', function () {
  const repo = newRepo('cycle-main');
  write(repo, '.gitignore', 'plans/PLAN-*.md\nartifacts/html/\n.claude/worktrees/\n');
  write(repo, 'a.txt', 'a\n');
  const c1 = commitAll(repo, 'one');
  write(repo, 'a.txt', 'a\nb\n');
  const c2 = commitAll(repo, 'two');
  write(repo, 'artifacts/html/.last-cycle', c1 + '\n');
  const wt = path.join(repo, '.claude', 'worktrees', 'w1');
  git(repo, ['worktree', 'add', '-q', '-b', 'feat', wt]);
  write(wt, 'b.txt', 'b\n');
  commitAll(wt, 'three');
  const start = function (cwd) { return runScript(['--cycle-start'], cwd).json; };
  // A plan in the worktree, as /execute leaves it.
  write(wt, 'plans/PLAN-feat.md', '# Feat\n\n**Overall Progress:** `0%`\n**Start commit:** ' + c2 + '\n**Models:** fit\n');
  const a = start(wt);
  check('cycle-start: a worktree with no marker starts at the newest plan\'s Start commit',
    a.start === c2 && a.source === 'plan' && a.plan === 'PLAN-feat.md', JSON.stringify(a));
  fs.rmSync(path.join(wt, 'plans'), { recursive: true, force: true });
  const b = start(wt);
  check('cycle-start: with no plan, a worktree starts at the main copy\'s marker when HEAD contains it',
    b.start === c1 && b.source === 'main-marker' && b.plan === null, JSON.stringify(b));
  const m = start(repo);
  check('cycle-start: the main copy reads its own marker', m.start === c1 && m.source === 'marker', JSON.stringify(m));
  // A marker HEAD does not contain: a commit made on another branch.
  git(repo, ['checkout', '-q', '-b', 'side', c1]);
  write(repo, 'side.txt', 's\n');
  const side = commitAll(repo, 'side');
  git(repo, ['checkout', '-q', 'main']);
  write(wt, 'artifacts/html/.last-cycle', side + '\n');
  const c = start(wt);
  check('cycle-start: a marker HEAD does not contain is passed over', c.start === c1 && c.source === 'main-marker', JSON.stringify(c));
  write(repo, 'artifacts/html/.last-cycle', side + '\n');
  write(wt, 'artifacts/html/.last-cycle', '--not-a-sha\n');
  const d = start(wt);
  check('cycle-start: nothing usable prints a null start', d.start === null && d.source === null && runScript(['--cycle-start'], wt).status === 0, JSON.stringify(d));
});

// --- 265: the lessons check /document runs, without redirects -------------------------
section('265 lessons: duplicated leads and leads with no write-up', function () {
  const repo = newRepo('lessons-check');
  write(repo, 'LESSONS.md', '# Lessons\n\n- **Alpha lead.**\n- **Beta lead.**\n- **Alpha lead.**\n- **Gamma lead.**\n');
  write(repo, 'LESSONS-detail.md', '# Detail\n\n- **Alpha lead.** The write-up.\n- **Beta lead.** Another.\n');
  commitAll(repo, 'init');
  const a = runScript(['--lessons'], repo).json;
  check('lessons: a lead listed twice and a lead with no write-up are both reported',
    JSON.stringify(a.duplicates) === '["Alpha lead."]' && JSON.stringify(a.noWriteUp) === '["Gamma lead."]', JSON.stringify(a));
  write(repo, 'LESSONS.md', '# Lessons\n\n- **Alpha lead.**\n- **Beta lead.**\n');
  const b = runScript(['--lessons'], repo).json;
  check('lessons: clean files print two empty lists',
    Array.isArray(b.duplicates) && b.duplicates.length === 0 && Array.isArray(b.noWriteUp) && b.noWriteUp.length === 0, JSON.stringify(b));
  // A lone ** on an earlier line (a glob) must not pair with the next line's lead.
  write(repo, 'LESSONS-detail.md', '# Detail\n\nUse a glob such as `scripts/**` here.\n\n- **Alpha lead.** The write-up.\n- **Beta lead.** Another.\n');
  const lone = runScript(['--lessons'], repo).json;
  check('lessons: a bold span never runs across lines, as grep reads it',
    Array.isArray(lone.noWriteUp) && lone.noWriteUp.length === 0, JSON.stringify(lone));
  fs.rmSync(path.join(repo, 'LESSONS-detail.md'));
  const c = runScript(['--lessons'], repo).json;
  check('lessons: with no detail file every lead has no write-up', JSON.stringify(c.noWriteUp) === '["Alpha lead.","Beta lead."]', JSON.stringify(c));
});

// --- 272. the chain check: M14's countable gates, decided from files -------------
// M14's transitions were judged from chat by each stage. --chain <stage> reads
// what is on disk (the closing summary, the plan and its tally, the report's
// digest and the ledger) and prints pass with the handoff, or the condition
// that failed. A shapeless input is refused with bad_shape, never passed.
section('272. --chain <stage>: the countable part of M14', function () {
  const repo = newRepo('chain');
  write(repo, '.gitignore', 'plans/\nreports/\n');
  write(repo, 'a.txt', 'a\n');
  write(repo, 'c.txt', 'c\n');
  const base = commitAll(repo, 'base');
  const plan = function (progress, start, steps) {
    return '# Plan\n\n**Overall Progress:** `' + progress + '%`\n**Start commit:** ' + start + '\n**Models:** fit\n\n## Tasks\n\n' + steps;
  };
  const noTargetSteps = '- [x] 🟩 **Step 1: One** `[sequential]` → delivers: a\n  - [x] 🟩 Do it\n  - Check: no target - a config step\n\n' +
    '- [x] 🟩 **Step 2: Two** `[sequential]` → depends on: Step 1\n  - [x] 🟩 Do it\n  - Check: no target - a config step\n';
  write(repo, 'plans/PLAN-issue-5.md', plan(100, base, noTargetSteps));
  write(repo, 'a.txt', 'a changed\n');
  commitAll(repo, 'one');
  write(repo, 'b.txt', 'b\n');
  const tip = commitAll(repo, 'two');
  const failed = function (o) { return Array.isArray(o.json.failed) ? o.json.failed : []; };
  const notes = function (o) { return Array.isArray(o.json.notes) ? o.json.notes : []; };
  const has = function (o, condition, re) { return failed(o).some(function (f) { return f.condition === condition && re.test(String(f.detail)); }); };

  const ex = runScript(['--chain', 'execute'], repo);
  check('--chain execute passes a finished plan and prints its range',
    ex.status === 0 && ex.json.stage === 'execute' && ex.json.pass === true && dig(ex.json, 'handoff.range') === base + '..HEAD' &&
    dig(ex.json, 'handoff.plan') === 'PLAN-issue-5.md' && dig(ex.json, 'handoff.start') === base && dig(ex.json, 'handoff.head') === tip,
    brief(ex) + JSON.stringify(ex.json.failed) + JSON.stringify(ex.json.handoff));
  write(repo, 'plans/PLAN-issue-5.md', plan(60, base, noTargetSteps));
  const unfinished = runScript(['--chain', 'execute'], repo);
  const targetSteps = '- [x] 🟩 **Step 1: One** `[sequential]` → delivers: a\n  - [x] 🟩 Do it\n  - Check target `t1`: `grep -c changed a.txt` - before `{"match": "^0"}` - after `{"match": "^1"}`\n';
  write(repo, 'plans/PLAN-issue-6.md', plan(100, base, targetSteps));
  const unproved = runScript(['--chain', 'execute', '--plan', 'plans/PLAN-issue-6.md'], repo);
  check('--chain execute fails an unfinished plan and names the step',
    unfinished.status === 0 && unfinished.json.pass === false && has(unfinished, 'progress', /60/) &&
    unproved.status === 0 && unproved.json.pass === false && has(unproved, 'steps', /step 1\b.*unproved/i),
    brief(unfinished) + JSON.stringify(unfinished.json.failed) + ' | ' + JSON.stringify(unproved.json.failed));
  fs.rmSync(path.join(repo, 'plans', 'PLAN-issue-6.md'));
  write(repo, 'plans/PLAN-issue-5.md', plan(100, base, noTargetSteps));
  write(repo, 'a.txt', 'a changed again\n');
  const dirtyPlan = runScript(['--chain', 'execute'], repo);
  check('--chain execute fails when a file the plan committed is modified again',
    dirtyPlan.json.pass === false && has(dirtyPlan, 'uncommitted', /a\.txt/), JSON.stringify(dirtyPlan.json.failed));
  write(repo, 'a.txt', 'a changed\n');
  write(repo, 'c.txt', 'c edited by the user\n');
  const dirtyOther = runScript(['--chain', 'execute'], repo);
  check('a modified file the plan never committed is a note, not a fail',
    dirtyOther.json.pass === true && notes(dirtyOther).some(function (n) { return /c\.txt/.test(n); }), JSON.stringify(dirtyOther.json));
  write(repo, 'c.txt', 'c\n');
  write(repo, 'plans/PLAN-issue-7.md', '# Plan\n\n**Start commit:** ' + base + '\n\n## Tasks\n\n' + noTargetSteps);
  const noProgress = runScript(['--chain', 'execute', '--plan', 'plans/PLAN-issue-7.md'], repo);
  check('--chain execute refuses a plan with no progress line',
    noProgress.status === 1 && noProgress.json.error === 'bad_shape' && /progress/i.test(String(noProgress.json.detail)), brief(noProgress) + JSON.stringify(noProgress.json));
  fs.rmSync(path.join(repo, 'plans', 'PLAN-issue-7.md'));

  // review: the report's digest and the ledger
  const t = function (m) { return '2026-10-24T10:0' + m + ':00.000Z'; };
  const ledgerOf = function (round, verdict, checkpointAt) {
    return {
      calls: 1,
      findings: { R1: { key: 'a.txt:k', path: 'judgment', round: round, verdicts: [{ round: round, verdict: verdict, source: 'verifier', from: 'x', at: t(1) }], rechecks: {} } },
      checkpoints: checkpointAt ? [{ sha: tip, at: checkpointAt, call: 1, fixed: ['R1'], notFixed: [], dirty: 1 }] : [],
      lastGreen: checkpointAt ? tip : null,
    };
  };
  const report = function (digest) { return '# Review\n\n## Findings\n\n- R1 something\n\n## Digest\n\n' + digest; };
  write(repo, 'reports/review-settled.md', report('- R1: FIXED - the grep is empty now\n- R2, R3: FIXED in round 2 (prose)\n- R4: OPEN, needs the owner - a decision\n'));
  write(repo, 'reports/receipts/x/ledger.json', JSON.stringify(ledgerOf(1, 'FIXED', t(2))));
  const settled = runScript(['--chain', 'review', '--report', 'reports/review-settled.md', '--ledger', 'reports/receipts/x/ledger.json'], repo);
  check('--chain review passes a settled digest and ledger',
    settled.status === 0 && settled.json.stage === 'review' && settled.json.pass === true && dig(settled.json, 'handoff.lastGreen') === tip &&
    notes(settled).some(function (n) { return /uncommitted/.test(n); }), brief(settled) + JSON.stringify(settled.json));
  write(repo, 'reports/review-paged.md', report('- R1: FIXED - ok\n- R2: PAGED - needs the owner\n'));
  const paged = runScript(['--chain', 'review', '--report', 'reports/review-paged.md'], repo);
  check('--chain review fails on a PAGED line', paged.json.pass === false && has(paged, 'digest', /R2.*PAGED/), JSON.stringify(paged.json.failed));
  write(repo, 'reports/review-notfixed.md', report('- R1: NOT FIXED - still there\n'));
  const notFixed = runScript(['--chain', 'review', '--report', 'reports/review-notfixed.md'], repo);
  check('--chain review fails on a NOT FIXED line', notFixed.json.pass === false && has(notFixed, 'digest', /R1.*NOT FIXED/), JSON.stringify(notFixed.json.failed));
  write(repo, 'reports/receipts/y/ledger.json', JSON.stringify(ledgerOf(2, 'NOT FIXED', t(2))));
  const revert = runScript(['--chain', 'review', '--report', 'reports/review-settled.md', '--ledger', 'reports/receipts/y/ledger.json'], repo);
  check('--chain review fails on a round-2 NOT FIXED in the ledger', revert.json.pass === false && has(revert, 'ledger', /R1.*round 2/), JSON.stringify(revert.json.failed));
  write(repo, 'reports/receipts/z/ledger.json', JSON.stringify(ledgerOf(1, 'FIXED', t(0))));
  const late = runScript(['--chain', 'review', '--report', 'reports/review-settled.md', '--ledger', 'reports/receipts/z/ledger.json'], repo);
  check('--chain review fails on fixes after the last checkpoint', late.json.pass === false && has(late, 'checkpoint', /checkpoint/), JSON.stringify(late.json.failed));
  const noLedger = runScript(['--chain', 'review', '--report', 'reports/review-settled.md'], repo);
  check('--chain review with no ledger passes and says so in notes',
    noLedger.json.pass === true && notes(noLedger).some(function (n) { return /ledger/.test(n); }), JSON.stringify(noLedger.json));
  write(repo, 'reports/review-nodigest.md', '# Review\n\n## Findings\n\n- R1: FIXED\n');
  const noDigest = runScript(['--chain', 'review', '--report', 'reports/review-nodigest.md'], repo);
  check('--chain review refuses a report with no Digest section',
    noDigest.status === 1 && noDigest.json.error === 'bad_shape' && /Digest/.test(String(noDigest.json.detail)), brief(noDigest) + JSON.stringify(noDigest.json));
  write(repo, 'reports/review-badline.md', report('- R1 FIXED without the colon\n'));
  const badLine = runScript(['--chain', 'review', '--report', 'reports/review-badline.md'], repo);
  check('refuses a digest line that is not in the verdict shape',
    badLine.status === 1 && badLine.json.error === 'bad_shape' && /R1 FIXED/.test(String(badLine.json.detail)), brief(badLine) + JSON.stringify(badLine.json));

  // R7 of the #272 review: the review prompt shows a digest line as
  // `R<n>: <VERDICT>` with no dash, so a digest written that way carries the
  // same verdicts, and a NOT FIXED or PAGED line in it must stop the chain too.
  write(repo, 'reports/review-bare.md', report('R1: FIXED - ok\nR2: NOT FIXED - still there\n'));
  const bare = runScript(['--chain', 'review', '--report', 'reports/review-bare.md'], repo);
  check('a digest line with no leading dash is read, so a bare NOT FIXED line fails the chain',
    bare.status === 0 && bare.json.pass === false && has(bare, 'digest', /R2.*NOT FIXED/), brief(bare) + JSON.stringify(bare.json));

  // explore: the closing summary file
  // #275: a Reaches section sits between Design direction and Open questions.
  // `reaches` is that section's body: left out, the three labelled items in
  // the form /explore writes (`- **Label:** ...`); null leaves the section out.
  const REACHES = '- **Other installs:** none - one copy\n- **Other sessions and unreleased work:** none - no other worktree\n- **What the user gets back:** the gate names the item\n';
  const summary = function (mode, dial, directions, open, reaches) {
    const reach = reaches === null ? '' : '## Reaches\n\n' + (reaches === undefined ? REACHES : reaches) + '\n';
    return '# Exploration summary\n\n**Mode:** ' + mode + '\n**Scope dial:** ' + dial + '\n**Models:** best\n\n## Direction\n\n' +
      directions.map(function (d) { return '- ' + d + '\n'; }).join('') + '\n## Decisions\n\n- one\n\n## Design direction\n\n- none\n\n' + reach + '## Open questions\n\n' +
      open.map(function (q) { return '- ' + q + '\n'; }).join('');
  };
  write(repo, 'reports/explore/s1.md', summary('scoping', 'not offered', ['Trim the rule'], ['none']));
  const s1 = runScript(['--chain', 'explore', '--summary', 'reports/explore/s1.md'], repo);
  check('--chain explore passes an empty open-questions section',
    s1.status === 0 && s1.json.stage === 'explore' && s1.json.pass === true && dig(s1.json, 'handoff.models') === 'best' && dig(s1.json, 'handoff.mode') === 'scoping' &&
    dig(s1.json, 'handoff.summary') === 'reports/explore/s1.md', brief(s1) + JSON.stringify(s1.json));
  write(repo, 'reports/explore/s2.md', summary('scoping', 'not offered', ['Trim the rule'], ['Which folder holds the file?']));
  const s2 = runScript(['--chain', 'explore', '--summary', 'reports/explore/s2.md'], repo);
  check('fails on an open question', s2.json.pass === false && has(s2, 'open-questions', /folder/), JSON.stringify(s2.json.failed));
  // R14 of the #272 review: M14 says "one bullet per question", not a dash
  // bullet, so a starred or numbered question is a question too.
  write(repo, 'reports/explore/s7.md', summary('scoping', 'not offered', ['Trim the rule'], []) + '* Which folder holds the file?\n1. Which slug names it?\n');
  const s7 = runScript(['--chain', 'explore', '--summary', 'reports/explore/s7.md'], repo);
  check('a starred or numbered open question fails the explore chain too',
    s7.json.pass === false && has(s7, 'open-questions', /2 open questions: Which folder/), JSON.stringify(s7.json));
  write(repo, 'reports/explore/s3.md', summary('vision', 'Expand', ['Big'], []));
  const s3 = runScript(['--chain', 'explore', '--summary', 'reports/explore/s3.md'], repo);
  check('fails a vision summary whose dial reads Expand', s3.json.pass === false && has(s3, 'scope-dial', /Expand/), JSON.stringify(s3.json.failed));
  write(repo, 'reports/explore/s4.md', summary('vision', 'not offered', ['One way'], []));
  const s4 = runScript(['--chain', 'explore', '--summary', 'reports/explore/s4.md'], repo);
  check('passes a vision summary with no dial and one direction',
    s4.json.pass === true && notes(s4).some(function (n) { return /Hold/.test(n); }), JSON.stringify(s4.json));
  write(repo, 'reports/explore/s5.md', summary('vision', 'not offered', ['One way', 'Another way'], []));
  const s5 = runScript(['--chain', 'explore', '--summary', 'reports/explore/s5.md'], repo);
  check('fails one with no dial and two directions, saying offer the dial', s5.json.pass === false && has(s5, 'scope-dial', /offer the dial/), JSON.stringify(s5.json.failed));
  write(repo, 'reports/explore/s6.md', '# Exploration summary\n\n**Mode:** scoping\n\n## Direction\n\n- x\n');
  const s6 = runScript(['--chain', 'explore', '--summary', 'reports/explore/s6.md'], repo);
  check('--chain explore refuses a summary with no Open questions section',
    s6.status === 1 && s6.json.error === 'bad_shape' && /Open questions/.test(String(s6.json.detail)), brief(s6) + JSON.stringify(s6.json));
  // #275: the Reaches section. No section is a shape refusal, like Open
  // questions; a missing item or a bare "none" fails the chain and names the
  // item, so the stage can ask for it the way it asks an open question.
  write(repo, 'reports/explore/r1.md', summary('scoping', 'not offered', ['Trim the rule'], ['none'], null));
  const r1 = runScript(['--chain', 'explore', '--summary', 'reports/explore/r1.md'], repo);
  check('--chain explore refuses a summary with no Reaches section',
    r1.status === 1 && r1.json.error === 'bad_shape' && /Reaches/.test(String(r1.json.detail)), brief(r1) + JSON.stringify(r1.json));
  write(repo, 'reports/explore/r2.md', summary('scoping', 'not offered', ['Trim the rule'], ['none'],
    '- **Other installs:** none - one copy\n- **What the user gets back:** the gate names the item\n'));
  const r2 = runScript(['--chain', 'explore', '--summary', 'reports/explore/r2.md'], repo);
  check('fails when a Reaches item is missing, naming it',
    r2.status === 0 && r2.json.pass === false && has(r2, 'reaches', /Other sessions and unreleased work/), brief(r2) + JSON.stringify(r2.json));
  write(repo, 'reports/explore/r3.md', summary('scoping', 'not offered', ['Trim the rule'], ['none'],
    '- **Other installs:** none - one copy\n- **Other sessions and unreleased work:** none - no other worktree\n- **What the user gets back:** none\n'));
  const r3 = runScript(['--chain', 'explore', '--summary', 'reports/explore/r3.md'], repo);
  check('fails when a Reaches item reads a bare none',
    r3.json.pass === false && has(r3, 'reaches', /What the user gets back.*no reason/), JSON.stringify(r3.json));
  write(repo, 'reports/explore/r4.md', summary('scoping', 'not offered', ['Trim the rule'], ['none'],
    '- **Other installs:** none - one copy\n- **Other sessions and unreleased work:** none - no other worktree\n- **What the user gets back:** none - nothing is shown\n'));
  const r4 = runScript(['--chain', 'explore', '--summary', 'reports/explore/r4.md'], repo);
  check('passes a Reaches item written none with a reason', r4.status === 0 && r4.json.pass === true, brief(r4) + JSON.stringify(r4.json));
  // the labels match case-insensitively with the bold markers optional, so a
  // hand-written summary passes too
  write(repo, 'reports/explore/r5.md', summary('scoping', 'not offered', ['Trim the rule'], ['none'],
    '- other installs: none - one copy\n- other sessions and unreleased work: none - no other worktree\n- what the user gets back: the gate names the item\n'));
  const r5 = runScript(['--chain', 'explore', '--summary', 'reports/explore/r5.md'], repo);
  check('passes a Reaches section whose labels are lower-case and unbolded', r5.status === 0 && r5.json.pass === true, brief(r5) + JSON.stringify(r5.json));
  // R9 of the #275 review: the template is `none - <reason>`, so a none with
  // the dash written and the reason forgotten is a bare none too
  write(repo, 'reports/explore/r8.md', summary('scoping', 'not offered', ['Trim the rule'], ['none'],
    '- **Other installs:** none - one copy\n- **Other sessions and unreleased work:** none - no other worktree\n- **What the user gets back:** none -\n'));
  const r8 = runScript(['--chain', 'explore', '--summary', 'reports/explore/r8.md'], repo);
  check('fails when a Reaches item reads none with a dash and no reason',
    r8.json.pass === false && has(r8, 'reaches', /What the user gets back.*no reason/), JSON.stringify(r8.json));
  // the vision-mode summary is the same shape
  write(repo, 'reports/explore/r6.md', summary('vision', 'Hold', ['One way'], ['none']));
  const r6 = runScript(['--chain', 'explore', '--summary', 'reports/explore/r6.md'], repo);
  write(repo, 'reports/explore/r7.md', summary('vision', 'Hold', ['One way'], ['none'], null));
  const r7 = runScript(['--chain', 'explore', '--summary', 'reports/explore/r7.md'], repo);
  check('a vision summary passes with the Reaches section and is refused without it',
    r6.status === 0 && r6.json.pass === true && r7.status === 1 && r7.json.error === 'bad_shape' && /Reaches/.test(String(r7.json.detail)),
    JSON.stringify(r6.json) + ' | ' + JSON.stringify(r7.json));
  const missing = runScript(['--chain', 'review', '--report', 'reports/nope.md'], repo);
  const noStage = runScript(['--chain'], repo);
  check('--chain with a missing input exits 1 with error',
    missing.status === 1 && typeof missing.json.error === 'string' && /nope\.md/.test(String(missing.json.detail)) && noStage.status === 1 && typeof noStage.json.error === 'string',
    brief(missing) + JSON.stringify(missing.json) + ' | ' + brief(noStage));
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
