#!/usr/bin/env node
'use strict';
// test-hold-compression.js - tests for scripts/hold-compression.js (issue 293), the maintainer-only
// script that holds an automatic compression while a loop stage is running and lets it through at
// the stage's closing call. Every case builds its own throwaway project and session record under the
// system temp folder; nothing here reads this repository's real sessions or writes its real log.
//
// A case name starts with "293:" so the plan's checks can find it in the test gate's failure list.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'hold-compression.js');
// Loaded inside a guard, so a missing or broken script fails every case by name instead of
// stopping the suite before any case prints.
let hc = {};
let loadError = null;
try { hc = require(SCRIPT); } catch (e) { loadError = e; }

let passed = 0, failed = 0;
function must(cond, detail) {
  if (!cond) throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
}
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok - ' + name);
  } catch (e) {
    failed++;
    const why = loadError ? 'the script did not load: ' + loadError.message : (e && e.message) || String(e);
    console.log('not ok - ' + name + ' :: ' + String(why).slice(0, 400));
  }
}

// ---- record rows, shaped as Claude Code writes them -----------------------------------------------

let clock = Date.parse('2026-11-14T00:00:00.000Z');
let counter = 0;
const ts = () => new Date(clock += 1000).toISOString();
const uid = () => 'u' + (++counter);

const userRow = (content, extra) => Object.assign({ parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content }, uuid: uid(), timestamp: ts() }, extra || {});
// A command the owner typed: the shape of a real typed /explore row.
const typed = (name, args) => userRow('<command-message>' + name + '</command-message>\n<command-name>/' + name + '</command-name>\n<command-args>' + (args || '') + '</command-args>');
const assistant = (blocks, size, extra) => Object.assign({
  parentUuid: 'p' + counter, isSidechain: false, type: 'assistant',
  message: { model: 'claude-opus-5-5', id: 'msg_' + uid(), role: 'assistant', content: blocks,
    usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: size - 10, output_tokens: 40 } },
  uuid: uid(), timestamp: ts(),
}, extra || {});
const bash = (command) => ({ type: 'tool_use', id: 'toolu_' + uid(), name: 'Bash', input: { command, description: 'x' } });
const skill = (name, args) => ({ type: 'tool_use', id: 'toolu_' + uid(), name: 'Skill', input: args ? { skill: name, args } : { skill: name } });
const write = (filePath) => ({ type: 'tool_use', id: 'toolu_' + uid(), name: 'Write', input: { file_path: filePath, content: 'abc1234\n' } });
const result = (text) => userRow([{ tool_use_id: 'toolu_x', type: 'tool_result', content: text }]);
const boundary = (pre, post) => ({ parentUuid: null, logicalParentUuid: 'p', isSidechain: false, type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { trigger: 'auto', preTokens: pre, postTokens: post }, uuid: uid(), timestamp: ts() });
const blob = (text) => ({ type: 'api-request-blob', sessionId: 's', hash: 'h' + uid(), message: { role: 'user', content: [{ type: 'text', text }] } });

const CHAIN_REVIEW = 'node .claude/scripts/session-init.js --chain review --report reports/review-orchestrator-x.md --ledger reports/receipts/x/ledger.json';

// ---- a throwaway project, one session record, and the hook calls ----------------------------------

function sandbox(env) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hold-293-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
  const dir = path.join(root, 'home', 'projects', 'proj');
  fs.mkdirSync(dir, { recursive: true });
  const session = 'sess-' + uid();
  const record = path.join(dir, session + '.jsonl');
  fs.writeFileSync(record, '');
  const opts = { env: env === undefined ? { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '50' } : env, projectDir: project, dataDir: path.join(project, 'reports', 'hold-compression') };
  const logFile = path.join(opts.dataDir, 'log.jsonl');
  const rows = () => { try { return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return []; } };
  const sb = {
    root, project, record, session, opts, rows,
    add(...items) { fs.appendFileSync(record, items.map((r) => JSON.stringify(r) + '\n').join('')); return sb; },
    input(extra) { return JSON.stringify(Object.assign({ session_id: session, transcript_path: record, cwd: project, hook_event_name: 'PreCompact', trigger: 'auto', custom_instructions: '' }, extra || {})); },
    start(source) {
      return hc.run('start', JSON.stringify({ session_id: session, transcript_path: record, cwd: project, hook_event_name: 'SessionStart', source: source || 'startup' }), opts);
    },
    // One attempt at an automatic compression. Returns the exit code and the log row it wrote.
    pre(extra) {
      const before = rows().length;
      const r = hc.run('pre', sb.input(extra), opts);
      const after = rows();
      return { exit: r.exit, stdout: r.stdout, row: after.length > before ? after[after.length - 1] : null };
    },
  };
  return sb;
}
const held = (a) => a.exit === 2 && a.row && a.row.decision === 'held';
const through = (a, reason) => a.exit === 0 && a.row && a.row.decision === 'through' && a.row.reason === reason;
const show = (a) => ({ exit: a.exit, row: a.row });

