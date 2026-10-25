#!/usr/bin/env node
'use strict';
// test-m9-shadow-labels.js - the labelling plumbing of the shadow-mode M9 gate (issue 222, plan Step 7):
// the shards and the judge's instructions, the judges' returns into labels.jsonl, the three-way
// disagreement list, and the owner's ticks. Fixtures only: nothing here touches the network or the
// real shadow folder.

const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require(path.join(__dirname, 'm9-shadow-hook.js'));
const scorer = require(path.join(__dirname, 'm9-shadow-score.js'));
const labels = require(path.join(__dirname, 'm9-shadow-labels.js'));

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('ok - ' + name); }
  else { failed++; console.log('not ok - ' + name + (detail !== undefined ? ' :: ' + String(detail).slice(0, 300) : '')); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-labels-'));
const rules = path.join(dir, 'rules.md');
fs.writeFileSync(rules, '# Rules\n\n- **M8.** Something else.\n- **M9. Always-ask actions.** These never auto-apply: the fixture rule.\n- **M10.** More.\n');

const ids = hook.PREDICATES.map(p => p.id);
const low = Object.fromEntries(ids.map(id => [id, 0.05]));
const flagsOff = Object.fromEntries(Object.keys(hook.REGEX).map(k => [k, false]));
const row = (command, cwd, flags, jev, reason) => ({
  id: scorer.rowId(command), reason, ts: 't', cwd, command,
  flags: Object.assign({}, flagsOff, flags || {}), flagsAfterStrip: Object.assign({}, flagsOff, flags || {}),
  providers: { jev: { model: 'm', probs: Object.assign({}, low, jev || {}), ms: 300, usage: { cost: 0.00001 }, error: null }, openai: { error: 'no key', probs: null } },
});
const A = row('git push --force origin main', '.', { forcePush: true }, { forcePush: 0.95 }, 'regex-hit');   // every arm says force push
const B = row('rm -rf /tmp/scratch.abc', '.', { deletion: true }, { deletion: 0.1 }, 'regex-hit');            // regex yes, judge and model no
const C = row('gh issue comment 5 --body-file x', 'src', {}, { outwardSend: 0.9 }, 'model-positive');       // judge and model yes, regex missed
const D = row('ls -la', '.', {}, {}, 'random');                                                               // every arm says no
fs.writeFileSync(path.join(dir, 'sample.jsonl'), [A, B, C, D].map(r => JSON.stringify(r)).join('\n') + '\n');

// ---- shards and instructions ----------------------------------------------------------------------
const s = labels.writeShards(dir, 3, rules);
const instr = fs.readFileSync(s.instructions, 'utf8');
check('shards: 4 rows at size 3 make two shards', s.shards.length === 2 && s.shards[0].rows === 3 && s.shards[1].rows === 1, JSON.stringify(s.shards.map(x => x.rows)));
check('shards: a shard row carries id, cwd and command', (() => { const r = JSON.parse(fs.readFileSync(s.shards[0].file, 'utf8').split('\n')[2]); return r.id === C.id && r.cwd === 'src' && r.command === C.command; })());
check('instructions quote the M9 line verbatim from the rules file', instr.includes('- **M9. Always-ask actions.** These never auto-apply: the fixture rule.') && !instr.includes('M10'));
check('instructions carry every predicate question as the model saw it', hook.PREDICATES.every(p => instr.includes('`' + p.id + '`: ' + p.instructions)));
check('instructions name the return format with every predicate id', ids.every(id => instr.includes('"' + id + '":false')) && instr.includes('## Return format'));
let threw = null;
try { labels.instructions(path.join(dir, 'no-such-rules.md')); } catch (e) { threw = e; }
check('a missing rules file throws rather than writing instructions without the rule', threw !== null);

// ---- returns into labels.jsonl -----------------------------------------------------------------------
const yes = (r, over) => JSON.stringify(Object.assign({ id: r.id, reason: 'fixture' }, Object.fromEntries(ids.map(id => [id, false])), over || {}));
fs.writeFileSync(s.shards[0].returnFile, ['```json', yes(A, { forcePush: true }) + ',', 'not json at all', yes({ id: 'sdeadbeef0000' }), '{"id":"' + B.id + '","release":"no"}', yes(B), '```'].join('\n') + '\n');
const l1 = labels.collectLabels(dir);
check('labels: valid lines become judge rows, fences and trailing commas tolerated', l1.judge === 2 && l1.labels === 2 && l1.shards[0].valid === 2, JSON.stringify(l1));
check('labels: a non-JSON line and a line with a non-boolean answer are reported malformed', l1.shards[0].malformed.length === 2, JSON.stringify(l1.shards[0].malformed));
check('labels: an id that is not in the shard is reported, not stored', l1.shards[0].unknownIds.length === 1 && l1.shards[0].unknownIds[0] === 'sdeadbeef0000');
check('labels: missing ids are listed per shard and both shards are up for redispatch', l1.shards[0].missing.length === 1 && l1.shards[0].missing[0] === C.id && l1.shards[1].missing[0] === D.id && l1.redispatch.join(',') === 'shard-01,shard-02', JSON.stringify(l1.redispatch));
check('labels: labelled-yes counts come from the stored rows', l1.labelledYes.forcePush === 1 && l1.labelledYes.deletion === 0, JSON.stringify(l1.labelledYes));
const stored = fs.readFileSync(path.join(dir, 'labels.jsonl'), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x));
check('labels: a stored row carries source judge, its shard and the five booleans', stored.every(r => r.source === 'judge' && r.shard === 'shard-01' && ids.every(id => typeof r[id] === 'boolean')));

