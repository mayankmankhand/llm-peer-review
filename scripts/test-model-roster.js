#!/usr/bin/env node
'use strict';
// test-model-roster.js - assertions that the helper roster and the helpers agree
// (issue #205). The roster table in .claude/skills/shared/model-routing.md names
// each agent's model and effort, and the agent's own frontmatter is what the
// harness applies, so the two must say the same thing: every file under
// .claude/agents/ declares a model (an agent with no model line follows
// CLAUDE_CODE_SUBAGENT_MODEL when a user sets it, which can move a judge below
// the session model) and the effort its row names; every roster agent has a
// file; and /index Step 2's cost message names the mapper's model through the
// mode ({mapperModel}, which Step 1 fills from models.perRole). A second group
// checks that no line dispatching a judge (the M2 skeptic, the M3 verifier, the
// plan critic, the design critic and the comparer) names a model: a per-call
// model overrides the agent file, so one stray word there silently downgrades a
// judge. A third group checks that every line dispatching a finder or the mapper
// copies the mode's model with the one clause model-routing.md defines, word for
// word, so the call sites cannot drift apart. Reads the source tree only; the
// mutation checks run on in-memory copies. Dependency-free; exits non-zero on any failure.
//
//   node scripts/test-model-roster.js [--repo <dir>]

const fs = require('fs');
const path = require('path');

const ri = process.argv.indexOf('--repo');
const REPO = ri > 0 ? path.resolve(process.argv[ri + 1]) : path.resolve(__dirname, '..');
const AGENTS = path.join(REPO, '.claude', 'agents');
const ROUTING = path.join(REPO, '.claude', 'skills', 'shared', 'model-routing.md');
const INDEX = path.join(REPO, '.claude', 'commands', 'index.md');
// Judges by rule (model-routing.md, "Judges and synthesis inherit"): a verdict
// that is final never runs below the tier of the work it judges.
const JUDGES = ['audit-skeptic', 'fix-verifier', 'plan-critic', 'design-critic', 'design-comparer'];

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failures.push(name + (detail ? ' - ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' - ' + String(detail).slice(0, 300) : '')); }
}

// The first frontmatter block as key -> value.
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

// The roster table: every row under the `| Agent | Model | Effort |` header up
// to the first line that is not a table row. A row may list several agents.
function parseRoster(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => /^\|\s*Agent\s*\|\s*Model\s*\|\s*Effort\s*\|/.test(l));
  const rows = new Map();
  if (start === -1) return rows;
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const cells = lines[i].split('|').slice(1, -1).map(c => c.trim());
    const names = (cells[0].match(/`([a-z0-9-]+)`/g) || []).map(n => n.slice(1, -1));
    for (const n of names) rows.set(n, { model: cells[1], effort: cells[2] });
  }
  return rows;
}

// Every disagreement between the agent files and the roster, as readable lines.
function rosterProblems(agents, roster) {
  const out = [];
  for (const [name, fm] of agents) {
    const row = roster.get(name);
    if (!fm.model) out.push(name + ': no model line');
    if (!row) { out.push(name + ': no roster row'); continue; }
    if (fm.model && fm.model !== row.model) out.push(name + ': model ' + fm.model + ', roster says ' + row.model);
    if (fm.effort !== row.effort) out.push(name + ': effort ' + fm.effort + ', roster says ' + row.effort);
  }
  for (const name of roster.keys()) if (!agents.has(name)) out.push(name + ': roster row with no agent file');
  return out;
}

// What /index Step 2's cost message names as the mapper's model: the mode's
// model, through the {mapperModel} placeholder that Step 1 fills.
function costMessageModel(text) {
  const m = /\(([{}\w]+) via the index-mapper agent\)/.exec(text);
  return m ? m[1] : null;
}
const MAPPER_FROM_MODE = /`models\.perRole\["index-mapper"\]`[^\n]*`\{mapperModel\}`/;

// A line that tells a dispatcher to spawn a finder or the mapper. Table rows only
// name the agents, so they are skipped; the dispatch sentence is the line that must
// carry the clause model-routing.md defines.
const DISPATCH_LINE = /subagent_type=(?:tk:)?(?:review-(?:code|security|ux|plan|commands|deps|browser|copy)-finder|index-mapper)\b|the Finder column|four per-kind finders/;
const MODE_CLAUSE = 'with `model` set to its `models.perRole` value, where `session`, or a model above your own, means your own model family\'s alias';
function dispatchProblems(files) {
  const out = [];
  let lines = 0;
  for (const [file, text] of files) {
    text.split(/\r?\n/).forEach((line, i) => {
      if (/^\s*\|/.test(line) || !DISPATCH_LINE.test(line)) return;
      lines++;
      if (!line.includes(MODE_CLAUSE)) out.push(file + ':' + (i + 1));
    });
  }
  return { lines, problems: out };
}

// A line that dispatches a judge, and the model it names, if any. "No model
// parameter" (the fallback lines) names none; an alias or a model: value does.
const JUDGE_LINE = new RegExp('subagent_type=(?:tk:)?(' + JUDGES.join('|') + ')\\b|`(' + JUDGES.join('|') + ')` agent');
const MODEL_WORD = /\b(sonnet|opus|haiku|fable)\b|\bmodel\s*[=:]\s*["'`]?[a-z]/i;
function judgeCallProblems(files) {
  const out = [];
  let lines = 0;
  for (const [file, text] of files) {
    text.split(/\r?\n/).forEach((line, i) => {
      if (!JUDGE_LINE.test(line)) return;
      lines++;
      const m = MODEL_WORD.exec(line);
      if (m) out.push(file + ':' + (i + 1) + ' names "' + m[0] + '"');
    });
  }
  return { lines, problems: out };
}

function readAgents(dir) {
  const agents = new Map();
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
    const fm = frontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
    agents.set(fm.name || f.replace(/\.md$/, ''), fm);
  }
  return agents;
}
function promptFiles() {
  const out = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) out.set(path.relative(REPO, p), fs.readFileSync(p, 'utf8'));
    }
  };
  for (const d of ['commands', 'skills', 'agents']) walk(path.join(REPO, '.claude', d));
  return out;
}

