#!/usr/bin/env node
'use strict';
// jev-findings.js - test 3 of issue 246: does Jev read a review finding the way the M2 skeptic did?
// Maintainer-only: lives under scripts/ and is never built into the plugin.
//
// Every review saves, for each tier-2 audit shard, the file the skeptic read
// (reports/receipts/<stamp>/audit-tier2-<n>.txt: each finding's line and receipt output, byte for
// byte) and the skeptic's return (audit-tier2-<n>-return.txt, or audit-tier2-<n>.return.txt in
// some runs). This script sends each finding block to Jev through scripts/jev-client.js and scores
// Jev's answer against the skeptic's verdict, read by merge-findings.js's own checkVerdicts (no
// second parser). The label is the audit's outcome, not ground truth, and the skeptic had Read,
// Grep and Bash while Jev sees the bytes only; the bar (reports/issue-246/ab-findings.md in the
// data home) says both.
//
// Modes (one per run):
//   --run          ask about every finding not yet answered, in every working copy of the repo
//   --run --dry    print what would be sent and what is withheld; call nothing
//   --trigger      the PostToolUse hook: when the Write tool's file_path or a Bash command names a
//                  skeptic's return file, run --run; otherwise exit at once. It always exits 0 and
//                  prints nothing; a failure is written to the replay log, so the next --score
//                  shows a broken install instead of ten silent days.
//   --score        the verdict from the constants below; writes score.md and score.json
//
// Data stance (Ring 1 in plans/PLAN-issue-246.md): only findings and receipt output leave the
// machine. A finding whose receipt check reads plans/, artifacts/, reports/ outside
// reports/receipts/, an env file or the ledger is withheld here, before the client is called; the
// client then withholds secret-shaped bytes, refuses without the bar, and caps the calls per day.
// Each finding is asked of the pinned 1.13 build, which the verdict is about, and of the 1.14 build
// as a side column that never decides it.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const client = require(path.join(__dirname, 'jev-client.js'));
const m9 = require(path.join(__dirname, 'm9-shadow-hook.js')); // withholdReason, for --dry
const scorer = require(path.join(__dirname, 'm9-shadow-score.js')); // auroc, ece, percentile: the 222 scorer's one copy
const { auroc, ece, percentile } = scorer; // a copy of this file elsewhere needs m9-shadow-score.js beside it

// The bar. reports/issue-246/ab-findings.md quotes these before the first call.
const MIN_PER_CLASS = 10;   // fewer STANDS or REFUTED rows than this: INSUFFICIENT
const GOOD_AUROC = 0.80;    // AUROC of `holds` against STANDS at or above this: GOOD AT
const POOR_AUROC = 0.70;    // below this: NOT GOOD AT; between the two: MIXED
const THRESHOLD = 0.5;      // a probability at or above this is a "yes"
const MAX_STATE = 12000;    // characters of one finding block sent; the rest becomes a marker
const BUILDS = [client.MODEL, client.MODEL_114];

// Two wordings in one request: the verdict hangs on `holds`; `refuted` asks the inverse, so a pair
// that answers yes to both (or no to both) is a flip. Each quotes the rule it judges by.
const QUESTIONS = {
  holds: 'The state is one finding from an automated code review: the reviewer\'s finding as a JSON line (what is wrong, why it matters, the fix it proposes and the check it ran), followed by the output that check printed. Reviewers often overstate. Does the check output show that the problem the finding describes really exists, as described, in the file it names? Answer no when the output does not show it, shows something different, or supports only a weaker claim.',
  refuted: 'The state is one finding from an automated code review: the reviewer\'s finding as a JSON line, followed by the output of the check the reviewer ran to support it. A skeptical auditor rejects any finding whose check output fails to support it, and when in doubt it rejects. Should this finding be rejected?',
};

