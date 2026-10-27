#!/usr/bin/env node
'use strict';
// release-check.js - the maintainer-only release gate for the toolkit repo
// (issue #175). Nothing here ships in plugin/.
//
//   node scripts/release-check.js [--repo <dir>] [--suites <list|glob>]
//                                 [--skip-suites] [--tests-only] [--jobs <n>]
//                                 [--reuse-pass]
//                                 [--commit <sha>]
//                                 [--pushing-tag <tag>[:<sha>]]...
//                                 [--remote <name|url>]
//   TK_RELEASE_CATCH_OVERRIDE='<reason>'  passes a failing catch-rate check (7)
//                                         with the reason printed first
//
// Why it exists: the toolkit ships as the `tk` plugin, and Claude Code caches a
// plugin by its version. Commits that changed plugin/ without bumping
// plugin/.claude-plugin/plugin.json never reached existing installs, and
// nothing ran the test suites automatically. This script is the one gate the
// pre-push hook (scripts/git-hooks/pre-push) runs before a push to main or a
// release tag. Each check prints one `ok` or `FAIL` line with its reason:
//
//   1. Suites      - every scripts/test-*.js, this script's own test included,
//                    one `node <file>` each. That test cannot recurse: it only
//                    ever points the gate at scratch repos it builds, whose
//                    suites are stubs, never at this one. ONLY the exit
//                    code counts: a past release misread a failure summary as
//                    passes, so no output is ever parsed. --suites overrides
//                    the set (a comma list of paths, repo-relative or
//                    absolute, each may use * or ? in its file name);
//                    --skip-suites skips the check. Each suite prints one
//                    line, its exit code then its wall time
//                    (`scripts/test-x.js: exit 0 (12.3 s)`), so a slow suite
//                    is found in the gate's own output (#231).
//                    The suites run side by side (issue #249): a pool of the
//                    CPU count less one (--jobs <n> sets it; --jobs 1 runs
//                    them one at a time). Each suite gets a temp folder of
//                    its own (TMPDIR, TMP and TEMP) under the gate's temp
//                    folder, removed when it exits, and runs in a process
//                    group of its own, so a suite past its time limit, or a
//                    gate stopped by Ctrl-C or SIGTERM, takes every process
//                    the suite started with it. A temp folder inside a git
//                    work tree fails the check before any suite runs: several
//                    suites build fixtures that must not be inside a
//                    repository. Each suite's line, with a failing suite's
//                    tail under it, prints as the suite ends; the failed list
//                    is sorted by name, and one more line gives the count,
//                    the wall time and how many ran at a time.
//                    A default-set run (no --suites) where every suite exited
//                    0 records the pass in the clone's git folder
//                    (tk-release-gate.json): the files' fingerprint, taken
//                    before the suites and again after (a run whose files
//                    changed meanwhile records nothing), HEAD, and each
//                    suite's seconds, which order the next run longest
//                    first. --reuse-pass (the pre-push hook's flag, never a
//                    manual run's) skips the suites when the files match the
//                    record and every commit the run names (HEAD when none)
//                    is the recorded HEAD: a release push then does not
//                    rerun them on files that just passed (issue #249).
//   2. Build       - `node scripts/build-plugin.js --check` exits 0 (plugin/
//                    matches its source). Skipped with a note when the repo has
//                    no build-plugin.js (the tests' scratch repos).
//   R. README      - README.md at the repo root holds at most README_WORD_BUDGET
//                    words, counted the way `wc -w` counts (runs of whitespace
//                    separate words). The README is the front door and the
//                    manual lives in docs/; before this check it had grown to
//                    11,622 words, one release note at a time. Reads the same
//                    repo root as check 2, so a run from a subfolder still
//                    judges the real file. Skipped with a note when the repo
//                    has no README.md (the tests' scratch repos). Runs in
//                    every mode, --tests-only included.
//   C. Ceiling     - no prompt file (command, skill or agent) loads more than
//                    PROMPT_LOAD_CEILING words, counted by scripts/prompt-load.js
//                    with every fragment it pastes (#261). The session row is
//                    left out; skipped with a note when the repo has no
//                    prompt-load.js; a report that cannot be read fails. Runs
//                    in every mode, --tests-only included.
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
//                    a git-subdir source whose url names this repository, on
//                    path "plugin", pinned to ref v<plugin.json version>, so
//                    users install the tagged tree (review finding R2: a
//                    missing or foreign url passed and broke every install).
//                    This repository is read from the clone's `origin` remote.
//   5. Release tag - the tag v<plugin.json version> must exist locally and
//                    point at the checked commit or one of its ancestors; for a
//                    commit named by --commit while --remote is given (the
//                    hook's push to main) it must also already be on that
//                    remote at the same commit, even when this same push
//                    carries the tag: git push is not atomic, so a tag the
//                    remote refuses (it holds another commit under that name,
//                    or a protection rule) would still let main land. The
//                    marketplace pins that tag, so main without it installs
//                    nothing (R2). A remote that cannot be reached fails.
//   6. Landings    - the safety net for landings made without /merge (issue
//                    #232): `.claude/scripts/merge-check.js --since <previous
//                    release tag> --main <commit>` reruns rules 1 and 2 over
//                    every landing on the commit's first-parent line since the
//                    release check 3 compares with. Any flag fails, with the
//                    script's own plain lines; keep a line on purpose with an
//                    empty commit carrying its `Kept on purpose:` line. A
//                    landing the script cannot check (a squash with no recorded
//                    cut) is counted in the reason, never a failure. Skipped
//                    with a note when the repo has no merge-check.js or no
//                    earlier release tag.
//   7. Catch rate  - a release's review path (the plugin files the review
//                    reads, the harness's own list) must be measured (issue
//                    #279): two valid Pocket ship-arm review runs in
//                    reports/quality-check/ whose review-path hash is the
//                    checked commit's, whether the path changed since the
//                    previous release tag or not (so a tag pushed under the
//                    override never passes the releases after it), and, when
//                    the path changed, a PASS score of those runs against the
//                    previous tag's runs, or, when that tag has fewer than
//                    two, against the last earlier release that has two on a
//                    different path; all through scripts/quality-check.js's
//                    exports (read, never copied). Fewer than two runs fails
//                    naming the two-run command; any verdict but PASS fails
//                    with the verdict and the lost catches.
//                    TK_RELEASE_CATCH_OVERRIDE='<reason>' turns that FAIL
//                    into ok with the reason printed first; the hook runs the
//                    gate on the tag push and again on the push of main, so
//                    the variable is set on both. Skipped in a repo without
//                    the harness, and under --tests-only (the ledger is
//                    gitignored, so CI and fresh clones never see it; the
//                    info line below still prints there).
//
// After check 2 it also prints one `info prompt load` line: how many words each
// prompt file loads against scripts/prompt-load-baseline.json (issue #206). It is
// information, not a check: never counted, never a failure, skipped silently in a
// repo without scripts/prompt-load.js.
//
// Which commit checks 3, 4 and 5 read: HEAD by default (a manual run). The hook
// names what is actually being pushed instead, because the pushed commit need
// not be HEAD (`git push origin other-branch:main`):
//   --commit <sha>             the commit being pushed to main (repeatable).
//   --pushing-tag <tag>[:<sha>] a pushed tag (repeatable); <sha> is the local
//                              object being pushed (the hook passes it, since
//                              `git push origin X:refs/tags/v1` need not match
//                              any local tag); without it the local tag is read.
//   --remote <name|url>        the remote a push to main goes to; check 5 asks
//                              it (git ls-remote) for the release tag.
// Each distinct commit named gets its own checks 3, 4 and 5, read from committed
// state (`git show <sha>:<path>`). The suites and the build check always run on
// the working tree. --repo points every check at another clone (tests).
//
// --tests-only is the everyday test run (`npm test`, and CI): checks 1, 2 and
// R only. Checks T, 3, 4, 5 and 6 judge a release (a bumped version, a marketplace
// pin, a tag), which a commit in the middle of a cycle does not have yet and a
// CI checkout, fetched without tags, cannot show. They are skipped with one
// line saying so. The suites still go through the same exit-code-only runner.
// It cannot be combined with --commit, --pushing-tag or --remote: those only
// feed the skipped checks, so together they are a usage error, never a quiet
// way to push without the release checks. `npm run test:release` is the full
// gate.
//
// Dependency-free; git and node run through spawnSync with argument arrays
// (no shell interpolation).
//
// Exit codes: 0 every check passed
//             1 at least one check failed (block the release or push)
//             2 usage error (unknown argument, missing value)

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Check R: the most words README.md may hold. The rewrite of 2026-10-09 landed
// at 865; the headroom is for a paragraph per release, not for a manual.
const README_WORD_BUDGET = 1500;
// The most words one prompt file (a command, a skill or an agent) may put into
// the context when it runs, counted the way scripts/prompt-load.js counts: the
// body with every fragment it pastes and, for an agent, every skill it
// preloads (#261). Formula: the biggest row prompt-load.js reports, times 1.1,
// rounded up to the next 500. Measured 2026-10-18, after the #261 cycle moved
// the review rules behind name-loaded skills: commands/document.md at 9,898
// words, so 10,888, rounded up to 11,000. Lower it when a split lands; raise it
// only with the new measurement and its date written here.
const PROMPT_LOAD_CEILING = 11000;