// ---- The live tree ---------------------------------------------------------
console.log('Roster and agent files');
const agents = readAgents(AGENTS);
const roster = parseRoster(fs.readFileSync(ROUTING, 'utf8'));
check('the roster table parses into rows', roster.size >= agents.size && roster.size > 10, roster.size + ' agents');
const live = rosterProblems(agents, roster);
check('every agent file declares the model and effort its roster row names', live.length === 0, live.join('; '));
const indexText = fs.readFileSync(INDEX, 'utf8');
const costModel = costMessageModel(indexText);
check('/index Step 2\'s cost message names the mode\'s mapper model, which Step 1 reads from models.perRole',
  costModel === '{mapperModel}' && MAPPER_FROM_MODE.test(indexText), 'message: ' + costModel);

console.log('Judge dispatch lines');
const scan = judgeCallProblems(promptFiles());
check('the judge scan finds the dispatch lines (at least 8)', scan.lines >= 8, scan.lines + ' lines');
check('no judge dispatch line names a model', scan.problems.length === 0, scan.problems.join('; '));

console.log('Finder and mapper dispatch lines');
const commandsAndSkills = new Map([...promptFiles()].filter(([f]) => !f.startsWith(path.join('.claude', 'agents'))));
const dispatch = dispatchProblems(commandsAndSkills);
check('the dispatch scan finds the finder and mapper dispatch lines (at least 8)', dispatch.lines >= 8, dispatch.lines + ' lines');
check('every finder and mapper dispatch line copies the mode\'s model, word for word', dispatch.problems.length === 0, dispatch.problems.join('; '));

// ---- Mutations: each check must go red on the defect it guards ----------------
console.log('Mutations');
const clone = (m) => new Map([...m].map(([k, v]) => [k, Object.assign({}, v)]));
const someJudge = clone(agents);
delete someJudge.get('plan-critic').model;
check('mutation: a judge with its model line removed is caught',
  rosterProblems(someJudge, roster).some(p => p === 'plan-critic: no model line'));
const pinned = clone(agents);
pinned.get('review-code-finder').model = 'haiku';
check('mutation: a finder pinned without its roster row is caught',
  rosterProblems(pinned, roster).some(p => /^review-code-finder: model haiku, roster says/.test(p)));
const effort = clone(agents);
effort.get('fix-verifier').effort = 'low';
check('mutation: an effort that leaves its row is caught',
  rosterProblems(effort, roster).some(p => /^fix-verifier: effort low/.test(p)));
const extra = clone(agents);
extra.set('new-helper', { name: 'new-helper', model: 'inherit', effort: 'high' });
check('mutation: an agent file with no roster row is caught',
  rosterProblems(extra, roster).some(p => p === 'new-helper: no roster row'));
const gone = clone(agents);
gone.delete('design-comparer');
check('mutation: a roster row with no agent file is caught',
  rosterProblems(gone, roster).some(p => p === 'design-comparer: roster row with no agent file'));
check('mutation: a cost message naming a fixed model is caught',
  costMessageModel('spawn 3 parallel subagents (Sonnet via the index-mapper agent).') !== '{mapperModel}');
const routed = dispatchProblems(new Map([
  ['e.md', 'run four sub-agents (`subagent_type=review-code-finder` with `model` set to its `models.perRole` value, where `session`, or a model above your own, means your own model family\'s alias; ...)'],
  ['f.md', 'spawn an Agent with `subagent_type=index-mapper` - the mapper agent, whose model comes from its frontmatter.'],
  ['g.md', '| Code | `subagent_type=review-code-finder` |'],
  ['h.md', 'using the exact `subagent_type=` value in the Finder column, with `model` from the plan.'],
]));
check('mutation: a mapper or finder dispatch without the clause is caught, by name or through the Finder column',
  routed.problems.includes('f.md:1') && routed.problems.includes('h.md:1') && !routed.problems.includes('e.md:1'), routed.problems.join('; '));
check('a table row naming a finder is not a dispatch line', routed.lines === 3 && !routed.problems.includes('g.md:1'), routed.lines + ' lines');
const planted = new Map([
  ['a.md', '1. Dispatch `subagent_type=plan-critic` with `model: "sonnet"` and the plan path.'],
  ['b.md', 'Dispatch `subagent_type=tk:audit-skeptic` on Opus.'],
  ['c.md', 'Fallback: `general-purpose` with no model parameter, as the `fix-verifier` agent row declares.'],
  ['d.md', 'Dispatch `subagent_type=review-code-finder` with `model: sonnet`.'],
]);
const hits = judgeCallProblems(planted);
check('mutation: a judge dispatch with a model value or an alias is caught',
  hits.problems.some(p => p.startsWith('a.md:1')) && hits.problems.some(p => p.startsWith('b.md:1')), hits.problems.join('; '));
check('a fallback line saying "no model parameter" is not flagged', !hits.problems.some(p => p.startsWith('c.md')));
check('a finder dispatch is outside the judge scan', !hits.problems.some(p => p.startsWith('d.md')) && hits.lines === 3, hits.lines + ' lines');

console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach(f => console.log('  - ' + f));
process.exit(1);
