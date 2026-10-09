#!/usr/bin/env node
'use strict';
// test-run-checks.js - assertions for .claude/scripts/run-checks.js (issue
// #221): the guarded checks runner. It reads a JSON list of checks, refuses
// every check that is not read-only, runs the rest from the project root,
// saves each output as <out>/<id>.txt ending in an `exit N` line, and decides
// pass or fail from an exit, match, noMatch or lines expectation (a prose
// expectation comes back as `model`).
//
// Every case runs the script as a child process inside a throwaway project
// under the OS temp dir: a tiny git repository with a hermetic config, a few
// fixture files and a reports/ folder. The hostile cases each carry a canary
// (a file the command would create or destroy) so "refused" is proven by the
// file system, not only by the verdict. The last case renders a review page
// whose receipt points at a runner-written file, through the real
// render-html.js, and reads the receipt back off the page.
// Dependency-free; exits non-zero on any failure.
//
//   node scripts/test-run-checks.js

const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const SCRIPT = path.resolve(REPO, '.claude', 'scripts', 'run-checks.js');
const RENDER = path.resolve(REPO, '.claude', 'scripts', 'render-html.js');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failures.push(name + (detail ? ' - ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' - ' + String(detail).slice(0, 400) : '')); }
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
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
});

// --- the sandbox project ----------------------------------------------------
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'run-checks-'));
process.on('exit', function () {
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});
const proj = path.join(sandbox, 'proj');
fs.mkdirSync(path.join(proj, 'reports'), { recursive: true });
function write(rel, text) { fs.writeFileSync(path.join(proj, rel), text); }
function read(rel) { return fs.readFileSync(path.join(proj, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(proj, rel)); }
function git(args) {
  return execFileSync('git', args, { cwd: proj, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
}
git(['init', '-q']);
git(['symbolic-ref', 'HEAD', 'refs/heads/main']);
write('f.txt', 'hello\nworld\nhello\n');
write('notes.md', '- a\n- b\n- a\n');
write('.gitignore', 'reports/\nartifacts/\n');
git(['add', '-A']);
git(['commit', '-qm', 'init']);
write('extra.txt', 'untracked\n');   // the one line `git status --porcelain` prints

let counter = 0;
function checksFile(list) {
  const f = path.join(sandbox, 'checks-' + (++counter) + '.json');
  fs.writeFileSync(f, typeof list === 'string' ? list : JSON.stringify(list));
  return f;
}
function outDir(label) { return path.join(proj, 'reports', 'out-' + label + '-' + (++counter)); }
// Run the runner. `json` is the parsed stdout or null; `byId` maps id to row.
function run(args, cwd) {
  const r = spawnSync(process.execPath, [SCRIPT].concat(args), { cwd: cwd || proj, encoding: 'utf8', env: ENV });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
  const byId = {};
  if (json && Array.isArray(json.checks)) for (const c of json.checks) byId[c.id] = c;
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json, byId };
}
function runChecks(list, label, extra) {
  const out = outDir(label);
  const r = run(['--checks', checksFile(list), '--out', out].concat(extra || []));
  r.out = out;
  return r;
}
function savedFile(r, id) {
  const p = path.join(r.out, id + '.txt');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}
function lastLine(text) { return text.replace(/\n+$/, '').split('\n').pop(); }
const verdicts = (r, ids) => ids.map((id) => id + '=' + (r.byId[id] ? r.byId[id].verdict : '?')).join(' ');

// A folder that exists and is NOT under any allowed root (reports/, the temp
// folder, /tmp, /private/tmp), for the symlink and outside-root cases.
function realOrSelf(p) { try { return fs.realpathSync(p); } catch (e) { return p; } }
function underAnyRoot(p) {
  const roots = [path.join(proj, 'reports'), os.tmpdir(), '/tmp', '/private/tmp'].filter((r) => fs.existsSync(r)).map(realOrSelf);
  const real = realOrSelf(p);
  return roots.some((r) => real === r || real.startsWith(r + path.sep));
}
const OUTSIDE_DIR = [os.homedir(), '/usr', '/etc'].find((d) => fs.existsSync(d) && !underAnyRoot(d));
const NEVER = 'run-checks-test-never-' + process.pid;

// --- 1. the four forms, pass and fail, with real commands -----------------------
section('1. pass and fail for exit, match, noMatch and lines, with real commands', function () {
  const r = runChecks([
    { id: 'exit-pass', check: 'test -f f.txt', expect: { exit: 0 } },
    { id: 'exit-fail', check: 'test -f missing.txt', expect: { exit: 0 } },
    { id: 'match-pass', check: 'grep -c hello f.txt', expect: { match: '^2$' } },
    { id: 'match-fail', check: 'grep -c hello f.txt', expect: { match: '^3$' } },
    { id: 'nomatch-pass', check: "sed -n '1,3p' f.txt", expect: { noMatch: 'goodbye' } },
    { id: 'nomatch-fail', check: "sed -n '1,3p' f.txt", expect: { noMatch: 'world' } },
    { id: 'lines-pass', check: 'git status --porcelain', expect: { lines: { min: 1, max: 1 } } },
    { id: 'lines-fail', check: 'git status --porcelain', expect: { lines: { max: 0 } } },
    { id: 'pipe-pass', check: "cat notes.md | sed 's/^- //' | sort | uniq -d", expect: { match: '^a$' } },
    { id: 'pipe-fail', check: "cat notes.md | sed 's/^- //' | sort | uniq -d", expect: { lines: { min: 2 } } },
  ], 'forms');
  const all = ['exit-pass', 'exit-fail', 'match-pass', 'match-fail', 'nomatch-pass', 'nomatch-fail', 'lines-pass', 'lines-fail', 'pipe-pass', 'pipe-fail'];
  check('exits 0 and prints exactly one JSON object', r.status === 0 && r.json !== null && r.stdout.trim().split('\n').length === 1, r.stdout.slice(0, 200) + r.stderr);
  check('exit: pass and fail', r.byId['exit-pass'].verdict === 'pass' && r.byId['exit-fail'].verdict === 'fail' && r.byId['exit-pass'].exit === 0 && r.byId['exit-fail'].exit === 1, verdicts(r, all));
  check('match: pass and fail', r.byId['match-pass'].verdict === 'pass' && r.byId['match-fail'].verdict === 'fail', verdicts(r, all));
  check('noMatch: pass and fail', r.byId['nomatch-pass'].verdict === 'pass' && r.byId['nomatch-fail'].verdict === 'fail', verdicts(r, all));
  check('lines: pass and fail', r.byId['lines-pass'].verdict === 'pass' && r.byId['lines-fail'].verdict === 'fail', verdicts(r, all) + ' ' + JSON.stringify(savedFile(r, 'lines-pass')));
  check('a pipeline of allowed filters runs: pass and fail', r.byId['pipe-pass'].verdict === 'pass' && r.byId['pipe-fail'].verdict === 'fail', verdicts(r, all) + ' ' + JSON.stringify(savedFile(r, 'pipe-pass')));
  check('a fail carries the last lines of the output as detail; a pass carries none', r.byId['match-fail'].detail === '2' && r.byId['match-pass'].detail === '' && r.byId['exit-fail'].detail === '', JSON.stringify([r.byId['match-fail'].detail, r.byId['match-pass'].detail]));
  check('the summary counts add up', JSON.stringify(r.json.summary) === JSON.stringify({ pass: 5, fail: 5, model: 0, error: 0 }), JSON.stringify(r.json.summary));
  check('stdoutFile is the saved path relative to the project root', r.byId['exit-pass'].stdoutFile === path.relative(proj, path.join(r.out, 'exit-pass.txt')) && fs.existsSync(path.join(proj, r.byId['exit-pass'].stdoutFile)), r.byId['exit-pass'].stdoutFile);
  check('the saved file is written for a fail too and ends with the exit line', savedFile(r, 'exit-fail') !== null && lastLine(savedFile(r, 'exit-fail')) === 'exit 1', JSON.stringify(savedFile(r, 'exit-fail')));
  check('no stderr line for a pass or a fail', r.stderr === '', r.stderr);
});

// --- 2. prose expectation -> model ---------------------------------------------
section('2. a prose expectation is model-judged and its output is still saved', function () {
  const r = runChecks([{ id: 'prose', check: 'grep -n hello f.txt', expect: 'both hello lines are listed' }], 'prose');
  check('verdict model, exit 0, empty detail', r.status === 0 && r.byId.prose.verdict === 'model' && r.byId.prose.exit === 0 && r.byId.prose.detail === '', JSON.stringify(r.byId.prose));
  const f = savedFile(r, 'prose');
  check('the file holds the output then the exit line', f === '1:hello\n3:hello\nexit 0\n', JSON.stringify(f));
  check('the summary counts it as model', r.json.summary.model === 1 && r.json.summary.pass === 0, JSON.stringify(r.json.summary));
});

// --- 3. invalid expectations -> error, the check still runs --------------------
section('3. an invalid expectation is an error, and the check still runs and saves', function () {
  const r = runChecks([
    { id: 'two-keys', check: 'echo hi', expect: { exit: 0, match: 'hi' } },
    { id: 'zero-keys', check: 'echo hi', expect: {} },
    { id: 'bad-regex', check: 'echo hi', expect: { match: '(' } },
    { id: 'string-exit', check: 'echo hi', expect: { exit: '0' } },
    { id: 'float-exit', check: 'echo hi', expect: { exit: 1.5 } },
    { id: 'empty-lines', check: 'echo hi', expect: { lines: {} } },
    { id: 'unknown-key', check: 'echo hi', expect: { status: 0 } },
    { id: 'no-expect', check: 'echo hi' },
  ], 'invalid');
  const ids = ['two-keys', 'zero-keys', 'bad-regex', 'string-exit', 'float-exit', 'empty-lines', 'unknown-key', 'no-expect'];
  check('every one is verdict error with a reason', r.status === 0 && ids.every((id) => r.byId[id] && r.byId[id].verdict === 'error' && r.byId[id].detail.length > 0), verdicts(r, ids));
  check('each still ran: exit 0 and a saved file ending in exit 0', ids.every((id) => r.byId[id].exit === 0 && r.byId[id].stdoutFile && savedFile(r, id) === 'hi\nexit 0\n'), ids.map((id) => JSON.stringify(savedFile(r, id))).join(' '));
  check('the reasons name the problem', /exactly one of/.test(r.byId['two-keys'].detail) && /exactly one of/.test(r.byId['zero-keys'].detail) && /regex/.test(r.byId['bad-regex'].detail) && /integer/.test(r.byId['string-exit'].detail) && /integer/.test(r.byId['float-exit'].detail) && /min or max/.test(r.byId['empty-lines'].detail), ids.map((id) => r.byId[id].detail).join(' | '));
  check('one stderr line per errored check, naming the id', ids.every((id) => new RegExp('^run-checks: ' + id + ': ', 'm').test(r.stderr)) && r.stderr.trim().split('\n').length === ids.length, r.stderr);
  check('the summary counts them as error', r.json.summary.error === ids.length, JSON.stringify(r.json.summary));
});

// --- 4. timeout -----------------------------------------------------------------
section('4. a timeout is a fail with exit 124, whatever the expectation', function () {
  const r = runChecks([
    { id: 'slow', check: 'sleep 3', expect: { exit: 0 } },
    { id: 'slow-prose', check: 'sleep 3', expect: 'finishes' },
  ], 'timeout', ['--timeout', '500']);
  check('verdict fail with exit 124 for a machine expectation', r.status === 0 && r.byId.slow.verdict === 'fail' && r.byId.slow.exit === 124, JSON.stringify(r.byId.slow));
  check('a prose expectation times out to fail as well', r.byId['slow-prose'].verdict === 'fail' && r.byId['slow-prose'].exit === 124, JSON.stringify(r.byId['slow-prose']));
  check('the saved file ends with exit 124 and says it timed out', savedFile(r, 'slow') !== null && lastLine(savedFile(r, 'slow')) === 'exit 124' && /timed out after 500 ms/.test(savedFile(r, 'slow')), JSON.stringify(savedFile(r, 'slow')));
  check('the detail carries the timeout line', /timed out/.test(r.byId.slow.detail), r.byId.slow.detail);
});

// --- 5. the saved file's shape ---------------------------------------------------
section('5. the saved file: stdout, then stderr, then exit N; capped with [truncated]', function () {
  const r = runChecks([
    { id: 'both', check: 'echo out; cat missing.txt', expect: { exit: 1 } },
    { id: 'big', check: "head -c 100000 /dev/zero | tr '\\0' x", expect: { exit: 0 } },
    { id: 'quiet', check: 'true', expect: { exit: 0 } },
    { id: 'stderr-to-stdout', check: 'cat missing.txt 2>&1', expect: { match: 'No such file' } },
    { id: 'quiet-stderr', check: 'cat missing.txt 2>/dev/null', expect: { exit: 1 } },
    { id: 'or-chain', check: 'test -f missing.txt || echo absent', expect: { match: '^absent$' } },
    { id: 'quoted-parens', check: "grep -E '(hello|world)' f.txt 2>/dev/null", expect: { lines: { min: 3, max: 3 } } },
    { id: 'no-pager', check: 'git --no-pager log --oneline', expect: { lines: { min: 1, max: 1 } } },
  ], 'shape');
  const both = savedFile(r, 'both');
  check('stdout comes first, stderr second, exit line last', both !== null && both.indexOf('out\n') === 0 && both.indexOf('missing.txt') > both.indexOf('out\n') && lastLine(both) === 'exit 1' && r.byId.both.verdict === 'pass', JSON.stringify(both));
  const big = savedFile(r, 'big');
  check('a 100 KB output is capped under 64 KB with a [truncated] line before the exit line', big !== null && Buffer.byteLength(big) < 64 * 1024 && /\n\[truncated\]\nexit 0\n$/.test(big) && r.byId.big.verdict === 'pass', big ? big.length + ' bytes, tail ' + JSON.stringify(big.slice(-40)) : 'no file');
  check('a check with no output saves only the exit line', savedFile(r, 'quiet') === 'exit 0\n', JSON.stringify(savedFile(r, 'quiet')));
  check('2>&1 is allowed and lands stderr in the saved output', r.byId['stderr-to-stdout'].verdict === 'pass', JSON.stringify(r.byId['stderr-to-stdout']));
  check('2>/dev/null is allowed', r.byId['quiet-stderr'].verdict === 'pass' && savedFile(r, 'quiet-stderr') === 'exit 1\n', JSON.stringify(r.byId['quiet-stderr']) + ' ' + JSON.stringify(savedFile(r, 'quiet-stderr')));
  check('|| chains two allowed segments', r.byId['or-chain'].verdict === 'pass', JSON.stringify(r.byId['or-chain']));
  check('parentheses inside quotes are a pattern, not a subshell', r.byId['quoted-parens'].verdict === 'pass', JSON.stringify(r.byId['quoted-parens']) + ' ' + JSON.stringify(savedFile(r, 'quoted-parens')));
  check('git --no-pager before a read-only subcommand is allowed', r.byId['no-pager'].verdict === 'pass', JSON.stringify(r.byId['no-pager']));
  check('all eight pass, nothing on stderr', r.json.summary.pass === 8 && r.stderr === '', JSON.stringify(r.json.summary) + ' ' + r.stderr);
});

// --- 6. whole-file validation ----------------------------------------------------
section('6. a malformed checks file exits 1 with nothing run and nothing written', function () {
  const cases = [
    ['a duplicate id', [{ id: 'a', check: 'true', expect: { exit: 0 } }, { id: 'a', check: 'true', expect: { exit: 0 } }], /duplicate/],
    ['an id with a slash', [{ id: 'a/b', check: 'true', expect: { exit: 0 } }], /not a valid id/],
    ['an id of ../x', [{ id: '../x', check: 'true', expect: { exit: 0 } }], /not a valid id/],
    ['a missing check', [{ id: 'a', expect: { exit: 0 } }], /check must be a non-empty string/],
    ['an empty check', [{ id: 'a', check: '', expect: { exit: 0 } }], /check must be a non-empty string/],
    ['a non-array', { id: 'a', check: 'true' }, /must hold a JSON array/],
    ['invalid JSON', '[{"id": "a", "check": ', /not valid JSON/],
    ['a non-object entry', ['true'], /not an object/],
  ];
  for (const [name, list, re] of cases) {
    const out = outDir('invalid');
    // A canary beside the valid entries: were anything run, this file would appear.
    const withCanary = Array.isArray(list) ? list.concat([{ id: 'zz-valid', check: 'echo ran', expect: { exit: 0 } }]) : list;
    const r = run(['--checks', checksFile(withCanary), '--out', out]);
    check(name + ' exits 1 with one stderr line naming the problem and no stdout', r.status === 1 && r.stdout === '' && re.test(r.stderr) && r.stderr.trim().split('\n').length === 1, r.status + ' ' + r.stdout + ' ' + r.stderr);
    check(name + ': nothing written', !fs.existsSync(out), out);
  }
  const missing = run(['--checks', path.join(sandbox, 'absent.json'), '--out', outDir('absent')]);
  check('a missing checks file exits 1', missing.status === 1 && /could not be read/.test(missing.stderr) && missing.stdout === '', missing.stderr);
  const noOut = run(['--checks', checksFile([])]);
  const unknown = run(['--checks', checksFile([]), '--out', outDir('x'), '--bogus']);
  const badTimeout = run(['--checks', checksFile([]), '--out', outDir('x'), '--timeout', 'soon']);
  check('a missing --out, an unknown flag and a bad --timeout each exit 1 with usage', noOut.status === 1 && /usage/.test(noOut.stderr) && unknown.status === 1 && /unknown argument/.test(unknown.stderr) && badTimeout.status === 1 && /--timeout/.test(badTimeout.stderr), noOut.stderr + unknown.stderr + badTimeout.stderr);
  const help = run(['--help']);
  check('--help prints usage and exits 0', help.status === 0 && /usage: node run-checks.js/.test(help.stdout), help.stdout + help.stderr);
  const empty = runChecks([], 'empty');
  check('an empty array is valid: zero checks, zero counts, exit 0', empty.status === 0 && empty.json && empty.json.checks.length === 0 && JSON.stringify(empty.json.summary) === JSON.stringify({ pass: 0, fail: 0, model: 0, error: 0 }), empty.stdout + empty.stderr);
});

// --- 7. the --out folder ---------------------------------------------------------
section('7. --out must resolve under reports/ or the temp folder, through realpath', function () {
  check('the suite found a folder outside every allowed root to test against', !!OUTSIDE_DIR, 'none of home, /usr, /etc qualified');
  const one = [{ id: 'a', check: 'true', expect: { exit: 0 } }];
  // Under reports/, given as a relative path.
  const rel = run(['--checks', checksFile(one), '--out', 'reports/relative-out']);
  check('a relative path under reports/ works', rel.status === 0 && rel.byId.a && rel.byId.a.verdict === 'pass' && fs.existsSync(path.join(proj, 'reports', 'relative-out', 'a.txt')), rel.stdout + rel.stderr);
  check('its stdoutFile is relative to the project root', rel.byId.a && rel.byId.a.stdoutFile === path.join('reports', 'relative-out', 'a.txt'), rel.byId.a && rel.byId.a.stdoutFile);
  // Under the OS temp folder, outside the project.
  const tmpOut = path.join(sandbox, 'tmp-out');
  const tmp = run(['--checks', checksFile(one), '--out', tmpOut]);
  check('a folder under os.tmpdir() works', tmp.status === 0 && tmp.byId.a && tmp.byId.a.verdict === 'pass' && fs.existsSync(path.join(tmpOut, 'a.txt')), tmp.stdout + tmp.stderr);
  check('its stdoutFile is absolute, since the folder is outside the project', tmp.byId.a && path.isAbsolute(tmp.byId.a.stdoutFile) && fs.existsSync(tmp.byId.a.stdoutFile), tmp.byId.a && tmp.byId.a.stdoutFile);
  // Outside every root: refused, never created.
  if (OUTSIDE_DIR) {
    const outside = path.join(OUTSIDE_DIR, NEVER, 'out');
    const r = run(['--checks', checksFile(one), '--out', outside]);
    check('a folder outside the roots exits 1 with the reason and no stdout', r.status === 1 && r.stdout === '' && /--out/.test(r.stderr) && /not under/.test(r.stderr), r.status + ' ' + r.stderr);
    check('the refused folder was not created', !fs.existsSync(path.join(OUTSIDE_DIR, NEVER)), outside);
    // A symlink under reports/ that lands outside: refused for where it lands.
    const link = path.join(proj, 'reports', 'link-out');
    fs.symlinkSync(OUTSIDE_DIR, link);
    const viaLink = run(['--checks', checksFile(one), '--out', 'reports/link-out']);
    check('a symlink under reports/ pointing outside is refused', viaLink.status === 1 && viaLink.stdout === '' && /--out/.test(viaLink.stderr), viaLink.status + ' ' + viaLink.stderr);
    const viaLinkSub = run(['--checks', checksFile(one), '--out', path.join('reports', 'link-out', NEVER)]);
    check('a new folder below that symlink is refused and not created', viaLinkSub.status === 1 && !fs.existsSync(path.join(OUTSIDE_DIR, NEVER)), viaLinkSub.status + ' ' + viaLinkSub.stderr);
    check('no file landed outside through the symlink', !fs.existsSync(path.join(OUTSIDE_DIR, 'a.txt')) || fs.statSync(path.join(OUTSIDE_DIR, 'a.txt')).mtimeMs < Date.now() - 60000, path.join(OUTSIDE_DIR, 'a.txt'));
  }
  // The project itself, outside reports/, is not an allowed root.
  const inProj = run(['--checks', checksFile(one), '--out', 'artifacts/out'], proj);
  // proj sits under the temp folder, so this one is allowed by the temp root;
  // the refusal is proven above with a folder outside every root.
  check('the project folder under the temp root is still accepted (the temp root covers it)', inProj.status === 0, inProj.stderr);
});

// --- 8. hostile checks: refused, nothing run, canaries intact --------------------
section('8. a check that is not read-only is refused before anything runs', function () {
  fs.mkdirSync(path.join(proj, 'x'), { recursive: true });
  write('notes.md', '- a\n- b\n- a\n- c\n');          // a tracked modification `git checkout -- .` would undo
  const fBefore = read('f.txt');
  const hostile = [
    ['rm', 'rm -rf x', /not on the read-only allow-list/],
    ['push', 'git push origin main', /not read-only/],
    ['redirect', 'echo x > f', /output redirection/],
    ['append', 'echo x >> f', /output redirection/],
    ['redirect-2', 'echo x 2> f', /output redirection/],
    ['chain-curl', 'cat f; curl http://example.com', /curl URL/],
    ['subst', '$(id)', /command substitution/],
    ['subst-canary', 'echo $(touch canary)', /command substitution/],
    ['backtick', 'echo `touch canary`', /backtick/],
    // Double quotes do not stop bash from expanding these (issue 221 Step 9 loosened the single-quoted case only).
    ['backtick-dq', 'echo "`touch canary`"', /backtick/],
    ['subst-dq', 'echo "$(touch canary)"', /command substitution/],
    ['brace-dq', 'echo "${x@P}"', /brace parameter expansion/],
    ['sed-list-e', "sed -n '1p;e touch canary' f.txt", /sed script/],
    ['brace-param', 'echo ${PATH}', /brace parameter expansion/],
    ['stamp', 'node .claude/scripts/upgrade-audit.js --stamp', /--stamp/],
    ['rollback', 'node .claude/scripts/upgrade-audit.js --rollback-to=1', /--rollback-to/],
    ['node-e', 'node -e \'require("fs").writeFileSync("canary","x")\'', /node may run only/],
    ['node-other', 'node .claude/scripts/browse.js', /node may run only/],
    ['checkout', 'git checkout -- .', /not read-only/],
    ['awk', 'awk \'BEGIN{system("touch canary")}\'', /'awk' is not on the read-only allow-list/],
    ['find-exec', 'find . -exec touch canary \\;', /find -exec/],
    ['find-delete', 'find . -delete', /find -delete/],
    ['npx', 'npx cowsay hi', /npx may run only/],
    ['sed-i', "sed -i 's/a/b/' f.txt", /sed flag '-i'/],
    ['sed-e-flag', "sed 's/a/b/e' f.txt", /sed script/],
    ['sed-w', "sed -n '1p;w canary' f.txt", /sed script/],
    ['sed-f', 'sed -f script.sed f.txt', /sed flag '-f'/],
    ['branch-D', 'git branch -D main', /git branch argument '-D'/],
    ['branch-create', 'git branch newbranch', /creates a branch/],
    ['branch-contains-D', 'git branch --contains -D main', /git branch argument '-D'/],
    ['git-c', "git -c alias.x='!touch canary' x", /git global option '-c'/],
    ['git-C', 'git -C /tmp status', /git global option '-C'/],
    ['git-output', 'git log --output=canary', /--output=canary/],
    ['git-ext-diff', 'git diff --ext-diff', /--ext-diff/],
    ['git-worktree-add', 'git worktree add ../w', /git worktree only/],
    ['git-config-set', 'git config user.name x', /git config only/],
    ['git-stash-pop', 'git stash pop', /git stash only/],
    ['rg-pre', 'rg --pre touch x', /rg --pre/],
    ['env', 'FOO=1 grep x f', /environment assignment/],
    ['newline', 'grep x f\ntouch canary', /'touch' is not on the read-only allow-list/],
    ['curl-o', 'curl -o canary http://localhost:3000', /curl -o may write only/],
    ['curl-O', 'curl -O http://localhost:3000/canary', /curl flag '-O'/],
    ['curl-d', 'curl -d a=b http://localhost:3000', /curl flag '-d'/],
    ['curl-X', 'curl -X DELETE http://localhost:3000/x', /curl flag '-X'/],
    ['curl-ext', 'curl http://example.com', /not a local dev-server address/],
    // The credential URL is built from pieces: a literal user:pass@host shape would trip the
    // pre-push tripwire (M11), which has no fixture allow-list by design (LESSONS.md).
    ['curl-at', 'curl http://' + 'u:p' + '@example.com/', /not a local dev-server address/],
    ['curl-https', 'curl https://localhost:3000/', /not a local dev-server address/],
    ['xargs', 'xargs touch', /'xargs' is not on the read-only allow-list/],
    ['bash', "bash -c 'touch canary'", /'bash' is not on the read-only allow-list/],
    ['timeout', 'timeout 5 touch canary', /'timeout' is not on the read-only allow-list/],
    ['procsub', 'grep x <(touch canary)', /process substitution/],
    ['heredoc', 'cat <<EOF\ntouch canary\nEOF', /here-document/],
    ['brace', '{ touch canary; }', /brace group/],
    ['subshell', '(touch canary)', /subshell/],
    ['bg', 'touch canary &', /background operator/],
    ['sort-o', 'sort -o canary f.txt', /sort -o/],
    ['uniq-out', 'uniq f.txt canary', /uniq with an output file/],
    ['python-c', "python3 -c 'open(\"canary\",\"w\")'", /python only as/],
    ['npm-install', 'npm install left-pad', /npm only as/],
    ['make-f', 'make -f evil.mk test', /make only as/],
    ['unterminated', "grep 'x f", /unterminated quote/],
    ['whitespace', '   ', /empty command/],
  ];
  const r = runChecks(hostile.map(([id, cmd]) => ({ id, check: cmd, expect: { exit: 0 } })), 'hostile');
  check('the run itself exits 0 (the verdicts are the result)', r.status === 0 && r.json !== null, r.status + ' ' + r.stderr.slice(0, 300));
  for (const [id, cmd, re] of hostile) {
    const row = r.byId[id];
    check('refused: ' + JSON.stringify(cmd).slice(0, 60), !!row && row.verdict === 'error' && row.exit === null && row.stdoutFile === null && re.test(row.detail) && /^refused: /.test(row.detail), row ? JSON.stringify(row) : 'no row');
  }
  check('one stderr line per refusal', r.stderr.trim().split('\n').length === hostile.length && hostile.every(([id]) => new RegExp('^run-checks: ' + id + ': refused: ', 'm').test(r.stderr)), r.stderr.split('\n').length + ' lines');
  check('no output file was written for any refused check', fs.readdirSync(r.out).length === 0, fs.readdirSync(r.out).join(','));
  check('the summary counts every one as error', r.json.summary.error === hostile.length && r.json.summary.pass === 0 && r.json.summary.fail === 0 && r.json.summary.model === 0, JSON.stringify(r.json.summary));
  check('canary: no `canary` file exists', !exists('canary'));
  check('canary: no `f` file exists (echo x > f)', !exists('f'));
  check('canary: the `x` folder survived rm -rf', exists('x'));
  check('canary: f.txt is byte-identical (sed -i, find -delete)', read('f.txt') === fBefore);
  check('canary: the tracked modification survived git checkout -- .', /- c\n$/.test(read('notes.md')));
  check('canary: the main branch still exists', git(['rev-parse', '--verify', 'main']).trim().length === 40 || git(['rev-parse', '--verify', 'main']).trim().length === 64);
  check('canary: no branch was created', git(['branch', '--list']).trim().split('\n').length === 1, git(['branch', '--list']));
});

// --- 9. the guard, unit level: the allowed shapes the prompts will use ----------
section('9. the guard accepts the read-only shapes the call sites will write', function () {
  const { guardCheck } = require(SCRIPT);
  const allowed = [
    "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/",
    'curl -sS -I -m 2 http://127.0.0.1:5173',
    'curl -f --max-time 5 -H "Accept: text/html" http://[::1]:8080/health',
    'node .claude/scripts/session-init.js --scope',
    'node .claude/scripts/merge-findings.js reports/x/findings.jsonl',
    'node .claude/scripts/upgrade-audit.js --since 7.6.0',
    'npm test --if-present',
    'npm run test:unit',
    'npm run lint',
    'npx vitest run',
    'python3 -m pytest -q',
    'go test ./...',
    'cargo test',
    'make test',
    "sed -n '/^## Must-check for review/,/^## /p' plans/PLAN-x.md",
    "sed -E 's|^- ||' notes.md",
    'sed -n -e 1p -e 3p f.txt',
    'grep -m1 -oE "Commit: [0-9a-f]+" CODEBASE_MAP.md',
    'git rev-list --count abc..HEAD',
    'git branch --list "wip-*"',
    'git branch --contains HEAD',
    'git worktree list --porcelain',
    'git config --get user.name',
    'git stash list',
    'git --no-pager diff --stat HEAD~1',
    'find . -name "*.md" -newer README.md',
    'rg -n "TODO" src',
    'test -f artifacts/html/review.html && echo present',
    'wc -l < f.txt',
    'ls -la reports/ | head -5',
    'echo "a && b || c; d | e" ',
    'jq -r ".files | length" scope.json',
    'cat f.txt 2>&1 | wc -l',
    'lsof -i :3000',
  ];
  for (const c of allowed) check('allowed: ' + c, guardCheck(c) === null, guardCheck(c));
  check('the allow-list refuses an unknown word by name', /first word 'perl' is not on the read-only allow-list/.test(guardCheck('perl -e 1')), guardCheck('perl -e 1'));
  // The toolkit's scripts at the places a plugin install has them (issue 221): the
  // plugin build writes ${CLAUDE_PLUGIN_ROOT}/scripts/ into every shipped prompt, and
  // the stable path under the home folder is what the rules name for a fallback.
  const pluginForms = [
    'node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js --scope',
    'node ~/.claude/plugins/data/tk-llm-peer-review/current/scripts/merge-findings.js reports/x/findings.jsonl',
    'node $HOME/.claude/plugins/data/tk-llm-peer-review/current/scripts/pre-push-check.js origin main',
    'echo ${CLAUDE_PLUGIN_ROOT}',
  ];
  for (const c of pluginForms) check('allowed (plugin path): ' + c, guardCheck(c) === null, guardCheck(c));
  const pluginRefused = [
    ['node ${CLAUDE_PLUGIN_ROOT}/scripts/other.js', /node may run only/],
    ['node ${OTHER_ROOT}/scripts/session-init.js', /brace parameter expansion/],
    ['echo ${CLAUDE_PLUGIN_ROOT@P}', /brace parameter expansion/],
    ['echo ${CLAUDE_PLUGIN_ROOT}${X}', /brace parameter expansion/],
    ['node ~/.claude/plugins/data/tk-llm-peer-review/current/scripts/upgrade-audit.js --stamp', /writes the audit record/],
    ['node /tmp/evil/.claude/plugins/data/tk-llm-peer-review/current/scripts/session-init.js', /node may run only/],
    ['node ~/.claude/plugins/data/tk-llm-peer-review/current/scripts/../../../../x.js', /node may run only/],
    ['grep x \u0001', /control character/],
  ];
  for (const [c, re] of pluginRefused) check('refused (plugin path): ' + c.replace('\u0001', '<SOH>'), re.test(guardCheck(c) || ''), guardCheck(c));
});

// --- 10. the render check: a runner-written receipt reaches the review page ------
// The first live run of the review through the runner (issue 221 Step 9, the
// quality-check harness) refused three real receipts: a grep pattern quoting a
// markdown backtick in single quotes, and two sed -n prints of two ranges. Single
// quotes make bash treat every character literally, so the forms are read-only.
section('9b. single-quoted expansions are literal text and a sed ; list of prints is one print', function () {
  write('md.txt', 'Delete `data/notes.json` first\nThen $(nothing) and ${nothing}\n');
  const r = runChecks([
    { id: 'sq-backtick', check: "grep -c 'Delete `data/notes.json`' md.txt", expect: { match: '^1$' } },
    { id: 'sq-subst', check: "grep -c '$(nothing)' md.txt", expect: { match: '^1$' } },
    { id: 'sq-brace', check: "grep -c '${nothing}' md.txt", expect: { match: '^1$' } },
    { id: 'sq-canary', check: "echo '$(touch canary)' '`touch canary`'", expect: { match: 'touch canary' } },
    { id: 'escaped-backtick', check: 'echo \\`id\\`', expect: { match: '^`id`$' } },
    { id: 'sed-two-ranges', check: "sed -n '1p;3,3p' f.txt", expect: { lines: { min: 2, max: 2 } } },
    { id: 'sed-point-then-range', check: "sed -n '2p;1,1p' f.txt", expect: { match: '^world$' } },
  ], 'literal');
  const ids = ['sq-backtick', 'sq-subst', 'sq-brace', 'sq-canary', 'escaped-backtick', 'sed-two-ranges', 'sed-point-then-range'];
  check('every single-quoted or escaped expansion and every sed print list runs and passes', ids.every((id) => r.byId[id] && r.byId[id].verdict === 'pass'), verdicts(r, ids));
  check('the single-quoted substitutions were printed as text, not run', /\$\(touch canary\) `touch canary`/.test(savedFile(r, 'sq-canary') || ''), savedFile(r, 'sq-canary'));
  check('canary: nothing in single quotes ran', !exists('canary'));
  check('the two-range sed printed exactly the two lines', (savedFile(r, 'sed-two-ranges') || '').startsWith('hello\nhello\n'), savedFile(r, 'sed-two-ranges'));
});

section('10. a receipt file the runner wrote renders at the review page\'s receipt slot', function () {
  const receiptsOut = path.join('reports', 'receipts', 'run-checks-test');
  const r = run(['--checks', checksFile([{ id: 'R1', check: 'grep -n hello f.txt', expect: { exit: 0 } }]), '--out', receiptsOut]);
  check('the receipt check passed and was saved under reports/receipts/', r.status === 0 && r.byId.R1 && r.byId.R1.verdict === 'pass' && r.byId.R1.stdoutFile === path.join(receiptsOut, 'R1.txt'), r.stdout + r.stderr);
  const payload = {
    title: 'run-checks render test',
    groups: [{ label: 'code', findings: [{
      id: 'R1', severity: 'warn', specialist: 'code',
      file: { relPath: 'f.txt', line: 1 },
      what: 'Should fix. The greeting repeats, so the reader sees it twice.',
      fix: 'Drop one line. One minute, or keep the echo.',
      receipt: { cmd: 'grep -n hello f.txt', stdoutFile: r.byId.R1.stdoutFile, exit: r.byId.R1.exit },
    }] }],
  };
  const dataPath = path.join(sandbox, 'payload.json');
  fs.writeFileSync(dataPath, JSON.stringify(payload));
  const outDirHtml = path.join(proj, 'artifacts', 'html');
  const rr = spawnSync(process.execPath, [RENDER, '--shell', 'review', '--name', 'run-checks-test', '--out-dir', outDirHtml, '--stable', '--data', dataPath],
    { cwd: proj, encoding: 'utf8', env: ENV });
  const pagePath = (rr.stdout || '').trim();
  check('render-html.js renders the payload from the project folder', rr.status === 0 && pagePath && fs.existsSync(pagePath), rr.status + ' ' + rr.stdout + ' ' + rr.stderr);
  const html = pagePath && fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : '';
  // The page is a data island plus the shell's renderer: read the island.
  function dataIsland(text) {
    const re = /<script[^>]*\bid=["']render-data["'][^>]*>/g;
    let m, last = null;
    while ((m = re.exec(text)) !== null) last = m;
    if (!last) return null;
    const start = last.index + last[0].length;
    return text.slice(start, text.indexOf('</script>', start));
  }
  let finding = null;
  try {
    const island = JSON.parse(dataIsland(html));
    finding = (island.groups || []).reduce((a, g) => a.concat(g.findings || []), [])[0] || null;
  } catch (e) { finding = null; }
  check('the finding carries the receipt the renderer read off the runner\'s file', !!finding && !!finding.receipt && Array.isArray(finding.receipt.stdout) && finding.receipt.stdout.join('\n') === '1:hello\n3:hello', finding ? JSON.stringify(finding.receipt) : 'no finding; stderr: ' + rr.stderr);
  check('the exit line became the receipt\'s exit and left the output', !!finding && finding.receipt && finding.receipt.exit === 0 && !finding.receipt.stdout.some((l) => /^exit \d+$/.test(l)), finding ? JSON.stringify(finding.receipt) : '');
  check('the page text contains the receipt output', html.indexOf('1:hello') !== -1 && html.indexOf('3:hello') !== -1);
  check('the local path never reaches the page', !!finding && finding.receipt && finding.receipt.stdoutFile === undefined && html.indexOf('reports/receipts/run-checks-test/R1.txt') === -1);
  check('the renderer did not refuse or drop the receipt', !/receipt .* (refused|dropped|unreadable)/.test(rr.stderr), rr.stderr);
});

console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach((f) => console.log('  - ' + f));
process.exit(1);