// ---- the rule ---------------------------------------------------------------------------------------

test('293: a due compression is held while a stage is running', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(typed('review'), assistant([bash('ls')], 500000));
  const a = sb.pre();
  must(held(a), show(a));
  must(a.stdout === '', 'the attempt printed: ' + a.stdout);
});

test('293: let through after the stage\'s closing call', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(typed('review'), assistant([bash('ls')], 500000));
  must(held(sb.pre()), 'not held before the closing call');
  sb.add(assistant([bash(CHAIN_REVIEW)], 520000));
  const a = sb.pre();
  must(through(a, 'no-stage'), show(a));
});

test('293: let through at the worked-out limit', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(typed('execute'), assistant([bash('ls')], 500000));
  must(held(sb.pre()), 'first attempt not held');
  sb.add(assistant([bash('ls')], 899999));
  const below = sb.pre();
  must(held(below) && below.row.limit === 900000, show(below));
  sb.add(assistant([bash('ls')], 900000));
  const at = sb.pre();
  must(through(at, 'limit') && at.row.limit === 900000, show(at));
});

test('293: the limit follows the first attempt and the percentage, and never passes 90% of 1,000,000', () => {
  must(hc.limitFor(500000, 50) === 900000, hc.limitFor(500000, 50));
  must(hc.limitFor(400000, 50) === 720000, hc.limitFor(400000, 50));
  must(hc.limitFor(70000, 35) === 180000, hc.limitFor(70000, 35));
  must(hc.limitFor(600000, 50) === 900000, 'capped: ' + hc.limitFor(600000, 50));
  must(hc.limitFor(990000, 30) === 900000, 'capped: ' + hc.limitFor(990000, 30));
  // The first attempt fixes the window for the whole stretch: a later, larger attempt does not move it.
  const sb = sandbox();
  sb.start('startup');
  sb.add(typed('review'), assistant([bash('ls')], 400000));
  const first = sb.pre();
  must(held(first) && first.row.limit === 720000, show(first));
  sb.add(assistant([bash('ls')], 650000));
  const later = sb.pre();
  must(held(later) && later.row.limit === 720000, show(later));
  sb.add(assistant([bash('ls')], 720000));
  must(through(sb.pre(), 'limit'), 'not let through at 720000');
});

test('293: never held with no lowered percentage', () => {
  for (const env of [{}, { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '90' }, { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '95' }, { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: 'abc' }, { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '0' }]) {
    const sb = sandbox(env);
    sb.start('startup');
    sb.add(typed('review'), assistant([bash('ls')], 500000));
    const a = sb.pre();
    must(through(a, 'no-lowered-pct'), { env, got: show(a) });
  }
  // With nothing in the environment, the project's settings file is read.
  const sb = sandbox({});
  fs.writeFileSync(path.join(sb.project, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '50' } }));
  sb.start('startup');
  sb.add(typed('review'), assistant([bash('ls')], 500000));
  const a = sb.pre();
  must(held(a) && a.row.pct === 50, { from: 'settings', got: show(a) });
  // A value in the environment wins over the settings file, even when it is 90 or more.
  const sb2 = sandbox({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '92' });
  fs.writeFileSync(path.join(sb2.project, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '50' } }));
  sb2.start('startup');
  sb2.add(typed('review'), assistant([bash('ls')], 500000));
  must(through(sb2.pre(), 'no-lowered-pct'), 'the settings file overrode the environment');
});

test('293: never held in a resumed session', () => {
  const sb = sandbox();
  sb.start('resume');
  sb.add(typed('review'), assistant([bash('ls')], 500000));
  const a = sb.pre();
  must(through(a, 'not-seen'), show(a));
});

test('293: never held when the session\'s note of how it began is missing', () => {
  const sb = sandbox();
  sb.add(typed('review'), assistant([bash('ls')], 500000));
  const a = sb.pre();
  must(through(a, 'not-seen'), show(a));
});