// Ring 1's path rule, applied to every receipt check a finding carries.
const PATH_RULES = [
  { re: /(?:^|[^A-Za-z0-9_.-])plans\//, reason: 'reads plans/' },
  { re: /(?:^|[^A-Za-z0-9_.-])artifacts\//, reason: 'reads artifacts/' },
  { re: /(?:^|[^A-Za-z0-9_.-])reports\/(?!receipts\/)/, reason: 'reads reports/' },
  { re: /(?:^|[^A-Za-z0-9_-])\.env(?:\.[A-Za-z0-9_-]+)*(?![A-Za-z0-9_-])/, reason: 'reads an env file' },
  { re: /\bcorrection-(?:ledger|heartbeat|fixes|backfill)\.jsonl\b|\bcorrection-(?:rollup|axial-map|rows|backfill-rows)\.json\b/, reason: 'reads the ledger' },
];
function withholdPath(checkText) {
  for (const rule of PATH_RULES) if (rule.re.test(String(checkText))) return rule.reason;
  return null;
}
// The same rule over a receipt's saved output: a check that reads nothing private (a recursive grep
// from the root) can still print lines from plans/ or reports/, and the whole block is what is sent
// (review 2026-10-25, R2).
function withholdOutput(outputText) {
  const r = withholdPath(outputText);
  return r ? 'output names ' + r.slice('reads '.length) : null;
}

const RETURN_RE = /reports\/receipts\/[^/\s'"]+\/audit-tier2-\d+(?:-return|\.return)\.txt/;

function paths(home) {
  const dir = path.join(home, 'reports', 'issue-246', 'findings');
  return { bar: path.join(home, 'reports', 'issue-246', 'ab-findings.md'), dir, log: path.join(dir, 'replay.jsonl'), scoreMd: path.join(dir, 'score.md'), scoreJson: path.join(dir, 'score.json') };
}

// Every working copy of the repository the home belongs to; the home alone outside a repository.
function listRoots(home) {
  const r = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: home, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const roots = r.status === 0 ? (r.stdout || '').split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9).trim()) : [];
  return roots.length ? Array.from(new Set(roots)) : [home];
}

// merge-findings.js from the home's checkout when it has one (the copy under reports/ runs that
// way), else the one beside this script. An explicit path is the only candidate (the tests).
function loadMergeFindings(home, explicit) {
  const candidates = explicit ? [explicit] : [path.join(home, '.claude', 'scripts', 'merge-findings.js'), path.join(__dirname, '..', '.claude', 'scripts', 'merge-findings.js')];
  for (const c of candidates) if (fs.existsSync(c)) return require(c);
  throw new Error('cannot load merge-findings.js (tried ' + candidates.join(', ') + ')');
}

function findShards(roots) {
  const out = [];
  for (const root of roots) {
    const base = path.join(root, 'reports', 'receipts');
    let stamps = [];
    try { stamps = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort(); } catch (e) { continue; }
    for (const stamp of stamps) {
      const dir = path.join(base, stamp);
      for (const name of fs.readdirSync(dir).sort()) {
        const m = name.match(/^audit-tier2-(\d+)\.txt$/);
        if (!m) continue;
        const returnFile = ['-return.txt', '.return.txt'].map(s => path.join(dir, 'audit-tier2-' + m[1] + s)).find(f => fs.existsSync(f)) || null;
        out.push({ root, stamp, n: m[1], shardFile: path.join(dir, name), returnFile });
      }
    }
  }
  return out;
}

// The finding blocks of one shard: the lines between "===== RN =====" and "===== end RN =====".
function parseBlocks(text) {
  const lines = String(text).split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^===== (R\d+) =====$/);
    if (!open) continue;
    const end = lines.indexOf('===== end ' + open[1] + ' =====', i + 1);
    if (end === -1) break;
    blocks.push({ id: open[1], text: lines.slice(i + 1, end).join('\n') });
    i = end;
  }
  return blocks;
}

// What a block says about itself: its finders' lenses, its severity and every receipt check.
function blockMeta(text) {
  const lines = text.split('\n');
  const meta = { lenses: [], severity: null, checks: [], outputs: [], parseOk: true };
  for (let i = 0; i < lines.length; i++) {
    if (/^Receipt output \(.*\):$/.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && !/^Finding \(.+, as its finder wrote it\):$/.test(lines[j])) j++;
      meta.outputs.push(lines.slice(i + 1, j).join('\n'));
      i = j - 1;
      continue;
    }
    if (!/^Finding \(.+, as its finder wrote it\):$/.test(lines[i])) continue;
    let f = null;
    try { f = JSON.parse(lines[i + 1]); } catch (e) { meta.parseOk = false; continue; }
    if (f.specialist && !meta.lenses.includes(f.specialist)) meta.lenses.push(f.specialist);
    if (!meta.severity && f.severity) meta.severity = f.severity;
    if (f.receipt && typeof f.receipt.check === 'string') meta.checks.push(f.receipt.check);
    else meta.parseOk = false;
  }
  if (!meta.lenses.length) meta.parseOk = false;
  return meta;
}

