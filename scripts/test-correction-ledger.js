#!/usr/bin/env node
'use strict';
//
// test-correction-ledger.js - assertions for .claude/scripts/correction-ledger.js
// and the tripwire entry that guards its data files. (issue #157)
//
// Maintainer-only: lives under scripts/, which the installers never propagate, so
// downstream projects do not inherit it.
//
// Follows the repo's existing dependency-free test convention (see
// scripts/setup/test-installer-guarantees.sh): assert, print, exit non-zero on any
// failure. No test framework, nothing added to .claude/scripts/package.json.
//
// Every test runs against a SANDBOX HOME and a throwaway project directory, so a
// run never reads or writes the real ledger.
//
// Also covered: TK_LEDGER_DIR, which moves the written files but never the
// transcript root (issue #182), and the axial map's lock, temp-and-rename write,
// and refusal to replace a map that does not parse (issue #183).
//
// Usage: node scripts/test-correction-ledger.js

const { execFileSync, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '..', '.claude', 'scripts', 'correction-ledger.js');
const TRIPWIRE = path.resolve(__dirname, '..', '.claude', 'scripts', 'pre-push-check.js');

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' :: ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' :: ' + detail : '')); }
}

// Fresh sandbox per test group: a temp HOME plus a temp project directory.
function makeSandbox(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-' + label + '-'));
  const home = path.join(root, 'home');
  const proj = path.join(root, 'proj');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  return { root: root, home: home, proj: proj };
}

function run(sb, args, opts) {
  const o = opts || {};
  return execFileSync('node', [SCRIPT].concat(args), {
    cwd: o.cwd || sb.proj,
    env: Object.assign({}, process.env, { HOME: sb.home }, o.env || {}),
    encoding: 'utf-8'
  });
}

// Same, but never throws: returns exit status, stdout and stderr together, for
// the checks that read a note the script wrote to stderr on a run that succeeded.
function runRaw(sb, args, opts) {
  const o = opts || {};
  const r = spawnSync('node', [SCRIPT].concat(args), {
    cwd: o.cwd || sb.proj,
    env: Object.assign({}, process.env, { HOME: sb.home }, o.env || {}),
    encoding: 'utf-8'
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function ledgerFile(sb) { return path.join(sb.home, '.claude', 'correction-ledger.jsonl'); }
function isoOrNullTest(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v)); }
function rollupFile(sb) { return path.join(sb.home, '.claude', 'correction-rollup.json'); }

function writeRows(sb, rows) {
  const f = path.join(sb.root, 'rows-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(f, JSON.stringify(rows), 'utf-8');
  return f;
}

// Build a synthetic transcript for the project, including a subagent transcript
// that must never be read.
function seedTranscripts(sb) {
  const encoded = sb.proj.replace(/[/\\]/g, '-');
  const dir = path.join(sb.home, '.claude', 'projects', encoded);
  fs.mkdirSync(path.join(dir, 'subagents'), { recursive: true });

  const asst = function (t) { return JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } }); };
  const user = function (t, ts) { return JSON.stringify({ type: 'user', timestamp: ts, sessionId: 'sess-1', message: { content: t } }); };

  const lines = [
    asst('I added the gitignore entry, that covers it.'),
    // 1. explicit pushback: caught by any filter
    user("That's not right, the file lives outside the repo so gitignore does nothing.", '2026-08-31T10:00:00.000Z'),
    asst('Updated the tripwire.'),
    // 2. procedural: must be excluded
    user('go', '2026-08-31T10:01:00.000Z'),
    asst('Here is the plan.'),
    // 3. substantive question with NO pushback word. This is the regression test:
    //    a positive marker-match filter dropped exactly this shape.
    user('Should we also check the pre-push tripwire for this case?', '2026-08-31T10:02:00.000Z'),
    asst('Done.'),
    // 4. slash-command expansion: machine text, must be excluded
    user('# Update Documentation Task\n**Use this when:** Updating README after changes.', '2026-08-31T10:03:00.000Z'),
    // 5. tool result: harness, not human, must be excluded. The text block matters:
    //    with a tool_result alone the entry is rejected by the empty-string path
    //    underneath, so the assertion could not tell a working guard from a deleted
    //    one. Pairing them makes the guard the only thing that rejects this entry.
    JSON.stringify({ type: 'user', timestamp: '2026-08-31T10:04:00.000Z', message: { content: [
      { type: 'tool_result', content: 'ok' },
      { type: 'text', text: 'TOOL_RESULT_LEAK_MARKER this text rides along with a tool result' }
    ] } }),
    // 6. bare acknowledgment phrase: must be excluded
    user('sounds good, thanks', '2026-08-31T10:05:00.000Z'),
    // 7. a background-task notification. The harness injects these with type
    //    "user", so they look exactly like a human turn. On the first live capture
    //    run 11 of 18 candidates were these.
    user('<task-notification><task-id>abc123</task-id><result>NOTIFICATION_LEAK_MARKER '
       + 'the agent reported that this is not correct and should be undone</result></task-notification>',
       '2026-08-31T10:08:00.000Z'),
    // 8. an IDE event PREPENDED to a real human turn. The event must be stripped
    //    and the human's own words must survive, which is why these are stripped
    //    rather than used to reject the whole entry.
    user('<ide_opened_file>The user opened the file /tmp/x.js in the IDE.</ide_opened_file>'
       + 'IDE_EVENT_SURVIVOR_MARKER actually, do not do it that way',
       '2026-08-31T10:09:00.000Z')
  ];
  fs.writeFileSync(path.join(dir, 'sess-1.jsonl'), lines.join('\n') + '\n', 'utf-8');

  // A subagent transcript whose content would obviously match if it were ever read.
  fs.writeFileSync(path.join(dir, 'subagents', 'agent-x.jsonl'),
    [asst('worker output'), user('That is not correct, SUBAGENT_LEAK_MARKER should never appear.', '2026-08-31T10:06:00.000Z')].join('\n') + '\n',
    'utf-8');
  return dir;
}

// ---------------------------------------------------------------------------
console.log('\ncorrection-ledger.js\n');

