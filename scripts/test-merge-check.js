#!/usr/bin/env node
'use strict';
// test-merge-check.js - assertions for .claude/scripts/merge-check.js (issue
// #232): rule 1 (a line another landing added after this branch's cut, which
// the landing removes), rule 2 (the branch's own lines that do not land), the
// cut check, and the modes around them (recording and looking up the cut, PR
// body parts, the landings on main, the decisions file the decision-checker
// reads, the landing style, the marker, changelog placement).
//
// The fixtures are the issue #232 replays, rebuilt from nothing here; nothing
// is read from reports/. Every case builds its own scratch repository under the
// OS temp dir with a hermetic git: no global or system config, no remote unless
// the case names one, a fixed author. The A-F scenario: A, B, C, D cut from
// main; A and B land; E and F are cut; C lands keeping its own side of every
// conflicted file; D keeps its own side of the generated file only; E and F
// land fixed correctly. It runs in merge, squash and rebase styles, and C's
// landing must raise exactly 9 rule-1 flags while A, B, D, E and F raise none.
// Dependency-free; exits non-zero on any failure.
//
//   node scripts/test-merge-check.js

const { spawnSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const SCRIPT = path.resolve(REPO, '.claude', 'scripts', 'merge-check.js');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failures.push(name + (detail ? ' - ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' - ' + String(detail).slice(0, 600) : '')); }
}
function section(title, fn) {
  console.log('\n' + title);
  try { fn(); }
  catch (e) { check(title + ' (section ran to the end)', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)); }
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
  GIT_EDITOR: 'true',
});

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-check-'));
process.on('exit', function () {
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

let repoCount = 0;
function newRepo(label) {
  const dir = path.join(sandbox, label + '-' + (++repoCount));
  fs.mkdirSync(dir, { recursive: true });
  g(dir, ['init', '-q']);
  g(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  return dir;
}
function g(dir, args, extraEnv) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: Object.assign({}, ENV, extraEnv || {}), stdio: ['ignore', 'pipe', 'pipe'] });
}
function gTry(dir, args, extraEnv) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: Object.assign({}, ENV, extraEnv || {}) });
  return { ok: r.status === 0, out: r.stdout || '', err: r.stderr || '' };
}
function rev(dir, ref) { return g(dir, ['rev-parse', ref]).trim(); }
function write(dir, rel, text) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
function read(dir, rel) { return fs.readFileSync(path.join(dir, rel), 'utf8'); }
function commitAll(dir, msg, extraEnv) { g(dir, ['add', '-A']); g(dir, ['commit', '-q', '-m', msg], extraEnv); return rev(dir, 'HEAD'); }

// Run the script; json is the parsed stdout or null.
function mc(dir, args, env) {
  const r = spawnSync(process.execPath, [SCRIPT].concat(args), { cwd: dir, encoding: 'utf8', env: env || ENV });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
  return { status: r.status, json, stderr: r.stderr || '', stdout: r.stdout || '' };
}
function landing(dir, l, extra) {
  return mc(dir, ['--landing', '--before', l.before, '--after', l.after, '--cut', l.cut, '--tip', l.tip].concat(extra || []));
}
function flagLines(r) { return r.json && Array.isArray(r.json.flags) ? r.json.flags.map((f) => f.line).sort() : null; }

// --- conflict fixing, the way the replays did it ----------------------------------
function conflicted(dir) { return g(dir, ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean); }
function keepBoth(dir, rel) {
  write(dir, rel, read(dir, rel).split('\n').filter((l) => !/^(<<<<<<< |=======$|>>>>>>> )/.test(l)).join('\n'));
}
// quality: good (keep both, rebuild generated), lossy (the branch's whole file
// for every conflicted file), lossy-gen (text kept both, the generated file the
// branch's). branchSide: which checkout side is the branch in this operation.
function resolve(dir, quality, branchSide, rebuild) {
  const files = conflicted(dir);
  for (const f of files.filter((x) => !x.startsWith('gen/'))) {
    if (quality === 'lossy') g(dir, ['checkout', '--' + branchSide, '--', f]);
    else keepBoth(dir, f);
    g(dir, ['add', '--', f]);
  }
  if (files.some((x) => x.startsWith('gen/'))) {
    if (quality === 'good') rebuild(dir); else g(dir, ['checkout', '--' + branchSide, '--', 'gen/bundle.txt']);
    g(dir, ['add', '--', 'gen/bundle.txt']);
  }
}
// Cut a branch from main and record its cut through the script, as /worktree will.
function cut(dir, branch, from) {
  g(dir, ['branch', branch, from || 'main']);
  const r = mc(dir, ['--record-cut', branch]);
  if (r.status !== 0) throw new Error('record-cut failed: ' + r.stderr);
  return r.json.cut;
}
// Land a branch in one of three styles; returns { pr, before, after, cut, tip }.
function land(dir, style, branch, quality, rebuild, fixHook) {
  const before = rev(dir, 'main');
  const tip = rev(dir, branch);
  const cutSha = g(dir, ['config', '--get', 'branch.' + branch + '.tkCut']).trim();
  const fix = fixHook || ((side) => resolve(dir, quality, side, rebuild));
  if (style === 'merge') {
    if (!gTry(dir, ['merge', '--no-ff', '-q', '-m', 'Merge ' + branch, branch]).ok) { fix('theirs'); g(dir, ['commit', '-q', '--no-edit']); }
  } else if (style === 'squash') {
    g(dir, ['checkout', '-q', branch]);
    if (!gTry(dir, ['merge', '-q', '-m', 'Update ' + branch, 'main']).ok) { fix('ours'); g(dir, ['commit', '-q', '--no-edit']); }
    g(dir, ['checkout', '-q', 'main']);
    gTry(dir, ['merge', '--squash', '-q', branch]);
    gTry(dir, ['commit', '-q', '-m', branch + ' (squashed)']);   // empty when the fix kept main's side
  } else {
    g(dir, ['checkout', '-q', branch]);
    if (!gTry(dir, ['rebase', '-q', 'main']).ok) { fix('theirs'); g(dir, ['rebase', '--continue']); }
    g(dir, ['checkout', '-q', 'main']);
    g(dir, ['merge', '--ff-only', '-q', branch]);
  }
  return { pr: branch, before, after: rev(dir, 'main'), cut: cutSha, tip };
}

