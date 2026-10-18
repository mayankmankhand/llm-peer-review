#!/usr/bin/env node
'use strict';
// test-doc-check.js - assertions for .claude/scripts/doc-check.js (issue #262):
// the two checks a script can be sure of when the docs and the code disagree.
// Links: a relative link or heading anchor in a doc that no longer resolves.
// Old names: a doc that still names a file or command the window deleted or
// renamed. And the must-never side, which is most of the point: the probe that
// scoped #262 found 87 of 553 backticked file names and 13 of 428 slash
// commands in this repo's docs "missing" with none of them real drift, so the
// check reports only exact old names, and these cases pin the shapes it must
// stay quiet on (a name that still exists, a bare name another file still has,
// a path inside a longer path, a Claude Code built-in, fenced or commented text,
// CHANGELOG.md).
//
// Every case builds its own scratch repository under the OS temp dir with a
// hermetic git: no global or system config, a fixed author. The script is
// loaded lazily, so a missing script fails each case instead of the suite.
// Dependency-free; exits non-zero on any failure.
//
//   node scripts/test-doc-check.js

const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const SCRIPT = path.resolve(REPO, '.claude', 'scripts', 'doc-check.js');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failures.push(name + (detail ? ' - ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' - ' + String(detail).slice(0, 300) : '')); }
}

// --- a hermetic git -----------------------------------------------------------
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

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-check-'));
process.on('exit', function () {
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

let repoCount = 0;
function newRepo(label) {
  const dir = path.join(sandbox, label + '-' + (++repoCount));
  fs.mkdirSync(dir, { recursive: true });
  g(dir, ['init', '-q']);
  return dir;
}
function g(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
}
function write(dir, rel, text) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
function commitAll(dir, msg) { g(dir, ['add', '-A']); g(dir, ['commit', '-q', '-m', msg]); return g(dir, ['rev-parse', 'HEAD']).trim(); }

// Run the script in a repo; json is the parsed stdout, or null.
function run(dir, args) {
  const r = spawnSync(process.execPath, [SCRIPT].concat(args || []), { cwd: dir, encoding: 'utf8', env: ENV });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json: json };
}
const BUILT = fs.existsSync(SCRIPT);
const NOT_BUILT = 'not built yet: .claude/scripts/doc-check.js is missing';

// --- the fixture: a base commit, then a window that deletes and renames --------
// The docs are written once, at the base, and never touched again: that is the
// drift. The window deletes src/old.js and src/util.js (lib/util.js stays),
// renames src/calc.js to src/math.js with its content unchanged (so git reads
// it as a rename, not a delete and an add), and deletes the gone and both
// commands (a skill named both stays).
const BODY = 'module.exports = function () { return 1; };\n';
const repo = newRepo('drift');
write(repo, 'src/old.js', BODY);
write(repo, 'src/calc.js', 'module.exports.add = function (a, b) { return a + b; };\n');
write(repo, 'src/util.js', BODY);
write(repo, 'lib/util.js', BODY);
write(repo, 'src/keep.js', BODY);
write(repo, '.claude/commands/gone.md', '# Gone\n');
write(repo, '.claude/commands/kept.md', '# Kept\n');
write(repo, '.claude/commands/both.md', '# Both\n');
write(repo, '.claude/skills/both/SKILL.md', '---\nname: both\n---\n');
write(repo, 'README.md', [
  '# Project',                                   // 1
  '',                                            // 2
  'Read the [guide](docs/guide.md).',            // 3
  'See [the usage](docs/guide.md#usage).',       // 4
  'Also [missing](docs/missing.md).',            // 5
  'And [a lost section](docs/guide.md#no-such-heading).', // 6
  'The [calc module](src/calc.js) does math.',   // 7
  '',
].join('\n'));
write(repo, 'docs/guide.md', [
  '# Guide',                                     // 1
  '',                                            // 2
  '## Usage',                                    // 3
  '',                                            // 4
  'The entry point is `src/old.js`.',            // 5
  'Math lives in `src/calc.js`, so `calc.js` is the file to read.', // 6
  'Run `/gone` or `/tk:gone args` to clean up.', // 7
  'Helpers are in `util.js`.',                   // 8
  'Still here: `src/keep.js`, `/kept`, `/both`, `/reload-plugins`, `your-project/src/old.js`.', // 9
  '',                                            // 10
  '```sh',                                       // 11
  'node src/old.js',                             // 12
  '`src/old.js`',                                // 13
  '```',                                         // 14
  '',                                            // 15
  '<!-- `src/old.js` in a comment',              // 16
  'spanning `src/calc.js` two lines -->',        // 17
  '',
].join('\n'));
write(repo, 'CHANGELOG.md', '# Changelog\n\n- Added `src/old.js` and `/gone`.\n');
const base = commitAll(repo, 'base');
g(repo, ['rm', '-q', 'src/old.js', 'src/util.js', '.claude/commands/gone.md', '.claude/commands/both.md']);
g(repo, ['mv', 'src/calc.js', 'src/math.js']);
const head = commitAll(repo, 'the window');
const WINDOW = base + '..' + head;

const plain = BUILT ? run(repo, []) : null;
const windowed = BUILT ? run(repo, ['--window', WINDOW]) : null;
const hits = windowed && windowed.json && Array.isArray(windowed.json.oldNames) ? windowed.json.oldNames : [];
function hit(doc, line, name) { return hits.find(h => h.doc === doc && h.line === line && h.name === name); }
function links(res) { return res && res.json && Array.isArray(res.json.links) ? res.json.links : []; }
function shown(x) { return JSON.stringify(x).slice(0, 250); }

// --- links -------------------------------------------------------------------
(function () {
  const name = 'links: a link to a missing file is reported';
  if (!BUILT) return check(name, false, NOT_BUILT);
  const l = links(plain);
  const missing = l.find(x => x.doc === 'README.md' && x.target === 'docs/missing.md');
  check(name, plain.status === 0 && missing && missing.line === 5 && missing.problem === 'no such file', 'links: ' + shown(l));
})();

(function () {
  const name = 'links: a link to a missing heading is reported';
  if (!BUILT) return check(name, false, NOT_BUILT);
  const l = links(plain);
  const bad = l.find(x => x.doc === 'README.md' && x.target === 'docs/guide.md#no-such-heading');
  const good = l.find(x => x.target === 'docs/guide.md#usage' || x.target === 'docs/guide.md');
  check(name, bad && bad.line === 6 && bad.problem === 'no such heading' && !good, 'links: ' + shown(l));
})();

// --- old names ---------------------------------------------------------------
(function () {
  const name = 'old names: a doc naming a file the window deleted is reported';
  if (!BUILT) return check(name, false, NOT_BUILT);
  const h = hit('docs/guide.md', 5, 'src/old.js');
  check(name, windowed.status === 0 && h && h.was === 'deleted', 'oldNames: ' + shown(hits));
})();

(function () {
  const name = 'old names: a doc naming a file the window renamed is reported with the new name';
  if (!BUILT) return check(name, false, NOT_BUILT);
  const full = hit('docs/guide.md', 6, 'src/calc.js');
  const bare = hit('docs/guide.md', 6, 'calc.js');
  const link = hit('README.md', 7, 'src/calc.js');
  // The broken link to the renamed file is reported once, as the old name that
  // says where the file went, not a second time as a plain broken link.
  const twice = links(windowed).some(x => x.doc === 'README.md' && x.line === 7);
  check(name, full && full.was === 'renamed to src/math.js' && bare && link && !twice,
    'oldNames: ' + shown(hits) + ' links: ' + shown(links(windowed)));
})();

(function () {
  const name = 'old names: a doc naming a command the window deleted is reported in both /name and /tk:name forms';
  if (!BUILT) return check(name, false, NOT_BUILT);
  const bare = hit('docs/guide.md', 7, '/gone');
  const prefixed = hit('docs/guide.md', 7, '/tk:gone');
  check(name, bare && bare.was === 'deleted' && prefixed && prefixed.was === 'deleted', 'oldNames: ' + shown(hits));
})();

(function () {
  const name = 'must-never: no hit for a name that still exists, a bare name another tracked file still has, a path inside a longer path, a Claude Code built-in command, text in a fenced block or HTML comment, or CHANGELOG.md';
  if (!BUILT) return check(name, false, NOT_BUILT);
  const expected = [['docs/guide.md', 5, 'src/old.js'], ['docs/guide.md', 6, 'src/calc.js'], ['docs/guide.md', 6, 'calc.js'],
    ['docs/guide.md', 7, '/gone'], ['docs/guide.md', 7, '/tk:gone'], ['README.md', 7, 'src/calc.js']];
  const extra = hits.filter(h => !expected.some(e => e[0] === h.doc && e[1] === h.line && e[2] === h.name));
  check(name, hits.length > 0 && extra.length === 0, 'unexpected hits: ' + shown(extra));
})();

// --- output and arguments ----------------------------------------------------
(function () {
  const name = 'output: one JSON line with a summary, also when nothing is found';
  if (!BUILT) return check(name, false, NOT_BUILT);
  const clean = newRepo('clean');
  write(clean, 'README.md', '# Clean\n\nSee [the guide](docs/guide.md) and `src/a.js`.\n');
  write(clean, 'docs/guide.md', '# Guide\n');
  write(clean, 'src/a.js', BODY);
  const b = commitAll(clean, 'base');
  write(clean, 'src/b.js', BODY);
  const h = commitAll(clean, 'the window');
  const r = run(clean, ['--window', b + '..' + h]);
  const lines = r.stdout.split('\n').filter(Boolean);
  const j = r.json;
  check(name, r.status === 0 && lines.length === 1 && j && j.docs === 2 && j.links.length === 0
    && j.oldNames.length === 0 && typeof j.summary === 'string' && /0 broken links/.test(j.summary),
    'exit ' + r.status + ', stdout: ' + r.stdout.slice(0, 200) + ' stderr: ' + r.stderr.slice(0, 200));
})();

(function () {
  const name = 'arguments: a window that starts with a dash or an unknown flag exits 2 and runs nothing';
  if (!BUILT) return check(name, false, NOT_BUILT);
  const dash = run(repo, ['--window', '--output=x..HEAD']);
  const side = run(repo, ['--window', 'HEAD..-x']);
  const flag = run(repo, ['--bogus']);
  const wrote = fs.existsSync(path.join(repo, 'x..HEAD')) || fs.existsSync(path.join(repo, 'x'));
  check(name, dash.status === 2 && side.status === 2 && flag.status === 2 && !wrote,
    'exits: ' + [dash.status, side.status, flag.status].join(', ') + (wrote ? ', and git wrote a file' : ''));
})();

console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach(f => console.log('  FAIL ' + f.slice(0, 400)));
process.exit(1);
