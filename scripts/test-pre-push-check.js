#!/usr/bin/env node
'use strict';
//
// test-pre-push-check.js - assertions for .claude/scripts/pre-push-check.js,
// the M11 pre-push tripwire. (issue #164)
//
// Maintainer-only: lives under scripts/, which the installers never propagate, so
// downstream projects do not inherit it.
//
// Follows the repo's dependency-free test convention (see test-correction-ledger.js
// and scripts/setup/test-installer-guarantees.sh): assert, print, exit non-zero on
// any failure. No test framework.
//
// Every test runs in a throwaway git repository under the OS temp directory, so a
// run never reads or writes this repo's history.
//
// ---------------------------------------------------------------------------
// WHY THE FIXTURES LOOK LIKE THIS (read before adding one)
// ---------------------------------------------------------------------------
// Every fake credential below is ASSEMBLED FROM FRAGMENTS AT RUNTIME, never
// written as a literal in the shape the tripwire hunts. This is not style. The
// commit that last added a pattern to the tripwire (the fal.ai key) also added
// test fixtures written in the real shapes, and the toolkit's own push then
// tripped its own tripwire with five hits - the scanner's only exemption is its
// own file, because an allow-list would train the "push anyway" reflex the
// tripwire exists to prevent. Splitting a literal costs nothing; widening the
// scanner costs everything.
//
// Two shapes need splitting, not one. A fixture value must dodge its own
// pattern AND the generic secret-assignment pattern, which matches any
// recognized key name followed by = and a quoted run - so 'CI_TOKEN=' + VAR
// fires even though the token itself is assembled. Split before the = too.
//
// The split must fall INSIDE the matched shape. 'gl' + 'pat-' + <body> is safe
// because no source line holds "glpat-" followed by a token body; splitting at
// the wrong place (a netrc line broken after the credential rather than before
// it) leaves a real match on the line and the tripwire fires on this file.
//
// Usage: node scripts/test-pre-push-check.js

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TRIPWIRE = path.resolve(__dirname, '..', '.claude', 'scripts', 'pre-push-check.js');

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' :: ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' :: ' + detail : '')); }
}

// --- fixtures: assembled at runtime, see the header note --------------------
const BODY20 = 'A1b2C3d4E5f6G7h8J9k0';          // exactly 20 token characters
const BODY19 = 'A1b2C3d4E5f6G7h8J9k';           // one short: the near-miss
const GITLAB_PAT = 'gl' + 'pat-' + BODY20;
const GITLAB_PAT_SHORT = 'gl' + 'pat-' + BODY19;
const GITLAB_RUNNER = 'gl' + 'rt-' + BODY20;
const NPM_TOKEN = 'npm' + '_' + 'a'.repeat(36);
const NPM_TOKEN_SHORT = 'npm' + '_' + 'a'.repeat(35);
const GITLAB_RUNNER_SHORT = 'gl' + 'rt-' + BODY19;
const PYPI_TOKEN = 'py' + 'pi-' + 'AgEIcHlwaS5vcmcCJDY3' + BODY20;
const PYPI_TOKEN_SHORT = 'py' + 'pi-' + 'AgEIcHlwaS5v';
const JWT_HEAD = 'ey' + 'J' + 'hbGciOiJIUzI1NiJ9';
const JWT_BODY = 'ey' + 'J' + 'zdWIiOiIxMjM0NTY3OCJ9';
const JWT_SIG = 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6y';
const JWT = JWT_HEAD + '.' + JWT_BODY + '.' + JWT_SIG;
// The netrc split falls BEFORE the credential, so no line here carries the
// keyword followed by a value - which is exactly what the pattern matches.
const NETRC_VALUE = 's3cret' + 'value99';
const NETRC_KEYWORD = 'pass' + 'word';
const NETRC_RECORD = 'machine gitlab.com login testuser ' + NETRC_KEYWORD + ' ' + NETRC_VALUE;

// The two sentences that must NEVER match. Both are real: the first is the
// reporter's own documentation, which defeated a word-list exclusion because the
// bracket before the verb slipped past the lookahead.
const PROSE_1 = '(password) is Enterprise-only or a $150/mo Pro add-on, NOT part of base Pro';
const PROSE_2 = 'password protection is an Enterprise add-on';
// Ordinary sign-in documentation. Every line here matched the netrc pattern before
// the credential-shape requirement was added: any filler word satisfies the middle
// slot and any six-letter word satisfies the value. Keep these - they are the
// regression net for a pattern that blocked pushes on English.
const PROSE_AUTH = [
  'The login and password fields are required.',
  'login and password combination is invalid',
  'Store the login and password securely in the vault.',
  'machine learning login and password fields',
  'Reset your login and password requirements.',
];

