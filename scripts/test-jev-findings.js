#!/usr/bin/env node
'use strict';
// test-jev-findings.js - tests for test 3 of issue 246 (scripts/jev-findings.js): the replay of the
// M2 skeptic's saved shards, the PostToolUse trigger, and the scorer.
// Never touches the network: every in-process case passes its own fetch, and the child-process
// trigger runs against a home with no key, so the client refuses before any request. The module
// loads inside a try, so a missing module fails each case by name instead of crashing the suite.
// Secret-shaped fixtures are assembled at runtime, never written as literals, because the push
// tripwire has no allow-list by design (LESSONS-detail.md, issue 221).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let jf = null, loadError = null;
try { jf = require(path.join(__dirname, 'jev-findings.js')); } catch (e) { loadError = String(e && e.message || e).split('\n')[0]; }
const client = require(path.join(__dirname, 'jev-client.js'));

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('ok - ' + name); }
  else { failed++; console.log('not ok - ' + name + (detail !== undefined ? ' :: ' + String(detail).slice(0, 300) : '')); }
}
async function run(name, fn) {
  if (!jf) { check(name, false, 'module did not load: ' + loadError); return; }
  try { const [ok, detail] = await fn(); check(name, ok, detail); }
  catch (e) { check(name, false, 'threw: ' + (e && e.message || e)); }
}
function tmpdir(label) { return fs.mkdtempSync(path.join(os.tmpdir(), 'jev-findings-' + label + '-')); }

const KEY_LINE = ['OPENROUTER', 'API', 'KEY'].join('_') + '=' + 'or-test-' + 'k'.repeat(12) + '\n';
const SECRET = 'gh' + 'p_' + 'q'.repeat(24);

