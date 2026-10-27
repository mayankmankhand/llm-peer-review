#!/usr/bin/env node
'use strict';
// test-release-check.js - assertions for scripts/release-check.js, the
// maintainer-only release gate, and for scripts/git-hooks/pre-push and
// scripts/setup/install-hooks.sh that wire it into `git push` (issue #175),
// including the review fixes: the marketplace url and the release tag (R2) and
// the hook refusing a pushed ref that is not the checked-out commit (R11).
//
// Every case builds a scratch git repo under the OS temp directory (with a
// local user.email/user.name and a made-up GitHub origin that is never
// contacted) holding a minimal plugin/.claude-plugin/plugin.json,
// .claude-plugin/marketplace.json, and stub suites passed with --suites, so a
// run never reads or writes this repo's history. The hook is tested with its
// two scripts swapped for stubs (TK_PRE_PUSH_CHECK, TK_RELEASE_CHECK) that log
// that they ran, what arguments each received, and the ref lines the tripwire
// was handed on stdin (issue #178); a final few `git push` runs keep the real
// gate, to prove the pushed commit and tag reach it, and one block keeps the
// real tripwire, to prove a push of HEAD to another branch is scanned against
// that branch. The hook's seam notices (TK_* set) are asserted too. release-check.js runs this
// file as part of its default suite set; that cannot recurse, because every
// gate run below targets a scratch repo whose suites are stubs, never this
// repository (asserted at the end).
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
// Every folder the gate is pointed at, so the end of the run can prove none of
// them is this repository (the default suite set includes this file).
const gateTargets = [];
function run(repo, args, env) {
  gateTargets.push(repo);
  const r = spawnSync('node', [SCRIPT, '--repo', repo, ...args], { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
// The one output line for a named check, e.g. line(out, 'version bump').
function line(out, name) {
  return out.split('\n').find(l => /^ {2}(ok {3}|FAIL )/.test(l) && l.slice(7).startsWith(name + ' - ')) || '';
}
const isOk = (out, name) => line(out, name).startsWith('  ok   ');
const isFail = (out, name) => line(out, name).startsWith('  FAIL ');
// One line of a run's output for a failure detail: the release-check summary
// line, else the output's last 200 characters joined. Never the whole output:
// the gate shows only a failing suite's last 15 lines, and a multi-line
// detail pushes the case names out of that window (LESSONS, #250).
const summaryLine = (out) => out.split('\n').find(l => /^release-check: \d+ passed/.test(l)) || out.slice(-200).replace(/\n/g, ' ');

// The scratch repos' origin, which the gate reads as "this repository". Only
// its name is ever used; nothing talks to it.
const ORIGIN = 'https://github.com/example/toolkit.git';
function gitSubdir(ref) { return { source: 'git-subdir', url: 'example/toolkit', path: 'plugin', ref }; }
function setPlugin(repo, version, source) {
  write(repo, 'plugin/.claude-plugin/plugin.json', JSON.stringify({ name: 'tk', version }, null, 2) + '\n');
  write(repo, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'fixture', plugins: [{ name: 'tk', source, description: 'd' }] }, null, 2) + '\n');
}
function makeRepo(version, source) {
  const repo = tmp('release-check-');
  initRepo(repo);
  git(repo, ['remote', 'add', 'origin', ORIGIN]);
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
  check('no tags: version bump passes with a note', isOk(r.out, 'version bump') && /no earlier v\* release tag/.test(line(r.out, 'version bump')), r.out);
  check('no tags, matching ref: only the release tag check fails (v1.0.0 not tagged yet)',
    r.status === 1 && isOk(r.out, 'marketplace ref') && isFail(r.out, 'release tag') && /tag v1\.0\.0 does not exist locally/.test(line(r.out, 'release tag')) && (r.out.match(/^ {2}FAIL /mg) || []).length === 1, r.out);
  check('scratch repo without build-plugin.js: build check skipped cleanly', isOk(r.out, 'build') && /skipped: no scripts\/build-plugin\.js/.test(line(r.out, 'build')), r.out);
  check('--skip-suites: suites line says skipped', isOk(r.out, 'suites') && /skipped/.test(line(r.out, 'suites')), r.out);

  git(repo, ['tag', 'v1.0.0']);
  r = run(repo, ['--skip-suites']);
  // The tag on HEAD is the commit's own release, never the one it is compared with.
  check('only tag v1.0.0 is on HEAD itself: version bump passes as a first release', r.status === 0 && isOk(r.out, 'version bump') && /no earlier v\* release tag/.test(line(r.out, 'version bump')), r.out);

  // A change outside plugin/ never needs a bump.
  write(repo, 'README.md', '# readme\n'); commitAll(repo, 'docs');
  r = run(repo, ['--skip-suites']);
  check('change outside plugin/ after the tag: version bump passes, plugin/ unchanged since v1.0.0', r.status === 0 && isOk(r.out, 'version bump') && /unchanged since v1\.0\.0/.test(line(r.out, 'version bump')), r.out);

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
  check('bumped to 1.1.0 but v1.1.0 not tagged: release tag FAIL', r.status === 1 && isFail(r.out, 'release tag') && isOk(r.out, 'version bump'), r.out);
  git(repo, ['tag', 'v1.1.0']);
  r = run(repo, ['--skip-suites']);
  check('bumped to 1.1.0 with ref v1.1.0, tagged: run exits 0', r.status === 0 && isOk(r.out, 'release tag'), r.out);
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

// --- 3. the release commit itself, pushed tags, and --commit ------------------------
// A release repo: base commit at `baseVersion` tagged v<baseVersion>, then one
// commit that changes plugin/ and sets `version` (marketplace ref to match),
// optionally tagged `tag` (annotated when `annotated`).
function releaseRepo(version, tag, opt) {
  const o = Object.assign({ baseVersion: '1.0.0', annotated: false }, opt || {});
  const repo = makeRepo(o.baseVersion, gitSubdir('v' + o.baseVersion));
  git(repo, ['tag', 'v' + o.baseVersion]);
  write(repo, 'plugin/commands/explore.md', '# Explore\n\nChanged.\n');
  setPlugin(repo, version, gitSubdir('v' + version));
  commitAll(repo, 'release ' + version);
  if (tag) git(repo, o.annotated ? ['tag', '-a', '-m', 'release', tag] : ['tag', tag]);
  return repo;
}
{
  let repo = releaseRepo('1.1.0', 'v1.1.0');
  let r = run(repo, ['--skip-suites']);
  check('release commit tagged v1.1.0, plugin/ changed since v1.0.0, version 1.1.0: passes against v1.0.0',
    r.status === 0 && isOk(r.out, 'version bump') && /changed since v1\.0\.0 and plugin\.json moved 1\.0\.0 -> 1\.1\.0/.test(line(r.out, 'version bump')), r.out);

  // The case the HEAD-tag comparison missed: describe returned v1.0.1 itself,
  // the diff was empty, and the unbumped release passed.
  repo = releaseRepo('1.0.0', 'v1.0.1');
  r = run(repo, ['--skip-suites']);
  check('release commit tagged v1.0.1 with version still 1.0.0: version bump FAIL against v1.0.0 (missed case)',
    r.status === 1 && isFail(r.out, 'version bump') && line(r.out, 'version bump').includes('plugin/ changed since v1.0.0 without a version bump'), r.out);
  repo = releaseRepo('1.0.0', 'v1.0.1', { annotated: true });
  r = run(repo, ['--skip-suites']);
  check('same missed case with an annotated tag: version bump FAIL', r.status === 1 && isFail(r.out, 'version bump') && /since v1\.0\.0 without/.test(line(r.out, 'version bump')), r.out);

  repo = releaseRepo('0.9.0', 'v0.9.0');
  r = run(repo, ['--skip-suites']);
  check('downgrade 1.0.0 -> 0.9.0 with plugin/ changed: version bump FAIL',
    r.status === 1 && isFail(r.out, 'version bump') && /moved backwards 1\.0\.0 -> 0\.9\.0/.test(line(r.out, 'version bump')), r.out);

  repo = releaseRepo('1.1.0', 'v1.1.0', { baseVersion: '1.1.0-rc.1' });
  r = run(repo, ['--skip-suites']);
  check('release 1.1.0 after prerelease tag v1.1.0-rc.1: version bump passes (release outranks its prerelease)', r.status === 0 && isOk(r.out, 'version bump') && /since v1\.1\.0-rc\.1/.test(line(r.out, 'version bump')), r.out);
  repo = releaseRepo('1.1.0-rc.1', 'v1.1.0-rc.1', { baseVersion: '1.1.0' });
  r = run(repo, ['--skip-suites']);
  check('prerelease 1.1.0-rc.1 after v1.1.0: version bump FAIL (backwards)', r.status === 1 && isFail(r.out, 'version bump') && /moved backwards/.test(line(r.out, 'version bump')), r.out);

  // --- pushed tags ---
  repo = releaseRepo('1.1.0', 'v1.1.0');
  const release = git(repo, ['rev-parse', 'HEAD']);
  r = run(repo, ['--skip-suites', '--pushing-tag', 'v1.1.0']);
  check('--pushing-tag v1.1.0 on a 1.1.0 commit: tag version ok, run exits 0', r.status === 0 && isOk(r.out, 'tag version') && isOk(r.out, 'version bump') && /tag v1\.1\.0/.test(line(r.out, 'version bump')), r.out);
  r = run(repo, ['--skip-suites', '--pushing-tag', 'v1.2.0:' + release]);
  check('--pushing-tag v1.2.0 while that commit\'s version is 1.1.0: tag version FAIL, run exits 1',
    r.status === 1 && isFail(r.out, 'tag version') && /pushed tag v1\.2\.0 does not match plugin\.json version 1\.1\.0/.test(line(r.out, 'tag version')) && /expected tag v1\.1\.0/.test(line(r.out, 'tag version')), r.out);
  git(repo, ['tag', 'v1.2.0']);
  r = run(repo, ['--skip-suites', '--pushing-tag', 'v1.2.0']);
  check('--pushing-tag v1.2.0 naming a local tag on the 1.1.0 commit: tag version FAIL', r.status === 1 && isFail(r.out, 'tag version'), r.out);
  git(repo, ['tag', '-d', 'v1.2.0']);
  r = run(repo, ['--skip-suites', '--pushing-tag', 'v1.3.0']);
  check('--pushing-tag naming no local tag and no sha: tag version FAIL (cannot resolve)', r.status === 1 && isFail(r.out, 'tag version') && /cannot resolve/.test(line(r.out, 'tag version')), r.out);
  r = run(repo, ['--skip-suites', '--pushing-tag', 'v1.1.0:']);
  check('--pushing-tag with an empty sha: usage error exit 2', r.status === 2, r.out);

  // A later, unbumped commit at HEAD: the tag and --commit runs must read the
  // commit they name, not HEAD.
  write(repo, 'plugin/commands/explore.md', '# Explore\n\nChanged again.\n'); commitAll(repo, 'unbumped change');
  const unbumped = git(repo, ['rev-parse', 'HEAD']);
  r = run(repo, ['--skip-suites']);
  check('HEAD is an unbumped change after v1.1.0: default run fails', r.status === 1 && isFail(r.out, 'version bump') && /^ {2}FAIL version bump - HEAD: /.test(line(r.out, 'version bump')), r.out);
  r = run(repo, ['--skip-suites', '--pushing-tag', 'v1.1.0']);
  check('--pushing-tag v1.1.0 while HEAD is past it: checks 3 and 4 read the tagged commit and pass', r.status === 0 && isOk(r.out, 'version bump') && isOk(r.out, 'marketplace ref'), r.out);
  r = run(repo, ['--skip-suites', '--commit', release]);
  check('--commit <release sha> while HEAD is an unbumped change: passes (reads that commit)', r.status === 0 && isOk(r.out, 'version bump') && line(r.out, 'version bump').includes('commit ' + release.slice(0, 12)), r.out);
  git(repo, ['checkout', '-q', '--detach', release]);
  r = run(repo, ['--skip-suites']);
  check('detached at the release commit: default HEAD run passes', r.status === 0, r.out);
  r = run(repo, ['--skip-suites', '--commit', unbumped]);
  check('--commit <unbumped sha> while HEAD is the good release: fails (reads that commit)', r.status === 1 && isFail(r.out, 'version bump') && /since v1\.1\.0 without a version bump/.test(line(r.out, 'version bump')), r.out);
  r = run(repo, ['--skip-suites', '--commit', 'f'.repeat(40)]);
  check('--commit naming an unknown object: version bump and marketplace FAIL', r.status === 1 && isFail(r.out, 'version bump') && isFail(r.out, 'marketplace ref') && /cannot resolve/.test(line(r.out, 'version bump')), r.out);
  r = run(repo, ['--skip-suites', '--commit', release, '--pushing-tag', 'v1.1.0:' + release]);
  const bumpLines = r.out.split('\n').filter(l => /^ {2}(ok {3}|FAIL )version bump - /.test(l));
  check('--commit and --pushing-tag on the same commit: checked once, labelled with both', r.status === 0 && bumpLines.length === 1 && /tag v1\.1\.0, commit /.test(bumpLines[0]), r.out);
}

// --- 4 and 5. marketplace url and release tag (R2) -----------------------------------
{
  const repo = releaseRepo('1.1.0', 'v1.1.0');
  const withUrl = (url) => { const s = gitSubdir('v1.1.0'); if (url === undefined) delete s.url; else s.url = url; return s; };
  const commitUrl = (url, msg) => { setPlugin(repo, '1.1.0', withUrl(url)); git(repo, ['add', '-A']); git(repo, ['commit', '-q', '--allow-empty', '-m', msg]); };
  let r;
  for (const form of ['example/toolkit', 'https://github.com/example/toolkit', 'https://github.com/example/toolkit.git', 'git@github.com:example/toolkit', 'git@github.com:example/toolkit.git', 'Example/Toolkit']) {
    commitUrl(form, 'url ' + form);
    r = run(repo, ['--skip-suites']);
    check('url ' + form + ' naming origin example/toolkit: marketplace ref ok', r.status === 0 && isOk(r.out, 'marketplace ref') && /from example\/toolkit at v1\.1\.0/.test(line(r.out, 'marketplace ref')), r.out);
  }
  commitUrl(undefined, 'no url');
  r = run(repo, ['--skip-suites']);
  check('entry with no url: marketplace FAIL says url is missing and shows the expected url', r.status === 1 && isFail(r.out, 'marketplace ref') && /url is missing/.test(line(r.out, 'marketplace ref')) && /"url": "example\/toolkit"/.test(line(r.out, 'marketplace ref')), r.out);
  commitUrl('someone-else/toolkit', 'foreign url');
  r = run(repo, ['--skip-suites']);
  check('url naming another repository: marketplace FAIL names both', r.status === 1 && isFail(r.out, 'marketplace ref') && /url names someone-else\/toolkit, not this repository example\/toolkit/.test(line(r.out, 'marketplace ref')), r.out);
  for (const bad of ['https://gitlab.com/example/toolkit', 'example/toolkit.git', 'https://github.com/example/toolkit/tree/main', 'ssh://git@github.com/example/toolkit.git']) {
    commitUrl(bad, 'bad url');
    r = run(repo, ['--skip-suites']);
    check('url ' + bad + ' outside the accepted forms: marketplace FAIL', r.status === 1 && isFail(r.out, 'marketplace ref') && /is not owner\/repo, https:\/\/github\.com\/owner\/repo or git@github\.com:owner\/repo/.test(line(r.out, 'marketplace ref')), r.out);
  }
  commitUrl('example/toolkit', 'url back');
  // The release commit moved past the tag with plugin/ unchanged: the tag on an
  // ancestor still passes check 5 (main is often a merge on top of the release).
  r = run(repo, ['--skip-suites']);
  check('tag v1.1.0 on an ancestor of HEAD: release tag ok, names the ancestor', r.status === 0 && isOk(r.out, 'release tag') && /is on its ancestor [0-9a-f]{12}/.test(line(r.out, 'release tag')), r.out);

  // Where "this repository" comes from: origin.
  git(repo, ['remote', 'set-url', 'origin', 'ssh://git@github.com/example/toolkit.git/']);
  r = run(repo, ['--skip-suites']);
  check('origin in ssh:// form with a trailing slash: still read as example/toolkit', r.status === 0 && isOk(r.out, 'marketplace ref'), r.out);
  git(repo, ['remote', 'set-url', 'origin', 'git@github.com:someone-else/toolkit.git']);
  r = run(repo, ['--skip-suites']);
  check('origin naming another repository than the url: marketplace FAIL', r.status === 1 && /not this repository someone-else\/toolkit \(its origin remote\)/.test(line(r.out, 'marketplace ref')), r.out);
  git(repo, ['remote', 'set-url', 'origin', 'https://git.example.com/example/toolkit.git']);
  r = run(repo, ['--skip-suites']);
  check('origin not on GitHub: marketplace FAIL, url cannot be verified', r.status === 1 && /url cannot be verified: origin .* is not a GitHub repository URL/.test(line(r.out, 'marketplace ref')), r.out);
  git(repo, ['remote', 'remove', 'origin']);
  r = run(repo, ['--skip-suites']);
  check('no origin remote: marketplace FAIL, never a silent pass', r.status === 1 && /url cannot be verified: this clone has no origin remote/.test(line(r.out, 'marketplace ref')) && /"url": "<owner>\/<repo>"/.test(line(r.out, 'marketplace ref')), r.out);
  git(repo, ['remote', 'add', 'origin', ORIGIN]);

  // The local tag on a commit that is not an ancestor of the checked one.
  const good = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['checkout', '-q', '-b', 'side', 'HEAD~1']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'side']);
  git(repo, ['tag', '-f', 'v1.1.0']);
  git(repo, ['checkout', '-q', '--detach', good]);
  r = run(repo, ['--skip-suites']);
  check('tag v1.1.0 on a side commit that is not an ancestor: release tag FAIL', r.status === 1 && isFail(r.out, 'release tag') && /is not [0-9a-f]{12} or one of its ancestors/.test(line(r.out, 'release tag')), r.out);
  git(repo, ['tag', '-f', 'v1.1.0', good]);

  // The remote, only for a --commit target (a push to main).
  const bare = tmp('release-tag-remote-');
  git(bare, ['init', '-q', '--bare']);
  r = run(repo, ['--skip-suites', '--remote', bare, '--commit', good]);
  check('--remote without the tag: release tag FAIL tells to push the tag first', r.status === 1 && isFail(r.out, 'release tag') && line(r.out, 'release tag').includes('tag v1.1.0 is not on remote ' + bare + '; push the tag on its own first'), r.out);
  r = run(repo, ['--skip-suites', '--remote', bare, '--pushing-tag', 'v1.1.0']);
  check('--remote with only a pushed tag: the remote is not asked (the tag push creates it)', r.status === 0 && isOk(r.out, 'release tag') && !/remote/.test(line(r.out, 'release tag')), r.out);
  // git push is not atomic, so a tag carried alongside main never stands in for
  // the remote's answer: the remote could refuse the tag and still take main.
  r = run(repo, ['--skip-suites', '--remote', bare, '--commit', good, '--pushing-tag', 'v1.1.0']);
  check('--remote without the tag, main and the tag in the same push: release tag FAIL, push the tag on its own first',
    r.status === 1 && isFail(r.out, 'release tag') && /tag v1\.1\.0 is not on remote .* \(this push carries it alongside main, but git push is not atomic.*; push the tag on its own first/.test(line(r.out, 'release tag')), r.out);
  r = run(repo, ['--skip-suites', '--commit', good]);
  check('--commit without --remote (a manual run): release tag checks only the local tag', r.status === 0 && !/remote/.test(line(r.out, 'release tag')), r.out);
  git(repo, ['push', '-q', bare, 'refs/tags/v1.1.0']);
  r = run(repo, ['--skip-suites', '--remote', bare, '--commit', good]);
  check('--remote holding the tag on the same commit: release tag ok', r.status === 0 && line(r.out, 'release tag').includes('and on remote ' + bare), r.out);
  git(repo, ['push', '-q', '-f', bare, 'side:refs/tags/v1.1.0']);
  r = run(repo, ['--skip-suites', '--remote', bare, '--commit', good]);
  check('--remote whose tag points at another commit: release tag FAIL', r.status === 1 && /on remote .* points at [0-9a-f]{12}, not [0-9a-f]{12} like the local tag/.test(line(r.out, 'release tag')), r.out);
  r = run(repo, ['--skip-suites', '--remote', bare, '--commit', good, '--pushing-tag', 'v1.1.0']);
  check('--remote whose tag points at another commit, the moved tag in the same push as main: release tag FAIL (the remote would refuse the tag and take main)',
    r.status === 1 && isFail(r.out, 'release tag') && /on remote .* points at [0-9a-f]{12}, not [0-9a-f]{12} like the local tag \(this push carries it alongside main/.test(line(r.out, 'release tag')), r.out);
  const gone = path.join(tmp('release-no-remote-'), 'missing.git');
  r = run(repo, ['--skip-suites', '--remote', gone, '--commit', good]);
  check('--remote that cannot be reached: release tag FAIL with a clear message, never a pass', r.status === 1 && isFail(r.out, 'release tag') && line(r.out, 'release tag').includes('cannot reach remote ' + gone + ' to confirm tag v1.1.0 is published (git ls-remote exit 128'), r.out);
  r = run(repo, ['--skip-suites', '--remote']);
  check('--remote with no value: usage error exit 2', r.status === 2, r.out);
}

// --- 6. landings since the previous release (#232) -------------------------------------
// The scratch repo carries this repository's own merge-check.js, as the toolkit
// does. A landing whose recorded cut predates another landing, and which drops
// that landing's line, fails the gate with the line named; an empty commit
// carrying the flag's Kept on purpose: line clears it; no script, or no earlier
// tag, skips with a note; --tests-only skips it with the other release checks.
{
  const MC = path.join(ROOT, '.claude', 'scripts', 'merge-check.js');
  const repo = makeRepo('1.0.0', gitSubdir('v1.0.0'));
  let r = run(repo, ['--skip-suites']);
  check('landings: a repo without merge-check.js skips the check with a note', isOk(r.out, 'landings') && /skipped: no \.claude\/scripts\/merge-check\.js/.test(line(r.out, 'landings')), r.out);
  write(repo, '.claude/scripts/merge-check.js', fs.readFileSync(MC, 'utf8'));
  write(repo, 'src/app.js', 'one\ntwo\nthree\n');
  commitAll(repo, 'base');
  r = run(repo, ['--skip-suites']);
  check('landings: no earlier release tag, nothing to check', isOk(r.out, 'landings') && /no earlier v\* release tag reachable; nothing to check/.test(line(r.out, 'landings')), r.out);
  git(repo, ['tag', 'v1.0.0']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  const main = git(repo, ['symbolic-ref', '--short', 'HEAD']);
  // A lands cleanly, cut at the release.
  git(repo, ['checkout', '-q', '-b', 'a']);
  write(repo, 'src/app.js', 'one\nTWO by A\nthree\n');
  commitAll(repo, 'A');
  git(repo, ['checkout', '-q', main]);
  git(repo, ['merge', '--no-ff', '-q', '-m', 'Merge PR #1: A\n\nCut from: ' + base, 'a']);
  r = run(repo, ['--skip-suites']);
  check('landings: a clean landing after the tag is one landing, none flagged', isOk(r.out, 'landings') && /1 landing\(s\) since v1\.0\.0, none flagged/.test(line(r.out, 'landings')), r.out);
  // B, cut at the same release, lands with its own side of the conflict: A's line is lost.
  git(repo, ['checkout', '-q', '-b', 'b', base]);
  write(repo, 'src/app.js', 'one\nTWO by B\nthree\n');
  commitAll(repo, 'B');
  git(repo, ['checkout', '-q', main]);
  spawnSync('git', ['merge', '--no-ff', '-q', '-m', 'Merge PR #2: B\n\nCut from: ' + base, 'b'], { cwd: repo, encoding: 'utf8' });
  git(repo, ['checkout', '--theirs', '--', 'src/app.js']);
  git(repo, ['add', 'src/app.js']);
  git(repo, ['commit', '-q', '--no-edit']);
  r = run(repo, ['--skip-suites']);
  check('landings: a landing that drops a line another landing added after its cut fails, naming the line and the way to keep it', r.status === 1 && isFail(r.out, 'landings') && /TWO by A/.test(line(r.out, 'landings')) && /Kept on purpose:/.test(line(r.out, 'landings')), r.out);
  const since = spawnSync('node', [MC, '--since', 'v1.0.0'], { cwd: repo, encoding: 'utf8' });
  let keep = null;
  try { keep = JSON.parse(since.stdout).landings[1].flags[0].keep; } catch (e) { keep = null; }
  check('landings: the flag carries the line to keep it on purpose', typeof keep === 'string' && /^Kept on purpose: [0-9a-f]{7} src\/app\.js: TWO by A$/.test(keep), since.stdout + since.stderr);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'Keep A\'s line out on purpose\n\n' + keep]);
  r = run(repo, ['--skip-suites']);
  check('landings: an empty commit carrying that line clears the failure', isOk(r.out, 'landings') && /none flagged \(1 kept on purpose\)/.test(line(r.out, 'landings')), r.out);
  r = run(repo, ['--skip-suites', '--tests-only']);
  check('landings: --tests-only skips it with the other release checks', line(r.out, 'landings') === '' && /release tag and landings judge a release/.test(line(r.out, 'release checks')), r.out);
}

// --- 1. suites -------------------------------------------------------------------
{
  const repo = makeRepo('1.0.0', gitSubdir('v1.0.0'));
  git(repo, ['tag', 'v1.0.0']);
  let r = run(repo, ['--suites', 'stubs/fail.js']);
  check('stub suite exiting 1 that prints "0 failed": run exits 1', r.status === 1, r.out);
  check('failing stub: suites FAIL and its exit code printed', isFail(r.out, 'suites') && /stubs\/fail\.js: exit 1/.test(r.out), r.out);

  r = run(repo, ['--suites', 'stubs/pass.js']);
  check('stub suite exiting 0: run exits 0', r.status === 0, r.out);
  check('passing stub: suites ok and its exit code printed', isOk(r.out, 'suites') && /stubs\/pass\.js: exit 0/.test(r.out), r.out);

  r = run(repo, ['--suites', 'stubs/pass.js,stubs/fail.js']);
  check('comma list with one failure: suites FAIL naming only the failing suite', r.status === 1 && /1 of 2 suites exited non-zero: stubs\/fail\.js$/.test(line(r.out, 'suites')), r.out);
  // Each suite's line ends with its wall time, so a slow suite can be found in
  // the gate's own output (#231). The detail stays on one line: the gate shows
  // only the last 15 lines of a failing suite.
  const timed = r.out.split('\n').filter((l) => /stubs\/(pass|fail)\.js: exit/.test(l));
  check("the gate prints each suite's wall time", timed.length === 2 && timed.every((l) => /: exit \d+ \(\d+\.\d s\)$/.test(l)), JSON.stringify(timed));

  write(repo, 'stubs/test-a.js', 'process.exit(0);\n');
  write(repo, 'stubs/test-b.js', 'process.exit(0);\n');
  r = run(repo, ['--suites', 'stubs/test-*.js']);
  check('glob expands to every matching stub', r.status === 0 && /stubs\/test-a\.js: exit 0/.test(r.out) && /stubs\/test-b\.js: exit 0/.test(r.out) && !/stubs\/pass\.js/.test(r.out), r.out);

  // An absolute glob is read as given, never joined under the repo root.
  const outside = tmp('release-abs-suites-');
  write(outside, 'test-x.js', 'process.exit(0);\n');
  write(outside, 'test-y.js', 'process.exit(0);\n');
  r = run(repo, ['--suites', path.join(outside, 'test-*.js')]);
  check('absolute --suites glob outside the repo: runs every match', r.status === 0 && isOk(r.out, 'suites') && r.out.includes(path.join(outside, 'test-x.js') + ': exit 0') && r.out.includes(path.join(outside, 'test-y.js') + ': exit 0'), r.out);
  r = run(repo, ['--suites', path.join(repo, 'stubs', 'test-*.js')]);
  check('absolute --suites glob inside the repo: runs every match', r.status === 0 && /test-a\.js: exit 0/.test(r.out) && /test-b\.js: exit 0/.test(r.out), r.out);
  r = run(repo, ['--suites', path.join(outside, 'test-x.js')]);
  check('absolute --suites file: runs it', r.status === 0 && r.out.includes(path.join(outside, 'test-x.js') + ': exit 0'), r.out);

  r = run(repo, ['--suites', 'stubs/nope-*.js']);
  check('glob matching nothing: suites FAIL, never a vacuous pass', r.status === 1 && isFail(r.out, 'suites'), r.out);

  r = run(repo, ['--suites', 'stubs/missing.js']);
  check('named suite that does not exist: suites FAIL', r.status === 1 && isFail(r.out, 'suites') && /missing/.test(r.out), r.out);

  write(repo, 'stubs/crash.js', "process.kill(process.pid, 'SIGKILL');\n");
  r = run(repo, ['--suites', 'stubs/crash.js']);
  check('suite killed by a signal (no exit code): suites FAIL', r.status === 1 && isFail(r.out, 'suites') && /exit signal SIGKILL/.test(r.out), r.out);

  // Default set: every scripts/test-*.js, the gate's own test included (a stub
  // here, so nothing recurses), and nothing that is not a test-*.js file.
  write(repo, 'scripts/test-alpha.js', 'process.exit(0);\n');
  write(repo, 'scripts/test-release-check.js', "console.log('own test stub ran');\nprocess.exit(0);\n");
  write(repo, 'scripts/helper.js', 'process.exit(1);\n');
  r = run(repo, []);
  check('default suites: runs scripts/test-*.js and skips other scripts', r.status === 0 && /scripts\/test-alpha\.js: exit 0/.test(r.out) && !/helper\.js/.test(r.out), r.out);
  check('default suites: include scripts/test-release-check.js, the gate\'s own test', /scripts\/test-release-check\.js: exit 0/.test(r.out) && /2 suites exited 0/.test(line(r.out, 'suites')), r.out);
  write(repo, 'scripts/test-release-check.js', 'process.exit(1);\n');
  r = run(repo, []);
  check('default suites: a failing own test blocks the gate like any suite', r.status === 1 && /1 of 2 suites exited non-zero: scripts\/test-release-check\.js$/.test(line(r.out, 'suites')), r.out);

  r = spawnSync('node', [SCRIPT, '--repo', repo, '--bogus'], { encoding: 'utf8' });
  check('unknown argument: exit 2', r.status === 2, r.stdout + r.stderr);
}

// --- 249. the suites run side by side (issue #249) ---------------------------------
// One after another, the suites took about 150 s on a 12-core machine using one
// core. They now run in a pool (--jobs, default the CPU count less one), each
// with a temp folder of its own outside any git work tree, removed when it
// exits; a suite past its time limit, or a gate stopped mid-run, takes every
// process the suite started with it. The output keeps its shape.
{
  // Failure detail stays on one line: the gate shows a failing suite's last 15 lines.
  const flat = (x) => String(x).replace(/\s+/g, ' ').slice(0, 300);
  const repo = makeRepo('1.0.0', gitSubdir('v1.0.0'));
  git(repo, ['tag', 'v1.0.0']);
  // A stub that records when it started and ended, and the temp folder it saw.
  const napStub = (name, ms) => "const fs = require('fs'); const path = require('path'); const d = path.join(__dirname, '..', 'naps');\n"
    + "fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, '" + name + ".start'), String(Date.now()));\n"
    + "fs.writeFileSync(path.join(d, '" + name + ".tmp'), require('os').tmpdir());\n"
    + 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ' + ms + ');\n'
    + "fs.writeFileSync(path.join(d, '" + name + ".end'), String(Date.now()));\nprocess.exit(0);\n";
  write(repo, 'stubs/nap-a.js', napStub('a', 800));
  write(repo, 'stubs/nap-b.js', napStub('b', 800));
  const nap = (n, what) => { try { return fs.readFileSync(path.join(repo, 'naps', n + '.' + what), 'utf8'); } catch (e) { return null; } };
  const overlapped = () => Number(nap('a', 'start')) < Number(nap('b', 'end')) && Number(nap('b', 'start')) < Number(nap('a', 'end'));
  let r = run(repo, ['--suites', 'stubs/nap-a.js,stubs/nap-b.js', '--jobs', '2']);
  const together = r.status === 0 && overlapped();
  const tmpA = nap('a', 'tmp');
  const tmpB = nap('b', 'tmp');
  const totals = /^ {9}2 suites in \d+\.\d s, 2 at a time$/m.test(r.out);
  fs.rmSync(path.join(repo, 'naps'), { recursive: true, force: true });
  const r1 = run(repo, ['--suites', 'stubs/nap-a.js,stubs/nap-b.js', '--jobs', '1']);
  check('249 parallel: with --jobs 2 two suites run at the same time, and with --jobs 1 one after the other',
    together && r1.status === 0 && !overlapped() && nap('a', 'end') !== null && nap('b', 'end') !== null, flat(r.out + ' | ' + r1.out));
  check('249 parallel: a line under the suites says how many ran, in how long, and how many at a time', totals, flat(r.out));
  const inside = (d) => { const rel = path.relative(repo, d); return !rel.startsWith('..') && !path.isAbsolute(rel); };
  check('249 parallel: each suite gets its own temp folder outside the repository, removed when it exits',
    !!tmpA && !!tmpB && tmpA !== tmpB && !inside(tmpA) && !inside(tmpB) && path.dirname(tmpA) === os.tmpdir() && !fs.existsSync(tmpA) && !fs.existsSync(tmpB),
    flat(JSON.stringify({ tmpA, tmpB, root: os.tmpdir() })));
  r = run(repo, ['--suites', 'stubs/pass.js', '--jobs', '0']);
  const r2 = run(repo, ['--suites', 'stubs/pass.js', '--jobs', 'many']);
  check('249 parallel: --jobs takes a whole number of at least 1', r.status === 2 && r2.status === 2 && /--jobs/.test(r.out + r2.out), flat(r.out + r2.out));

  // Two failures: listed sorted, each tail directly under its own exit line.
  write(repo, 'stubs/zz-fail.js', "console.log('zz said this'); process.exit(1);\n");
  write(repo, 'stubs/aa-fail.js', "console.log('aa said this'); process.exit(1);\n");
  r = run(repo, ['--suites', 'stubs/zz-fail.js,stubs/aa-fail.js', '--jobs', '2']);
  const lines = r.out.split('\n');
  const under = (name, said) => { const at = lines.findIndex((l) => l.includes('stubs/' + name + '.js: exit 1 (')); return at >= 0 && (lines[at + 1] || '').includes(said); };
  check('249 parallel: failing suites are listed sorted by name, each with its tail directly under its own exit line',
    r.status === 1 && /2 of 2 suites exited non-zero: stubs\/aa-fail\.js, stubs\/zz-fail\.js$/.test(line(r.out, 'suites')) && under('aa-fail', 'aa said this') && under('zz-fail', 'zz said this'), flat(r.out));

  // A suite that starts a long-running child and outlives its time limit. It
  // ends itself after 8 s, so a gate that ignores the limit fails these cases
  // in seconds rather than waiting out the 10-minute default.
  const hangStub = "const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');\n"
    + "const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)'], { stdio: 'ignore' });\n"
    + "fs.writeFileSync(path.join(__dirname, '..', 'hang.pid'), String(c.pid));\n"
    + "fs.writeFileSync(path.join(__dirname, '..', 'hang.tmp'), require('os').tmpdir());\nsetTimeout(() => process.exit(0), 8000);\n";
  write(repo, 'stubs/hang.js', hangStub);
  const gone = (pid) => {   // a killed process can take a moment to be reaped
    for (let i = 0; i < 40; i++) {
      try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') return true; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    return false;
  };
  r = run(repo, ['--suites', 'stubs/hang.js'], { TK_RELEASE_SUITE_TIMEOUT_MS: '1500' });
  const hangPid = Number(fs.readFileSync(path.join(repo, 'hang.pid'), 'utf8'));
  check('249 parallel: a suite past its time limit is stopped with every process it started, and reported as timed out',
    r.status === 1 && /stubs\/hang\.js: exit error ETIMEDOUT/.test(r.out) && /TK_RELEASE_SUITE_TIMEOUT_MS is set/.test(r.out) && hangPid > 0 && gone(hangPid)
      && !fs.existsSync(fs.readFileSync(path.join(repo, 'hang.tmp'), 'utf8')), flat(r.out));

  // A gate stopped mid-run: a small driver starts it, waits for the stub to be
  // running, sends SIGTERM, and reports how the gate ended.
  fs.rmSync(path.join(repo, 'hang.pid'), { force: true });
  const driverDir = tmp('release-driver-');
  write(driverDir, 'driver.js', "const { spawn } = require('child_process'); const fs = require('fs');\n"
    + 'const [script, repo] = process.argv.slice(2);\n'
    + "const g = spawn(process.execPath, [script, '--repo', repo, '--suites', 'stubs/hang.js'], { stdio: 'ignore' });\n"
    + "const t = setInterval(() => { if (fs.existsSync(repo + '/hang.pid')) { clearInterval(t); setTimeout(() => g.kill('SIGTERM'), 200); } }, 50);\n"
    + "g.on('exit', (code, signal) => { console.log(JSON.stringify({ code, signal })); process.exit(0); });\n"
    + "setTimeout(() => { g.kill('SIGKILL'); console.log(JSON.stringify({ code: 'stuck' })); process.exit(0); }, 20000);\n");
  gateTargets.push(repo);
  const dr = spawnSync('node', [path.join(driverDir, 'driver.js'), SCRIPT, repo], { encoding: 'utf8' });
  let ended = null;
  try { ended = JSON.parse(dr.stdout.trim()); } catch (e) { ended = null; }
  const stoppedPid = fs.existsSync(path.join(repo, 'hang.pid')) ? Number(fs.readFileSync(path.join(repo, 'hang.pid'), 'utf8')) : 0;
  check('249 parallel: a gate stopped mid-run stops every running suite and what it started, removes its temp folder, and exits non-zero',
    !!ended && typeof ended.code === 'number' && ended.code !== 0 && stoppedPid > 0 && gone(stoppedPid)
      && !fs.existsSync(fs.readFileSync(path.join(repo, 'hang.tmp'), 'utf8')), flat(dr.stdout + dr.stderr));

  // A temp folder inside a git work tree breaks suites that build "not a
  // repo" fixtures, so the gate refuses it before any suite runs.
  write(repo, 'stubs/marker.js', "require('fs').writeFileSync(require('path').join(__dirname, '..', 'marker.ran'), 'x');\n");
  fs.mkdirSync(path.join(repo, 'inner-tmp'), { recursive: true });
  r = run(repo, ['--suites', 'stubs/marker.js'], { TMPDIR: path.join(repo, 'inner-tmp') });
  check('249 parallel: a temp folder inside a git work tree fails the suites check with one line, and no suite runs',
    r.status === 1 && isFail(r.out, 'suites') && /inside a git work tree/.test(line(r.out, 'suites')) && !fs.existsSync(path.join(repo, 'marker.ran')), flat(r.out));
}

// --- 249. a pass the hook can reuse (issue #249) ---------------------------------
// A release push ran the whole gate for the tag and again for main, on files
// that had just passed. A default-suite run where every suite passed records
// the files' fingerprint (the checks runner's), the commit and each suite's
// time in the clone's git folder, and only --reuse-pass (the hook's flag)
// skips the suites, when both the files and every named commit match it.
{
  const flat = (x) => String(x).replace(/\s+/g, ' ').slice(0, 300);
  const repo = makeRepo('1.0.0', gitSubdir('v1.0.0'));
  // The only default suite: it counts its runs in an ignored file, so counting
  // never changes the files' fingerprint, and fails when COUNT_EXIT says so.
  write(repo, 'scripts/test-count.js', "const fs = require('fs'); const path = require('path');\n"
    + "fs.appendFileSync(path.join(__dirname, '..', 'runs.txt'), 'x\\n');\nprocess.exit(Number(process.env.COUNT_EXIT || 0));\n");
  write(repo, '.gitignore', 'runs.txt\n');
  commitAll(repo, 'counting suite');
  const runs = () => (fs.existsSync(path.join(repo, 'runs.txt')) ? fs.readFileSync(path.join(repo, 'runs.txt'), 'utf8').split('\n').filter(Boolean).length : 0);
  const recordFile = path.join(repo, '.git', 'tk-release-gate.json');
  const record = () => { try { return JSON.parse(fs.readFileSync(recordFile, 'utf8')); } catch (e) { return null; } };
  const head = () => git(repo, ['rev-parse', 'HEAD']);

  let r = run(repo, ['--tests-only']);
  const rec = record();
  check('249 reuse: a passing default run records its files, its commit and each suite\'s time in the clone\'s git folder',
    r.status === 0 && !!rec && /^[0-9a-f]{64}$/.test(String(rec.fingerprint)) && rec.head === head() && typeof rec.suites['scripts/test-count.js'] === 'number'
      && git(repo, ['status', '--porcelain']) === '', flat(r.out + JSON.stringify(rec)));

  let before = runs();
  r = run(repo, ['--tests-only', '--reuse-pass']);
  check('249 reuse: --reuse-pass on the same files and commit skips the suites with one line, and the other checks still run',
    r.status === 0 && runs() === before && isOk(r.out, 'suites') && /skipped, the same files passed at /.test(line(r.out, 'suites')) && isOk(r.out, 'build') && isOk(r.out, 'release checks'), flat(r.out));

  before = runs();
  r = run(repo, ['--tests-only']);
  check('249 reuse: without --reuse-pass the suites always run', r.status === 0 && runs() === before + 1, flat(r.out));

  write(repo, 'plugin/commands/explore.md', '# Explore\n\nEdited.\n');
  before = runs();
  r = run(repo, ['--tests-only', '--reuse-pass']);
  const ranOnEdit = runs() === before + 1;
  git(repo, ['checkout', '--', 'plugin/commands/explore.md']);
  write(repo, 'notes.txt', 'new\n');
  run(repo, ['--tests-only']);           // record the files as they are now
  fs.rmSync(path.join(repo, 'notes.txt'));
  before = runs();
  r = run(repo, ['--tests-only', '--reuse-pass']);
  check('249 reuse: a changed tracked file, or a new or removed untracked one, makes --reuse-pass run the suites',
    ranOnEdit && runs() === before + 1 && /not reusing a pass: the files differ/.test(r.out), flat(r.out));

  run(repo, ['--tests-only']);           // a pass on the clean tree at HEAD
  before = runs();
  r = run(repo, ['--reuse-pass', '--commit', git(repo, ['rev-parse', 'HEAD~1'])]);
  const ranOther = runs() === before + 1;
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'same files, new commit']);
  before = runs();
  r = run(repo, ['--tests-only', '--reuse-pass']);
  check('249 reuse: a pass recorded at one commit does not skip a run that names another, or a new commit on the same files',
    ranOther && runs() === before + 1 && /not reusing a pass: the last pass was at /.test(r.out), flat(r.out));

  fs.rmSync(recordFile, { force: true });
  run(repo, ['--tests-only', '--suites', 'scripts/test-count.js']);
  const afterSubset = record();
  run(repo, ['--tests-only'], { COUNT_EXIT: '1' });
  check('249 reuse: a --suites run and a failing run never record a pass', afterSubset === null && record() === null, flat(JSON.stringify(record())));

  // A suite that edits a tracked file while it runs: the files that passed are
  // not the files on disk, so nothing is recorded.
  write(repo, 'scripts/test-edit.js', "require('fs').appendFileSync(require('path').join(__dirname, '..', 'plugin', 'commands', 'explore.md'), 'more\\n');\n");
  commitAll(repo, 'editing suite');
  r = run(repo, ['--tests-only']);
  const editedRecord = record();
  git(repo, ['checkout', '--', 'plugin/commands/explore.md']);
  git(repo, ['rm', '-q', 'scripts/test-edit.js']);
  commitAll(repo, 'no editing suite');
  check('249 reuse: files that change while the suites run are never recorded as passed',
    r.status === 0 && editedRecord === null && /not recorded as a pass: the files changed while the suites ran/.test(r.out), flat(r.out));

  r = run(repo, ['--reuse-pass', '--suites', 'scripts/test-count.js']);
  const r2 = run(repo, ['--reuse-pass', '--skip-suites']);
  check('249 reuse: --reuse-pass goes only with the default suite set', r.status === 2 && r2.status === 2 && /--reuse-pass/.test(r.out + r2.out), flat(r.out + r2.out));

  // Longest first: with one at a time, the suite the last pass timed as the
  // slowest starts first.
  write(repo, 'scripts/test-count.js', "const fs = require('fs'); const path = require('path');\n"
    + "fs.appendFileSync(path.join(__dirname, '..', 'order.txt'), 'count\\n');\n");
  write(repo, 'scripts/test-slow.js', "const fs = require('fs'); const path = require('path');\n"
    + "fs.appendFileSync(path.join(__dirname, '..', 'order.txt'), 'slow\\n');\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600);\n");
  write(repo, '.gitignore', 'runs.txt\norder.txt\n');
  commitAll(repo, 'two timed suites');
  run(repo, ['--tests-only', '--jobs', '1']);
  fs.rmSync(path.join(repo, 'order.txt'), { force: true });
  run(repo, ['--tests-only', '--jobs', '1']);
  const order = fs.readFileSync(path.join(repo, 'order.txt'), 'utf8').split('\n').filter(Boolean);
  check('249 reuse: the suites start longest first, by the times the last pass recorded', JSON.stringify(order) === '["slow","count"]', JSON.stringify(order));
}

