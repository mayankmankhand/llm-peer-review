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
// The same environment with no plugin root: the ${CLAUDE_PLUGIN_ROOT} literal
// is inert text for the guard only while the variable is absent.
const ENV_NO_PLUGIN = Object.assign({}, ENV);
delete ENV_NO_PLUGIN.CLAUDE_PLUGIN_ROOT;

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
// `env` replaces the child's environment (ENV by default).
function run(args, cwd, env) {
  const r = spawnSync(process.execPath, [SCRIPT].concat(args), { cwd: cwd || proj, encoding: 'utf8', env: env || ENV });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
  const byId = {};
  if (json && Array.isArray(json.checks)) for (const c of json.checks) byId[c.id] = c;
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json, byId };
}
function runChecks(list, label, extra, env) {
  const out = outDir(label);
  const r = run(['--checks', checksFile(list), '--out', out].concat(extra || []), null, env);
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
    // The IPv6 address carries a [, which bash would glob: it must be quoted (review of 7.6.3, R1).
    'curl -f --max-time 5 -H "Accept: text/html" "http://[::1]:8080/health"',
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
  // Judged with the variable absent: once it is set, the literal becomes that folder and is fenced (section 11).
  for (const c of pluginForms) check('allowed (plugin path): ' + c, guardCheck(c, undefined, ENV_NO_PLUGIN) === null, guardCheck(c, undefined, ENV_NO_PLUGIN));
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

// Review of issue 221 (2026-10-09), R2: the allowed readers took any path on the
// machine, so a steered finder could carry a secret into a receipt. Reads are
// confined to the project root; the shell's ways out (~, $HOME, .., a symlink)
// are refused; a pattern that looks like a path but names nothing still passes.
section('9c. reads stay inside the project root', function () {
  const { guardCheck } = require(SCRIPT);
  check('the suite found a folder outside the project to read from', !!OUTSIDE_DIR);
  if (OUTSIDE_DIR) {
    try { fs.symlinkSync(OUTSIDE_DIR, path.join(proj, 'link-out')); } catch (e) { /* exists */ }
    const hostile = [
      ['abs-read', 'ls ' + OUTSIDE_DIR, /outside the project root/],
      ['parent-read', 'ls ..', /outside the project root/],
      ['stdin-read', 'grep -c x <' + OUTSIDE_DIR, /outside the project root/],
      ['home-read', 'cat ~/.bashrc', /home-relative path/],
      ['var-read', 'cat $HOME/.bashrc', /home-relative path/],
      ['var-read-dq', 'cat "$HOME/.bashrc"', /home-relative path/],
      ['var-path', 'ls $PATH', /variable expansion/],
      ['var-exit', 'echo $?', /variable expansion/],
      ['symlink-out', 'ls link-out', /outside the project root/],
      ['git-C-out', 'git -C ' + OUTSIDE_DIR + ' log -1', /outside the project root|git global option/],
    ];
    const r = runChecks(hostile.map(([id, cmd]) => ({ id, check: cmd, expect: { exit: 0 } })), 'reads');
    for (const [id, cmd, re] of hostile) {
      const row = r.byId[id];
      check('refused read: ' + JSON.stringify(cmd).slice(0, 60), !!row && row.verdict === 'error' && row.stdoutFile === null && re.test(row.detail), row ? JSON.stringify(row) : 'no row');
    }
    check('no output file was written for any refused read', fs.readdirSync(r.out).length === 0, fs.readdirSync(r.out).join(','));
  }
  // A path that names nothing on this machine passes to the shell, which fails on its own; that is not a leak, so it is not refused.
  const allowed = ["grep -c '/api/' f.txt", 'cat /dev/null', 'cat ./f.txt', 'test -f f.txt', 'grep -n hello ./notes.md', "sed -n '/hello/p' f.txt", 'git log -1 --format=%H -- f.txt'];
  for (const c of allowed) check('allowed read: ' + c, guardCheck(c, proj) === null, guardCheck(c, proj));
  const ra = runChecks(allowed.map((c, i) => ({ id: 'ok-' + i, check: c, expect: 'ran' })), 'reads-ok');
  check('every allowed read ran (verdict model, never error)', allowed.every((c, i) => ra.byId['ok-' + i] && ra.byId['ok-' + i].verdict === 'model'), JSON.stringify(ra.json && ra.json.summary));
  // The node script path is nodeRule's, so the plugin folder's copies still run.
  check('the stable plugin path form is still allowed', guardCheck('node ~/.claude/plugins/data/tk-llm-peer-review/current/scripts/session-init.js --models', proj) === null, guardCheck('node ~/.claude/plugins/data/tk-llm-peer-review/current/scripts/session-init.js --models', proj));
  check('the plugin root form is still allowed', guardCheck('node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js --models', proj) === null, guardCheck('node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js --models', proj));
});

// R1: a must-not-match or line-count check used to pass when the command itself
// failed (the error went to the saved output, the pattern was absent). Now a
// negative or counting expectation needs a command that ran cleanly, and lines
// counts stdout only. R18: an output past the 16 MB buffer is its own outcome.
section('9d. a failed command never confirms an absence or a count; an overflow is not a timeout', function () {
  const r = runChecks([
    { id: 'nomatch-misspelled', check: 'grep -c zzz missing.txt', expect: { noMatch: 'zzz' } },
    { id: 'nomatch-cat-missing', check: 'cat missing.txt', expect: { noMatch: 'zzz' } },
    { id: 'nomatch-clean', check: 'grep -c zzz f.txt', expect: { noMatch: 'zzz' } },
    { id: 'nomatch-exit0', check: 'cat f.txt', expect: { noMatch: 'zzz' } },
    { id: 'lines-misspelled', check: 'grep -n hello missing.txt', expect: { lines: { min: 1 } } },
    { id: 'lines-stdout-only', check: 'grep -n hello f.txt', expect: { lines: { min: 2, max: 2 } } },
    { id: 'match-still-plain', check: 'grep -n hello missing.txt', expect: { match: 'No such file' } },
  ], 'ran');
  const v = (id) => r.byId[id] && r.byId[id].verdict;
  check('noMatch fails on a misspelled path (grep exit 2)', v('nomatch-misspelled') === 'fail' && r.byId['nomatch-misspelled'].exit === 2, JSON.stringify(r.byId['nomatch-misspelled']));
  check('noMatch fails on a missing file read (exit 1 with an error on stderr)', v('nomatch-cat-missing') === 'fail', JSON.stringify(r.byId['nomatch-cat-missing']));
  check('noMatch passes on a clean no-match (grep exit 1, nothing on stderr)', v('nomatch-clean') === 'pass', JSON.stringify(r.byId['nomatch-clean']));
  check('noMatch passes on a clean exit 0', v('nomatch-exit0') === 'pass', JSON.stringify(r.byId['nomatch-exit0']));
  check('lines fails on a misspelled path instead of counting the error line', v('lines-misspelled') === 'fail', JSON.stringify(r.byId['lines-misspelled']));
  check('lines counts stdout lines only', v('lines-stdout-only') === 'pass', JSON.stringify(r.byId['lines-stdout-only']));
  check('match still reads the whole saved output, stderr included', v('match-still-plain') === 'pass', JSON.stringify(r.byId['match-still-plain']));
  const big = path.join(proj, 'big.txt');
  fs.writeFileSync(big, Buffer.alloc(17 * 1024 * 1024, 0x61));
  const o = runChecks([{ id: 'overflow', check: 'cat big.txt', expect: { exit: 0 } }], 'overflow');
  fs.rmSync(big, { force: true });
  const row = o.byId.overflow;
  check('an output past the buffer is a fail with exit 143, not a timeout', !!row && row.verdict === 'fail' && row.exit === 143, JSON.stringify(row));
  check('its detail and its saved file say the buffer was passed', /passed the 16 MB buffer/.test(row ? row.detail : '') && /passed the 16 MB buffer/.test(savedFile(o, 'overflow') || '') && /\[truncated\]/.test(savedFile(o, 'overflow') || '') && lastLine(savedFile(o, 'overflow') || '') === 'exit 143', (savedFile(o, 'overflow') || '').slice(-200));
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

// Review of 7.6.3 (2026-10-09), R1: the guard judged the tokenizer's words but
// bash ran the original text, so anything bash expanded after the guard looked
// (an ANSI-C quote, the ${CLAUDE_PLUGIN_ROOT} literal while unset, $HOME inside
// a word, an unquoted wildcard, a --flag=value) reached a file the fence never
// saw. Now bash runs a line rebuilt from the judged words with every word in
// single quotes, and the spellings that relied on bash expanding are refused.
// R6: pipefail, so an early stage's failure is the pipeline's. R7: a quoted
// tilde and a grep pattern are text, not paths. R9: the other test wrappers.
section('11. bash runs the judged words: expansions refused or inert, pipefail, patterns are text, more wrappers', function () {
  const { tokenize, guardCheck, rebuildCommand } = require(SCRIPT);
  // A canary beside the project: inside the sandbox (so the suite cleans it
  // up), outside the project root (so the fence must refuse it).
  const canaryDir = path.join(sandbox, 'canary');
  fs.mkdirSync(canaryDir, { recursive: true });
  const CANARY = 'CANARY-MARK-' + process.pid + '-' + Date.now();
  const canaryFile = path.join(canaryDir, 'secret.txt');
  fs.writeFileSync(canaryFile, CANARY + '\n');
  // HOME is the sandbox for these runs, so /$HOME/canary/secret.txt (bash: a
  // double slash, the same file) would reach the canary without touching the
  // real home folder.
  const homeIsSandbox = Object.assign({}, ENV_NO_PLUGIN, { HOME: sandbox });
  const pluginIsCanary = Object.assign({}, ENV_NO_PLUGIN, { CLAUDE_PLUGIN_ROOT: canaryDir });
  const noFileHolds = (r, needle) => fs.readdirSync(r.out).every((f) => fs.readFileSync(path.join(r.out, f), 'utf8').indexOf(needle) === -1);

  // --- the expansion spellings: each refused, the canary never read ---
  const expansions = [
    ['ansi-c', "cat $'" + canaryFile + "'", /ANSI-C or locale quoting/],
    ['locale', 'cat $"' + canaryFile + '"', /ANSI-C or locale quoting/],
    ['home-in-word', 'cat /$HOME/canary/secret.txt', /\$HOME inside a word/],
    ['home-in-word-dq', 'cat "/$HOME/canary/secret.txt"', /\$HOME inside a word/],
    ['glob-star', 'cat ' + path.join(sandbox, 'canar*', 'secret.txt'), /unquoted wildcard '\*'/],
    ['glob-question', 'cat ' + path.join(sandbox, 'canar?', 'secret.txt'), /unquoted wildcard '\?'/],
    ['glob-bracket', 'cat ' + path.join(sandbox, '[c]anary', 'secret.txt'), /unquoted wildcard '\['/],
    ['flag-value', 'diff --from-file=' + canaryFile + ' f.txt', /outside the project root/],
    ['flag-value-short', 'cat -x=' + canaryFile, /outside the project root/],
    ['ipv6-unquoted', 'curl http://[::1]:8080/health', /unquoted wildcard '\['/],
  ];
  const re = runChecks(expansions.map(([id, cmd]) => ({ id, check: cmd, expect: { exit: 0 } })), 'expansions', [], homeIsSandbox);
  check('the expansion run itself exits 0', re.status === 0 && re.json !== null, re.status + ' ' + re.stderr.slice(0, 300));
  for (const [id, cmd, rx] of expansions) {
    const row = re.byId[id];
    check('refused expansion: ' + JSON.stringify(cmd).slice(0, 70), !!row && row.verdict === 'error' && row.exit === null && row.stdoutFile === null && rx.test(row.detail), row ? JSON.stringify(row) : 'no row');
  }
  check('no saved file at all for the refused spellings', fs.readdirSync(re.out).length === 0, fs.readdirSync(re.out).join(','));
  // The plugin-root literal with the variable SET names the canary folder: fenced like any other path.
  const rp = runChecks([
    { id: 'plugin-set', check: 'cat ${CLAUDE_PLUGIN_ROOT}/secret.txt', expect: { exit: 0 } },
    { id: 'plugin-set-dq', check: 'cat "${CLAUDE_PLUGIN_ROOT}/secret.txt"', expect: { exit: 0 } },
    { id: 'plugin-set-echo', check: 'echo ${CLAUDE_PLUGIN_ROOT}', expect: { exit: 0 } },
  ], 'plugin-set', [], pluginIsCanary);
  for (const id of ['plugin-set', 'plugin-set-dq', 'plugin-set-echo']) {
    check('with CLAUDE_PLUGIN_ROOT set, ' + id + ' is fenced as the folder it names', !!rp.byId[id] && rp.byId[id].verdict === 'error' && /outside the project root/.test(rp.byId[id].detail), JSON.stringify(rp.byId[id]));
  }
  check('guard level: echo ${CLAUDE_PLUGIN_ROOT} is allowed with the variable absent and fenced when it names an outside folder', guardCheck('echo ${CLAUDE_PLUGIN_ROOT}', proj, {}) === null && /outside the project root/.test(guardCheck('echo ${CLAUDE_PLUGIN_ROOT}', proj, { CLAUDE_PLUGIN_ROOT: canaryDir }) || ''), guardCheck('echo ${CLAUDE_PLUGIN_ROOT}', proj, { CLAUDE_PLUGIN_ROOT: canaryDir }));
  // The plugin-root literal with the variable UNSET: bash used to expand it to
  // nothing and read the absolute remainder; now it is inert quoted text.
  const ru = runChecks([
    { id: 'plugin-unset-path', check: 'cat ${CLAUDE_PLUGIN_ROOT}' + canaryFile, expect: { exit: 0 } },
    { id: 'plugin-unset-echo', check: 'echo ${CLAUDE_PLUGIN_ROOT}', expect: { match: '^\\$\\{CLAUDE_PLUGIN_ROOT\\}$' } },
  ], 'plugin-unset', [], ENV_NO_PLUGIN);
  check('unset: the literal plus an absolute path ran as literal text and failed to open it', !!ru.byId['plugin-unset-path'] && ru.byId['plugin-unset-path'].verdict === 'fail' && ru.byId['plugin-unset-path'].exit !== 0 && /No such file/.test(savedFile(ru, 'plugin-unset-path') || ''), JSON.stringify(ru.byId['plugin-unset-path']) + ' ' + JSON.stringify(savedFile(ru, 'plugin-unset-path')));
  check('unset: echo prints the literal itself, so bash never expanded it', !!ru.byId['plugin-unset-echo'] && ru.byId['plugin-unset-echo'].verdict === 'pass', JSON.stringify(savedFile(ru, 'plugin-unset-echo')));
  check('canary: no saved file of these runs holds the canary text', noFileHolds(re, CANARY) && noFileHolds(rp, CANARY) && noFileHolds(ru, CANARY));

  // --- the rebuilt line keeps what the check meant ---
  const line = (t) => { const p = tokenize(t); return p.error ? p.error : rebuildCommand(p, ENV_NO_PLUGIN).line; };
  check('rebuild: every word single-quoted, an input redirection kept', line('grep -c hello < f.txt') === "'grep' '-c' 'hello' < 'f.txt'", line('grep -c hello < f.txt'));
  check('rebuild: 2>&1 stays on its segment, the pipe is kept', line('cat missing.txt 2>&1 | wc -l') === "'cat' 'missing.txt' 2>&1 | 'wc' '-l'", line('cat missing.txt 2>&1 | wc -l'));
  check('rebuild: redirections keep their original order', line('cat f.txt 2>/dev/null 2>&1') === "'cat' 'f.txt' 2>/dev/null 2>&1" && line('cat f.txt 2>&1 2>/dev/null') === "'cat' 'f.txt' 2>&1 2>/dev/null", line('cat f.txt 2>/dev/null 2>&1'));
  check('rebuild: a quote inside a word becomes the four characters', line("echo \"it's\"") === "'echo' 'it'\\''s'", line("echo \"it's\""));
  check('rebuild: ; and newline lists and && || chains keep their operators', line('echo one; echo two') === "'echo' 'one' ; 'echo' 'two'" && line('echo one\necho two') === "'echo' 'one'\n'echo' 'two'" && line('test -f f.txt && echo yes || echo no') === "'test' '-f' 'f.txt' && 'echo' 'yes' || 'echo' 'no'", line('test -f f.txt && echo yes || echo no'));
  const divs = tokenize("grep -c '<div>' f.txt");
  check("tokenize: a quoted '<div>' is a pattern, not an input redirection", !divs.error && divs.meta[0][2].input === false && divs.meta[0][2].quoted === true && divs.meta[0][2].quote === "'", JSON.stringify(divs));
  const spaced = tokenize('wc -l <   f.txt');
  check('tokenize: an unquoted < followed by spaces binds to the next word', !spaced.error && spaced.meta[0][2].input === true && spaced.segments[0][2] === '<f.txt', JSON.stringify(spaced));
  const ops = tokenize('a | b || c && d; e\nf');
  check('tokenize: operators are recorded per segment', !ops.error && JSON.stringify(ops.operators) === JSON.stringify(['|', '||', '&&', ';', '\n', null]), JSON.stringify(ops.operators));
  const rb = runChecks([
    { id: 'input-redirect', check: 'grep -c hello < f.txt', expect: { match: '^2$' } },
    { id: 'input-redirect-spaced', check: 'wc -l <   f.txt', expect: { match: '^3$' } },
    { id: 'stderr-quiet', check: 'grep hello missing.txt 2>/dev/null', expect: { exit: 2 } },
    { id: 'stderr-piped', check: 'grep hello missing.txt 2>&1 | wc -l', expect: { match: '^1$' } },
    { id: 'list', check: 'echo one; echo two', expect: { lines: { min: 2, max: 2 } } },
    { id: 'newline-list', check: 'echo one\necho two', expect: { lines: { min: 2, max: 2 } } },
    { id: 'pipeline', check: 'cat f.txt | grep hello | wc -l', expect: { match: '^2$' } },
    { id: 'and-or', check: 'test -f f.txt && echo yes || echo no', expect: { match: '^yes$' } },
    { id: 'quote-in-word', check: 'echo "it\'s"', expect: { match: "^it's$" } },
    { id: 'dq-backslash-kept', check: 'echo "a\\nb"', expect: { match: '^a\\\\nb$' } },
    { id: 'dq-backslash-dollar', check: 'echo "\\$X"', expect: { match: '^\\$X$' } },
    { id: 'quoted-div', check: "grep -c '<div>' f.txt", expect: { exit: 1 } },
    { id: 'bracket-test', check: '[ -f f.txt ]', expect: { exit: 0 } },
  ], 'rebuild');
  const rbIds = ['input-redirect', 'input-redirect-spaced', 'stderr-quiet', 'stderr-piped', 'list', 'newline-list', 'pipeline', 'and-or', 'quote-in-word', 'dq-backslash-kept', 'dq-backslash-dollar', 'quoted-div', 'bracket-test'];
  check('every rebuilt form ran and passed', rbIds.every((id) => rb.byId[id] && rb.byId[id].verdict === 'pass'), verdicts(rb, rbIds) + ' ' + rbIds.map((id) => id + ':' + JSON.stringify(savedFile(rb, id))).join(' '));
  check('2>/dev/null suppressed the error: the saved file is only the exit line', savedFile(rb, 'stderr-quiet') === 'exit 2\n', JSON.stringify(savedFile(rb, 'stderr-quiet')));
  check('2>&1 carried the error through the pipe', (savedFile(rb, 'stderr-piped') || '').startsWith('1\n'), JSON.stringify(savedFile(rb, 'stderr-piped')));
  check('the ; list printed both lines in order', (savedFile(rb, 'list') || '').startsWith('one\ntwo\n'), JSON.stringify(savedFile(rb, 'list')));

  // --- pipefail: an early stage's failure is the pipeline's exit code ---
  fs.writeFileSync(path.join(proj, 'big-lines.txt'), 'a\n'.repeat(600000));
  const pf = runChecks([
    { id: 'pipefail-nomatch', check: 'grep hello missing.txt | head -5', expect: { noMatch: 'zzz' } },
    { id: 'pipefail-lines', check: 'grep hello missing.txt | head -5', expect: { lines: { max: 5 } } },
    { id: 'pipefail-clean', check: 'grep hello f.txt | head -5', expect: { lines: { min: 2, max: 2 } } },
    { id: 'sigpipe', check: 'cat big-lines.txt | head -1', expect: { lines: { min: 1, max: 1 } } },
  ], 'pipefail');
  fs.rmSync(path.join(proj, 'big-lines.txt'), { force: true });
  check('noMatch fails when grep over a missing file is piped to head (exit 2, not head\'s 0)', !!pf.byId['pipefail-nomatch'] && pf.byId['pipefail-nomatch'].verdict === 'fail' && pf.byId['pipefail-nomatch'].exit === 2, JSON.stringify(pf.byId['pipefail-nomatch']));
  check('lines fails for the same pipeline', !!pf.byId['pipefail-lines'] && pf.byId['pipefail-lines'].verdict === 'fail', JSON.stringify(pf.byId['pipefail-lines']));
  check('a clean pipeline still passes', !!pf.byId['pipefail-clean'] && pf.byId['pipefail-clean'].verdict === 'pass', JSON.stringify(pf.byId['pipefail-clean']));
  check('a stage cut short by head (exit 141, silent stderr) is a clean run', !!pf.byId.sigpipe && pf.byId.sigpipe.verdict === 'pass' && pf.byId.sigpipe.exit === 141, JSON.stringify(pf.byId.sigpipe));

  // --- R7: a quoted tilde and a grep pattern are text ---
  write('docs.md', 'The plugin lives at ~/.claude/plugins/data/tk-llm-peer-review/current\n');
  const tp = runChecks([
    { id: 'tilde-pattern-dq', check: 'grep -n "~/.claude/plugins/data" docs.md', expect: { match: '^1:' } },
    { id: 'tilde-pattern-sq', check: "grep -c '~/.claude' docs.md", expect: { match: '^1$' } },
    { id: 'tilde-quoted-file', check: 'cat "~/.bashrc"', expect: { exit: 0 } },
    { id: 'home-single-quoted', check: "cat '$HOME/.bashrc'", expect: { exit: 0 } },
    { id: 'outside-as-pattern', check: 'grep -c ' + OUTSIDE_DIR + ' f.txt', expect: { exit: 1 } },
  ], 'patterns');
  check('a double-quoted tilde pattern is allowed and finds the line', !!tp.byId['tilde-pattern-dq'] && tp.byId['tilde-pattern-dq'].verdict === 'pass', JSON.stringify(tp.byId['tilde-pattern-dq']));
  check('a single-quoted tilde pattern is allowed and runs', !!tp.byId['tilde-pattern-sq'] && tp.byId['tilde-pattern-sq'].verdict === 'pass', JSON.stringify(tp.byId['tilde-pattern-sq']));
  check('a quoted ~ file name is literal text: bash looks for a file spelled ~, finds none', !!tp.byId['tilde-quoted-file'] && tp.byId['tilde-quoted-file'].verdict === 'fail' && /No such file/.test(savedFile(tp, 'tilde-quoted-file') || ''), JSON.stringify(savedFile(tp, 'tilde-quoted-file')));
  check("a single-quoted $HOME is literal text as well", !!tp.byId['home-single-quoted'] && tp.byId['home-single-quoted'].verdict === 'fail' && /No such file/.test(savedFile(tp, 'home-single-quoted') || ''), JSON.stringify(savedFile(tp, 'home-single-quoted')));
  check('an existing outside folder as the grep pattern is allowed and runs', !!tp.byId['outside-as-pattern'] && tp.byId['outside-as-pattern'].verdict === 'pass', JSON.stringify(tp.byId['outside-as-pattern']));
  check('unquoted ~ and double-quoted $HOME at word start stay refused', /home-relative/.test(guardCheck('cat ~/.bashrc', proj) || '') && /home-relative/.test(guardCheck('cat "$HOME/.bashrc"', proj) || '') && /home-relative/.test(guardCheck('cat $HOME/.bashrc', proj) || ''), guardCheck('cat ~/.bashrc', proj));
  const patternAllowed = [
    'grep -c ' + OUTSIDE_DIR + ' f.txt',
    'grep -e ' + OUTSIDE_DIR + ' f.txt',
    'grep --regexp ' + OUTSIDE_DIR + ' f.txt',
    'grep --regexp=' + OUTSIDE_DIR + ' f.txt',
    'grep -m 1 ' + OUTSIDE_DIR + ' f.txt',
    'grep -- ' + OUTSIDE_DIR + ' f.txt',
    'rg -n ' + OUTSIDE_DIR + ' f.txt',
    'rg -e ' + OUTSIDE_DIR + ' f.txt',
  ];
  for (const c of patternAllowed) check('pattern position exempt: ' + c, guardCheck(c, proj) === null, guardCheck(c, proj));
  const patternRefused = [
    'test -d ' + OUTSIDE_DIR,
    'ls ' + OUTSIDE_DIR,
    'grep -c x ' + OUTSIDE_DIR,
    'grep -e x ' + OUTSIDE_DIR,
    'grep -f ' + OUTSIDE_DIR + ' f.txt',
    'grep -f' + OUTSIDE_DIR + ' f.txt',
    'grep --file ' + OUTSIDE_DIR + ' f.txt',
    'grep --file=' + OUTSIDE_DIR + ' f.txt',
    'grep -c x <' + OUTSIDE_DIR,
    'rg -f ' + OUTSIDE_DIR + ' f.txt',
  ];
  for (const c of patternRefused) check('file position judged: ' + c, /outside the project root/.test(guardCheck(c, proj) || ''), guardCheck(c, proj));

  // --- R9: the ecosystem wrappers ---
  const wrappers = ['yarn test', 'yarn run test', 'pnpm test', 'pnpm run test', 'bun test', 'uv run pytest', 'uv run python -m pytest',
    'poetry run pytest', 'poetry run python -m pytest', 'bundle exec rspec', 'bundle exec rake test', 'dotnet test'];
  for (const c of wrappers) check('wrapper allowed: ' + c, guardCheck(c, proj) === null, guardCheck(c, proj));
  const rw = runChecks(wrappers.map((c, i) => ({ id: 'w-' + i, check: c, expect: { exit: 0 } })), 'wrappers', ['--timeout', '60000']);
  check('every wrapper ran: verdict pass or fail, never an error naming the allow-list', wrappers.every((c, i) => rw.byId['w-' + i] && (rw.byId['w-' + i].verdict === 'pass' || rw.byId['w-' + i].verdict === 'fail')), verdicts(rw, wrappers.map((c, i) => 'w-' + i)) + ' ' + rw.stderr.slice(0, 300));
  const hostileWrappers = [
    ['uv run python evil.py', /uv only as/], ['uv run evil', /uv only as/], ['uv pip install x', /uv only as/],
    ['poetry run python evil.py', /poetry only as/], ['poetry install', /poetry only as/],
    ['bundle exec rm -rf x', /bundle only as/], ['bundle exec rake db:drop', /bundle only as/], ['bundle install', /bundle only as/],
    ['yarn add left-pad', /yarn only as/], ['yarn run build', /yarn only as/],
    ['pnpm install', /pnpm only as/], ['pnpm run build', /pnpm only as/],
    ['bun run evil.js', /bun only as/], ['bun install', /bun only as/],
    ['dotnet run', /dotnet only as/], ['dotnet tool install x', /dotnet only as/],
  ];
  for (const [c, rx] of hostileWrappers) check('wrapper refused: ' + c, rx.test(guardCheck(c, proj) || ''), guardCheck(c, proj));

  // --- node with the plugin literal: resolved by the runner from the environment ---
  const nodeCheck = [{ id: 'models', check: 'node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js --models', expect: { match: '^\\{' } }];
  const nu = runChecks(nodeCheck, 'node-unset', [], ENV_NO_PLUGIN);
  check('with CLAUDE_PLUGIN_ROOT absent the node check is refused with the not-set reason, nothing run', !!nu.byId.models && nu.byId.models.verdict === 'error' && /CLAUDE_PLUGIN_ROOT is not set/.test(nu.byId.models.detail) && nu.byId.models.stdoutFile === null && fs.readdirSync(nu.out).length === 0, JSON.stringify(nu.byId.models));
  const nr = runChecks(nodeCheck, 'node-relative', [], Object.assign({}, ENV_NO_PLUGIN, { CLAUDE_PLUGIN_ROOT: 'relative/plugin' }));
  check('a relative CLAUDE_PLUGIN_ROOT is refused as well', !!nr.byId.models && nr.byId.models.verdict === 'error' && /not an absolute path/.test(nr.byId.models.detail), JSON.stringify(nr.byId.models));
  const pluginDir = path.join(sandbox, 'plugin');
  fs.mkdirSync(path.join(pluginDir, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(REPO, '.claude', 'scripts', 'session-init.js'), path.join(pluginDir, 'scripts', 'session-init.js'));
  const ns = runChecks(nodeCheck, 'node-set', [], Object.assign({}, ENV_NO_PLUGIN, { CLAUDE_PLUGIN_ROOT: pluginDir }));
  check('with CLAUDE_PLUGIN_ROOT set to a folder holding the script, the node check runs and prints the models object', !!ns.byId.models && ns.byId.models.verdict === 'pass' && ns.byId.models.exit === 0 && /"models"/.test(savedFile(ns, 'models') || ''), JSON.stringify(ns.byId.models) + ' ' + (savedFile(ns, 'models') || '').slice(0, 200));
  check('canary: the canary text never reached a saved file in this section', [re, rp, ru, rb, pf, tp, rw, nu, nr, ns].every((r) => noFileHolds(r, CANARY)));
});

// Second round of the 7.6.3 review (2026-10-09): adversarial skeptics got past
// the first fix two ways. A symlinked folder followed by .. (`cat d/../x`, d a
// link to the project): path.resolve cancelled `d/..` lexically, the result
// named a file that did not exist, so realpath never looked at the link, while
// the kernel followed it and read the project's parent. And sort's
// --compress-program, which runs a program the check names on every spilled
// temp file, in the = and the separate-word spelling. Closing them also closed
// the spellings in the same class: getopt's unambiguous prefixes (sort --out=,
// --co=), grep's attached short-option values (-e. puts the pattern inside the
// cluster and the outside file into the exempt slot), and control characters
// (a NUL made spawnSync throw). Every probe the skeptics ran is a fixture: the
// refused ones with their reason and nothing saved, the inert ones run to show
// they read nothing outside, the controls run to show the fence is not wider
// than it needs to be.
section('12. second round: a symlink then .., sort exec flags, option prefixes, attached values', function () {
  const { tokenize, guardCheck } = require(SCRIPT);
  // The canary beside the project (sandbox/canary.txt is proj/..), a folder
  // beside it, the links the probes used, and the sort probe's "compressor".
  const CANARY2 = 'CANARY-ROUND2-' + process.pid + '-' + Date.now();
  fs.writeFileSync(path.join(sandbox, 'canary.txt'), CANARY2 + '\n');
  fs.mkdirSync(path.join(sandbox, 'outside'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'outside', 'canary.txt'), CANARY2 + '\n');
  fs.mkdirSync(path.join(proj, 'sub'), { recursive: true });
  write('a.txt', 'alpha\n');
  write('sub/b.txt', 'beta\n');
  const link = (at, to) => { try { fs.symlinkSync(to, path.join(proj, at)); } catch (e) { /* exists */ } };
  link('d', proj);                                             // a link to the project itself
  link('dir-out', path.join(sandbox, 'outside'));              // a link to a folder outside
  link('sub/link.txt', path.join(sandbox, 'canary.txt'));      // a link to the outside file
  link('link-in.txt', path.join(proj, 'a.txt'));               // a link that stays inside
  write('logger.sh', '#!/bin/sh\necho hit >> PWNED_MARKER.txt\ncat\n');
  fs.chmodSync(path.join(proj, 'logger.sh'), 0o755);
  write('big.txt', Array.from({ length: 3000 }, (_, i) => String(i)).join('\n') + '\n');   // -S 1k makes sort spill this
  const noFileHolds = (r, needle) => fs.readdirSync(r.out).every((f) => fs.readFileSync(path.join(r.out, f), 'utf8').indexOf(needle) === -1);
  const outsideRe = /outside the project root/;
  const pluginIsOutside = Object.assign({}, ENV_NO_PLUGIN, { CLAUDE_PLUGIN_ROOT: path.join(sandbox, 'outside') });

  // --- refused: each with its reason, nothing run, nothing saved ---
  const refused = [
    // the confirmed bypasses: a symlink then .. (lexical collapse), in every prefix shape
    ['sym-collapse', 'cat d/../canary.txt', outsideRe],
    ['sym-grep', 'grep CANARY d/../canary.txt', outsideRe],
    ['sym-double', 'cat d/d/../../canary.txt', outsideRe],
    ['sym-dir-out', 'cat dir-out/../outside/canary.txt', outsideRe],
    ['sym-sub-escape', 'cat sub/../dir-out/../outside/canary.txt', outsideRe],
    ['sym-dotslash', 'cat ./dir-out/../outside/canary.txt', outsideRe],
    ['sym-two-up', 'cat dir-out/../../outside/canary.txt', outsideRe],
    ['sym-dir-direct', 'cat dir-out/canary.txt', outsideRe],
    ['sym-file', 'cat sub/link.txt', outsideRe],
    ['sym-realpath', 'realpath dir-out', outsideRe],
    ['sym-readlink', 'readlink -f sub/link.txt', outsideRe],
    ['sym-stat', 'stat sub/link.txt', outsideRe],
    // the parent folder in every quoting the skeptics tried
    ['parent-plain', 'cat ../canary.txt', outsideRe],
    ['parent-sq', "cat '../canary.txt'", outsideRe],
    ['parent-dq', 'cat "../canary.txt"', outsideRe],
    ['parent-escaped', 'cat \\.\\./canary.txt', outsideRe],
    ['parent-mixed', "cat ..'/'canary.txt", outsideRe],
    ['parent-input', "cat < '../canary.txt'", outsideRe],
    ['parent-glued', 'cat x<../canary.txt', outsideRe],
    ['parent-second', 'cat a.txt ../canary.txt', outsideRe],
    ['parent-sub', 'cat sub/../../canary.txt', outsideRe],
    ['parent-outside-dir', 'cat ../outside/canary.txt', outsideRe],
    ['parent-abs', 'cat ' + path.join(sandbox, 'outside', 'canary.txt'), outsideRe],
    ['ansi-c', "cat $'../canary.txt'", /ANSI-C or locale quoting/],
    ['locale', 'cat $"../canary.txt"', /ANSI-C or locale quoting/],
    ['dq-escaped-home', 'cat "\\$HOME/x"', /home-relative path/],
    ['tilde', 'cat ~/.claude/x', /home-relative path/],
    ['home', 'cat $HOME/.bashrc', /home-relative path/],
    ['home-dq', 'cat "$HOME/.bashrc"', /home-relative path/],
    // control characters and lookalike separators
    ['nul', 'cat a.txt\u0000../canary.txt', /control character/],
    ['esc', 'cat \u001b../canary.txt', /control character/],
    ['vtab', 'cat\u000b../canary.txt', /control character/],
    ['nbsp', 'cat\u00a0../canary.txt', /not on the read-only allow-list/],
    // redirection shapes that are not one of the safe forms
    ['fd-quoted', "cat a.txt'2'>&1", /output redirection/],
    ['fd-3', 'cat a.txt 3>/dev/null', /output redirection/],
    ['devnullx', 'cat a.txt >/dev/nullx', /output redirection/],
    ['amp-path', 'cat a.txt &>/dev/null/../../x', /background operator/],
    // file-valued flags, in the = and attached spellings, and grep's cluster forms
    ['flag-value', 'diff --from-file=../canary.txt a.txt', outsideRe],
    ['grep-f', 'grep -f ../canary.txt a.txt', outsideRe],
    ['grep-file-eq', 'grep --file=../canary.txt a.txt', outsideRe],
    ['grep-f-attached', 'grep -f../canary.txt a.txt', outsideRe],
    ['grep-nf-attached', 'grep -nf../canary.txt a.txt', outsideRe],
    ['grep-e-attached', 'grep -e. ../canary.txt', outsideRe],
    ['grep-ne-attached', 'grep -ne. ../canary.txt', outsideRe],
    ['grep-reg-prefix', 'grep --reg=a ../canary.txt', outsideRe],
    ['grep-reg-prefix-sep', 'grep --reg a ../canary.txt', outsideRe],
    ['grep-e-file', 'grep -e alpha ../canary.txt', outsideRe],
    ['rg-ignore-file', 'rg --ignore-file ../canary.txt alpha .', outsideRe],
    ['rg-pre', 'rg --pre ./logger.sh alpha a.txt', /rg --pre/],
    ['cut', 'cut -f1 ../canary.txt', outsideRe],
    ['tail', 'tail -c 100 ../canary.txt', outsideRe],
    ['sed', 'sed -n 1p ../canary.txt', outsideRe],
    ['find-parent', 'find .. -name canary.txt', outsideRe],
    ['git-config-file', 'git config --get --file ../canary.txt user.name', outsideRe],
    ['git-config-file-eq', 'git config --get --file=../canary.txt user.name', outsideRe],
    // the confirmed bypass: sort runs the program a check names; its prefixes; its temp folder
    ['sort-compress-eq', 'sort -S 1k --compress-program=./logger.sh big.txt', /sort --compress-program/],
    ['sort-compress-sep', 'sort -S 1k --compress-program ./logger.sh big.txt', /sort --compress-program/],
    ['sort-compress-gzip', 'sort -S 1k --compress-program=gzip big.txt', /sort --compress-program/],
    ['sort-compress-false', 'sort -S 1k --compress-program=false big.txt', /sort --compress-program/],
    ['sort-compress-sh', 'sort --compress-program=/bin/sh big.txt', /sort --compress-program/],
    ['sort-compress-prefix', 'sort -S 1k --co=./logger.sh big.txt', /sort --compress-program/],
    ['sort-out-prefix', 'sort --out=canary a.txt', /sort -o/],
    ['sort-o', 'sort -o out.txt a.txt', /sort -o/],
    ['sort-mo', 'sort -mo out.txt a.txt', /sort -o/],
    ['sort-output', 'sort --output=out.txt a.txt', /sort -o/],
    ['sort-T', 'sort -T .. a.txt', /sort -T/],
    ['sort-T-prefix', 'sort --temp=.. a.txt', /sort -T/],
    ['git-out-prefix', 'git log --out=canary', /writes a file or runs a program/],
    ['git-ext-prefix', 'git diff --ext', /writes a file or runs a program/],
    // the rest of the skeptics' guard-only list, so the whole list stays green together
    ['make-f', 'make -f ../Makefile test', /make only as/],
    ['wildcard-star', 'cat *.txt', /unquoted wildcard '\*'/],
    ['wildcard-bracket', 'cat [a].txt', /unquoted wildcard '\['/],
    ['brace', 'cat {a,sub/b}.txt', /brace group/],
    ['uniq-out', 'uniq a.txt out.txt', /uniq with an output file/],
    ['curl-o', 'curl -o out.txt http://localhost/', /curl -o may write only/],
    ['procsub', 'diff a.txt <(cat a.txt)', /process substitution/],
    ['sed-w', 'sed -n -e 1p -e w/tmp/x a.txt', /sed script/],
    ['node-evil', 'node evil.js', /node may run only/],
    ['npm-build', 'npm run build', /npm only as/],
    ['npx-webpack', 'npx webpack', /npx may run only/],
  ];
  const rr = runChecks(refused.map(([id, cmd]) => ({ id, check: cmd, expect: { exit: 0 } })), 'round2-refused', [], ENV_NO_PLUGIN);
  check('the refused run itself exits 0 with one JSON object', rr.status === 0 && rr.json !== null, rr.status + ' ' + rr.stderr.slice(0, 300));
  for (const [id, cmd, rx] of refused) {
    const row = rr.byId[id];
    check('refused: ' + JSON.stringify(cmd).slice(0, 70), !!row && row.verdict === 'error' && row.exit === null && row.stdoutFile === null && rx.test(row.detail) && /^refused: /.test(row.detail), row ? JSON.stringify(row) : 'no row');
  }
  check('nothing was saved for any refused check', fs.readdirSync(rr.out).length === 0, fs.readdirSync(rr.out).join(','));
  check('canary: sort never ran the logger (no PWNED_MARKER.txt), wrote no out.txt and no canary', !exists('PWNED_MARKER.txt') && !exists('out.txt') && !exists('canary'));
  check('with CLAUDE_PLUGIN_ROOT set to the outside folder, the literal is fenced as that folder', outsideRe.test(guardCheck('cat ${CLAUDE_PLUGIN_ROOT}/canary.txt', proj, pluginIsOutside) || ''), guardCheck('cat ${CLAUDE_PLUGIN_ROOT}/canary.txt', proj, pluginIsOutside));
  check('tokenize: a NUL byte is refused before spawnSync could throw on it', /control character/.test(tokenize('cat a.txt\u0000x').error || ''), JSON.stringify(tokenize('cat a.txt\u0000x')));

  // --- inert: allowed by the guard, run, and read nothing outside ---
  const inert = [
    ['dq-newline', 'cat "a.txt\ncat ../canary.txt"', 'fail'],         // one literal filename with a newline in it
    ['continuation', 'cat a.txt \\\n../canary.txt', 'fail'],         // the escaped newline is a literal character of the third word
    ['dq-ansi', 'cat "$\'x\'"', 'fail'],                               // $' inside double quotes is literal text
    ['escaped-backtick', 'cat \\`id\\`', 'fail'],                      // the literal filename `id`
    ['fullwidth-dots', 'cat \uff0e\uff0e/canary.txt', 'fail'],         // a lookalike, not ..
    ['sq-semicolon', "echo 'a;cat ../canary.txt'", 'pass'],            // operators in single quotes are text
    ['sq-pipe', "echo 'a|cat ../canary.txt'", 'pass'],
    ['sq-home', "cat '$HOME/x'", 'fail'],
    ['plugin-unset', 'cat ${CLAUDE_PLUGIN_ROOT}/canary.txt', 'fail'],  // inert literal while the variable is unset
    ['missing-then-up', 'cat nonexist/../a.txt', 'fail'],              // the guard stays lexical past a missing prefix; the kernel stops there
  ];
  const ri = runChecks(inert.map(([id, cmd, v]) => ({ id, check: cmd, expect: v === 'pass' ? { match: 'cat \\.\\./canary\\.txt' } : { exit: 0 } })), 'round2-inert', [], ENV_NO_PLUGIN);
  for (const [id, cmd, v] of inert) {
    const row = ri.byId[id];
    const saved = savedFile(ri, id) || '';
    check('inert: ' + JSON.stringify(cmd).slice(0, 60) + ' runs as literal text (' + v + ')', !!row && row.verdict === v && (v === 'pass' || /No such file/.test(saved)), row ? JSON.stringify(row) + ' ' + JSON.stringify(saved) : 'no row');
  }
  check('canary: no inert run read the canary', noFileHolds(ri, CANARY2) && noFileHolds(rr, CANARY2));

  // --- controls: the fence is no wider than it needs to be ---
  const controls = [
    ['legit', 'cat a.txt', { match: '^alpha$' }],
    ['link-in', 'cat link-in.txt', { match: '^alpha$' }],
    ['normalized-inside', 'cat ./sub/../a.txt', { match: '^alpha$' }],
    ['input-inside', 'cat < a.txt', { match: '^alpha$' }],
    ['grep-m', 'grep -m 1 alpha a.txt', { match: '^alpha$' }],
    ['grep-e-sep', 'grep -e alpha a.txt', { match: '^alpha$' }],
    ['grep-e-attached-inside', 'grep -ealpha a.txt', { match: '^alpha$' }],
    ['grep-cluster-count', 'grep -nm1 alpha a.txt', { match: '^1:alpha$' }],
    ['sort-plain', 'sort a.txt', { match: '^alpha$' }],
    ['sort-random', 'sort --random-source=/dev/urandom -R a.txt', { exit: 0 } ],
    ['sort-files0', 'sort --files0-from=a.txt', 'reads a.txt as a list of names'],
    ['dev-null', 'cat /dev/null', { exit: 0 }],
    ['dev-stdin', 'cat /dev/stdin', { exit: 0 }],
  ];
  const rc = runChecks(controls.map(([id, cmd, expect]) => ({ id, check: cmd, expect })), 'round2-controls', [], ENV_NO_PLUGIN);
  for (const [id, cmd, expect] of controls) {
    const row = rc.byId[id];
    const want = typeof expect === 'string' ? 'model' : 'pass';
    check('control: ' + cmd + ' is ' + want, !!row && row.verdict === want, row ? JSON.stringify(row) + ' ' + JSON.stringify(savedFile(rc, id)) : 'no row');
  }
  check('canary: no control read the canary', noFileHolds(rc, CANARY2));
  for (const l of ['d', 'dir-out', 'sub/link.txt', 'link-in.txt']) { try { fs.unlinkSync(path.join(proj, l)); } catch (e) { /* gone */ } }
  for (const f of ['logger.sh', 'big.txt']) fs.rmSync(path.join(proj, f), { force: true });
});

console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach((f) => console.log('  - ' + f));
process.exit(1);
