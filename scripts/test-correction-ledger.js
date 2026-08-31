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
    // 5. tool result: harness, not human, must be excluded
    JSON.stringify({ type: 'user', timestamp: '2026-08-31T10:04:00.000Z', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
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

  check('pre-filter excludes tool results',
    !said.some(function (t) { return t.indexOf('ok') === 0; }));

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