const USAGE = 'usage: node scripts/release-check.js [--repo <dir>] [--suites <list|glob>] [--skip-suites] [--tests-only] [--jobs <n>] [--reuse-pass] [--commit <sha>] [--pushing-tag <tag>[:<sha>]]... [--remote <name|url>]';
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
// suite's real runtime. TK_RELEASE_SUITE_TIMEOUT_MS overrides it, for the
// gate's own tests only, and says so whenever it is set.
const SUITE_TIMEOUT_MS = (() => {
  const v = process.env.TK_RELEASE_SUITE_TIMEOUT_MS;
  if (v === undefined || v === '') return 10 * 60 * 1000;
  if (!/^[1-9]\d*$/.test(v)) { console.error('release-check: TK_RELEASE_SUITE_TIMEOUT_MS must be a whole number of milliseconds, got ' + JSON.stringify(v)); process.exit(2); }
  console.error('release-check: TK_RELEASE_SUITE_TIMEOUT_MS is set; each suite stops after ' + v + ' ms instead of 10 minutes');
  return Number(v);
})();
// A release the maintainer ships unmeasured, or past a lost catch, on purpose
// (issue #279): TK_RELEASE_CATCH_OVERRIDE holds the reason, and the catch-rate
// check (7) passes with it printed first. It is a variable, not a flag, because
// the pre-push hook passes the gate fixed arguments; empty or unset is no
// override, and it says so on stderr whenever it is set.
const CATCH_OVERRIDE = (() => {
  const v = (process.env.TK_RELEASE_CATCH_OVERRIDE || '').trim();
  if (v) console.error('release-check: TK_RELEASE_CATCH_OVERRIDE is set; a failing catch-rate check passes with this reason: ' + v);
  return v;
})();
// The most of a suite's output kept, per stream: a failing suite shows only
// its last 15 lines.
const OUTPUT_KEEP = 4 * 1024 * 1024;
// The same for asking a remote about the release tag. A credential prompt can
// never be answered from inside a hook, so git is told not to ask.
const REMOTE_TIMEOUT_MS = 2 * 60 * 1000;

