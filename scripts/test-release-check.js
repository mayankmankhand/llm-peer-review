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
  check('hook: main push passes --remote <remote> --commit <local sha>', h.status === 0 && h.args === '--remote origin --commit ' + SHA, JSON.stringify(h));
  h = runHook('refs/tags/v1.1.0 ' + TAG_SHA + ' refs/tags/v1.1.0 ' + ZERO + '\n');
  check('hook: tag push passes --pushing-tag <tag>:<local sha>', h.status === 0 && h.args === '--pushing-tag v1.1.0:' + TAG_SHA, JSON.stringify(h));
  h = runHook('refs/heads/feature ' + SHA + ' refs/heads/feature ' + ZERO + '\nrefs/heads/main ' + SHA + ' refs/heads/main ' + ZERO + '\nHEAD ' + TAG_SHA + ' refs/tags/v2.0.0 ' + ZERO + '\n');
  check('hook: main plus tag in one push passes both, and nothing for the feature ref',
    h.status === 0 && h.args === '--remote origin --commit ' + SHA + ' --pushing-tag v2.0.0:' + TAG_SHA, JSON.stringify(h));
  h = runHook('refs/tags/v1.1.0 ' + TAG_SHA + ' refs/tags/v1.1.0 ' + ZERO + '\n');
  check('hook: a tag-only push names no remote (the tag push is what publishes the tag)', h.status === 0 && h.args === '--pushing-tag v1.1.0:' + TAG_SHA, JSON.stringify(h));

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
  check('hook: a release tag reaches the tripwire with its line, then the gate with --pushing-tag', h.status === 0 && h.ran === 'tripwire,release' && twIs(h, TAG_REF) && h.args === '--pushing-tag v1.1.0:' + TAG_SHA, JSON.stringify(h));
  const MAIN_REF = 'refs/heads/main ' + SHA + ' refs/heads/main ' + STUB_OLD + '\n';
  h = runHook(NEW_REF + MAIN_REF + DELETED_REF + TAG_REF);
  check('hook: a multi-ref push hands the tripwire every line in order, and the gate main and the tag',
    h.status === 0 && h.ran === 'tripwire,release' && twIs(h, NEW_REF + MAIN_REF + DELETED_REF + TAG_REF) && h.args === '--remote origin --commit ' + SHA + ' --pushing-tag v1.1.0:' + TAG_SHA, JSON.stringify(h));
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
  check('git push to main: git\'s own ref line reaches release-check as --remote <remote> --commit <pushed sha>', p.args === '--remote ' + remote + ' --commit ' + featureSha, JSON.stringify(p));
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