// --- the A-F fixture --------------------------------------------------------------
const SPACER = '// spacer one\n// spacer two\n// spacer three\n\n';
const APP = ['alpha', 'beta', 'gamma', 'delta'].map((n) => 'function ' + n + '() {\n  return \'' + n + ' v1\';\n}\n').join('\n' + SPACER);
function rebuildBundle(dir) {
  const names = fs.readdirSync(path.join(dir, 'src')).sort();
  const texts = names.map((n) => read(dir, 'src/' + n));
  const all = texts.join('');
  const head = '# GENERATED - do not edit. files=' + names.length + ' lines=' + all.split('\n').length + ' sum=' + crypto.createHash('sha1').update(all).digest('hex').slice(0, 12);
  write(dir, 'gen/bundle.txt', head + '\n' + names.map((n, i) => '== src/' + n + '\n' + texts[i]).join(''));
}
function work(dir, branch, summary, editApp, extraFiles) {
  g(dir, ['checkout', '-q', branch]);
  write(dir, 'src/app.js', editApp(read(dir, 'src/app.js')));
  for (const rel of Object.keys(extraFiles || {})) write(dir, rel, extraFiles[rel]);
  write(dir, 'CHANGELOG.md', read(dir, 'CHANGELOG.md').replace('## Unreleased\n', '## Unreleased\n\n- ' + branch + ': ' + summary + '\n'));
  write(dir, 'LESSONS.md', read(dir, 'LESSONS.md') + '\n## ' + branch + '\n- **Lesson from ' + branch + '.**\n');
  rebuildBundle(dir);
  commitAll(dir, branch + ': ' + summary);
  g(dir, ['checkout', '-q', 'main']);
}
function buildAF(style) {
  const dir = newRepo('af-' + style);
  write(dir, 'src/app.js', APP);
  write(dir, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\n## 1.0.0\n- First release.\n');
  write(dir, 'LESSONS.md', '# Lessons\n\n## Base\n- **Keep it simple.**\n');
  write(dir, '.claude/toolkit/generated.json', JSON.stringify([{ paths: ['gen/'], rebuild: 'node rebuild.js' }]) + '\n');
  rebuildBundle(dir);
  commitAll(dir, 'M0: start');
  for (const b of ['A', 'B', 'C', 'D']) cut(dir, b);
  work(dir, 'A', 'faster alpha', (t) => t.replace("return 'alpha v1';", "return 'alpha v2 (A: faster)';"));
  work(dir, 'B', 'beta v2, gamma renamed', (t) => t.replace("return 'beta v1';", "return 'beta v2 (B)';").replace('function gamma()', 'function gammaV2()'));
  work(dir, 'C', 'safer alpha', (t) => t.replace("return 'alpha v1';", "return 'alpha v2 (C: safer)';"));
  work(dir, 'D', 'delta v2 and extra()', (t) => t.replace("return 'delta v1';", "return 'delta v2 (D)';"), { 'src/extra.js': 'function extra() {\n  gamma();\n}\n' });
  const landings = [];
  landings.push(land(dir, style, 'A', 'good', rebuildBundle));
  landings.push(land(dir, style, 'B', 'good', rebuildBundle));
  for (const b of ['E', 'F']) cut(dir, b);
  work(dir, 'E', 'gamma body', (t) => t.replace("return 'gamma v1';", "return 'gamma v3 (E)';"));
  work(dir, 'F', 'beta v3 on purpose', (t) => t.replace("return 'beta v2 (B)';", "return 'beta v3 (F, on purpose)';"));
  landings.push(land(dir, style, 'C', 'lossy', rebuildBundle));
  landings.push(land(dir, style, 'D', 'lossy-gen', rebuildBundle));
  landings.push(land(dir, style, 'E', 'good', rebuildBundle));
  landings.push(land(dir, style, 'F', 'good', rebuildBundle));
  return { dir, landings };
}
const C_LINES = [
  '- A: faster alpha', '- B: beta v2, gamma renamed', '## A', '## B', '- **Lesson from A.**', '- **Lesson from B.**',
  "return 'alpha v2 (A: faster)';", "return 'beta v2 (B)';", 'function gammaV2() {',
].sort();

for (const style of ['merge', 'squash', 'rebase']) {
  section('A-F in ' + style + ' style: C\'s landing raises exactly its 9 lines, nothing else does', () => {
    const { dir, landings } = buildAF(style);
    const byPr = {};
    for (const l of landings) byPr[l.pr] = { l, r: landing(dir, l) };
    const c = byPr.C.r;
    check(style + ': C exits 1 with exactly the 9 lines A and B added', c.status === 1 && JSON.stringify(flagLines(c)) === JSON.stringify(C_LINES), c.stderr);
    check(style + ': every C flag is rule 1 and names the landing that added it', c.json && c.json.flags.every((f) => f.rule === 1 && /(A|B)/.test(f.addedIn)), JSON.stringify(c.json && c.json.flags.map((f) => f.addedIn)));
    for (const pr of ['A', 'B', 'D', 'E', 'F']) check(style + ': ' + pr + ' exits 0 with no flag', byPr[pr].r.status === 0 && byPr[pr].r.json.flagged === 0, byPr[pr].r.stderr);
    check(style + ': no flag anywhere names a generated path', landings.every((l) => byPr[l.pr].r.json.flags.every((f) => !f.file.startsWith('gen/'))));
    check(style + ': each flag carries a keep line naming the adding commit, the file and the text', c.json && c.json.flags.every((f) => f.keep === 'Kept on purpose: ' + f.addedBy.slice(0, 7) + ' ' + f.file + ': ' + f.line));
    if (style !== 'merge') {
      const mb = g(dir, ['merge-base', byPr.C.l.before, rev(dir, 'C')]).trim();
      const weak = landing(dir, Object.assign({}, byPr.C.l, { cut: mb }));
      check(style + ': with the merge-base as the cut, C\'s losses are invisible (why the cut is recorded)', weak.status === 0 && weak.json.flagged === 0, weak.stderr);
    }
  });
}

// --- right and left ---------------------------------------------------------------
// PR1 sets the rule to right; PR2 sets it to left, on the same line or elsewhere.
function buildLR(kase, style) {
  const dir = newRepo('lr-' + kase + '-' + style);
  write(dir, 'rules.md', '# Rules\n\nDirection: straight\n\nSpeed: slow\n');
  write(dir, 'guide.md', '# Guide\n\nFollow the direction in rules.md.\n');
  commitAll(dir, 'M0');
  const edit = (branch, rel, from, to) => { g(dir, ['checkout', '-q', branch]); write(dir, rel, read(dir, rel).replace(from, to)); commitAll(dir, branch + ' work'); g(dir, ['checkout', '-q', 'main']); };
  const noop = () => {};
  let out;
  if (kase === 'cut-after') {
    cut(dir, 'PR1'); edit('PR1', 'rules.md', 'Direction: straight', 'Direction: right');
    const l1 = land(dir, style, 'PR1', 'good', noop);
    cut(dir, 'PR2'); edit('PR2', 'rules.md', 'Direction: right', 'Direction: left');
    out = [l1, land(dir, style, 'PR2', 'good', noop)];
  } else {
    cut(dir, 'PR1'); cut(dir, 'PR2');
    edit('PR1', 'rules.md', 'Direction: straight', 'Direction: right');
    if (kase === 'elsewhere') edit('PR2', 'guide.md', 'Follow the direction in rules.md.', 'Always go left, whatever rules.md says.');
    else edit('PR2', 'rules.md', 'Direction: straight', 'Direction: left');
    const l1 = land(dir, style, 'PR1', 'good', noop);
    let l2;
    if (kase === 'keep-later') l2 = land(dir, style, 'PR2', 'lossy', noop);
    else if (kase === 'keep-earlier') l2 = land(dir, style, 'PR2', 'lossy', noop, (side) => { const main = side === 'theirs' ? 'ours' : 'theirs'; for (const f of conflicted(dir)) { g(dir, ['checkout', '--' + main, '--', f]); g(dir, ['add', '--', f]); } });
    else if (kase === 'combined') l2 = land(dir, style, 'PR2', 'good', noop, () => { write(dir, 'rules.md', '# Rules\n\nDirection: right, then left\n\nSpeed: slow\n'); g(dir, ['add', '--', 'rules.md']); });
    else l2 = land(dir, style, 'PR2', 'good', noop);
    out = [l1, l2];
  }
  return { dir, landings: out };
}
const LR = [
  ['keep-later', 'merge', 1, ['Direction: right'], [1]],
  ['keep-earlier', 'merge', 1, ['Direction: left'], [2]],
  ['keep-earlier', 'squash', 1, ['Direction: left'], [2]],
  ['elsewhere', 'merge', 0, [], []],
  ['cut-after', 'merge', 0, [], []],
  ['combined', 'merge', 2, ['Direction: left', 'Direction: right'], [1, 2]],
];
section('right and left: one rule per way a fix can go wrong', () => {
  for (const [kase, style, n, lines, rules] of LR) {
    const { dir, landings } = buildLR(kase, style);
    const r1 = landing(dir, landings[0]);
    const r2 = landing(dir, landings[1]);
    check(kase + ' (' + style + '): PR1 lands clean', r1.status === 0 && r1.json.flagged === 0, r1.stderr);
    check(kase + ' (' + style + '): PR2 raises ' + n + ' flag(s), ' + (lines.join(' and ') || 'none'),
      r2.json && r2.json.flagged === n && JSON.stringify(flagLines(r2)) === JSON.stringify(lines.slice().sort()) &&
      JSON.stringify(r2.json.flags.map((f) => f.rule).sort()) === JSON.stringify(rules), r2.stderr);
    if (kase === 'keep-earlier' && style === 'squash') check('keep-earlier (squash): the empty landing is named in a note', r2.json.notes.some((x) => /changes nothing/.test(x)), JSON.stringify(r2.json.notes));
  }
});

// --- duplicates and identical additions ---------------------------------------------
section('rule 2 counts copies: a dropped } is caught, an identical addition is not flagged', () => {
  const dir = newRepo('dup');
  write(dir, 'f.js', 'function a() {\n  return 1;\n}\n');
  commitAll(dir, 'M0');
  cut(dir, 'M'); cut(dir, 'X');
  g(dir, ['checkout', '-q', 'M']); write(dir, 'f.js', read(dir, 'f.js') + 'function c() {\n  return 3;\n}\n'); commitAll(dir, 'M adds c'); g(dir, ['checkout', '-q', 'main']);
  g(dir, ['checkout', '-q', 'X']); write(dir, 'f.js', read(dir, 'f.js') + 'function b() {\n  return 2;\n}\n'); commitAll(dir, 'X adds b'); g(dir, ['checkout', '-q', 'main']);
  land(dir, 'merge', 'M', 'good', () => {});
  const lx = land(dir, 'merge', 'X', 'good', () => {}, () => {
    write(dir, 'f.js', 'function a() {\n  return 1;\n}\nfunction c() {\n  return 3;\n}\nfunction b() {\n  return 2;\n');
    g(dir, ['add', '--', 'f.js']);
  });
  const r = landing(dir, lx);
  check('X\'s dropped closing brace raises one rule-2 flag', r.status === 1 && r.json.flagged === 1 && r.json.flags[0].rule === 2 && r.json.flags[0].line === '}', r.stderr);

  const dir2 = newRepo('same');
  write(dir2, 'g.txt', 'one\ntwo\n');
  commitAll(dir2, 'M0');
  cut(dir2, 'P'); cut(dir2, 'Q');
  for (const b of ['P', 'Q']) { g(dir2, ['checkout', '-q', b]); write(dir2, 'g.txt', 'one\nsame line\ntwo\n'); commitAll(dir2, b + ' adds the same line'); g(dir2, ['checkout', '-q', 'main']); }
  land(dir2, 'merge', 'P', 'good', () => {});
  const lq = land(dir2, 'merge', 'Q', 'good', () => {});
  const r2 = landing(dir2, lq);
  check('a line both sides added identically, which git keeps once, is not flagged', r2.status === 0 && r2.json.flagged === 0, r2.stderr);
});

// --- kept on purpose ------------------------------------------------------------------
section('kept on purpose: suppresses exactly its flag, in a --kept file or a later commit on main', () => {
  const { dir, landings } = buildLR('keep-later', 'merge');
  const first = landing(dir, landings[1]);
  const keep = first.json.flags[0].keep;
  const keptFile = path.join(sandbox, 'kept-' + repoCount + '.txt');
  fs.writeFileSync(keptFile, keep + '\n');
  const viaFile = landing(dir, landings[1], ['--kept', keptFile]);
  check('a --kept file suppresses the flag and counts it', viaFile.status === 0 && viaFile.json.flagged === 0 && viaFile.json.keptOnPurpose === 1, viaFile.stderr);
  const flagged = mc(dir, ['--since', landings[0].before]);
  const named = flagged.stderr.split('\n').filter((l) => /was added by/.test(l));
  check('--since names the landing that dropped each flagged line', flagged.status === 1 && named.length === 1 && named[0].startsWith('landing ' + landings[1].after.slice(0, 7) + ' ('), flagged.stderr);
  g(dir, ['commit', '-q', '--allow-empty', '-m', 'Accept a removal\n\n' + keep]);
  const since = mc(dir, ['--since', landings[0].before]);
  check('an empty commit on main carrying the line suppresses it in --since', since.status === 0 && since.json.flagged === 0 && since.json.keptOnPurpose === 1, since.stderr);
  check('the empty commit is a direct commit, not a landing', since.json.directCommits === 1 && since.json.landings.length === 2, JSON.stringify(since.json.landings.map((l) => l.kind)));

  const dir2 = newRepo('kept-same-text');
  write(dir2, 'f.txt', 'top\nmid\nbot\n');
  commitAll(dir2, 'M0');
  cut(dir2, 'X');
  g(dir2, ['checkout', '-q', 'X']); write(dir2, 'f.txt', 'top\nMID by X\nbot\n'); commitAll(dir2, 'X edits mid'); g(dir2, ['checkout', '-q', 'main']);
  write(dir2, 'f.txt', 'top\nsame\nmid\nbot\n'); const c1 = commitAll(dir2, 'c1 adds same at the top');
  write(dir2, 'f.txt', 'top\nsame\nmid\nsame\nbot\n'); commitAll(dir2, 'c2 adds same at the bottom');
  const lx = land(dir2, 'merge', 'X', 'lossy', () => {});
  const all = landing(dir2, lx);
  const kf = path.join(sandbox, 'kept-c1.txt');
  fs.writeFileSync(kf, 'Kept on purpose: ' + c1.slice(0, 7) + ' f.txt: same\n');
  const one = landing(dir2, lx, ['--kept', kf]);
  check('X\'s whole-file fix removes both "same" lines: 2 flags', all.json && all.json.flagged === 2, all.stderr);
  check('keeping c1\'s line leaves c2\'s same-text line flagged', one.json && one.json.flagged === 1 && one.json.keptOnPurpose === 1 && !one.json.flags[0].addedBy.startsWith(c1.slice(0, 7)), one.stderr);
});

// --- the cut point ----------------------------------------------------------------------
section('the cut point: recorded, looked up in order, kept through a rename, and checked against main', () => {
  const dir = newRepo('cut');
  write(dir, 'a.txt', 'a\n');
  const m0 = commitAll(dir, 'M0');
  g(dir, ['branch', 'Y', 'main']);
  write(dir, 'a.txt', 'a\nb\n');
  const m1 = commitAll(dir, 'M1 moves main');
  const rec = mc(dir, ['--record-cut', 'Y']);
  check('--record-cut takes the cut from the branch log and writes it', rec.status === 0 && rec.json.cut === m0 && rec.json.source === 'branch-log' && rec.json.written === true, rec.stdout + rec.stderr);
  check('a second --record-cut writes nothing', mc(dir, ['--record-cut', 'Y']).json.written === false);
  check('--cut finds the recorded cut first', mc(dir, ['--cut', 'Y']).json.source === 'recorded');
  g(dir, ['config', '--unset', 'branch.Y.tkCut']);
  const body = path.join(sandbox, 'body-cut.md');
  fs.writeFileSync(body, 'Summary.\n\nCut from: ' + m0 + '\n');
  check('without the setting, the PR body\'s Cut from: line comes next', mc(dir, ['--cut', 'Y', '--pr-body', body]).json.source === 'pr-body');
  check('without either, the branch log', mc(dir, ['--cut', 'Y']).json.source === 'branch-log');
  fs.rmSync(path.join(dir, '.git', 'logs', 'refs', 'heads', 'Y'), { force: true });
  const weak = mc(dir, ['--cut', 'Y']).json;
  check('with the branch log gone, the merge-base, marked weaker', weak.source === 'merge-base' && weak.weaker === true && weak.cut === m0, JSON.stringify(weak));

  g(dir, ['remote', 'add', 'origin', 'https://example.invalid/x.git']);
  g(dir, ['update-ref', 'refs/remotes/origin/feat', m1]);
  g(dir, ['branch', 'feat2', 'origin/feat']);
  check('a branch created from a remote-tracking ref is not cut there', mc(dir, ['--cut', 'feat2']).json.source === 'merge-base');

  g(dir, ['branch', 'Z', 'main']);
  const z = mc(dir, ['--record-cut', 'Z']).json.cut;
  g(dir, ['branch', '-m', 'Z', 'Z2']);
  const z2 = mc(dir, ['--cut', 'Z2']).json;
  check('the recorded cut survives git branch -m', z2.source === 'recorded' && z2.cut === z, JSON.stringify(z2));

  cut(dir, 'P');
  g(dir, ['checkout', '-q', 'P']); write(dir, 'p.txt', 'p\n'); commitAll(dir, 'P work'); g(dir, ['checkout', '-q', 'main']);
  g(dir, ['branch', 'Q', 'P']);
  const q = mc(dir, ['--record-cut', 'Q']).json;
  g(dir, ['checkout', '-q', 'Q']); write(dir, 'q.txt', 'q\n'); commitAll(dir, 'Q work'); g(dir, ['checkout', '-q', 'main']);
  check('--cut reports a cut that is not on main', mc(dir, ['--cut', 'Q']).json.onMain === false);
  const lq = land(dir, 'merge', 'Q', 'good', () => {});
  const r = landing(dir, lq);
  check('a landing whose cut is not on main raises the cut flag', r.status === 1 && r.json.flags.some((f) => f.rule === 'cut'), r.stderr);
  check('the cut flag says the other branch\'s commits would land too', /would also land that branch/.test(r.stderr), r.stderr);
  check('the recorded cut for Q was P\'s tip', q.cut === rev(dir, 'P'));
});

// --- PR bodies ----------------------------------------------------------------------------
section('PR bodies: the three parts, a missing part, a legacy body, and both hosts\' JSON', () => {
  const dir = newRepo('body');
  write(dir, 'a.txt', 'a\n');
  commitAll(dir, 'M0');
  const block = '## Unreleased - A Title\n\n```js\nconst x = 1;\n```\n\n- item';
  const full = 'Summary line.\n\n## Decisions\n- Use X - because Y\n- Keep Z\n\n## Changelog\n````markdown\n' + block + '\n````\n\nCut from: ' + 'a'.repeat(40) + '\n';
  const f = path.join(sandbox, 'full.md');
  fs.writeFileSync(f, full);
  const r = mc(dir, ['--pr-body', f]).json;
  check('decisions are the lines under ## Decisions', r.decisions === '- Use X - because Y\n- Keep Z', JSON.stringify(r.decisions));
  check('the changelog block comes back byte for byte, with its own triple-backtick fence inside', r.changelog === block, JSON.stringify(r.changelog));
  check('the Cut from: line is read', r.cutFrom === 'a'.repeat(40));
  fs.writeFileSync(f, 'Summary.\n\n## Decisions\n- None recorded\n\nCut from: ' + 'b'.repeat(40) + '\n');
  const partial = mc(dir, ['--pr-body', f]).json;
  check('a body without the changelog part reads it as null', partial.changelog === null && partial.decisions === '- None recorded' && partial.cutFrom === 'b'.repeat(40));
  fs.writeFileSync(f, 'An old PR body.\n\n## Summary\nNothing structured.\n');
  const legacyRun = mc(dir, ['--pr-body', f]);
  const legacy = legacyRun.json;
  check('a legacy body has no parts', legacy.decisions === null && legacy.changelog === null && legacy.cutFrom === null);
  check('a legacy body names the fallback for each missing part, as three notes, and exits 0', legacyRun.status === 0 && legacy.notes.length === 3 && /no Cut from: line/.test(legacy.notes[0]) && /no ## Decisions part/.test(legacy.notes[1]) && /no ## Changelog part/.test(legacy.notes[2]) && /^note: no Cut from: line/m.test(legacyRun.stderr), JSON.stringify(legacy.notes));
  fs.writeFileSync(path.join(sandbox, 'full-again.md'), full);
  check('a body with every part carries no such note', mc(dir, ['--pr-body', path.join(sandbox, 'full-again.md')]).json.notes.length === 0);
  fs.writeFileSync(f, JSON.stringify({ body: full }));
  check('gh JSON is read through its body field', mc(dir, ['--pr-body', f]).json.changelog === block);
  fs.writeFileSync(f, JSON.stringify({ description: full }));
  check('glab JSON is read through its description field', mc(dir, ['--pr-body', f]).json.changelog === block);
});

section('--pr reads the PR through the host CLI the remote names', () => {
  const dir = newRepo('pr');
  write(dir, 'a.txt', 'a\n');
  commitAll(dir, 'M0');
  const bin = path.join(sandbox, 'bin-' + repoCount);
  fs.mkdirSync(bin);
  const marker = path.join(bin, 'ran.txt');
  const body = 'S.\n\n## Decisions\n- D1\n\nCut from: ' + 'c'.repeat(40) + '\n';
  const ghJson = JSON.stringify({ number: 7, title: 'T', body, headRefName: 'feat', headRefOid: 'd'.repeat(40), state: 'OPEN' });
  const glJson = JSON.stringify({ iid: 8, title: 'G', description: body, source_branch: 'gfeat', sha: 'e'.repeat(40), state: 'opened' });
  for (const [name, json] of [['gh', ghJson], ['glab', glJson]]) {
    write(bin, name, '#!/bin/sh\necho "' + name + ' $*" >> "' + marker + '"\ncat <<\'EOF\'\n' + json + '\nEOF\n');
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  const env = Object.assign({}, ENV, { PATH: bin + path.delimiter + ENV.PATH });
  g(dir, ['remote', 'add', 'origin', 'git@github.com:x/y.git']);
  const gh = mc(dir, ['--pr', '7'], env);
  check('the gh stub ran with pr view and the JSON fields', fs.existsSync(marker) && /^gh pr view 7 --json /m.test(fs.readFileSync(marker, 'utf8')), fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : 'no marker');
  check('gh: branch, head, decisions and cut come back', gh.json && gh.json.branch === 'feat' && gh.json.head === 'd'.repeat(40) && gh.json.decisions === '- D1' && gh.json.cutFrom === 'c'.repeat(40) && gh.json.host === 'gh', gh.stdout + gh.stderr);
  g(dir, ['remote', 'set-url', 'origin', 'git@gitlab.com:x/y.git']);
  const gl = mc(dir, ['--pr', '8'], env);
  check('glab: its field names map to the same parts', gl.json && gl.json.number === 8 && gl.json.branch === 'gfeat' && gl.json.head === 'e'.repeat(40) && gl.json.host === 'glab', gl.stdout + gl.stderr);
  check('a PR number that is not a number is a usage error', mc(dir, ['--pr', '7;rm'], env).status === 2);
});

// Issue #258 items 8 and 6: the Decisions part is its list lines only, so an
// attribution line under the list is never read as a decision, and on GitLab
// --pr prints the full reference a landing message names.
section('258: the Decisions part is its list lines, and glab\'s full reference', () => {
  const dir = newRepo('pr258');
  write(dir, 'a.txt', 'a\n');
  commitAll(dir, 'M0');
  const f = path.join(sandbox, 'body-258.md');
  // The attribution line sits under the list, with no Changelog part or Cut from: line after it.
  fs.writeFileSync(f, 'Summary.\n\n## Decisions\n- Keep it - why\n- Name it - so\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n');
  const a = mc(dir, ['--pr-body', f]).json;
  check('258 pr: the Decisions part keeps only its list lines', a && a.decisions === '- Keep it - why\n- Name it - so', 'decisions held: ' + JSON.stringify(a && a.decisions));
  fs.writeFileSync(f, '## Decisions\nThese are the decisions:\n- A - why\n- B\n\nCut from: ' + 'a'.repeat(40) + '\n');
  const b = mc(dir, ['--pr-body', f]).json;
  check('258 pr: an intro line above the list is skipped', b && b.decisions === '- A - why\n- B', 'decisions held: ' + JSON.stringify(b && b.decisions));
  // A continuation line joins its item, so a landing message's Decisions: list
  // stays one line per decision (messageDecisions stops at the first other line).
  fs.writeFileSync(f, '## Decisions\n- A - because\n  the reason runs on\n\n- B\n\nMore text after.\n');
  const c = mc(dir, ['--pr-body', f]).json;
  check('258 pr: continuation lines of a list item stay with it', c && c.decisions === '- A - because the reason runs on\n- B', 'decisions held: ' + JSON.stringify(c && c.decisions));
  const bin = path.join(sandbox, 'bin-258');
  fs.mkdirSync(bin);
  const body = 'S.\n\n## Decisions\n- D1\n';
  const glJson = JSON.stringify({ iid: 8, title: 'G', description: body, source_branch: 'gfeat', sha: 'e'.repeat(40), state: 'opened', references: { short: '!8', relative: '!8', full: 'grp/sub/proj!8' } });
  const ghJson = JSON.stringify({ number: 7, title: 'T', body, headRefName: 'feat', headRefOid: 'd'.repeat(40), state: 'OPEN' });
  for (const [name, json] of [['gh', ghJson], ['glab', glJson]]) {
    write(bin, name, '#!/bin/sh\ncat <<\'EOF\'\n' + json + '\nEOF\n');
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  const env = Object.assign({}, ENV, { PATH: bin + path.delimiter + ENV.PATH });
  g(dir, ['remote', 'add', 'origin', 'git@gitlab.com:grp/sub/proj.git']);
  const gl = mc(dir, ['--pr', '8'], env);
  g(dir, ['remote', 'set-url', 'origin', 'git@github.com:x/y.git']);
  const gh = mc(dir, ['--pr', '7'], env);
  check('258 pr: glab\'s full reference is printed as ref', gl.json && gl.json.ref === 'grp/sub/proj!8' && gh.json && gh.json.ref === null, 'glab ref ' + JSON.stringify(gl.json && gl.json.ref) + ', gh ref ' + JSON.stringify(gh.json && gh.json.ref));
});

// Issue #258 item 1: --landing names the files a landing deletes, and among
// them the ones the branch stopped tracking but keeps (its own .gitignore
// files ignore them at the landing), whose copy in every other checkout the
// landing deletes. Neither list is a flag. Only the landing commit's committed
// .gitignore files count: never the user's global excludes.
section('258: what a landing deletes, and what it stops tracking', () => {
  const dir = newRepo('deleted258');
  write(dir, 'keep.txt', 'keep\n');
  write(dir, 'old.txt', 'old\n');
  write(dir, 'local.cfg', 'rows: 297\n');
  write(dir, 'sub/x.cfg', 'x\n');
  write(dir, 'glob.cfg', 'g\n');
  write(dir, 'gen/bundle.txt', 'built\n');
  write(dir, '.claude/toolkit/generated.json', JSON.stringify([{ paths: ['gen/'], rebuild: 'true' }]) + '\n');
  const m0 = commitAll(dir, 'M0');
  const cutSha = cut(dir, 'feat');
  g(dir, ['checkout', '-q', 'feat']);
  g(dir, ['rm', '-q', 'old.txt']);
  g(dir, ['rm', '-q', '--cached', 'local.cfg']);
  write(dir, '.gitignore', 'local.cfg\n');
  g(dir, ['rm', '-q', '--cached', 'sub/x.cfg']);
  write(dir, 'sub/.gitignore', 'x.cfg\n');
  g(dir, ['rm', '-q', '--cached', 'glob.cfg']);   // stopped tracking with no ignore line of its own
  g(dir, ['rm', '-q', 'gen/bundle.txt']);
  g(dir, ['add', '.gitignore', 'sub/.gitignore']);
  g(dir, ['commit', '-q', '-m', 'Stop tracking the local files']);
  const tip = rev(dir, 'feat');
  // The files feat stopped tracking stay behind as untracked copies, and main
  // tracks them, so remove them before switching back (main restores them).
  for (const rel of ['local.cfg', 'sub/x.cfg', 'glob.cfg']) fs.rmSync(path.join(dir, rel), { force: true });
  g(dir, ['checkout', '-q', 'main']);
  // The user's own global excludes list glob.cfg: they say nothing about what the branch meant.
  const excludes = path.join(sandbox, 'global-excludes-258');
  fs.writeFileSync(excludes, 'glob.cfg\n');
  const globalCfg = path.join(sandbox, 'global-config-258');
  fs.writeFileSync(globalCfg, '[core]\n\texcludesFile = ' + excludes + '\n');
  const env = Object.assign({}, ENV, { GIT_CONFIG_GLOBAL: globalCfg });
  const r = mc(dir, ['--landing', '--before', m0, '--after', tip, '--cut', cutSha, '--tip', tip], env);
  const j = r.json || {};
  const del = Array.isArray(j.deleted) ? j.deleted.slice().sort() : null;
  const unt = Array.isArray(j.untracked) ? j.untracked.slice().sort() : null;
  check('258 deleted: --landing lists a file the branch deletes', del !== null && del.includes('old.txt'), 'deleted: ' + JSON.stringify(j.deleted));
  check('258 deleted: a file the branch stops tracking and ignores is listed as untracked', unt !== null && unt.includes('local.cfg') && del !== null && del.includes('local.cfg'), 'untracked: ' + JSON.stringify(j.untracked));
  check('258 deleted: an ignore line in a nested .gitignore counts', unt !== null && unt.includes('sub/x.cfg'), 'untracked: ' + JSON.stringify(j.untracked));
  check('258 deleted: a file deleted but not ignored is not untracked', unt !== null && !unt.includes('old.txt'), 'untracked: ' + JSON.stringify(j.untracked));
  check('258 deleted: a file only the user\'s global excludes ignore is not untracked', unt !== null && del !== null && del.includes('glob.cfg') && !unt.includes('glob.cfg'), 'deleted: ' + JSON.stringify(j.deleted) + ', untracked: ' + JSON.stringify(j.untracked));
  check('258 deleted: generated paths are left out', del !== null && !del.some((p) => p.startsWith('gen/')), 'deleted: ' + JSON.stringify(j.deleted));
  check('258 deleted: a clean landing that deletes a file still exits 0', r.status === 0 && j.flagged === 0 && /^note: [^\n]*local\.cfg/m.test(r.stderr), 'exit ' + r.status + ', flagged ' + j.flagged + ', stderr ' + JSON.stringify(r.stderr.split('\n').slice(0, 3)));
});

// --- landings on main, the style, the marker ------------------------------------------------
section('--since: what counts as a landing, and what cannot be checked', () => {
  const dir = newRepo('since');
  write(dir, 'a.txt', 'a\n');
  const m0 = commitAll(dir, 'M0');
  write(dir, 'b.txt', 'b\n');
  commitAll(dir, 'Fix the thing (#226)');
  cut(dir, 'X');
  g(dir, ['checkout', '-q', 'X']); write(dir, 'x.txt', 'x\n'); commitAll(dir, 'X work'); g(dir, ['checkout', '-q', 'main']);
  g(dir, ['merge', '--no-ff', '-q', '-m', 'Merge PR #5: X', 'X']);
  const web = { GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@github.com' };
  write(dir, 'c.txt', 'c\n'); commitAll(dir, 'Button squash (#12)', web);
  write(dir, 'd.txt', 'd\n'); commitAll(dir, 'A rebased commit', web);
  write(dir, 'e.txt', 'e\n'); commitAll(dir, 'Our squash (#13)\n\nCut from: ' + m0);
  const r = mc(dir, ['--since', m0]).json;
  const kinds = r.landings.map((l) => l.kind).join(',');
  check('a direct commit whose subject ends in an issue number is not a landing', r.directCommits === 1, JSON.stringify(r));
  check('the landings, in order: merge, host squash, host rebase, our squash', kinds === 'merge,host-squash,host-rebase,squash', kinds);
  const [merge, hostSquash, hostRebase, ours] = r.landings;
  check('a merge without Cut from: uses the merge-base, marked weaker', merge.cutSource === 'merge-base' && merge.weaker === true && merge.rule1 === 'checked' && merge.rule2 === 'checked' && merge.pr === 5);
  check('a button squash with no cut is not checkable for rule 1, and names its PR', /^not checkable/.test(hostSquash.rule1) && hostSquash.pr === 12);
  check('a button rebase commit is not checkable', /^not checkable/.test(hostRebase.rule1));
  check('our squash takes its cut from the landing message; its rule 2 is not checkable', ours.cutSource === 'landing message' && ours.cut === m0 && ours.rule1 === 'checked' && /^not checkable/.test(ours.rule2));
  check('not checkable is a note, never a flag: exit 0', mc(dir, ['--since', m0]).status === 0);
});

// --- submodule pointers ----------------------------------------------------------------
// A submodule is a pointer (mode 160000) to a commit, not a file of lines. A
// landing that moves one gives the line checks nothing to read, and git blame
// on it fails, so the pointer is skipped and the landing's text files are still
// checked.
section('submodule pointers: a landing that moves one is checked without it', () => {
  const dir = newRepo('gitlink');
  write(dir, 'a.txt', 'a\n');
  const m0 = commitAll(dir, 'M0');
  g(dir, ['update-index', '--add', '--cacheinfo', '160000,' + m0 + ',mod']);
  g(dir, ['commit', '-q', '-m', 'Add a submodule pointer']);
  const m1 = rev(dir, 'HEAD');
  cut(dir, 'S');
  g(dir, ['checkout', '-q', 'S']);
  g(dir, ['update-index', '--cacheinfo', '160000,' + m1 + ',mod']);
  write(dir, 'b.txt', 'b\n');
  g(dir, ['add', '--', 'b.txt']);
  g(dir, ['commit', '-q', '-m', 'Move the pointer and add b']);
  g(dir, ['checkout', '-q', 'main']);
  const l = land(dir, 'merge', 'S', 'good', () => {});
  const r = landing(dir, l);
  check('a moved submodule pointer is no git error: the landing is checked, exit 0, nothing flagged', r.status === 0 && r.json && r.json.flagged === 0, r.stderr);
});

section('--style, --marker and --mark', () => {
  const dir = newRepo('style');
  write(dir, 'a.txt', 'a\n');
  commitAll(dir, 'M0');
  check('no landings: unknown', mc(dir, ['--style']).json.style === 'unknown');
  const web = { GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@github.com' };
  write(dir, 'b.txt', 'b\n'); commitAll(dir, 'One (#1)', web);
  write(dir, 'c.txt', 'c\n'); commitAll(dir, 'Two (#2)', web);
  check('button squashes: host-squash', mc(dir, ['--style']).json.style === 'host-squash');
  // Merges made here, then merges the host's button made (GitHub's committer, or
  // GitLab's "See merge request" line): each kind wins once it is the larger.
  const mergeIn = (n, msg, env) => { g(dir, ['checkout', '-q', '-b', n]); write(dir, n + '.txt', n + '\n'); commitAll(dir, n); g(dir, ['checkout', '-q', 'main']); g(dir, ['merge', '--no-ff', '-q', '-m', msg, n], env); };
  for (const n of ['p', 'q', 'r']) mergeIn(n, 'Merge ' + n);
  let st = mc(dir, ['--style']).json;
  check('more merges made here than squashes: local-merge, with the counts', st.style === 'local-merge' && st.counts['local-merge'] === 3 && st.counts['host-squash'] === 2, JSON.stringify(st));
  mergeIn('s', 'Merge pull request #7 from o/s', web);
  mergeIn('t', 'Merge pull request #8 from o/t', web);
  mergeIn('u', "Merge branch 'u' into 'main'\n\nSee merge request group/sub/app!9", undefined);
  mergeIn('v', "Merge branch 'v' into 'main'\n\nSee merge request group/app!10", undefined);
  st = mc(dir, ['--style']).json;
  check('more button merges (GitHub committer or GitLab line) than merges made here: host-merge', st.style === 'host-merge' && st.counts['host-merge'] === 4, JSON.stringify(st));
  write(dir, 'w.txt', 'w\n'); commitAll(dir, 'Rebased one', web);
  check('a button rebase is counted apart and lands as a squash', mc(dir, ['--style']).json.counts.rebase === 1);
  check('--style squash (not a style) is refused with exit 2', mc(dir, ['--style', 'squash']).status === 2);
  check('--style host-squash records the answer', mc(dir, ['--style', 'host-squash']).json.written === true);
  const rec = mc(dir, ['--style']).json;
  check('a recorded style wins over history', rec.style === 'host-squash' && rec.source === 'recorded');
  check('--marker is null before anything is marked', mc(dir, ['--marker']).json.marker === null);
  const head = rev(dir, 'HEAD');
  check('--mark records a commit', mc(dir, ['--mark', 'HEAD']).json.marker === head);
  check('--marker reads it back', mc(dir, ['--marker']).json.marker === head);
});

// --- the decisions file -----------------------------------------------------------------------
// The right/left case in different files (rule 3's case): PR1 lands with its
// decisions in the landing message; PR2, cut before it, decides the opposite in
// another file. The file /merge hands the decision-checker holds both, and the
// same fixture in its legacy form (no lists anywhere) holds each side's changes.
section('--decisions: the file the decision-checker reads', () => {
  const dir = newRepo('decisions');
  write(dir, 'rules.md', 'Direction: straight\n');
  write(dir, 'guide.md', 'Follow the direction in rules.md.\n');
  write(dir, '.claude/toolkit/generated.json', JSON.stringify([{ paths: ['gen/'], rebuild: 'true' }]));
  write(dir, 'gen/out.txt', 'v0\n');
  const m0 = commitAll(dir, 'M0');
  const cut2 = cut(dir, 'pr2');
  // PR1 lands with a landing message that carries its decisions.
  g(dir, ['checkout', '-q', '-b', 'pr1']);
  write(dir, 'rules.md', 'Direction: right\n');
  write(dir, 'gen/out.txt', 'v1 GENERATED-ONLY\n');
  commitAll(dir, 'Set the direction to right');
  g(dir, ['checkout', '-q', 'main']);
  const msg1 = path.join(sandbox, 'msg1.txt');
  fs.writeFileSync(msg1, 'Merge PR #1: Go right\n\nGo right\n\nDecisions:\n- The direction is right - the map says so\n\nCut from: ' + m0 + '\n');
  g(dir, ['merge', '--no-ff', '-q', '-F', msg1, 'pr1']);
  const l1 = rev(dir, 'HEAD');
  // A direct commit after it: not a landing, so not a part.
  write(dir, 'notes.md', 'A note.\n');
  commitAll(dir, 'Add a note');
  // PR2, cut before PR1 landed, says the opposite elsewhere.
  g(dir, ['checkout', '-q', 'pr2']);
  write(dir, 'guide.md', 'Always go left, whatever rules.md says.\n');
  const tip2 = commitAll(dir, 'Tell readers to go left');
  g(dir, ['checkout', '-q', 'main']);
  const body = path.join(sandbox, 'pr2-body.md');
  fs.writeFileSync(body, 'Go left.\n\n## Decisions\n- Readers always go left - the left road is shorter\n\nCut from: ' + cut2 + '\n');
  const out = path.join(sandbox, 'decisions-1.md');
  let r = mc(dir, ['--decisions', '--cut', cut2, '--tip', tip2, '--pr-body', body, '--out', out]);
  let text = fs.existsSync(out) ? read(sandbox, 'decisions-1.md') : '';
  check('with lists: exit 0, the file opens with the This PR part and holds its decision', r.status === 0 && /^## This PR\n\nThe branch at [0-9a-f]{7}\n\n- Readers always go left - the left road is shorter\n/.test(text), text.slice(0, 300) + r.stderr);
  check('with lists: one Landing part, PR1, with its decision; the direct commit is not a part', (text.match(/^## /gm) || []).length === 2 && text.includes('## Landing ' + l1.slice(0, 7) + ': Merge PR #1: Go right\n\n- The direction is right - the map says so') && !text.includes('Add a note'), text);
  check('with lists: the JSON names the file, this PR\'s source and the one landing', r.json && r.json.file === out && r.json.thisPr === 'decisions' && r.json.landings.length === 1 && r.json.landings[0].commit === l1 && r.json.landings[0].decisions === 1, r.stdout);
  // The legacy form: no list in the body, none in the landing message.
  const legacyMsg = path.join(sandbox, 'msg-legacy.txt');
  // Land PR1 again, this time with a message that carries no decisions.
  g(dir, ['reset', '-q', '--hard', l1 + '^1']);
  fs.writeFileSync(legacyMsg, 'Merge PR #1: Go right\n');
  g(dir, ['merge', '--no-ff', '-q', '-F', legacyMsg, 'pr1']);
  const l1b = rev(dir, 'HEAD');
  const legacyBody = path.join(sandbox, 'pr2-legacy.json');
  fs.writeFileSync(legacyBody, JSON.stringify({ title: 'Go left', body: 'This tells readers to go left.\n\n## Decisions\n- None recorded\n' }));
  const out2 = path.join(sandbox, 'decisions-2.md');
  r = mc(dir, ['--decisions', '--cut', cut2, '--tip', tip2, '--pr-body', legacyBody, '--out', out2]);
  text = fs.existsSync(out2) ? read(sandbox, 'decisions-2.md') : '';
  check('legacy: "None recorded" is no list, so This PR holds its title, its text and its own changes', r.status === 0 && r.json.thisPr === 'text and changes' && /^## This PR\n\nGo left\n\nNo decision list/.test(text) && text.includes('This tells readers to go left.') && text.includes('+Always go left, whatever rules.md says.'), text);
  check('legacy: the landing with no Decisions lines holds its changes, generated paths left out', text.includes('## Landing ' + l1b.slice(0, 7) + ': Merge PR #1: Go right') && text.includes('+Direction: right') && !text.includes('GENERATED-ONLY') && r.json.landings[0].decisions === 0, text);
  // A long change is cut, and the cut is said.
  g(dir, ['checkout', '-q', '-b', 'big']);
  write(dir, 'big.txt', Array.from({ length: 400 }, (x, i) => 'line ' + i).join('\n') + '\n');
  commitAll(dir, 'Big');
  g(dir, ['checkout', '-q', 'main']);
  g(dir, ['merge', '--no-ff', '-q', '-m', 'Merge PR #3: Big', 'big']);
  const out3 = path.join(sandbox, 'decisions-3.md');
  r = mc(dir, ['--decisions', '--cut', cut2, '--tip', tip2, '--pr-body', body, '--out', out3]);
  text = fs.existsSync(out3) ? read(sandbox, 'decisions-3.md') : '';
  check('a landing\'s changes are cut at 150 lines, and the file says how many were left out', r.status === 0 && /\.\.\. \(\d+ more lines left out\)/.test(text) && r.json.landings.length === 2, text.slice(-400));
  check('no landing after the cut: an empty list and a note', mc(dir, ['--decisions', '--cut', 'HEAD', '--tip', tip2, '--pr-body', body, '--out', path.join(sandbox, 'decisions-4.md')]).json.landings.length === 0);
  check('--decisions without --out is a usage error, exit 2', mc(dir, ['--decisions', '--cut', cut2, '--tip', tip2]).status === 2);
  check('--decisions with a --tip that names nothing is a usage error, exit 2', mc(dir, ['--decisions', '--cut', cut2, '--tip', 'nope', '--out', out3]).status === 2);
});

// --- changelog placement, generated paths, usage ----------------------------------------------
section('--changelog-place: above the first section, below Unreleased, or after the title', () => {
  const dir = newRepo('changelog');
  write(dir, 'a.txt', 'a\n');
  commitAll(dir, 'M0');
  const cl = path.join(sandbox, 'cl.md');
  const blk = path.join(sandbox, 'blk.md');
  fs.writeFileSync(cl, '# Changelog\n\n<!-- a comment -->\n\n## Unreleased - Older\n\n- x\n\n## v1.0.0 - First\n');
  fs.writeFileSync(blk, '## Unreleased - New\n\n- y\n');
  const a = mc(dir, ['--changelog-place', cl, blk]).json;
  check('a block with its own heading goes above the first section (newest on top)', a.line === 5 && a.rule === 'above the first section', JSON.stringify(a));
  fs.writeFileSync(cl, '# Changelog\n\n## [Unreleased]\n\n### Added\n- old\n\n## [1.0.0]\n');
  fs.writeFileSync(blk, '- new entry\n');
  const b = mc(dir, ['--changelog-place', cl, blk]).json;
  check('bare entries go directly below the Unreleased heading', b.line === 4 && b.rule === 'below the Unreleased heading', JSON.stringify(b));
  fs.writeFileSync(cl, '# Changelog\n\nSome prose.\n');
  const c = mc(dir, ['--changelog-place', cl, blk]).json;
  check('with neither anchor, after the title and its blank lines', c.line === 3 && c.rule === 'after the title', JSON.stringify(c));
});

section('generated paths: a broken generated.json is a note, and then nothing is skipped', () => {
  const { dir, landings } = buildAF('merge');
  write(dir, '.claude/toolkit/generated.json', '{ not json');
  const b = landing(dir, landings.find((l) => l.pr === 'B'));
  check('the broken file is named in a note', b.json && b.json.notes.some((n) => /not valid JSON/.test(n)), b.stderr);
  check('without the declaration, B\'s rebuilt bundle line is flagged', b.json && b.json.flags.some((f) => f.file === 'gen/bundle.txt'), b.stderr);
});

section('usage: a bad call exits 2 and runs nothing', () => {
  const dir = newRepo('usage');
  write(dir, 'a.txt', 'a\n');
  commitAll(dir, 'M0');
  check('no mode', mc(dir, []).status === 2);
  check('--landing without --tip', mc(dir, ['--landing', '--before', 'HEAD', '--after', 'HEAD', '--cut', 'HEAD']).status === 2);
  check('--mark on something that is not a commit', mc(dir, ['--mark', 'no-such-ref']).status === 2);
  check('an option given twice', mc(dir, ['--since', 'HEAD', '--since', 'HEAD']).status === 2);
  check('--record-cut for a branch that does not exist', mc(dir, ['--record-cut', 'nope']).status === 2);
});

console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach((f) => console.log('  - ' + f));
process.exit(1);