// --- 2. build check ----------------------------------------------------------------
{
  const repo = makeRepo('1.0.0', gitSubdir('v1.0.0'));
  git(repo, ['tag', 'v1.0.0']);
  write(repo, 'scripts/build-plugin.js', "process.exit(process.argv.includes('--check') ? 0 : 3);\n");
  let r = run(repo, ['--skip-suites']);
  check('build-plugin.js --check exits 0: build ok', r.status === 0 && isOk(r.out, 'build') && !/skipped/.test(line(r.out, 'build')), r.out);
  write(repo, 'scripts/build-plugin.js', "console.error('build-plugin --check: differs: x');\nprocess.exit(1);\n");
  r = run(repo, ['--skip-suites']);
  check('build-plugin.js --check exits 1: build FAIL, run exits 1', r.status === 1 && isFail(r.out, 'build'), r.out);
}

// --- R. readme budget ---------------------------------------------------------------
{
  const repo = makeRepo('1.0.0', gitSubdir('v1.0.0'));
  git(repo, ['tag', 'v1.0.0']);
  let r = run(repo, ['--skip-suites']);
  check('no README.md: readme budget passes as skipped', r.status === 0 && isOk(r.out, 'readme budget') && /skipped: no README\.md/.test(line(r.out, 'readme budget')), r.out);
  // "# readme" is two words; 1,498 more land exactly on the budget.
  write(repo, 'README.md', '# readme\n\n' + 'word '.repeat(1498) + '\n'); commitAll(repo, 'readme at budget');
  r = run(repo, ['--skip-suites']);
  check('README.md at exactly 1,500 words: readme budget passes with the count', r.status === 0 && isOk(r.out, 'readme budget') && /readme budget - 1500 words, budget 1500/.test(line(r.out, 'readme budget')), r.out);
  write(repo, 'README.md', '# readme\n\n' + 'word '.repeat(1499) + '\n'); commitAll(repo, 'readme over budget');
  r = run(repo, ['--skip-suites']);
  check('README.md at 1,501 words: readme budget FAIL names the overage, run exits 1', r.status === 1 && isFail(r.out, 'readme budget') && /1501 words, 1 over the budget of 1500/.test(line(r.out, 'readme budget')), r.out);
  // The everyday run enforces it too: a long README cannot slip past npm test or CI.
  r = run(repo, ['--tests-only', '--suites', 'stubs/pass.js']);
  check('--tests-only with a long README: readme budget FAIL, run exits 1', r.status === 1 && isOk(r.out, 'suites') && isFail(r.out, 'readme budget'), r.out);
}