// --- sandbox helpers --------------------------------------------------------
function makeRepo(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tripwire-' + label + '-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const g = function (args) {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  };
  g(['init', '-q']);
  g(['config', 'user.email', 'test@example.com']);
  g(['config', 'user.name', 'Test']);
  g(['config', 'commit.gpgsign', 'false']);
  return { root: root, repo: repo, g: g };
}

// Run the tripwire in a repo. Returns exit status plus both streams; a clean run
// is defined by the contract as exit 0 AND empty stdout, so both are captured.
function run(repo) {
  const r = spawnSync('node', [TRIPWIRE], { cwd: repo, encoding: 'utf-8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function commitFile(sb, name, contents, message) {
  fs.mkdirSync(path.dirname(path.join(sb.repo, name)), { recursive: true });
  fs.writeFileSync(path.join(sb.repo, name), contents, 'utf-8');
  sb.g(['add', name]);
  sb.g(['commit', '-qm', message]);
}

function cleanup(sb) { fs.rmSync(sb.root, { recursive: true, force: true }); }

// --- 1. each new pattern is caught -----------------------------------------
function patternTests() {
  console.log('\n1. new patterns are caught');
  const cases = [
    ['gitlab-pat', 'deploy/gitlab.env', 'CI_TOKEN' + '=' + GITLAB_PAT + '\n'],
    ['gitlab-token', 'deploy/runner.env', 'RUNNER=' + GITLAB_RUNNER + '\n'],
    // The real .npmrc shape: unquoted value under a key secret-assignment does
    // not know, which is why the fallback never caught it.
    ['npm-token', 'ci/npmrc.sample', '//registry.npmjs.org/:_authToken' + '=' + NPM_TOKEN + '\n'],
    ['jwt', 'ci/session.txt', 'Authorization: Bearer ' + JWT + '\n'],
    // .pypirc is deliberately absent from the never-push list, so this pattern is
    // the only cover a PyPI publish token has.
    ['pypi-token', 'ci/pypirc.sample', '[pypi]\n' + 'username' + '=' + '__token__\n' + 'password' + '=' + PYPI_TOKEN + '\n'],
    // A netrc RECORD pasted somewhere that is not named .netrc - the case the
    // filename check cannot see.
    ['netrc-record', 'ci/bootstrap.sh', '#!/bin/sh\ncat > ~/.netrc <<EOF\n' + NETRC_RECORD + '\nEOF\n'],
  ];
  for (const [pattern, file, contents] of cases) {
    const sb = makeRepo(pattern);
    try {
      commitFile(sb, 'README.md', 'seed\n', 'init');
      commitFile(sb, file, contents, 'add ' + file);
      const r = run(sb.repo);
      check(pattern + ' blocks the push', r.status === 1, 'exit ' + r.status);
      check(pattern + ' is named in the report', r.stdout.indexOf('[' + pattern + ']') !== -1, r.stdout.slice(0, 300));
    } catch (e) {
      check(pattern + ' test set up a repo', false, e.message);
    }
    cleanup(sb);
  }
}

// --- 2. near-misses do not fire --------------------------------------------
// A pattern that fires on a value one character short of the real thing is a
// pattern that will fire on ordinary content. Each near-miss is the real prefix
// with a body too short to be a credential.
function nearMissTests() {
  console.log('\n2. near-misses stay silent');
  const sb = makeRepo('nearmiss');
  try {
    commitFile(sb, 'README.md', 'seed\n', 'init');
    commitFile(sb, 'notes.md', [
      'A GitLab token prefix with a short body: ' + GITLAB_PAT_SHORT,
      'An npm prefix one character short: ' + NPM_TOKEN_SHORT,
      'A GitLab runner-token prefix with a short body: ' + GITLAB_RUNNER_SHORT,
      'A PyPI prefix with a body too short to be a token: ' + PYPI_TOKEN_SHORT,
      'A lone JWT header with no payload or signature: ' + JWT_HEAD,
      '',
    ].join('\n'), 'add near-miss notes');
    const r = run(sb.repo);
    check('near-miss values do not block the push', r.status === 0, 'exit ' + r.status + ' :: ' + r.stdout.slice(0, 300));
    check('near-miss run prints nothing to stdout', r.stdout === '', r.stdout.slice(0, 300));
  } catch (e) {
    check('near-miss test set up a repo', false, e.message);
  }
  cleanup(sb);
}

// --- 3. ordinary English does not fire --------------------------------------
// The reason netrc-record needs BOTH a record shape and a credential-shaped
// value: the shape alone still matched ordinary sign-in prose.
function falsePositiveTests() {
  console.log('\n3. prose containing the word does not fire');
  const sb = makeRepo('prose');
  try {
    commitFile(sb, 'README.md', 'seed\n', 'init');
    commitFile(sb, 'docs/pricing.md', ['# Pricing', '', PROSE_1, '', PROSE_2, '', ...PROSE_AUTH, ''].join('\n'), 'add pricing docs');
    const r = run(sb.repo);
    check('the reporter\'s real false positive does not block', r.status === 0, 'exit ' + r.status + ' :: ' + r.stdout.slice(0, 300));
    check('prose run prints nothing to stdout', r.stdout === '', r.stdout.slice(0, 300));
    check('ordinary sign-in documentation does not block',
      r.status === 0 && r.stdout.indexOf('netrc-record') === -1,
      'exit ' + r.status + ' :: ' + r.stdout.slice(0, 300));
  } catch (e) {
    check('prose test set up a repo', false, e.message);
  }
  cleanup(sb);
}

// --- 4. .netrc is caught by NAME, and the base exemption applies ------------
// A .netrc is entirely credentials, so there is no line to match: the name is
// the check. The exemption is the same one every never-push path gets - a file
// already on the remote cannot be leaked again by this push.
function netrcFilenameTests() {
  console.log('\n4. .netrc is blocked by name, with the base exemption');

  const sb = makeRepo('netrc-name');
  try {
    commitFile(sb, 'README.md', 'seed\n', 'init');
    // Deliberately EMPTY of anything the line scanner could match: this asserts
    // the filename check fired, not the pattern.
    commitFile(sb, '.netrc', '# nothing here matches any pattern\n', 'add netrc');
    const r = run(sb.repo);
    check('.netrc blocks the push on its name alone', r.status === 1, 'exit ' + r.status);
    check('.netrc is named in the report', r.stdout.indexOf('.netrc') !== -1, r.stdout.slice(0, 300));
  } catch (e) {
    check('.netrc name test set up a repo', false, e.message);
  }
  cleanup(sb);

  const wb = makeRepo('netrc-win');
  try {
    commitFile(wb, 'README.md', 'seed\n', 'init');
    commitFile(wb, '_netrc', '# the Windows spelling\n', 'add _netrc');
    const r = run(wb.repo);
    check('_netrc (the Windows spelling) blocks too', r.status === 1, 'exit ' + r.status);
  } catch (e) {
    check('_netrc test set up a repo', false, e.message);
  }
  cleanup(wb);

  // The exemption needs a real remote so the script can resolve a range base.
  const eb = makeRepo('netrc-base');
  try {
    const bare = path.join(eb.root, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', bare], { stdio: ['ignore', 'pipe', 'ignore'] });
    commitFile(eb, 'README.md', 'seed\n', 'init');
    commitFile(eb, '.netrc', '# already published\n', 'add netrc');
    eb.g(['remote', 'add', 'origin', bare]);
    eb.g(['push', '-q', '-u', 'origin', 'HEAD']);
    const pushed = run(eb.repo);
    check('nothing outgoing after the push is clean', pushed.status === 0, 'exit ' + pushed.status + ' :: ' + pushed.stdout.slice(0, 200));

    // Touch the already-published .netrc. The filename check sees it again, but
    // existsInBase() knows the remote already has it, so it is not re-reported.
    commitFile(eb, '.netrc', '# already published, now edited\n', 'edit netrc');
    const after = run(eb.repo);
    check('an already-published .netrc is not re-reported (existsInBase)',
      after.status === 0, 'exit ' + after.status + ' :: ' + after.stdout.slice(0, 300));

    // But a NEW secret added to that same tracked file still fires: the secret
    // scan runs per-commit over added lines and carries no base exemption.
    commitFile(eb, '.netrc', '# already published\n' + NETRC_RECORD + '\n', 'add a credential to netrc');
    const leak = run(eb.repo);
    check('a new credential in an already-published file still fires',
      leak.status === 1 && leak.stdout.indexOf('[netrc-record]') !== -1,
      'exit ' + leak.status + ' :: ' + leak.stdout.slice(0, 300));
  } catch (e) {
    check('existsInBase test set up a remote', false, e.message);
  }
  cleanup(eb);
}

// --- 5. masking covers the whole line, not just the trigger ----------------
// One line can carry two credentials and the script emits one report line per
// matching pattern, so masking only the match that fired republishes its
// neighbour in the report an LLM then re-reads.
function maskingTest() {
  console.log('\n5. every credential on a reported line is masked');
  const sb = makeRepo('mask');
  try {
    commitFile(sb, 'README.md', 'seed\n', 'init');
    commitFile(sb, 'ci/both.env', 'GITLAB=' + GITLAB_PAT + ' NPM=' + NPM_TOKEN + '\n', 'add two credentials on one line');
    const r = run(sb.repo);
    check('two credentials on one line block the push', r.status === 1, 'exit ' + r.status);
    check('the GitLab token is masked in the report', r.stdout.indexOf(GITLAB_PAT) === -1, 'the full token was printed');
    check('the npm token is masked in the report', r.stdout.indexOf(NPM_TOKEN) === -1, 'the full token was printed');
  } catch (e) {
    check('masking test set up a repo', false, e.message);
  }
  cleanup(sb);
}

// --- 6. the exit-code contract ---------------------------------------------
// 0 clean and silent, 1 hit, 2 could not check. Exit 2 is the one that matters
// most: it is NOT an authorization to push, and a caller that treats any
// non-1 status as clean would push unchecked.
function exitCodeTests() {
  console.log('\n6. the exit-code contract');
  const sb = makeRepo('exit');
  try {
    commitFile(sb, 'README.md', 'seed\n', 'init');
    commitFile(sb, 'src/app.js', 'console.log("ordinary code");\n', 'add code');
    const clean = run(sb.repo);
    check('exit 0 on a clean range', clean.status === 0, 'exit ' + clean.status + ' :: ' + clean.stdout.slice(0, 200));
    check('a clean run prints nothing to stdout', clean.stdout === '', clean.stdout.slice(0, 200));

    commitFile(sb, 'ci/token.env', 'CI_TOKEN' + '=' + GITLAB_PAT + '\n', 'add a token');
    const hit = run(sb.repo);
    check('exit 1 on a hit', hit.status === 1, 'exit ' + hit.status);

    // Detached HEAD: the script cannot tell what a push would publish, so it
    // must fail closed with 2 rather than report clean.
    sb.g(['checkout', '-q', '--detach']);
    const detached = run(sb.repo);
    check('exit 2 when the range cannot be determined', detached.status === 2, 'exit ' + detached.status);
    check('exit 2 says so on stderr, not stdout', detached.stdout === '' && detached.stderr.indexOf('detached HEAD') !== -1,
      'stdout=' + detached.stdout.slice(0, 120) + ' stderr=' + detached.stderr.slice(0, 200));
  } catch (e) {
    check('exit-code test set up a repo', false, e.message);
  }
  cleanup(sb);
}

// --- 7. the layout check (issue #144) --------------------------------------
// When .claude/.toolkit-tools.json names tools, the tripwire runs
// build-layouts.js --check and a failing check blocks the push. The stub build
// scripts below test the WIRING (exit code and report line); the build logic
// itself is covered by scripts/test-build-layouts.js.
function layoutTests() {
  console.log("\n7. the layout check blocks a stale generated layout");
  const STALE = "process.stderr.write(\"build-layouts.js --check: 1 problem(s):\\n  stale (source changed, rebuild): .agents/skills/review/SKILL.md\\n\"); process.exit(1);\n";
  const FRESH = "process.exit(0);\n";
  const sb = makeRepo("layout");
  try {
    commitFile(sb, "README.md", "seed\n", "init");
    commitFile(sb, ".claude/.toolkit-tools.json", "{ \"tools\": [\"codex\"] }\n", "record tools");
    commitFile(sb, ".claude/scripts/build-layouts.js", STALE, "stub build: stale");
    const hit = run(sb.repo);
    check("a stale layout blocks the push", hit.status === 1, "exit " + hit.status + " :: " + hit.stdout.slice(0, 300));
    check("the report names the layout section", hit.stdout.indexOf("Generated layouts are out of date") !== -1, hit.stdout.slice(0, 300));
    check("the report carries the build script's own line", hit.stdout.indexOf(".agents/skills/review/SKILL.md") !== -1, hit.stdout.slice(0, 300));
    commitFile(sb, ".claude/scripts/build-layouts.js", FRESH, "stub build: current");
    const ok = run(sb.repo);
    check("a current layout does not block (near-miss)", ok.status === 0, "exit " + ok.status + " :: " + ok.stdout.slice(0, 300));
    check("a current layout prints nothing to stdout", ok.stdout === "", ok.stdout.slice(0, 300));
    commitFile(sb, ".claude/.toolkit-tools.json", "{ \"tools\": [] }\n", "no tools recorded");
    commitFile(sb, ".claude/scripts/build-layouts.js", STALE, "stub build: stale again");
    const skipped = run(sb.repo);
    check("no recorded tools skips the layout check entirely", skipped.status === 0, "exit " + skipped.status + " :: " + skipped.stdout.slice(0, 300));
  } catch (e) {
    check("layout test set up a repo", false, e.message);
  }
  cleanup(sb);
}

// --- run --------------------------------------------------------------------
patternTests();
nearMissTests();
falsePositiveTests();
netrcFilenameTests();
maskingTest();
exitCodeTests();
layoutTests();

console.log('');
if (failures.length === 0) {
  console.log(passed + ' checks passed.\n');
  process.exit(0);
}
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach(function (f) { console.log('  - ' + f); });
console.log('');
process.exit(1);
