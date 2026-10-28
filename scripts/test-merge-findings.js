#!/usr/bin/env node
'use strict';
// test-merge-findings.js - assertions for .claude/scripts/merge-findings.js
// (issue #211): the merge, sort and number pass every review runner used to
// do by hand. The helper reads one JSONL file of findings, merges the lines
// that share a dedup key, sorts by severity, numbers the result R1 onward
// with no gaps, and prints JSONL. It also owns stableFindingKey, the dedup
// key rule render-html.js requires from it, so the rule exists once.
// Every case runs in a throwaway folder under the OS temp dir.
// Dependency-free; exits non-zero on any failure.
//
//   node scripts/test-merge-findings.js

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '..', '.claude', 'scripts', 'merge-findings.js');
const RENDER = path.resolve(__dirname, '..', '.claude', 'scripts', 'render-html.js');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failures.push(name + (detail ? ' - ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' - ' + String(detail).slice(0, 300) : '')); }
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-findings-'));
let counter = 0;
// Write the given lines as one JSONL file and return its path.
function jsonl(lines) {
  const file = path.join(sandbox, 'findings-' + (++counter) + '.jsonl');
  fs.writeFileSync(file, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return file;
}
// Run the helper. `rows` is the parsed stdout, one object per line, or null
// when any line fails to parse.
function run(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: sandbox, encoding: 'utf8' });
  let rows = null;
  try { rows = r.stdout.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l)); } catch (e) { rows = null; }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, rows };
}

// Fixtures in the dispatch format: a code finding and a browser finding on
// one defect (same key, different severities), a UX suggestion, a seeded plan
// item, and a copy finding with no key of its own.
const CODE = {
  severity: 'warn', specialist: 'code',
  file: { relPath: 'auth/login.ts', absPath: '/abs/auth/login.ts', line: 42 },
  what: 'Should fix. Failed logins leak a live session token into the console log.',
  fix: 'One line: log that the attempt failed, never the payload. Ten minutes, or leave the tokens in logs.',
  key: 'auth/login.ts:failed-logins-leak-a-live-session-token',
  receipt: { check: "grep -n 'logger' auth/login.ts", expect: 'the failed-login path logs the token variable at line 42' },
};
const BROWSER = {
  severity: 'block', specialist: 'browser',
  file: { relPath: 'auth/login.ts', absPath: '/abs/auth/login.ts', line: 40 },
  what: 'Blocks. Failed logins leak a live session token into the console log.',
  context: 'Anyone reading the support log can reuse the token while it is valid.',
  fix: 'Log the failure only. Ten minutes, or leave the token in the log.',
  fields: [
    { label: 'Expected', value: 'no token in the console' },
    { label: 'Actual', value: 'the token is printed' },
    { label: 'Screenshot', value: '<img src="shot.png">' },
    { label: 'Evidence', value: '<pre>console: token=abc</pre>' },
  ],
  key: 'auth/login.ts:failed-logins-leak-a-live-session-token',
  receipt: { check: 'node .claude/scripts/browse.js --actions \'[{"goto":"/login"}]\'', expect: 'the console output shows the token' },
};
const UX = {
  severity: 'suggest', specialist: 'ux',
  file: { relPath: 'ui/form.tsx', absPath: '/abs/ui/form.tsx', line: 10 },
  what: 'Optional. The submit button has no visible focus ring, so keyboard users lose their place.',
  fix: 'One CSS rule. Five minutes, or leave keyboard users guessing.',
  key: 'ui/form.tsx:the-submit-button-has-no-visible-focus',
  receipt: { check: "grep -n 'focus' ui/form.css", expect: 'no focus rule for the submit button' },
};
const PLAN = {
  severity: 'warn', specialist: 'plan-critic',
  file: { relPath: 'plans/PLAN-x.md' },
  what: 'Should fix. Step 3 names no checkable result, so the review cannot tell done from started.',
  fix: 'Name the result in one line. Two minutes, or review it by guesswork.',
  fields: [{ label: 'Source', value: '- [plan] Step: Step 3 names no checkable result' }],
  key: 'plans/PLAN-x.md:step-3-names-no-checkable-result',
  receipt: { check: "grep -n 'Step 3' plans/PLAN-x.md", expect: 'the step line carries no result' },
};
const NOKEY = {
  severity: 'warn', specialist: 'copy',
  file: { relPath: 'docs/guide.md', absPath: '/abs/docs/guide.md', line: 3 },
  what: 'Should fix. The <b>intro</b> never says who the guide is for, so new readers bounce.',
  fix: 'One sentence naming the reader. Two minutes, or keep losing them.',
  receipt: { check: 'sed -n 1,5p docs/guide.md', expect: 'no sentence names the reader' },
};

// --- 1. merge by key -----------------------------------------------------------
console.log('\n1. findings sharing a key merge into one');
{
  const r = run([jsonl([CODE, BROWSER, UX])]);
  const rows = r.rows || [];
  check('exits 0 with one JSON object per line', r.status === 0 && r.rows !== null && rows.length === 2, r.stdout + r.stderr);
  const merged = rows[0] || {};
  check('the merged finding comes first as R1, at the higher severity', merged.id === 'R1' && merged.severity === 'block', JSON.stringify(merged).slice(0, 200));
  check('its specialists are joined as one string in first-seen order', merged.specialist === 'code, browser', merged.specialist);
  check('its prose and file come from the primary, the higher-severity source', merged.what === BROWSER.what && merged.context === BROWSER.context && merged.fix === BROWSER.fix && merged.file && merged.file.line === 40, JSON.stringify(merged.file));
  check('the browser evidence rows are kept, in order', JSON.stringify(merged.fields) === JSON.stringify(BROWSER.fields), JSON.stringify(merged.fields));
  check('receipt is the primary\'s and receipts carries every source receipt in input order', JSON.stringify(merged.receipt) === JSON.stringify(BROWSER.receipt) && JSON.stringify(merged.receipts) === JSON.stringify([CODE.receipt, BROWSER.receipt]), JSON.stringify(merged.receipts));
  check('sources carries the original lines, in input order', JSON.stringify(merged.sources) === JSON.stringify([CODE, BROWSER]), JSON.stringify(merged.sources).slice(0, 200));
  check('the key is kept', merged.key === CODE.key, merged.key);
  const ux = rows[1] || {};
  check('the unmerged finding follows as R2 with a one-element receipts and sources', ux.id === 'R2' && ux.specialist === 'ux' && JSON.stringify(ux.receipts) === JSON.stringify([UX.receipt]) && JSON.stringify(ux.sources) === JSON.stringify([UX]), JSON.stringify(ux).slice(0, 200));
  check('stderr counts raw, merged, merges and severities on one line', /^merge-findings: 3 raw, 2 merged \(1 merge\), 1 block \/ 0 warn \/ 1 suggest, 0 non-finding line\(s\) skipped$/m.test(r.stderr), r.stderr);
}

// --- 2. sort and number ----------------------------------------------------------
console.log('\n2. sorted by severity, stable within one, numbered without gaps');
{
  const r = run([jsonl([UX, PLAN, CODE])]);
  const rows = r.rows || [];
  check('warns come before the suggest, in input order among themselves', rows.length === 3 && rows[0].key === PLAN.key && rows[1].key === CODE.key && rows[2].key === UX.key, rows.map((x) => x.key).join(' | '));
  check('ids run R1, R2, R3', rows.map((x) => x.id).join(',') === 'R1,R2,R3', rows.map((x) => x.id).join(','));
  check('fields are unioned by label when sources merge, and absent fields stay absent', rows[1].fields === undefined && JSON.stringify(rows[0].fields) === JSON.stringify(PLAN.fields), JSON.stringify(rows[1]));
}
{
  // A later source adds a field label the primary lacks: it is appended after
  // the primary's rows, and a label the primary already has is not repeated.
  const codeWithField = Object.assign({}, CODE, { fields: [{ label: 'Evidence', value: '<pre>from code</pre>' }, { label: 'Note', value: 'from code' }] });
  const r = run([jsonl([BROWSER, codeWithField])]);
  const merged = (r.rows || [])[0] || {};
  check('a merge appends only the labels the primary lacks', JSON.stringify((merged.fields || []).map((f) => f.label)) === JSON.stringify(['Expected', 'Actual', 'Screenshot', 'Evidence', 'Note']) && merged.fields[3].value === BROWSER.fields[3].value, JSON.stringify(merged.fields));
  check('first-seen order holds when the primary is first', merged.specialist === 'browser, code', merged.specialist);
}

// --- 3. non-finding lines --------------------------------------------------------
console.log('\n3. NO FINDINGS and NOT CHECKED lines are skipped and counted');
{
  const r = run([jsonl(['NO FINDINGS', CODE, 'NOT CHECKED: the dev server did not answer on port 3000.', '', '   '])]);
  const rows = r.rows || [];
  check('only the finding comes out', r.status === 0 && rows.length === 1 && rows[0].id === 'R1', r.stdout + r.stderr);
  check('the two non-finding lines are counted, blanks are not', /2 non-finding line\(s\) skipped/.test(r.stderr), r.stderr);
}
{
  const r = run([jsonl([])]);
  check('an empty file prints nothing and exits 0', r.status === 0 && r.stdout === '' && /^merge-findings: 0 raw, 0 merged/m.test(r.stderr), r.stdout + r.stderr);
}
{
  // A file saved with a byte order mark and CRLF endings still parses.
  const file = path.join(sandbox, 'bom.jsonl');
  fs.writeFileSync(file, '﻿' + JSON.stringify(CODE) + '\r\n' + JSON.stringify(UX) + '\r\n');
  const r = run([file]);
  check('a byte order mark and CRLF line endings are accepted', r.status === 0 && (r.rows || []).length === 2 && r.rows[0].id === 'R1' && r.rows[1].id === 'R2', r.stdout + r.stderr);
}

// --- 4. bad input ----------------------------------------------------------------
console.log('\n4. bad input is refused with nothing on stdout');
{
  const r = run([jsonl([CODE, '{"severity":"warn", not json'])]);
  let err = null;
  try { err = JSON.parse(r.stderr.trim().split('\n').pop()); } catch (e) { err = null; }
  check('a line that is not JSON exits 1 with a bad_line error naming the line, and no stdout', r.status === 1 && r.stdout === '' && err !== null && err.error === 'bad_line' && err.line === 2, r.stdout + ' ' + r.stderr);
}
{
  const r = run([jsonl(['[1,2,3]'])]);
  check('a JSON line that is not an object is a bad line too', r.status === 1 && r.stdout === '' && /bad_line/.test(r.stderr), r.stdout + ' ' + r.stderr);
}
{
  const r = run([jsonl([Object.assign({}, CODE, { severity: 'critical' })])]);
  check('an unknown severity is a bad line', r.status === 1 && r.stdout === '' && /bad_line/.test(r.stderr) && /severity/.test(r.stderr), r.stdout + ' ' + r.stderr);
}
{
  const none = run([]);
  const missing = run([path.join(sandbox, 'absent.jsonl')]);
  const extra = run([jsonl([CODE]), '--force']);
  check('no argument, a missing file and an extra argument each exit 1 with an error line and no stdout', none.status === 1 && none.stdout === '' && missing.status === 1 && missing.stdout === '' && extra.status === 1 && extra.stdout === '' && /usage/.test(none.stderr) && /not_found|usage/.test(missing.stderr), none.stderr + missing.stderr + extra.stderr);
}
{
  // Issue #217: the merge sentence names the folder right before the script
  // call, so a runner may hand over the folder. A directory argument reads the
  // findings.jsonl inside it; an empty folder is reported as that missing file.
  const dir = path.join(sandbox, 'folder-' + (++counter));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'findings.jsonl'), JSON.stringify(CODE) + '\n');
  const viaFile = run([path.join(dir, 'findings.jsonl')]);
  const viaDir = run([dir]);
  check('a folder that holds findings.jsonl gives the same stdout and counts as the file', viaDir.status === 0 && viaFile.rows !== null && viaFile.rows.length === 1 && viaDir.stdout === viaFile.stdout && viaDir.stderr === viaFile.stderr, viaDir.status + ' ' + viaDir.stdout + ' ' + viaDir.stderr);
  const empty = path.join(sandbox, 'folder-' + (++counter));
  fs.mkdirSync(empty, { recursive: true });
  const bare = run([empty]);
  check('an empty folder exits 1 with no stdout and a not_found line naming findings.jsonl', bare.status === 1 && bare.stdout === '' && /not_found/.test(bare.stderr) && /findings\.jsonl/.test(bare.stderr), bare.status + ' ' + bare.stdout + ' ' + bare.stderr);
}