test('293: held again after the next compression', () => {
  const sb = sandbox();
  sb.start('resume');
  sb.add(typed('review'), assistant([bash('ls')], 500000));
  must(through(sb.pre(), 'not-seen'), 'held in a resumed stretch');
  sb.add(boundary(500000, 40000));
  sb.start('compact');
  sb.add(assistant([bash('ls')], 45000), assistant([bash('ls')], 480000));
  const a = sb.pre();
  must(held(a) && a.row.limit === 864000, show(a));
  // A missing note works the same way: the restart after a compression starts a seen stretch.
  const sb2 = sandbox();
  sb2.add(typed('review'), assistant([bash('ls')], 500000));
  must(through(sb2.pre(), 'not-seen'), 'held with no note');
  sb2.add(boundary(500000, 40000));
  sb2.start('compact');
  sb2.add(assistant([bash('ls')], 500000));
  must(held(sb2.pre()), 'not held after the next compression');
});

test('293: never held for a helper', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(typed('review'), assistant([bash('ls')], 500000));
  const a = sb.pre({ agent_id: 'a1b2c3', agent_type: 'review-code-finder' });
  must(through(a, 'helper'), show(a));
  const sub = path.join(path.dirname(sb.record), sb.session, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const helperRecord = path.join(sub, 'agent-a1.jsonl');
  fs.writeFileSync(helperRecord, JSON.stringify(typed('review')) + '\n' + JSON.stringify(assistant([bash('ls')], 500000)) + '\n');
  const b = sb.pre({ transcript_path: helperRecord });
  must(through(b, 'helper'), show(b));
});

test('293: never held when the trigger is not auto', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(typed('review'), assistant([bash('ls')], 500000));
  for (const trigger of ['manual', undefined, '']) {
    const a = sb.pre({ trigger });
    must(through(a, 'not-auto'), { trigger, got: show(a) });
  }
});

test('293: let through on unreadable input', () => {
  const sb = sandbox();
  sb.start('startup');
  for (const text of ['not json', '', '[]', JSON.stringify({ trigger: 'auto', transcript_path: sb.record }), JSON.stringify({ session_id: '../../etc', trigger: 'auto', transcript_path: sb.record })]) {
    const r = hc.run('pre', text, sb.opts);
    const rows = sb.rows();
    const row = rows[rows.length - 1];
    must(r.exit === 0 && row && row.decision === 'through' && row.reason === 'unreadable-input', { text, exit: r.exit, row });
  }
});

test('293: let through on an unreadable record', () => {
  const sb = sandbox();
  sb.start('startup');
  const a = sb.pre({ transcript_path: path.join(sb.root, 'no-such-record.jsonl') });
  must(through(a, 'unreadable-record'), show(a));
});

test('293: let through on an unreadable size', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(typed('review'), result('no call has run yet'));
  const a = sb.pre();
  must(through(a, 'unreadable-size'), show(a));
});

test('293: let through when anything throws', () => {
  const sb = sandbox();
  const blocker = path.join(sb.root, 'a-file');
  fs.writeFileSync(blocker, 'x');
  const opts = Object.assign({}, sb.opts, { dataDir: path.join(blocker, 'hold') });
  const r = hc.run('pre', sb.input(), opts);
  must(r.exit === 0, 'exit ' + r.exit);
  const s = hc.run('start', JSON.stringify({ session_id: sb.session, transcript_path: sb.record, source: 'startup' }), opts);
  must(s.exit === 0 && s.stdout === '', { exit: s.exit, stdout: s.stdout });
});

// ---- how a stage starts ------------------------------------------------------------------------------

test('293: a stage started by a typed command is held', () => {
  for (const stage of ['explore', 'create-plan', 'execute', 'review', 'document']) {
    const sb = sandbox();
    sb.start('startup');
    sb.add(typed(stage), assistant([bash('ls')], 500000));
    const a = sb.pre();
    must(held(a) && a.row.stage === stage, { stage, got: show(a) });
  }
});

test('293: a stage loaded by name is held', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(assistant([skill('create-plan', 'issue 293')], 300000), assistant([bash('ls')], 500000));
  const a = sb.pre();
  must(held(a) && a.row.stage === 'create-plan', show(a));
});

