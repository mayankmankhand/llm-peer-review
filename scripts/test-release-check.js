#!/usr/bin/env node
'use strict';
// test-release-check.js - assertions for scripts/release-check.js, the
// maintainer-only release gate, and for scripts/git-hooks/pre-push and
// scripts/setup/install-hooks.sh that wire it into `git push` (issue #175).
//
// Every case builds a scratch git repo under the OS temp directory (with a
// local user.email/user.name) holding a minimal plugin/.claude-plugin/plugin.json,
// .claude-plugin/marketplace.json, and stub suites passed with --suites, so a
// run never reads or writes this repo's history. The hook is tested with its
// two scripts swapped for stubs (TK_PRE_PUSH_CHECK, TK_RELEASE_CHECK) that log
// that they ran. release-check.js excludes this file from its default suite
// set, so the gate never runs its own test.
//
// Dependency-free; exits non-zero on any failure.
//
//   node scripts/test-release-check.js

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'release-check.js');
const HOOK = path.join(ROOT, 'scripts', 'git-hooks', 'pre-push');
const INSTALL = path.join(ROOT, 'scripts', 'setup', 'install-hooks.sh');
const ZERO = '0'.repeat(40);

// Run under a git hook from a linked worktree, GIT_DIR would point the
// scratch repos below at the real one. Clear git's repo-local variables first.
for (const k of ['GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX',
  'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR']) delete process.env[k];

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failures.push(name + (detail ? ' - ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' - ' + String(detail).slice(0, 600) : '')); }
}
function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
// Every temp dir is recorded and removed on exit, pass or fail.
const tempDirs = [];
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); tempDirs.push(d); return d; };
process.on('exit', () => {
  for (const d of tempDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
});
function git(repo, args) { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function initRepo(repo) {
  git(repo, ['init', '-q']); git(repo, ['config', 'user.email', 't@t']); git(repo, ['config', 'user.name', 't']);
  git(repo, ['config', 'commit.gpgsign', 'false']); git(repo, ['config', 'tag.gpgsign', 'false']);
}
function commitAll(repo, msg) { git(repo, ['add', '-A']); git(repo, ['commit', '-qm', msg]); }
function run(repo, args, env) {
  const r = spawnSync('node', [SCRIPT, '--repo', repo, ...args], { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
// The one output line for a named check, e.g. line(out, 'version bump').
function line(out, name) {
  return out.split('\n').find(l => /^ {2}(ok {3}|FAIL )/.test(l) && l.slice(7).startsWith(name + ' - ')) || '';
}
const isOk = (out, name) => line(out, name).startsWith('  ok   ');
const isFail = (out, name) => line(out, name).startsWith('  FAIL ');

function gitSubdir(ref) { return { source: 'git-subdir', url: 'example/toolkit', path: 'plugin', ref }; }
function setPlugin(repo, version, source) {
  write(repo, 'plugin/.claude-plugin/plugin.json', JSON.stringify({ name: 'tk', version }, null, 2) + '\n');
  write(repo, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'fixture', plugins: [{ name: 'tk', source, description: 'd' }] }, null, 2) + '\n');
}
function makeRepo(version, source) {
  const repo = tmp('release-check-');
  initRepo(repo);
  setPlugin(repo, version, source);
  write(repo, 'plugin/commands/explore.md', '# Explore\n');
  write(repo, 'stubs/pass.js', "console.log('all good');\nprocess.exit(0);\n");
  // A failure that prints a passing-looking summary: only the exit code counts.
  write(repo, 'stubs/fail.js', "console.log('Results: 12 passed, 0 failed');\nprocess.exit(1);\n");
  commitAll(repo, 'initial');
  return repo;
}

// --- 3. version bump -------------------------------------------------------------
{
  const repo = makeRepo('1.0.0', gitSubdir('v1.0.0'));
  let r = run(repo, ['--skip-suites']);
  check('no tags: version bump passes with a note', isOk(r.out, 'version bump') && /no v\* release tag/.test(line(r.out, 'version bump')), r.out);
  check('no tags, matching ref: whole run exits 0', r.status === 0, r.out);
  check('scratch repo without build-plugin.js: build check skipped cleanly', isOk(r.out, 'build') && /skipped: no scripts\/build-plugin\.js/.test(line(r.out, 'build')), r.out);
  check('--skip-suites: suites line says skipped', isOk(r.out, 'suites') && /skipped/.test(line(r.out, 'suites')), r.out);

  git(repo, ['tag', 'v1.0.0']);
  r = run(repo, ['--skip-suites']);
  check('tag v1.0.0, plugin/ unchanged: version bump passes', r.status === 0 && isOk(r.out, 'version bump') && /unchanged since v1\.0\.0/.test(r.out), r.out);

  // A change outside plugin/ never needs a bump.
  write(repo, 'README.md', '# readme\n'); commitAll(repo, 'docs');
  r = run(repo, ['--skip-suites']);
  check('change outside plugin/ after the tag: version bump passes', r.status === 0 && isOk(r.out, 'version bump'), r.out);

  write(repo, 'plugin/commands/explore.md', '# Explore\n\nChanged.\n'); commitAll(repo, 'change plugin');
  r = run(repo, ['--skip-suites']);
  check('plugin/ changed after v1.0.0 with version still 1.0.0: run exits 1', r.status === 1, r.out);
  check('unbumped change: version bump FAIL names the tag and the consequence',
    isFail(r.out, 'version bump') && line(r.out, 'version bump').includes('plugin/ changed since v1.0.0 without a version bump; existing installs would never receive it'), r.out);

  // Pointed at a subfolder (or run from one), the gate must still read the
  // repo root's plugin/ and scripts/, never pass on <subfolder>/plugin/.
  write(repo, 'sub/notes.md', '# notes\n');
  write(repo, 'scripts/build-plugin.js', "process.exit(process.argv.includes('--check') ? 0 : 3);\n");
  commitAll(repo, 'subfolder and build stub');
  r = run(path.join(repo, 'sub'), ['--skip-suites']);
  check('--repo naming a subfolder: unbumped plugin/ change still fails', r.status === 1 && isFail(r.out, 'version bump'), r.out);
  check('--repo naming a subfolder: build check finds the root build-plugin.js', isOk(r.out, 'build') && !/skipped/.test(line(r.out, 'build')), r.out);
  const fromSub = spawnSync('node', [SCRIPT, '--skip-suites'], { cwd: path.join(repo, 'sub'), encoding: 'utf8' });
  check('run from a subfolder without --repo: unbumped plugin/ change still fails', fromSub.status === 1 && isFail(fromSub.stdout, 'version bump'), fromSub.stdout + fromSub.stderr);
  fs.unlinkSync(path.join(repo, 'scripts/build-plugin.js')); commitAll(repo, 'drop build stub');

  // Uncommitted bump does not count: checks 3 and 4 read HEAD.
  setPlugin(repo, '1.1.0', gitSubdir('v1.1.0'));
  r = run(repo, ['--skip-suites']);
  check('bump only in the working tree: still fails (HEAD is what counts)', r.status === 1 && isFail(r.out, 'version bump'), r.out);

  commitAll(repo, 'bump to 1.1.0');
  r = run(repo, ['--skip-suites']);
  check('bumped to 1.1.0 with ref v1.1.0: run exits 0', r.status === 0, r.out);
  check('bumped: version bump ok and marketplace ref ok', isOk(r.out, 'version bump') && isOk(r.out, 'marketplace ref'), r.out);

  // --- 4. marketplace ref --------------------------------------------------------
  setPlugin(repo, '1.1.0', gitSubdir('v1.0.0')); commitAll(repo, 'stale ref');
  r = run(repo, ['--skip-suites']);
  check('ref naming a different version: run exits 1', r.status === 1, r.out);
  check('stale ref: marketplace FAIL names the expected ref v1.1.0', isFail(r.out, 'marketplace ref') && /ref is "v1\.0\.0"/.test(line(r.out, 'marketplace ref')) && /"ref": "v1\.1\.0"/.test(line(r.out, 'marketplace ref')), r.out);

  setPlugin(repo, '1.1.0', './plugin'); commitAll(repo, 'string source');
  r = run(repo, ['--skip-suites']);
  check('string source ./plugin: run exits 1', r.status === 1, r.out);
  check('string source: marketplace FAIL names the expected git-subdir source', isFail(r.out, 'marketplace ref') && /"\.\/plugin"/.test(line(r.out, 'marketplace ref')) && /"source": "git-subdir"/.test(line(r.out, 'marketplace ref')) && /"ref": "v1\.1\.0"/.test(line(r.out, 'marketplace ref')), r.out);

  setPlugin(repo, '1.1.0', { source: 'github', path: 'plugin', ref: 'v1.1.0' }); commitAll(repo, 'wrong kind');
  r = run(repo, ['--skip-suites']);
  check('object source that is not git-subdir: marketplace FAIL', r.status === 1 && isFail(r.out, 'marketplace ref') && /source is "github"/.test(line(r.out, 'marketplace ref')), r.out);

  setPlugin(repo, '1.1.0', { source: 'git-subdir', path: '.', ref: 'v1.1.0' }); commitAll(repo, 'wrong path');
  r = run(repo, ['--skip-suites']);
  check('git-subdir on the wrong path: marketplace FAIL', r.status === 1 && isFail(r.out, 'marketplace ref') && /path is "\."/.test(line(r.out, 'marketplace ref')), r.out);

  // Git's repo-local variables in the caller's env (a push from a linked
  // worktree) must not redirect the checks to another repository.
  const decoy = makeRepo('9.9.9', './plugin');
  setPlugin(repo, '1.1.0', gitSubdir('v1.1.0'));
  write(repo, 'stubs/env.js', "process.exit(process.env.GIT_DIR || process.env.GIT_WORK_TREE ? 1 : 0);\n");
  commitAll(repo, 'fixed');
  r = run(repo, ['--suites', 'stubs/env.js'], { GIT_DIR: path.join(decoy, '.git'), GIT_WORK_TREE: decoy });
  check('inherited GIT_DIR/GIT_WORK_TREE: checks still read --repo, not the decoy', isOk(r.out, 'version bump') && isOk(r.out, 'marketplace ref') && /v1\.1\.0/.test(line(r.out, 'marketplace ref')), r.out);
  check('inherited GIT_DIR/GIT_WORK_TREE: suites run without them', isOk(r.out, 'suites') && r.status === 0, r.out);
}

// --- 1. suites -------------------------------------------------------------------
{
  const repo = makeRepo('1.0.0', gitSubdir('v1.0.0'));
  let r = run(repo, ['--suites', 'stubs/fail.js']);
  check('stub suite exiting 1 that prints "0 failed": run exits 1', r.status === 1, r.out);
  check('failing stub: suites FAIL and its exit code printed', isFail(r.out, 'suites') && /stubs\/fail\.js: exit 1/.test(r.out), r.out);

  r = run(repo, ['--suites', 'stubs/pass.js']);
  check('stub suite exiting 0: run exits 0', r.status === 0, r.out);
  check('passing stub: suites ok and its exit code printed', isOk(r.out, 'suites') && /stubs\/pass\.js: exit 0/.test(r.out), r.out);

  r = run(repo, ['--suites', 'stubs/pass.js,stubs/fail.js']);
  check('comma list with one failure: suites FAIL naming only the failing suite', r.status === 1 && /1 of 2 suites exited non-zero: stubs\/fail\.js$/.test(line(r.out, 'suites')), r.out);

  write(repo, 'stubs/test-a.js', 'process.exit(0);\n');
  write(repo, 'stubs/test-b.js', 'process.exit(0);\n');
  r = run(repo, ['--suites', 'stubs/test-*.js']);
  check('glob expands to every matching stub', r.status === 0 && /stubs\/test-a\.js: exit 0/.test(r.out) && /stubs\/test-b\.js: exit 0/.test(r.out) && !/stubs\/pass\.js/.test(r.out), r.out);

  r = run(repo, ['--suites', 'stubs/nope-*.js']);
  check('glob matching nothing: suites FAIL, never a vacuous pass', r.status === 1 && isFail(r.out, 'suites'), r.out);

  r = run(repo, ['--suites', 'stubs/missing.js']);
  check('named suite that does not exist: suites FAIL', r.status === 1 && isFail(r.out, 'suites') && /missing/.test(r.out), r.out);

  write(repo, 'stubs/crash.js', "process.kill(process.pid, 'SIGKILL');\n");
  r = run(repo, ['--suites', 'stubs/crash.js']);
  check('suite killed by a signal (no exit code): suites FAIL', r.status === 1 && isFail(r.out, 'suites') && /exit signal SIGKILL/.test(r.out), r.out);

  // Default set: scripts/test-*.js without this test itself.
  write(repo, 'scripts/test-alpha.js', 'process.exit(0);\n');
  write(repo, 'scripts/test-release-check.js', 'process.exit(1);\n');
  write(repo, 'scripts/helper.js', 'process.exit(1);\n');
  r = run(repo, []);
  check('default suites: runs scripts/test-*.js and skips test-release-check.js', r.status === 0 && /scripts\/test-alpha\.js: exit 0/.test(r.out) && !/test-release-check/.test(r.out) && !/helper\.js/.test(r.out), r.out);

  r = spawnSync('node', [SCRIPT, '--repo', repo, '--bogus'], { encoding: 'utf8' });
  check('unknown argument: exit 2', r.status === 2, r.stdout + r.stderr);
}

// --- 2. build check ----------------------------------------------------------------
{
  const repo = makeRepo('1.0.0', gitSubdir('v1.0.0'));
  write(repo, 'scripts/build-plugin.js', "process.exit(process.argv.includes('--check') ? 0 : 3);\n");
  let r = run(repo, ['--skip-suites']);
  check('build-plugin.js --check exits 0: build ok', r.status === 0 && isOk(r.out, 'build') && !/skipped/.test(line(r.out, 'build')), r.out);
  write(repo, 'scripts/build-plugin.js', "console.error('build-plugin --check: differs: x');\nprocess.exit(1);\n");
  r = run(repo, ['--skip-suites']);
  check('build-plugin.js --check exits 1: build FAIL, run exits 1', r.status === 1 && isFail(r.out, 'build'), r.out);
}

// --- hook routing ------------------------------------------------------------------
const stubDir = tmp('release-hook-stubs-');
write(stubDir, 'tripwire.js', "require('fs').appendFileSync(process.env.HOOK_LOG, 'tripwire\\n');\nprocess.exit(Number(process.env.TRIPWIRE_EXIT || 0));\n");
write(stubDir, 'release.js', "require('fs').appendFileSync(process.env.HOOK_LOG, 'release\\n');\nprocess.exit(Number(process.env.RELEASE_EXIT || 0));\n");
function hookEnv(log, extra) {
  return Object.assign({}, process.env, {
    HOOK_LOG: log, TK_PRE_PUSH_CHECK: path.join(stubDir, 'tripwire.js'), TK_RELEASE_CHECK: path.join(stubDir, 'release.js'),
  }, extra || {});
}
const readLog = (log) => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).join(',') : '';
function runHook(stdin, extra) {
  const log = path.join(tmp('release-hook-log-'), 'log');
  const r = spawnSync('sh', [HOOK, 'origin', 'git@example.com:toolkit.git'], { cwd: stubDir, input: stdin, encoding: 'utf8', env: hookEnv(log, extra) });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), ran: readLog(log) };
}
{
  const SHA = 'a'.repeat(40);
  let h = runHook('refs/heads/feature ' + SHA + ' refs/heads/feature ' + ZERO + '\n');
  check('hook: feature-branch push runs the tripwire only', h.status === 0 && h.ran === 'tripwire', JSON.stringify(h));

  h = runHook('refs/tags/v1.1.0 ' + SHA + ' refs/tags/v1.1.0 ' + ZERO + '\n');
  check('hook: refs/tags/v1.1.0 push runs tripwire then release-check', h.status === 0 && h.ran === 'tripwire,release', JSON.stringify(h));

  h = runHook('refs/heads/main ' + SHA + ' refs/heads/main ' + 'b'.repeat(40) + '\n');
  check('hook: refs/heads/main push runs tripwire then release-check', h.status === 0 && h.ran === 'tripwire,release', JSON.stringify(h));

  h = runHook('(delete) ' + ZERO + ' refs/heads/main ' + SHA + '\n');
  check('hook: deleted main ref is ignored (no release-check)', h.status === 0 && h.ran === 'tripwire', JSON.stringify(h));

  h = runHook('(delete) ' + ZERO + ' refs/tags/v1.0.0 ' + SHA + '\n');
  check('hook: deleted v* tag is ignored (no release-check)', h.status === 0 && h.ran === 'tripwire', JSON.stringify(h));

  h = runHook('refs/heads/feature ' + SHA + ' refs/heads/feature ' + ZERO + '\nrefs/heads/main ' + SHA + ' refs/heads/main ' + ZERO + '\n');
  check('hook: a multi-ref push that includes main runs release-check', h.status === 0 && h.ran === 'tripwire,release', JSON.stringify(h));

  h = runHook('refs/heads/mainline ' + SHA + ' refs/heads/mainline ' + ZERO + '\nrefs/tags/release-1 ' + SHA + ' refs/tags/release-1 ' + ZERO + '\n');
  check('hook: near-miss refs (mainline, non-v tag) do not run release-check', h.status === 0 && h.ran === 'tripwire', JSON.stringify(h));

  h = runHook('refs/heads/main ' + SHA + ' refs/heads/main ' + ZERO + '\n', { TRIPWIRE_EXIT: '1' });
  check('hook: failing pre-push-check blocks with its exit code, release-check never runs', h.status === 1 && h.ran === 'tripwire', JSON.stringify(h));

  h = runHook('refs/heads/feature ' + SHA + ' refs/heads/feature ' + ZERO + '\n', { TRIPWIRE_EXIT: '2' });
  check('hook: tripwire error (exit 2) propagates as 2', h.status === 2, JSON.stringify(h));

  h = runHook('refs/tags/v1.1.0 ' + SHA + ' refs/tags/v1.1.0 ' + ZERO + '\n', { RELEASE_EXIT: '1' });
  check('hook: failing release-check blocks a tag push', h.status === 1 && h.ran === 'tripwire,release', JSON.stringify(h));

  h = runHook('refs/heads/feature ' + SHA + ' refs/heads/feature ' + ZERO + '\n', { RELEASE_EXIT: '1' });
  check('hook: a failing release-check cannot block a feature push (never run)', h.status === 0 && h.ran === 'tripwire', JSON.stringify(h));

  h = runHook('');
  check('hook: empty stdin runs the tripwire and passes', h.status === 0 && h.ran === 'tripwire', JSON.stringify(h));
}