// --- --tests-only: the everyday run (`npm test`, CI), checks 1, 2 and R only -----------
{
  // A repo the full gate refuses twice over: plugin/ changed since v1.0.0 with
  // no bump, and the marketplace installs from the default branch. Neither is
  // a test failure.
  const repo = makeRepo('1.0.0', './plugin');
  git(repo, ['tag', 'v1.0.0']);
  write(repo, 'plugin/commands/explore.md', '# Explore v2\n');
  commitAll(repo, 'plugin change, no bump');
  let r = run(repo, ['--suites', 'stubs/pass.js']);
  check('full gate on the unreleasable repo: fails on the release checks', r.status === 1 && isOk(r.out, 'suites') && isFail(r.out, 'version bump') && isFail(r.out, 'marketplace ref'), r.out);
  r = run(repo, ['--tests-only', '--suites', 'stubs/pass.js']);
  check('--tests-only on the same repo: exits 0 with suites, build and readme budget ok', r.status === 0 && isOk(r.out, 'suites') && isOk(r.out, 'build') && isOk(r.out, 'readme budget') && /release-check: 5 passed, 0 failed/.test(r.out), summaryLine(r.out));
  check('--tests-only: one line says the release checks were skipped and why', isOk(r.out, 'release checks') && /skipped \(--tests-only\)/.test(line(r.out, 'release checks')) && /version bump/.test(line(r.out, 'release checks')), r.out);
  check('--tests-only: no release check ran', !line(r.out, 'version bump') && !line(r.out, 'marketplace ref') && !line(r.out, 'release tag') && !line(r.out, 'tag version'), r.out);

  // The suites keep their teeth: the verdict is still the exit code alone.
  r = run(repo, ['--tests-only', '--suites', 'stubs/fail.js']);
  check('--tests-only with a suite exiting 1 that prints "0 failed": run exits 1', r.status === 1 && isFail(r.out, 'suites') && /stubs\/fail\.js: exit 1/.test(r.out), r.out);
  // So does the build check.
  write(repo, 'scripts/build-plugin.js', "process.exit(process.argv.includes('--check') ? 1 : 0);\n");
  r = run(repo, ['--tests-only', '--suites', 'stubs/pass.js']);
  check('--tests-only with a stale build: build FAIL, run exits 1', r.status === 1 && isOk(r.out, 'suites') && isFail(r.out, 'build'), r.out);
  r = run(repo, ['--tests-only', '--skip-suites']);
  check('--tests-only --skip-suites: only the build check decides', r.status === 1 && isOk(r.out, 'suites') && isFail(r.out, 'build'), r.out);

  // The flags that name a push feed only the skipped checks: never a quiet bypass.
  for (const extra of [['--commit', 'HEAD'], ['--pushing-tag', 'v1.0.0'], ['--remote', 'origin']]) {
    r = run(repo, ['--tests-only', '--skip-suites', ...extra]);
    check('--tests-only with ' + extra[0] + ': usage error exit 2', r.status === 2 && /--tests-only cannot be combined/.test(r.out), r.out);
  }
  r = run(repo, ['--help']);
  check('--help names --tests-only', r.status === 0 && r.out.includes('[--tests-only]'), r.out);
}