// One finding block in the shape merge-findings.js --shards writes.
function block(id, lens, finding, receiptFile, output) {
  return ['===== ' + id + ' =====', 'Finding (' + lens + ', as its finder wrote it):', JSON.stringify(finding),
    'Receipt output (' + receiptFile + ', as tier 1 saved it):', output, '===== end ' + id + ' ====='].join('\n');
}
function finding(severity, specialist, checkText) {
  return { severity, specialist, file: { relPath: 'src/a.js', absPath: '/x/src/a.js', line: 3 }, what: 'Should fix. A thing is wrong.', context: 'Why it matters.', fix: 'Do this.', receipt: { check: checkText, expect: { match: 'x' } } };
}
function shard(blocks) {
  const ids = blocks.map(b => b.split('\n')[0].replace(/=/g, '').trim());
  return ['M2 audit shard: tier 2, shard 1 of 1, ids ' + ids.join(' '), '', 'You are running tier 2: one skeptical pass.', '', ...blocks].join('\n') + '\n';
}
const F1 = finding('warn', 'code', 'grep -n foo src/a.js');
function addHomeFiles(home, opts) {
  const o = opts || {};
  fs.mkdirSync(path.join(home, 'reports', 'issue-246'), { recursive: true });
  if (o.bar !== false) fs.writeFileSync(path.join(home, 'reports', 'issue-246', 'ab-findings.md'), '# bar\n');
  if (o.key !== false) fs.writeFileSync(path.join(home, '.env.local'), KEY_LINE);
}
function addReceipts(root) {
  const rec = (stamp) => { const d = path.join(root, 'reports', 'receipts', stamp); fs.mkdirSync(d, { recursive: true }); return d; };
  const d1 = rec('2026-01-01-000001');
  fs.writeFileSync(path.join(d1, 'audit-tier2-1.txt'), shard([
    block('R1', 'code-1', F1, 'code-1.txt', '3:foo\nexit 0'),
    block('R2', 'plan-1', finding('suggest', 'plan', 'grep -c bar plans/PLAN-x.md'), 'plan-1.txt', '0\nexit 1'),
    block('R3', 'code-2', finding('warn', 'code', 'grep -n val src/b.js'), 'code-2.txt', '7:const v = ' + SECRET + '\nexit 0'),
  ]));
  fs.writeFileSync(path.join(d1, 'audit-tier2-1-return.txt'), 'R1: STANDS\nThe output shows it.\n\nR2: REFUTED\nNo.\n\nR3: REFUTED\nNo.\n');
  const d2 = rec('2026-01-01-000002');
  fs.writeFileSync(path.join(d2, 'audit-tier2-1.txt'), shard([block('R4', 'code-1', finding('suggest', 'code', 'sed -n 1,400p src/c.js'), 'code-1.txt', 'y'.repeat(13000) + '\nexit 0')]));
  fs.writeFileSync(path.join(d2, 'audit-tier2-1.return.txt'), 'R4: STANDS\nIt holds.\n');
  const d3 = rec('2026-01-01-000003');
  fs.writeFileSync(path.join(d3, 'audit-tier2-1.txt'), shard([block('R5', 'code-1', finding('warn', 'code', 'grep -n z src/d.js'), 'code-1.txt', '1:z\nexit 0')]));
}
function fixtureHome(opts) { const home = tmpdir('home'); addReceipts(home); addHomeFiles(home, opts); return home; }
function fakeFetch(answer) {
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const a = answer ? answer(body) : { holds: 0.8, refuted: 0.2 };
    if (a instanceof Error) throw a;
    return { ok: true, status: 200, text: async () => JSON.stringify({ model: body.model, answers: { holds: { noul: a.holds }, refuted: { noul: a.refuted } }, usage: { input_tokens: 100, cost: 0.000004 } }) };
  };
  f.calls = calls;
  return f;
}
function logRows(home) {
  const file = path.join(home, 'reports', 'issue-246', 'findings', 'replay.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
// Scorer fixtures: one log line per finding and build, with the label and the two answers.
function scoreHome(rows) {
  const home = tmpdir('score');
  const dir = path.join(home, 'reports', 'issue-246', 'findings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'replay.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  return home;
}
function rowsFor(build, stands, refuted, lens) {
  const out = [];
  stands.forEach((h, i) => out.push({ v: 1, key: 's/' + i, build, model: build, label: 'STANDS', holds: h, refuted: 1 - h, lenses: [lens || 'code'], severity: 'warn', ms: 300, usage: { cost: 0.00001 }, error: null }));
  refuted.forEach((h, i) => out.push({ v: 1, key: 'r/' + i, build, model: build, label: 'REFUTED', holds: h, refuted: 1 - h, lenses: [lens || 'plan'], severity: 'suggest', ms: 500, usage: { cost: 0.00001 }, error: null }));
  return out;
}
const rep = (n, v) => Array.from({ length: n }, () => v);

(async () => {
  delete process.env[['OPENROUTER', 'API', 'KEY'].join('_')];
  delete process.env.JEV_LAB_HOME;

  await run('the replay reads both return spellings and skips a shard with no return', async () => {
    const home = fixtureHome();
    const s = await jf.replay({ home, roots: [home], fetch: fakeFetch() });
    return [s.shards === 3 && s.skippedNoReturn === 1 && s.labelled === 4, JSON.stringify(s)];
  });

  await run('labels come from the skeptic returns through checkVerdicts', async () => {
    const home = fixtureHome();
    await jf.replay({ home, roots: [home], fetch: fakeFetch() });
    const lab = id => (logRows(home).find(r => r.id === id) || {}).label;
    return [lab('R1') === 'STANDS' && lab('R2') === 'REFUTED' && lab('R3') === 'REFUTED' && lab('R4') === 'STANDS', [lab('R1'), lab('R2'), lab('R3'), lab('R4')].join(',')];
  });

  await run('each finding block is sent exactly as the shard holds it', async () => {
    const home = fixtureHome();
    const f = fakeFetch();
    await jf.replay({ home, roots: [home], fetch: f });
    const expected = ['Finding (code-1, as its finder wrote it):', JSON.stringify(F1), 'Receipt output (code-1.txt, as tier 1 saved it):', '3:foo\nexit 0'].join('\n');
    const sent = f.calls.find(b => b.state.includes('grep -n foo'));
    return [!!sent && sent.state === expected, sent && sent.state];
  });

  await run('a finding whose receipt reads plans/ is withheld and never sent', async () => {
    const home = fixtureHome();
    const f = fakeFetch();
    await jf.replay({ home, roots: [home], fetch: f });
    const r2 = logRows(home).filter(r => r.id === 'R2');
    return [!f.calls.some(b => b.state.includes('PLAN-x.md')) && r2.length === 2 && r2.every(r => r.withheld === 'reads plans/'), JSON.stringify(r2)];
  });

  await run('a secret-shaped receipt is withheld by the client and never sent', async () => {
    const home = fixtureHome();
    const f = fakeFetch();
    await jf.replay({ home, roots: [home], fetch: f });
    const r3 = logRows(home).filter(r => r.id === 'R3');
    return [!f.calls.some(b => b.state.includes(SECRET)) && r3.length === 2 && r3.every(r => r.withheld === 'github-token'), JSON.stringify(r3)];
  });

  await run('an oversized block is capped at 12,000 characters with a marker', async () => {
    const home = fixtureHome();
    const f = fakeFetch();
    await jf.replay({ home, roots: [home], fetch: f });
    const sent = f.calls.find(b => b.state.includes('yyyy'));
    const row = logRows(home).find(r => r.id === 'R4');
    return [!!sent && sent.state.length < 12100 && /<truncated \d+ chars>$/.test(sent.state) && row.truncated === true, sent && sent.state.length];
  });

  await run('each finding is asked of the 1.13 build and the 1.14 build', async () => {
    const home = fixtureHome();
    const f = fakeFetch();
    await jf.replay({ home, roots: [home], fetch: f });
    const models = f.calls.filter(b => b.state.includes('grep -n foo')).map(b => b.model).sort();
    return [models.length === 2 && models[0] === client.MODEL && models[1] === client.MODEL_114, models.join(',')];
  });

  await run('both wordings travel in one request', async () => {
    const home = fixtureHome();
    const f = fakeFetch();
    await jf.replay({ home, roots: [home], fetch: f });
    return [f.calls.length > 0 && f.calls.every(b => b.questions.holds && b.questions.refuted && b.questions.holds.type === 'noul'), f.calls.length];
  });

  await run('a rerun asks only pairs not yet answered, a failed one included', async () => {
    const home = fixtureHome();
    const failing = fakeFetch(b => (b.model === client.MODEL_114 && b.state.includes('yyyy')) ? Object.assign(new Error('aborted'), { name: 'TimeoutError' }) : { holds: 0.7, refuted: 0.3 });
    await jf.replay({ home, roots: [home], fetch: failing });
    const again = fakeFetch();
    await jf.replay({ home, roots: [home], fetch: again });
    return [again.calls.length === 1 && again.calls[0].model === client.MODEL_114 && again.calls[0].state.includes('yyyy'), again.calls.length];
  });

  await run('the replay finds receipts in every working copy', async () => {
    const base = tmpdir('repo');
    const main = path.join(base, 'main');
    fs.mkdirSync(main);
    const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });
    git(['init', '-q'], main);
    git(['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], main);
    git(['worktree', 'add', '-q', path.join(base, 'wt'), '-b', 'wt'], main);
    addReceipts(path.join(base, 'wt'));
    addHomeFiles(main);
    const roots = jf.listRoots(main);
    const s = await jf.replay({ home: main, fetch: fakeFetch() });
    return [roots.length === 2 && roots.some(r => r.endsWith(path.sep + 'wt')) && s.shards === 3, JSON.stringify({ roots, shards: s.shards })];
  });

  await run('--dry calls nothing and reports what would be withheld', async () => {
    const home = fixtureHome();
    const f = fakeFetch();
    const s = await jf.replay({ home, roots: [home], fetch: f, dry: true });
    return [f.calls.length === 0 && s.withheld['reads plans/'] === 1 && s.withheld['github-token'] === 1 && s.wouldSend === 2 && logRows(home).length === 0, JSON.stringify(s)];
  });

  await run('the trigger runs the replay when a skeptic return is saved, by Write or by Bash', async () => {
    const home = fixtureHome();
    const f = fakeFetch();
    const w = await jf.trigger({ tool_name: 'Write', tool_input: { file_path: path.join(home, 'reports', 'receipts', '2026-01-01-000001', 'audit-tier2-1-return.txt') } }, { home, roots: [home], fetch: f });
    const b = await jf.trigger({ tool_name: 'Bash', tool_input: { command: "cat > /x/reports/receipts/2026-01-01-000002/audit-tier2-1.return.txt <<'EOF'" } }, { home, roots: [home], fetch: fakeFetch() });
    return [w.matched === true && f.calls.length > 0 && b.matched === true, JSON.stringify({ w: w.matched, b: b.matched, calls: f.calls.length })];
  });

  await run('the trigger ignores an unrelated call, and as a hook always exits 0 with empty stdout', async () => {
    const home = fixtureHome({ key: false });
    const f = fakeFetch();
    const r = await jf.trigger({ tool_name: 'Bash', tool_input: { command: 'ls reports/receipts' } }, { home, roots: [home], fetch: f });
    const child = spawnSync('node', [path.join(__dirname, 'jev-findings.js'), '--trigger'], {
      input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(home, 'reports', 'receipts', '2026-01-01-000001', 'audit-tier2-1-return.txt') } }),
      env: Object.assign({}, process.env, { JEV_LAB_HOME: home }), encoding: 'utf8', timeout: 30000,
    });
    return [r.matched === false && f.calls.length === 0 && child.status === 0 && child.stdout === '', JSON.stringify({ matched: r.matched, status: child.status, stdout: child.stdout, stderr: (child.stderr || '').slice(0, 120) })];
  });

  await run('the trigger records a failure to load its parser in the replay log', async () => {
    const home = fixtureHome();
    const r = await jf.trigger({ tool_name: 'Write', tool_input: { file_path: '/x/reports/receipts/s/audit-tier2-1-return.txt' } }, { home, roots: [home], fetch: fakeFetch(), mergeFindingsPath: path.join(home, 'missing.js') });
    const rows = logRows(home);
    return [r.matched === true && rows.length === 1 && rows[0].trigger === true && /merge-findings/.test(rows[0].error), JSON.stringify(rows)];
  });

  await run('the scorer says INSUFFICIENT with fewer than 10 rows of a label', async () => {
    const r = jf.score({ home: scoreHome(rowsFor(client.MODEL, rep(9, 0.9), rep(20, 0.1))) });
    return [r.primary.verdict === 'INSUFFICIENT', r.primary.verdict];
  });

  await run('the scorer says NOT GOOD AT below AUROC 0.70', async () => {
    const r = jf.score({ home: scoreHome(rowsFor(client.MODEL, rep(10, 0.2), rep(10, 0.8))) });
    return [r.primary.verdict === 'NOT GOOD AT' && r.primary.auroc === 0, JSON.stringify({ v: r.primary.verdict, a: r.primary.auroc })];
  });

  await run('the scorer says MIXED between AUROC 0.70 and 0.80', async () => {
    const r = jf.score({ home: scoreHome(rowsFor(client.MODEL, rep(7, 0.9).concat([0.5], rep(2, 0.3)), rep(10, 0.5))) });
    return [r.primary.verdict === 'MIXED' && Math.abs(r.primary.auroc - 0.75) < 1e-9, JSON.stringify({ v: r.primary.verdict, a: r.primary.auroc })];
  });

  await run('the scorer reports would-hide, the flip rate and the 1.14 side column', async () => {
    const rows = rowsFor(client.MODEL, rep(8, 0.9).concat(rep(2, 0.3)), rep(10, 0.45)).concat(rowsFor(client.MODEL_114, rep(10, 0.9), rep(10, 0.1)));
    rows[0].refuted = 0.9; // one finding where both wordings say yes: an inconsistent pair
    const r = jf.score({ home: scoreHome(rows) });
    return [r.primary.wouldHide === 2 && Math.abs(r.primary.flipRate - 0.05) < 1e-9 && r.side.auroc === 1 && r.side.verdict === 'GOOD AT', JSON.stringify({ hide: r.primary.wouldHide, flip: r.primary.flipRate, side: r.side.auroc })];
  });

  await run('the scorer keeps the last line per finding and build', async () => {
    const rows = rowsFor(client.MODEL, rep(10, 0.9), rep(10, 0.1));
    rows.push(Object.assign({}, rows[0], { holds: 0.05, refuted: 0.95 }));
    const r = jf.score({ home: scoreHome(rows) });
    return [r.primary.n === 20 && r.primary.wouldHide === 1, JSON.stringify({ n: r.primary.n, hide: r.primary.wouldHide })];
  });

  await run('the scorer says GOOD AT at AUROC 0.80 or above', async () => {
    const r = jf.score({ home: scoreHome(rowsFor(client.MODEL, rep(8, 0.9).concat(rep(2, 0.3)), rep(10, 0.5))) });
    return [r.primary.verdict === 'GOOD AT' && Math.abs(r.primary.auroc - 0.8) < 1e-9, JSON.stringify({ v: r.primary.verdict, a: r.primary.auroc })];
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('not ok - test runner threw :: ' + (e && e.stack || e)); process.exit(1); });
