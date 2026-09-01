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
// Usage: node scripts/test-correction-ledger.js

const { execFileSync, spawn } = require('child_process');
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
    env: Object.assign({}, process.env, { HOME: sb.home }),
    encoding: 'utf-8'
  });
}

function ledgerFile(sb) { return path.join(sb.home, '.claude', 'correction-ledger.jsonl'); }
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
    user('sounds good, thanks', '2026-08-31T10:05:00.000Z')
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

function finish() {
  tripwireTest();
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