test('293: a stage with tk: in front is held, typed or by name', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(typed('tk:execute'), assistant([bash('ls')], 500000));
  const a = sb.pre();
  must(held(a) && a.row.stage === 'execute', show(a));
  const sb2 = sandbox();
  sb2.start('startup');
  sb2.add(assistant([skill('tk:review')], 300000), assistant([bash('ls')], 500000));
  const b = sb2.pre();
  must(held(b) && b.row.stage === 'review', show(b));
});

// ---- how a stage ends --------------------------------------------------------------------------------

test('293: each stage\'s own closing call lets the next attempt through', () => {
  const cases = [
    ['explore', bash('node .claude/scripts/session-init.js --chain explore --summary reports/explore/2026-11-13-x.md')],
    ['execute', bash('node .claude/scripts/session-init.js --chain execute | head -c 1500')],
    ['review', bash('node /home/u/Projects/p/.claude/scripts/session-init.js --chain review --report r.md --ledger l.json | node -e \'let s=""\'')],
    ['create-plan', bash('node .claude/scripts/render-html.js --shell plan --name PLAN-x --out-dir plans --stable --no-abs --data /tmp/plan-render.Ab12/data.json')],
    ['create-plan', bash('S=/tmp/x cp a b && node .claude/scripts/render-html.js --shell plan --name PLAN-x --out-dir plans --stable --data /tmp/x/data.json')],
    ['document', write('/home/u/Projects/p/artifacts/html/.last-cycle')],
    ['document', bash('git status --short && git rev-parse HEAD > artifacts/html/.last-cycle && cat artifacts/html/.last-cycle')],
  ];
  for (const [stage, call] of cases) {
    const sb = sandbox();
    sb.start('startup');
    sb.add(typed(stage), assistant([bash('ls')], 500000));
    must(held(sb.pre()), { stage, why: 'not held before its closing call' });
    sb.add(assistant([call], 510000));
    const a = sb.pre();
    must(through(a, 'no-stage'), { stage, call: call.input, got: show(a) });
  }
});

test('293: the quoted spelling of the hand-off check ends the stage', () => {
  for (const command of [
    'node "/home/u/.claude/plugins/cache/llm-peer-review/tk/8.0.22/scripts/session-init.js" --chain review --report r.md',
    "node '/home/u/my projects/p/.claude/scripts/session-init.js' --chain review --report r.md",
  ]) {
    const sb = sandbox();
    sb.start('startup');
    sb.add(typed('review'), assistant([bash('ls')], 500000));
    must(held(sb.pre()), 'not held before');
    sb.add(assistant([bash(command)], 510000));
    const a = sb.pre();
    must(through(a, 'no-stage'), { command, got: show(a) });
  }
});

test('293: the plan page render does not close a running build', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(typed('execute', 'PLAN-x.md'), assistant([bash('node .claude/scripts/render-html.js --shell plan --name PLAN-x --out-dir plans --stable --data /tmp/p/data.json')], 500000));
  const a = sb.pre();
  must(held(a) && a.row.stage === 'execute', show(a));
});

test('293: merge, review-full and the other unheld commands are never held', () => {
  for (const start of [typed('merge'), typed('tk:merge'), typed('review-full'), typed('review-code'), typed('pair-debug'), assistant([skill('review-full')], 300000), assistant([skill('tk:review-security')], 300000)]) {
    const sb = sandbox();
    sb.start('startup');
    // A review left running with no closing call, then the unheld command starts.
    sb.add(typed('review'), start, assistant([bash('ls')], 500000));
    const a = sb.pre();
    must(through(a, 'no-stage'), { start: start.message.content, got: show(a) });
  }
});

// ---- the reader ---------------------------------------------------------------------------------------

test('293: a second run reads only what is new', () => {
  const sb = sandbox();
  sb.add(typed('review'), assistant([bash('ls')], 300000));
  const state = hc.newState();
  const first = hc.readRecord(sb.record, state);
  const size1 = fs.statSync(sb.record).size;
  must(first.bytesRead === size1 && state.offset === size1 && state.stage && state.stage.name === 'review', { first, offset: state.offset, size1 });
  sb.add(assistant([bash(CHAIN_REVIEW)], 310000));
  const size2 = fs.statSync(sb.record).size;
  const second = hc.readRecord(sb.record, state);
  must(second.bytesRead === size2 - size1 && state.stage === null, { second, added: size2 - size1, stage: state.stage });
  const third = hc.readRecord(sb.record, state);
  must(third.bytesRead === 0, third);
  // A line still being written (no newline yet) is left for the next run.
  const line = JSON.stringify(typed('document'));
  fs.appendFileSync(sb.record, line.slice(0, 40));
  const partial = hc.readRecord(sb.record, state);
  must(partial.bytesRead === 0 && state.stage === null, { partial, stage: state.stage });
  fs.appendFileSync(sb.record, line.slice(40) + '\n');
  hc.readRecord(sb.record, state);
  must(state.stage && state.stage.name === 'document', state.stage);
});

