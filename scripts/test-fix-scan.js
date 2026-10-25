#!/usr/bin/env node
'use strict';
// test-fix-scan.js - assertions for scripts/fix-scan.js (issue #252, item 2):
// the maintainer scan that labels every FIXED line of a review's Digest by
// what the fix diff did to the lines its finding cited (hunk touched, file
// touched but hunk untouched, file untouched, file absent), and counts how
// many recheck rows sit beside their original in the receipts' results.json.
//
// Every case runs the script as a child process inside a throwaway git
// repository under the OS temp dir, so a missing script fails every case by
// name. Dependency-free; exits non-zero on any failure.
//
//   node scripts/test-fix-scan.js

const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, 'fix-scan.js');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failures.push(name + (detail ? ' - ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' - ' + String(detail).slice(0, 400) : '')); }
}
const one = (x) => String(x).replace(/\s+/g, ' ').slice(0, 400);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-scan-'));
process.on('exit', function () {
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});
const repo = path.join(sandbox, 'repo');
fs.mkdirSync(repo);
const ENV = Object.assign({}, process.env, {
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
});
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete ENV[k];
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
const lines = (n, tag) => Array.from({ length: n }, (_, i) => tag + ' line ' + (i + 1)).join('\n') + '\n';

// The reviewed tree (B): three files the findings cite.
git(['init', '-q']);
git(['symbolic-ref', 'HEAD', 'refs/heads/main']);
write('.gitignore', 'reports/\n');
write('r.md', lines(6, 'r'));
write('q.js', lines(12, 'q'));
write('s.sh', lines(4, 's'));
git(['add', '-A']);
git(['commit', '-qm', 'reviewed']);
const B = git(['rev-parse', 'HEAD']).trim();
// A snapshot commit (S) that holds one more file, as uncommitted.baseline would.
write('x.txt', 'only in the snapshot\n');
git(['add', 'x.txt']);
git(['commit', '-qm', 'snapshot']);
const S = git(['rev-parse', 'HEAD']).trim();
// The fixes (F): r.md line 2 rewritten, q.js changed only at line 10, s.sh untouched.
const r = fs.readFileSync(path.join(repo, 'r.md'), 'utf8').split('\n');
r[1] = 'r line 2 now says something else';
write('r.md', r.join('\n'));
const q = fs.readFileSync(path.join(repo, 'q.js'), 'utf8').split('\n');
q[9] = 'q line 10 changed elsewhere';
write('q.js', q.join('\n'));
git(['commit', '-qam', 'fixes']);
const F = git(['rev-parse', 'HEAD']).trim();

// The review report: findings with their cited loci, then the Digest.
const report = path.join(repo, 'reports', 'review-test.md');
write('reports/review-test.md', [
  '# Review', '', 'Receipts: `reports/receipts/stamp/`', '', '### Findings', '',
  '- **R1** [code] ⚠️ `r.md:2` - Should fix. Line two is wrong.',
  '- **R2** [code] ⚠️ `q.js:3` - Should fix. Line three is wrong.',
  '- **R3** [plan] ⚠️ `s.sh:1` - Should fix. The script is wrong.',
  '- **R4** [code] ⚠️ `gone.md:1` - Should fix. A file that never existed.',
  '- **R5** [code] ⚠️ `r.md:4` - Should fix. Still open.',
  '- **R6** [code] ⚠️ `r.md:5` - Should fix. Needs the owner.',
  '- **R7** [code] ⚠️ `x.txt:1` - Should fix. Only in the snapshot.',
  '', '## Digest', '',
  '- R1: FIXED - `grep -c else r.md` now 1',
  '- R2: FIXED - verifier: done',
  '- R3: FIXED (plan record) - a note in the plan',
  '- R4: FIXED - verifier: done',
  '- R5: NOT FIXED - two rounds tried',
  '- R6: PAGED - needs the owner',
  '- R7: FIXED - verifier: done', '',
].join('\n'));
const receipts = path.join(repo, 'reports', 'receipts', 'stamp');
const scope = (extra) => JSON.stringify(Object.assign({ range: { base: B, end: B }, uncommitted: { baseline: null, untracked: { files: [] } } }, extra || {}));
write('reports/receipts/stamp/scope.json', scope());
write('reports/receipts/stamp/results.json', JSON.stringify({ at: 'x', checks: [
  { id: 'code-1', verdict: 'pass' }, { id: 'code-1-recheck', verdict: 'pass' },
  { id: 'code-2-recheck-round2', verdict: 'pass' }, { id: 'recheck-of-ux', verdict: 'pass' },
] }));
write('reports/receipts/stamp/sub/results.json', JSON.stringify({ at: 'x', checks: [{ id: 'code-3', verdict: 'pass' }, { id: 'code-3-recheck', verdict: 'pass' }] }));

function scan(args) {
  const res = spawnSync(process.execPath, [SCRIPT].concat(args), { cwd: repo, encoding: 'utf8', env: ENV });
  let rows = null;
  try { rows = String(res.stdout).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)); } catch (e) { rows = null; }
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', rows };
}
const byId = (row) => Object.fromEntries(((row && row.fixed) || []).map((f) => [f.id, f]));