function capState(text) {
  if (text.length <= MAX_STATE) return { state: text, truncated: false };
  return { state: text.slice(0, MAX_STATE) + '\n<truncated ' + (text.length - MAX_STATE) + ' chars>', truncated: true };
}

function readLog(file) {
  if (!fs.existsSync(file)) return { rows: [], malformed: 0 };
  const rows = [];
  let malformed = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const j = JSON.parse(line); if (j && typeof j === 'object') rows.push(j); else malformed++; } catch (e) { malformed++; }
  }
  return { rows, malformed };
}

// One line per write, one appendFileSync each, so two runs at once never interleave half-lines.
function writeLine(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}
function bump(obj, key) { obj[key] = (obj[key] || 0) + 1; }

// replay(): ask about every labelled finding and build not yet answered or withheld. A pair whose
// last attempt failed (a timeout, an HTTP error) is asked again; a refusal for the cap stops the
// asking until tomorrow, and the summary counts what is still pending.
async function replay(opts) {
  const o = opts || {};
  const home = o.home || client.home();
  const p = paths(home);
  const mf = loadMergeFindings(home, o.mergeFindingsPath);
  const roots = o.roots || listRoots(home);
  const done = new Set();
  for (const r of readLog(p.log).rows) {
    if (r.key && r.build && (r.withheld || (typeof r.holds === 'number' && !r.error))) done.add(r.key + '|' + r.build);
  }
  const s = { roots: roots.length, shards: 0, skippedNoReturn: 0, malformedReturns: 0, findings: 0, labelled: 0, asked: 0, answered: 0, errors: 0, alreadyDone: 0, withheld: {}, truncated: 0, pending: 0, capReached: false, refused: null, dry: !!o.dry, wouldSend: 0 };
  for (const sh of findShards(roots)) {
    s.shards++;
    if (!sh.returnFile) { s.skippedNoReturn++; continue; }
    const blocks = parseBlocks(fs.readFileSync(sh.shardFile, 'utf8'));
    const v = mf.checkVerdicts('2', blocks.map(b => b.id), [{ file: sh.returnFile, text: fs.readFileSync(sh.returnFile, 'utf8') }]);
    if (!v.ok) { s.malformedReturns++; continue; }
    for (const b of blocks) {
      s.findings++;
      const label = v.verdicts[b.id];
      if (label !== 'STANDS' && label !== 'REFUTED') continue;
      s.labelled++;
      const meta = blockMeta(b.text);
      const key = sh.stamp + '/audit-tier2-' + sh.n + '/' + b.id;
      const pathReason = meta.parseOk ? (meta.checks.map(withholdPath).find(Boolean) || meta.outputs.map(withholdOutput).find(Boolean) || null) : 'unreadable finding';
      const capped = capState(b.text);
      if (capped.truncated) s.truncated++;
      if (o.dry) {
        const reason = pathReason || m9.withholdReason(capped.state);
        if (reason) bump(s.withheld, reason); else s.wouldSend++;
        continue;
      }
      for (const build of BUILDS) {
        if (done.has(key + '|' + build)) { s.alreadyDone++; continue; }
        const base = { v: 1, ts: new Date().toISOString(), key, root: path.basename(sh.root), stamp: sh.stamp, shard: 'audit-tier2-' + sh.n, id: b.id, build, lenses: meta.lenses, severity: meta.severity, label, chars: b.text.length, truncated: capped.truncated };
        if (pathReason) { bump(s.withheld, pathReason); writeLine(p.log, Object.assign(base, { withheld: pathReason, holds: null, refuted: null })); done.add(key + '|' + build); continue; }
        if (s.capReached || s.refused) { s.pending++; continue; }
        const r = await client.decide({ test: 'findings', questions: QUESTIONS, state: capped.state, bar: p.bar, model: build, home, fetch: o.fetch, now: o.now });
        if (!r.sent) {
          if (/^withheld: /.test(r.error || '')) {
            const reason = r.error.slice('withheld: '.length);
            bump(s.withheld, reason);
            writeLine(p.log, Object.assign(base, { withheld: reason, holds: null, refuted: null }));
            done.add(key + '|' + build);
          } else {
            if (r.error === 'cap') s.capReached = true; else s.refused = r.error; // no bar, no key: nothing can be asked this run
            s.pending++;
          }
          continue;
        }
        s.asked++;
        if (r.error) s.errors++; else s.answered++;
        writeLine(p.log, Object.assign(base, { model: r.model, holds: r.probs ? r.probs.holds : null, refuted: r.probs ? r.probs.refuted : null, ms: r.ms, usage: r.usage, error: r.error }));
        if (!r.error) done.add(key + '|' + build); // asked once per run, however many copies hold the shard (review 2026-10-25, R13)
      }
    }
  }
  return s;
}