test('293: the size is read from the record\'s last main-session call', () => {
  const sb = sandbox();
  sb.add(assistant([bash('ls')], 410000), assistant([bash('ls')], 999999, { isSidechain: true }), result('x'.repeat(5000)), blob('y'.repeat(5000)));
  must(hc.readSize(sb.record) === 410000, hc.readSize(sb.record));
});

test('293: each log row names the line that decided', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(typed('review'), assistant([bash('ls')], 500000));
  sb.pre();
  sb.pre({ trigger: 'manual' });
  sb.pre({ agent_id: 'x1' });
  hc.run('pre', 'not json', sb.opts);
  sb.add(assistant([bash('ls')], 900000));
  sb.pre();
  const want = { held: null, 'not-auto': 2, helper: 2, 'unreadable-input': 1, limit: 5 };
  const rows = sb.rows().filter((r) => r.event === 'pre');
  must(rows.length === 5, rows);
  for (const r of rows) {
    must(Object.prototype.hasOwnProperty.call(want, r.reason) && r.line === want[r.reason], r);
    must(typeof r.t === 'string' && (r.decision === 'held') === (r.reason === 'held'), r);
  }
  // The lines left: no lowered percentage (3), not seen from its beginning (4), no stage (6).
  const sb2 = sandbox({});
  sb2.start('startup');
  sb2.add(assistant([bash('ls')], 500000));
  must(sb2.pre().row.line === 3, 'line 3');
  const sb3 = sandbox();
  sb3.add(assistant([bash('ls')], 500000));
  must(sb3.pre().row.line === 4, 'line 4');
  const sb4 = sandbox();
  sb4.start('startup');
  sb4.add(assistant([bash('ls')], 500000));
  must(sb4.pre().row.line === 6, 'line 6');
});

// ---- a stage with no closing call --------------------------------------------------------------------

test('293: an abandoned stage is held to the limit and then let through', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(typed('explore'), assistant([bash('ls')], 500000));
  let size = 500000;
  while (size < 900000) {
    const a = sb.pre();
    must(held(a), { size, got: show(a) });
    size += 50000;
    sb.add(assistant([bash('ls')], size));
  }
  must(through(sb.pre(), 'limit'), 'not let through at the limit');
});

test('293: a stage started twice is closed by one closing call', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(typed('review'), assistant([skill('review')], 300000), assistant([bash('ls')], 500000));
  must(held(sb.pre()), 'not held');
  sb.add(assistant([bash(CHAIN_REVIEW)], 510000));
  must(through(sb.pre(), 'no-stage'), 'one closing call did not close a stage started twice');
});

test('293: a second stage command while one runs makes the new one the running stage', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(typed('execute'), assistant([bash('ls')], 300000), typed('review'), assistant([bash('ls')], 500000));
  const a = sb.pre();
  must(held(a) && a.row.stage === 'review', show(a));
  sb.add(assistant([bash('node .claude/scripts/session-init.js --chain execute')], 510000));
  must(held(sb.pre()), 'the old stage\'s closing call ended the new one');
  sb.add(assistant([bash(CHAIN_REVIEW)], 520000));
  must(through(sb.pre(), 'no-stage'), 'the new stage\'s own closing call did not end it');
});

test('293: a closing call for a stage that is not running changes nothing', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(typed('explore'), assistant([bash(CHAIN_REVIEW)], 400000), assistant([write('/p/artifacts/html/.last-cycle')], 450000), assistant([bash('ls')], 500000));
  const a = sb.pre();
  must(held(a) && a.row.stage === 'explore', show(a));
});

// ---- hostile shapes: words that look like a start or an end but are not one ----------------------