const live = scan([report, '--receipts', receipts, '--to', F, '--json']);
const L = byId(live.rows && live.rows[0]);
check('252 scan: a FIXED line whose cited hunk the fix changed is hunk touched', !!L.R1 && L.R1.hunk === 'hunk touched', one(live.stdout + live.stderr));
check('252 scan: a cited file the fix changed only elsewhere is file touched, hunk untouched', !!L.R2 && L.R2.hunk === 'file touched, hunk untouched', one(JSON.stringify(L.R2)));
check('252 scan: a cited file the fix never changed is file untouched', !!L.R3 && L.R3.hunk === 'file untouched', one(JSON.stringify(L.R3)));
check('252 scan: a cited file not in the reviewed tree is file absent', !!L.R4 && L.R4.hunk === 'file absent', one(JSON.stringify(L.R4)));
check('252 scan: each FIXED line also carries the line label', !!L.R1 && L.R1.line === 'rewritten' && !!L.R2 && L.R2.line === 'untouched' && L.R1.locus === 'r.md:2', one(JSON.stringify(L.R1)));
check('252 scan: NOT FIXED and PAGED lines are not labeled', !!live.rows && !L.R5 && !L.R6 && Object.keys(L).length === 5, one(JSON.stringify(Object.keys(L))));

// The base is uncommitted.baseline when the scope has one, else range.end.
write('reports/receipts/stamp/scope.json', scope({ uncommitted: { baseline: S, untracked: { files: [] } } }));
const snap = byId((scan([report, '--receipts', receipts, '--to', F, '--json']).rows || [])[0]);
write('reports/receipts/stamp/scope.json', scope({ uncommitted: { baseline: S, baselineError: 'could not snapshot', untracked: { files: [] } } }));
const erred = byId((scan([report, '--receipts', receipts, '--to', F, '--json']).rows || [])[0]);
write('reports/receipts/stamp/scope.json', scope());
check('252 scan: the base is the scope\'s uncommitted.baseline when set, else range.end',
  !!snap.R7 && snap.R7.hunk === 'file untouched' && !!L.R7 && L.R7.hunk === 'file absent' && !!erred.R7 && erred.R7.hunk === 'file absent',
  one(JSON.stringify([snap.R7, L.R7, erred.R7])));