// trigger(): the PostToolUse hook's body. Runs the replay only when the call saved a skeptic's
// return; any failure is written to the replay log rather than printed.
function namesReturn(input) {
  if (!input || !input.tool_input) return false;
  if (input.tool_name === 'Write') return RETURN_RE.test(String(input.tool_input.file_path || ''));
  if (input.tool_name === 'Bash') return RETURN_RE.test(String(input.tool_input.command || ''));
  return false;
}
async function trigger(input, opts) {
  if (!namesReturn(input)) return { matched: false };
  const o = opts || {};
  try {
    return { matched: true, summary: await replay(o) };
  } catch (e) {
    const error = String((e && e.message) || e).slice(0, 200);
    try { writeLine(paths(o.home || client.home()).log, { v: 1, ts: new Date().toISOString(), trigger: true, error }); } catch (e2) { /* nothing left to tell */ }
    return { matched: true, error };
  }
}

// ---- score -----------------------------------------------------------------------------------

// auroc, ece and percentile come from m9-shadow-score.js: one copy, imported above (review 2026-10-24).
function round(v) { return v === null || v === undefined ? null : Number(v.toFixed(3)); }

function metrics(rows) {
  const scored = rows.filter(r => !r.withheld && !r.error && typeof r.holds === 'number' && (r.label === 'STANDS' || r.label === 'REFUTED'));
  const pos = scored.filter(r => r.label === 'STANDS');
  const neg = scored.filter(r => r.label === 'REFUTED');
  const yes = r => r.holds >= THRESHOLD;
  const both = scored.filter(r => typeof r.refuted === 'number');
  const by = (keyOf) => {
    const out = {};
    for (const r of scored) for (const k of keyOf(r)) {
      const e = out[k] = out[k] || { n: 0, stands: 0, agree: 0 };
      e.n++; if (r.label === 'STANDS') e.stands++; if (yes(r) === (r.label === 'STANDS')) e.agree++;
    }
    return out;
  };
  const m = {
    n: scored.length,
    stands: pos.length,
    refutedLabel: neg.length,
    auroc: auroc(pos.map(r => r.holds), neg.map(r => r.holds)),
    agreement: scored.length ? scored.filter(r => yes(r) === (r.label === 'STANDS')).length / scored.length : null,
    wouldHide: pos.filter(r => !yes(r)).length,
    ece: ece(scored.map(r => ({ p: r.holds, y: r.label === 'STANDS' ? 1 : 0 }))),
    flipRate: both.length ? both.filter(r => yes(r) === (r.refuted >= THRESHOLD)).length / both.length : null,
    aurocRefuted: auroc(pos.filter(r => typeof r.refuted === 'number').map(r => 1 - r.refuted), neg.filter(r => typeof r.refuted === 'number').map(r => 1 - r.refuted)),
    byLens: by(r => (r.lenses && r.lenses.length ? r.lenses : ['unknown'])),
    bySeverity: by(r => [r.severity || 'unknown']),
    latency: { p50: percentile(scored.map(r => r.ms).filter(v => typeof v === 'number'), 0.5), p95: percentile(scored.map(r => r.ms).filter(v => typeof v === 'number'), 0.95) },
    costUsd: Number(rows.reduce((sum, r) => sum + (r.usage && typeof r.usage.cost === 'number' ? r.usage.cost : 0), 0).toFixed(6)),
    builds: Array.from(new Set(scored.map(r => r.model).filter(Boolean))),
    errors: rows.filter(r => r.error && !r.withheld).length,
  };
  for (const k of ['auroc', 'agreement', 'ece', 'flipRate', 'aurocRefuted']) m[k] = round(m[k]);
  return m;
}
function verdictOf(m) {
  if (m.stands < MIN_PER_CLASS || m.refutedLabel < MIN_PER_CLASS) return 'INSUFFICIENT';
  if (m.auroc >= GOOD_AUROC) return 'GOOD AT';
  if (m.auroc < POOR_AUROC) return 'NOT GOOD AT';
  return 'MIXED';
}