// --- info: the prompt-load report (#206) prints, is never counted, never fails ----------
{
  const repo = makeRepo('1.0.0', gitSubdir('v1.0.0'));
  let r = run(repo, ['--tests-only', '--suites', 'stubs/pass.js']);
  check('no scripts/prompt-load.js: no prompt-load line at all', r.status === 0 && !/prompt load/.test(r.out), r.out);
  write(repo, 'scripts/prompt-load.js', "if (process.argv.includes('--json')) { console.log(JSON.stringify({ rows: { 'commands/a.md': 2 } })); process.exit(0); }\n"
    + "console.log('baseline scripts/prompt-load-baseline.json: 1 grew, 0 new, 0 removed, 0 shrank');\n"
    + "console.log('  grew     commands/a.md 1 -> 2 (+1)');\n");
  r = run(repo, ['--tests-only', '--suites', 'stubs/pass.js']);
  check('prompt-load report: printed as an info line with its warnings',
    r.status === 0 && /^ {2}info prompt load - baseline scripts\/prompt-load-baseline\.json: 1 grew/m.test(r.out) && /grew {5}commands\/a\.md 1 -> 2 \(\+1\)/.test(r.out), r.out);
  check('prompt-load report: not counted as a check', /release-check: 5 passed, 0 failed/.test(r.out), summaryLine(r.out));
  write(repo, 'scripts/prompt-load.js', "console.error('boom');\nprocess.exit(1);\n");
  r = run(repo, ['--tests-only', '--suites', 'stubs/pass.js']);
  check('prompt-load report that fails: the info line says so, and the prompt ceiling check fails with it',
    r.status === 1 && /info prompt load - report unavailable: prompt-load\.js exited 1/.test(r.out) && /boom/.test(r.out) && isFail(r.out, 'prompt ceiling') && /release-check: 4 passed, 1 failed/.test(r.out), summaryLine(r.out));
}