// A scope whose base commit this repository does not have (a harness run's
// scratch project) is read as no base: the labels still come from the patch.
write('reports/receipts/stamp/scope.json', scope({ range: { base: 'f'.repeat(40), end: 'f'.repeat(40) } }));
const foreignPatch = path.join(sandbox, 'foreign.diff');
fs.writeFileSync(foreignPatch, git(['diff', B, F]));
const foreign = (scan([report, '--receipts', receipts, '--diff', foreignPatch, '--json']).rows || [])[0] || {};
const FB = byId(foreign);
write('reports/receipts/stamp/scope.json', scope());
check('252 scan: a scope base this repository does not have is dropped with a note, and the patch still labels',
  foreign.base === null && /not in this repository/.test(String(foreign.baseNote)) && !!FB.R2 && FB.R2.hunk === 'file touched, hunk untouched' && !!FB.R1 && FB.R1.hunk === 'hunk touched',
  one(JSON.stringify(foreign)));

// A saved patch gives the same labels, and so does the newest verify-r<n>-diff.patch.
const patchFile = path.join(sandbox, 'fixes.diff');
fs.writeFileSync(patchFile, git(['diff', B, F]));
const saved = byId((scan([report, '--receipts', receipts, '--diff', patchFile, '--json']).rows || [])[0]);
write('reports/receipts/stamp/verify-r1-diff.patch', 'diff --git a/s.sh b/s.sh\n--- a/s.sh\n+++ b/s.sh\n@@ -1 +1 @@\n-s line 1\n+s line 1 rewritten\n');
write('reports/receipts/stamp/verify-r2-diff.patch', git(['diff', B, F]));
const verify = scan([report, '--receipts', receipts, '--json']);
const V = byId((verify.rows || [])[0]);
fs.rmSync(path.join(receipts, 'verify-r1-diff.patch'));
fs.rmSync(path.join(receipts, 'verify-r2-diff.patch'));
const none = scan([report, '--receipts', receipts, '--json']);
const N = (none.rows || [])[0] || {};
check('252 scan: the diff comes from --diff, else the newest verify-r<n>-diff.patch in the receipts folder, else --to, else the report is skipped with its reason',
  !!saved.R1 && saved.R1.hunk === 'hunk touched' && !!saved.R2 && saved.R2.hunk === 'file touched, hunk untouched' && !!saved.R3 && saved.R3.hunk === 'file untouched'
    && !!V.R3 && V.R3.hunk === 'file untouched' && !!V.R1 && V.R1.hunk === 'hunk touched'
    && typeof N.skipped === 'string' && /no fix diff/.test(N.skipped) && Array.isArray(N.fixed) && N.fixed.length === 0,
  one(JSON.stringify([saved.R1, V.R3, N.skipped])));
// With --to, the skip names the real cause (review R10): a failed diff, or a
// scope base this repository does not have, is not a missing scope.json.
const badTo = (scan([report, '--receipts', receipts, '--to', 'no-such-ref', '--json']).rows || [])[0] || {};
write('reports/receipts/stamp/scope.json', scope({ range: { base: 'f'.repeat(40), end: 'f'.repeat(40) } }));
const foreignTo = (scan([report, '--receipts', receipts, '--to', F, '--json']).rows || [])[0] || {};
write('reports/receipts/stamp/scope.json', scope());
check('252 scan: with --to, a failed diff or a base not in this repository is named as the skip reason, not a missing scope.json',
  /git diff .* no-such-ref failed/.test(String(badTo.skipped)) && /not in this repository/.test(String(foreignTo.skipped))
    && !/no scope\.json/.test(String(badTo.skipped) + String(foreignTo.skipped)),
  one(JSON.stringify([badTo.skipped, foreignTo.skipped])));
// Several --diff files (a review fixed in rounds): a line touched by any of them is touched.
const roundA = path.join(sandbox, 'round1.diff');
const roundB = path.join(sandbox, 'round2.diff');
fs.writeFileSync(roundA, 'diff --git a/s.sh b/s.sh\n--- a/s.sh\n+++ b/s.sh\n@@ -1 +1 @@\n-s line 1\n+s line 1 rewritten\n');
fs.writeFileSync(roundB, git(['diff', B, F]));
const rounds = byId((scan([report, '--receipts', receipts, '--diff', roundA, '--diff', roundB, '--json']).rows || [])[0]);
check('252 scan: with several --diff files a cited line touched by any of them is hunk touched', !!rounds.R3 && rounds.R3.hunk === 'hunk touched' && !!rounds.R1 && rounds.R1.hunk === 'hunk touched', one(JSON.stringify([rounds.R3, rounds.R1])));