function score(opts) {
  const o = opts || {};
  const home = o.home || client.home();
  const p = paths(home);
  const log = readLog(p.log);
  const last = new Map();
  for (const r of log.rows) if (r.key && r.build) last.set(r.key + '|' + r.build, r); // a later line for the same pair wins
  const rows = Array.from(last.values());
  const firstBuild = rows.filter(r => r.build === client.MODEL);
  const withheld = {};
  for (const r of firstBuild) if (r.withheld) bump(withheld, r.withheld);
  const primary = metrics(firstBuild);
  primary.verdict = verdictOf(primary);
  const side = metrics(rows.filter(r => r.build === client.MODEL_114));
  side.verdict = verdictOf(side);
  const result = {
    generatedAt: new Date().toISOString(),
    constants: { MIN_PER_CLASS, GOOD_AUROC, POOR_AUROC, THRESHOLD, MAX_STATE, builds: BUILDS },
    counts: { lines: log.rows.length, malformed: log.malformed, findings: new Set(rows.map(r => r.key)).size, withheld, truncated: firstBuild.filter(r => r.truncated).length, triggerErrors: log.rows.filter(r => r.trigger && r.error).length },
    primary,
    side,
  };
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.scoreJson, JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(p.scoreMd, scoreMarkdown(result));
  return result;
}

function scoreMarkdown(r) {
  const row = (label, m) => '| ' + label + ' | ' + m.verdict + ' | ' + m.n + ' | ' + m.stands + ' / ' + m.refutedLabel + ' | ' + m.auroc + ' | ' + m.agreement + ' | ' + m.wouldHide + ' | ' + m.flipRate + ' | ' + m.ece + ' | ' + m.latency.p50 + ' / ' + m.latency.p95 + ' ms | $' + m.costUsd + ' |';
  const table = (title, obj) => ['', '### ' + title, '', '| Group | Rows | STANDS | Agree at 0.5 |', '|---|---|---|---|'].concat(Object.keys(obj).sort().map(k => '| ' + k + ' | ' + obj[k].n + ' | ' + obj[k].stands + ' | ' + obj[k].agree + ' |'));
  return [
    '# Test 3 score: Jev on review findings (issue 246)',
    '',
    'Generated ' + r.generatedAt + '. The verdict is on the first build; the second is a side column that never decides it.',
    '',
    '| Build | Verdict | Rows | STANDS / REFUTED | AUROC of holds | Agreement | Stood but under 0.5 | Flip rate | ECE | Latency p50 / p95 | Cost |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    row(r.constants.builds[0], r.primary),
    row(r.constants.builds[1], r.side),
    '',
    'Findings: ' + r.counts.findings + '. Withheld (first build): ' + (Object.entries(r.counts.withheld).map(([k, v]) => k + ' ' + v).join(', ') || 'none') + '. Truncated: ' + r.counts.truncated + '. Trigger errors: ' + r.counts.triggerErrors + '. Malformed log lines: ' + r.counts.malformed + '.',
  ].concat(table('By lens (first build)', r.primary.byLens), table('By severity (first build)', r.primary.bySeverity)).join('\n') + '\n';
}

// ---- command line ---------------------------------------------------------------------------

async function main(argv) {
  if (argv.includes('--trigger')) {
    let text = '';
    for await (const chunk of process.stdin) text += chunk;
    let input = null;
    try { input = JSON.parse(text); } catch (e) { return; }
    await trigger(input);
    return;
  }
  if (argv.includes('--run')) { console.log(JSON.stringify(await replay({ dry: argv.includes('--dry') }))); return; }
  if (argv.includes('--score')) {
    const r = score();
    console.log(JSON.stringify({ verdict: r.primary.verdict, n: r.primary.n, stands: r.primary.stands, refuted: r.primary.refutedLabel, auroc: r.primary.auroc, side: { verdict: r.side.verdict, auroc: r.side.auroc }, counts: r.counts }));
    return;
  }
  console.error('usage: node scripts/jev-findings.js --run [--dry] | --trigger | --score');
  process.exitCode = 2;
}

module.exports = { replay, trigger, score, listRoots, parseBlocks, blockMeta, withholdPath, namesReturn, QUESTIONS, BUILDS, MIN_PER_CLASS, GOOD_AUROC, POOR_AUROC, MAX_STATE };

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.includes('--trigger')) main(argv).catch(() => {}).finally(() => process.exit(0));
  else main(argv).catch(e => { console.error(String((e && e.stack) || e)); process.exit(1); });
}