// --- check: the prompt ceiling (#261) ------------------------------------------------------
// A fixed line on what any one prompt file loads, beside the README budget. The
// stub answers --json with rows the way prompt-load.js does and keeps a text
// line for the info case above; the ceiling is read from the script so these
// cases follow the constant when a split lowers it. The session row is planted
// far over the line to prove it is left out.
{
  const CEILING = Number((/PROMPT_LOAD_CEILING = (\d+)/.exec(fs.readFileSync(SCRIPT, 'utf8')) || [])[1]);
  const repo = makeRepo('1.0.0', gitSubdir('v1.0.0'));
  let r = run(repo, ['--tests-only', '--suites', 'stubs/pass.js']);
  check('prompt ceiling: no scripts/prompt-load.js skips with a note', r.status === 0 && isOk(r.out, 'prompt ceiling') && /skipped: no scripts\/prompt-load\.js/.test(line(r.out, 'prompt ceiling')), line(r.out, 'prompt ceiling') || summaryLine(r.out));
  const stub = (rows) => "if (process.argv.includes('--json')) { console.log(JSON.stringify({ rows: " + JSON.stringify(rows) + " })); process.exit(0); }\n"
    + "console.log('baseline scripts/prompt-load-baseline.json: 0 grew, 0 new, 0 removed, 0 shrank');\n";
  write(repo, 'scripts/prompt-load.js', stub({ 'commands/a.md': 100, 'skills/b/SKILL.md': CEILING, session: CEILING * 9 }));
  r = run(repo, ['--tests-only', '--suites', 'stubs/pass.js']);
  check('prompt ceiling: every row at or under the line passes and names the biggest', r.status === 0 && isOk(r.out, 'prompt ceiling') && new RegExp('biggest skills/b/SKILL\\.md at ' + CEILING + ' words, ceiling ' + CEILING).test(line(r.out, 'prompt ceiling')), line(r.out, 'prompt ceiling') || summaryLine(r.out));
  write(repo, 'scripts/prompt-load.js', stub({ 'commands/a.md': CEILING + 1, 'skills/b/SKILL.md': 10 }));
  r = run(repo, ['--tests-only', '--suites', 'stubs/pass.js']);
  check('prompt ceiling: a row over the line fails and names the row', r.status === 1 && isFail(r.out, 'prompt ceiling') && new RegExp('commands/a\\.md loads ' + (CEILING + 1) + ' words, 1 over the ceiling of ' + CEILING).test(line(r.out, 'prompt ceiling')) && /prompt-load\.js lists the fragments/.test(line(r.out, 'prompt ceiling')), line(r.out, 'prompt ceiling') || summaryLine(r.out));
  write(repo, 'scripts/prompt-load.js', "console.log('not json');\n");
  r = run(repo, ['--tests-only', '--suites', 'stubs/pass.js']);
  check('prompt ceiling: a report that cannot be read fails', r.status === 1 && isFail(r.out, 'prompt ceiling') && /report unavailable/.test(line(r.out, 'prompt ceiling')), line(r.out, 'prompt ceiling') || summaryLine(r.out));
}