test('293: a closing call in a grep\'s arguments does not end a stage', () => {
  for (const command of [
    'grep -n "session-init.js --chain review" .claude/commands/*.md',
    'echo "--- where stages run the hand-off check"; grep -n -o -E "session-init\\.js --chain [a-z-]+" .claude/commands/*.md | sort',
    'echo "done; node .claude/scripts/session-init.js --chain review --report r.md"',
    "cat > /tmp/x.sh <<'EOF'\nnode .claude/scripts/session-init.js --chain review --report r.md\nEOF\nwc -l /tmp/x.sh",
    'grep -c "> artifacts/html/.last-cycle" notes.md',
    'cat artifacts/html/.last-cycle',
  ]) {
    const sb = sandbox();
    sb.start('startup');
    sb.add(typed('review'), assistant([bash(command)], 500000));
    const a = sb.pre();
    must(held(a), { command, got: show(a) });
  }
});

test('293: a closing call or a command name in a tool\'s output neither ends nor starts a stage', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(typed('review'), assistant([bash('cat log.txt')], 400000), result(CHAIN_REVIEW + '\n<command-message>document</command-message>\n<command-name>/document</command-name>'), assistant([bash('ls')], 500000));
  const a = sb.pre();
  must(held(a) && a.row.stage === 'review', show(a));
  const sb2 = sandbox();
  sb2.start('startup');
  sb2.add(assistant([bash('cat x')], 400000), result('<command-message>review</command-message>\n<command-name>/review</command-name>'), assistant([bash('ls')], 500000));
  must(through(sb2.pre(), 'no-stage'), 'a tool\'s output started a stage');
});

test('293: a closing call or a command name in a helper\'s row neither ends nor starts a stage', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(typed('review'), assistant([bash(CHAIN_REVIEW)], 400000, { isSidechain: true }), assistant([skill('document')], 400000, { isSidechain: true }), assistant([bash('ls')], 500000));
  const a = sb.pre();
  must(held(a) && a.row.stage === 'review', show(a));
  const sb2 = sandbox();
  sb2.start('startup');
  sb2.add(assistant([skill('review')], 300000, { isSidechain: true }), assistant([bash('ls')], 500000));
  must(through(sb2.pre(), 'no-stage'), 'a helper\'s row started a stage');
});

test('293: a closing call or a command name in a pasted message neither ends nor starts a stage', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(userRow('Here is what the last session ran:\n<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args></command-args>'), assistant([bash('ls')], 500000));
  must(through(sb.pre(), 'no-stage'), 'a pasted command name started a stage');
  const sb2 = sandbox();
  sb2.start('startup');
  sb2.add(typed('review'), userRow('Then it ran ' + CHAIN_REVIEW), userRow([{ type: 'text', text: CHAIN_REVIEW }]), assistant([bash('ls')], 500000));
  const a = sb2.pre();
  must(held(a) && a.row.stage === 'review', show(a));
});

test('293: words in a request blob row neither end nor start a stage', () => {
  const sb = sandbox();
  sb.start('startup');
  sb.add(typed('review'), blob(CHAIN_REVIEW + ' <command-name>/document</command-name> "name":"Bash"'), assistant([bash('ls')], 500000));
  const a = sb.pre();
  must(held(a) && a.row.stage === 'review', show(a));
});

// ---- the script as Claude Code runs it ----------------------------------------------------------------

test('293: run as a hook, it exits 2 to hold and 0 to let through, and prints nothing', () => {
  const sb = sandbox();
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: sb.project, CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '50' });
  const call = (mode, input) => spawnSync(process.execPath, [SCRIPT, mode], { input, env, encoding: 'utf8', timeout: 15000 });
  const s = call('start', JSON.stringify({ session_id: sb.session, transcript_path: sb.record, cwd: sb.project, hook_event_name: 'SessionStart', source: 'startup' }));
  must(s.status === 0 && s.stdout === '', { status: s.status, stdout: s.stdout, stderr: s.stderr });
  sb.add(typed('review'), assistant([bash('ls')], 500000));
  const h = call('pre', sb.input());
  must(h.status === 2 && h.stdout === '', { status: h.status, stdout: h.stdout, stderr: h.stderr });
  sb.add(assistant([bash(CHAIN_REVIEW)], 510000));
  const t = call('pre', sb.input());
  must(t.status === 0 && t.stdout === '', { status: t.status, stdout: t.stdout, stderr: t.stderr });
  const log = path.join(sb.project, 'reports', 'hold-compression', 'log.jsonl');
  must(fs.existsSync(log) && fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length === 3, 'the log does not hold three rows');
  const bad = call('pre', 'not json');
  must(bad.status === 0, 'unreadable input did not let through: ' + bad.status);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