function parseArgs(argv) {
  const o = { repo: process.cwd(), suites: null, skipSuites: false, testsOnly: false, jobs: null, reusePass: false, commits: [], tags: [], remote: null };
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
    else if (a === '--tests-only') o.testsOnly = true;
    else if (a === '--reuse-pass') o.reusePass = true;
    else if (a === '--jobs') {
      const v = value();
      if (!/^[1-9]\d*$/.test(v)) usage('--jobs takes a whole number of at least 1, got ' + v);
      o.jobs = Number(v);
    }
    else if (a === '--commit') o.commits.push(value());
    else if (a === '--remote') o.remote = value();
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
  // Those three name what a push carries, for the very checks --tests-only
  // skips. Accepting both would let a push run with no release checks.
  if (o.testsOnly && (o.commits.length || o.tags.length || o.remote !== null)) usage('--tests-only cannot be combined with --commit, --pushing-tag or --remote (it skips the checks they feed)');
  // A recorded pass is of the default set, so only that set can reuse it.
  if (o.reusePass && (o.suites !== null || o.skipSuites)) usage('--reuse-pass goes only with the default suite set (no --suites, no --skip-suites)');
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
    .map(n => 'scripts/' + n);
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
// The suites run side by side (see the header). Each one is a child in its own
// process group with its own temp folder; `running` holds the live ones, so a
// gate that is stopped, or that crashes, stops them and removes their folders
// before it exits.
const running = new Map();   // pid -> the suite's temp folder
function removeDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}
// Kill a suite's whole group: the suite and everything it started.
function killGroup(pid) {
  try { process.kill(-pid, 'SIGKILL'); } catch (e) { /* already gone */ }
}
function stopAllSuites() {
  for (const [pid, dir] of running) { killGroup(pid); removeDir(dir); }
  running.clear();
}
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(sig, () => {
    const n = running.size;
    stopAllSuites();
    console.error('release-check: stopped by ' + sig + (n ? '; stopped ' + n + ' running suite(s)' : ''));
    process.exit(code);
  });
}
process.on('uncaughtException', (e) => {
  stopAllSuites();
  console.error('release-check: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
process.on('exit', stopAllSuites);

// The pass record (see the header). The fingerprint is the checks runner's,
// read from the gate's own repository; without it the gate neither records
// nor reuses, as a null fingerprint never skips a run there either.
const RUN_CHECKS = path.join(__dirname, '..', '.claude', 'scripts', 'run-checks.js');
const fingerprintOf = (() => {
  try { return fs.existsSync(RUN_CHECKS) ? require(RUN_CHECKS).fingerprint || null : null; } catch (e) { return null; }
})();
const filesPrint = () => (fingerprintOf ? fingerprintOf(REPO) : null);
function recordFile() {
  const r = git(['rev-parse', '--git-common-dir']);
  return r.status === 0 && r.out ? path.join(path.resolve(REPO, r.out), 'tk-release-gate.json') : null;
}
function readRecord() {
  const file = recordFile();
  if (!file) return null;
  try {
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    return rec && typeof rec === 'object' && !Array.isArray(rec) ? rec : null;
  } catch (e) { return null; }
}
// Written whole, through a temp file and a rename, so a reader never sees half.
function writeRecord(rec) {
  const file = recordFile();
  if (!file) return;
  const temp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(rec) + '\n');
    fs.renameSync(temp, file);
  } catch (e) {
    try { fs.rmSync(temp, { force: true }); } catch (x) { /* best effort */ }
    console.log('         could not record the pass: ' + e.message);
  }
}
// Why a recorded pass cannot stand for this run, or null when it can.
function reuseRefusal(rec, print) {
  if (!rec) return 'no pass is recorded';
  if (print === null) return 'the files cannot be fingerprinted';
  if (rec.fingerprint !== print) return 'the files differ from the last pass';
  const named = opts.commits.map(resolveCommit).concat(opts.tags.map(t => resolveCommit(t.rev)));
  if (!named.length) named.push(resolveCommit('HEAD'));
  if (named.some(sha => sha === null)) return 'a commit this run names cannot be resolved';
  const other = named.find(sha => sha !== rec.head);
  if (other) return 'the last pass was at ' + String(rec.head).slice(0, 7) + ', not ' + other.slice(0, 7);
  return null;
}

function defaultJobs() {
  const cpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, cpus - 1);
}
// True when dir is inside a git work tree.
function insideWorkTree(dir) {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, env: CHILD_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return r.status === 0 && (r.stdout || '').trim() === 'true';
}

// Run one suite; resolves to { rel, ok, line, out }. ONLY the exit code
// counts. A suite that is missing, cannot start, is killed by a signal or runs
// past its time limit is a failure, never a pass.
function runSuite(rel, tempRoot) {
  return new Promise((resolve) => {
    const abs = path.resolve(REPO, rel);
    if (!fs.existsSync(abs)) { resolve({ rel, ok: false, line: rel + ': missing', out: '' }); return; }
    const dir = fs.mkdtempSync(path.join(tempRoot, 'tk-suite-'));
    const env = Object.assign({}, CHILD_ENV, { TMPDIR: dir, TMP: dir, TEMP: dir });
    const started = Date.now();
    const out = { stdout: '', stderr: '' };
    let timedOut = false;
    let startError = null;
    let settled = false;
    const child = spawn('node', [abs], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const keep = (name) => (d) => { out[name] += d; if (out[name].length > OUTPUT_KEEP) out[name] = out[name].slice(-OUTPUT_KEEP); };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', keep('stdout'));
    child.stderr.on('data', keep('stderr'));
    if (child.pid) running.set(child.pid, dir);
    const timer = setTimeout(() => { timedOut = true; killGroup(child.pid); }, SUITE_TIMEOUT_MS);
    // When the suite ends, anything it left running (holding its output
    // open) is stopped too, so the result never waits on a stray process.
    child.on('exit', () => { if (child.pid) killGroup(child.pid); });
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.pid) running.delete(child.pid);
      removeDir(dir);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      // Matches the text the gate printed when it ran suites one at a time.
      const shown = startError ? 'error ' + startError.code : timedOut ? 'error ETIMEDOUT' : signal ? 'signal ' + signal : code;
      resolve({ rel, ok: !startError && !timedOut && code === 0, seconds: Number(seconds), line: rel + ': exit ' + shown + ' (' + seconds + ' s)', out: out.stdout + out.stderr });
    };
    child.on('error', (e) => { startError = e; finish(null, null); });
    child.on('close', finish);
  });
}