// --- install-hooks.sh and a real git push ----------------------------------------------
{
  const repo = makeRepo('1.0.0', gitSubdir('v1.0.0'));
  write(repo, 'scripts/setup/install-hooks.sh', fs.readFileSync(INSTALL, 'utf8'));
  write(repo, 'scripts/git-hooks/pre-push', fs.readFileSync(HOOK, 'utf8'));
  fs.chmodSync(path.join(repo, 'scripts/git-hooks/pre-push'), 0o644);
  write(repo, '.git/hooks/post-commit', '#!/bin/sh\n');
  const inst = (cwd) => spawnSync('bash', [path.join(repo, 'scripts/setup/install-hooks.sh')], { cwd, encoding: 'utf8' });

  let r = inst(os.tmpdir());
  const out1 = r.stdout + r.stderr;
  check('install-hooks: exits 0', r.status === 0, out1);
  check('install-hooks: sets core.hooksPath for the clone it lives in', git(repo, ['config', '--local', '--get', 'core.hooksPath']) === 'scripts/git-hooks', out1);
  if (process.platform !== 'win32') {
    check('install-hooks: makes the hook executable', (fs.statSync(path.join(repo, 'scripts/git-hooks/pre-push')).mode & 0o111) !== 0, out1);
  }
  check('install-hooks: prints how to undo', /git config --unset core\.hooksPath/.test(out1), out1);
  check('install-hooks: warns that an existing .git/hooks hook stops running', /post-commit will no longer run/.test(out1), out1);
  r = inst(repo);
  const out2 = r.stdout + r.stderr;
  check('install-hooks: second run is a no-op and says so', r.status === 0 && /already scripts\/git-hooks \(nothing changed\)/.test(out2) && git(repo, ['config', '--local', '--get', 'core.hooksPath']) === 'scripts/git-hooks', out2);
  // Once core.hooksPath is set, `git rev-parse --git-path hooks` returns the
  // gate's own folder; the warning must keep naming .git/hooks, not the gate.
  check('install-hooks: second run never warns about the gate\'s own hook', !/git-hooks\/pre-push will no longer run/.test(out2), out2);
  check('install-hooks: second run still names the .git/hooks hook it switched off', /\.git\/hooks\/post-commit will no longer run/.test(out2), out2);

  // End to end: git itself feeds the hook, so the stdin format is git's own.
  const remote = tmp('release-remote-');
  git(remote, ['init', '-q', '--bare']);
  git(remote, ['config', 'receive.denyDeleteCurrent', 'ignore']); // the deletion case below
  const push = (args, extra) => {
    const log = path.join(tmp('release-hook-log-'), 'log');
    const p = spawnSync('git', ['push', '-q', remote, ...args], { cwd: repo, encoding: 'utf8', env: hookEnv(log, extra) });
    return { status: p.status, out: (p.stdout || '') + (p.stderr || ''), ran: readLog(log) };
  };
  git(repo, ['checkout', '-q', '-b', 'feature']);
  let p = push(['feature']);
  check('git push of a feature branch: hook ran the tripwire only', p.status === 0 && p.ran === 'tripwire', JSON.stringify(p));
  git(repo, ['tag', 'v1.0.0']);
  p = push(['refs/tags/v1.0.0'], { RELEASE_EXIT: '1' });
  const tagInRemote = git(remote, ['tag', '--list', 'v1.0.0']);
  check('git push of a v* tag with a failing release-check: push blocked, tag not published', p.status !== 0 && p.ran === 'tripwire,release' && tagInRemote === '', JSON.stringify(p));
  p = push(['refs/tags/v1.0.0']);
  check('git push of a v* tag with a passing release-check: pushed', p.status === 0 && p.ran === 'tripwire,release' && git(remote, ['tag', '--list', 'v1.0.0']) === 'v1.0.0', JSON.stringify(p));
  p = push(['feature:main']);
  check('git push to main: hook ran release-check', p.status === 0 && p.ran === 'tripwire,release', JSON.stringify(p));
  p = push([':refs/heads/main']);
  check('git push deleting main: release-check not run', p.status === 0 && p.ran === 'tripwire', JSON.stringify(p));
}

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