// A change within 3 lines of the cited line is the cited hunk (git's default
// context); one further away is not. A cited file git ignores cannot be judged.
const near = path.join(repo, 'reports', 'review-near.md');
write('reports/review-near.md', ['# Near', '', '### Findings', '',
  '- **R1** [code] ⚠️ `q.js:8` - Should fix. Two lines above the change at 10.',
  '- **R2** [code] ⚠️ `q.js:3` - Should fix. Seven lines above it.',
  '- **R3** [plan] ⚠️ `reports/plan-note.md:1` - Should fix. In a gitignored file.',
  '', '## Digest', '', '- R1: FIXED - done', '- R2: FIXED - done', '- R3: FIXED (plan record) - done', ''].join('\n'));
write('reports/plan-note.md', 'a note\n');
const N2 = byId((scan([near, '--receipts', receipts, '--to', F, '--json']).rows || [])[0]);
check('252 scan: a change within 3 lines of the cited line is hunk touched, one further away is not, and a gitignored cited file is unknown',
  !!N2.R1 && N2.R1.hunk === 'hunk touched' && N2.R1.line === 'untouched' && !!N2.R2 && N2.R2.hunk === 'file touched, hunk untouched' && !!N2.R3 && N2.R3.hunk === 'unknown',
  one(JSON.stringify(N2)));

// Recheck pairing over the receipts folder's results.json files.
const rc = (live.rows && live.rows[0] && live.rows[0].rechecks) || {};
check('252 scan: a <lens>-<n>-recheck row is paired when its <lens>-<n> row is in the same results.json, and paired, unpaired and unpairable are counted',
  rc.paired === 1 && rc.unpaired === 1 && rc.unpairable === 2, one(JSON.stringify(rc)));

// The receipts folder is found from the report's own text when --receipts is not given.
const inferred = scan([report, '--to', F, '--json']);
check('252 scan: without --receipts the folder the report names is used', !!inferred.rows && !!inferred.rows[0] && /reports\/receipts\/stamp$/.test(String(inferred.rows[0].receipts)) && byId(inferred.rows[0]).R2 && byId(inferred.rows[0]).R2.hunk === 'file touched, hunk untouched', one(inferred.stdout + inferred.stderr));

// --json prints one object per report; without it, one readable line per FIXED.
const second = path.join(repo, 'reports', 'review-other.md');
write('reports/review-other.md', '# Other\n\n- **R1** [code] ⚠️ `s.sh:2` - Should fix. x.\n\n## Digest\n\n- R1: FIXED - done\n');
const both = scan([report, second, '--receipts', receipts, '--to', F, '--json']);
const text = scan([report, '--receipts', receipts, '--to', F]);
check('252 scan: --json prints one object per report, and the plain form one line per FIXED',
  both.status === 0 && !!both.rows && both.rows.length === 2 && /review-other\.md$/.test(both.rows[1].report)
    && text.status === 0 && /R1 FIXED r\.md:2 -> hunk touched \(rewritten\)/.test(text.stdout) && /rechecks: 1 paired, 1 unpaired, 2 unpairable/.test(text.stdout),
  one(both.stdout + ' | ' + text.stdout + text.stderr));
check('252 scan: a missing report file is a usage error with nothing on stdout', (() => { const m = scan([path.join(repo, 'nope.md'), '--json']); return m.status === 1 && m.stdout === '' && /nope\.md/.test(m.stderr); })());

console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach((f) => console.log('  - ' + f));
process.exit(1);