async function checkSuites() {
  if (opts.skipSuites) { report('suites', true, 'skipped (--skip-suites)'); return; }
  const suites = opts.suites !== null ? expandSuites(opts.suites) : defaultSuites();
  if (suites.length === 0) { report('suites', false, 'no suites found' + (opts.suites !== null ? ' for --suites ' + opts.suites : ' under scripts/test-*.js')); return; }
  const defaultSet = opts.suites === null;
  const rec = readRecord();
  const printBefore = defaultSet ? filesPrint() : null;
  if (opts.reusePass) {
    const why = reuseRefusal(rec, printBefore);
    if (!why) { report('suites', true, 'skipped, the same files passed at ' + rec.at + ' (' + String(rec.head).slice(0, 7) + ')'); return; }
    console.log('         not reusing a pass: ' + why);
  }
  const tempRoot = os.tmpdir();
  if (insideWorkTree(tempRoot)) {
    report('suites', false, 'the temp folder ' + tempRoot + ' is inside a git work tree, where several suites break; set TMPDIR to a folder outside any repository');
    return;
  }
  const jobs = Math.min(opts.jobs || defaultJobs(), suites.length);
  // Longest first, by the last pass's times; a suite it never timed goes
  // first (it may be the longest), then by name.
  const times = rec && rec.suites && typeof rec.suites === 'object' ? rec.suites : {};
  const took = (rel) => (typeof times[rel] === 'number' ? times[rel] : Infinity);
  const order = suites.slice().sort((a, b) => (took(b) - took(a)) || (a < b ? -1 : a > b ? 1 : 0));
  const started = Date.now();
  const done = [];
  let next = 0;
  const worker = async () => {
    while (next < order.length) {
      const r = await runSuite(order[next++], tempRoot);
      // One write per suite, its tail directly under its line.
      const tailText = !r.ok && r.out.trim() ? '\n' + tail(r.out, 15) : '';
      console.log('         ' + r.line + tailText);
      done.push(r);
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  console.log('         ' + suites.length + ' suite' + (suites.length === 1 ? '' : 's') + ' in ' + ((Date.now() - started) / 1000).toFixed(1) + ' s, ' + jobs + ' at a time');
  const failed = done.filter(r => !r.ok).map(r => r.rel).sort();
  if (!failed.length && defaultSet && printBefore !== null) {
    if (filesPrint() === printBefore) {
      const timed = {};
      for (const r of done) timed[r.rel] = r.seconds;
      writeRecord({ at: new Date(started).toISOString(), head: resolveCommit('HEAD'), fingerprint: printBefore, suites: timed });
    } else console.log('         not recorded as a pass: the files changed while the suites ran');
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

// --- R. README budget ------------------------------------------------------------------
// The README is the front door; the manual lives in docs/. Without a gate every
// release note grows it back, which is how it reached 11,622 words. Words are
// counted like `wc -w`. REPO is the root check 2 reads, so --repo and a run
// from a subfolder judge the real README; a repo without one (the tests'
// scratch repos) passes with a note, the way check 2 does.
function checkReadmeBudget() {
  const file = path.join(REPO, 'README.md');
  if (!fs.existsSync(file)) { report('readme budget', true, 'skipped: no README.md in this repo'); return; }
  const words = fs.readFileSync(file, 'utf8').split(/\s+/).filter(Boolean).length;
  if (words <= README_WORD_BUDGET) { report('readme budget', true, words + ' words, budget ' + README_WORD_BUDGET); return; }
  report('readme budget', false, words + ' words, ' + (words - README_WORD_BUDGET) + ' over the budget of ' + README_WORD_BUDGET + '; the README is the front door, move the detail into docs/');
}

// --- C. prompt ceiling (issue #261) ------------------------------------------------------
// The README budget's twin for prompt files: a fixed line on what any one
// command, skill or agent loads, so a fragment edit that grows twelve files at
// once fails here, at the commit that caused it. The growth warning below
// stays and names each word of growth inside the line. The session row is
// left out (it is not a prompt file). A repo without the measurement script
// passes with a note (the tests' scratch repos), as the README check does. A
// report that cannot be read is a failed check: a gate that cannot measure
// does not pass.
function checkPromptCeiling() {
  const script = path.join(REPO, 'scripts', 'prompt-load.js');
  if (!fs.existsSync(script)) { report('prompt ceiling', true, 'skipped: no scripts/prompt-load.js in this repo'); return; }
  const r = spawnSync('node', [script, '--json'], { cwd: REPO, env: CHILD_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) { report('prompt ceiling', false, 'report unavailable: prompt-load.js exited ' + r.status); return; }
  let rows = null;
  try { rows = JSON.parse(r.stdout).rows; } catch (e) { rows = null; }
  if (!rows || typeof rows !== 'object') { report('prompt ceiling', false, 'report unavailable: prompt-load.js --json printed no rows'); return; }
  const over = [];
  let biggest = null;
  for (const [row, n] of Object.entries(rows)) {
    if (row === 'session' || typeof n !== 'number') continue;
    if (!biggest || n > biggest.n) biggest = { row, n };
    if (n > PROMPT_LOAD_CEILING) over.push(row + ' loads ' + n + ' words, ' + (n - PROMPT_LOAD_CEILING) + ' over the ceiling of ' + PROMPT_LOAD_CEILING);
  }
  if (over.length) { report('prompt ceiling', false, over.join(' | ') + '; trim a fragment it pastes or load it at the phase that needs it (node scripts/prompt-load.js lists the fragments)'); return; }
  report('prompt ceiling', true, biggest ? 'biggest ' + biggest.row + ' at ' + biggest.n + ' words, ceiling ' + PROMPT_LOAD_CEILING : 'no rows, ceiling ' + PROMPT_LOAD_CEILING);
}

// --- info: prompt load (issue #206) --------------------------------------------------------
// Not a check: it never passes or fails and is not counted. It prints how many
// words each prompt file loads against scripts/prompt-load-baseline.json, so
// growth shows up in every `npm test`; the owner chose warn over fail for #206.
// test-prompt-load.js guards the counting, so a broken report fails the suites,
// not this line. A repo without the script (the tests' scratch repos) prints
// nothing here.
function infoPromptLoad() {
  const script = path.join(REPO, 'scripts', 'prompt-load.js');
  if (!fs.existsSync(script)) return;
  const r = spawnSync('node', [script, '--warnings-only'], { cwd: REPO, env: CHILD_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  const out = ((r.stdout || '') + (r.stderr || '')).replace(/\s+$/, '');
  if (r.status !== 0) {
    console.log('  info prompt load - report unavailable: prompt-load.js exited ' + r.status);
    if (out) console.log(tail(out, 15));
    return;
  }
  const lines = out.split('\n');
  console.log('  info prompt load - ' + (lines[0] || 'no output'));
  for (const l of lines.slice(1)) console.log('       ' + l);
}

// --- info: catch rate (harness research, item 7) ---------------------------------------
// Not a check either: never counted, never fails. It names the newest valid
// ship-arm review run in the fixture ledger (reports/quality-check/, gitignored),
// that run's build and Claude Code version, and the review-path files plugin/
// changed since that build, so a release whose review path moved after its last
// measured run says so in every gate run. The review path is the harness's own
// list (PATH_FILES.review in scripts/quality-check.js), read rather than copied,
// so the two cannot drift. Silent when the ledger or the harness is absent (CI,
// fresh clones, the tests' scratch repos).
function infoCatchRate() {
  const ledger = path.join(REPO, 'reports', 'quality-check');
  const harness = path.join(REPO, 'scripts', 'quality-check.js');
  if (!fs.existsSync(ledger) || !fs.existsSync(harness)) return;
  let reviewPath;
  let runs;
  try {
    const qc = require(harness);
    reviewPath = qc.PATH_FILES.review;
    if (!(reviewPath instanceof RegExp)) throw new Error('PATH_FILES.review is not a pattern');
    // The harness reads the ledger for this line and for check 7 alike (#279), so
    // what counts as a run is decided once, there.
    if (typeof qc.ledgerRuns !== 'function') throw new Error('ledgerRuns is not exported');
    runs = qc.ledgerRuns(ledger).filter(r => r.meta.build && typeof r.meta.build.sha === 'string' && /^[0-9a-f]{7,64}$/.test(r.meta.build.sha));
  } catch (e) {
    console.log('  info catch rate - unavailable: ' + e.message);
    return;
  }
  if (!runs.length) {
    console.log('  info catch rate - no valid ship-arm review run in reports/quality-check yet');
    return;
  }
  const newest = runs[0];
  const sha = newest.meta.build.sha;
  const head = 'newest valid ship-arm run ' + newest.name + ': build ' + sha.slice(0, 7);
  // The fixture the run measured (#278): a run saved before fixtures had names ran on notebook.
  const fixtureNote = '; fixture ' + newest.fixtureName;
  if (git(['cat-file', '-e', sha + '^{commit}']).status !== 0) {
    console.log('  info catch rate - ' + head + " is not in this repository's history" + fixtureNote);
    return;
  }
  const diff = git(['diff', '--name-only', sha, 'HEAD', '--', 'plugin/']);
  const changed = diff.status === 0 && diff.out
    ? diff.out.split('\n').map((f) => f.replace(/^plugin\//, '')).filter((f) => reviewPath.test(f))
    : [];
  const version = newest.meta.build.version ? ' (' + newest.meta.build.version + ')' : '';
  const claude = newest.meta.session && newest.meta.session.claude ? newest.meta.session.claude : 'unknown';
  console.log('  info catch rate - ' + head + version + ', Claude Code ' + claude + '; ' + changed.length
    + ' review-path file' + (changed.length === 1 ? '' : 's') + ' changed in plugin/ since that build' + fixtureNote);
  for (const f of changed.slice(0, 20)) console.log('       ' + f);
  if (changed.length > 20) console.log('       ... and ' + (changed.length - 20) + ' more');
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
// The previous release: the nearest v* tag reachable from the commit, with
// every tag ON the commit excluded. Plain `describe` would return the release
// commit's own tag, diff the commit with itself, and pass having compared
// nothing. Tag names cannot hold glob characters, so each is a literal
// --exclude pattern. Returns { tag } (null when there is none) or { error }.
function previousTag(sha) {
  const onCommit = git(['tag', '--points-at', sha, '--list', 'v[0-9]*']);
  if (onCommit.status !== 0) return { error: 'git tag --points-at failed (exit ' + onCommit.status + '): ' + onCommit.err };
  const exclude = [];
  for (const t of onCommit.out.split('\n').filter(Boolean)) exclude.push('--exclude', t);
  const d = git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', ...exclude, sha]);
  return { tag: d.status === 0 ? d.out : null };
}

function checkVersionBump(target) {
  const name = 'version bump';
  const at = target.label + ': ';
  const sha = target.sha;
  const prev = previousTag(sha);
  if (prev.error) { report(name, false, at + prev.error); return; }
  if (!prev.tag) { report(name, true, at + 'no earlier v* release tag reachable; nothing to compare (first release)'); return; }
  const tag = prev.tag;
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
// The owner/repo a marketplace `url` names, in exactly the forms the git-subdir
// source accepts: owner/repo, https://github.com/owner/repo(.git) and
// git@github.com:owner/repo(.git). Anything else is null, including the
// shorthand with a .git suffix, which is not one of those forms.
function marketplaceRepo(url) {
  if (typeof url !== 'string') return null;
  const short = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(url);
  if (short) return /\.git$/.test(short[2]) ? null : short[1] + '/' + short[2];
  const full = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/.exec(url);
  return full ? full[1] + '/' + full[2] : null;
}

// The repository this clone is, as owner/repo, read from its `origin` remote
// (`git remote get-url`, so insteadOf rewrites apply). Why origin and not a
// constant: the marketplace entry must name the repository the marketplace is
// published from, which for the maintainer's clone is its origin. A constant
// would go stale on a rename or a fork, and would let a scratch repo in the
// tests pass only by naming the real repository. origin accepts more URL shapes
// than the marketplace does (ssh://, a user@ prefix, a trailing slash). Missing
// or not on GitHub, the url cannot be verified, and check 4 fails saying so.
// Memoized: every checked commit compares against the same answer.
let originRepoMemo = null;
function originRepo() {
  if (originRepoMemo) return originRepoMemo;
  const r = git(['remote', 'get-url', 'origin']);
  if (r.status !== 0 || !r.out) {
    originRepoMemo = { id: null, why: 'this clone has no origin remote to name the expected repository (git remote get-url origin exited ' + r.status + ')' };
    return originRepoMemo;
  }
  const m = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(r.out)
    || /^(?:[^@/:]+@)?github\.com:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(r.out);
  originRepoMemo = m ? { id: m[1] + '/' + m[2], why: '' } : { id: null, why: 'origin ' + JSON.stringify(r.out) + ' is not a GitHub repository URL, so the expected repository is unknown' };
  return originRepoMemo;
}

function checkMarketplace(target) {
  const name = 'marketplace ref';
  const at = target.label + ': ';
  if (target.found.version === null) { report(name, false, at + 'cannot derive the expected ref: ' + target.found.why); return; }
  const expectedRef = 'v' + target.found.version;
  const origin = originRepo();
  const expected = 'source {"source": "git-subdir", "url": "' + (origin.id || '<owner>/<repo>') + '", "path": "plugin", "ref": "' + expectedRef + '"}';
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
  // GitHub owner and repository names are case-insensitive, so is this match.
  const named = marketplaceRepo(s.url);
  if (s.url === undefined || s.url === null || s.url === '') wrong.push('url is missing');
  else if (!named) wrong.push('url ' + JSON.stringify(s.url) + ' is not owner/repo, https://github.com/owner/repo or git@github.com:owner/repo');
  else if (!origin.id) wrong.push('url cannot be verified: ' + origin.why);
  else if (named.toLowerCase() !== origin.id.toLowerCase()) wrong.push('url names ' + named + ', not this repository ' + origin.id + ' (its origin remote)');
  if (wrong.length) { report(name, false, at + 'tk ' + wrong.join(', ') + '; expected ' + expected); return; }
  report(name, true, at + 'tk installs git-subdir plugin from ' + origin.id + ' at ' + expectedRef);
}

// --- 5. release tag ------------------------------------------------------------------
// The tag names of a remote's `git ls-remote` answer, each with the commit it
// ends at: the peeled `^{}` line for an annotated tag, else the plain sha.
function remoteTagCommits(out) {
  const plain = {};
  const peeled = {};
  for (const l of out.split('\n')) {
    const m = /^([0-9a-f]+)\s+refs\/tags\/(.+?)(\^\{\})?$/.exec(l.trim());
    if (m) (m[3] ? peeled : plain)[m[2]] = m[1];
  }
  const commits = {};
  for (const t of Object.keys(plain)) commits[t] = peeled[t] || plain[t];
  return commits;
}

function checkReleaseTag(target, pushedTags) {
  const name = 'release tag';
  const at = target.label + ': ';
  if (target.found.version === null) { report(name, false, at + 'cannot derive the expected tag: ' + target.found.why); return; }
  const tag = 'v' + target.found.version;
  const short = target.sha.slice(0, 12);
  // The local tag first: the marketplace pins it, so it must exist and hold
  // the checked commit's tree or an ancestor of it (main may be a merge on top).
  if (git(['rev-parse', '-q', '--verify', 'refs/tags/' + tag]).status !== 0) {
    report(name, false, at + 'tag ' + tag + ' does not exist locally; the marketplace pins it, so tag the release commit (git tag ' + tag + ' <release commit>) and run the gate again');
    return;
  }
  const tagCommit = resolveCommit('refs/tags/' + tag);
  if (!tagCommit) { report(name, false, at + 'tag ' + tag + ' does not point at a commit'); return; }
  const anc = git(['merge-base', '--is-ancestor', tagCommit, target.sha]);
  if (anc.status === 1) {
    report(name, false, at + 'tag ' + tag + ' points at ' + tagCommit.slice(0, 12) + ', which is not ' + short + ' or one of its ancestors; users would install a tree this commit does not contain');
    return;
  }
  if (anc.status !== 0) { report(name, false, at + 'git merge-base --is-ancestor ' + tagCommit.slice(0, 12) + ' ' + short + ' failed (exit ' + anc.status + '): ' + anc.err); return; }
  const local = 'tag ' + tag + ' is on ' + (tagCommit === target.sha ? short : 'its ancestor ' + tagCommit.slice(0, 12));
  // The remote only for a push to main. A tag push is what creates the remote
  // tag, so it is never asked to find it there already.
  if (!target.viaCommit || opts.remote === null) { report(name, true, at + local); return; }
  // The remote is always asked, even when this same push also carries the tag.
  // git push is not atomic by default: if the remote refuses the tag (it already
  // holds that name at another commit, say after a local `git tag -f`, or a
  // protected-tag rule rejects it), main still lands, pinned to a tag holding
  // another tree or none. So the tag must be published before main is.
  const carried = pushedTags.some(p => p.tag === tag && p.sha === tagCommit);
  const r = spawnSync('git', ['ls-remote', '--tags', '--', opts.remote, 'refs/tags/' + tag, 'refs/tags/' + tag + '^{}'], {
    cwd: REPO, env: Object.assign({}, CHILD_ENV, { GIT_TERMINAL_PROMPT: '0' }), encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], timeout: REMOTE_TIMEOUT_MS,
  });
  if (r.status !== 0) {
    const why = r.status === null ? (r.error ? 'error ' + r.error.code : 'killed by ' + r.signal) : 'exit ' + r.status;
    const err = (r.stderr || '').trim().split('\n')[0] || '';
    report(name, false, at + 'cannot reach remote ' + opts.remote + ' to confirm tag ' + tag + ' is published (git ls-remote ' + why + (err ? ': ' + err : '') + '); the push stays blocked until the remote answers');
    return;
  }
  const onRemote = remoteTagCommits(r.stdout || '')[tag];
  // A push carrying the tag alongside main cannot count on it landing (above).
  const alongside = carried ? ' (this push carries it alongside main, but git push is not atomic, so a refused tag would still let main land)' : '';
  if (!onRemote) {
    report(name, false, at + 'tag ' + tag + ' is not on remote ' + opts.remote + alongside + '; push the tag on its own first (git push ' + opts.remote + ' ' + tag + '), then main, or every install fails to find the pinned ref');
    return;
  }
  if (onRemote !== tagCommit) {
    report(name, false, at + 'tag ' + tag + ' on remote ' + opts.remote + ' points at ' + onRemote.slice(0, 12) + ', not ' + tagCommit.slice(0, 12) + ' like the local tag' + alongside + '; users would install that other tree');
    return;
  }
  report(name, true, at + local + ', and on remote ' + opts.remote);
}

// Check 6: every landing since the previous release, rerun through the repo's
// own merge-check.js. Only its exit code decides (0 clean, 1 flagged, anything
// else could not check, which fails); its stdout JSON is read for the counts in
// the reason and its stderr for the flagged lines.
const LANDINGS_TIMEOUT_MS = 5 * 60 * 1000;
function checkLandings(target) {
  const name = 'landings';
  const at = target.label + ': ';
  const script = path.join(REPO, '.claude', 'scripts', 'merge-check.js');
  if (!fs.existsSync(script)) { report(name, true, at + 'skipped: no .claude/scripts/merge-check.js in this repo'); return; }
  const prev = previousTag(target.sha);
  if (prev.error) { report(name, false, at + prev.error); return; }
  if (!prev.tag) { report(name, true, at + 'no earlier v* release tag reachable; nothing to check'); return; }
  const r = spawnSync(process.execPath, [script, '--since', prev.tag, '--main', target.sha], { cwd: REPO, env: CHILD_ENV, encoding: 'utf8', timeout: LANDINGS_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch (e) { j = null; }
  const lines = String(r.stderr || '').split('\n').filter(Boolean);
  if ((r.status === 0 || r.status === 1) && j && Array.isArray(j.landings)) {
    const notCheckable = j.landings.filter((l) => l.rule1 !== 'checked').length;
    const counts = j.landings.length + ' landing(s) since ' + prev.tag + (notCheckable ? ', ' + notCheckable + ' not checkable (no recorded cut; a note, not a failure)' : '');
    if (r.status === 0) { report(name, true, at + counts + ', none flagged' + (j.keptOnPurpose ? ' (' + j.keptOnPurpose + ' kept on purpose)' : '')); return; }
    const flagged = lines.filter((l) => !/^(note|merge-check): /.test(l));
    report(name, false, at + counts + '; ' + j.flagged + ' line(s) lost: ' + flagged.slice(0, 5).join(' | ') + (flagged.length > 5 ? ' | and ' + (flagged.length - 5) + ' more' : '') + '. Restore each, or keep it on purpose with an empty commit carrying its Kept on purpose: line');
    return;
  }
  report(name, false, at + 'merge-check.js could not check the landings since ' + prev.tag + ' (exit ' + (r.status === null ? 'none, ' + (r.error ? r.error.code : 'killed') : r.status) + '): ' + (lines[0] || 'no output'));
}

// --- 7. catch rate (issue #279) --------------------------------------------------------
// A release whose review path changed since the previous release must be
// measured: two valid Pocket ship-arm review runs in the ledger whose
// review-path hash is the checked commit's, and, when the previous tag's hash
// has two or more runs of its own, a PASS score of the new runs against them.
// The hashes, the lookup and the score are the harness's exports (read, never
// copied); the harness absent means the repository is not this toolkit, and the
// line is skipped. Fewer than two runs, or any verdict but PASS, fails, naming
// the two-run command or the lost catch; TK_RELEASE_CATCH_OVERRIDE turns that
// FAIL into ok with its reason printed first and the finding kept in brackets.
function checkCatchRate(target) {
  const name = 'catch rate';
  const at = target.label + ': ';
  const harness = path.join(REPO, 'scripts', 'quality-check.js');
  if (!fs.existsSync(harness)) return;
  let qc;
  try {
    qc = require(harness);
    for (const fn of ['reviewPathHash', 'measuredRelease', 'scoreRunDirs']) if (typeof qc[fn] !== 'function') throw new Error(fn + ' is not exported');
  } catch (e) { report(name, false, at + 'the harness could not be read (' + e.message + ')'); return; }
  const prev = previousTag(target.sha);
  if (prev.error) { report(name, false, at + prev.error); return; }
  if (!prev.tag) { report(name, true, at + 'no earlier v* release tag reachable; nothing to compare'); return; }
  const prevSha = resolveCommit(prev.tag);
  const newHash = qc.reviewPathHash(target.sha);
  const prevHash = prevSha ? qc.reviewPathHash(prevSha) : null;
  if (!newHash) { report(name, false, at + 'the review path at ' + target.sha.slice(0, 12) + ' could not be hashed'); return; }
  const fail = (what) => (CATCH_OVERRIDE ? report(name, true, at + 'overridden - ' + CATCH_OVERRIDE + ' (' + what + ')') : report(name, false, at + what));
  const names = list => list.map(r => r.name).join(', ');
  const m = qc.measuredRelease({ newHash, prevHash });
  const n = m.candidates.length;
  const twoRun = '; run node scripts/quality-check.js --role review --arm ship --build ' + target.sha + ' --fixture pocket ' + (n === 1 ? 'once more' : 'twice');
  const measuredBy = 'measured by ' + n + ' valid Pocket ship-arm runs (' + names(m.candidates) + ')';
  // An unchanged path passes only when its hash was measured: a tag pushed under
  // the override and never measured must not pass the releases after it (R10).
  if (newHash === prevHash) {
    if (n >= 2) { report(name, true, at + 'review path unchanged since ' + prev.tag + ', ' + measuredBy + '; no run needed'); return; }
    fail('review path unchanged since ' + prev.tag + ', but ' + n + ' of 2 valid Pocket ship-arm runs measure it' + (n ? ' (' + names(m.candidates) + ')' : '') + ': that release shipped unmeasured' + twoRun);
    return;
  }
  const changed = 'review path changed since ' + prev.tag;
  if (n < 2) {
    fail(changed + ' (' + newHash + ' vs ' + (prevHash || 'none') + ') and ' + n + ' of 2 valid Pocket ship-arm runs measure it' + (n ? ' (' + names(m.candidates) + ')' : '') + twoRun);
    return;
  }
  // The baseline: the previous tag's runs, or, when it has fewer than two, the
  // last earlier release that has two on a different review path (R10).
  let baseline = m.baseline;
  let against = 'against ' + prev.tag;
  if (baseline.length < 2) {
    const prevRuns = m.baseline.length + ' run' + (m.baseline.length === 1 ? '' : 's');
    const found = earlierBaseline(target.sha, prev.tag, newHash, qc);
    if (!found) {
      report(name, true, at + changed + '; ' + measuredBy + '; ' + prevRuns + ' on ' + prev.tag + "'s review path and no earlier release measured, nothing to compare");
      return;
    }
    baseline = found.baseline;
    against = 'against ' + found.tag + ', the last measured release since ' + prev.tag + ' has ' + prevRuns;
  }
  let s;
  try { s = qc.scoreRunDirs(m.candidates.map(r => r.dir), baseline.map(r => r.dir), {}); } catch (e) { fail(changed + '; ' + measuredBy + '; the score ' + against + ' failed: ' + e.message); return; }
  if (s.verdict === 'PASS') {
    report(name, true, at + changed + '; ' + measuredBy + '; PASS ' + against + ' (' + (s.stable || []).length + ' stable catches kept; baseline ' + names(baseline) + ')');
    return;
  }
  const why = s.why && s.why.length ? ' - ' + s.why.join('; ') : '';
  const rows = s.verdict === 'FAIL' ? (s.failed || []).map(id => { const p = (s.perId || {})[id] || {}; return id + ': baseline ' + p.baseline + ', candidate ' + p.candidate; }) : [];
  fail(s.verdict + ' ' + against + why + (rows.length ? '; ' + rows.join('; ') : '') + ' (candidates ' + names(m.candidates) + '; baseline ' + names(baseline) + ')');
}

// The last release before the previous tag whose review path differs from the
// checked commit's and has two or more measuring runs: the baseline when the
// previous tag itself has fewer than two (issue #279, review R10), so one thin
// or overridden tag never erases the comparison. The tags reachable from the
// commit, newest version first, the ones on the commit itself and the previous
// tag left out; null when none qualifies. A release on the same review path is
// never a baseline: its runs are the candidates.
function earlierBaseline(sha, prevTag, newHash, qc) {
  const reachable = git(['tag', '--merged', sha, '--list', 'v[0-9]*']);
  if (reachable.status !== 0) return null;
  const onCommit = git(['tag', '--points-at', sha, '--list', 'v[0-9]*']);
  const skip = new Set([prevTag, ...(onCommit.status === 0 ? onCommit.out.split('\n') : [])]);
  const tags = reachable.out.split('\n').filter(t => t && !skip.has(t))
    .sort((a, b) => compareVersions(b.replace(/^v/, ''), a.replace(/^v/, '')) || 0);
  for (const tag of tags) {
    const tagSha = resolveCommit(tag);
    const hash = tagSha ? qc.reviewPathHash(tagSha) : null;
    if (!hash || hash === newHash) continue;
    const mm = qc.measuredRelease({ newHash, prevHash: hash });
    if (mm.baseline.length >= 2) return { tag, hash, baseline: mm.baseline };
  }
  return null;
}

// Checks T, 3, 4, 5, 6 and 7. Every commit named by --commit or --pushing-tag is
// checked once, labelled with how it was named; with neither, HEAD.
function checkCommits() {
  const targets = [];
  const add = (sha, label) => {
    const known = targets.find(t => t.sha === sha);
    if (known) { known.label += ', ' + label; return known; }
    const t = { sha, label, found: pluginVersionAt(sha, sha.slice(0, 12)), viaCommit: false };
    targets.push(t);
    return t;
  };
  const unresolved = (what) => {
    report('version bump', false, what + ': cannot resolve to a commit (not a git repo, an empty one, or an unknown object)');
    report('marketplace ref', false, what + ': cannot resolve to a commit, so there is no committed marketplace.json to read');
    report('release tag', false, what + ': cannot resolve to a commit, so there is no version to name the tag');
  };
  const pushedTags = [];
  for (const t of opts.tags) {
    const sha = resolveCommit(t.rev);
    const target = sha ? add(sha, 'tag ' + t.tag) : null;
    if (sha) pushedTags.push({ tag: t.tag, sha });
    checkTag(t, sha, target ? target.found : null);
  }
  for (const c of opts.commits) {
    const sha = resolveCommit(c);
    if (sha) add(sha, 'commit ' + sha.slice(0, 12)).viaCommit = true; else unresolved('commit ' + c);
  }
  if (!opts.tags.length && !opts.commits.length) {
    const sha = resolveCommit('HEAD');
    if (sha) add(sha, 'HEAD'); else unresolved('HEAD');
  }
  for (const t of targets) {
    checkVersionBump(t);
    checkMarketplace(t);
    checkReleaseTag(t, pushedTags);
    checkLandings(t);
    checkCatchRate(t);
  }
}

(async () => {
  console.log('release-check: ' + REPO);
  await checkSuites();
  checkBuild();
  checkReadmeBudget();
  checkPromptCeiling();
  infoPromptLoad();
  infoCatchRate();
  if (opts.testsOnly) report('release checks', true, 'skipped (--tests-only): tag version, version bump, marketplace ref, release tag and landings judge a release, not an everyday test run; run without the flag for the full gate');
  else checkCommits();
  const failedCount = results.filter(ok => !ok).length;
  console.log('release-check: ' + (results.length - failedCount) + ' passed, ' + failedCount + ' failed');
  process.exit(failedCount ? 1 : 0);
})();