// --- 5. the dedup key rule, once -------------------------------------------------
console.log('\n5. a missing key is derived by the one shared rule');
{
  const mod = require(SCRIPT);
  check('the helper exports stableFindingKey', typeof mod.stableFindingKey === 'function');
  const k = mod.stableFindingKey;
  check('the severity lead and HTML tags are stripped and the first eight words are kept', k(NOKEY) === 'docs/guide.md:the-intro-never-says-who-the-guide-is', k(NOKEY));
  check('a Blocks. lead with punctuation inside the claim', k({ file: { relPath: 'a/b.js' }, what: 'Blocks. Users\' data is sent over plain HTTP, to a logging host.' }) === 'a/b.js:users-data-is-sent-over-plain-http-to', k({ file: { relPath: 'a/b.js' }, what: 'Blocks. Users\' data is sent over plain HTTP, to a logging host.' }));
  check('a finding with no file keys on its claim alone', k({ what: 'Optional. Two short words.' }) === ':two-short-words', k({ what: 'Optional. Two short words.' }));
  check('a key the finding already carries wins', k({ key: 'x:y', what: 'Should fix. Anything.' }) === 'x:y');
  const r = run([jsonl([NOKEY])]);
  check('the helper writes the derived key onto a finding that had none', r.status === 0 && (r.rows || [])[0] && r.rows[0].key === 'docs/guide.md:the-intro-never-says-who-the-guide-is', r.stdout + r.stderr);
  const src = fs.readFileSync(RENDER, 'utf8');
  check('render-html.js requires the rule from the helper and no longer defines it', /require\(['"]\.\/merge-findings\.js['"]\)/.test(src) && !/function stableFindingKey\(/.test(src), 'defines: ' + /function stableFindingKey\(/.test(src));
  check('requiring the helper as a module runs no command-line body', r.status === 0 && mod.stableFindingKey && typeof mod.main === 'function');
}

// --- 6. the finding contract's countable rules -----------------------------------
console.log('\n6. a finding that breaks a countable contract rule warns on stderr, and nothing else changes');
{
  const mod = require(SCRIPT);
  // n words, with an optional two-word lead ("Should fix.") in front.
  const words = (n, lead) => (lead ? lead + ' ' : '') + Array.from({ length: n }, (_, i) => 'w' + (i + 1)).join(' ') + '.';
  // Each line carries a key of its own so the findings never merge.
  const longWhat = Object.assign({}, CODE, { key: 'a:long-what', what: words(23, 'Should fix.') });   // 25 words
  const longContext = Object.assign({}, CODE, { key: 'a:long-context', context: words(30) });          // 30 words; with the 13-word what, 43 of open prose
  const longFix = Object.assign({}, CODE, { key: 'a:long-fix', fix: words(25) });                      // 25 words
  const hedged = Object.assign({}, CODE, { key: 'a:hedge', what: 'Should fix. It appears the login form leaks the token into the log.' });
  const noLead = Object.assign({}, CODE, { key: 'a:no-lead', what: 'The login form leaks the token into the log.' });
  const warnLines = (r) => r.stderr.split('\n').filter((l) => /^merge-findings: line \d+ \(/.test(l));

  const caps = run([jsonl([longWhat, longContext, longFix])]);
  const capWarnings = warnLines(caps);
  check('a finding over a cap warns once, naming its line, its key and the count over the cap',
    caps.status === 0 && capWarnings.length === 3
      && capWarnings[0] === 'merge-findings: line 1 (a:long-what): what 25/18 words'
      && capWarnings[1] === 'merge-findings: line 2 (a:long-context): context 30/22 words; open prose 43/40 words'
      && capWarnings[2] === 'merge-findings: line 3 (a:long-fix): fix 25/20 words',
    caps.stderr);
  const hedge = run([jsonl([hedged])]);
  check('a banned hedge warns, quoting the hedge', hedge.status === 0 && /^merge-findings: line 1 \(a:hedge\): hedge "it appears"$/m.test(hedge.stderr), hedge.stderr);
  const lead = run([jsonl([noLead])]);
  check('a what that does not open with a severity phrase warns', lead.status === 0 && /^merge-findings: line 1 \(a:no-lead\): what opens without Blocks\. \/ Should fix\. \/ Optional\.$/m.test(lead.stderr), lead.stderr);
  const clean = run([jsonl([CODE, BROWSER, UX, PLAN, NOKEY])]);
  check('clean findings produce no warning line, only the summary', clean.status === 0 && warnLines(clean).length === 0 && /^merge-findings: 5 raw/m.test(clean.stderr), clean.stderr);

  // stdout is the merge and nothing else: byte for byte what the module's own
  // merge of the same lines prints, no warning text in it, exit code 0; and a
  // clean finding's row is the same with a warning finding beside it as alone.
  const mixedFile = jsonl([CODE, longWhat, hedged, noLead]);
  const mixed = run([mixedFile]);
  const expected = mod.mergeFindings(mod.parseLines(fs.readFileSync(mixedFile, 'utf8')).findings).map((m) => JSON.stringify(m)).join('\n') + '\n';
  check('with warnings, stdout is byte for byte the merge output and the exit code is 0',
    mixed.status === 0 && mixed.stdout === expected && warnLines(mixed).length === 3, JSON.stringify(mixed.stdout).slice(0, 200) + ' ' + mixed.stderr);
  const alone = run([jsonl([CODE])]);
  check('a clean finding\'s row is identical with and without a warning finding beside it',
    alone.stdout.split('\n')[0] === mixed.stdout.split('\n')[0] && warnLines(alone).length === 0, alone.stdout.split('\n')[0] + ' vs ' + mixed.stdout.split('\n')[0]);
  check('parseLines reports each finding\'s line number beside it, skipping the non-finding lines',
    JSON.stringify(mod.parseLines('NO FINDINGS\n' + JSON.stringify(CODE) + '\n\n' + JSON.stringify(UX) + '\n').lines) === '[2,4]',
    JSON.stringify(mod.parseLines('NO FINDINGS\n' + JSON.stringify(CODE) + '\n\n' + JSON.stringify(UX) + '\n').lines));
  check('the warning helper is exported and returns null for a clean finding',
    typeof mod.contractWarning === 'function' && mod.contractWarning(CODE, 1) === null, String(mod.contractWarning && mod.contractWarning(CODE, 1)));
}

console.log('\n7. the citation check warns on a file or line that cannot be right, and stdout never changes');
{
  // A small git repository: a.md has 3 lines, gone.md is committed then
  // deleted, later.md is added after the first commit.
  const repo = path.join(sandbox, 'repo');
  fs.mkdirSync(repo);
  const g = (args) => spawnSync('git', ['-C', repo, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false'].concat(args), { encoding: 'utf8' });
  g(['init', '-q']);
  fs.writeFileSync(path.join(repo, 'a.md'), 'one\ntwo\nthree\n');
  fs.writeFileSync(path.join(repo, 'gone.md'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'first']);
  const first = g(['rev-parse', 'HEAD']).stdout.trim();
  fs.rmSync(path.join(repo, 'gone.md'));
  fs.writeFileSync(path.join(repo, 'later.md'), 'l1\nl2\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'second']);
  const cite = (rel, line, extra) => Object.assign({ severity: 'warn', specialist: 'code', file: { relPath: rel, line }, what: 'Should fix. Cited ' + rel + ' line ' + line + ' breaks something real here.', key: rel + ':' + line }, extra || {});
  const runIn = (args) => {
    const r = spawnSync(process.execPath, [SCRIPT].concat(args), { cwd: repo, encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const citeLines = (r) => r.stderr.split('\n').filter((l) => /^merge-findings: citation R\d+ \(/.test(l));
  const mod = require(SCRIPT);

  const good = runIn([jsonl([cite('a.md', 3)])]);
  check('a citation inside the file gives no citation line', good.status === 0 && citeLines(good).length === 0, good.stderr);
  const past = runIn([jsonl([cite('a.md', 18)])]);
  check('a line past the end warns with the file\'s line count', past.status === 0 && /^merge-findings: citation R1 \(a\.md:18\): line-out-of-range: line 18 is past the end of a\.md \(3 lines\)$/m.test(past.stderr), past.stderr);
  const range = runIn([jsonl([cite('a.md', '2-9')])]);
  check('a line range is checked by its last line', /line-out-of-range: line 9 is past the end of a\.md/.test(range.stderr), range.stderr);
  const missing = runIn([jsonl([cite('execute.md', 79)])]);
  check('a path git never had is missing-file', /citation R1 \(execute\.md:79\): missing-file: execute\.md does not exist$/m.test(missing.stderr), missing.stderr);
  const deleted = runIn([jsonl([cite('gone.md', 1)])]);
  check('a path deleted from the working copy but in git history is deleted-file', /citation R1 \(gone\.md:1\): deleted-file: gone\.md is not in the working copy, though git history has it$/m.test(deleted.stderr), deleted.stderr);
  const inRange = runIn([jsonl([cite('gone.md', 1)]), '--base', first]);
  check('with --base, a path present at the base and gone now is deleted-in-range', /citation R1 \(gone\.md:1\): deleted-in-range: gone\.md existed at /m.test(inRange.stderr), inRange.stderr);
  const atRev = runIn([jsonl([cite('later.md', 1), cite('a.md', 2)]), '--rev', first]);
  check('with --rev, a file added after that commit does not exist there, and a good citation stays quiet',
    /citation R\d \(later\.md:1\): missing-file: later\.md does not exist at /m.test(atRev.stderr) && citeLines(atRev).length === 1, atRev.stderr);
  const outside = runIn([jsonl([cite('../etc/passwd', 1)])]);
  check('a path that climbs out of the root is outside-project and is never read', /citation R1 \(\.\.\/etc\/passwd:1\): outside-project: /m.test(outside.stderr), outside.stderr);
  const noFile = runIn([jsonl([{ severity: 'suggest', specialist: 'copy', what: 'Optional. The intro never says who the guide is for, so readers stall early.', key: 'x' }])]);
  check('a finding with no file slot is never checked', noFile.status === 0 && citeLines(noFile).length === 0, noFile.stderr);
  const both = [cite('a.md', 18), cite('a.md', 2, { key: 'b' })];
  const withWarn = runIn([jsonl(both)]);
  const expected = mod.mergeFindings(both).map((m) => JSON.stringify(m)).join('\n') + '\n';
  check('with a citation warning, stdout is byte for byte the merge output and the exit code is 0', withWarn.status === 0 && withWarn.stdout === expected && citeLines(withWarn).length === 1, withWarn.stderr);
  const rootFlag = run([jsonl([cite('a.md', 18)]), '--root', repo]);
  check('--root points the check at another folder', /line-out-of-range: line 18 is past the end of a\.md/.test(rootFlag.stderr), rootFlag.stderr);
  const badFlag = run([jsonl([cite('a.md', 1)]), '--nope']);
  const noValue = run([jsonl([cite('a.md', 1)]), '--rev']);
  check('an unknown flag or a flag with no value exits 1 with the usage line and no stdout',
    badFlag.status === 1 && badFlag.stdout === '' && /usage/.test(badFlag.stderr) && noValue.status === 1 && noValue.stdout === '' && /usage/.test(noValue.stderr), badFlag.stderr + noValue.stderr);
  check('citationCheck is exported and returns null for a good citation', typeof mod.citationCheck === 'function' && mod.citationCheck({ relPath: 'a.md', line: 1 }, { root: repo }) === null);
}

// --- 8. --shards: the skeptics' bytes, written by the script ---------------------
// Harness research, P5-C1: a runner once wrote its own shards, paraphrased every
// finding, left out every receipt output and asked for KEEP or KILL. The shard
// writer copies the finder's line and the saved receipt output byte for byte,
// under M2's own instruction, so there is nothing left for a runner to retype.
console.log('\n8. --shards writes each tier 2 shard and the tier 3 ballot from the bytes on disk');
{
  const HITL = fs.readFileSync(path.resolve(__dirname, '..', '.claude', 'skills', 'shared', 'hitl-loop.md'), 'utf8');
  const SKEPTIC = fs.readFileSync(path.resolve(__dirname, '..', '.claude', 'agents', 'audit-skeptic.md'), 'utf8');
  const extra = [];
  for (let i = 2; i <= 7; i++) {
    extra.push({ severity: 'warn', specialist: 'code', file: { relPath: 'src/m' + i + '.js', line: i },
      what: 'Should fix. Module ' + i + ' swallows its own error and returns an empty list.', fix: 'Rethrow. Five minutes, or keep hiding it.',
      key: 'src/m' + i + '.js:swallows-error', receipt: { check: 'grep -n catch src/m' + i + '.js', expect: { match: 'catch' } } });
  }
  const NOSPEC = { severity: 'suggest', file: { relPath: 'x.md', line: 1 }, what: 'Optional. A heading repeats its parent.', fix: 'Drop it. One minute, or keep the echo.',
    key: 'x.md:heading-repeats', receipt: { check: 'sed -n 1p x.md', expect: 'the heading repeats' } };
  // Merged: R1 the Block (browser + code), R2 to R9 the Warns, R10 and R11 the Suggests.
  const rows = [BROWSER, CODE, UX, PLAN, NOKEY].concat(extra).concat([NOSPEC]);
  const file = jsonl(rows);
  const rawLines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const receipts = path.join(sandbox, 'receipts-8');
  fs.mkdirSync(receipts);
  const stems = ['browser-1', 'code-1', 'ux-1', 'plan-critic-1', 'copy-1', 'code-2', 'code-3', 'code-4', 'code-5', 'code-6', 'code-7', 'inline-1'];
  for (const s of stems) fs.writeFileSync(path.join(receipts, s + '.txt'), 'saved output of ' + s + ' é\t[x]\nexit 0\n');
  const out = path.join(sandbox, 'shards-8');
  fs.mkdirSync(out);
  const r = run(['--shards', file, '--receipts', receipts, '--out', out]);
  let man = null;
  try { man = JSON.parse(r.stdout); } catch (e) { man = null; }
  check('--shards exits 0 and prints one JSON manifest', r.status === 0 && man !== null, r.stderr + r.stdout.slice(0, 200));
  man = man || {};
  const shards = man.shards || [];
  check('10 Warns and Suggests make two tier 2 shards of at most 7, in R order',
    shards.length === 2 && shards[0].ids.join() === 'R2,R3,R4,R5,R6,R7,R8' && shards[1].ids.join() === 'R9,R10,R11', JSON.stringify(shards.map((s) => s.ids)));
  check('the Block goes to one tier 3 ballot for three voters', man.tier3 && man.tier3.ids.join() === 'R1' && man.tier3.voters === 3, JSON.stringify(man.tier3));
  const s1 = shards[0] ? fs.readFileSync(shards[0].file, 'utf8') : '';
  const s2 = shards[1] ? fs.readFileSync(shards[1].file, 'utf8') : '';
  const t3 = man.tier3 ? fs.readFileSync(man.tier3.file, 'utf8') : '';
  check('a shard opens with the header line --verdicts reads', s1.split('\n')[0] === 'M2 audit shard: tier 2, shard 1 of 2, ids R2 R3 R4 R5 R6 R7 R8', s1.split('\n')[0]);
  check('the tier 3 ballot opens with its header line', t3.split('\n')[0] === 'M2 audit shard: tier 3, the ballot for all three voters, ids R1', t3.split('\n')[0]);
  const quoted = (text) => { const m = text.match(/^"(Try to refute[^\n]*)"$/m); return m ? m[1] : null; };
  check('the tier 2 instruction is M2\'s, word for word, as the skeptic agent quotes it',
    quoted(s1) !== null && HITL.includes(quoted(s1)) && SKEPTIC.includes(quoted(s1)) && /RN: STANDS. - plus one line/.test(quoted(s1)) && !/DOWNGRADE/.test(quoted(s1)), String(quoted(s1)).slice(0, 120));
  check('the tier 3 instruction is M2\'s, word for word, with DOWNGRADE', quoted(t3) !== null && HITL.includes(quoted(t3)) && SKEPTIC.includes(quoted(t3)) && /DOWNGRADE Suggest/.test(quoted(t3)), String(quoted(t3)).slice(0, 120));
  check('every finding in a shard is its finder\'s line, byte for byte', [3, 4, 5, 6, 7, 8, 9].every((i) => s1.includes('\n' + rawLines[i] + '\n')),
    'missing: ' + [3, 4, 5, 6, 7, 8, 9].filter((i) => !s1.includes(rawLines[i])).join());
  check('every receipt output in a shard is the saved file, byte for byte', ['plan-critic-1', 'copy-1', 'code-2', 'code-6'].every((s) => s1.includes(fs.readFileSync(path.join(receipts, s + '.txt'), 'utf8'))));
  check('a merged Block carries both finders\' lines and both receipt outputs',
    t3.includes(rawLines[0]) && t3.includes(rawLines[1]) && t3.includes('saved output of browser-1') && t3.includes('saved output of code-1'));
  check('a finding with no specialist reads the inline receipt', s2.includes('saved output of inline-1'), s2.slice(-300));
  check('no shard file asks for KEEP or KILL', !/KEEP|KILL/.test(s1 + s2 + t3));

  const out2 = path.join(sandbox, 'shards-8b');
  fs.mkdirSync(out2);
  const dropped = run(['--shards', file, '--receipts', receipts, '--out', out2, '--drop', 'R3,R1']);
  let m2 = null; try { m2 = JSON.parse(dropped.stdout); } catch (e) { m2 = null; }
  check('--drop leaves the tier 1 kills out of every shard and says so',
    m2 && m2.dropped.join() === 'R1,R3' && m2.tier3 === null && m2.shards.every((s) => !s.ids.includes('R3')) && m2.shards.reduce((n, s) => n + s.ids.length, 0) === 9, dropped.stdout.slice(0, 300) + dropped.stderr);
  const badDrop = run(['--shards', file, '--receipts', receipts, '--out', out2, '--drop', 'R40']);
  check('--drop naming an ID the merge did not produce is a usage error', badDrop.status === 1 && /usage/.test(badDrop.stderr), badDrop.stderr);

  const again = run(['--shards', file, '--receipts', receipts, '--out', out]);
  check('an existing shard file is never overwritten', again.status === 1 && /"error":"exists"/.test(again.stderr) && fs.readFileSync(shards[0].file, 'utf8') === s1, again.stderr);

  const thin = path.join(sandbox, 'receipts-8c');
  fs.mkdirSync(thin);
  fs.copyFileSync(path.join(receipts, 'browser-1.txt'), path.join(thin, 'browser-1.txt'));
  fs.copyFileSync(path.join(receipts, 'code-1.txt'), path.join(thin, 'code-1.txt'));
  const out3 = path.join(sandbox, 'shards-8c');
  fs.mkdirSync(out3);
  const missing = run(['--shards', file, '--receipts', thin, '--out', out3]);
  check('a finding with no saved receipt output at all stops the run, names the file, and writes no shard',
    missing.status === 1 && /"error":"missing_receipt"/.test(missing.stderr) && /plan-critic-1\.txt/.test(missing.stderr) && fs.readdirSync(out3).length === 0, missing.stderr);
  // Review R2: the checks runner saves no file for a check it refused, and a merged
  // finding stands if any one of its checks passes, so one refused source is a note.
  const half = path.join(sandbox, 'receipts-8e');
  fs.mkdirSync(half);
  for (const s of stems) if (s !== 'code-1') fs.copyFileSync(path.join(receipts, s + '.txt'), path.join(half, s + '.txt'));
  const out5 = path.join(sandbox, 'shards-8e');
  fs.mkdirSync(out5);
  const partial = run(['--shards', file, '--receipts', half, '--out', out5]);
  const t5 = fs.existsSync(path.join(out5, 'audit-tier3.txt')) ? fs.readFileSync(path.join(out5, 'audit-tier3.txt'), 'utf8') : '';
  check('a merged finding with one source\'s output missing is written, that source marked untested (review R2)',
    partial.status === 0 && t5.includes('saved output of browser-1') && /Receipt output \(code-1\.txt\): none saved; tier 1 refused or did not run this check, so this source is untested\./.test(t5), partial.stderr + t5.slice(0, 300));

  // Step 3's replay found right bugs with wrong lines, so the shard says which is wrong.
  const repo = path.join(sandbox, 'cite-8');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'short.md'), 'one\ntwo\n');
  const off = Object.assign({}, UX, { key: 'short.md:off', file: { relPath: 'short.md', line: 9 } });
  const offFile = jsonl([off]);
  const rc = path.join(sandbox, 'receipts-8d');
  fs.mkdirSync(rc);
  fs.writeFileSync(path.join(rc, 'ux-1.txt'), 'x\nexit 0\n');
  const out4 = path.join(sandbox, 'shards-8d');
  fs.mkdirSync(out4);
  const cited = run(['--shards', offFile, '--receipts', rc, '--out', out4, '--root', repo]);
  const s4 = fs.existsSync(path.join(out4, 'audit-tier2-1.txt')) ? fs.readFileSync(path.join(out4, 'audit-tier2-1.txt'), 'utf8') : '';
  check('a bad citation rides into the shard as a note that the line is wrong, not the claim',
    /Citation check: line 9 is past the end of short\.md \(2 lines\)/.test(s4) && /not that the claim is wrong/.test(s4), s4.slice(0, 400) + cited.stderr);
  const bare = run(['--shards', file]);
  check('--shards without --receipts and --out is a usage error', bare.status === 1 && /usage/.test(bare.stderr), bare.stderr);
}

// --- 9. --verdicts: a return checked against its shard -------------------------
console.log('\n9. --verdicts checks each return against its IDs and the closed set, and tallies tier 3');
{
  const ret = (text) => { const f = path.join(sandbox, 'return-' + (++counter) + '.txt'); fs.writeFileSync(f, text); return f; };
  const shard = path.join(sandbox, 'shard-9.txt');
  fs.writeFileSync(shard, 'M2 audit shard: tier 2, shard 1 of 1, ids R2 R3 R4 R5 R6\n\nbody\n');
  const parse = (r) => { try { return JSON.parse(r.stdout); } catch (e) { return null; } };
  const good = ret('[Subagent hand-back] frame line\n  Tier 2 verdicts.\n  R2: STANDS\n  The grep shows it.\n  - **R3: REFUTED** the receipt shows nothing.\n  split: the heading is still wrong\n  **R4:** STANDS. Read the file.\n  `R5`: REFUTED - no such call\n  R6: STANDS\n  reason\n  R6: STANDS\n  Summary: R2 STANDS, R3 REFUTED.\n');
  const g = run(['--verdicts', shard, good]);
  const gj = parse(g) || {};
  check('a clean return exits 0 with one decided verdict per ID', g.status === 0 && gj.ok === true && JSON.stringify(gj.verdicts) === JSON.stringify({ R2: 'STANDS', R3: 'REFUTED', R4: 'STANDS', R5: 'REFUTED', R6: 'STANDS' }), g.stdout + g.stderr);
  check('a split line is kept with the ID it follows', gj.splits && gj.splits.R3 && gj.splits.R3[0] === 'the heading is still wrong', JSON.stringify(gj.splits));

  const keepKill = ret('R2: KEEP\nfine\nR3: KILL\nno\nR4: KEEP\nR5: KEEP\nR6: KILL\n');
  const kk = run(['--verdicts', shard, keepKill]);
  const kj = parse(kk) || {};
  check('a KEEP/KILL return exits 1, one unknown-word problem per ID, and decides nothing',
    kk.status === 1 && kj.ok === false && kj.verdicts === undefined && kj.returns[0].problems.filter((p) => p.kind === 'unknown').length === 5 && kj.returns[0].problems[0].word === 'KEEP', kk.stdout);
  const gaps = run(['--verdicts', shard, ret('R2: STANDS\nR3: REFUTED\nR4: STANDS\nR5: STANDS\nR99: STANDS\nR2: REFUTED\n')]);
  const gp = ((parse(gaps) || {}).returns || [{ problems: [] }])[0].problems.map((p) => p.kind + ':' + p.id).sort().join();
  check('a missing ID, an extra ID and a conflicting second line are each a problem', gaps.status === 1 && gp === 'conflict:R2,extra:R99,missing:R6', gp);
  const prose = run(['--verdicts', shard, ret('Report delivered. Summary of verdicts: R2 STANDS, R3 REFUTED, R4 STANDS, R5 STANDS, R6 STANDS.\n')]);
  check('a prose summary is not a verdict line: every ID is missing', prose.status === 1 && ((parse(prose) || {}).returns || [{ problems: [] }])[0].problems.filter((p) => p.kind === 'missing').length === 5, prose.stdout);
  // A real verifier return put an evidence list after its verdicts, each line
  // opening with the ID and a colon; a fixture voter put one before them.
  const evidence = run(['--verdicts', shard, ret('- **R2:** two GET requests returned the file.\nR2: STANDS\nR3: REFUTED\nR4: STANDS\nR5: STANDS\nR6: STANDS\n**R4:** The false sentence is gone from x.md:62.\nR5: I sent a request.\n')]);
  check('prose after an ID and a colon is evidence, not a second verdict', evidence.status === 0 && ((parse(evidence) || {}).verdicts || {}).R4 === 'STANDS', evidence.stdout);
  const onlyProse = run(['--verdicts', shard, ret('R2: STANDS\nR3: REFUTED\nR4: STANDS\nR5: STANDS\nR6: the receipt shows the call.\n')]);
  const op = ((parse(onlyProse) || {}).returns || [{ problems: [] }])[0].problems;
  check('an ID named only in prose is missing, and the problem says so', onlyProse.status === 1 && op.length === 1 && op[0].kind === 'missing' && op[0].id === 'R6' && /prose/.test(op[0].note || ''), JSON.stringify(op));
  const keepBeside = run(['--verdicts', shard, ret('R2: STANDS\nR2: KEEP\nR3: REFUTED\nR4: STANDS\nR5: STANDS\nR6: STANDS\n')]);
  check('an all-capitals word outside the set is a problem even beside a valid verdict', keepBeside.status === 1 && /"word":"KEEP"/.test(keepBeside.stdout), keepBeside.stdout);
  const t2down = run(['--verdicts', shard, ret('R2: DOWNGRADE Warn\nR3: STANDS\nR4: STANDS\nR5: STANDS\nR6: STANDS\n')]);
  check('DOWNGRADE is not a tier 2 word', t2down.status === 1 && /"word":"DOWNGRADE"/.test(t2down.stdout), t2down.stdout);

  // Tier 3: the tally in M2's order, the condition rule, and the two-ballot rule.
  const T3 = ['--verdicts', '--tier', '3', '--ids', 'R1,R2,R3,R4'];
  const b1 = ret('R1: REFUTED\nr\nR2: STANDS\nr\nR3: DOWNGRADE Warn\nnot reachable through a normal user action\nR4: DOWNGRADE Suggest\nlooks minor\n');
  const b2 = ret('R1: REFUTED\nr\nR2: STANDS\nr\nR3: DOWNGRADE Suggest - a workaround exists\nR4: DOWNGRADE Suggest\nit harms only the user who triggers it\n');
  const b3 = ret('R1: STANDS\nr\nR2: REFUTED\nr\nR3: STANDS\nr\nR4: STANDS\nr\n');
  const v3 = run(T3.concat([b1, b2, b3]));
  const vj = parse(v3) || {};
  check('three ballots tally in M2\'s order: 2 refutes kill, 2 stands keep, else the higher downgrade',
    v3.status === 0 && vj.verdicts && vj.verdicts.R1 === 'REFUTED 2/3' && vj.verdicts.R2 === 'STANDS' && vj.verdicts.R3 === 'DOWNGRADE Warn', JSON.stringify(vj.verdicts) + v3.stderr);
  check('a DOWNGRADE that names no Block condition counts as STANDS', vj.verdicts && vj.verdicts.R4 === 'STANDS' && JSON.stringify(vj.ballots.R4) === JSON.stringify(['STANDS', 'DOWNGRADE Suggest', 'STANDS']), JSON.stringify(vj.ballots && vj.ballots.R4));
  const all3 = run(['--verdicts', '--tier', '3', '--ids', 'R1', ret('R1: REFUTED\n'), ret('R1: REFUTED\n'), ret('R1: REFUTED\n')]);
  check('three refutes read REFUTED 3/3', ((parse(all3) || {}).verdicts || {}).R1 === 'REFUTED 3/3', all3.stdout);
  const two = run(['--verdicts', '--tier', '3', '--ids', 'R1,R2,R3', ret('R1: REFUTED\nR2: REFUTED\nR3: DOWNGRADE Warn - a workaround exists\n'), ret('R1: REFUTED\nR2: STANDS\nR3: DOWNGRADE Suggest - a workaround exists\n')]);
  const tj = parse(two) || {};
  check('two valid ballots kill only when both refute, downgrade only when both downgrade',
    two.status === 0 && tj.verdicts && tj.verdicts.R1 === 'REFUTED 2/3' && tj.verdicts.R2 === 'STANDS' && tj.verdicts.R3 === 'DOWNGRADE Warn', JSON.stringify(tj.verdicts));
  const one = run(['--verdicts', '--tier', '3', '--ids', 'R1', ret('R1: REFUTED\n')]);
  const oj = parse(one) || {};
  check('one valid ballot leaves the Block unaudited', one.status === 0 && oj.unaudited && oj.unaudited.join() === 'R1' && oj.verdicts && oj.verdicts.R1 === undefined, one.stdout);

  const ver = run(['--verdicts', '--tier', 'verify', '--ids', 'R1,R2', ret('R1: FIXED\nthe line is gone\nR2: NOT FIXED\nstill there\n')]);
  check('a verifier return decides FIXED and NOT FIXED', ver.status === 0 && JSON.stringify((parse(ver) || {}).verdicts) === JSON.stringify({ R1: 'FIXED', R2: 'NOT FIXED' }), ver.stdout + ver.stderr);
  const noHeader = run(['--verdicts', ret('no header\n'), ret('R1: STANDS\n')]);
  check('a shard file with no header line and no --ids is a usage error', noHeader.status === 1 && /usage/.test(noHeader.stderr), noHeader.stderr);
  const tooMany = run(['--verdicts', shard, good, good]);
  check('a tier 2 shard takes exactly one return', tooMany.status === 1 && /usage/.test(tooMany.stderr), tooMany.stderr);
}

console.log('\n10. 252 locus: each cited line is labeled against the diff of the fixes (issue #252)');
{
  // The fix verifier once called a fix FIXED that deleted the cited sentences
  // and put nothing in their place (#242 B1, bad-R3): the cut was inside one
  // line, so a line diff calls it rewritten. locusLabel compares words: a
  // changed block whose new words are a subsequence of its old words (text
  // cut, nothing added) is `removed`. Changed lines sit apart below because git
  // joins adjacent changed lines into one block, and a block is labeled whole.
  const mod = require(SCRIPT);
  const label = typeof mod.locusLabel === 'function' ? mod.locusLabel : () => ({});
  const repo = path.join(sandbox, 'locus');
  fs.mkdirSync(repo);
  const g = (args) => spawnSync('git', ['-C', repo, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false'].concat(args), { encoding: 'utf8' });
  g(['init', '-q']);
  const base = ['one', 'keep this line', 'gamma delta epsilon', 'four', 'zeta eta', 'six', 'theta whole', 'eight', 'iota kappa lambda', 'ten', 'mu   nu', 'twelve'];
  fs.writeFileSync(path.join(repo, 'a.txt'), base.join('\n') + '\n');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'doomed\n');
  fs.writeFileSync(path.join(repo, 'd.txt'), 'left alone\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'reviewed tree']);
  const sha = g(['rev-parse', 'HEAD']).stdout.trim();
  const now = base.slice();
  now[2] = 'gamma epsilon';               // line 3: a word cut, nothing added (bad-R3)
  now[4] = 'completely different words';  // line 5: replaced
  now[8] = 'iota mu-new lambda';          // line 9: a word cut and a new one added
  now[10] = 'mu nu';                      // line 11: whitespace only
  now.splice(6, 1);                       // line 7: the whole line deleted
  fs.writeFileSync(path.join(repo, 'a.txt'), now.join('\n') + '\n');
  fs.rmSync(path.join(repo, 'b.txt'));
  fs.writeFileSync(path.join(repo, 'n.txt'), 'made by the fix\n');
  fs.writeFileSync(path.join(repo, 'u.txt'), 'untracked before the review\n');
  const at = (rel, line, extra) => label(rel, line, Object.assign({ root: repo, base: sha }, extra || {})) || {};
  const shows = (r, file, line) => r.file === file && r.line === line;
  check('252 locus: a cited line in a changed file but in no changed block is untouched, file changed', shows(at('a.txt', 2), 'changed', 'untouched'), JSON.stringify(at('a.txt', 2)));
  check('252 locus: a replaced line is rewritten', shows(at('a.txt', 5), 'changed', 'rewritten'), JSON.stringify(at('a.txt', 5)));
  check('252 locus: a whole-line deletion is removed', shows(at('a.txt', 7), 'changed', 'removed'), JSON.stringify(at('a.txt', 7)));
  check('252 locus: a word cut from inside a line with nothing added (the bad-R3 shape) is removed', shows(at('a.txt', 3), 'changed', 'removed'), JSON.stringify(at('a.txt', 3)));
  check('252 locus: a cut plus new words is rewritten', shows(at('a.txt', 9), 'changed', 'rewritten'), JSON.stringify(at('a.txt', 9)));
  check('252 locus: a whitespace-only change is untouched', shows(at('a.txt', 11), 'changed', 'untouched'), JSON.stringify(at('a.txt', 11)));
  check('252 locus: a cited range with one rewritten line is rewritten, and one with a removed line and no rewrite is removed',
    at('a.txt', '4-6').line === 'rewritten' && at('a.txt', '6-8').line === 'removed', JSON.stringify([at('a.txt', '4-6'), at('a.txt', '6-8')]));
  check('252 locus: a deleted file is removed with file deleted', shows(at('b.txt', 1), 'deleted', 'removed'), JSON.stringify(at('b.txt', 1)));
  check('252 locus: a file that was not in the reviewed tree is file absent', at('c.txt', 1).file === 'absent', JSON.stringify(at('c.txt', 1)));
  check('252 locus: an unchanged file is file unchanged, its line untouched', shows(at('d.txt', 1), 'unchanged', 'untouched'), JSON.stringify(at('d.txt', 1)));
  check('252 locus: no cited line labels the whole file', at('a.txt', null).line === 'rewritten' && at('a.txt', null).file === 'changed', JSON.stringify(at('a.txt', null)));
  check('252 locus: an untracked file missing from the scope\'s starting list is file new; one on the list is file untracked, line unknown',
    at('n.txt', 1, { untrackedAtStart: ['u.txt'] }).file === 'new' && shows(at('u.txt', 1, { untrackedAtStart: ['u.txt'] }), 'untracked', 'unknown'),
    JSON.stringify([at('n.txt', 1, { untrackedAtStart: ['u.txt'] }), at('u.txt', 1, { untrackedAtStart: ['u.txt'] })]));
  // A saved patch with context lines (the retrospective's fix diffs) reads the same.
  const patch = g(['diff', sha]).stdout;
  const fromPatch = (rel, line) => label(rel, line, { patch, root: repo, base: sha }) || {};
  check('252 locus: a saved patch with context lines labels the same as the live tree',
    fromPatch('a.txt', 3).line === 'removed' && fromPatch('a.txt', 5).line === 'rewritten' && fromPatch('a.txt', 2).line === 'untouched'
      && fromPatch('a.txt', 11).line === 'untouched' && fromPatch('b.txt', 1).file === 'deleted' && fromPatch('d.txt', 1).file === 'unchanged',
    JSON.stringify([fromPatch('a.txt', 3), fromPatch('a.txt', 5), fromPatch('a.txt', 2), fromPatch('b.txt', 1), fromPatch('d.txt', 1)]));
  // `near` counts the changed blocks within 3 lines of the cited range (git's
  // default hunk context), pure insertions included at their place.
  const ins = ['diff --git a/p.md b/p.md', '--- a/p.md', '+++ b/p.md', '@@ -5,0 +6,1 @@', '+a note after line 5', '@@ -20 +21 @@', '-old twenty', '+new twenty', ''].join('\n');
  const nearOf = (line) => (label('p.md', line, { patch: ins, root: repo }) || {}).near;
  check('252 locus: near counts a pure insertion beside the cited line and a change within 3 lines, and not one further away',
    nearOf(5) === 1 && nearOf(6) === 1 && nearOf(2) === 1 && nearOf(1) === 0 && nearOf(17) === 1 && nearOf(12) === 0 && (label('p.md', 5, { patch: ins, root: repo }) || {}).line === 'untouched',
    JSON.stringify([nearOf(5), nearOf(6), nearOf(2), nearOf(1), nearOf(17), nearOf(12)]));
  // A gitignored file never shows in a git diff, so its lines cannot be judged.
  fs.writeFileSync(path.join(repo, '.gitignore'), 'plans/\n');
  fs.mkdirSync(path.join(repo, 'plans'));
  fs.writeFileSync(path.join(repo, 'plans', 'PLAN-x.md'), 'a plan\n');
  check('252 locus: a cited file git ignores is file ignored, line unknown', shows(at('plans/PLAN-x.md', 1), 'ignored', 'unknown'), JSON.stringify(at('plans/PLAN-x.md', 1)));
  // Punctuation is its own token: code keeps it on the word ("notes;", "1,"),
  // so a cut that leaves `return notes;` from `return notes.filter(keep);`, or
  // drops a JSON entry and the comma before it, is still a cut.
  const cut = (was, now) => ['diff --git a/c.js b/c.js', '--- a/c.js', '+++ b/c.js', '@@ -1 +1 @@', '-' + was, '+' + now, ''].join('\n');
  const cutLabel = (was, now) => (label('c.js', 1, { patch: cut(was, now), root: repo }) || {}).line;
  check('252 locus: punctuation is a token of its own, so a cut that leaves code punctuation behind is removed and new punctuation is not',
    cutLabel('return notes.filter(keep);', 'return notes;') === 'removed' && cutLabel('"a": 1, "b": 2,', '"a": 1') === 'removed'
      && cutLabel('return notes;', 'return notes.filter(keep);') === 'rewritten' && cutLabel('let x = 1', 'let x = 1;') === 'rewritten',
    JSON.stringify([cutLabel('return notes.filter(keep);', 'return notes;'), cutLabel('"a": 1, "b": 2,', '"a": 1'), cutLabel('return notes;', 'return notes.filter(keep);'), cutLabel('let x = 1', 'let x = 1;')]));
  // Inside a hunk, "--- x" is a removed line whose text starts with "-- ", not a header.
  const dashed = ['diff --git a/m.md b/m.md', 'index 1111111..2222222 100644', '--- a/m.md', '+++ b/m.md', '@@ -1,3 +1,2 @@', ' keep', '--- a dashed rule', ' tail', ''].join('\n');
  const dash = label('m.md', 2, { patch: dashed, root: repo }) || {};
  check('252 locus: a removed line whose own text starts with "-- " is read as a removed line, not a file header', dash.file === 'changed' && dash.line === 'removed', JSON.stringify(dash));
}

// --- 11. --verify: the fix loop's ledger (issue #267) ----------------------------
// M3's re-verify round used to be rebuilt by hand on every run: the recheck
// rows, the verifier shards, the diff of the fixes and the count of rounds per
// finding. --verify writes them from the bytes on disk, and ledger.json keeps
// the rounds, the verdicts and the checkpoints M4 and M5 read.
console.log('\n11. --verify writes the recheck rows, the verify shards and the ledger');
{
  const mod = require(SCRIPT);
  // One line per failure detail: through the release gate a failing suite shows
  // only its last 15 lines, and a multi-line detail pushes the case names out.
  const check11 = (name, cond, detail) => check(name, cond, String(detail === undefined ? '' : detail).replace(/\s+/g, ' ').slice(0, 300));
  const RUN_CHECKS = path.resolve(__dirname, '..', '.claude', 'scripts', 'run-checks.js');
  const repo = path.join(sandbox, 'verify-11');
  fs.mkdirSync(repo);
  const g = (args) => spawnSync('git', ['-C', repo, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false'].concat(args), { encoding: 'utf8' });
  g(['init', '-q']);
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
  w('src/a.js', 'const token = login();\nconsole.log(token);\nexport default token;\n');
  w('src/b.js', 'try { run(); } catch (e) {}\n');
  w('src/c.js', '// TODO: tidy\nmodule.exports = 1;\n');
  w('src/d.js', 'untouched by any fix\n');
  w('docs/x.md', ['# Guide', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].join('\n') + '\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'reviewed tree']);
  const end = g(['rev-parse', 'HEAD']).stdout.trim();
  // The user's own work in progress when the review started: an edit to d.js
  // and two untracked files. The scope's snapshot holds the edit; its list
  // holds the untracked files with their line counts, as session-init writes them.
  w('src/d.js', 'edited by the user before the review\n');
  w('notes.txt', 'n1\nn2\n');
  w('keep.txt', 'keep me\n');
  const baseline = g(['stash', 'create']).stdout.trim();
  check11('fixture: git stash create gives the baseline snapshot', /^[0-9a-f]{40}$/.test(baseline), baseline);
  const untrackedAtStart = [{ path: 'notes.txt', added: 2, deleted: 0, binary: false }, { path: 'keep.txt', added: 1, deleted: 0, binary: false }];
  const scopeFile = (name, scope) => { const f = path.join(sandbox, name); fs.writeFileSync(f, JSON.stringify(scope)); return f; };
  const scope = scopeFile('scope-11.json', { range: { base: end, end }, uncommitted: { baseline, untracked: { files: untrackedAtStart, added: 3, deleted: 0 } } });
  // The fixes: a.js loses its log line and gains a test, b.js rethrows, x.md
  // is rewritten, notes.txt grows a line, new.txt and a binary appear.
  w('src/a.js', 'const token = login();\nexport default token;\n');
  w('src/a.test.js', 'test("token", () => {});\n');
  w('src/b.js', 'try { run(); } catch (e) { throw e; }\n');
  w('docs/x.md', ['# Guide', 'one fixed', 'two fixed', 'three', 'four', 'five', 'six', 'seven', 'eight'].join('\n') + '\n');
  w('notes.txt', 'n1\nn2\nn3\n');
  w('new.txt', 'made by the fix\n');
  fs.writeFileSync(path.join(repo, 'img.bin'), Buffer.from([0x89, 0x50, 0x00, 0x47, 0x0a, 0x00]));
  // Findings: R1 is a merged pair of mechanical findings with two receipts, R2
  // and R3 are mechanical with receipts the mode cannot invert, R4 to R11 are
  // judgment findings, R12 a browser finding.
  const f = (specialist, rel, line, key, what, receipt) => ({ severity: 'warn', specialist, file: { relPath: rel, line }, what, fix: 'Fix it. Ten minutes, or leave it.', key, receipt });
  const rows = [
    f('code', 'src/a.js', 2, 'src/a.js:token-log', 'Should fix. The login token is logged to the console.', { check: "grep -n 'console.log(token)' src/a.js", expect: { match: 'token' } }),
    f('security', 'src/a.js', 2, 'src/a.js:token-log', 'Should fix. The token log has no test guarding it.', { check: 'test -e src/a.test.js', expect: { exit: 1 } }),
    f('code', 'src/b.js', 1, 'src/b.js:swallow', 'Should fix. The catch swallows the error.', { check: 'grep -c catch src/b.js', expect: { exit: 0 } }),
    f('code', 'src/c.js', 1, 'src/c.js:todo', 'Should fix. A TODO ships.', { check: 'grep -n TODO src/c.js', expect: { lines: { min: 1 } } }),
  ];
  for (let i = 1; i <= 8; i++) rows.push(f('ux', 'docs/x.md', i + 1, 'docs/x.md:j' + i, 'Should fix. Paragraph ' + i + ' of the guide never says who it is for.', { check: 'sed -n ' + (i + 1) + 'p docs/x.md', expect: { match: '.' } }));
  rows.push(f('browser', 'src/a.js', 1, 'ui:focus', 'Should fix. Focus is lost after the dialog closes.', { check: 'cat reports/receipts/x/shot.png', expect: { exit: 0 } }));
  const file = jsonl(rows);
  const rawLines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const receipts = path.join(sandbox, 'receipts-11');
  fs.mkdirSync(receipts);
  const stems = ['code-1', 'security-1', 'code-2', 'code-3'].concat([1, 2, 3, 4, 5, 6, 7, 8].map((i) => 'ux-' + i)).concat(['browser-1']);
  for (const s of stems) fs.writeFileSync(path.join(receipts, s + '.txt'), 'saved output of ' + s + '\nexit 0\n');
  const out = path.join(sandbox, 'verify-out-11');
  fs.mkdirSync(out);
  const ledger = path.join(out, 'ledger.json');
  const parse = (r) => { try { return JSON.parse(r.stdout); } catch (e) { return null; } };
  const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
  const led = () => readJson(ledger) || { findings: {} };
  const has = (name) => fs.existsSync(path.join(out, name));
  const count = (text, needle) => text.split(needle).length - 1;
  const JUDGMENT = 'R4,R5,R6,R7,R8,R9,R10,R11';
  const V = ['--verify', file, '--receipts', receipts, '--scope', scope, '--out', out, '--root', repo];

  const r1 = run(V.concat(['--mechanical', 'R1,R2,R3', '--judgment', JUDGMENT, '--browser', 'R12']));
  const m1 = parse(r1) || {};
  check11('--verify writes the recheck rows, the verify shards and the ledger from the bytes on disk',
    r1.status === 0 && m1.call === 1 && has('recheck-1.json') && has('verify-1-1.txt') && has('verify-1-2.txt') && has('ledger.json') && Array.isArray(m1.browser) && m1.browser.join() === 'R12' && led().findings.R12 && led().findings.R12.path === 'browser',
    r1.stderr + r1.stdout.slice(0, 300));
  const rc1 = readJson(path.join(out, 'recheck-1.json')) || [];
  const row = (id) => rc1.find((x) => x.id === id) || {};
  check11('a match receipt inverts to noMatch and a non-zero exit to exit 0, one recheck row per source receipt',
    JSON.stringify(row('code-1-recheck-r1').expect) === JSON.stringify({ noMatch: 'token' }) && row('code-1-recheck-r1').check === "grep -n 'console.log(token)' src/a.js"
      && JSON.stringify(row('security-1-recheck-r1').expect) === JSON.stringify({ exit: 0 }) && rc1.length === 4, JSON.stringify(rc1).slice(0, 400));
  check11('an exit 0 or lines receipt gets the prose placeholder and is listed under needsExpect',
    row('code-2-recheck-r1').expect === 'write the expect the fix must now satisfy' && row('code-3-recheck-r1').expect === 'write the expect the fix must now satisfy' && (m1.needsExpect || []).join() === 'R2,R3',
    JSON.stringify(m1.needsExpect) + JSON.stringify(row('code-2-recheck-r1')));
  // The checks runner on the recheck file as written: a placeholder row is
  // refused on its own and the others run (measured 2026-10-23, plan #267).
  const rcOut = path.join(sandbox, 'rc-out-11');
  const rc = spawnSync(process.execPath, [RUN_CHECKS, '--checks', path.join(out, 'recheck-1.json'), '--out', rcOut], { cwd: repo, encoding: 'utf8' });
  const rcj = (() => { try { return JSON.parse(rc.stdout); } catch (e) { return null; } })() || { checks: [] };
  const verdictOf = (id) => (rcj.checks.find((c) => c.id === id) || {}).verdict;
  check11('the checks runner returns a placeholder row as error and runs the others',
    rc.status === 0 && verdictOf('code-1-recheck-r1') === 'pass' && verdictOf('security-1-recheck-r1') === 'pass' && verdictOf('code-2-recheck-r1') === 'error' && verdictOf('code-3-recheck-r1') === 'error' && fs.existsSync(path.join(rcOut, 'results.json')),
    rc.stderr.slice(0, 300) + JSON.stringify(rcj.checks.map((c) => [c.id, c.verdict])));
  const s1 = has('verify-1-1.txt') ? fs.readFileSync(path.join(out, 'verify-1-1.txt'), 'utf8') : '';
  const s2 = has('verify-1-2.txt') ? fs.readFileSync(path.join(out, 'verify-1-2.txt'), 'utf8') : '';
  check11('eight judgment IDs give two shards named by call, with the header, the instruction, each finder\'s line, file:line and round, and the diff once',
    s1.split('\n')[0] === 'M3 verify shard: call 1, shard 1 of 2, ids R4 R5 R6 R7 R8 R9 R10' && s2.split('\n')[0] === 'M3 verify shard: call 1, shard 2 of 2, ids R11'
      && typeof mod.M3_INSTRUCTION === 'string' && s1.includes('"' + mod.M3_INSTRUCTION + '"') && [4, 5, 6, 7, 8, 9, 10].every((i) => s1.includes('\n' + rawLines[i] + '\n'))
      && s1.includes('===== R4 (round 1) =====') && /docs\/x\.md:2\b/.test(s1) && count(s1, 'diff --git a/src/a.js') === 1 && count(s2, 'diff --git a/src/a.js') === 1 && (m1.shards || []).length === 2,
    s1.slice(0, 300));
  check11('the diff comes from the baseline, so the user\'s pre-review edit is not in it',
    m1.diffFrom && m1.diffFrom.kind === 'baseline' && m1.diffFrom.sha === baseline && s1.includes('-console.log(token);') && !s1.includes('src/d.js'),
    JSON.stringify(m1.diffFrom) + (s1.includes('src/d.js') ? ' d.js leaked' : ''));
  check11('a new untracked file is in full, a changed starting-list file is in full and flagged, an unchanged one is a path, a binary is a path',
    s1.includes('made by the fix') && /new\.txt/.test(s1) && s1.includes('n3') && /notes\.txt[^\n]*2 -> 3/.test(s1) && /starting content was not captured/.test(s1)
      && /keep\.txt/.test(s1) && !s1.includes('keep me') && /img\.bin/.test(s1)
      && (m1.untracked || {}).new && m1.untracked.new.join() === 'img.bin,new.txt,src/a.test.js' && m1.untracked.changed.join() === 'notes.txt' && m1.untracked.unchanged.join() === 'keep.txt' && m1.untracked.binary.join() === 'img.bin',
    JSON.stringify(m1.untracked) + s1.slice(-500));

  // Verdicts: a verifier's return against the first shard, recorded under round 1,
  // then the checks runner's results recorded for the mechanical findings.
  const ret = (text) => { const p = path.join(sandbox, 'vret-' + (++counter) + '.txt'); fs.writeFileSync(p, text); return p; };
  const good = ret('R4: FIXED\nthe sentence names the reader now\nR5: FIXED\nr\nR6: NOT FIXED\nstill silent\nR7: FIXED\nr\nR8: FIXED\nr\nR9: FIXED\nr\nR10: FIXED\nr\n');
  const v1 = run(['--verdicts', path.join(out, 'verify-1-1.txt'), good, '--ledger', ledger]);
  const vj = parse(v1) || {};
  check11('--verdicts reads the verify header and --ledger records the return under the finding\'s round',
    v1.status === 0 && vj.tier === 'verify' && vj.verdicts && vj.verdicts.R4 === 'FIXED' && vj.verdicts.R6 === 'NOT FIXED'
      && led().findings.R4 && led().findings.R4.verdicts.length === 1 && led().findings.R4.verdicts[0].round === 1 && led().findings.R4.verdicts[0].verdict === 'FIXED' && led().findings.R6.verdicts[0].verdict === 'NOT FIXED',
    v1.stdout.slice(0, 300) + v1.stderr);
  const v2 = run(['--verdicts', '--ledger', ledger, '--recheck', path.join(rcOut, 'results.json')]);
  const v2j = parse(v2) || {};
  check11('--verdicts --ledger --recheck records FIXED only when every row passed, and an error row as not verified',
    v2.status === 0 && v2j.recorded && v2j.recorded.R1 === 'FIXED' && (v2j.unverified || []).join() === 'R2,R3' && led().findings.R1.verdicts[0].verdict === 'FIXED' && led().findings.R1.verdicts[0].source === 'recheck'
      && !led().findings.R2.verdicts.some((x) => x.verdict === 'FIXED' || x.verdict === 'NOT FIXED'),
    v2.stdout.slice(0, 300) + v2.stderr);
  // The checkpoint: the fixes committed (M4), then HEAD recorded as the last green.
  // d.js stays uncommitted, so the dirty count is 1: tracked changes only.
  g(['add', 'src/a.js', 'src/a.test.js', 'src/b.js', 'docs/x.md']); g(['commit', '-q', '-m', 'fixes']);
  const head1 = g(['rev-parse', 'HEAD']).stdout.trim();
  const c1 = run(['--checkpoint', '--ledger', ledger, '--root', repo]);
  const cj = parse(c1) || {};
  check11('--checkpoint --ledger records HEAD with a dirty count and the IDs FIXED this round',
    c1.status === 0 && cj.checkpoint && cj.checkpoint.sha === head1 && cj.checkpoint.dirty === 1 && cj.lastGreen === head1 && cj.checkpoint.fixed.join() === 'R1,R4,R5,R7,R8,R9,R10' && led().lastGreen === head1,
    c1.stdout.slice(0, 300) + c1.stderr);

  // Round 2 for the NOT FIXED judgment finding and the merged mechanical one.
  const r2 = run(V.concat(['--mechanical', 'R1', '--judgment', 'R6']));
  const m2 = parse(r2) || {};
  const s21 = has('verify-2-1.txt') ? fs.readFileSync(path.join(out, 'verify-2-1.txt'), 'utf8') : '';
  check11('a second call names its files by the call number and marks the repeated IDs round 2',
    r2.status === 0 && m2.call === 2 && has('recheck-2.json') && (readJson(path.join(out, 'recheck-2.json')) || []).some((x) => x.id === 'code-1-recheck-r2')
      && s21.split('\n')[0] === 'M3 verify shard: call 2, shard 1 of 1, ids R6' && s21.includes('===== R6 (round 2) =====')
      && led().findings.R6.round === 2 && led().findings.R1.round === 2 && led().findings.R5.round === 1 && led().calls === 2,
    r2.stderr + s21.slice(0, 120));
  const r3 = run(V.concat(['--judgment', 'R6']));
  check11('a third round refuses with rounds_exhausted and the last green sha, and writes nothing',
    r3.status === 1 && /"error":"rounds_exhausted"/.test(r3.stderr) && /"R6"/.test(r3.stderr) && r3.stderr.includes(head1) && !has('verify-3-1.txt') && led().calls === 2, r3.stderr);
  const twice = run(V.concat(['--mechanical', 'R2', '--judgment', 'R2']));
  const unknown = run(V.concat(['--judgment', 'R40']));
  check11('an ID named twice, or named but not merged, refuses',
    twice.status === 1 && /usage/.test(twice.stderr) && /R2/.test(twice.stderr) && unknown.status === 1 && /usage/.test(unknown.stderr) && /R40/.test(unknown.stderr) && led().calls === 2, twice.stderr + unknown.stderr);

  // Review of #267 (2026-10-24), R1: a round-two results file holds rows for the
  // findings named in round two only. A finding from an earlier round whose rows
  // are all absent was not rechecked this time, so it keeps its verdicts; it is
  // listed under notInResults, never written up as NOT VERIFIED.
  const rcOut2 = path.join(sandbox, 'rc-out-11-r2');
  spawnSync(process.execPath, [RUN_CHECKS, '--checks', path.join(out, 'recheck-2.json'), '--out', rcOut2], { cwd: repo, encoding: 'utf8' });
  const v3 = run(['--verdicts', '--ledger', ledger, '--recheck', path.join(rcOut2, 'results.json')]);
  const v3j = parse(v3) || {};
  check11('recording a later round\'s recheck results leaves a finding whose rows are not in that file untouched, and lists it under notInResults',
    v3.status === 0 && v3j.recorded && v3j.recorded.R1 === 'FIXED' && led().findings.R1.verdicts.filter((x) => x.round === 2).length === 1
      && led().findings.R2.verdicts.length === 1 && led().findings.R3.verdicts.length === 1 && (v3j.unverified || []).length === 0 && (v3j.notInResults || []).join() === 'R2,R3',
    v3.stderr + v3.stdout.slice(0, 300) + ' R2 verdicts: ' + JSON.stringify((led().findings.R2 || {}).verdicts));
  // R2: IDs are positions in the sorted merge, so a follow-up finding appended
  // to the file (M5's one generation) shifts every ID after it. A ledger entry
  // follows its finding's key: the exhausted finding is still refused, under the
  // ID it holds now, and a call that proceeds writes the ledger under the new IDs.
  const late = f('security', 'src/z.js', 1, 'src/z.js:late', 'Blocks. A late finding sorts first.', { check: 'cat src/z.js', expect: { exit: 0 } });
  late.severity = 'block';
  const file3 = jsonl(rows.concat([late]));
  const renumRefused = run(['--verify', file3, '--receipts', receipts, '--scope', scope, '--out', out, '--root', repo, '--judgment', 'R7']);
  check11('after a follow-up finding renumbers the merge, a ledger entry follows its key: the exhausted finding is refused under its new ID',
    renumRefused.status === 1 && /"error":"rounds_exhausted"/.test(renumRefused.stderr) && /"R7"/.test(renumRefused.stderr) && !has('verify-3-1.txt') && led().calls === 2,
    renumRefused.stderr + renumRefused.stdout.slice(0, 200));
  const renum = run(['--verify', file3, '--receipts', receipts, '--scope', scope, '--out', out, '--root', repo, '--judgment', 'R5']);
  const mr = parse(renum) || {};
  check11('a renumbered ledger is written under the new IDs and the call reports each move',
    renum.status === 0 && mr.renumbered && mr.renumbered.R6 === 'R7' && mr.renumbered.R1 === 'R2' && led().findings.R7.round === 2 && led().findings.R5.round === 2
      && led().findings.R2.path === 'mechanical' && !led().findings.R1 && led().findings.R13.path === 'browser' && led().calls === 3,
    renum.stderr + renum.stdout.slice(0, 300));
  // R16: outside --verify the ledger must already exist; a mistyped path would
  // otherwise start a second ledger with no green checkpoint in it.
  const ghost = path.join(sandbox, 'no-such-ledger.json');
  const cpGhost = run(['--checkpoint', '--ledger', ghost, '--root', repo]);
  const vdGhost = run(['--verdicts', path.join(out, 'verify-1-1.txt'), good, '--ledger', ghost]);
  check11('a ledger path that does not exist is refused outside --verify, and nothing is created there',
    cpGhost.status === 1 && /"error":"not_found"/.test(cpGhost.stderr) && vdGhost.status === 1 && /"error":"not_found"/.test(vdGhost.stderr) && !fs.existsSync(ghost),
    cpGhost.stderr + cpGhost.stdout.slice(0, 100) + vdGhost.stderr + vdGhost.stdout.slice(0, 100));
  // The follow-up the verifier noted (R24 of that review): --verify names every
  // finding before a verdict can be recorded, so a verdict for an ID the ledger
  // has never seen is a mistake to refuse, not an entry to create by position.
  const strayRet = ret('R40: FIXED\nnot a finding this run has\n');
  const stray = run(['--verdicts', '--tier', 'verify', '--ids', 'R40', strayRet, '--ledger', ledger]);
  check11('a verdict for an ID the ledger has never seen is refused and creates no entry',
    stray.status === 1 && /"error":"unknown_id"/.test(stray.stderr) && /R40/.test(stray.stderr) && !led().findings.R40, stray.stderr + stray.stdout.slice(0, 200));

  // The diff's starting point when the scope has no snapshot, and when it has no range.
  const scopeEnd = scopeFile('scope-11-end.json', { range: { base: end, end }, uncommitted: { baseline: null, untracked: { files: untrackedAtStart, added: 3, deleted: 0 } } });
  const outEnd = path.join(sandbox, 'verify-out-11-end');
  fs.mkdirSync(outEnd);
  const rEnd = run(['--verify', file, '--receipts', receipts, '--scope', scopeEnd, '--out', outEnd, '--root', repo, '--judgment', 'R4']);
  const mEnd = parse(rEnd) || {};
  const sEnd = fs.existsSync(path.join(outEnd, 'verify-1-1.txt')) ? fs.readFileSync(path.join(outEnd, 'verify-1-1.txt'), 'utf8') : '';
  check11('without a baseline the diff comes from range.end, and the pre-review edit is then part of it as M3 says',
    rEnd.status === 0 && mEnd.diffFrom && mEnd.diffFrom.kind === 'end' && mEnd.diffFrom.sha === end && sEnd.includes('src/d.js'), rEnd.stderr + JSON.stringify(mEnd.diffFrom));
  const scopeNone = scopeFile('scope-11-none.json', { range: null, uncommitted: { baseline: null, untracked: { files: [], added: 0, deleted: 0 } } });
  const outNone = path.join(sandbox, 'verify-out-11-none');
  fs.mkdirSync(outNone);
  const noEnd = run(['--verify', file, '--receipts', receipts, '--scope', scopeNone, '--out', outNone, '--root', repo, '--judgment', 'R4']);
  const writtenByRefusal = fs.readdirSync(outNone).length;
  const withEnd = run(['--verify', file, '--receipts', receipts, '--scope', scopeNone, '--out', outNone, '--root', repo, '--judgment', 'R4', '--end', end]);
  check11('a scope with neither baseline nor range refuses without --end, and takes --end',
    noEnd.status === 1 && /--end/.test(noEnd.stderr) && writtenByRefusal === 0 && withEnd.status === 0 && ((parse(withEnd) || {}).diffFrom || {}).sha === end, 'with --end: ' + withEnd.stderr + withEnd.stdout.slice(0, 200) + ' | without: ' + noEnd.stderr);

  // An empty diff: nothing after the starting point changed, so there is no fix
  // for a verifier to judge; a recheck still runs, and fails honestly.
  const repo2 = path.join(sandbox, 'verify-11-clean');
  fs.mkdirSync(repo2);
  const g2 = (args) => spawnSync('git', ['-C', repo2, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false'].concat(args), { encoding: 'utf8' });
  g2(['init', '-q']);
  fs.writeFileSync(path.join(repo2, 'a.js'), 'console.log(token);\n');
  g2(['add', '-A']); g2(['commit', '-q', '-m', 'clean']);
  const head2 = g2(['rev-parse', 'HEAD']).stdout.trim();
  const scope2 = scopeFile('scope-11-clean.json', { range: { base: head2, end: head2 }, uncommitted: { baseline: null, untracked: { files: [], added: 0, deleted: 0 } } });
  const file2 = jsonl([rows[0], rows[4]]);
  const out2 = path.join(sandbox, 'verify-out-11-clean');
  fs.mkdirSync(out2);
  const empty = run(['--verify', file2, '--receipts', receipts, '--scope', scope2, '--out', out2, '--root', repo2, '--mechanical', 'R1', '--judgment', 'R2']);
  const writtenByEmpty = fs.readdirSync(out2).length;
  const mechOnly = run(['--verify', file2, '--receipts', receipts, '--scope', scope2, '--out', out2, '--root', repo2, '--mechanical', 'R1']);
  check11('an empty diff with a judgment ID refuses with empty_diff and writes nothing; a mechanical-only call proceeds',
    empty.status === 1 && /"error":"empty_diff"/.test(empty.stderr) && writtenByEmpty === 0 && mechOnly.status === 0 && fs.existsSync(path.join(out2, 'recheck-1.json')), 'mechanical only: ' + mechOnly.stderr + mechOnly.stdout.slice(0, 200) + ' | empty: ' + empty.stderr);

  // The guards --shards already keeps: an existing file, a missing receipt, a bare call.
  const out3 = path.join(sandbox, 'verify-out-11-taken');
  fs.mkdirSync(out3);
  fs.writeFileSync(path.join(out3, 'verify-1-1.txt'), 'an earlier run\n');
  const taken = run(['--verify', file, '--receipts', receipts, '--scope', scope, '--out', out3, '--root', repo, '--judgment', 'R4']);
  check11('a shard file that already exists for the call number is never replaced',
    taken.status === 1 && /"error":"exists"/.test(taken.stderr) && fs.readFileSync(path.join(out3, 'verify-1-1.txt'), 'utf8') === 'an earlier run\n' && !fs.existsSync(path.join(out3, 'ledger.json')), taken.stderr);
  const thin = path.join(sandbox, 'receipts-11-thin');
  fs.mkdirSync(thin);
  const out4 = path.join(sandbox, 'verify-out-11-thin');
  fs.mkdirSync(out4);
  const noSaved = run(['--verify', file, '--receipts', thin, '--scope', scope, '--out', out4, '--root', repo, '--mechanical', 'R2']);
  check11('a mechanical ID with no saved tier 1 output stops the run and names the file',
    noSaved.status === 1 && /"error":"missing_receipt"/.test(noSaved.stderr) && /code-2\.txt/.test(noSaved.stderr) && fs.readdirSync(out4).length === 0, noSaved.stderr);
  const bare = run(['--verify', file]);
  check11('--verify without its folders and lists is a usage error', bare.status === 1 && /usage/.test(bare.stderr), bare.stderr);
  check11('the usage shows every ID flag as optional',
    bare.stderr.includes('[--mechanical <R-ids>] [--judgment <R-ids>] [--browser <R-ids>]'), bare.stderr.slice(0, 300));

  // Issue #272: the mode prints what consumes each file it wrote, in order, so a
  // rule can say "run what it prints" instead of restating the calls. The suite
  // runs the script by its absolute path from a folder outside the repository,
  // which takes the absolute branch of the printed script paths; the case after
  // the next runs from the project root and takes the relative one.
  const outNext = path.join(sandbox, 'verify-out-11-next');
  fs.mkdirSync(outNext);
  const ledgerNext = path.join(outNext, 'ledger.json');
  const rNext = run(['--verify', file, '--receipts', receipts, '--scope', scope, '--out', outNext, '--root', repo, '--mechanical', 'R1', '--judgment', 'R4']);
  const mNext = parse(rNext) || {};
  const nx = Array.isArray(mNext.next) ? mNext.next : [];
  const recheckNext = path.join(outNext, 'recheck-1.json');
  const shardNext = path.join(outNext, 'verify-1-1.txt');
  const returnNext = path.join(outNext, 'verify-1-1-return.txt');
  check11('--verify prints the command that consumes each file it wrote',
    rNext.status === 0 && nx.length === 3
      && nx[0].do === 'run' && nx[0].command === 'node ' + RUN_CHECKS + ' --checks ' + recheckNext + ' --out ' + outNext
      && nx[0].record === 'node ' + SCRIPT + ' --verdicts --ledger ' + ledgerNext + ' --recheck ' + path.join(outNext, 'results.json')
      && nx[1].do === 'dispatch' && nx[1].agent === 'fix-verifier' && nx[1].file === shardNext && nx[1].save === returnNext
      && nx[1].prompt === 'Your findings, M3\'s instruction and the diff of the fixes are in ' + shardNext + '; read it in full and follow it exactly.'
      && nx[1].record === 'node ' + SCRIPT + ' --verdicts ' + shardNext + ' ' + returnNext + ' --ledger ' + ledgerNext
      && nx[2].do === 'run' && nx[2].after === 'the checkpoint commit' && nx[2].command === 'node ' + SCRIPT + ' --checkpoint --ledger ' + ledgerNext + ' --root ' + repo,
    rNext.stderr + JSON.stringify(nx).slice(0, 600));
  // R9 of the #272 review: the relative branch, the one every run from a
  // project root takes. Run from this repository's root, the printed script
  // paths are relative to it, as the rule's commands show them.
  const ROOT = path.resolve(__dirname, '..');
  const outRel = path.join(sandbox, 'verify-out-11-rel');
  fs.mkdirSync(outRel);
  const rRel = spawnSync(process.execPath, [SCRIPT, '--verify', file, '--receipts', receipts, '--scope', scope, '--out', outRel, '--root', repo, '--mechanical', 'R1'], { cwd: ROOT, encoding: 'utf8' });
  let nRel = [];
  try { nRel = JSON.parse(rRel.stdout).next || []; } catch (e) { nRel = []; }
  check11('run from the project root, the printed commands name the scripts by their relative paths',
    rRel.status === 0 && nRel.length === 2 && String(nRel[0].command).startsWith('node .claude/scripts/run-checks.js --checks ')
      && String(nRel[0].record).startsWith('node .claude/scripts/merge-findings.js --verdicts ') && String(nRel[1].command).startsWith('node .claude/scripts/merge-findings.js --checkpoint '),
    rRel.stderr + JSON.stringify(nRel).slice(0, 400));
  // R10 of the #272 review: a path with a space (a Windows home folder, a
  // project under "My Projects") is quoted in every printed command and
  // record, so the runner can paste the line as it is; a plain path stays bare.
  const outSpace = path.join(sandbox, 'verify out 11');
  fs.mkdirSync(outSpace);
  const q = (p) => "'" + p + "'";
  const rSpace = run(['--verify', file, '--receipts', receipts, '--scope', scope, '--out', outSpace, '--root', repo, '--mechanical', 'R1', '--judgment', 'R4']);
  const mSpace = parse(rSpace) || {};
  const ns = Array.isArray(mSpace.next) ? mSpace.next : [];
  check11('a space in the out folder is quoted in every printed command and record',
    rSpace.status === 0 && ns.length === 3
      && ns[0].command === 'node ' + RUN_CHECKS + ' --checks ' + q(path.join(outSpace, 'recheck-1.json')) + ' --out ' + q(outSpace)
      && ns[0].record === 'node ' + SCRIPT + ' --verdicts --ledger ' + q(path.join(outSpace, 'ledger.json')) + ' --recheck ' + q(path.join(outSpace, 'results.json'))
      && ns[1].record === 'node ' + SCRIPT + ' --verdicts ' + q(path.join(outSpace, 'verify-1-1.txt')) + ' ' + q(path.join(outSpace, 'verify-1-1-return.txt')) + ' --ledger ' + q(path.join(outSpace, 'ledger.json'))
      && ns[2].command === 'node ' + SCRIPT + ' --checkpoint --ledger ' + q(path.join(outSpace, 'ledger.json')) + ' --root ' + repo,
    rSpace.stderr + JSON.stringify(ns).slice(0, 600));
  const outWrite = path.join(sandbox, 'verify-out-11-write');
  fs.mkdirSync(outWrite);
  const rWrite = run(['--verify', file, '--receipts', receipts, '--scope', scope, '--out', outWrite, '--root', repo, '--mechanical', 'R2']);
  const mWrite = parse(rWrite) || {};
  const nw = Array.isArray(mWrite.next) ? mWrite.next : [];
  check11('a needsExpect row puts a write entry first',
    rWrite.status === 0 && nw.length === 3 && nw[0].do === 'write' && (nw[0].ids || []).join() === 'R2' && nw[0].file === path.join(outWrite, 'recheck-1.json') && nw[1].do === 'run' && nw[2].do === 'run',
    rWrite.stderr + JSON.stringify(nw).slice(0, 400));
  // The placeholder row is refused by the checks runner, so the record lists the
  // finding under unverified and prints what to do next: write the expect, run
  // the recheck file again, record again.
  const rcOutWrite = path.join(sandbox, 'rc-out-11-write');
  spawnSync(process.execPath, [RUN_CHECKS, '--checks', path.join(outWrite, 'recheck-1.json'), '--out', rcOutWrite], { cwd: repo, encoding: 'utf8' });
  const recWrite = run(['--verdicts', '--ledger', path.join(outWrite, 'ledger.json'), '--recheck', path.join(rcOutWrite, 'results.json')]);
  const mRec = parse(recWrite) || {};
  const nr = Array.isArray(mRec.next) ? mRec.next : [];
  check11('a recheck record lists its unverified rows under next',
    recWrite.status === 0 && (mRec.unverified || []).join() === 'R2' && nr.length === 2
      && nr[0].do === 'write' && (nr[0].ids || []).join() === 'R2' && nr[0].file === path.join(outWrite, 'recheck-1.json')
      && nr[1].do === 'run' && nr[1].command === 'node ' + RUN_CHECKS + ' --checks ' + path.join(outWrite, 'recheck-1.json') + ' --out ' + rcOutWrite
      && nr[1].record === 'node ' + SCRIPT + ' --verdicts --ledger ' + path.join(outWrite, 'ledger.json') + ' --recheck ' + path.join(rcOutWrite, 'results.json'),
    recWrite.stderr + JSON.stringify(mRec).slice(0, 500));
  const outOne = path.join(sandbox, 'verify-out-11-one');
  fs.mkdirSync(outOne);
  const rOne = run(['--verify', file, '--receipts', receipts, '--scope', scope, '--out', outOne, '--root', repo, '--judgment', 'R4']);
  const mOne = parse(rOne) || {};
  const no = Array.isArray(mOne.next) ? mOne.next : [];
  check11('an ID flag may be left out when its list is empty',
    rOne.status === 0 && fs.existsSync(path.join(outOne, 'verify-1-1.txt')) && !fs.existsSync(path.join(outOne, 'recheck-1.json')) && mOne.recheck === null && no.length === 2 && no[0].do === 'dispatch' && no[1].do === 'run',
    rOne.stderr + JSON.stringify(no).slice(0, 300));
  // The first call above named R12 under --browser: its re-run is the runner's
  // (the check was written before the fix), so the entry names the re-run, the
  // return file and the record, and sits before the checkpoint entry.
  const n1 = Array.isArray(m1.next) ? m1.next : [];
  const bEntry = n1.find((e) => e.do === 'browser') || {};
  check11('a browser ID gets a browser entry naming its re-run, its return file and its record, before the checkpoint entry',
    (bEntry.ids || []).join() === 'R12' && bEntry.save === path.join(out, 'browser-1-R12-return.txt') && /R12: FIXED/.test(bEntry.what)
      && bEntry.record === 'node ' + SCRIPT + ' --verdicts --tier verify --ids R12 ' + bEntry.save + ' --ledger ' + ledger
      && n1.indexOf(bEntry) < n1.length - 1 && n1[n1.length - 1].do === 'run' && /--checkpoint/.test(n1[n1.length - 1].command),
    JSON.stringify(n1).slice(0, 600));
  // The verifier instruction lives in three places and a change to one must
  // fail here rather than drift, as section 8 holds M2's two instructions.
  const HITL = fs.readFileSync(path.resolve(__dirname, '..', '.claude', 'skills', 'shared', 'hitl-loop.md'), 'utf8');
  const VERIFIER = fs.readFileSync(path.resolve(__dirname, '..', '.claude', 'agents', 'fix-verifier.md'), 'utf8');
  check11('M3_INSTRUCTION is the verifier sentence hitl-loop.md and fix-verifier.md carry',
    typeof mod.M3_INSTRUCTION === 'string' && HITL.includes(mod.M3_INSTRUCTION) && VERIFIER.includes(mod.M3_INSTRUCTION),
    'in hitl-loop.md: ' + HITL.includes(mod.M3_INSTRUCTION) + '; in the agent: ' + VERIFIER.includes(mod.M3_INSTRUCTION));

  // Issue #283: a receipt tied to a line number ("line 1668 holds this text")
  // inverted into a noMatch on that same number, which any edit above the line
  // satisfies, so a problem that only moved read as FIXED. A grep that prints
  // line numbers now gets a recheck with the number dropped: it fails while the
  // text sits on any line. A receipt that reads lines by number cannot be made
  // position-free, so the mechanical path refuses it and prints the same call
  // with the finding named under --judgment, where a verifier reads the diff.
  const repo3 = path.join(sandbox, 'verify-283');
  fs.mkdirSync(repo3);
  const g3 = (args) => spawnSync('git', ['-C', repo3, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false'].concat(args), { encoding: 'utf8' });
  g3(['init', '-q']);
  const w3 = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo3, rel)), { recursive: true }); fs.writeFileSync(path.join(repo3, rel), text); };
  // The #281 review's real receipt: its check, its match on line 1668 and the
  // output its first run saved (reports/receipts/2026-10-28-075544/code-1.txt).
  const REAL_CHECK = "grep -n 'current = null' .claude/scripts/session-init.js";
  const REAL_MATCH = '^1668:.*\\^\\\\s\\*\\(\\?:#\\|- \\)';
  const OLD_LINE = '    else if (/^\\s*(?:#|- )/.test(line)) current = null;';
  const NEW_LINE = '    else if (/^(?:#|[-*+]\\s)/.test(line)) current = null;';
  const lines283 = Array.from({ length: 1663 }, (_, i) => '// filler ' + (i + 1))
    .concat(['  let current = null;', '  for (const line of lines) {', '    if (skip(line)) continue;', '    if (lead(line)) current = line;', OLD_LINE, '  }']);
  const writeInit = (lines) => w3('.claude/scripts/session-init.js', lines.join('\n') + '\n');
  writeInit(lines283);
  w3('src/a.js', 'const token = login();\nconsole.log(token);\nexport default token;\n');
  w3('docs/x.md', ['# Guide', 'one', 'two', 'three', 'four', 'five'].join('\n') + '\n');
  g3(['add', '-A']); g3(['commit', '-q', '-m', 'reviewed tree']);
  const end3 = g3(['rev-parse', 'HEAD']).stdout.trim();
  const rcpt3 = path.join(sandbox, 'receipts-283');
  fs.mkdirSync(rcpt3);
  const saved3 = (stem, text) => fs.writeFileSync(path.join(rcpt3, stem + '.txt'), text + '\nexit 0\n');
  const scope3 = scopeFile('scope-283.json', { range: { base: end3, end: end3 }, uncommitted: { baseline: null, untracked: { files: [], added: 0, deleted: 0 } } });
  const LOG = 'console.log(token);';
  const forms = [
    f('code', '.claude/scripts/session-init.js', 1668, 'init:superseded-indented', 'Should fix. A superseded note on an indented line is missed.', { check: REAL_CHECK, expect: { match: REAL_MATCH } }),
    f('code', 'src/a.js', 2, 'src/a.js:log-n', 'Should fix. The token is logged.', { check: "grep -n 'console.log(token)' src/a.js", expect: { match: '^2:console' } }),
    f('code', 'src/a.js', 2, 'src/a.js:log-nE', 'Should fix. The token is logged, found by a regex.', { check: "grep -nE 'console[.]log[(]token[)]' src/a.js", expect: { match: '^2:console' } }),
    f('code', 'src/a.js', 2, 'src/a.js:log-long', 'Should fix. The token is logged, found with the long flag.', { check: "grep --line-number -F 'console.log(token)' src/a.js", expect: { match: '^2:console' } }),
    f('code', 'src/a.js', 2, 'src/a.js:log-rn', 'Should fix. The token is logged, found by a recursive search.', { check: "grep -rn 'console.log(token)' src", expect: { match: '^src/a\\.js:2:console' } }),
  ];
  saved3('code-1', '1664:  let current = null;\n1668:' + OLD_LINE);
  for (const s of ['code-2', 'code-3', 'code-4']) saved3(s, '2:' + LOG);
  saved3('code-5', 'src/a.js:2:' + LOG);
  const out3a = path.join(sandbox, 'verify-out-283');
  fs.mkdirSync(out3a);
  const r283 = run(['--verify', jsonl(forms), '--receipts', rcpt3, '--scope', scope3, '--out', out3a, '--root', repo3, '--mechanical', 'R1,R2,R3,R4,R5']);
  const rows283 = readJson(path.join(out3a, 'recheck-1.json')) || [];
  const rowOf = (stem) => rows283.find((x) => x.id === stem + '-recheck-r1') || {};
  // A recheck row fails when its noMatch finds the text: moved down a line it
  // must, gone or fixed it must not.
  const fails = (row, output) => typeof (row.expect || {}).noMatch === 'string' && new RegExp(row.expect.noMatch, 'm').test(output);
  const moved = { 'code-1': '1665:  let current = null;\n1669:' + OLD_LINE, 'code-2': '3:' + LOG, 'code-3': '3:' + LOG, 'code-4': '3:' + LOG, 'code-5': 'src/a.js:3:' + LOG };
  const fixedOut = { 'code-1': '1664:  let current = null;\n1668:' + NEW_LINE, 'code-2': '', 'code-3': '', 'code-4': '', 'code-5': '' };
  check11('283: a line-anchored grep receipt\'s recheck still fails when the flagged text moves down a line',
    r283.status === 0 && Object.keys(moved).every((s) => fails(rowOf(s), moved[s] + '\nexit 0\n') && !fails(rowOf(s), fixedOut[s] + '\nexit ' + (fixedOut[s] ? 0 : 1) + '\n')),
    r283.stderr + JSON.stringify(rows283.map((x) => [x.id, x.expect])).slice(0, 400));
  // End to end through the checks runner, on the real receipt: the text pushed
  // down a line by an edit above it is still there, so the recheck fails; the
  // fixed text passes.
  const verdict283 = (lines, name) => {
    writeInit(lines);
    const rc = spawnSync(process.execPath, [RUN_CHECKS, '--checks', path.join(out3a, 'recheck-1.json'), '--out', path.join(sandbox, 'rc-out-283-' + name)], { cwd: repo3, encoding: 'utf8' });
    let j = null;
    try { j = JSON.parse(rc.stdout); } catch (e) { j = null; }
    return ((j && j.checks) || []).find((c) => c.id === 'code-1-recheck-r1') || {};
  };
  const vMoved = verdict283(['// one line added above'].concat(lines283), 'moved');
  const vFixed = verdict283(lines283.map((l) => (l === OLD_LINE ? NEW_LINE : l)), 'fixed');
  writeInit(lines283);
  check11('283: end to end, the checks runner fails the recheck of a moved line and passes the fix',
    vMoved.verdict === 'fail' && vFixed.verdict === 'pass', 'moved: ' + JSON.stringify(vMoved).slice(0, 200) + ' fixed: ' + JSON.stringify(vFixed).slice(0, 200));
  // A pattern the first run printed on several lines: a whole-file noMatch could
  // only pass once every one of them is gone, so the runner writes this expect.
  const rcptMany = path.join(sandbox, 'receipts-283-many');
  fs.mkdirSync(rcptMany);
  fs.writeFileSync(path.join(rcptMany, 'code-1.txt'), '1:const token = login();\n2:' + LOG + '\n3:export default token;\nexit 0\n');
  const outMany = path.join(sandbox, 'verify-out-283-many');
  fs.mkdirSync(outMany);
  const many = [f('code', 'src/a.js', 2, 'src/a.js:token-everywhere', 'Should fix. The token reaches the log.', { check: "grep -n 'token' src/a.js", expect: { match: '^2:.*token' } })];
  const rMany = run(['--verify', jsonl(many), '--receipts', rcptMany, '--scope', scope3, '--out', outMany, '--root', repo3, '--mechanical', 'R1']);
  const mMany = parse(rMany) || {};
  const rowMany = (readJson(path.join(outMany, 'recheck-1.json')) || [])[0] || {};
  check11('283: a pattern on more than one line of the saved output goes to needsExpect',
    rMany.status === 0 && rowMany.expect === 'write the expect the fix must now satisfy' && (mMany.needsExpect || []).join() === 'R1',
    rMany.stderr + JSON.stringify(rowMany).slice(0, 200));
  // A receipt that reads lines by number: refused for the mechanical path with
  // nothing written, and the printed retry builds the finding's verifier shard.
  w3('docs/x.md', ['# Guide', 'one', 'two', 'three, now explained', 'four', 'five'].join('\n') + '\n');
  const rcptRanged = path.join(sandbox, 'receipts-283-ranged');
  fs.mkdirSync(rcptRanged);
  fs.writeFileSync(path.join(rcptRanged, 'ux-1.txt'), 'two\nthree\nfour\nexit 0\n');
  const outRanged = path.join(sandbox, 'verify-out-283-ranged');
  fs.mkdirSync(outRanged);
  const ranged = [f('ux', 'docs/x.md', 4, 'docs/x.md:three', 'Should fix. Line three says nothing.', { check: "sed -n '3,5p' docs/x.md", expect: { match: 'three' } })];
  const rRanged = run(['--verify', jsonl(ranged), '--receipts', rcptRanged, '--scope', scope3, '--out', outRanged, '--root', repo3, '--mechanical', 'R1']);
  let refusal = {};
  try { refusal = JSON.parse(rRanged.stderr.trim().split('\n').pop()); } catch (e) { refusal = {}; }
  const writtenByRanged = fs.readdirSync(outRanged).length;
  const retried = typeof refusal.retry === 'string' ? spawnSync(refusal.retry, { shell: true, cwd: sandbox, encoding: 'utf8' }) : { status: null, stderr: 'no retry printed' };
  const retryShard = fs.existsSync(path.join(outRanged, 'verify-1-1.txt')) ? fs.readFileSync(path.join(outRanged, 'verify-1-1.txt'), 'utf8') : '';
  check11('283: a mechanical receipt that reads lines by number is refused with nothing written and the retry printed',
    rRanged.status === 1 && refusal.error === 'line_addressed' && (refusal.ids || []).join() === 'R1' && writtenByRanged === 0
      && / --judgment R1( |$)/.test(refusal.retry || '') && !/--mechanical/.test(refusal.retry || '') && !/(^|\s)\/(tk:)?(review|execute|document|explore|merge)\b/.test(refusal.reason || '')
      && retried.status === 0 && retryShard.split('\n')[0] === 'M3 verify shard: call 1, shard 1 of 1, ids R1',
    rRanged.status + ' ' + rRanged.stderr.slice(0, 200) + ' | retry: ' + String(refusal.retry).slice(0, 160) + ' -> ' + String(retried.stderr).slice(0, 160));
  check11('283: a receipt without grep line numbers inverts as before',
    JSON.stringify(mod.invertExpect({ match: '^2$' }, "grep -c 'token' src/a.js")) === JSON.stringify({ noMatch: '^2$' })
      && JSON.stringify(mod.invertExpect({ match: '^12:30 at' }, "grep 'at' notes.txt")) === JSON.stringify({ noMatch: '^12:30 at' })
      && JSON.stringify(mod.invertExpect({ match: 'token' }, "grep -n 'token' src/a.js")) === JSON.stringify({ noMatch: 'token' })
      && JSON.stringify(mod.invertExpect({ noMatch: '^4:x' }, "grep -n 'x' src/a.js")) === JSON.stringify({ match: '^4:x' })
      && JSON.stringify(mod.invertExpect({ exit: 1 }, 'test -e src/a.test.js')) === JSON.stringify({ exit: 0 }),
    JSON.stringify([mod.invertExpect({ match: '^2$' }, "grep -c 'token' src/a.js"), mod.invertExpect({ match: '^12:30 at' }, "grep 'at' notes.txt")]));
  // The review of #283 found receipt forms the first cut missed. The checks
  // runner also allows rg, and a grep option cluster may carry a digit (-nC2);
  // both print line numbers, so both drop the number. rg -N prints none, so its
  // match is left alone.
  const inv = (match, check) => JSON.stringify(mod.invertExpect({ match: match }, check));
  check11('283: an rg receipt with line numbers and a grep option cluster with a digit drop the number too',
    inv('^2:console', "rg -n 'console.log' src/a.js") === JSON.stringify({ noMatch: '^[0-9]+:console' })
      && inv('^src/a\\.js:2:console', "rg --line-number 'console.log' src") === JSON.stringify({ noMatch: '^src/a\\.js:[0-9]+:console' })
      && inv('^2:console', "grep -nC2 'console.log' src/a.js") === JSON.stringify({ noMatch: '^[0-9]+:console' })
      && inv('^2:console', "rg -N 'console.log' src/a.js") === JSON.stringify({ noMatch: '^2:console' }),
    [inv('^2:console', "rg -n 'console.log' src/a.js"), inv('^2:console', "grep -nC2 'console.log' src/a.js"), inv('^2:console', "rg -N 'console.log' src/a.js")].join(' '));
  // The same sweep for a receipt that reads lines by number: sed with -e,
  // --expression, --quiet or a +N range, awk on FNR, and head or tail with
  // --lines all name lines by their number; a sed pattern address and a head
  // that reads a pipe do not.
  const numbered = ["sed -n -e '12p' a.md", "sed -n --expression='12p' a.md", "sed --quiet '12,+3p' a.md", "awk 'FNR==12' a.md", 'head --lines=12 a.md', 'tail --lines=+12 a.md'];
  const unnumbered = ["sed -n '/token/p' a.md", 'head --lines=12', "grep -n 'x' a.md"];
  const byNumber = (check) => typeof mod.readsLinesByNumber === 'function' && mod.readsLinesByNumber(check) === true;
  check11('283: sed -e, --quiet and +N forms, awk on FNR and head or tail --lines read lines by number too',
    numbered.every(byNumber) && !unnumbered.some(byNumber),
    'missed: ' + numbered.filter((c) => !byNumber(c)).join(' | ') + '; wrongly caught: ' + unnumbered.filter(byNumber).join(' | '));
  // The checks runner also allows cat and git blame, and both print line
  // numbers: cat's -n, -b and --number right-aligned before a tab, git blame
  // before the parenthesis that closes each line's note. Both drop the number;
  // cat without a numbering flag, a match with no number where they print it,
  // and a number inside the code a blame match quotes are left alone.
  const catBlame = [
    ['^\\s*2\\t.*console', 'cat -n src/a.js', '^\\s*[0-9]+\\t.*console'],
    ['^     2\\tconsole', "cat -n src/a.js | grep 'console'", '^\\s*[0-9]+\\tconsole'],
    ['^ +2\\s+console', 'cat --number src/a.js', '^\\s*[0-9]+\\s+console'],
    ['2\\tconsole', 'cat -bA src/a.js', '[0-9]+\\tconsole'],
    [' 2\\) console', 'git blame src/a.js', ' [0-9]+\\) console'],
    ['\\s2\\)\\s+console', 'git --no-pager blame -s src/a.js', '\\s[0-9]+\\)\\s+console'],
    ['^2\\tconsole', 'cat src/a.js', '^2\\tconsole'],
    ['^2\\tconsole', 'cat -v src/a.js', '^2\\tconsole'],
    ['console', 'cat -n src/a.js', 'console'],
    ['login\\(1\\)', 'git blame src/a.js', 'login\\(1\\)'],
  ];
  const catBlameWrong = catBlame.filter(([match, check, want]) => inv(match, check) !== JSON.stringify({ noMatch: want }));
  check11('283: a cat -n or git blame receipt drops the line number too',
    catBlameWrong.length === 0,
    catBlameWrong.map(([match, check]) => check + ' -> ' + inv(match, check)).join(' | '));
  // End to end on real cat -n output: the text pushed down a line still fails
  // the recheck, and the fixed file passes it.
  const catVerdict = (name) => {
    const file = path.join(sandbox, 'cat-' + name + '.json');
    fs.writeFileSync(file, JSON.stringify([{ id: 'cat-1', check: 'cat -n src/a.js', expect: mod.invertExpect({ match: '^\\s*2\\tconsole' }, 'cat -n src/a.js') }]));
    const rc = spawnSync(process.execPath, [RUN_CHECKS, '--checks', file, '--out', path.join(sandbox, 'rc-out-cat-' + name)], { cwd: repo3, encoding: 'utf8' });
    let j = null;
    try { j = JSON.parse(rc.stdout); } catch (e) { j = null; }
    return (((j && j.checks) || [])[0] || {}).verdict;
  };
  w3('src/a.js', '// one line added above\nconst token = login();\n' + LOG + '\nexport default token;\n');
  const catMoved = catVerdict('moved');
  w3('src/a.js', 'const token = login();\nexport default token;\n');
  const catFixed = catVerdict('fixed');
  w3('src/a.js', 'const token = login();\n' + LOG + '\nexport default token;\n');
  check11('283: end to end, a cat -n recheck fails on the moved line and passes the fix',
    catMoved === 'fail' && catFixed === 'pass', 'moved: ' + catMoved + ', fixed: ' + catFixed);
  // The same reads by number with the file arriving through a pipe: cat, git
  // show or cat-file of one revision's file, or git blame, into a sed, awk, head
  // or tail that picks lines by number; and git blame or git log with a
  // numbered -L range. A pattern range, a function range, a pipe from a search
  // and git show of a whole commit do not.
  const piped = ["cat -n src/a.js | sed -n '40,45p'", 'cat src/a.js | head -n 12', "git show HEAD:src/a.js | sed -n '12p'",
    'git blame src/a.js | tail -n +12', 'git blame -L 12,15 src/a.js', 'git --no-pager blame -L12,+4 src/a.js', 'git log -L 12,15:src/a.js'];
  const unpiped = ["cat -n src/a.js | grep 'console'", "grep -n 'x' a.md | head -n 1", "git blame -L '/login/,+3' src/a.js",
    'git log -L :login:src/a.js', "cat src/a.js | sed -n '/token/p'", 'git show HEAD | head -n 20'];
  check11('283: a file piped into a pick by number, and git blame or log with a numbered range, read lines by number',
    piped.every(byNumber) && !unpiped.some(byNumber),
    'missed: ' + piped.filter((c) => !byNumber(c)).join(' | ') + '; wrongly caught: ' + unpiped.filter(byNumber).join(' | '));
}

fs.rmSync(sandbox, { recursive: true, force: true });
console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach((f) => console.log('  - ' + f));
process.exit(1);
