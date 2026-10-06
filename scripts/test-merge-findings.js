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

fs.rmSync(sandbox, { recursive: true, force: true });
console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach((f) => console.log('  - ' + f));
process.exit(1);