// --- info: the catch-rate line (harness research, item 7) prints, is never counted, never fails
// It names the newest valid ship-arm review run in the fixture ledger and the
// review-path files plugin/ changed since that run's build, so a release whose
// review path moved since its last measurement says so in every gate run.
{
  const repo = makeRepo('1.0.0', gitSubdir('v1.0.0'));
  write(repo, 'plugin/commands/review.md', '# Review\n');
  write(repo, 'plugin/README.md', '# Plugin\n');
  commitAll(repo, 'review path');
  const built = git(repo, ['rev-parse', 'HEAD']).trim();
  let r = run(repo, ['--tests-only', '--suites', 'stubs/pass.js']);
  check('no ledger: no catch-rate line at all', r.status === 0 && !/catch rate/.test(r.out), r.out);

  // The harness's file list, stubbed the way the prompt-load case stubs its script.
  write(repo, 'scripts/quality-check.js', 'module.exports = { PATH_FILES: { review: /^(commands\\/review\\.md|agents\\/audit-skeptic\\.md)$/ } };\n');
  const runDir = (name, meta, valid) => {
    write(repo, 'reports/quality-check/' + name + '/run.json', JSON.stringify(meta));
    write(repo, 'reports/quality-check/' + name + '/analysis.json', JSON.stringify({ valid }));
  };
  runDir('2026-10-01-000000-review-a-x', { role: 'review', arm: 'a', build: { sha: built, version: '1.0.0' }, startedAt: '2026-10-03T00:00:00Z' }, true);
  r = run(repo, ['--tests-only', '--suites', 'stubs/pass.js']);
  check('a ledger with no valid ship-arm run says so in one info line',
    r.status === 0 && /^ {2}info catch rate - no valid ship-arm review run in reports\/quality-check yet/m.test(r.out), r.out);

  runDir('2026-10-02-000000-review-ship-x', { role: 'review', arm: 'ship', build: { sha: built, version: '1.0.0' }, session: { claude: '2.1.296 (Claude Code)' }, startedAt: '2026-10-02T00:00:00Z' }, true);
  runDir('2026-10-04-000000-review-ship-y', { role: 'review', arm: 'ship', build: { sha: built, version: '1.0.0' }, startedAt: '2026-10-04T00:00:00Z' }, false);
  r = run(repo, ['--tests-only', '--suites', 'stubs/pass.js']);
  check('the newest valid ship-arm run is named with its build and Claude Code version, and nothing has changed since',
    r.status === 0 && /info catch rate - newest valid ship-arm run 2026-10-02-000000-review-ship-x: build [0-9a-f]{7} \(1\.0\.0\), Claude Code 2\.1\.296 \(Claude Code\); 0 review-path files changed in plugin\/ since that build; fixture notebook$/m.test(r.out), r.out);

  write(repo, 'plugin/commands/review.md', '# Review, edited\n');
  write(repo, 'plugin/README.md', '# Plugin, edited\n');
  commitAll(repo, 'move the review path');
  r = run(repo, ['--tests-only', '--suites', 'stubs/pass.js']);
  check('a review-path file changed since the build is listed; a file off the path is not',
    r.status === 0 && /; 1 review-path file changed in plugin\/ since that build/.test(r.out) && /^ {7}commands\/review\.md$/m.test(r.out) && !/^ {7}README\.md$/m.test(r.out), r.out);
  check('the catch-rate line is not counted as a check', /release-check: 5 passed, 0 failed/.test(r.out), summaryLine(r.out));

  runDir('2026-10-05-000000-review-ship-z', { role: 'review', arm: 'ship', build: { sha: '0123456789abcdef0123456789abcdef01234567', version: '1.0.0' }, fixtureName: 'pocket', startedAt: '2026-10-05T00:00:00Z' }, true);
  r = run(repo, ['--tests-only', '--suites', 'stubs/pass.js']);
  check('a build this repository does not have is said plainly, naming the run\'s fixture, and the run still exits 0',
    r.status === 0 && /info catch rate - newest valid ship-arm run 2026-10-05-000000-review-ship-z: build 0123456 is not in this repository's history; fixture pocket$/m.test(r.out), r.out);
}

// --- hook routing ------------------------------------------------------------------
const stubDir = tmp('release-hook-stubs-');
// The tripwire stub records its arguments and the stdin it received, one JSON
// object per run, so the ref lines the hook hands it can be checked (issue #178).
const TRIPWIRE_STUB = "const fs = require('fs');\nfs.appendFileSync(process.env.HOOK_LOG, 'tripwire\\n');\n"
  + "fs.appendFileSync(process.env.HOOK_LOG + '.tripwire', JSON.stringify({ args: process.argv.slice(2), stdin: fs.readFileSync(0, 'utf8') }) + '\\n');\n";
write(stubDir, 'tripwire.js', TRIPWIRE_STUB + "process.exit(Number(process.env.TRIPWIRE_EXIT || 0));\n");
// The release stub also records the arguments the hook passed, one run per line.
write(stubDir, 'release.js', "const fs = require('fs');\nfs.appendFileSync(process.env.HOOK_LOG, 'release\\n');\nfs.appendFileSync(process.env.HOOK_LOG + '.args', process.argv.slice(2).join(' ') + '\\n');\nprocess.exit(Number(process.env.RELEASE_EXIT || 0));\n");
// The hook's default tripwire path is relative to its cwd; this stand-in lets a
// run with TK_PRE_PUSH_CHECK unset still work, to prove no notice is printed.
write(stubDir, '.claude/scripts/pre-push-check.js', TRIPWIRE_STUB + "process.exit(0);\n");
// The hook refuses any pushed ref that is not the checked-out commit (R11), so
// the stub folder is a git repo and the routing cases push its HEAD. A second
// commit gives a real object that is not HEAD.
initRepo(stubDir);
commitAll(stubDir, 'stubs');
git(stubDir, ['commit', '-q', '--allow-empty', '-m', 'later']);
const STUB_OLD = git(stubDir, ['rev-parse', 'HEAD~1']);
function hookEnv(log, extra) {
  return Object.assign({}, process.env, {
    HOOK_LOG: log, TK_PRE_PUSH_CHECK: path.join(stubDir, 'tripwire.js'), TK_RELEASE_CHECK: path.join(stubDir, 'release.js'),
  }, extra || {});
}
const readLog = (log) => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).join(',') : '';
// The last tripwire run's { args, stdin }, or null when it never ran.
const readTripwire = (log) => fs.existsSync(log + '.tripwire') ? JSON.parse(fs.readFileSync(log + '.tripwire', 'utf8').trim().split('\n').pop()) : null;
function runHook(stdin, extra) {
  const log = path.join(tmp('release-hook-log-'), 'log');
  const r = spawnSync('sh', [HOOK, 'origin', 'git@example.com:toolkit.git'], { cwd: stubDir, input: stdin, encoding: 'utf8', env: hookEnv(log, extra) });
  const args = fs.existsSync(log + '.args') ? fs.readFileSync(log + '.args', 'utf8').trim() : '';
  return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), ran: readLog(log), args, tw: readTripwire(log) };
}
{
  const SHA = git(stubDir, ['rev-parse', 'HEAD']);
  // An annotated tag's own object id, which the hook must peel to HEAD.
  git(stubDir, ['tag', '-a', '-m', 'release', 'v1.1.0']);
  const TAG_SHA = git(stubDir, ['rev-parse', 'refs/tags/v1.1.0']);
  check('hook fixture: the annotated tag object differs from the commit it points at', TAG_SHA !== SHA, TAG_SHA);
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

  // The gate reads only v[0-9]* tags as releases, so a v-word tag is no release
  // and must not be routed there (it would be blocked as a mismatched version).
  h = runHook('refs/tags/vendor-snapshot ' + SHA + ' refs/tags/vendor-snapshot ' + ZERO + '\n', { RELEASE_EXIT: '1' });
  check('hook: refs/tags/vendor-snapshot push runs the tripwire only, never the gate', h.status === 0 && h.ran === 'tripwire' && h.args === '', JSON.stringify(h));

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

  // The gate is told what is pushed, not left to read HEAD.
  h = runHook('refs/heads/feature ' + SHA + ' refs/heads/main ' + ZERO + '\n');
  check('hook: main push passes --remote <remote> --commit <local sha>', h.status === 0 && h.args === '--remote origin --commit ' + SHA + ' --reuse-pass', JSON.stringify(h));
  // Issue #249: the hook asks the gate to reuse a recorded pass, so a release
  // push does not rerun the suites on files that just passed.
  const hm = runHook('refs/heads/main ' + SHA + ' refs/heads/main ' + ZERO + '\n');
  const ht = runHook('refs/tags/v1.1.0 ' + TAG_SHA + ' refs/tags/v1.1.0 ' + ZERO + '\n');
  check('249 reuse: the hook passes --reuse-pass for a main push and a release-tag push',
    hm.status === 0 && / --reuse-pass$/.test(hm.args) && ht.status === 0 && / --reuse-pass$/.test(ht.args), JSON.stringify([hm.args, ht.args]));
  h = runHook('refs/tags/v1.1.0 ' + TAG_SHA + ' refs/tags/v1.1.0 ' + ZERO + '\n');
  check('hook: tag push passes --pushing-tag <tag>:<local sha>', h.status === 0 && h.args === '--pushing-tag v1.1.0:' + TAG_SHA + ' --reuse-pass', JSON.stringify(h));
  h = runHook('refs/heads/feature ' + SHA + ' refs/heads/feature ' + ZERO + '\nrefs/heads/main ' + SHA + ' refs/heads/main ' + ZERO + '\nHEAD ' + TAG_SHA + ' refs/tags/v2.0.0 ' + ZERO + '\n');
  check('hook: main plus tag in one push passes both, and nothing for the feature ref',
    h.status === 0 && h.args === '--remote origin --commit ' + SHA + ' --pushing-tag v2.0.0:' + TAG_SHA + ' --reuse-pass', JSON.stringify(h));
  h = runHook('refs/tags/v1.1.0 ' + TAG_SHA + ' refs/tags/v1.1.0 ' + ZERO + '\n');
  check('hook: a tag-only push names no remote (the tag push is what publishes the tag)', h.status === 0 && h.args === '--pushing-tag v1.1.0:' + TAG_SHA + ' --reuse-pass', JSON.stringify(h));

  // Issue #178: the tripwire is told the remote and handed every ref line, so it
  // scans what each destination lacks rather than HEAD's upstream. Deletions
  // reach it too (it skips them itself); the gate routing is unchanged.
  const twIs = (hr, stdin) => hr.tw !== null && hr.tw.args.join(' ') === '--remote origin' && hr.tw.stdin === stdin;
  const NEW_REF = 'refs/heads/feature ' + SHA + ' refs/heads/feature ' + ZERO + '\n';
  h = runHook(NEW_REF);
  check('hook: a new branch reaches the tripwire as --remote origin with its ref line on stdin', h.status === 0 && h.ran === 'tripwire' && twIs(h, NEW_REF), JSON.stringify(h));
  const EXISTING_REF = 'refs/heads/feature ' + SHA + ' refs/heads/feature ' + STUB_OLD + '\n';
  h = runHook(EXISTING_REF);
  check('hook: an existing branch hands the tripwire its remote sha', h.status === 0 && h.ran === 'tripwire' && twIs(h, EXISTING_REF), JSON.stringify(h));
  const DELETED_REF = '(delete) ' + ZERO + ' refs/heads/old-topic ' + SHA + '\n';
  h = runHook(DELETED_REF);
  check('hook: a deletion still reaches the tripwire, and never the gate', h.status === 0 && h.ran === 'tripwire' && h.args === '' && twIs(h, DELETED_REF), JSON.stringify(h));
  const TAG_REF = 'refs/tags/v1.1.0 ' + TAG_SHA + ' refs/tags/v1.1.0 ' + ZERO + '\n';
  h = runHook(TAG_REF);
  check('hook: a release tag reaches the tripwire with its line, then the gate with --pushing-tag', h.status === 0 && h.ran === 'tripwire,release' && twIs(h, TAG_REF) && h.args === '--pushing-tag v1.1.0:' + TAG_SHA + ' --reuse-pass', JSON.stringify(h));
  const MAIN_REF = 'refs/heads/main ' + SHA + ' refs/heads/main ' + STUB_OLD + '\n';
  h = runHook(NEW_REF + MAIN_REF + DELETED_REF + TAG_REF);
  check('hook: a multi-ref push hands the tripwire every line in order, and the gate main and the tag',
    h.status === 0 && h.ran === 'tripwire,release' && twIs(h, NEW_REF + MAIN_REF + DELETED_REF + TAG_REF) && h.args === '--remote origin --commit ' + SHA + ' --pushing-tag v1.1.0:' + TAG_SHA + ' --reuse-pass', JSON.stringify(h));
  h = runHook('');
  check('hook: empty stdin gives the tripwire --remote origin and no lines', h.status === 0 && twIs(h, ''), JSON.stringify(h));
  // The lines are data: shell syntax in a ref name is passed through, never run.
  const ODD_REF = 'refs/heads/feature ' + SHA + ' refs/heads/$(touch pwned)\\c ' + ZERO + '\n';
  h = runHook(ODD_REF);
  check('hook: shell syntax in a ref line reaches the tripwire byte for byte and is never run', h.status === 0 && twIs(h, ODD_REF) && !fs.existsSync(path.join(stubDir, 'pwned')), JSON.stringify(h));

  // R11: the tripwire scans HEAD and its upstream, so a pushed ref that is not
  // the checked-out commit is refused before anything runs.
  h = runHook('refs/heads/other ' + STUB_OLD + ' refs/heads/other ' + ZERO + '\n');
  check('hook: a branch that is not the checked-out commit is refused (exit 1), tripwire never runs',
    h.status === 1 && h.ran === '' && /refs\/heads\/other \([0-9a-f]{40}\) pushed to refs\/heads\/other is not the checked-out commit/.test(h.out) && /Check out other and push from it\./.test(h.out), JSON.stringify(h));
  h = runHook('refs/heads/other ' + STUB_OLD + ' refs/heads/main ' + ZERO + '\n', { RELEASE_EXIT: '0' });
  check('hook: other-branch:main is refused before the gate', h.status === 1 && h.ran === '' && h.args === '', JSON.stringify(h));
  h = runHook('refs/tags/v0.9.0 ' + STUB_OLD + ' refs/tags/v0.9.0 ' + ZERO + '\n');
  check('hook: a tag on a commit that is not checked out is refused with the tag advice',
    h.status === 1 && h.ran === '' && /tag v0\.9\.0 \([0-9a-f]{40}\) is not the checked-out commit/.test(h.out) && /push the tag from there/.test(h.out), JSON.stringify(h));
  h = runHook('refs/heads/feature ' + SHA + ' refs/heads/feature ' + ZERO + '\nrefs/heads/other ' + STUB_OLD + ' refs/heads/other ' + ZERO + '\n');
  check('hook: one stray ref in a multi-ref push refuses the whole push', h.status === 1 && h.ran === '' && /refs\/heads\/other/.test(h.out) && !/refs\/heads\/feature \(/.test(h.out), JSON.stringify(h));
  h = runHook('refs/heads/feature ' + 'f'.repeat(40) + ' refs/heads/feature ' + ZERO + '\n');
  check('hook: an object this clone does not have is refused', h.status === 1 && h.ran === '', JSON.stringify(h));
  h = runHook('refs/heads/feature --output=x refs/heads/feature ' + ZERO + '\n');
  check('hook: a local sha that is not an object id is refused, never passed to git', h.status === 1 && h.ran === '' && !fs.existsSync(path.join(stubDir, 'x')), JSON.stringify(h));

  // Test seams are never silent.
  h = runHook('refs/heads/feature ' + SHA + ' refs/heads/feature ' + ZERO + '\n');
  check('hook: TK_PRE_PUSH_CHECK set prints that the real M11 tripwire was replaced',
    h.out.includes('TK_PRE_PUSH_CHECK is set; the real M11 tripwire (.claude/scripts/pre-push-check.js) was replaced by ' + path.join(stubDir, 'tripwire.js')), JSON.stringify(h));
  check('hook: TK_RELEASE_CHECK set prints that the real release gate was replaced', /TK_RELEASE_CHECK is set; the real release gate/.test(h.out), JSON.stringify(h));
  h = runHook('refs/heads/feature ' + SHA + ' refs/heads/feature ' + ZERO + '\n', { TK_PRE_PUSH_CHECK: '', TK_RELEASE_CHECK: '' });
  check('hook: seams unset (empty) run the default paths with no notice', h.status === 0 && h.ran === 'tripwire' && !/is set; the real/.test(h.out), JSON.stringify(h));

  // dash's echo reads backslash escapes, and \c ends its output on the spot, so
  // an echoed seam path holding \c would print cut short. printf '%s\n' keeps it.
  if (process.platform !== 'win32') {
    const oddDir = path.join(stubDir, 'odd\\cdir');
    write(oddDir, 'release.js', fs.readFileSync(path.join(stubDir, 'release.js'), 'utf8'));
    const oddGate = path.join(oddDir, 'release.js');
    h = runHook('refs/tags/v1.1.0 ' + SHA + ' refs/tags/v1.1.0 ' + ZERO + '\n', { TK_RELEASE_CHECK: oddGate });
    check('hook: a seam value holding \\c prints intact in the seam notice',
      h.out.includes('the real release gate (scripts/release-check.js) was replaced by ' + oddGate + '\n'), JSON.stringify(h));
    check('hook: a seam value holding \\c prints intact in the release-push line, and that gate still runs',
      h.out.includes('; running ' + oddGate + '\n') && h.status === 0 && h.ran === 'tripwire,release', JSON.stringify(h));
  }
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
    const gateArgs = fs.existsSync(log + '.args') ? fs.readFileSync(log + '.args', 'utf8').trim() : '';
    return { status: p.status, out: (p.stdout || '') + (p.stderr || ''), ran: readLog(log), args: gateArgs, tw: readTripwire(log) };
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
  const featureSha = git(repo, ['rev-parse', 'feature']);
  check('git push to main: hook ran release-check', p.status === 0 && p.ran === 'tripwire,release', JSON.stringify(p));
  check('git push to main: git\'s own ref line reaches release-check as --remote <remote> --commit <pushed sha>', p.args === '--remote ' + remote + ' --commit ' + featureSha + ' --reuse-pass', JSON.stringify(p));
  p = push([':refs/heads/main']);
  check('git push deleting main: release-check not run', p.status === 0 && p.ran === 'tripwire', JSON.stringify(p));

  // End to end with the real gate (only the tripwire stubbed; an empty
  // TK_RELEASE_CHECK means the default scripts/release-check.js).
  write(repo, 'scripts/release-check.js', fs.readFileSync(SCRIPT, 'utf8'));
  write(repo, 'scripts/test-ok.js', 'process.exit(0);\n');
  const real = { TK_RELEASE_CHECK: '' };
  git(repo, ['tag', 'v1.2.0']);
  p = push(['refs/tags/v1.2.0'], real);
  check('real gate: git push of tag v1.2.0 on a 1.0.0 commit is blocked and not published',
    p.status !== 0 && /FAIL tag version - pushed tag v1\.2\.0 does not match plugin\.json version 1\.0\.0/.test(p.out) && git(remote, ['tag', '--list', 'v1.2.0']) === '', JSON.stringify(p));
  // R11 end to end: an unbumped branch pushed while HEAD is feature is refused
  // by the hook itself, before the tripwire or the gate, whatever the target.
  git(repo, ['checkout', '-q', '-b', 'unbumped']);
  write(repo, 'plugin/commands/explore.md', '# Explore\n\nUnbumped.\n');
  git(repo, ['add', 'plugin']); git(repo, ['commit', '-qm', 'unbumped plugin change']);
  git(repo, ['checkout', '-q', 'feature']);
  p = push(['unbumped:main'], real);
  check('git push unbumped:main while feature is checked out: refused by the hook, nothing ran, main not published',
    p.status !== 0 && p.ran === '' && /refs\/heads\/unbumped \([0-9a-f]{40}\) pushed to refs\/heads\/main is not the checked-out commit/.test(p.out) && git(remote, ['branch', '--list', 'main']) === '', JSON.stringify(p));
  p = push(['unbumped']);
  check('git push of a branch that is not checked out: refused, branch not published', p.status !== 0 && p.ran === '' && git(remote, ['branch', '--list', 'unbumped']) === '', JSON.stringify(p));
  // From its own checkout the same push reaches the gate, which reads the
  // pushed commit and blocks the unbumped change.
  git(repo, ['checkout', '-q', 'unbumped']);
  p = push(['unbumped:main'], real);
  check('real gate: git push unbumped:main from its checkout is blocked by the version bump check',
    p.status !== 0 && /FAIL version bump - commit [0-9a-f]{12}: plugin\/ changed since v1\.0\.0 without a version bump/.test(p.out) && git(remote, ['branch', '--list', 'main']) === '', JSON.stringify(p));
  git(repo, ['checkout', '-q', 'feature']);
  p = push(['feature:main'], real);
  check('real gate: git push of the release commit to main passes, its tag v1.0.0 already on the remote',
    p.status === 0 && /release-check: \d+ passed, 0 failed/.test(p.out) && /ok {3}release tag - commit [0-9a-f]{12}: tag v1\.0\.0 is on [0-9a-f]{12}, and on remote /.test(p.out), JSON.stringify(p));

  // R2 end to end, in the documented release order: tag locally, push the tag
  // from the tagged checkout, then main. Main before the tag is blocked.
  git(repo, ['checkout', '-q', '-b', 'rel', 'feature']);
  write(repo, 'plugin/commands/explore.md', '# Explore\n\nRelease 1.1.0.\n');
  setPlugin(repo, '1.1.0', gitSubdir('v1.1.0'));
  git(repo, ['add', 'plugin', '.claude-plugin']); git(repo, ['commit', '-qm', 'release 1.1.0']);
  git(repo, ['tag', '-a', '-m', 'release', 'v1.1.0']);
  p = push(['rel:main'], real);
  check('real gate: main pushed before its release tag is blocked (tag not on the remote)',
    p.status !== 0 && /FAIL release tag - commit [0-9a-f]{12}: tag v1\.1\.0 is not on remote /.test(p.out) && git(remote, ['rev-parse', 'main']) === featureSha, JSON.stringify(p));
  p = push(['rel:main', 'refs/tags/v1.1.0'], real);
  check('real gate: main and its release tag in one push, tag not yet on the remote: blocked, neither published',
    p.status !== 0 && /FAIL release tag - tag v1\.1\.0, commit [0-9a-f]{12}: tag v1\.1\.0 is not on remote .*push the tag on its own first/.test(p.out) && git(remote, ['rev-parse', 'main']) === featureSha && git(remote, ['tag', '--list', 'v1.1.0']) === '', JSON.stringify(p));
  p = push(['refs/tags/v1.1.0'], real);
  check('real gate: the annotated release tag pushed from the tagged checkout passes', p.status === 0 && git(remote, ['tag', '--list', 'v1.1.0']) === 'v1.1.0', JSON.stringify(p));
  p = push(['rel:main'], real);
  check('real gate: main pushed after its release tag passes', p.status === 0 && /ok {3}release tag - .*and on remote /.test(p.out) && git(remote, ['rev-parse', 'main']) === git(repo, ['rev-parse', 'rel']), JSON.stringify(p));
  // The published tag moved locally onto a fix commit (git tag -f), then main
  // and the moved tag pushed together. Without the gate the remote would refuse
  // the tag (already exists) yet still take main, pinned to the old tree.
  const relSha = git(repo, ['rev-parse', 'rel']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'fix after tagging']);
  git(repo, ['tag', '-f', '-a', '-m', 'release', 'v1.1.0']);
  p = push(['rel:main', 'refs/tags/v1.1.0'], real);
  check('real gate: main pushed with a moved release tag the remote holds at another commit is blocked, main not moved',
    p.status !== 0 && /FAIL release tag - .*on remote .* points at [0-9a-f]{12}, not [0-9a-f]{12} like the local tag/.test(p.out) && git(remote, ['rev-parse', 'main']) === relSha && git(remote, ['rev-parse', 'v1.1.0^{commit}']) === relSha, JSON.stringify(p));

  // Issue #178 end to end: git's own ref lines reach the tripwire (a stub here)
  // with the remote, for a new branch, an existing one, a tag, two refs at once
  // and a deletion. The block after this one runs the real tripwire.
  git(repo, ['checkout', '-q', '-b', 'probe']);
  const probe1 = git(repo, ['rev-parse', 'HEAD']);
  p = push(['probe']);
  check('git push of a new branch: the tripwire gets --remote <remote> and git\'s line with an all-zero remote sha',
    p.status === 0 && p.tw !== null && p.tw.args.join(' ') === '--remote ' + remote && p.tw.stdin === 'refs/heads/probe ' + probe1 + ' refs/heads/probe ' + ZERO + '\n', JSON.stringify(p));
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'probe 2']);
  const probe2 = git(repo, ['rev-parse', 'HEAD']);
  p = push(['probe']);
  check('git push of an existing branch: the line carries the sha the remote holds', p.status === 0 && p.tw !== null && p.tw.stdin === 'refs/heads/probe ' + probe2 + ' refs/heads/probe ' + probe1 + '\n', JSON.stringify(p));
  git(repo, ['tag', 'probe-tag']);
  p = push(['refs/tags/probe-tag']);
  check('git push of a tag: the tripwire gets its refs/tags/ line, and a non-release tag never reaches the gate',
    p.status === 0 && p.ran === 'tripwire' && p.tw !== null && p.tw.stdin === 'refs/tags/probe-tag ' + probe2 + ' refs/tags/probe-tag ' + ZERO + '\n', JSON.stringify(p));
  p = push(['HEAD:refs/heads/multi-a', 'HEAD:refs/heads/multi-b']);
  check('git push of two refs at once: the tripwire gets both lines', p.status === 0 && p.tw !== null && p.tw.stdin.split('\n').filter(Boolean).length === 2
    && p.tw.stdin.indexOf(probe2 + ' refs/heads/multi-a ' + ZERO + '\n') !== -1 && p.tw.stdin.indexOf(probe2 + ' refs/heads/multi-b ' + ZERO + '\n') !== -1, JSON.stringify(p));
  p = push([':refs/heads/multi-a']);
  check('git push deleting a branch: the tripwire gets git\'s (delete) line', p.status === 0 && p.tw !== null && p.tw.stdin === '(delete) ' + ZERO + ' refs/heads/multi-a ' + probe2 + '\n', JSON.stringify(p));
}