// the redispatch: the rest of shard 1 and all of shard 2 come back
fs.appendFileSync(s.shards[0].returnFile, yes(C, { outwardSend: true }) + '\n');
fs.writeFileSync(s.shards[1].returnFile, yes(D) + '\n');
const l2 = labels.collectLabels(dir);
check('labels: after the redispatch every row is labelled and nothing is left to redispatch', l2.judge === 4 && l2.redispatch.length === 0 && l2.shards.every(e => e.missing.length === 0), JSON.stringify(l2.redispatch));

// ---- the disagreement list -------------------------------------------------------------------------------
const d = labels.disagreements(dir);
const ticks = JSON.parse(fs.readFileSync(d.file, 'utf8'));
check('disagree: the two rows where an arm differs are listed, the two unanimous rows are not', d.counts.labelled === 4 && d.counts.disagreeing === 2 && ticks.rows.length === 2, JSON.stringify(d.counts));
check('disagree: the row the judge marks yes comes first', ticks.rows[0].id === C.id && ticks.rows[0].disagreeOn.join() === 'outwardSend' && ticks.rows[1].id === B.id && ticks.rows[1].disagreeOn.join() === 'deletion', JSON.stringify(ticks.rows.map(r => [r.id, r.disagreeOn])));
check('disagree: each row shows the three votes per predicate and its command, cwd and shape', ticks.rows[1].predicates.deletion.judge === false && ticks.rows[1].predicates.deletion.regex === true && ticks.rows[1].predicates.deletion.jev === 0.1 && ticks.rows[1].cwd === '.' && ticks.rows[1].shape === 'rm -rf', JSON.stringify(ticks.rows[1]));
check('disagree: counts per predicate', d.counts.byPredicate.deletion === 1 && d.counts.byPredicate.outwardSend === 1 && d.counts.byPredicate.forcePush === 0 && d.counts.judgeYesDisputed === 1, JSON.stringify(d.counts.byPredicate));
check('shapeOf collapses numbers and /tmp paths', labels.shapeOf('rm -rf /tmp/plan-render.Ab12/data.json') === 'rm -rf' && labels.shapeOf('git push origin v8.0.4') === 'git push');

// ---- the owner's ticks ----------------------------------------------------------------------------------
const tickFile = path.join(dir, 'owner-ticks.json');
fs.writeFileSync(tickFile, JSON.stringify({ [B.id]: { deletion: true }, nope: { deletion: true }, [A.id]: { bogus: true }, [D.id]: { release: 'yes' } }));
const t = labels.applyTicks(dir, tickFile);
check('ticks: one flip is appended as an owner row; unknown ids and non-boolean or unknown predicates are skipped', t.added === 1 && t.skipped.length === 3, JSON.stringify(t));
const after = fs.readFileSync(path.join(dir, 'labels.jsonl'), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x));
const last = after[after.length - 1];
check('ticks: the owner row keeps the judge\'s other answers and names what was ticked', last.id === B.id && last.source === 'owner' && last.deletion === true && last.forcePush === false && last.ticked.join() === 'deletion' && /judge: fixture/.test(last.reason), JSON.stringify(last));
const sc = scorer.score(dir);
check('ticks: the scorer reads the owner row as the label (last line wins)', sc.counts.ownerLabels === 1 && sc.regex.deletion.positives === 1, JSON.stringify([sc.counts.ownerLabels, sc.regex.deletion.positives]));
const l3 = labels.collectLabels(dir);
check('labels: a re-run after a redispatch keeps the owner row', l3.owner === 1 && l3.labels === 5 && l3.labelledYes.deletion === 1, JSON.stringify(l3));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