// --- 1 + 2. the pre-filter -------------------------------------------------
{
  const sb = makeSandbox('filter');
  seedTranscripts(sb);
  const out = JSON.parse(run(sb, ['--candidates']));
  const said = out.candidates.map(function (c) { return c.human_said; });

  check('pre-filter returns the explicit pushback turn',
    said.some(function (t) { return t.indexOf('gitignore does nothing') !== -1; }));

  check('pre-filter returns a substantive question with no pushback word',
    said.some(function (t) { return t.indexOf('pre-push tripwire for this case') !== -1; }),
    'regression: a positive marker-match filter missed this shape');

  check('pre-filter excludes bare acknowledgments',
    !said.some(function (t) { return t === 'go' || t.indexOf('sounds good') !== -1; }));

  check('pre-filter excludes slash-command expansions',
    !said.some(function (t) { return t.indexOf('**Use this when:**') !== -1; }));

  check('pre-filter excludes tool results even when text rides along',
    JSON.stringify(out).indexOf('TOOL_RESULT_LEAK_MARKER') === -1,
    'the tool_result guard did not reject an entry carrying a text block');

  check('pre-filter excludes harness task notifications',
    JSON.stringify(out).indexOf('NOTIFICATION_LEAK_MARKER') === -1,
    'a background-task notification was offered as a human intervention');

  check('pre-filter keeps the human turn an IDE event was prepended to',
    said.some(function (t) { return t.indexOf('IDE_EVENT_SURVIVOR_MARKER') !== -1; }),
    'stripping the IDE event also discarded what the human actually typed');

  check('pre-filter reads nothing from subagent transcripts',
    JSON.stringify(out).indexOf('SUBAGENT_LEAK_MARKER') === -1,
    'a subagent transcript was read');

  check('pre-filter reports this project has never captured', out.everCaptured === false);
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- 6. empty ledger says WHICH empty --------------------------------------
{
  const sb = makeSandbox('empty');
  const before = JSON.parse(run(sb, ['--show-rollup']));
  check('empty ledger is explicit, not a silent empty body', before.status && before.status.empty === true);
  check('empty ledger with no heartbeat reports never-captured',
    before.status.reason === 'never-captured', JSON.stringify(before.status && before.status.reason));

  run(sb, ['--heartbeat', '--candidate-count', '0', '--added-count', '0']);
  const after = JSON.parse(run(sb, ['--show-rollup']));
  check('empty ledger after a heartbeat reports nothing-found',
    after.status.reason === 'nothing-found', JSON.stringify(after.status && after.status.reason));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- 4 + 5 + 7. rollup counts, kind grouping, privacy ----------------------
{
  const sb = makeSandbox('rollup');
  run(sb, ['--add', '--data', writeRows(sb, [
    { scope: 'toolkit', stage: 'execute', produced: 'x', correction: 'PRIVATE_LEAK_MARKER', open_code: 'trusted prose as a control' },
    { scope: 'toolkit', stage: 'review', produced: 'y', correction: 'z', open_code: 'trusted prose as a control' },
    { scope: 'project', stage: 'explore', produced: 'a', correction: 'b', open_code: 'scoped bigger than asked' }
  ])]);

  const r1 = JSON.parse(run(sb, ['--rollup']));
  check('rollup row count matches the ledger', r1.rows === 3, 'got ' + r1.rows);
  check('rollup groups under a kind', !!r1.kinds.human, Object.keys(r1.kinds).join(','));
  check('rollup total matches within the kind', r1.kinds.human.total === 3);

  const unlabeled = r1.kinds.human.buckets[0];
  check('rollup scope split is correct',
    unlabeled.scope_split.toolkit === 2 && unlabeled.scope_split.project === 1,
    JSON.stringify(unlabeled.scope_split));

  check('rollup file contains no private-layer content',
    fs.readFileSync(rollupFile(sb), 'utf-8').indexOf('PRIVATE_LEAK_MARKER') === -1,
    'a private field reached the rollup');
  check('the ledger itself does hold the private field (control)',
    fs.readFileSync(ledgerFile(sb), 'utf-8').indexOf('PRIVATE_LEAK_MARKER') !== -1);

  // Axial map is joined at rollup time; the ledger is never rewritten.
  fs.writeFileSync(path.join(sb.home, '.claude', 'correction-axial-map.json'),
    JSON.stringify({ 'trusted prose as a control': 'enforcement gaps' }), 'utf-8');
  const r2 = JSON.parse(run(sb, ['--rollup']));
  const named = r2.kinds.human.buckets.filter(function (b) { return b.axial_code === 'enforcement gaps'; })[0];
  check('axial map is joined without rewriting the ledger', !!named && named.count === 2,
    named ? String(named.count) : 'bucket missing');

  // Seed a second synthetic kind directly, to prove the guarantee before a real
  // second kind exists.
  fs.appendFileSync(ledgerFile(sb), JSON.stringify({
    at: '2026-08-31T11:00:00.000Z', repo: 'other', kind: 'synthetic', scope: 'toolkit',
    stage: 'review', produced: '', correction: '', open_code: 'machine finding', axial_code: null
  }) + '\n', 'utf-8');
  const r3 = JSON.parse(run(sb, ['--rollup']));
  check('rollup separates kinds instead of pooling them',
    !!r3.kinds.human && !!r3.kinds.synthetic && r3.kinds.human.total === 3 && r3.kinds.synthetic.total === 1,
    JSON.stringify(Object.keys(r3.kinds)));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- 8. per-repo opt-out writes NOTHING ------------------------------------
{
  const sb = makeSandbox('optout');
  fs.writeFileSync(path.join(sb.proj, '.claude', '.no-correction-log'), '', 'utf-8');
  const rows = writeRows(sb, [{ scope: 'toolkit', stage: 'execute', produced: 'p', correction: 'c', open_code: 'should never be written' }]);
  const out = JSON.parse(run(sb, ['--add', '--data', rows]));
  check('opt-out reports zero added', out.added === 0 && out.optedOut === true, JSON.stringify(out));
  check('opt-out writes no ledger file at all, not a redacted row',
    !fs.existsSync(ledgerFile(sb)), 'a ledger file was created');

  run(sb, ['--heartbeat']);
  check('opt-out suppresses the heartbeat too',
    !fs.existsSync(path.join(sb.home, '.claude', 'correction-heartbeat.jsonl')));

  const cand = JSON.parse(run(sb, ['--candidates']));
  check('opt-out is reported by --candidates so a caller can say why', cand.optedOut === true);
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- privacy: the truncation cap is a named structural protection ----------
{
  const sb = makeSandbox('caps');
  const long = 'X'.repeat(2000);
  run(sb, ['--add', '--data', writeRows(sb, [
    { scope: 'toolkit', stage: 'execute', produced: long, correction: long, open_code: 'Y'.repeat(2000) }
  ])]);
  const row = JSON.parse(fs.readFileSync(ledgerFile(sb), 'utf-8').split('\n')[0]);
  check('produced is truncated to the private-field cap', row.produced.length <= 300, String(row.produced.length));
  check('correction is truncated to the private-field cap', row.correction.length <= 300, String(row.correction.length));
  check('a truncated field is marked as truncated', /\.\.\.$/.test(row.produced));
  check('open_code is truncated to its own cap', row.open_code.length <= 400, String(row.open_code.length));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- the `at` field is validated, not trusted ------------------------------
{
  const sb = makeSandbox('at');
  run(sb, ['--add', '--data', writeRows(sb, [
    { scope: 'toolkit', stage: 'execute', at: 'AT_FIELD_LEAK_MARKER not a timestamp', open_code: 'a' },
    { scope: 'toolkit', stage: 'execute', at: '2026-01-01T09:00:00.000Z', open_code: 'b' }
  ])]);
  const raw = fs.readFileSync(ledgerFile(sb), 'utf-8');
  check('a non-timestamp `at` is rejected, not stored',
    raw.indexOf('AT_FIELD_LEAK_MARKER') === -1,
    'free text in `at` reached the ledger, and `at` is on the shareable whitelist');
  check('a valid `at` is preserved', raw.indexOf('2026-01-01T09:00:00.000Z') !== -1);
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- the rollup window is computed, not assumed ----------------------------
{
  const sb = makeSandbox('window');
  run(sb, ['--add', '--data', writeRows(sb, [{ scope: 'toolkit', at: '2026-08-31T11:00:00.000Z', open_code: 'later row first' }])]);
  run(sb, ['--add', '--data', writeRows(sb, [{ scope: 'toolkit', at: '2026-01-01T09:00:00.000Z', open_code: 'earlier row second' }])]);
  const r = JSON.parse(run(sb, ['--show-rollup']));
  check('rollup window is not backwards when rows arrive out of order',
    r.window.from < r.window.to, r.window.from + ' -> ' + r.window.to);
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- the rollup surfaces open codes, which axial coding needs ---------------
{
  const sb = makeSandbox('opencodes');
  run(sb, ['--add', '--data', writeRows(sb, [
    { scope: 'toolkit', open_code: 'trusted prose as a control' },
    { scope: 'project', open_code: 'trusted prose as a control' },
    { scope: 'project', open_code: 'scoped bigger than asked' }
  ])]);
  const r = JSON.parse(run(sb, ['--show-rollup']));
  const codes = r.kinds.human.buckets[0].open_codes;
  check('rollup carries the open codes themselves', Array.isArray(codes) && codes.length === 2, JSON.stringify(codes));
  check('open codes carry their own counts, most frequent first',
    codes[0].open_code === 'trusted prose as a control' && codes[0].count === 2,
    JSON.stringify(codes[0]));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- the rollup counts by month (issue #231) --------------------------------
// A group's share of its kind, month by month, is how the error analysis sees
// whether a change moved anything, so the rollup carries both numbers: each
// group's count per month (by_month) and each kind's total per month (months),
// from the row's own date. --add always stamps a date, so the one row with
// none, which counts under "unknown", is written straight into the ledger.
{
  const sb = makeSandbox('months');
  run(sb, ['--add', '--data', writeRows(sb, [
    { scope: 'toolkit', at: '2026-08-14T10:00:00.000Z', open_code: 'missed a case' },
    { scope: 'toolkit', at: '2026-09-02T10:00:00.000Z', open_code: 'missed a case' },
    { scope: 'project', at: '2026-09-20T10:00:00.000Z', open_code: 'missed a case' }
  ])]);
  fs.appendFileSync(ledgerFile(sb), JSON.stringify({ kind: 'human', repo: 'month-test', scope: 'project', open_code: 'missed a case' }) + '\n');
  const r = JSON.parse(run(sb, ['--show-rollup']));
  const human = r.kinds && r.kinds.human;
  const want = JSON.stringify({ '2026-08': 1, '2026-09': 2, unknown: 1 });
  check('the rollup counts each group by month',
    !!human && human.buckets.length === 1 && JSON.stringify(human.buckets[0].by_month) === want,
    JSON.stringify(human && human.buckets.map(function (b) { return b.by_month; })));
  check('the rollup totals each kind by month',
    !!human && JSON.stringify(human.months) === want && human.total === 4,
    JSON.stringify(human && { months: human.months, total: human.total }));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- --add is all-or-nothing -----------------------------------------------
{
  const sb = makeSandbox('atomic');
  run(sb, ['--add', '--data', writeRows(sb, [{ scope: 'toolkit', open_code: 'a good row' }])]);
  const before = fs.readFileSync(ledgerFile(sb), 'utf-8').split('\n').filter(Boolean).length;
  let failed = false;
  try {
    run(sb, ['--add', '--data', writeRows(sb, [
      { scope: 'toolkit', open_code: 'ATOMIC_LEAK_MARKER should not land' },
      { scope: 'toolkit', produced: 'this row has no open_code' }
    ])]);
  } catch (e) { failed = true; }
  const after = fs.readFileSync(ledgerFile(sb), 'utf-8');
  check('an invalid batch exits non-zero', failed);
  check('an invalid batch writes nothing at all',
    after.split('\n').filter(Boolean).length === before && after.indexOf('ATOMIC_LEAK_MARKER') === -1,
    'a partial batch landed, so a corrected re-run would double-count it');
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- two projects sharing a folder name stay separate -----------------------
{
  const sb = makeSandbox('identity');
  const a = path.join(sb.root, 'work', 'api');
  const b = path.join(sb.root, 'personal', 'api');
  fs.mkdirSync(path.join(a, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(b, '.claude'), { recursive: true });
  run(sb, ['--heartbeat', '--candidate-count', '3', '--added-count', '2'], { cwd: a });
  const inB = JSON.parse(run(sb, ['--candidates'], { cwd: b }));
  check('a same-named sibling project does not inherit the heartbeat',
    inB.everCaptured === false,
    'one project read another project\'s capture window because identity is the folder name');
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- a failed scan is distinguishable from an empty one ---------------------
{
  const sb = makeSandbox('scanned');
  const out = JSON.parse(run(sb, ['--candidates']));
  check('--candidates reports whether it had anything to scan',
    out.scanned === false && out.candidates.length === 0,
    'no transcript directory exists for this sandbox, so scanned must be false');
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- non-Latin scripts are not discarded as acknowledgments -----------------
{
  const sb = makeSandbox('unicode');
  const dir = seedTranscripts(sb);
  const asst = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } });
  const user = JSON.stringify({ type: 'user', timestamp: '2026-08-31T10:07:00.000Z', sessionId: 'sess-2',
    message: { content: 'UNICODE_MARKER यह गलत है, कृपया इसे वापस लें और दूसरा तरीका आजमाएं' } });
  fs.writeFileSync(path.join(dir, 'sess-2.jsonl'), asst + '\n' + user + '\n', 'utf-8');
  const out = JSON.parse(run(sb, ['--candidates', '--since', '2026-08-31T00:00:00.000Z']));
  check('a correction in a non-Latin script is not dropped as procedural',
    JSON.stringify(out).indexOf('UNICODE_MARKER') !== -1,
    'stripping non-ASCII emptied the word list and the message was called an acknowledgment');
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- a project whose own path contains "subagents" still captures -----------
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-subagents-lab-'));
  const sb = { root: root, home: path.join(root, 'home'), proj: path.join(root, 'subagents-lab') };
  fs.mkdirSync(sb.home, { recursive: true });
  fs.mkdirSync(path.join(sb.proj, '.claude'), { recursive: true });
  seedTranscripts(sb);
  const out = JSON.parse(run(sb, ['--candidates']));
  check('a project whose path contains "subagents" is not silently zeroed',
    out.candidates.length > 0,
    'the exclusion matched the project\'s own directory name and dropped every file');
  fs.rmSync(root, { recursive: true, force: true });
}

// --- issue #220: an interrupt points at the message typed after it -----------
// Built from the entry shapes a real transcript uses (the marker as a text
// block, queue-operation lines, a task notification between two markers), with
// made-up text only. Each scenario gets its own sandbox, because the cross-file
// link would otherwise pair one scenario's interrupt with another's message.
{
  const BASE = Date.parse('2026-09-01T10:00:00.000Z');
  const at = function (sec) { return new Date(BASE + sec * 1000).toISOString(); };
  const asstE = function (t, sec) { return { type: 'assistant', timestamp: at(sec), message: { content: [{ type: 'text', text: t }] } }; };
  const userE = function (content, sec, sid) { return { type: 'user', timestamp: at(sec), sessionId: sid, message: { content: content } }; };
  const markE = function (sec, sid, forTool) {
    return userE([{ type: 'text', text: forTool ? '[Request interrupted by user for tool use]' : '[Request interrupted by user]' }], sec, sid);
  };
  const queueE = function (sec, op) { return { type: 'queue-operation', operation: op, timestamp: at(sec) }; };

  // sessions: { sessionId: [entries] }. Scans from --since so every file is read.
  function scenario(label, sessions, opts) {
    const sb = makeSandbox('int-' + label);
    const dir = path.join(sb.home, '.claude', 'projects', sb.proj.replace(/[/\\]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    Object.keys(sessions).forEach(function (sid) {
      fs.writeFileSync(path.join(dir, sid + '.jsonl'),
        sessions[sid].map(function (e) { return JSON.stringify(e); }).join('\n') + '\n', 'utf-8');
    });
    const out = JSON.parse(run(sb, ['--candidates', '--since', (opts && opts.since) || '2026-09-01T00:00:00.000Z']));
    fs.rmSync(sb.root, { recursive: true, force: true });
    return out;
  }
  const isMarker = function (c) { return /^\[Request interrupted by user/.test(c.human_said || ''); };
  const said = function (out, marker) { return out.candidates.filter(function (c) { return (c.human_said || '').indexOf(marker) !== -1; }); };

  // (a) same file: the follow-up carries the interrupted turn, the marker is gone
  const a = scenario('same', { s1: [asstE('INTERRUPTED_A rewriting the whole parser now', 0), markE(5, 's1'),
    queueE(6, 'enqueue'), queueE(6, 'dequeue'), userE('FOLLOWUP_A read the full file before changing it', 10, 's1')] });
  const fa = said(a, 'FOLLOWUP_A')[0];
  check('the bare interrupt marker is never a candidate (#220)',
    a.candidates.length > 0 && !a.candidates.some(isMarker), JSON.stringify(a.candidates.map(function (c) { return c.human_said; })));
  check('the message after an interrupt is tagged and paired with the interrupted turn (#220)',
    fa && fa.after_interrupt === true && fa.assistant_said.indexOf('INTERRUPTED_A') !== -1, JSON.stringify(fa));

  // (b) a short, procedural follow-up is the correction itself
  const b = scenario('short', { s1: [asstE('INTERRUPTED_B deleting the old tests', 0), markE(3, 's1'), userE('no', 8, 's1')] });
  check('a short procedural follow-up ("no") is still a candidate after an interrupt (#220)',
    b.candidates.length === 1 && b.candidates[0].human_said === 'no' && b.candidates[0].after_interrupt === true,
    JSON.stringify(b.candidates));

  // (c) the downstream shape: marker, task notification, marker two seconds later
  const c = scenario('double', { s1: [asstE('INTERRUPTED_C skimming the config', 0), queueE(4, 'enqueue'), markE(5, 's1'),
    queueE(5, 'dequeue'),
    userE('<task-notification><task-id>t1</task-id><result>NOTIFY_C the worker finished</result></task-notification>', 5, 's1'),
    markE(7, 's1'), userE('FOLLOWUP_C use the other approach instead', 30, 's1')] });
  check('a double marker around a task notification gives one tagged follow-up and nothing else (#220)',
    c.candidates.length === 1 && said(c, 'FOLLOWUP_C').length === 1 && c.candidates[0].after_interrupt === true &&
    c.interruptsWithoutFollowUp === 0, JSON.stringify(c));

  // (d) the tool-use wording of the marker
  const d = scenario('tooluse', { s1: [asstE('INTERRUPTED_D running the migration', 0), markE(2, 's1', true),
    userE('FOLLOWUP_D do not touch the database', 9, 's1')] });
  check('the "for tool use" marker behaves like the plain one (#220)',
    !d.candidates.some(isMarker) && said(d, 'FOLLOWUP_D').length === 1 && said(d, 'FOLLOWUP_D')[0].after_interrupt === true,
    JSON.stringify(d.candidates));

  // (e) the session ends at the interrupt; the next one opens 9 seconds later
  const e = scenario('cross', { s1: [asstE('INTERRUPTED_E summarizing the log', 0), markE(5, 's1')],
    s2: [userE('FOLLOWUP_E read it in full this time', 14, 's2')] });
  const fe = said(e, 'FOLLOWUP_E');
  check('a follow-up in the next session file links to the interrupt (#220)',
    fe.length === 1 && fe[0].after_interrupt === true && fe[0].session === 's2' &&
    fe[0].assistant_said.indexOf('INTERRUPTED_E') !== -1 && e.interruptsWithoutFollowUp === 0, JSON.stringify(e));

  // (f) too late to be the same thought
  const f = scenario('late', { s1: [asstE('INTERRUPTED_F renaming the module', 0), markE(5, 's1')],
    s2: [userE('FOLLOWUP_F start the next feature please', 5 + 11 * 60, 's2')] });
  const ff = said(f, 'FOLLOWUP_F');
  check('a message 11 minutes later in another session is not linked, and the interrupt is counted (#220)',
    ff.length === 1 && ff[0].after_interrupt === false && f.interruptsWithoutFollowUp === 1, JSON.stringify(f));

  // (g) nothing follows at all
  const g = scenario('none', { s1: [asstE('INTERRUPTED_G formatting the tables', 0), markE(5, 's1')] });
  check('an interrupt with no follow-up anywhere gives no candidate and is counted (#220)',
    g.candidates.length === 0 && g.interruptsWithoutFollowUp === 1, JSON.stringify(g));

  // (h) a marker before the window is neither emitted nor counted
  const h = scenario('before', { s1: [asstE('INTERRUPTED_H old work', 0), markE(5, 's1')] },
    { since: '2026-09-01T11:00:00.000Z' });
  check('a marker before --since is neither a candidate nor counted (#220)',
    h.candidates.length === 0 && h.interruptsWithoutFollowUp === 0, JSON.stringify(h));

  // (i) a slash command right after an interrupt: the human's next words went
  // into the command, which this scan cannot read, so the interrupt is counted
  // as having no follow-up (owner's decision in the review of the #220 cycle, R6)
  const i = scenario('expansion', { s1: [asstE('INTERRUPTED_I adding a cache layer', 0), markE(5, 's1'),
    userE('# Explore\n**Use this when:** Starting a new feature.', 8, 's1'),
    userE('FOLLOWUP_I keep the old name for the cache', 20, 's1')] });
  check('a command expansion right after an interrupt counts it as having no follow-up (#220)',
    said(i, 'FOLLOWUP_I').length === 1 && said(i, 'FOLLOWUP_I')[0].after_interrupt === false &&
    i.interruptsWithoutFollowUp === 1, JSON.stringify(i));

  // (i2) the command invocation itself, whose tags strip to nothing
  const i2 = scenario('invocation', { s1: [asstE('INTERRUPTED_I2 renaming the module', 0), markE(5, 's1'),
    userE('<command-message>explore</command-message> <command-name>/explore</command-name> <command-args>keep the old name</command-args>', 8, 's1'),
    userE('FOLLOWUP_I2 and update the docs too', 20, 's1')] });
  check('a slash command invocation right after an interrupt counts it as having no follow-up (#220)',
    said(i2, 'FOLLOWUP_I2').length === 1 && said(i2, 'FOLLOWUP_I2')[0].after_interrupt === false &&
    i2.interruptsWithoutFollowUp === 1, JSON.stringify(i2));

  // (i3) the wait inside a session is capped at the same ten minutes as across sessions
  const i3 = scenario('samelate', { s1: [asstE('INTERRUPTED_I3 sorting the imports', 0), markE(5, 's1'),
    userE('FOLLOWUP_I3 next task: the footer', 5 + 11 * 60, 's1')] });
  check('a message 11 minutes after an interrupt in the same session is not its follow-up (#220)',
    said(i3, 'FOLLOWUP_I3').length === 1 && said(i3, 'FOLLOWUP_I3')[0].after_interrupt === false &&
    i3.interruptsWithoutFollowUp === 1, JSON.stringify(i3));

  // (i4) the next session opens with a slash command
  const i4 = scenario('crosscmd', { s1: [asstE('INTERRUPTED_I4 rewriting the intro', 0), markE(5, 's1')],
    s2: [userE('<command-name>/explore</command-name> <command-args>read it in full</command-args>', 14, 's2'),
      userE('FOLLOWUP_I4 also check the footer', 30, 's2')] });
  check('a next session that opens with a slash command counts the interrupt as having no follow-up (#220)',
    said(i4, 'FOLLOWUP_I4').every(function (c) { return c.after_interrupt === false; }) &&
    i4.interruptsWithoutFollowUp === 1, JSON.stringify(i4));

  // (j) two sessions end on an interrupt; one later message can answer only one
  const j = scenario('claim', { s1: [asstE('INTERRUPTED_J1 first turn', 0), markE(5, 's1')],
    s2: [asstE('INTERRUPTED_J2 second turn', 2), markE(6, 's2')],
    s3: [userE('FOLLOWUP_J use the smaller fixture', 12, 's3')] });
  const fj = said(j, 'FOLLOWUP_J');
  check('a follow-up is claimed once, by the earliest interrupt, and the other is counted (#220)',
    fj.length === 1 && fj[0].assistant_said.indexOf('INTERRUPTED_J1') !== -1 && j.interruptsWithoutFollowUp === 1,
    JSON.stringify(j));

  // (j2) a session running side by side is not the next session: its
  // mid-session message keeps its own context (review of the #220 cycle, R2)
  const j2 = scenario('parallel', { s1: [userE('FIRST_P start the report', 0, 's1'), asstE('OWN_TURN_P drafting section two', 50),
    userE('MID_P shorten section two please', 110, 's1')],
    s2: [asstE('INTERRUPTED_P migrating the store', 90), markE(100, 's2')] });
  const fp = said(j2, 'MID_P');
  check('a mid-session message in a parallel session is not taken as the follow-up (#220)',
    fp.length === 1 && fp[0].after_interrupt === false && fp[0].assistant_said.indexOf('OWN_TURN_P') !== -1 &&
    j2.interruptsWithoutFollowUp === 1, JSON.stringify(j2));

  // (k) the count is on every result shape
  const sbN = makeSandbox('int-noscan');
  const noScan = JSON.parse(run(sbN, ['--candidates']));
  fs.rmSync(sbN.root, { recursive: true, force: true });
  const sbO = makeSandbox('int-optout');
  fs.writeFileSync(path.join(sbO.proj, '.claude', '.no-correction-log'), '', 'utf-8');
  const optOut = JSON.parse(run(sbO, ['--candidates']));
  fs.rmSync(sbO.root, { recursive: true, force: true });
  check('interruptsWithoutFollowUp is 0 on the not-scanned and opted-out results (#220)',
    noScan.scanned === false && noScan.interruptsWithoutFollowUp === 0 &&
    optOut.optedOut === true && optOut.interruptsWithoutFollowUp === 0, JSON.stringify([noScan, optOut]));
}

// --- issue #230: messages Claude Code stamps as machine-sent are never candidates ---
// Real transcripts stamp each user entry with its sender. The stamp fields below
// are the ones real files carry (observed 2026-10-12), with made-up text only: a
// subagent's report (origin peer, isMeta too), a skill's text as it loads
// (isMeta with the Skill call's sourceToolUseID), another meta note, a
// compaction summary, a task notice whose text has no tag wrapper, and a turn
// stamped by turnOrigin alone. Every text passes the length gate and carries a
// pushback word, so the stamp is the only thing that can keep it out.
{
  const BASE = Date.parse('2026-10-01T10:00:00.000Z');
  const at = function (sec) { return new Date(BASE + sec * 1000).toISOString(); };
  const asstE = function (t, sec) { return { type: 'assistant', timestamp: at(sec), message: { content: [{ type: 'text', text: t }] } }; };
  const userE = function (text, sec, sid, stamp) {
    return Object.assign({ type: 'user', timestamp: at(sec), sessionId: sid, message: { content: [{ type: 'text', text: text }] } }, stamp || {});
  };
  const markE = function (sec, sid) { return userE('[Request interrupted by user]', sec, sid); };
  const HUMAN = { origin: { kind: 'human' }, promptSource: 'sdk', turnOrigin: 'human' };
  const PEER = { isMeta: true, origin: { kind: 'peer', from: 'a0123456789abcdef', senderTaskId: 'a0123456789abcdef' }, promptSource: 'system', turnOrigin: 'peer' };
  const SKILL = { isMeta: true, sourceToolUseID: 'toolu_01EXAMPLE', turnCompanion: true };
  const META = { isMeta: true };
  const COMPACT = { isCompactSummary: true, isVisibleInTranscriptOnly: true, turnOrigin: 'human' };
  const TASK = { origin: { kind: 'task-notification', producer: 'session-task' }, promptSource: 'system', turnOrigin: 'task_notification' };
  function scan(label, sessions) {
    const sb = makeSandbox('stamp-' + label);
    const dir = path.join(sb.home, '.claude', 'projects', sb.proj.replace(/[/\\]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    Object.keys(sessions).forEach(function (sid) {
      fs.writeFileSync(path.join(dir, sid + '.jsonl'),
        sessions[sid].map(function (e) { return JSON.stringify(e); }).join('\n') + '\n', 'utf-8');
    });
    const out = JSON.parse(run(sb, ['--candidates', '--since', '2026-10-01T00:00:00.000Z']));
    fs.rmSync(sb.root, { recursive: true, force: true });
    return out;
  }
  const said = function (out, marker) { return out.candidates.filter(function (c) { return (c.human_said || '').indexOf(marker) !== -1; }); };
  const opening = function (out) { return JSON.stringify(out.candidates.map(function (c) { return c.human_said.slice(0, 40); })); };

  const machine = scan('machine', { s1: [asstE('Dispatching the reviewers now.', 0),
    userE('PEER_STAMP_MARKER the reviewer reports that this is not correct and should be undone', 10, 's1', PEER),
    userE('SKILL_STAMP_MARKER Base directory for this skill: actually, do not run it this way', 20, 's1', SKILL),
    userE('META_STAMP_MARKER [Image: original 1100x3637, displayed at 605x2000] that is wrong', 30, 's1', META),
    userE('COMPACT_STAMP_MARKER This session is being continued from a previous conversation; do not repeat it', 40, 's1', COMPACT),
    userE('TASK_STAMP_MARKER background task finished: the agent says that is not right', 50, 's1', TASK),
    userE('TURN_PEER_STAMP_MARKER a peer turn with no origin field says this is wrong', 60, 's1', { turnOrigin: 'peer' })] });
  check('no message stamped as machine-sent is a candidate: a subagent report, a skill load, a meta note, a compaction summary, a task notice, a peer turn (#230)',
    machine.candidates.length === 0, opening(machine));

  const kept = scan('kept', { s1: [asstE('Here is the draft.', 0),
    userE('HUMAN_STAMP_MARKER that is not what I asked for, use the short version', 10, 's1', HUMAN),
    userE('UNSTAMPED_MARKER an older transcript with no stamp at all, please redo it', 20, 's1'),
    userE('VOICE_STAMP_MARKER a sender kind this scan does not know yet, keep the old name', 30, 's1', { origin: { kind: 'voice' } }),
    userE('SDK_TURN_MARKER a turn stamped sdk with no origin, do not merge it yet', 40, 's1', { promptSource: 'sdk', turnOrigin: 'sdk' })] });
  check('a human-stamped message, an unstamped one and unknown stamps all stay candidates: only the known machine stamps are dropped (#230)',
    kept.candidates.length === 4 && ['HUMAN_STAMP_MARKER', 'UNSTAMPED_MARKER', 'VOICE_STAMP_MARKER', 'SDK_TURN_MARKER'].every(function (m) { return said(kept, m).length === 1; }),
    opening(kept));

  // A subagent's report that lands between the interrupt and the human's
  // reply is not the reply: before #230 it took the interrupt, and the human's
  // "no" was then dropped as a bare acknowledgment.
  const inter = scan('interrupt', { s1: [asstE('INTERRUPTED_S rewriting the parser', 0), markE(5, 's1'),
    userE('PEER_AFTER_MARKER the background reviewer finished and reports no blockers at all', 8, 's1', PEER),
    userE('no', 12, 's1', HUMAN)] });
  check('after an interrupt a subagent report is skipped, and the human\'s "no" is the tagged follow-up (#230)',
    inter.candidates.length === 1 && inter.candidates[0].human_said === 'no' && inter.candidates[0].after_interrupt === true &&
    inter.candidates[0].assistant_said.indexOf('INTERRUPTED_S') !== -1 && inter.interruptsWithoutFollowUp === 0, JSON.stringify(inter));

  // A session that ends at the interrupt, and a next session whose first entry
  // is a skill loading: the human's first words there are the opener.
  const cross = scan('cross', { s1: [asstE('INTERRUPTED_X summarizing the log', 0), markE(5, 's1')],
    s2: [userE('SKILL_OPENER_MARKER Base directory for this skill: this is not the reply', 9, 's2', SKILL),
      userE('FOLLOWUP_X read it in full this time', 14, 's2', HUMAN)] });
  const fx = said(cross, 'FOLLOWUP_X');
  check('a stamped machine entry opening the next session does not take an earlier interrupt; the human\'s first words do (#230)',
    fx.length === 1 && fx[0].after_interrupt === true && fx[0].assistant_said.indexOf('INTERRUPTED_X') !== -1 &&
    said(cross, 'SKILL_OPENER_MARKER').length === 0 && cross.interruptsWithoutFollowUp === 0, JSON.stringify(cross));
}

// --- issue #235: messages typed while Claude works are read like any other ---
// A message typed while Claude is still working is not stored as a user entry.
// The transcript records it as an attachment of type queued_command, and the
// sender stamp sits INSIDE the attachment, not on the entry. The shape below is
// the one real files carry (observed 2026-10-13, across this machine's
// top-level transcripts: 2,132 such entries, of them 93 stamped human, 1,087
// peer with isMeta, 546 task-notification, 405 unstamped task notices wrapped
// in their tags and 1 unstamped prompt; 86 of the 93 human prompts are lists
// of text blocks, the rest strings; none of the 93 is also stored as a user
// entry), with made-up text only. Each machine-sent fixture can be dropped by
// exactly one code path: its text has no tags, passes the length gate and
// holds a pushback word, so only its one stamp field can keep it out. The
// tagged notice carries no stamp, so only the tag strip can drop it, and the
// short message is stamped human, so only the length gate can.
{
  const BASE = Date.parse('2026-10-01T12:00:00.000Z');
  const at = function (sec) { return new Date(BASE + sec * 1000).toISOString(); };
  const asstE = function (t, sec) { return { type: 'assistant', timestamp: at(sec), message: { content: [{ type: 'text', text: t }] } }; };
  const userE = function (text, sec, sid) {
    return { type: 'user', timestamp: at(sec), sessionId: sid, origin: { kind: 'human' }, message: { content: [{ type: 'text', text: text }] } };
  };
  const queuedE = function (prompt, sec, sid, fields) {
    return { type: 'attachment', timestamp: at(sec), sessionId: sid,
      attachment: Object.assign({ type: 'queued_command', prompt: prompt, commandMode: 'prompt' }, fields || {}) };
  };
  const HUMAN = { origin: { kind: 'human' } };
  function scan(label, sessions) {
    const sb = makeSandbox('queued-' + label);
    const dir = path.join(sb.home, '.claude', 'projects', sb.proj.replace(/[/\\]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    Object.keys(sessions).forEach(function (sid) {
      fs.writeFileSync(path.join(dir, sid + '.jsonl'),
        sessions[sid].map(function (e) { return JSON.stringify(e); }).join('\n') + '\n', 'utf-8');
    });
    const out = JSON.parse(run(sb, ['--candidates', '--since', '2026-10-01T00:00:00.000Z']));
    fs.rmSync(sb.root, { recursive: true, force: true });
    return out;
  }
  const said = function (out, marker) { return out.candidates.filter(function (c) { return (c.human_said || '').indexOf(marker) !== -1; }); };
  const opening = function (out) { return JSON.stringify(out.candidates.map(function (c) { return c.human_said.slice(0, 40); })); };
  const fields = function (c) { return c ? JSON.stringify({ asked: c.asked.slice(0, 40), said: c.assistant_said.slice(0, 40) }) : 'no candidate'; };

  const typed = scan('typed', { s1: [asstE('FIRST_OUTPUT_Q drafting the outline', 0),
    userE('REQUEST_Q please make the outline shorter and cut the intro', 10, 's1'),
    asstE('SECOND_OUTPUT_Q rewriting the outline now', 20),
    queuedE([{ type: 'text', text: 'BLOCKS_Q actually keep the intro,' }, { type: 'text', text: 'just trim the examples instead' }], 25, 's1', HUMAN),
    queuedE('STRING_Q and do not touch the summary section either', 30, 's1', HUMAN),
    asstE('THIRD_OUTPUT_Q trimmed the examples and left the summary', 40),
    userE('NEXT_TYPED_Q that is not what I meant, the examples were fine', 50, 's1')] });
  const blocks = said(typed, 'BLOCKS_Q')[0];
  const next = said(typed, 'NEXT_TYPED_Q')[0];
  check('a message typed while Claude works is a candidate, from text blocks or a plain string (#235)',
    !!blocks && blocks.human_said.indexOf('just trim the examples') !== -1 && said(typed, 'STRING_Q').length === 1,
    opening(typed));
  check('a typed-while-working candidate carries the output and the ask before it (#235)',
    !!blocks && blocks.assistant_said.indexOf('SECOND_OUTPUT_Q') !== -1 && blocks.asked.indexOf('REQUEST_Q') !== -1,
    fields(blocks));
  check('the next typed message carries the queued message as its ask (#235)',
    !!next && next.asked.indexOf('STRING_Q') !== -1 && next.assistant_said.indexOf('THIRD_OUTPUT_Q') !== -1,
    fields(next));

  const unstamped = scan('unstamped', { s1: [asstE('Here is the table.', 0),
    queuedE('UNSTAMPED_Q a build with no sender stamp here, please redo the table', 10, 's1')] });
  check('a queued message with no sender stamp stays a candidate (#235)',
    said(unstamped, 'UNSTAMPED_Q').length === 1, opening(unstamped));

  const machine = scan('machine', { s1: [asstE('Dispatching the reviewers now.', 0),
    queuedE('PEER_Q the reviewer reports that this is not correct and should be undone', 10, 's1', { origin: { kind: 'peer' } }),
    queuedE('META_Q a harness note saying that this is wrong and should be redone', 20, 's1', { isMeta: true }),
    queuedE('TASKSTAMP_Q background task finished: the agent says that is not right', 30, 's1',
      { origin: { kind: 'task-notification' }, commandMode: 'task-notification' }),
    queuedE('<task-notification>TASKTAG_Q the task finished and says this is wrong</task-notification>', 40, 's1',
      { commandMode: 'task-notification' })] });
  check('no queued message stamped or tagged as machine-sent is a candidate (#235)',
    machine.candidates.length === 0, opening(machine));

  const short = scan('short', { s1: [asstE('Rewriting the parser.', 0), queuedE('stop that', 10, 's1', HUMAN)] });
  check('a short queued message meets the same length gate as any other (#235)',
    short.candidates.length === 0, opening(short));

  // A queued message can also be the reply to an interrupt: the old-against-new
  // run on this repo's transcripts on 2026-10-13 found one, a short reply that
  // only the follow-up path keeps (it skips the length gate). The marker carries
  // no stamp, as real interrupt markers do.
  const inter = scan('interrupt', { s1: [asstE('INTERRUPTED_Q rewriting the parser', 0),
    { type: 'user', timestamp: at(5), sessionId: 's1', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
    queuedE('no', 8, 's1', HUMAN)] });
  const reply = inter.candidates[0];
  check('a short queued reply to an interrupt is its tagged follow-up (#235)',
    inter.candidates.length === 1 && !!reply && reply.human_said === 'no' && reply.after_interrupt === true &&
    reply.assistant_said.indexOf('INTERRUPTED_Q') !== -1 && inter.interruptsWithoutFollowUp === 0,
    opening(inter) + ' interrupts=' + inter.interruptsWithoutFollowUp);
}

// --- the axial map merges instead of overwriting ----------------------------
{
  const sb = makeSandbox('axial');
  const f1 = path.join(sb.root, 'm1.json');
  const f2 = path.join(sb.root, 'm2.json');
  fs.writeFileSync(f1, JSON.stringify({ 'first code': 'category A' }), 'utf-8');
  fs.writeFileSync(f2, JSON.stringify({ 'second code': 'category B' }), 'utf-8');
  run(sb, ['--set-axial', '--data', f1]);
  const res = JSON.parse(run(sb, ['--set-axial', '--data', f2]));
  const map = JSON.parse(fs.readFileSync(path.join(sb.home, '.claude', 'correction-axial-map.json'), 'utf-8'));
  check('a second axial pass keeps the first pass assignments',
    map['first code'] === 'category A' && map['second code'] === 'category B',
    JSON.stringify(map));
  check('--set-axial reports what it merged', res.existing === 1 && res.incoming === 1 && res.total === 2,
    JSON.stringify(res));
  check('--set-axial removes the temp file it consumed', !fs.existsSync(f2));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// Start several node processes at the same moment and wait for all of them. One
// launcher process spawns them together and prints their exit codes, so a
// concurrency test still reads top to bottom like the rest of this file. Each job
// is an argument list for node; the jobs share the launcher's cwd and environment.
function runTogether(sb, jobs, env) {
  const launcher = [
    "const { spawn } = require('child_process');",
    'const jobs = JSON.parse(process.argv[1]);',
    'const codes = new Array(jobs.length);',
    'let left = jobs.length;',
    'jobs.forEach(function (args, i) {',
    "  const p = spawn(process.execPath, args, { stdio: 'ignore' });",
    "  p.on('close', function (code) { codes[i] = code; if (--left === 0) process.stdout.write(JSON.stringify(codes)); });",
    '});'
  ].join('\n');
  const r = spawnSync(process.execPath, ['-e', launcher, JSON.stringify(jobs)], {
    cwd: sb.proj,
    env: Object.assign({}, process.env, { HOME: sb.home }, env || {}),
    encoding: 'utf-8',
    timeout: 120000
  });
  try { return JSON.parse(r.stdout); } catch (e) { return null; }
}

function axialMapFile(sb) { return path.join(sb.home, '.claude', 'correction-axial-map.json'); }

// Files in the folder that holds the map, other than the map itself: a lock or a
// temp file left behind would show up here.
function strayBesideMap(sb) {
  const dir = path.dirname(axialMapFile(sb));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(function (n) { return n !== 'correction-axial-map.json'; });
}

// --- TK_LEDGER_DIR moves what the script writes, never the transcripts (#182) --
// A chained /document in a scratch project wrote its heartbeat into the real
// ~/.claude/, and the rollup then said capture had run on a machine where no
// real project ever captured. The variable moves the four written files; the
// transcript root stays under HOME, so capture still reads real sessions.
{
  const sb = makeSandbox('ledgerdir');
  seedTranscripts(sb);
  const moved = path.join(sb.root, 'moved ledger');
  const env = { TK_LEDGER_DIR: moved };
  const names = ['correction-ledger.jsonl', 'correction-heartbeat.jsonl', 'correction-rollup.json', 'correction-axial-map.json'];

  const first = JSON.parse(run(sb, ['--candidates'], { env: env }));
  check('with TK_LEDGER_DIR set, --candidates still reads the transcripts under HOME',
    first.scanned === true && first.candidates.length > 0, JSON.stringify({ scanned: first.scanned, candidates: first.candidates.length }));

  run(sb, ['--add', '--data', writeRows(sb, [{ scope: 'toolkit', open_code: 'moved row' }])], { env: env });
  run(sb, ['--heartbeat', '--candidate-count', '1', '--added-count', '1'], { env: env });
  const axialIn = path.join(sb.root, 'axial-moved.json');
  fs.writeFileSync(axialIn, JSON.stringify({ 'moved row': 'moved category' }), 'utf-8');
  run(sb, ['--set-axial', '--data', axialIn], { env: env });
  const rolled = JSON.parse(run(sb, ['--rollup'], { env: env }));

  check('TK_LEDGER_DIR holds the ledger, heartbeat, rollup and axial map',
    names.every(function (n) { return fs.existsSync(path.join(moved, n)); }),
    fs.existsSync(moved) ? fs.readdirSync(moved).join(', ') : 'the folder was never created');
  check('TK_LEDGER_DIR leaves none of the four under HOME',
    names.every(function (n) { return !fs.existsSync(path.join(sb.home, '.claude', n)); }),
    fs.readdirSync(path.join(sb.home, '.claude')).join(', '));
  check('the rollup reads the moved ledger and the moved axial map',
    rolled.rows === 1 && rolled.kinds.human && rolled.kinds.human.buckets[0].axial_code === 'moved category',
    JSON.stringify({ rows: rolled.rows, kinds: Object.keys(rolled.kinds) }));

  const again = JSON.parse(run(sb, ['--candidates'], { env: env }));
  check('--candidates reads the moved heartbeat', again.everCaptured === true && again.scanned === true,
    JSON.stringify({ everCaptured: again.everCaptured, scanned: again.scanned }));
  fs.rmSync(sb.root, { recursive: true, force: true });
}
{
  const sb = makeSandbox('ledgerdir-relative');
  const rel = runRaw(sb, ['--heartbeat'], { env: { TK_LEDGER_DIR: path.join('relative', 'ledger') } });
  check('a relative TK_LEDGER_DIR is ignored: the heartbeat lands under HOME',
    rel.status === 0 && fs.existsSync(path.join(sb.home, '.claude', 'correction-heartbeat.jsonl')) &&
    !fs.existsSync(path.join(sb.proj, 'relative')), 'exit ' + rel.status + ' ' + rel.stderr);
  check('a relative TK_LEDGER_DIR prints exactly one warning',
    (rel.stderr.match(/TK_LEDGER_DIR/g) || []).length === 1, JSON.stringify(rel.stderr));

  const empty = runRaw(sb, ['--heartbeat'], { env: { TK_LEDGER_DIR: '' } });
  check('an empty TK_LEDGER_DIR means the default folder, with no warning',
    empty.status === 0 && empty.stderr.indexOf('TK_LEDGER_DIR') === -1 &&
    fs.readFileSync(path.join(sb.home, '.claude', 'correction-heartbeat.jsonl'), 'utf-8').split('\n').filter(Boolean).length === 2,
    JSON.stringify(empty.stderr));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- 20 --set-axial runs at once keep every entry (#183) -----------------------
// Without a lock each run read the map, merged, and rewrote it: runs overwrote
// each other's entries, and a run that read a half-written file took it for an
// empty map and wiped the earlier entries too.
{
  const sb = makeSandbox('axial-concurrent');
  fs.mkdirSync(path.dirname(axialMapFile(sb)), { recursive: true });
  const earlier = {};
  for (let i = 0; i < 50; i++) earlier['earlier code ' + i] = 'category ' + (i % 5);
  fs.writeFileSync(axialMapFile(sb), JSON.stringify(earlier, null, 2) + '\n', 'utf-8');
  const jobs = [];
  for (let i = 0; i < 20; i++) {
    const f = path.join(sb.root, 'axial-' + i + '.json');
    const one = {};
    one['concurrent code ' + i] = 'category ' + i;
    fs.writeFileSync(f, JSON.stringify(one), 'utf-8');
    jobs.push([SCRIPT, '--set-axial', '--data', f]);
  }
  const codes = runTogether(sb, jobs);
  let map = null;
  try { map = JSON.parse(fs.readFileSync(axialMapFile(sb), 'utf-8')); } catch (e) { map = null; }
  const keys = map ? Object.keys(map) : [];
  check('20 --set-axial runs started together all exit 0',
    Array.isArray(codes) && codes.length === 20 && codes.every(function (c) { return c === 0; }), JSON.stringify(codes));
  check('20 --set-axial runs started together keep all 20 new entries',
    keys.filter(function (k) { return /^concurrent code /.test(k); }).length === 20,
    map ? keys.filter(function (k) { return /^concurrent code /.test(k); }).length + ' of 20 kept' : 'the map does not parse');
  check('20 --set-axial runs started together keep all 50 earlier entries',
    keys.filter(function (k) { return /^earlier code /.test(k); }).length === 50,
    map ? keys.filter(function (k) { return /^earlier code /.test(k); }).length + ' of 50 kept' : 'the map does not parse');
  check('no lock or temp file is left beside the map', strayBesideMap(sb).length === 0, strayBesideMap(sb).join(', '));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- the map is swapped in by rename, never rewritten in place (#183) -----------
// The rollup reads the map without taking the lock, so it must never see half a
// file. A rename swaps a complete new file in, and the path then names a different
// file; a rewrite in place truncates the same file first, and that gap is where a
// reader found an "empty" map.
{
  const sb = makeSandbox('axial-rename');
  fs.mkdirSync(path.dirname(axialMapFile(sb)), { recursive: true });
  fs.writeFileSync(axialMapFile(sb), JSON.stringify({ 'kept code': 'category K' }), 'utf-8');
  const before = fs.statSync(axialMapFile(sb));
  const f = path.join(sb.root, 'axial-rename.json');
  fs.writeFileSync(f, JSON.stringify({ 'added code': 'category A' }), 'utf-8');
  run(sb, ['--set-axial', '--data', f]);
  const after = fs.statSync(axialMapFile(sb));
  const map = JSON.parse(fs.readFileSync(axialMapFile(sb), 'utf-8'));
  check('--set-axial swaps in a new map file rather than rewriting the old one in place',
    after.ino !== before.ino && map['kept code'] === 'category K' && map['added code'] === 'category A',
    'inode ' + before.ino + ' -> ' + after.ino);
  check('the swap leaves no temp file beside the map', strayBesideMap(sb).length === 0, strayBesideMap(sb).join(', '));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- a map that does not parse is refused, never replaced (#183) ---------------
// A parse failure used to count as an empty map, so the next write replaced
// every entry the damaged file still held.
{
  const sb = makeSandbox('axial-broken');
  fs.mkdirSync(path.dirname(axialMapFile(sb)), { recursive: true });
  const broken = '{\n  "first code": "category A",\n  "second code": "category B"\n';
  fs.writeFileSync(axialMapFile(sb), broken, 'utf-8');
  const before = fs.readFileSync(axialMapFile(sb));
  const f = path.join(sb.root, 'axial-new.json');
  fs.writeFileSync(f, JSON.stringify({ 'third code': 'category C' }), 'utf-8');

  const res = runRaw(sb, ['--set-axial', '--data', f]);
  check('--set-axial exits non-zero when the existing map does not parse', res.status !== 0, 'exit ' + res.status);
  check('the map that does not parse is left byte-identical', fs.readFileSync(axialMapFile(sb)).equals(before),
    JSON.stringify(fs.readFileSync(axialMapFile(sb), 'utf-8').slice(0, 120)));
  check('the refusal names the problem and says nothing was written',
    /does not parse/.test(res.stderr) && /Nothing was written/.test(res.stderr), JSON.stringify(res.stderr));
  check('a refused run keeps its hand-off file, so the same run can be retried', fs.existsSync(f));
  check('a refused run leaves no lock or temp file', strayBesideMap(sb).length === 0, strayBesideMap(sb).join(', '));

  const roll = runRaw(sb, ['--show-rollup']);
  check('the rollup still runs over a broken map, and says why every row is unlabeled',
    roll.status === 0 && /does not parse/.test(roll.stderr), 'exit ' + roll.status + ' ' + JSON.stringify(roll.stderr));

  // Each case below gets its own hand-off file, so no case can pass or fail only
  // because an earlier run consumed the file.
  fs.writeFileSync(axialMapFile(sb), '["a list", "not a map"]\n', 'utf-8');
  const listBefore = fs.readFileSync(axialMapFile(sb));
  const fList = path.join(sb.root, 'axial-list.json');
  fs.writeFileSync(fList, JSON.stringify({ 'third code': 'category C' }), 'utf-8');
  const notObject = runRaw(sb, ['--set-axial', '--data', fList]);
  check('a map that parses to something other than an object is refused too',
    notObject.status !== 0 && /not a JSON object/.test(notObject.stderr) && fs.readFileSync(axialMapFile(sb)).equals(listBefore),
    'exit ' + notObject.status + ' ' + JSON.stringify(notObject.stderr));

  fs.writeFileSync(axialMapFile(sb), '\n', 'utf-8');
  const fBlank = path.join(sb.root, 'axial-blank.json');
  fs.writeFileSync(fBlank, JSON.stringify({ 'third code': 'category C' }), 'utf-8');
  const blank = runRaw(sb, ['--set-axial', '--data', fBlank]);
  let blankMap = {};
  try { blankMap = JSON.parse(fs.readFileSync(axialMapFile(sb), 'utf-8')); } catch (e) { blankMap = {}; }
  check('a map file holding only whitespace counts as empty, with nothing in it to lose',
    blank.status === 0 && blankMap['third code'] === 'category C', 'exit ' + blank.status + ' ' + blank.stderr);

  // An editor that saves with a byte-order mark leaves a map that still parses once
  // the mark is dropped, so its entries are merged, not refused and not lost.
  fs.writeFileSync(axialMapFile(sb), String.fromCharCode(0xFEFF) + JSON.stringify({ 'marked code': 'category M' }) + '\n', 'utf-8');
  const fMarked = path.join(sb.root, 'axial-marked.json');
  fs.writeFileSync(fMarked, JSON.stringify({ 'third code': 'category C' }), 'utf-8');
  const marked = runRaw(sb, ['--set-axial', '--data', fMarked]);
  let markedMap = {};
  try { markedMap = JSON.parse(fs.readFileSync(axialMapFile(sb), 'utf-8')); } catch (e) { markedMap = {}; }
  check('a map file that starts with a byte-order mark keeps its entries',
    marked.status === 0 && markedMap['marked code'] === 'category M' && markedMap['third code'] === 'category C',
    'exit ' + marked.status + ' ' + marked.stderr);
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- the lock: a live one is waited for, a dead one is cleared -------------------
{
  const sb = makeSandbox('axial-lock');
  const dir = path.dirname(axialMapFile(sb));
  fs.mkdirSync(dir, { recursive: true });
  const lock = axialMapFile(sb) + '.lock';
  const observed = path.join(sb.root, 'observed.json');

  // A live lock: another run holds it for a second. The watcher records whether
  // the map already had the new entry while the lock was held, then releases it.
  fs.writeFileSync(lock, 'another run', 'utf-8');
  const f = path.join(sb.root, 'axial-wait.json');
  fs.writeFileSync(f, JSON.stringify({ 'waited code': 'category W' }), 'utf-8');
  const watcher = [
    '-e',
    "const fs = require('fs');" +
    'setTimeout(function () {' +
    '  let early = false;' +
    '  try { early = "waited code" in JSON.parse(fs.readFileSync(process.argv[1], "utf-8")); } catch (e) { early = false; }' +
    '  fs.writeFileSync(process.argv[2], JSON.stringify({ early: early }));' +
    '  fs.unlinkSync(process.argv[3]);' +
    '}, 1000);',
    axialMapFile(sb), observed, lock
  ];
  const codes = runTogether(sb, [watcher, [SCRIPT, '--set-axial', '--data', f]]);
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(observed, 'utf-8')); } catch (e) { seen = {}; }
  let map = {};
  try { map = JSON.parse(fs.readFileSync(axialMapFile(sb), 'utf-8')); } catch (e) { map = {}; }
  check('--set-axial waits while another run holds the lock', seen.early === false,
    'the map already had the entry while the lock was held: ' + JSON.stringify(seen));
  check('--set-axial writes once the lock is released', Array.isArray(codes) && codes[1] === 0 && map['waited code'] === 'category W',
    JSON.stringify(codes));

  // A dead lock: a run that crashed an hour ago.
  fs.writeFileSync(lock, 'a run that died', 'utf-8');
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(lock, hourAgo, hourAgo);
  const g = path.join(sb.root, 'axial-stale.json');
  fs.writeFileSync(g, JSON.stringify({ 'after a dead lock': 'category S' }), 'utf-8');
  const res = runRaw(sb, ['--set-axial', '--data', g]);
  let after = {};
  try { after = JSON.parse(fs.readFileSync(axialMapFile(sb), 'utf-8')); } catch (e) { after = {}; }
  check('a lock older than the stale age is cleared and the write goes through',
    res.status === 0 && after['after a dead lock'] === 'category S' && after['waited code'] === 'category W', 'exit ' + res.status + ' ' + res.stderr);
  check('the dead lock is gone afterwards, and nothing else is left beside the map',
    !fs.existsSync(lock) && strayBesideMap(sb).length === 0, strayBesideMap(sb).join(', '));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// Is `dir` outside every root, compared as real paths the way removeHandoff()
// compares them? A root that does not exist holds nothing.
function outsideRoots(dir, roots) {
  let real;
  try { real = fs.realpathSync(dir); } catch (e) { return false; }
  return !roots.some(function (root) {
    let base;
    try { base = fs.realpathSync(root); } catch (e) { return false; }
    const rel = path.relative(base, real);
    return rel === '' || !(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel));
  });
}

// --- the hand-off file is deleted only from the temp directory ---------------
// --add and --set-axial remove the --data file after reading it, because it
// carries the private layer untruncated. The path is the caller's and the script
// runs under a pre-approved permission, so the unlink has to stay inside the
// documented hand-off location (a fresh mktemp folder under /tmp, per document.md), or
// a typo like `--data package.json` reads a project file and then deletes it
// (holistic review, R2).
{
  const sb = makeSandbox('handoff');
  // The script takes "the temp directory" to be os.tmpdir() or /tmp. Every child in
  // this block runs with its own fresh temp folder, so "inside" is a place this
  // block controls rather than whatever the machine's TMPDIR happens to be.
  const childTemp = path.join(sb.root, 'child-tmp');
  fs.mkdirSync(childTemp, { recursive: true });
  const tempEnv = { TMPDIR: childTemp, TMP: childTemp, TEMP: childTemp };
  const tempRoots = [childTemp, '/tmp'];

  const inside = path.join(childTemp, 'correction-rows-handoff.json');
  fs.writeFileSync(inside, JSON.stringify([{ scope: 'toolkit', open_code: 'inside the temp directory' }]), 'utf-8');
  run(sb, ['--add', '--data', inside], { env: tempEnv });
  check('--add removes a hand-off file that lives in the temp directory',
    !fs.existsSync(inside), 'the consumed file is still there');

  // The outside fixture must be under neither temp root. The repo's gitignored
  // artifacts/html serves when the checkout is outside both. A checkout under /tmp
  // (a scratch clone, as the release rehearsal uses) has every repo path inside
  // /tmp, which the script treats as temp whatever TMPDIR says, and the suite
  // failed there (issue #183). So /var/tmp stands in: a standard temp folder on
  // Linux and macOS that the script does not treat as one. Either way the folder is
  // named like the realistic typo and removed on the way out.
  const repoRoot = path.resolve(__dirname, '..');
  const candidates = [
    { usable: function () { return outsideRoots(repoRoot, tempRoots); }, parent: path.join(repoRoot, 'artifacts', 'html') },
    { usable: function () { return outsideRoots('/var/tmp', tempRoots); }, parent: '/var/tmp' }
  ];
  let outsideDir = null;
  for (let i = 0; i < candidates.length && outsideDir === null; i++) {
    if (!candidates[i].usable()) continue;
    try {
      fs.mkdirSync(candidates[i].parent, { recursive: true });
      outsideDir = fs.mkdtempSync(path.join(candidates[i].parent, 'ledger-handoff-'));
    } catch (e) { outsideDir = null; }
  }
  try {
    check('the outside fixture really is outside the temp directory',
      outsideDir !== null && outsideRoots(outsideDir, tempRoots),
      outsideDir === null ? 'no writable folder outside ' + tempRoots.join(' and ') + ': tried the repo and /var/tmp'
        : fs.realpathSync(outsideDir));
    if (outsideDir !== null) {
      const outside = path.join(outsideDir, 'package.json');
      fs.writeFileSync(outside, JSON.stringify([{ scope: 'toolkit', open_code: 'outside the temp directory' }]), 'utf-8');
      const res = runRaw(sb, ['--add', '--data', outside], { env: tempEnv });
      check('--add still appends from a --data file outside the temp directory',
        res.status === 0 && JSON.parse(res.stdout || '{}').added === 1, res.stderr || ('exit ' + res.status));
      check('--add leaves a --data file outside the temp directory in place',
        fs.existsSync(outside), 'the file was deleted: `--data package.json` typed in a project would remove that file');
      check('--add says on stderr that it left the file alone',
        /left .+ in place/.test(res.stderr), JSON.stringify(res.stderr));
    }
  } finally {
    if (outsideDir !== null) fs.rmSync(outsideDir, { recursive: true, force: true });
  }
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- the main copy's opt-out is honored from a worktree, on any git -----------
// The marker is untracked and /worktree does not copy it, so from a worktree the
// script has to find the MAIN copy, via `git rev-parse --git-common-dir`. The
// old form added --path-format=absolute, which only exists from git 2.31, and
// rev-parse echoes an option it does not know on its own line and carries on:
// an older git turned the answer into two lines whose dirname pointed nowhere,
// and the main copy was silently never checked (holistic review, R22). The shim
// below reproduces that echo exactly, because a stub that merely rejected the
// flag would test a failure shape old git never produces.
{
  const sb = makeSandbox('worktree');
  const main = path.join(sb.root, 'main');
  const wt = path.join(sb.root, 'wt');
  const g = function (args) {
    return execFileSync('git', args, { cwd: main, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  };
  try {
    fs.mkdirSync(main, { recursive: true });
    g(['init', '-q']);
    g(['config', 'user.email', 'test@example.com']);
    g(['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(main, 'README.md'), 'x\n', 'utf-8');
    g(['add', 'README.md']); g(['commit', '-qm', 'init']);
    g(['worktree', 'add', wt, '-b', 'side']);
    fs.mkdirSync(path.join(main, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(main, '.claude', '.no-correction-log'), '', 'utf-8');
    // Deliberately no marker in the worktree, matching what /worktree produces.

    const rows = function () { return writeRows(sb, [{ scope: 'toolkit', open_code: 'WORKTREE_LEAK_MARKER' }]); };
    const modern = JSON.parse(run(sb, ['--add', '--data', rows()], { cwd: wt }));
    check('the main copy opt-out is honored from a worktree',
      modern.added === 0 && modern.optedOut === true, JSON.stringify(modern));

    const shimDir = path.join(sb.root, 'old-git');
    fs.mkdirSync(shimDir);
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf-8' }).trim();
    fs.writeFileSync(path.join(shimDir, 'git'), [
      '#!/bin/sh',
      '# A git older than 2.31: rev-parse echoes --path-format instead of knowing it.',
      'n=$#; i=0',
      'while [ $i -lt $n ]; do',
      '  a=$1; shift',
      '  case "$a" in',
      '    --path-format*) printf \'%s\\n\' "$a" ;;',
      '    *) set -- "$@" "$a" ;;',
      '  esac',
      '  i=$((i+1))',
      'done',
      'exec "' + realGit + '" "$@"',
      ''
    ].join('\n'), 'utf-8');
    fs.chmodSync(path.join(shimDir, 'git'), 0o755);
    const oldEnv = { PATH: shimDir + path.delimiter + process.env.PATH };
    const echoed = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: wt, env: Object.assign({}, process.env, oldEnv), encoding: 'utf-8' });
    check('the old-git shim echoes --path-format the way rev-parse does',
      echoed.split('\n')[0] === '--path-format=absolute', JSON.stringify(echoed));

    const old = JSON.parse(run(sb, ['--add', '--data', rows()], { cwd: wt, env: oldEnv }));
    check('the main copy opt-out is honored from a worktree on a git without --path-format',
      old.added === 0 && old.optedOut === true,
      JSON.stringify(old) + ' - the main copy marker was skipped, a privacy control failing open');
    check('an opted-out worktree wrote nothing to the ledger on either git',
      !fs.existsSync(ledgerFile(sb)), 'a ledger file was created');
  } catch (e) {
    check('worktree opt-out test set up a repo and a worktree', false, e.message);
  }
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- issue #229: a worktree counts as the repo it belongs to -------------------
// The rollup used to group by the working copy's folder name, so a worktree read
// as a repo of its own, and every project's `worktree-1` merged under one label.
// Rows now resolve to their main working copy: a live path through git, a removed
// one through the `.claude/worktrees/` folder it sat in.
{
  const sb = makeSandbox('identity229');
  const main = path.join(sb.root, 'mainrepo');
  const wt = path.join(main, '.claude', 'worktrees', 'wt-one');
  const g = function (args) {
    return execFileSync('git', args, { cwd: main, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  };
  try {
    fs.mkdirSync(main, { recursive: true });
    g(['init', '-q']);
    g(['config', 'user.email', 'test@example.com']);
    g(['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(main, 'README.md'), 'x\n', 'utf-8');
    g(['add', 'README.md']); g(['commit', '-qm', 'init']);
    g(['worktree', 'add', wt, '-b', 'side']);
    const code = 'worktree identity probe';
    run(sb, ['--add', '--data', writeRows(sb, [{ scope: 'project', stage: 'execute', open_code: code }])], { cwd: main });
    run(sb, ['--add', '--data', writeRows(sb, [{ scope: 'project', stage: 'execute', open_code: code }])], { cwd: wt });
    // A row left by a worktree that has since been removed: its path is gone.
    fs.appendFileSync(ledgerFile(sb), JSON.stringify({
      at: '2026-09-20T10:00:00.000Z', repo: 'wt-gone', repo_path: path.join(main, '.claude', 'worktrees', 'wt-gone'),
      kind: 'human', scope: 'project', stage: 'review', produced: '', correction: '', open_code: code, axial_code: null
    }) + '\n', 'utf-8');
    const r = JSON.parse(run(sb, ['--show-rollup']));
    const bucket = r.kinds.human.buckets[0];
    check('a worktree row, a removed worktree row and the main copy row count as one repo',
      bucket.count === 3 && JSON.stringify(bucket.repos) === JSON.stringify(['mainrepo']),
      JSON.stringify(bucket.repos));
    const stored = fs.readFileSync(ledgerFile(sb), 'utf-8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
    check('a row written from a worktree carries the main copy name, and keeps its own path',
      stored[1].repo === 'mainrepo' && stored[1].repo_path.indexOf('wt-one') !== -1,
      JSON.stringify({ repo: stored[1].repo }));
  } catch (e) {
    check('worktree identity test set up a repo and a worktree', false, e.message);
  }
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- issue #229: a candidate carries the request behind the output -------------
// A fix needs to know what was asked, not only what came back and what the human
// said about it. The scan kept only the assistant's last output; it now also keeps
// the human words that came before that output, as `asked`.
{
  const sb = makeSandbox('asked229');
  const dir = path.join(sb.home, '.claude', 'projects', sb.proj.replace(/[/\\]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const asst = function (t) { return JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } }); };
  const user = function (t, ts) { return JSON.stringify({ type: 'user', timestamp: ts, sessionId: 'sess-a', message: { content: t } }); };
  fs.writeFileSync(path.join(dir, 'sess-a.jsonl'), [
    user('Please write the README intro for the install page.', '2026-09-20T10:00:00.000Z'),
    asst('Here is an intro that opens with the project history.'),
    user("That's not right, it should lead with the install step.", '2026-09-20T10:01:00.000Z'),
    // A request made by running a slash command: its words are harness tags.
    user('<command-message>explore</command-message><command-name>/explore</command-name><command-args>issue 9</command-args>', '2026-09-20T10:02:00.000Z'),
    user('# Initial Exploration Stage\n**Use this when:** Starting a new feature.', '2026-09-20T10:02:01.000Z'),
    asst('Going with scoping mode.'),
    user('Actually I wanted vision mode for this one, please switch.', '2026-09-20T10:03:00.000Z'),
    // A request whose answer the human cut off.
    user('Rename the config loader to settings loader everywhere.', '2026-09-20T10:04:00.000Z'),
    asst('Renaming in the tests first.'),
    user('[Request interrupted by user]', '2026-09-20T10:04:30.000Z'),
    user('no', '2026-09-20T10:04:40.000Z')
  ].join('\n') + '\n', 'utf-8');
  const out = JSON.parse(run(sb, ['--candidates', '--since', '2026-09-20T00:00:00.000Z']));
  const at = function (ts) { return out.candidates.filter(function (c) { return c.at === ts; })[0] || {}; };
  check('a candidate carries the human request that came before the output',
    at('2026-09-20T10:01:00.000Z').asked === 'Please write the README intro for the install page.',
    JSON.stringify(at('2026-09-20T10:01:00.000Z').asked));
  check('a request made by a slash command is carried as the command and its arguments',
    at('2026-09-20T10:03:00.000Z').asked === '/explore issue 9',
    JSON.stringify(at('2026-09-20T10:03:00.000Z').asked));
  check('the message after an interrupt carries the request whose answer was cut off',
    at('2026-09-20T10:04:40.000Z').after_interrupt === true &&
    at('2026-09-20T10:04:40.000Z').asked === 'Rename the config loader to settings loader everywhere.',
    JSON.stringify(at('2026-09-20T10:04:40.000Z')));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- issue #229: the request and the rewrite are capped, private fields ---------
{
  const sb = makeSandbox('rewrite229');
  const longLines = Array.from({ length: 60 }, function (_, i) { return '- bullet line ' + i + ' of the owner rewrite'; }).join('\n');
  run(sb, ['--add', '--data', writeRows(sb, [{
    scope: 'project', stage: 'execute', open_code: 'cap probe',
    trigger: 'T'.repeat(500), rewrite: longLines
  }])]);
  const row = JSON.parse(fs.readFileSync(ledgerFile(sb), 'utf-8').trim());
  check('the request is capped at 300 characters', typeof row.trigger === 'string' && row.trigger.length === 300, String(row.trigger && row.trigger.length));
  check('the rewrite is capped at 1,200 characters', typeof row.rewrite === 'string' && row.rewrite.length === 1200, String(row.rewrite && row.rewrite.length));
  check('the rewrite keeps its line breaks, which carry its structure',
    typeof row.rewrite === 'string' && row.rewrite.indexOf('\n- bullet line 1 ') !== -1,
    JSON.stringify(String(row.rewrite).slice(0, 80)));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- issue #229: no private field reaches the rollup, and its shape is pinned ----
// The earlier privacy check planted a marker in `correction` only. Every private
// field gets one now, and the bucket's field list is asserted exactly, so a new
// field cannot join the rollup without this test changing too.
{
  const sb = makeSandbox('privacy229');
  run(sb, ['--add', '--data', writeRows(sb, [{
    scope: 'toolkit', stage: 'review', open_code: 'privacy probe',
    produced: 'PRODUCED_LEAK_MARKER', correction: 'CORRECTION_LEAK_MARKER',
    trigger: 'TRIGGER_LEAK_MARKER', rewrite: 'REWRITE_LEAK_MARKER'
  }])]);
  const markers = ['PRODUCED_LEAK_MARKER', 'CORRECTION_LEAK_MARKER', 'TRIGGER_LEAK_MARKER', 'REWRITE_LEAK_MARKER'];
  const stdout = run(sb, ['--rollup']);
  const file = fs.readFileSync(rollupFile(sb), 'utf-8');
  const ledger = fs.readFileSync(ledgerFile(sb), 'utf-8');
  markers.forEach(function (m) {
    check('no ' + m.split('_')[0].toLowerCase() + ' text reaches the rollup',
      stdout.indexOf(m) === -1 && file.indexOf(m) === -1, m + ' leaked');
  });
  check('the ledger itself holds all four private fields (control)',
    markers.every(function (m) { return ledger.indexOf(m) !== -1; }));
  const bucket = JSON.parse(stdout).kinds.human.buckets[0];
  // by_month (#231) is counts keyed by month, no row text, so it may sit beside
  // the privacy-checked fields (#229); both landed in 8.0.0.
  const expected = ['axial_code', 'by_month', 'count', 'hint_disagrees', 'home', 'last_seen', 'open_codes', 'repos', 'scope_split', 'spread', 'stage_split'];
  check('a rollup bucket carries exactly the expected fields',
    JSON.stringify(Object.keys(bucket).sort()) === JSON.stringify(expected), JSON.stringify(Object.keys(bucket).sort()));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- issue #229: the evidence read shows a repo's rows only inside that repo ----
// The one read path back to the private fields. Each case below states what it
// must show: its own repo's rows, or nothing. The canary sits in a second repo
// that has the same folder name, which is the case a label comparison would get
// wrong; identity is the main working copy's real path.
{
  const sb = makeSandbox('evidence229');
  const work = path.join(sb.root, 'work', 'api');
  const personal = path.join(sb.root, 'personal', 'api');
  const initRepo = function (dir) {
    const g = function (args) { return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }); };
    fs.mkdirSync(dir, { recursive: true });
    g(['init', '-q']); g(['config', 'user.email', 'test@example.com']); g(['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(dir, 'README.md'), 'x\n', 'utf-8');
    g(['add', 'README.md']); g(['commit', '-qm', 'init']);
    return g;
  };
  const evidence = function (cwd, env) {
    return runRaw(sb, ['--evidence', '--category', 'probe category'], { cwd: cwd, env: env });
  };
  const rowsOf = function (r) { try { return JSON.parse(r.stdout).rows; } catch (e) { return null; } };
  try {
    const gw = initRepo(work);
    initRepo(personal);
    const wt = path.join(work, '.claude', 'worktrees', 'wt-a');
    gw(['worktree', 'add', wt, '-b', 'side']);
    fs.mkdirSync(path.join(work, 'src', 'deep'), { recursive: true });
    fs.mkdirSync(path.join(sb.home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(sb.home, '.claude', 'correction-axial-map.json'),
      JSON.stringify({ 'evidence probe': 'probe category' }), 'utf-8');
    const row = function (marker) {
      return writeRows(sb, [{ scope: 'project', stage: 'execute', open_code: 'evidence probe',
        produced: marker + ' produced', correction: marker + ' correction', trigger: marker + ' trigger', rewrite: marker + ' rewrite' }]);
    };
    run(sb, ['--add', '--data', row('WORK_ROW')], { cwd: work });
    run(sb, ['--add', '--data', row('WORKTREE_ROW')], { cwd: wt });
    run(sb, ['--add', '--data', row('EVIDENCE_CANARY')], { cwd: personal });
    // A stored path that starts inside work/api and resolves into personal/api.
    // Joined by hand: path.join would normalize the `..` away before it is stored,
    // and the test would then never plant the climbing path it exists to check.
    const climbing = [work, '..', '..', 'personal', 'api'].join(path.sep);
    fs.appendFileSync(ledgerFile(sb), JSON.stringify({
      at: '2026-09-21T10:00:00.000Z', repo: 'api', repo_path: climbing,
      kind: 'human', scope: 'project', stage: 'review', produced: 'DOTDOT_CANARY', correction: '', open_code: 'evidence probe', axial_code: null
    }) + '\n', 'utf-8');
    // A row from before repo_path existed: it cannot prove where it came from.
    fs.appendFileSync(ledgerFile(sb), JSON.stringify({
      at: '2026-08-01T10:00:00.000Z', repo: 'api', kind: 'human', scope: 'project', stage: 'review',
      produced: 'NOPATH_CANARY', correction: '', open_code: 'evidence probe', axial_code: null
    }) + '\n', 'utf-8');

    const fromWork = evidence(work);
    const seen = JSON.stringify(rowsOf(fromWork));
    check('evidence from a repo shows its own rows and its worktree\'s',
      fromWork.status === 0 && seen.indexOf('WORK_ROW') !== -1 && seen.indexOf('WORKTREE_ROW') !== -1, seen.slice(0, 200));
    check('evidence never shows a same-named sibling repo\'s rows',
      fromWork.stdout.indexOf('EVIDENCE_CANARY') === -1 && fromWork.stdout.indexOf('DOTDOT_CANARY') === -1,
      'the canary reached the wrong repo');
    check('evidence leaves out, and counts, a row with no stored path',
      fromWork.stdout.indexOf('NOPATH_CANARY') === -1 && JSON.parse(fromWork.stdout).left_out.no_repo_path === 1,
      fromWork.stdout.slice(0, 200));
    const fromPersonal = evidence(personal);
    check('the sibling repo sees its own rows, including the path that climbs into it with ..',
      fromPersonal.stdout.indexOf('EVIDENCE_CANARY') !== -1 && fromPersonal.stdout.indexOf('DOTDOT_CANARY') !== -1 &&
      fromPersonal.stdout.indexOf('WORK_ROW') === -1, fromPersonal.stdout.slice(0, 200));
    const fromDeep = evidence(path.join(work, 'src', 'deep'));
    check('evidence from a subdirectory shows the same rows as the repo root',
      JSON.stringify(rowsOf(fromDeep)) === JSON.stringify(rowsOf(fromWork)), fromDeep.stdout.slice(0, 200));
    const link = path.join(sb.root, 'link-to-api');
    fs.symlinkSync(work, link);
    const fromLink = evidence(link);
    check('evidence through a symlinked path shows the same rows as the real path',
      JSON.stringify(rowsOf(fromLink)) === JSON.stringify(rowsOf(fromWork)), fromLink.stdout.slice(0, 200));
    const fromWorktree = evidence(wt);
    check('evidence from a worktree shows its main copy\'s rows, by design',
      JSON.stringify(rowsOf(fromWorktree)) === JSON.stringify(rowsOf(fromWork)), fromWorktree.stdout.slice(0, 200));
    const plain = path.join(sb.root, 'not-a-repo');
    fs.mkdirSync(plain);
    const fromPlain = evidence(plain);
    check('evidence refuses outside a git repository and prints no rows',
      fromPlain.status !== 0 && fromPlain.stdout.indexOf('_ROW') === -1 && fromPlain.stdout.indexOf('CANARY') === -1,
      'exit ' + fromPlain.status + ' ' + fromPlain.stdout.slice(0, 120));
    const moved = path.join(sb.root, 'moved-ledger');
    fs.mkdirSync(moved);
    const fromMoved = evidence(work, { TK_LEDGER_DIR: moved });
    check('under TK_LEDGER_DIR evidence reads only the moved ledger, which holds none of these rows',
      fromMoved.status === 0 && JSON.stringify(rowsOf(fromMoved)) === '[]', fromMoved.stdout.slice(0, 200));
    fs.mkdirSync(path.join(personal, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(personal, '.claude', '.no-correction-log'), '', 'utf-8');
    const fromOptedOut = evidence(personal);
    check('evidence in an opted-out repo prints no rows',
      fromOptedOut.stdout.indexOf('CANARY') === -1 && JSON.parse(fromOptedOut.stdout).optedOut === true,
      fromOptedOut.stdout.slice(0, 200));
  } catch (e) {
    check('evidence test set up its repos', false, e.message);
  }
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- issue #229: rates per cycle, before and after a fix -----------------------
// Planted state: two repos' heartbeats and rows, and fix records written by hand so
// their times can sit exactly on a cycle boundary. A record with no stored `before`
// has it computed by the same rule --record-fix stores it with. The repo folders
// are never created, so each resolves to itself.
{
  const sb = makeSandbox('rates229');
  const dir = path.join(sb.home, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  const A = path.join(sb.root, 'repo-a');
  const B = path.join(sb.root, 'repo-b');
  const lines = function (file, recs) {
    fs.writeFileSync(path.join(dir, file), recs.map(function (r) { return JSON.stringify(r); }).join('\n') + '\n', 'utf-8');
  };
  const beat = function (p, at, v) {
    const b = { at: at, repo: path.basename(p), repo_path: p, session: '', candidates: 0, added: 0 };
    if (v) b.toolkit_version = v;
    return b;
  };
  const row = function (p, at, code) {
    return { at: at, repo: path.basename(p), repo_path: p, kind: 'human', scope: 'project', stage: 'execute',
      produced: 'RATE_PRIVATE_MARKER', correction: '', open_code: code || 'x code', axial_code: null };
  };
  lines('correction-heartbeat.jsonl', [
    beat(A, '2026-09-01T10:00:00.000Z'), beat(A, '2026-09-05T10:00:00.000Z'), beat(A, '2026-09-10T10:00:00.000Z'),
    beat(A, '2026-09-15T10:00:00.000Z'), beat(A, '2026-09-20T10:00:00.000Z'),
    beat(B, '2026-09-02T10:00:00.000Z'), beat(B, '2026-09-16T10:00:00.000Z', '7.7.0'), beat(B, '2026-09-21T10:00:00.000Z', '7.7.0')
  ]);
  lines('correction-ledger.jsonl', [
    row(A, '2026-08-30T10:00:00.000Z'),                                    // A's first cycle: left out
    row(A, '2026-09-03T10:00:00.000Z'),                                    // A cycle 2
    row(A, '2026-09-07T10:00:00.000Z'), row(A, '2026-09-08T10:00:00.000Z'), // A cycle 3
    row(A, '2026-09-12T10:00:00.000Z'),                                    // A cycle 4, in progress at the mid-cycle fixes
    row(A, '2026-09-18T10:00:00.000Z'),                                    // A cycle 5
    row(A, '2026-09-25T10:00:00.000Z'),                                    // after A's last heartbeat: left out
    row(A, '2026-09-04T10:00:00.000Z', 'backfill: x code'),                // marked as a backfill: left out
    row(B, '2026-09-01T12:00:00.000Z'),                                    // B's first cycle: left out
    row(B, '2026-09-17T10:00:00.000Z')                                     // B cycle 3, closed on 7.7.0
  ]);
  fs.writeFileSync(path.join(dir, 'correction-axial-map.json'),
    JSON.stringify({ 'x code': 'cat-x', 'backfill: x code': 'cat-x' }), 'utf-8');
  lines('correction-fixes.jsonl', [
    { at: '2026-09-13T00:00:00.000Z', category: 'cat-x', home: 'global', label: 'mid-cycle global fix', version: null },
    { at: '2026-09-13T00:00:00.000Z', category: 'cat-x', home: 'toolkit', label: 'mid-cycle toolkit fix', version: '7.7.0' },
    { at: '2026-09-05T10:00:00.000Z', category: 'cat-x', home: 'global', label: 'fix on a heartbeat', version: null }
  ]);
  const out = run(sb, ['--show-rollup']);
  const r = JSON.parse(out);
  const fx = r.fixes || [];
  const nums = function (f) { return f && f.before && f.after ? [f.before.rows, f.before.cycles, f.after.rows, f.after.cycles] : null; };
  check('a global fix: before counts the cycles that ended by it, after the cycles that began after it, the one in progress neither',
    JSON.stringify(nums(fx[0])) === JSON.stringify([3, 2, 2, 2]), JSON.stringify(nums(fx[0])));
  check('a toolkit fix counts only after-cycles closed on the fixed version; a heartbeat with no version counts for a global fix only',
    !!fx[1] && !!fx[1].after && fx[1].after.cycles === 1 && fx[1].after.rows === 1 && !!fx[0] && fx[0].after.cycles === 2,
    JSON.stringify(nums(fx[1])));
  check('a heartbeat at exactly the fix\'s time falls in before, and the cycle it opens falls in after',
    JSON.stringify(nums(fx[2])) === JSON.stringify([1, 1, 5, 4]), JSON.stringify(nums(fx[2])));
  check('rates_left_out counts the rows each rule dropped',
    !!r.rates_left_out && r.rates_left_out.first_cycle === 2 && r.rates_left_out.backfill_marked === 1 &&
    r.rates_left_out.no_later_cycle === 1, JSON.stringify(r.rates_left_out));
  check('a fix is not judged before 5 cycles on each side',
    !!fx[0] && fx[0].enough_cycles === false, JSON.stringify(fx[0] && fx[0].enough_cycles));
  check('no private text reaches the rollup through the rates', out.indexOf('RATE_PRIVATE_MARKER') === -1);
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- review of #229, R10: a toolkit fix's two sides count the same installs ------
// Before had counted every cycle that ended by the fix, so a working copy that
// records no version (the toolkit's source copy, a copy-install) sat on a toolkit
// fix's before side and never on its after side, and a cycle that already ran the
// fixed release, closed before the fix was recorded, counted as before. Both sides
// now count only cycles closed on a recorded version: before an older release,
// after the fixed one or later. --record-fix stores its before by the same rule.
{
  const sb = makeSandbox('toolkitsides229');
  const dir = path.join(sb.home, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  const U = path.join(sb.root, 'unversioned');
  const P = path.join(sb.root, 'plugin');
  const lines = function (file, recs) {
    fs.writeFileSync(path.join(dir, file), recs.map(function (r) { return JSON.stringify(r); }).join('\n') + '\n', 'utf-8');
  };
  const beat = function (p, at, v) {
    const b = { at: at, repo: path.basename(p), repo_path: p, session: '', candidates: 0, added: 0 };
    if (v) b.toolkit_version = v;
    return b;
  };
  const row = function (p, at) {
    return { at: at, repo: path.basename(p), repo_path: p, kind: 'human', scope: 'toolkit', stage: 'execute',
      produced: '', correction: '', open_code: 'x code', axial_code: null };
  };
  lines('correction-heartbeat.jsonl', [
    beat(U, '2026-09-01T10:00:00.000Z'), beat(U, '2026-09-05T10:00:00.000Z'), beat(U, '2026-09-20T10:00:00.000Z'),
    beat(P, '2026-09-02T10:00:00.000Z', '7.6.0'), beat(P, '2026-09-06T10:00:00.000Z', '7.6.0'),
    beat(P, '2026-09-11T10:00:00.000Z', '7.7.0'), beat(P, '2026-09-13T10:00:00.000Z', '7.7.0'),
    beat(P, '2026-09-18T10:00:00.000Z', '7.7.0')
  ]);
  lines('correction-ledger.jsonl', [
    row(U, '2026-09-03T10:00:00.000Z'),   // closed with no version: on neither side of a toolkit fix
    row(P, '2026-09-04T10:00:00.000Z'),   // closed on 7.6.0, before the fix: before
    row(P, '2026-09-08T10:00:00.000Z'),   // closed on 7.7.0 before the fix was recorded: ran the fix, so not before
    row(P, '2026-09-15T10:00:00.000Z')    // closed on 7.7.0 after the fix: after
  ]);
  fs.writeFileSync(path.join(dir, 'correction-axial-map.json'), JSON.stringify({ 'x code': 'cat-x' }), 'utf-8');
  lines('correction-fixes.jsonl', [
    { at: '2026-09-12T00:00:00.000Z', category: 'cat-x', home: 'toolkit', label: 'toolkit fix', version: '7.7.0' }
  ]);
  const fx = (JSON.parse(run(sb, ['--show-rollup'])).fixes || [])[0];
  const pair = function (s) { return s ? [s.rows, s.cycles] : null; };
  check('a toolkit fix\'s before side counts only cycles closed on an older recorded version',
    !!fx && JSON.stringify(pair(fx.before)) === JSON.stringify([1, 1]), JSON.stringify(fx && fx.before));
  check('a toolkit fix\'s after side still counts only cycles closed on the fixed version or later',
    !!fx && JSON.stringify(pair(fx.after)) === JSON.stringify([1, 1]), JSON.stringify(fx && fx.after));
  fs.rmSync(path.join(dir, 'correction-fixes.jsonl'));
  let stored = null;
  try {
    run(sb, ['--record-fix', '--category', 'cat-x', '--home', 'toolkit', '--label', 'x', '--version', '7.7.0']);
    stored = JSON.parse(fs.readFileSync(path.join(dir, 'correction-fixes.jsonl'), 'utf-8').trim()).before;
  } catch (e) { stored = { error: e.message }; }
  check('record-fix stores a toolkit fix\'s before by the same rule', JSON.stringify(pair(stored)) === JSON.stringify([1, 1]),
    JSON.stringify(stored));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- issue #229: the home verdict comes from the spread --------------------------
// One repo: project. Two or more: toolkit when MORE than half the rows came during
// a toolkit stage (explore, create-plan, execute, review, document), global
// otherwise, so a tie goes to global. One row, or no category yet: no home.
{
  const sb = makeSandbox('home229');
  const dir = path.join(sb.home, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  const A = path.join(sb.root, 'repo-a');
  const B = path.join(sb.root, 'repo-b');
  let n = 0;
  const row = function (p, code, stage, scope) {
    n++;
    return JSON.stringify({ at: '2026-09-0' + (1 + (n % 9)) + 'T10:00:00.000Z', repo: path.basename(p), repo_path: p,
      kind: 'human', scope: scope, stage: stage, produced: '', correction: '', open_code: code, axial_code: null });
  };
  fs.writeFileSync(path.join(dir, 'correction-ledger.jsonl'), [
    row(A, 'one repo', 'execute', 'toolkit'), row(A, 'one repo', 'review', 'toolkit'),
    row(A, 'mostly toolkit', 'execute', 'project'), row(B, 'mostly toolkit', 'review', 'project'), row(B, 'mostly toolkit', 'other', 'project'),
    row(A, 'a tie', 'execute', 'toolkit'), row(B, 'a tie', 'other', 'toolkit'),
    row(A, 'never in a stage', 'other', 'project'), row(B, 'never in a stage', 'unknown', 'project'),
    row(A, 'only once', 'execute', 'project'),
    row(A, 'no category yet', 'execute', 'project'), row(B, 'no category yet', 'execute', 'project')
  ].join('\n') + '\n', 'utf-8');
  fs.writeFileSync(path.join(dir, 'correction-axial-map.json'), JSON.stringify({
    'one repo': 'cat-one-repo', 'mostly toolkit': 'cat-toolkit', 'a tie': 'cat-tie',
    'never in a stage': 'cat-global', 'only once': 'cat-single'
  }), 'utf-8');
  const r = JSON.parse(run(sb, ['--show-rollup']));
  const b = {};
  r.kinds.human.buckets.forEach(function (x) { b[x.axial_code] = x; });
  const home = function (k) { return b[k] ? b[k].home : 'missing'; };
  check('a category in one repo belongs to that project',
    home('cat-one-repo') === 'project' && b['cat-one-repo'].spread === 1, home('cat-one-repo'));
  check('a category in two repos, mostly during toolkit stages, belongs to the toolkit',
    home('cat-toolkit') === 'toolkit' && b['cat-toolkit'].spread === 2 &&
    JSON.stringify(b['cat-toolkit'].stage_split) === JSON.stringify({ toolkit: 2, other: 1 }), home('cat-toolkit'));
  check('a tie between toolkit stages and the rest goes to global', home('cat-tie') === 'global', home('cat-tie'));
  check('a category in two repos outside toolkit stages belongs to the global instructions', home('cat-global') === 'global', home('cat-global'));
  check('a category with one row, and the unlabeled bucket, get no home',
    !!b['cat-single'] && b['cat-single'].home === null && !!b['(unlabeled)'] && b['(unlabeled)'].home === null,
    JSON.stringify([home('cat-single'), home('(unlabeled)')]));
  check('hint_disagrees is set when the capture tag points away from the verdict',
    b['cat-toolkit'].hint_disagrees === true && b['cat-tie'].hint_disagrees === true && b['cat-one-repo'].hint_disagrees === true,
    JSON.stringify([b['cat-toolkit'].hint_disagrees, b['cat-tie'].hint_disagrees, b['cat-one-repo'].hint_disagrees]));
  check('hint_disagrees is unset when the capture tag agrees', b['cat-global'].hint_disagrees === false,
    JSON.stringify(b['cat-global'].hint_disagrees));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- issue #229: --record-fix validates every field and stores the before rate ----
{
  const sb = makeSandbox('recordfix229');
  const dir = path.join(sb.home, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'correction-axial-map.json'), JSON.stringify({ 'x code': 'cat-x' }), 'utf-8');
  const fixes = path.join(dir, 'correction-fixes.jsonl');
  const tryFix = function (args, cwd) { return runRaw(sb, ['--record-fix'].concat(args), { cwd: cwd }); };
  const refused = function (name, args) {
    const r = tryFix(args);
    check(name, r.status !== 0 && !fs.existsSync(fixes), 'exit ' + r.status + ', fixes file ' + (fs.existsSync(fixes) ? 'written' : 'absent'));
  };
  refused('record-fix refuses a category the axial map does not name', ['--category', 'no such category', '--home', 'global', '--label', 'x']);
  refused('record-fix refuses an unknown home', ['--category', 'cat-x', '--home', 'nowhere', '--label', 'x']);
  refused('record-fix refuses a fix with no label', ['--category', 'cat-x', '--home', 'global']);
  refused('record-fix refuses a toolkit fix without a version', ['--category', 'cat-x', '--home', 'toolkit', '--label', 'x']);
  refused('record-fix refuses free text in the version',
    ['--category', 'cat-x', '--home', 'toolkit', '--label', 'x', '--version', '7.7.0; FIX_VERSION_MARKER']);
  refused('record-fix refuses a version on a fix that is not a toolkit fix',
    ['--category', 'cat-x', '--home', 'global', '--label', 'x', '--version', '7.7.0']);
  refused('record-fix refuses a project fix outside a git repository', ['--category', 'cat-x', '--home', 'project', '--label', 'x']);
  const ok = tryFix(['--category', 'cat-x', '--home', 'global', '--label', 'read the source before answering']);
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(fixes, 'utf-8').trim()); } catch (e) { /* checked below */ }
  check('record-fix stores the fix with the exact time and a before snapshot',
    ok.status === 0 && isoOrNullTest(stored.at) && stored.home === 'global' && stored.version === null &&
    !!stored.before && stored.before.cycles === 0 && stored.before.rows === 0 && stored.before.rate === null,
    ok.stdout + ok.stderr);
  const r = JSON.parse(run(sb, ['--show-rollup']));
  check('the rollup lists the recorded fix with its label and home',
    r.fixes.length === 1 && r.fixes[0].label === 'read the source before answering' && r.fixes[0].home === 'global',
    JSON.stringify(r.fixes));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- issue #229: a heartbeat records the toolkit version a plugin install runs ----
// A plugin install has .claude-plugin/plugin.json one folder above scripts/; the
// source copy and a copy-install have none and record null.
{
  const sb = makeSandbox('version229');
  const pluginRoot = path.join(sb.root, 'plugin-copy');
  fs.mkdirSync(path.join(pluginRoot, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(pluginRoot, 'scripts', 'correction-ledger.js'));
  fs.writeFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'tk', version: '9.8.7' }), 'utf-8');
  execFileSync('node', [path.join(pluginRoot, 'scripts', 'correction-ledger.js'), '--heartbeat'],
    { cwd: sb.proj, env: Object.assign({}, process.env, { HOME: sb.home }), encoding: 'utf-8' });
  run(sb, ['--heartbeat']);
  const beats = fs.readFileSync(path.join(sb.home, '.claude', 'correction-heartbeat.jsonl'), 'utf-8')
    .trim().split('\n').map(function (l) { return JSON.parse(l); });
  check('a plugin install\'s heartbeat records its toolkit version', beats[0].toolkit_version === '9.8.7', JSON.stringify(beats[0].toolkit_version));
  check('the source copy\'s heartbeat records no version', beats[1].toolkit_version === null, JSON.stringify(beats[1].toolkit_version));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- issue #229: older rows are filled in through a side file, never re-added ----
// A row written before the request and rewrite fields existed can have them
// filled in from its transcript, if the transcript is still on disk. The fill goes
// to correction-backfill.jsonl, keyed by the row's `at` and `session`; the ledger
// is never rewritten and no row is added. Each row the backfill cannot use is
// counted, by reason.
{
  const sb = makeSandbox('backfill229');
  const bf = path.join(sb.root, 'bf');
  const bf2 = path.join(sb.root, 'bf2');
  [bf, bf2].forEach(function (dir) {
    const g = function (args) { return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }); };
    fs.mkdirSync(dir, { recursive: true });
    g(['init', '-q']); g(['config', 'user.email', 'test@example.com']); g(['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(dir, 'README.md'), 'x\n', 'utf-8');
    g(['add', 'README.md']); g(['commit', '-qm', 'init']);
  });
  const claudeDir = path.join(sb.home, '.claude');
  const tdir = path.join(claudeDir, 'projects', fs.realpathSync(bf).replace(/[/\\]/g, '-'));
  fs.mkdirSync(tdir, { recursive: true });
  const asst = function (t) { return JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } }); };
  const user = function (t, ts) { return JSON.stringify({ type: 'user', timestamp: ts, sessionId: 'sess-b1', message: { content: t } }); };
  fs.writeFileSync(path.join(tdir, 'sess-b1.jsonl'), [
    user('Draft the release note for the CLI.', '2026-09-22T10:00:00.000Z'),
    asst('Here is a note about the history of the CLI.'),
    user('No, I want it to say: Install with one command, then run it.', '2026-09-22T10:01:00.000Z')
  ].join('\n') + '\n', 'utf-8');
  const real = fs.realpathSync(bf);
  const old = function (at, session, extra) {
    return JSON.stringify(Object.assign({ at: at, repo: 'bf', repo_path: real, kind: 'human', scope: 'project',
      stage: 'document', produced: 'p', correction: 'c', open_code: 'bf code', axial_code: null, session: session }, extra || {}));
  };
  fs.writeFileSync(path.join(claudeDir, 'correction-ledger.jsonl'), [
    old('2026-09-22T10:01:00.000Z', 'sess-b1'),                          // fillable
    old('2026-09-22T11:00:00.000Z', 'sess-b1'),                          // no message at that time
    old('2026-09-22T12:00:00.000Z', ''),                                 // no session recorded
    old('2026-09-22T12:30:00.000Z', '../../etc/passwd'),                 // not a plain session id
    old('2026-09-22T13:00:00.000Z', 'sess-gone'),                        // transcript gone
    old('2026-09-22T14:00:00.000Z', 'sess-b1', { trigger: '', rewrite: '' }), // already has the fields
    JSON.stringify({ at: '2026-09-22T15:00:00.000Z', repo: 'bf2', repo_path: fs.realpathSync(bf2), kind: 'human',
      scope: 'project', stage: 'document', produced: '', correction: '', open_code: 'bf code', axial_code: null, session: 'sess-x' })
  ].join('\n') + '\n', 'utf-8');
  fs.writeFileSync(path.join(claudeDir, 'correction-axial-map.json'), JSON.stringify({ 'bf code': 'cat-bf' }), 'utf-8');
  const sidefile = path.join(claudeDir, 'correction-backfill.jsonl');
  try {
    const c = JSON.parse(run(sb, ['--backfill-candidates'], { cwd: bf }));
    check('backfill lists only the row it can fill, with the exchange around it',
      c.candidates.length === 1 && c.candidates[0].backfill === true &&
      c.candidates[0].asked === 'Draft the release note for the CLI.' &&
      c.candidates[0].human_said.indexOf('Install with one command') !== -1, JSON.stringify(c.candidates).slice(0, 200));
    check('backfill counts each row it could not use, by reason',
      JSON.stringify(c.counts) === JSON.stringify({ repo_rows: 6, not_needed: 1, already_filled: 0, no_session: 2, transcript_gone: 1, no_match: 1, candidates: 1 }),
      JSON.stringify(c.counts));
    const fill = function (entries) { return runRaw(sb, ['--add-backfill', '--data', writeRows(sb, entries)], { cwd: bf }); };
    const good = { at: '2026-09-22T10:01:00.000Z', session: 'sess-b1', trigger: 'asked for a CLI release note', rewrite: 'Install with one command, then run it.' };
    let r = fill([{ at: '2026-09-22T15:00:00.000Z', session: 'sess-x', trigger: 'x', rewrite: '' }]);
    check('backfill refuses an entry for another repo\'s row', r.status !== 0 && !fs.existsSync(sidefile), 'exit ' + r.status);
    r = fill([good, { at: '2026-09-22T11:00:00.000Z', session: 'nope', trigger: 'x', rewrite: '' }]);
    check('a backfill batch with one bad entry writes nothing', r.status !== 0 && !fs.existsSync(sidefile), 'exit ' + r.status);
    r = fill([{ at: good.at, session: good.session, trigger: '', rewrite: '' }]);
    check('backfill refuses an entry with neither field', r.status !== 0 && !fs.existsSync(sidefile), 'exit ' + r.status);
    const handoff = writeRows(sb, [good]);
    r = runRaw(sb, ['--add-backfill', '--data', handoff], { cwd: bf });
    check('backfill writes an accepted entry to the side file and deletes the hand-off file',
      r.status === 0 && fs.existsSync(sidefile) && !fs.existsSync(handoff), 'exit ' + r.status + ' ' + r.stderr);
    r = fill([good]);
    check('backfill refuses to fill the same row twice',
      r.status !== 0 && fs.readFileSync(sidefile, 'utf-8').trim().split('\n').length === 1, 'exit ' + r.status);
    const ev = JSON.parse(run(sb, ['--evidence', '--category', 'cat-bf'], { cwd: bf }));
    const filled = ev.rows.filter(function (x) { return x.at === good.at; })[0] || {};
    check('the evidence read joins the filled-in fields onto their row',
      filled.backfilled === true && filled.trigger === good.trigger && filled.rewrite === good.rewrite, JSON.stringify(filled));
    check('the ledger itself is never rewritten by a backfill',
      fs.readFileSync(path.join(claudeDir, 'correction-ledger.jsonl'), 'utf-8').indexOf('asked for a CLI release note') === -1);
    const roll = run(sb, ['--show-rollup']);
    check('the rollup counts filled rows and carries none of their text',
      JSON.parse(roll).backfilled === 1 && roll.indexOf('asked for a CLI release note') === -1 && roll.indexOf('Install with one command') === -1,
      roll.slice(0, 120));
  } catch (e) {
    check('backfill test ran end to end', false, e.message);
  }
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- issue #229: stage is checked against the extractor's list -------------------
// `stage` is on the shareable whitelist, and was only trimmed to 40 characters: a
// free-text channel through the projection, the hole `at` had before isoOrNull().
{
  const sb = makeSandbox('stage229');
  run(sb, ['--add', '--data', writeRows(sb, [
    { scope: 'toolkit', stage: '/tk:Review', open_code: 'stage normalization probe' },
    { scope: 'toolkit', stage: 'STAGE_LEAK_MARKER a free-text sentence', open_code: 'stage normalization probe' },
    { scope: 'toolkit', open_code: 'stage normalization probe' }
  ])]);
  const stored = fs.readFileSync(ledgerFile(sb), 'utf-8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
  check('a stage spelled as a command is stored as the stage name', stored[0].stage === 'review', stored[0].stage);
  check('free text in stage is never stored',
    stored[1].stage === 'other' && fs.readFileSync(ledgerFile(sb), 'utf-8').indexOf('STAGE_LEAK_MARKER') === -1,
    stored[1].stage);
  check('a missing stage is stored as unknown', stored[2].stage === 'unknown', stored[2].stage);
  // An older row written before the check: the projection normalizes it too. The
  // rollup prints no stage text today, so this guards against later widening.
  fs.appendFileSync(ledgerFile(sb), JSON.stringify({
    at: '2026-09-01T10:00:00.000Z', repo: 'proj', kind: 'human', scope: 'toolkit',
    stage: 'OLD_STAGE_LEAK_MARKER spilled', produced: '', correction: '', open_code: 'stage normalization probe', axial_code: null
  }) + '\n', 'utf-8');
  const out = run(sb, ['--rollup']);
  check('free text in an older row\'s stage never reaches the rollup',
    out.indexOf('OLD_STAGE_LEAK_MARKER') === -1 && fs.readFileSync(rollupFile(sb), 'utf-8').indexOf('OLD_STAGE_LEAK_MARKER') === -1);
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- 3. concurrent appends -------------------------------------------------
{
  const sb = makeSandbox('concurrent');
  const WRITERS = 5, PER_WRITER = 4;
  const files = [];
  for (let i = 0; i < WRITERS; i++) {
    const rows = [];
    for (let j = 0; j < PER_WRITER; j++) {
      rows.push({ scope: 'project', stage: 'execute', produced: 'p' + i, correction: 'c' + j, open_code: 'writer ' + i + ' row ' + j });
    }
    files.push(writeRows(sb, rows));
  }
  Promise.all(files.map(function (f) {
    return new Promise(function (resolve, reject) {
      const p = spawn('node', [SCRIPT, '--add', '--data', f], {
        cwd: sb.proj, env: Object.assign({}, process.env, { HOME: sb.home })
      });
      p.on('close', function (code) { code === 0 ? resolve() : reject(new Error('exit ' + code)); });
    });
  })).then(function () {
    const raw = fs.readFileSync(ledgerFile(sb), 'utf-8').split('\n').filter(Boolean);
    let parsed = 0;
    raw.forEach(function (l) { try { JSON.parse(l); parsed++; } catch (e) { /* torn */ } });
    check('every concurrent append landed', raw.length === WRITERS * PER_WRITER, 'got ' + raw.length + ' of ' + (WRITERS * PER_WRITER));
    check('no concurrent append was torn', parsed === raw.length, parsed + ' of ' + raw.length + ' parse');
    fs.rmSync(sb.root, { recursive: true, force: true });
    finish();
  }).catch(function (e) {
    check('concurrent appends ran', false, e.message);
    finish();
  });
}

// --- 9. the tripwire flags a force-added ledger ----------------------------
// --- 248 cycle-time: where a cycle's time went (issue #248) ---------------------
// --cycle-time reads the session logs of every working copy of the repository
// and splits the cycle's window into Claude working, tests, helper agents,
// waiting on the user and away, with counts. Numbers only: the fixtures plant a
// canary in a typed message, a reply, a command and a path, and none may reach
// the output. Every timestamp is fixed, and --until pins the window's end, so
// each expected number is worked out by hand in the comments below.
function cycleTimeTest() {
  console.log('\n248 cycle-time');
  const T0 = Date.parse('2026-10-01T10:00:00.000Z');
  const at = (s) => new Date(T0 + s * 1000).toISOString();
  const human = (s, text) => ({ type: 'user', timestamp: at(s), origin: { kind: 'human' }, message: { content: text } });
  const command = (s, name, args) => ({ type: 'user', timestamp: at(s), origin: { kind: 'human' },
    message: { content: '<command-message>' + name.slice(1) + '</command-message>\n<command-name>' + name + '</command-name>\n<command-args>' + (args || '') + '</command-args>' } });
  const say = (s, text) => ({ type: 'assistant', timestamp: at(s), message: { content: [{ type: 'text', text: text }] } });
  const tool = (s, id, name, input) => ({ type: 'assistant', timestamp: at(s), message: { content: [{ type: 'tool_use', id: id, name: name, input: input }] } });
  const result = (s, id, extra) => ({ type: 'user', timestamp: at(s), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }, toolUseResult: extra || {} });
  const notice = (s, id) => ({ type: 'user', timestamp: at(s), origin: { kind: 'task-notification' },
    message: { content: '<task-notification>\n<task-id>bg-' + id + '</task-id>\n<tool-use-id>' + id + '</tool-use-id>\n<status>completed</status>\n</task-notification>' } });
  const enc = (p) => p.replace(/[^A-Za-z0-9]/g, '-');
  const writeLog = (sb, folderPath, name, entries) => {
    const dir = path.join(sb.home, '.claude', 'projects', enc(folderPath));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name + '.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return dir;
  };
  const cycle = (sb, args) => {
    const r = runRaw(sb, ['--cycle-time'].concat(args || []));
    let json = null;
    try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: json };
  };
  const sum = (ms) => ms ? ms.claude + ms.tests + ms.agents + ms.waiting + ms.away : -1;
  const one = (x) => String(x).replace(/\s+/g, ' ').slice(0, 400);

  // --- A: one session, every category ----------------------------------------
  // Turn 1 runs 0-190 s; a background test runs 170-400 s; its notice at 400 s
  // starts a short machine turn to 410 s; the owner answers at 790 s (a 380 s
  // wait), and after turn 2 (790-810 s) is away for 20 minutes (1,200 s).
  //   tests   20-80 + 170-400                    = 290
  //   agents  90-150                              = 60
  //   claude  0-20, 80-90, 150-170 (turn 1 = 50), 400-410, 790-810, 2010-2020,
  //           and 2020-2030 to the window's end  = 100
  //   waiting 190-400 lies under the test; 410-790 = 380
  //   away    810-2010                            = 1,200     total 2,030 s
  // One quiet stretch: 10-180 s in turn 1 shows no text for 170 s.
  const a = makeSandbox('cycle-a');
  const logA = [
    command(-3600, '/document'),
    say(-3000, 'Documented.'),
    command(0, '/explore', 'issue 7'),
    say(10, 'Reading CANARY-REPLY-7f3 first.'),
    tool(15, 'r1', 'Read', { file_path: '/x/CANARY-PATH-7f3.md' }),
    result(16, 'r1'),
    tool(20, 't1', 'Bash', { command: 'npm test -- CANARY-CMD-7f3' }),
    result(80, 't1', { durationMs: 60000 }),
    tool(90, 'a1', 'Agent', { description: 'map it', prompt: 'p' }),
    result(150, 'a1', { agentId: 'x1', totalDurationMs: 60000 }),
    tool(160, 'a2', 'Agent', { description: 'later', prompt: 'p' }),
    result(161, 'a2', { agentId: 'x2', isAsync: true }),
    tool(170, 't2', 'Bash', { command: 'node .claude/scripts/run-checks.js --checks c.json --out reports/o --full', run_in_background: true }),
    result(171, 't2', { backgroundTaskId: 'bg-t2' }),
    say(180, 'Started the suite.'),
    say(190, 'Which option?'),
    notice(400, 't2'),
    say(410, 'The suite passed.'),
    human(790, 'Pick the first one, CANARY-TYPED-7f3.'),
    say(800, 'On it.'),
    say(810, 'Done.'),
    human(2010, 'Thanks, carry on.'),
    say(2020, 'Next step.'),
  ];
  const dirA = writeLog(a, a.proj, 'sess-a', logA);
  // A subagent's log is the toolkit talking to itself: never read.
  fs.mkdirSync(path.join(dirA, 'sess-a', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(dirA, 'sess-a', 'subagents', 'agent-x1.jsonl'),
    [human(100, 'a prompt the toolkit wrote'), tool(101, 's1', 'Bash', { command: 'npm test' }), result(500, 's1')].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const ra = cycle(a, ['--until', at(2030)]);
  const ja = ra.json || {};
  check('248 cycle-time: the window starts at the first stage after the previous document run',
    ra.status === 0 && !!ja.window && ja.window.start === at(0) && ja.window.end === at(2030) && ja.window.ms === 2030000 && ja.window.from === 'previous-document',
    one(ra.stdout + ra.stderr));
  check('248 cycle-time: the five categories add up to the window', !!ja.ms && sum(ja.ms) === 2030000, one(JSON.stringify(ja.ms)));
  check('248 cycle-time: a foreground test call and a background one (launch to notice) count as tests', !!ja.ms && ja.ms.tests === 290000, one(JSON.stringify(ja.ms)));
  check('248 cycle-time: a foreground helper agent counts its time; a background one is counted with no time',
    !!ja.ms && ja.ms.agents === 60000 && !!ja.counts && ja.counts.agents === 1 && ja.counts.backgroundAgents === 1, one(JSON.stringify(ja)));
  check('248 cycle-time: a 380 s gap after Claude\'s turn is waiting and a 20-minute one is away',
    !!ja.ms && ja.ms.waiting === 380000 && ja.ms.away === 1200000 && ja.ms.claude === 100000, one(JSON.stringify(ja.ms)));
  check('248 cycle-time: a 170 s stretch with no Claude text inside a turn is one quiet stretch', !!ja.counts && ja.counts.quiet === 1, one(JSON.stringify(ja.counts)));
  check('248 cycle-time: turns count the owner\'s messages, test runs count both test calls, and subagent logs are never read',
    !!ja.counts && ja.counts.turns === 3 && ja.counts.testRuns === 2, one(JSON.stringify(ja.counts)));
  check('248 cycle-time: no typed message, reply, command or path reaches the output', ra.stdout.length > 0 && !/CANARY/.test(ra.stdout + ra.stderr), one(ra.stdout));
  fs.writeFileSync(path.join(a.proj, '.claude', '.no-correction-log'), '');
  const optedOut = cycle(a, ['--until', at(2030)]);
  check('248 cycle-time: an opted-out repo prints optedOut and nothing else', optedOut.status === 0 && optedOut.stdout.trim() === '{"optedOut":true}', one(optedOut.stdout));

  // --- B: a chained stage, the tk: prefix, no earlier document, --since -------
  // The first window runs from the first stage in the logs (no document before
  // it). A document the chain ran through the Skill tool at 600 s ends that
  // cycle; the next starts at the typed create-plan at 700 s; the document
  // running now (900 s) is not the previous one.
  const b = makeSandbox('cycle-b');
  const logB = [
    human(0, 'Hello there, what is open?'),
    say(10, 'Two issues.'),
    command(60, '/tk:explore', '9'),
    say(70, 'Exploring.'),
    tool(120, 'k1', 'Skill', { skill: 'tk:create-plan' }),
    result(121, 'k1'),
    say(130, 'Plan ready.'),
    tool(600, 'k2', 'Skill', { skill: 'document' }),
    result(601, 'k2'),
    say(610, 'Documented.'),
    command(700, '/tk:create-plan', '10'),
    say(710, 'Planning.'),
    tool(900, 'k3', 'Skill', { skill: 'tk:document' }),
    result(901, 'k3'),
  ];
  writeLog(b, b.proj, 'sess-b', logB);
  const rb = cycle(b, ['--until', at(910)]);
  check('248 cycle-time: a document the chain ran through the Skill tool ends the cycle, and the one running now does not',
    rb.status === 0 && !!rb.json && rb.json.window.start === at(700) && rb.json.window.from === 'previous-document' && sum(rb.json.ms) === 210000,
    one(rb.stdout + rb.stderr));
  const rb2 = cycle(b, ['--until', at(500)]);
  check('248 cycle-time: with no earlier document the window starts at the first stage in the logs, and says so',
    rb2.status === 0 && !!rb2.json && rb2.json.window.start === at(60) && rb2.json.window.from === 'first-stage', one(rb2.stdout + rb2.stderr));
  const rb3 = cycle(b, ['--since', at(30), '--until', at(500)]);
  check('248 cycle-time: --since sets the start', rb3.status === 0 && !!rb3.json && rb3.json.window.start === at(30) && rb3.json.window.from === 'since' && sum(rb3.json.ms) === 470000, one(rb3.stdout + rb3.stderr));
  const rb4 = cycle(b, ['--since', 'yesterday']);
  check('248 cycle-time: a --since that is not a time is refused', rb4.status !== 0 && /--since/.test(rb4.stderr), one(rb4.stdout + rb4.stderr));

  // --- C: worktrees, a removed worktree, and two sessions at once --------------
  // The main copy explores (0-10 s) and a second main-copy session overlaps it
  // (5-50 s); a live worktree builds (200-210 s); a removed worktree's folder
  // still holds a session (300-310 s). Merged, the window 0-320 s is counted
  // once: the categories add to 320 s, never more.
  const c = makeSandbox('cycle-c');
  const g = (args, cwd) => execFileSync('git', args, { cwd: cwd || c.proj, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' }) });
  g(['init', '-q']);
  fs.writeFileSync(path.join(c.proj, 'f.txt'), 'x\n');
  g(['add', 'f.txt']);
  g(['commit', '-qm', 'init']);
  const wt = path.join(c.proj, '.claude', 'worktrees', 'w1');
  g(['worktree', 'add', '-q', '-b', 'w1', wt]);
  const main = fs.realpathSync(c.proj);
  writeLog(c, main, 'm1', [command(0, '/explore'), say(10, 'Exploring.'), human(100, 'Go on.'), say(110, 'Planned.')]);
  writeLog(c, main, 'm2', [human(5, 'A side question here.'), say(50, 'Answered.')]);
  writeLog(c, fs.realpathSync(wt), 'w1', [human(200, 'Build it now please.'), say(210, 'Built.')]);
  writeLog(c, path.join(main, '.claude', 'worktrees', 'gone'), 'g1', [human(300, 'Review it now please.'), say(310, 'Reviewed.')]);
  const rc = cycle(c, ['--until', at(320)]);
  const jc = rc.json || {};
  check('248 cycle-time: a cycle split across the main copy, a worktree and a removed worktree is counted whole',
    rc.status === 0 && !!jc.counts && jc.counts.turns === 5 && jc.window.start === at(0), one(rc.stdout + rc.stderr));
  check('248 cycle-time: two sessions at once are not counted twice', !!jc.ms && sum(jc.ms) === 320000, one(JSON.stringify(jc.ms)));
  const fromWt = runRaw(c, ['--cycle-time', '--until', at(320)], { cwd: wt });
  let jw = null;
  try { jw = JSON.parse(fromWt.stdout); } catch (e) { jw = null; }
  check('248 cycle-time: run from inside the worktree, it reads the same logs', !!jw && JSON.stringify(jw.ms) === JSON.stringify(jc.ms), one(fromWt.stdout + fromWt.stderr));
  check('249 cycle-time: a worktree with no stage of its own takes the main copy\'s window and counts every copy that only continued it',
    !!jw && !!jw.window && jw.window.start === at(0) && !!jw.counts && jw.counts.sessions === 4 && jw.counts.turns === 5, one(fromWt.stdout + fromWt.stderr));

  // --- F: two worktrees, each running a cycle of its own (issue #249) ---------
  // Worktree A explores at 0 s and builds until 520 s. Worktree B runs its own
  // cycle beside it: it explores at 100 s, documents at 300 s and starts its
  // next cycle at 400 s. The main copy only documented an hour before. Read
  // from A, only A's session counts, and B's document stage does not cut A's
  // window (merged, the markers put the window at 400 s); read from B, A's
  // parallel cycle is left out of B's window, 400-600 s.
  const f = makeSandbox('cycle-f');
  const gf = (args, cwd) => execFileSync('git', args, { cwd: cwd || f.proj, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' }) });
  gf(['init', '-q']);
  fs.writeFileSync(path.join(f.proj, 'f.txt'), 'x\n');
  gf(['add', 'f.txt']);
  gf(['commit', '-qm', 'init']);
  const wa = path.join(f.proj, '.claude', 'worktrees', 'wa');
  const wb = path.join(f.proj, '.claude', 'worktrees', 'wb');
  gf(['worktree', 'add', '-q', '-b', 'wa', wa]);
  gf(['worktree', 'add', '-q', '-b', 'wb', wb]);
  writeLog(f, fs.realpathSync(f.proj), 'm0', [command(-3600, '/document'), say(-3500, 'Documented.')]);
  writeLog(f, fs.realpathSync(wa), 'a1', [command(0, '/explore', 'issue 1'), say(20, 'A explores.'), human(500, 'Build A now please.'), say(520, 'A built.')]);
  writeLog(f, fs.realpathSync(wb), 'b1', [command(100, '/explore', 'issue 2'), say(120, 'B explores.'), command(300, '/document'), say(320, 'B documented.'),
    command(400, '/explore', 'issue 3'), say(420, 'B explores again.')]);
  const fromA = runRaw(f, ['--cycle-time', '--until', at(600)], { cwd: wa });
  let ja2 = null;
  try { ja2 = JSON.parse(fromA.stdout); } catch (err) { ja2 = null; }
  check('249 cycle-time: read from one of two worktrees each running its own cycle, only its own sessions count',
    !!ja2 && !!ja2.counts && ja2.counts.sessions === 1 && ja2.counts.turns === 2 && sum(ja2.ms) === 600000, one(fromA.stdout + fromA.stderr));
  check('249 cycle-time: another worktree\'s document stage does not cut this cycle\'s window',
    !!ja2 && !!ja2.window && ja2.window.start === at(0), one(fromA.stdout + fromA.stderr));
  const fromB = runRaw(f, ['--cycle-time', '--until', at(600)], { cwd: wb });
  let jb2 = null;
  try { jb2 = JSON.parse(fromB.stdout); } catch (err) { jb2 = null; }
  check('249 cycle-time: read from the other worktree, the first worktree\'s parallel cycle is left out',
    !!jb2 && !!jb2.window && jb2.window.start === at(400) && jb2.window.from === 'previous-document' && !!jb2.counts && jb2.counts.sessions === 1 && jb2.counts.turns === 1,
    one(fromB.stdout + fromB.stderr));

  // --- D: a question Claude asks the owner with the question tool -------------
  // The wait for the answer is the owner's time, not Claude's: 20-320 s is
  // waiting, 340-1840 s (25 minutes) is away. The question is on screen, so it
  // ends a quiet stretch, and the answer starts a new one.
  //   claude 0-20, 320-340, 1840-1850, 1850-1860 = 60; waiting 300; away 1,500
  const d = makeSandbox('cycle-d');
  writeLog(d, d.proj, 'sess-d', [
    command(0, '/explore'),
    say(10, 'Two choices.'),
    tool(20, 'q1', 'AskUserQuestion', { questions: [] }),
    result(320, 'q1', { answers: {} }),
    say(330, 'Going with the first.'),
    tool(340, 'q2', 'AskUserQuestion', { questions: [] }),
    result(1840, 'q2', { answers: {} }),
    say(1850, 'Done.'),
  ]);
  const rd = cycle(d, ['--until', at(1860)]);
  const jd = rd.json || {};
  check('248 cycle-time: the wait for an answer to the question tool is waiting, or away past 15 minutes, never Claude working',
    rd.status === 0 && !!jd.ms && jd.ms.waiting === 300000 && jd.ms.away === 1500000 && jd.ms.claude === 60000 && sum(jd.ms) === 1860000,
    one(rd.stdout + rd.stderr));
  check('248 cycle-time: a question on screen is visible output, so a wait for its answer is no quiet stretch', !!jd.counts && jd.counts.quiet === 0, one(JSON.stringify(jd.counts)));

  // --- E: calls that never got an answer (review of #248, R1) -----------------
  // A session that died mid test call, and a background run whose finish
  // notice never came, must stop at their session's last entry, not run on to
  // the window's end and swallow everything after them as tests.
  //   e1: the test call at 10 s is the session's last entry: 0 s of tests.
  //   e2: a background run launched at 110 s, last entry at 120 s: 10 s.
  const e = makeSandbox('cycle-e');
  writeLog(e, e.proj, 'e1', [command(0, '/explore'), say(5, 'Running the suite.'), tool(10, 'u1', 'Bash', { command: 'npm test' })]);
  writeLog(e, e.proj, 'e2', [human(100, 'Picking this up again now.'), tool(110, 'u2', 'Bash', { command: 'npm test', run_in_background: true }),
    result(111, 'u2', { backgroundTaskId: 'bg-u2' }), say(120, 'Started.')]);
  const re = cycle(e, ['--until', at(1000)]);
  check('248 cycle-time: a call with no result, or a background run with no notice, stops at its session\'s last entry',
    re.status === 0 && !!re.json && re.json.ms.tests === 10000 && sum(re.json.ms) === 1000000, one(re.stdout + re.stderr));
}

function tripwireTest() {
  const sb = makeSandbox('tripwire');
  const repo = path.join(sb.root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const g = function (args) {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  };
  try {
    g(['init', '-q']);
    g(['config', 'user.email', 'test@example.com']);
    g(['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(repo, '.gitignore'), 'correction-ledger.jsonl\n', 'utf-8');
    g(['add', '.gitignore']); g(['commit', '-qm', 'init']);
    // Force past .gitignore: exactly the case gitignore cannot stop.
    fs.writeFileSync(path.join(repo, 'correction-ledger.jsonl'), '{"open_code":"x"}\n', 'utf-8');
    g(['add', '-f', 'correction-ledger.jsonl']); g(['commit', '-qm', 'oops']);

    let exitCode = 0, output = '';
    try {
      output = execFileSync('node', [TRIPWIRE], { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      exitCode = e.status; output = String(e.stdout || '') + String(e.stderr || '');
    }
    check('tripwire blocks a force-added ledger file', exitCode !== 0, 'exit ' + exitCode);
    check('tripwire names the offending file', output.indexOf('correction-ledger.jsonl') !== -1);
  } catch (e) {
    check('tripwire test set up a git repo', false, e.message);
  }
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- the tripwire reads binary sections, not just text hunks -----------------
// git prints one "Binary files ... differ" line for a binary and no hunks, and
// the parser had no branch for it, so a committed .pfx passed in silence against
// the fail-closed contract (holistic review, R20). The line is drawn at the
// name: a binary named like a secret container blocks; an image does not.
function tripwireBinaryTest() {
  const sb = makeSandbox('binary');
  const repo = path.join(sb.root, 'repo');
  fs.mkdirSync(path.join(repo, 'certs'), { recursive: true });
  const g = function (args) {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  };
  const tripwire = function () {
    const r = spawnSync('node', [TRIPWIRE], { cwd: repo, encoding: 'utf-8' });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  };
  // A NUL byte among the first bytes is what makes git treat a file as binary.
  const blob = Buffer.alloc(64, 0); blob[0] = 0x30; blob[1] = 0x82;
  try {
    g(['init', '-q']);
    g(['config', 'user.email', 'test@example.com']);
    g(['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(repo, 'logo.png'), blob);
    g(['add', 'logo.png']); g(['commit', '-qm', 'add image']);
    const quiet = tripwire();
    check('tripwire stays silent on an added binary that is not a secret container',
      quiet.status === 0 && quiet.stdout === '', 'exit ' + quiet.status + ' ' + quiet.stdout);

    // The same bytes under secret-container names, one of them containing the
    // " and " that the binary notice itself is written around.
    fs.writeFileSync(path.join(repo, 'certs', 'client.pfx'), blob);
    fs.writeFileSync(path.join(repo, 'certs', 'staging and prod.p12'), blob);
    g(['add', 'certs']); g(['commit', '-qm', 'add certs']);
    const loud = tripwire();
    check('tripwire blocks an added binary secret container (.pfx)',
      loud.status === 1, 'exit ' + loud.status + ' - a binary the scanner cannot read passed in silence');
    check('tripwire names the binary it could not scan',
      loud.stdout.indexOf('certs/client.pfx') !== -1, loud.stdout);
    check('tripwire resolves a binary name containing " and "',
      loud.stdout.indexOf('certs/staging and prod.p12') !== -1, loud.stdout);
  } catch (e) {
    check('tripwire binary test set up a git repo', false, e.message);
  }
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- review of #229, R15: a fill-in gets the context capture would have given ----
// --backfill-candidates had its own copy of the transcript walk, and the copy had
// already drifted: it read one session file, so a row drafted from the opening
// message of a new session, answering an interrupt in the session before it, came
// back with no output to react to. Both modes now share one walk.
{
  const sb = makeSandbox('backfillpair229');
  const repo = path.join(sb.root, 'pair');
  const g = function (args) { return execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }); };
  fs.mkdirSync(repo, { recursive: true });
  g(['init', '-q']); g(['config', 'user.email', 'test@example.com']); g(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'x\n', 'utf-8');
  g(['add', 'README.md']); g(['commit', '-qm', 'init']);
  const real = fs.realpathSync(repo);
  const claudeDir = path.join(sb.home, '.claude');
  const tdir = path.join(claudeDir, 'projects', real.replace(/[/\\]/g, '-'));
  fs.mkdirSync(tdir, { recursive: true });
  const asst = function (t) { return JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } }); };
  const user = function (t, ts, sid) { return JSON.stringify({ type: 'user', timestamp: ts, sessionId: sid, message: { content: t } }); };
  fs.writeFileSync(path.join(tdir, 'sess-p1.jsonl'), [
    user('Move the settings page under the account menu.', '2026-09-23T10:00:00.000Z', 'sess-p1'),
    asst('Moving it under the help menu.'),
    user('[Request interrupted by user]', '2026-09-23T10:00:30.000Z', 'sess-p1')
  ].join('\n') + '\n', 'utf-8');
  fs.writeFileSync(path.join(tdir, 'sess-p2.jsonl'),
    user('No, the account menu, as I asked.', '2026-09-23T10:02:00.000Z', 'sess-p2') + '\n', 'utf-8');
  fs.writeFileSync(path.join(claudeDir, 'correction-ledger.jsonl'), JSON.stringify({ at: '2026-09-23T10:02:00.000Z',
    repo: 'pair', repo_path: real, kind: 'human', scope: 'project', stage: 'execute', produced: 'p', correction: 'c',
    open_code: 'pair code', axial_code: null, session: 'sess-p2' }) + '\n', 'utf-8');
  let c = null;
  try { c = JSON.parse(run(sb, ['--backfill-candidates'], { cwd: repo })); } catch (e) { c = { error: e.message }; }
  const cand = ((c && c.candidates) || [])[0] || {};
  check('a fill-in for a reply to another session\'s interrupt gets the output that was cut off, as capture does',
    cand.assistant_said === 'Moving it under the help menu.' && cand.asked === 'Move the settings page under the account menu.',
    JSON.stringify(c).slice(0, 240));
  let same = {};
  try {
    const cap = JSON.parse(run(sb, ['--candidates', '--since', '2026-09-23T00:00:00.000Z'], { cwd: repo }));
    same = cap.candidates.filter(function (x) { return x.at === '2026-09-23T10:02:00.000Z'; })[0] || {};
  } catch (e) { same = { error: e.message }; }
  check('capture and the fill-in give that message the same context',
    same.assistant_said === cand.assistant_said && same.asked === cand.asked && same.human_said === cand.human_said,
    JSON.stringify(same).slice(0, 240));
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- issue #229: the tripwire refuses the fix records and the backfill file too --
// The backfill side file carries filled-in private text; the fix records are a
// per-machine record. Both join the never-push list, which also catches `git add -f`.
function tripwireNewFilesTest() {
  const sb = makeSandbox('tripwire229');
  const repo = path.join(sb.root, 'repo');
  fs.mkdirSync(path.join(repo, 'notes'), { recursive: true });
  const g = function (args) {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  };
  try {
    g(['init', '-q']);
    g(['config', 'user.email', 'test@example.com']);
    g(['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(repo, 'README.md'), 'x\n', 'utf-8');
    g(['add', 'README.md']); g(['commit', '-qm', 'init']);
    fs.writeFileSync(path.join(repo, 'notes', 'correction-fixes.jsonl'), '{"category":"x"}\n', 'utf-8');
    fs.writeFileSync(path.join(repo, 'notes', 'correction-backfill.jsonl'), '{"trigger":"x"}\n', 'utf-8');
    g(['add', '-f', 'notes']); g(['commit', '-qm', 'oops']);
    const r = spawnSync('node', [TRIPWIRE], { cwd: repo, encoding: 'utf-8' });
    const said = (r.stdout || '') + (r.stderr || '');
    check('tripwire blocks a pushed fix record or backfill side file', r.status !== 0, 'exit ' + r.status);
    check('tripwire names both new ledger files',
      said.indexOf('correction-fixes.jsonl') !== -1 && said.indexOf('correction-backfill.jsonl') !== -1, said.slice(0, 300));
  } catch (e) {
    check('tripwire new-files test set up a git repo', false, e.message);
  }
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// --- issue #238: the tripwire refuses both hand-off files by name -------------
// /document writes its rows as correction-rows.json and the error-analysis
// backfill writes correction-backfill-rows.json, each in a fresh /tmp folder.
// Both carry the private fields untruncated, and the names stay distinctive so
// the never-push list catches one that lands in a repo. Each runs in its own
// repo, so one name's block can never hide the other's absence. The detail is
// one line: the release gate prints only a failing suite's last 15 lines.
function tripwireHandoffTest() {
  const pushOne = function (label, name) {
    const sb = makeSandbox(label);
    const repo = path.join(sb.root, 'repo');
    fs.mkdirSync(path.join(repo, 'notes'), { recursive: true });
    const g = function (args) {
      return execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    };
    try {
      g(['init', '-q']);
      g(['config', 'user.email', 'test@example.com']);
      g(['config', 'user.name', 'Test']);
      fs.writeFileSync(path.join(repo, 'README.md'), 'x\n', 'utf-8');
      g(['add', 'README.md']); g(['commit', '-qm', 'init']);
      fs.writeFileSync(path.join(repo, 'notes', name), '[{"open_code":"x"}]\n', 'utf-8');
      g(['add', '-f', 'notes']); g(['commit', '-qm', 'oops']);
      const r = spawnSync('node', [TRIPWIRE], { cwd: repo, encoding: 'utf-8' });
      return { status: r.status, said: ((r.stdout || '') + (r.stderr || '')).replace(/\s*\n\s*/g, ' | ') };
    } catch (e) {
      return { status: null, said: 'set-up failed: ' + e.message };
    } finally {
      fs.rmSync(sb.root, { recursive: true, force: true });
    }
  };
  const backfill = pushOne('handoff238b', 'correction-backfill-rows.json');
  check('tripwire blocks a pushed backfill hand-off file', backfill.status === 1, 'exit ' + backfill.status + ' :: ' + backfill.said.slice(0, 200));
  check('tripwire names the backfill hand-off file', backfill.said.indexOf('correction-backfill-rows.json') !== -1, backfill.said.slice(0, 200));
  const rows = pushOne('handoff238r', 'correction-rows.json');
  check('tripwire still blocks a pushed rows hand-off file',
    rows.status === 1 && rows.said.indexOf('correction-rows.json') !== -1, 'exit ' + rows.status + ' :: ' + rows.said.slice(0, 200));
}

// --- issue #229: TK_LEDGER_DIR also moves the fix records and the backfill file ---
// A guard, not a fail-first check: both paths are built from the same folder.
function ledgerDirNewFilesTest() {
  const sb = makeSandbox('ledgerdir229');
  const repo = path.join(sb.root, 'repo229');
  const moved = path.join(sb.root, 'moved229');
  const g = function (args) {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  };
  try {
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(moved, { recursive: true });
    g(['init', '-q']); g(['config', 'user.email', 'test@example.com']); g(['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(repo, 'README.md'), 'x\n', 'utf-8');
    g(['add', 'README.md']); g(['commit', '-qm', 'init']);
    fs.writeFileSync(path.join(moved, 'correction-axial-map.json'), JSON.stringify({ 'moved code': 'cat-moved' }), 'utf-8');
    fs.writeFileSync(path.join(moved, 'correction-ledger.jsonl'), JSON.stringify({
      at: '2026-09-23T10:00:00.000Z', repo: 'repo229', repo_path: fs.realpathSync(repo), kind: 'human', scope: 'project',
      stage: 'execute', produced: '', correction: '', open_code: 'moved code', axial_code: null, session: 'sess-m'
    }) + '\n', 'utf-8');
    const env = { TK_LEDGER_DIR: moved };
    run(sb, ['--record-fix', '--category', 'cat-moved', '--home', 'global', '--label', 'moved fix'], { cwd: repo, env: env });
    run(sb, ['--add-backfill', '--data', writeRows(sb, [{ at: '2026-09-23T10:00:00.000Z', session: 'sess-m', trigger: 'moved trigger', rewrite: '' }])],
      { cwd: repo, env: env });
    const names = ['correction-fixes.jsonl', 'correction-backfill.jsonl'];
    check('TK_LEDGER_DIR holds the fix records and the backfill side file',
      names.every(function (n) { return fs.existsSync(path.join(moved, n)); }), fs.readdirSync(moved).join(', '));
    check('TK_LEDGER_DIR leaves neither under HOME',
      names.every(function (n) { return !fs.existsSync(path.join(sb.home, '.claude', n)); }));
  } catch (e) {
    check('TK_LEDGER_DIR new-files test ran', false, e.message);
  }
  fs.rmSync(sb.root, { recursive: true, force: true });
}

function finish() {
  tripwireTest();
  tripwireBinaryTest();
  tripwireNewFilesTest();
  tripwireHandoffTest();
  ledgerDirNewFilesTest();
  cycleTimeTest();
  console.log('');
  if (failures.length === 0) {
    console.log(passed + ' checks passed.\n');
    process.exit(0);
  }
  console.log(failures.length + ' FAILED, ' + passed + ' passed:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  console.log('');
  process.exit(1);
}