// --- the real tripwire behind the hook (issue #178) --------------------------------
// The issue's first reproduction end to end: git feeds the hook, and the hook
// hands the ref lines to the real pre-push-check.js (TK_PRE_PUSH_CHECK=''). The
// topic branch tracks origin/topic, which already holds a flagged commit pushed
// with --no-verify. Before the fix the check scanned only what origin/topic
// lacked, so HEAD pushed to develop published the flagged commit.
{
  const repo = tmp('release-real-tripwire-');
  initRepo(repo);
  git(repo, ['config', 'core.excludesFile', '/dev/null']);
  git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  write(repo, 'scripts/git-hooks/pre-push', fs.readFileSync(HOOK, 'utf8'));
  fs.chmodSync(path.join(repo, 'scripts/git-hooks/pre-push'), 0o755);
  write(repo, '.claude/scripts/pre-push-check.js', fs.readFileSync(path.join(ROOT, '.claude', 'scripts', 'pre-push-check.js'), 'utf8'));
  write(repo, 'README.md', '# scratch\n');
  commitAll(repo, 'seed');
  git(repo, ['config', 'core.hooksPath', 'scripts/git-hooks']);
  const remote = tmp('release-real-remote-');
  git(remote, ['init', '-q', '--bare']);
  git(repo, ['remote', 'add', 'origin', remote]);
  const env = Object.assign({}, process.env, { TK_PRE_PUSH_CHECK: '', TK_RELEASE_CHECK: '' });
  const push = (args) => {
    const p = spawnSync('git', ['push', ...args], { cwd: repo, encoding: 'utf8', env });
    return { status: p.status, out: (p.stdout || '') + (p.stderr || '') };
  };
  const onRemote = (ref) => spawnSync('git', ['rev-parse', '--verify', '-q', ref], { cwd: remote, encoding: 'utf8' }).stdout.trim();
  // main goes up without the hook: this scratch repo has no release gate to run.
  let p = push(['-q', '--no-verify', 'origin', 'main']);
  p = push(['-q', 'origin', 'main:develop']);
  check('real tripwire: a clean new branch pushed through the hook passes', p.status === 0 && onRemote('refs/heads/develop') === git(repo, ['rev-parse', 'main']), JSON.stringify(p));
  git(repo, ['checkout', '-q', '-b', 'topic']);
  const FAKE_PAT = 'gl' + 'pat-' + 'A1b2C3d4E5f6G7h8J9k0';
  write(repo, 'ci/runner.env', 'RUNNER' + '=' + FAKE_PAT + '\n');
  commitAll(repo, 'flagged commit');
  p = push(['-q', '--no-verify', '-u', 'origin', 'topic']);
  write(repo, 'src/a.js', 'console.log(1);\n');
  commitAll(repo, 'clean commit');
  p = push(['origin', 'HEAD:develop']);
  check('real tripwire: HEAD pushed to develop blocks on the flagged commit already on origin/topic, and develop does not move',
    p.status !== 0 && p.out.indexOf('[gitlab-pat] ci/runner.env') !== -1 && /pre-push-check: scanned 2 commits for origin refs\/heads\/develop \(base [0-9a-f]{7}\)/.test(p.out)
    && onRemote('refs/heads/develop') === git(repo, ['rev-parse', 'main']), JSON.stringify(p));
  check('real tripwire: the report the push printed names the token but masks it', p.out.indexOf('[gitlab-pat]') !== -1 && p.out.indexOf(FAKE_PAT) === -1, JSON.stringify(p));
  p = push(['origin', 'HEAD:topic']);
  check('real tripwire: the same HEAD pushed to its upstream passes (only the clean commit is new there)',
    p.status === 0 && onRemote('refs/heads/topic') === git(repo, ['rev-parse', 'HEAD']) && /pre-push-check: scanned 1 commit for origin refs\/heads\/topic/.test(p.out), JSON.stringify(p));
}

// The gate's default suite set includes this file, so a gate run aimed at this
// repository would run this file again and again. Every direct run above, and
// the subfolder run (cwd a scratch repo), targets a scratch repo; the hook runs
// use stubs or a scratch repo's own copy of the gate.
const intoRepo = gateTargets.filter(t => { const rel = path.relative(ROOT, path.resolve(t)); return !rel.startsWith('..') && !path.isAbsolute(rel); });
check('no gate run in this file targets this repository (the default set runs this file)', gateTargets.length > 0 && intoRepo.length === 0, intoRepo.join(', '));

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
