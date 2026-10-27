#!/usr/bin/env node
'use strict';
//
// test-quality-check.js - assertions for scripts/quality-check.js, the headless
// review-quality check (issue #205, plan Step 1).
//
// Maintainer-only: lives under scripts/, which never ships downstream.
//
// Follows the repo's dependency-free test convention (see test-prompt-load.js):
// check(name, condition, detail), print, exit non-zero on any failure, each
// section inside a guard. Nothing here starts a Claude session: every run is a
// hand-made folder in the shape the runner writes (run.json, result.json,
// transcripts/, project-reports/), so the validity rules and the scoring bar are
// checked on canned outputs, for free, on every `npm test`.
//
// Usage: node scripts/test-quality-check.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const QC = require('./quality-check.js');
const SCRIPT = path.resolve(__dirname, 'quality-check.js');
// The Notebook fixture, the default one (#278 moved it into its own folder).
const FIXTURE = path.resolve(__dirname, 'fixtures', 'quality-check', 'notebook');
const ANSWERS = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'answers.json'), 'utf8'));
const BUG = Object.fromEntries(ANSWERS.bugs.map(b => [b.id, b]));
const IDS = ANSWERS.bugs.map(b => b.id);

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' :: ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' :: ' + String(detail).slice(0, 600) : '')); }
}

function section(name, fn) {
  try { fn(); } catch (e) { check(name + ' (section threw)', false, e && e.stack); }
}

const tempDirs = [];
process.on('exit', () => {
  for (const d of tempDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
});
function tmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';

// One finding line in the dispatch contract's shape.
function finding(kind, file, line, what, extra) {
  return JSON.stringify({ severity: 'warn', specialist: kind, file: { relPath: file, line }, what, key: file + ':' + what.toLowerCase().split(' ').slice(2, 6).join('-'), receipt: { check: 'grep -n x ' + file, expect: 'x' }, ...(extra || {}) });
}

const FINDS = {
  'code-search-prefix': () => finding('code', 'server.js', 61, 'Should fix. Search skips any note that starts with the search word.'),
  'security-path-traversal': () => finding('security', 'server.js', 104, 'Blocks. A crafted path leaks files outside the public folder to anyone.', { severity: 'block' }),
  'ux-clear-all-no-confirm': () => finding('ux', 'public/app.js', 41, 'Should fix. Clear all deletes every note with no confirmation step.'),
  'browser-search-id': () => finding('browser', 'public/app.js', 7, 'Blocks. The page throws a TypeError at load, so notes never render.'),
  'plan-export-json': () => finding('plan', 'server.js', 93, 'Should fix. Export skips the plan: it sends JSON where the plan decided CSV.'),
  'commands-contradiction': () => finding('commands', '.claude/commands/reset-notes.md', 17, 'Blocks. Step two deletes the notes file the rules say never to delete.'),
  'deps-lodash-cve': () => finding('deps', 'package.json', 13, 'Blocks. The new lodash version leaks prototype pollution from a known advisory.'),
  'copy-unclear-headline': () => finding('copy', 'README.md', 1, 'Should fix. The new title swaps plain words for shorthand, so newcomers miss what this app is.'),
  'known-shell-glob': () => finding('code', 'scripts/rotate-backups.sh', 13, 'Blocks. failglob still aborts the loop on an empty folder; nullglob does not stop it.'),
};
const KIND_OF = Object.fromEntries(ANSWERS.bugs.map(b => [b.id, b.id === 'known-shell-glob' ? 'code' : b.lens]));

// The report line a surviving finding renders as.
function reportLine(n, bugId) {
  const f = JSON.parse(FINDS[bugId]());
  return '- **R' + n + '** [' + f.specialist + '] ⚠️ `' + f.file.relPath + ':' + f.file.line + '` - ' + f.what;
}

// A canned review run folder. o.caught: bug ids that survive into the report;
// o.raised: bug ids a finder raised (default: o.caught plus o.killed); o.killed:
// raised, then audited out; o.finderOut: per-kind raw output overrides;
// o.models: { main, finder, judge }; o.result: result.json overrides;
// o.mainTools: extra tool uses in the main transcript; o.meta: run.json overrides;
// o.mainTexts: the session's own text, written before its dispatches;
// o.plans: { name: text } left in the scratch project's plans/ folder;
// o.whats: { bugId: sentence } replaces a canned finding's `what`, in the finder's
// output and in its report line alike; o.killVerdict: { bugId: { tag, reason } }
// gives a killed bug's Audited out verdict and reason (default REFUTED by a
// skeptic); o.extraSurvivors and o.extraKilled: report lines for findings that
// match no planted bug, '{n}' standing for the next R-number.
function makeReviewRun(o) {
  const dir = tmp('qc-test-run-');
  const home = '/tmp/qc-run.TEST/home';
  const project = '/tmp/qc-run.TEST/project';
  const models = { main: OPUS, finder: OPUS, judge: OPUS, ...(o.models || {}) };
  const caughtIds = o.caught || [];
  const killed = o.killed || [];
  const raised = o.raised || [...caughtIds, ...killed];
  const findOf = id => (o.whats && o.whats[id] ? JSON.stringify({ ...JSON.parse(FINDS[id]()), what: o.whats[id] }) : FINDS[id]());
  const sid = 'sess-' + Math.random().toString(36).slice(2, 8);
  const slugDir = path.join(dir, 'transcripts', '-tmp-qc-run-TEST-project');
  const mainRecords = [];
  const toolUses = [];
  const kinds = o.lenses || QC.FINDER_KINDS;
  kinds.forEach((kind, i) => {
    const toolId = 'toolu_finder_' + i;
    toolUses.push({ type: 'tool_use', id: toolId, name: 'Agent', input: { subagent_type: 'tk:review-' + kind + '-finder', description: kind, prompt: '...' } });
    let out = raised.filter(id => KIND_OF[id] === kind).map(findOf).join('\n') || 'NO FINDINGS';
    if (o.finderOut && o.finderOut[kind] !== undefined) out = o.finderOut[kind];
    const recs = [
      { type: 'user', message: { role: 'user', content: 'review prompt' } },
      { type: 'assistant', message: { model: models.finder, role: 'assistant', content: (o.finderTools && o.finderTools[kind] || []).concat([{ type: 'tool_use', id: 'hb' + i, name: 'SubagentHandback', input: { message: out } }]) } },
    ];
    write(path.join(slugDir, sid, 'subagents', 'agent-f' + i + '.jsonl'), recs.map(r => JSON.stringify(r)).join('\n') + '\n');
    write(path.join(slugDir, sid, 'subagents', 'agent-f' + i + '.meta.json'), JSON.stringify({ agentType: 'tk:review-' + kind + '-finder', toolUseId: toolId }));
  });
  // One skeptic, the judge whose model is checked.
  write(path.join(slugDir, sid, 'subagents', 'agent-s1.jsonl'), JSON.stringify({ type: 'assistant', message: { model: models.judge, role: 'assistant', content: [{ type: 'text', text: 'R1: STANDS' }] } }) + '\n');
  write(path.join(slugDir, sid, 'subagents', 'agent-s1.meta.json'), JSON.stringify({ agentType: 'tk:audit-skeptic', toolUseId: 'toolu_skeptic' }));
  // o.agents: [{ type, tools, results }], more typed subagents, each making the tool
  // calls in `tools` and getting the tool results in `results` (#253: a judge's
  // denied call has to sit in that judge's own transcript).
  (o.agents || []).forEach((ag, i) => {
    const recs = [
      { type: 'assistant', message: { model: ag.type === 'tk:review-code-finder' ? models.finder : models.judge, role: 'assistant', content: ag.tools || [] } },
      { type: 'user', message: { role: 'user', content: ag.results || [] } },
    ];
    write(path.join(slugDir, sid, 'subagents', 'agent-x' + i + '.jsonl'), recs.map(r => JSON.stringify(r)).join('\n') + '\n');
    write(path.join(slugDir, sid, 'subagents', 'agent-x' + i + '.meta.json'), JSON.stringify({ agentType: ag.type, toolUseId: 'toolu_extra_' + i }));
  });
  for (const t of o.mainTexts || []) mainRecords.push({ type: 'assistant', message: { model: models.main, role: 'assistant', content: [{ type: 'text', text: t }] } });
  mainRecords.push({ type: 'assistant', message: { model: models.main, role: 'assistant', content: toolUses.concat(o.mainTools || []) } });
  mainRecords.push({ type: 'user', message: { role: 'user', content: o.mainToolResults || [] } });
  if (o.synthetic) mainRecords.push({ type: 'assistant', message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: o.synthetic }] } });
  write(path.join(slugDir, sid + '.jsonl'), mainRecords.map(r => JSON.stringify(r)).join('\n') + '\n');
  // The report: survivors, then the Audited out log.
  let n = 0;
  const lines = ['# Review', '', 'Verdict: changes-requested - see below', '', '### Findings', ''];
  for (const id of caughtIds) lines.push(reportLine(++n, id), '  - **Fix:** One line. Ten minutes, or leave it.', '');
  for (const l of o.extraSurvivors || []) lines.push(l.replace('{n}', String(++n)), '');
  lines.push('### Audited out', '');
  for (const id of killed) {
    const k = (o.killVerdict || {})[id] || { tag: 'REFUTED', reason: 'skeptic: not reachable' };
    lines.push('- **R' + (++n) + '** [' + KIND_OF[id] + '] `' + k.tag + '` - ' + JSON.parse(findOf(id)).what + ' (' + k.reason + ')');
  }
  for (const l of o.extraKilled || []) lines.push(l.replace('{n}', String(++n)));
  if (killed.length === 0 && !(o.extraKilled || []).length) lines.push('Audited out: none - all findings survived the audit.');
  lines.push('', '### Summary', '- Specialists run: 8 of 8');
  if (!o.noReport) write(path.join(dir, 'project-reports', 'review-orchestrator-2026-10-03-120000.md'), (o.report || lines.join('\n')) + '\n');
  for (const [name, text] of Object.entries(o.plans || {})) write(path.join(dir, 'project-plans', name), text);
  const meta = { version: 1, role: 'review', arm: 'a', exitCode: 0, wallMs: 600000, lenses: kinds, paths: { tmp: '/tmp/qc-run.TEST', home, project, buildDir: home + '/.claude/plugins/cache/llm-peer-review/tk/7.4.3' }, expect: { main: 'opus', finders: 'opus', mapper: 'opus' }, ...(o.meta || {}) };
  write(path.join(dir, 'run.json'), JSON.stringify(meta));
  const result = { type: 'result', subtype: 'success', is_error: false, session_id: sid, total_cost_usd: o.cost !== undefined ? o.cost : 5, duration_ms: 600000, num_turns: 40, permission_denials: [], result: 'Review done.', ...(o.result || {}) };
  write(path.join(dir, 'result.json'), JSON.stringify(result));
  return dir;
}

function analyze(dir) { return QC.analyzeRun(QC.loadRun(dir), ANSWERS); }
const KNOWN = 'known-shell-glob';

// ---------------------------------------------------------------------------

section('arm patch', () => {
  const finder = '---\nname: review-code-finder\ndescription: x\ntools: Read, Grep, Glob\neffort: high\nskills:\n  - a\n---\n\nYou are a Staff Engineer.\n';
  const p = QC.patchAgent(finder, { model: 'sonnet', effort: 'medium' });
  check('patch: a missing model line is added right before effort', /\ntools: Read, Grep, Glob\nmodel: sonnet\neffort: medium\nskills:/.test(p), p);
  check('patch: the body is untouched', p.endsWith('---\n\nYou are a Staff Engineer.\n'), p);
  const mapper = '---\nname: index-mapper\ntools: Read\nmodel: sonnet\neffort: low\n---\nbody\n';
  const q = QC.patchAgent(mapper, { model: 'opus', effort: 'medium' });
  check('patch: existing model and effort lines are replaced in place', /\nmodel: opus\neffort: medium\n---\nbody\n$/.test(q) && (q.match(/^model:/mg) || []).length === 1, q);
  check('patch: null leaves a key alone', QC.patchAgent(mapper, { model: 'inherit', effort: null }).includes('effort: low'));
  check('lowerEffort: high -> medium, low stays low', QC.lowerEffort('high') === 'medium' && QC.lowerEffort('low') === 'low');

  const build = tmp('qc-test-build-');
  for (const k of QC.FINDER_KINDS) write(path.join(build, 'agents', 'review-' + k + '-finder.md'), finder);
  write(path.join(build, 'agents', 'index-mapper.md'), mapper);
  const b = { dir: build };
  const a = QC.armSettings('review', 'a', b, null);
  check('arm a: every finder on opus at its current effort', a.length === 8 && a.every(s => s.model === 'opus' && s.effort === 'high'), JSON.stringify(a.map(s => [s.model, s.effort])));
  const bb = QC.armSettings('review', 'b', b, null);
  check('arm b: one level lower', bb.every(s => s.model === 'opus' && s.effort === 'medium'));
  let threw = false;
  try { QC.armSettings('review', 'c', b, null); } catch (e) { threw = /--effort/.test(e.message); }
  check('arm c: refuses to run without the decided effort', threw);
  check('arm c: sonnet at the given effort', QC.armSettings('review', 'c', b, 'medium').every(s => s.model === 'sonnet' && s.effort === 'medium'));
  check('mapper arm a: opus at medium (the shipped low is under suspicion)', QC.armSettings('mapper', 'a', b, null)[0].effort === 'medium');
  check('mapper arm b: opus at low', QC.armSettings('mapper', 'b', b, null)[0].effort === 'low');
  // Arm h and --only (issue 221): one helper measured on Haiku against unchanged peers.
  const h = QC.armSettings('review', 'h', b, null);
  check('arm h: every finder on haiku at medium when no effort is given', h.length === 8 && h.every(s => s.model === 'haiku' && s.effort === 'medium' && !s.shipped), JSON.stringify(h.map(s => [s.model, s.effort])));
  check('arm h: haiku at the given effort', QC.armSettings('review', 'h', b, 'low').every(s => s.model === 'haiku' && s.effort === 'low'));
  check('mapper arm h: haiku at medium', (() => { const m = QC.armSettings('mapper', 'h', b, null)[0]; return m.model === 'haiku' && m.effort === 'medium' && !m.shipped; })());
  const only = QC.armSettings('review', 'h', b, null, ['review-deps-finder']);
  check('only: the named finder is patched and the other seven ship unchanged',
    only.filter(s => !s.shipped).map(s => s.name).join() === 'review-deps-finder' && only.filter(s => s.shipped).length === 7 && only.filter(s => s.shipped).every(s => s.model === QC.frontmatterValue(finder, 'model')),
    JSON.stringify(only.map(s => [s.name, s.shipped ? 'ship' : s.model])));
  check('only: an empty list patches every finder', QC.armSettings('review', 'h', b, null, []).every(s => !s.shipped));
  let onlyThrew = false;
  try { QC.armSettings('review', 'h', b, null, ['review-nope-finder']); } catch (e) { onlyThrew = /--only names no review agent: review-nope-finder/.test(e.message); }
  check('only: an unknown agent name throws and names the choices', onlyThrew);
});

section('finder output and matching', () => {
  check('NO FINDINGS is a clean empty result', QC.parseFinderOutput('NO FINDINGS').noFindings === true);
  check('empty output is reported as empty', QC.parseFinderOutput('  \n').empty === true);
  const fenced = QC.parseFinderOutput('```jsonl\n' + FINDS['code-search-prefix']() + '\n```');
  check('one surrounding code fence is tolerated', fenced.findings.length === 1 && fenced.broken.length === 0);
  const prose = QC.parseFinderOutput('Here are my findings:\n' + FINDS['code-search-prefix']());
  check('a prose line beside JSONL is kept apart from the findings', prose.broken.length === 1 && prose.findings.length === 1);
  for (const b of ANSWERS.bugs) {
    check('the canned finding for ' + b.id + ' matches it', QC.bugMatches(b, QC.rawToMatchable(JSON.parse(FINDS[b.id]()))));
  }
  // Each canned finding matches its own bug and no other: the key is not ambiguous.
  for (const b of ANSWERS.bugs) {
    const others = ANSWERS.bugs.filter(x => x.id !== b.id && QC.bugMatches(x, QC.rawToMatchable(JSON.parse(FINDS[b.id]()))));
    check('the canned finding for ' + b.id + ' matches no other bug', others.length === 0, others.map(x => x.id).join(','));
  }
  const kb = BUG[KNOWN];
  check('known answer: a nearby line without the substance is not a catch', !QC.bugMatches(kb, { file: 'scripts/rotate-backups.sh', line: 13, text: 'Optional. The loop may run slowly on many backups.' }));
  check('known answer: "no match" on an empty folder is a catch without the option names', QC.bugMatches(kb, { file: 'scripts/rotate-backups.sh', line: 40, text: 'Blocks. A fresh checkout stops with no match before any backup is made.' }));
  check('a finding in another file never matches', !QC.bugMatches(BUG['code-search-prefix'], { file: 'public/app.js', line: 61, text: 'indexOf starts with' }));
  check('a fileless finding matches only a bug that allows it', QC.bugMatches(BUG['deps-lodash-cve'], { file: '', line: null, text: 'lodash 4.17.15 has a prototype pollution advisory' }) && !QC.bugMatches(BUG['code-search-prefix'], { file: '', line: null, text: 'indexOf' }));
  check('ux: "could not confirm" is not a missing confirmation', !QC.bugMatches(BUG['ux-clear-all-no-confirm'], { file: 'public/app.js', line: 20, text: 'Optional. I could not confirm the clear button works because the script crashed.' }));
  // Real findings from the first live probe (e22d24d, code lens). The two
  // unrelated ones sat on a planted bug's lines and were credited by line alone
  // before the key stopped matching on lines; the plain-words catch was missed
  // because the key only knew the option names, which the contract keeps out
  // of a finding's sentences.
  const live = {
    stale: { severity: 'suggest', file: { relPath: 'public/app.js', line: 37 }, what: 'Optional. Per-keystroke searches may render stale results when an older response arrives after a newer one.', receipt: { check: "sed -n '31,45p;61p' public/app.js", expect: 'each input fires an unguarded fetch' } },
    crash: { severity: 'block', file: { relPath: 'server.js', line: 103 }, what: 'Blocks. A single malformed percent sign in any page URL throws and stops the server for everyone.', receipt: { check: "grep -n 'decodeURIComponent\\|serveStatic(req, res, url)' server.js", expect: 'the decode is at line 103 and the unguarded call at line 121' } },
    glob: { severity: 'warn', file: { relPath: 'scripts/rotate-backups.sh', line: 13 }, what: 'Should fix. The empty-folder guard probably breaks the first backup run, because the abort-on-no-match setting overrides it.', context: 'Bash checks the abort setting before the empty-match setting.' },
  };
  check('live: a stale-results finding on the browser bug\'s line is not the browser bug', !QC.bugMatches(BUG['browser-search-id'], QC.rawToMatchable(live.stale)));
  check('live: a malformed-URL crash on the traversal bug\'s lines is not the traversal', !QC.bugMatches(BUG['security-path-traversal'], QC.rawToMatchable(live.crash)));
  check('live: the known answer in plain words, with no option names, is a catch', QC.bugMatches(BUG[KNOWN], QC.rawToMatchable(live.glob)));
  check('a browser finding that names the page URL counts as naming no file', QC.bugMatches(BUG['browser-search-id'], { file: 'http://localhost:3000/', line: null, text: 'Blocks. The page throws a TypeError at load and no notes appear.' }));
  check('the receipt is never part of the matched text', !QC.findingText({ what: 'x', receipt: { check: 'grep failglob', expect: 'y' } }).includes('failglob'));
  // From the first full run: a different copy finding whose receipt quotes the
  // planted title as context, and a known-answer catch whose sentences say
  // "null-match option" while only the receipt names the option.
  const r23 = { severity: 'suggest', file: { relPath: 'README.md', line: 11 }, what: 'Optional. The README misses the new Search, Export and Clear all features, so readers never learn what they do.', fix: 'One short section on finding, downloading and deleting notes.', receipt: { check: "grep -niE 'search|export|clear' README.md", expect: 'the only hit is the developer-shorthand intro on line 3' } };
  check('live: evidence that quotes the planted title as context does not make a different finding the copy bug', !QC.bugMatches(BUG['copy-unclear-headline'], QC.rawToMatchable(r23)));
  const nullMatch = { severity: 'warn', file: { relPath: 'scripts/rotate-backups.sh', line: 13 }, what: 'Should fix. Turning on the null-match option probably does not override the failing one, so the first backup breaks.', receipt: { check: "bash -c 'shopt -s failglob nullglob; for f in /x/*.json; do :; done'", expect: 'no match: /x/*.json, exit 1' } };
  check('live: the known answer phrased as a null-match option is a catch on its sentences alone', QC.bugMatches(BUG[KNOWN], QC.rawToMatchable(nullMatch)));
  check('live: a vague sentence is not a catch, whatever its receipt names', !QC.bugMatches(BUG[KNOWN], QC.rawToMatchable({ ...nullMatch, what: 'Should fix. The first backup breaks.' })));
  const r5 = { what: 'Should fix. Clear all deletes every note in one click, with no confirmation and no undo.', context: 'It sits beside Export with the same styling.', fields: [{ label: 'Actual', value: 'The server sets notes to [] and overwrites data/notes.json (server.js:86-89).' }] };
  check('live: an attachment naming Export and notes.json does not make a finding the export bug', !QC.bugMatches(BUG['plan-export-json'], { ...QC.rawToMatchable(r5), file: 'server.js' }));
  // From the second e22d24d run: a finding about the empty-search message says
  // losing notes "cannot be undone", which alone matched the clear-all key.
  const r13 = { severity: 'warn', file: { relPath: 'public/app.js', line: 15 }, what: 'Should fix. A search with no results shows \'No notes yet\', which misleads people into thinking their notes are gone.', context: 'It fires on any typo in the search box, in an app where losing notes cannot be undone.', fix: 'One branch: show a separate no-matches message when a search is active.' };
  check('live: a finding that only says losing notes cannot be undone is not the clear-all bug', !QC.bugMatches(BUG['ux-clear-all-no-confirm'], QC.rawToMatchable(r13)));
  // Step 7's fit review (2026-10-03): the lodash finding said "version pin ... library",
  // which the key's "pinned library" wording missed; the size finding beside it is not the bug.
  const r18 = { severity: 'warn', file: { relPath: 'package-lock.json', line: 16 }, what: 'Should fix. The exact version pin locks in a library with known high-severity injection and prototype-pollution flaws.' };
  const size = { severity: 'warn', file: { relPath: 'package.json', line: 13 }, what: 'Should fix. A whole runtime library for one de-duplicate call skips the project\'s zero-dependency design and lands on server installs.' };
  check('live: a version pin on a library with high-severity flaws is the lodash bug', QC.bugMatches(BUG['deps-lodash-cve'], QC.rawToMatchable(r18)));
  check('live: a library pulled in for one call is not the lodash bug', !QC.bugMatches(BUG['deps-lodash-cve'], QC.rawToMatchable(size)));
  check('live: the clear-all catch still matches with the clearing action required', QC.bugMatches(BUG['ux-clear-all-no-confirm'], { file: 'public/app.js', line: 41, text: 'Should fix. Once the crash is fixed, one tap on Clear all deletes every note with no way back.' }));
});

section('report parsing', () => {
  const md = [
    'Verdict: changes-requested - two blocks',
    '```',
    '🚫 2 Blocks: R1 [security] (server.js:104 - Blocks. Leaks files), R2 [code] (scripts/rotate-backups.sh:13 - Blocks. failglob aborts)',
    '```',
    '### Findings',
    '- **R1** [security] 🚫 `server.js:104` - Blocks. A crafted path leaks files outside the public folder.',
    '  - Anyone on the network can read the server source.',
    '  - **Fix:** One check. An hour.',
    '### More findings',
    'R4 ⚠️ README.md:1 - Should fix. The title misses what the app is.',
    '### Audited out',
    '- **R3** [ux] `REFUTED` - Should fix. Clear all deletes every note with no confirmation step. (skeptic: by design)',
    '### Summary',
    '- Blocks: 2',
  ].join('\n');
  const r = QC.parseReport(md);
  const ids = r.survivors.map(s => s.id).sort();
  check('survivors include full entries, compact lines and Top Issues mentions', JSON.stringify(ids) === JSON.stringify(['R1', 'R2', 'R4']), JSON.stringify(ids));
  check('the Audited out section is the killed list', r.killed.map(k => k.id).join() === 'R3');
  const r2 = r.survivors.find(s => s.id === 'R2');
  check('a finding named only in Top Issues still catches its bug', QC.entryMatches(BUG[KNOWN], r2), JSON.stringify(r2));
  check('a sub-bullet adds to its entry', r.survivors.find(s => s.id === 'R1').text.includes('Anyone on the network'));
});

section('report cross-references and evidence', () => {
  // The first full run's report: two refuted findings give "while R1 stands" as
  // their reason, and the Staff Check prose cites R1 to R3 beside "CSV export".
  const md = [
    '### Top Issues',
    '🚫 2 Blocks: R1 [code, browser] (public/app.js:7 - the page script crashes on load, so notes never appear), R3 [code] (server.js:103 - one malformed URL stops the server)',
    '## Findings',
    '- **R1** [code, browser] 🚫 `public/app.js:7` - Blocks. The page script crashes on load, so saved notes never appear.',
    '  - **Receipt:** `grep -n search-box public/app.js` - line 7, exit 0.',
    '- **R3** [code] 🚫 `server.js:103` - Blocks. A badly encoded address throws an error nothing catches.',
    '  - **Receipt:** `sed -n 90,110p server.js` - shows the export route with application/json and notes-export.json, exit 0.',
    '- **R5** [ux] ⚠️ `public/app.js:41` - Should fix. Clear all deletes every note with no confirmation.',
    '  - **Actual:** the server overwrites data/notes.json; the button sits next to Export.',
    '### Audited out',
    '- **R19** [code] `REFUTED` - Optional. Saving reloads the full list. (skeptic: search never filters while R1 stands)',
    '  - split: The submit handler reloads without the query.',
    '### Staff Check',
    'The commit breaks the page (R1), widens serving (R2, R3), and misses the CSV export decision.',
  ].join('\n');
  const r = QC.parseReport(md);
  check('a refuted finding\'s "while R1 stands" does not kill R1', r.survivors.some(e => e.id === 'R1') && r.killed.map(k => k.id).join() === 'R19', JSON.stringify(r.killed.map(k => k.id)));
  const r3 = r.survivors.find(e => e.id === 'R3');
  check('Staff Check prose adds nothing to a finding', !/csv/i.test(r3.text), r3.text);
  check('a Receipt row is evidence, not the entry\'s sentences', !/notes-export/.test(r3.text) && /notes-export/.test(r3.evidence));
  check('so the crash entry is not the export bug, though its receipt shows the export route', !QC.entryMatches(BUG['plan-export-json'], r3));
  check('and not the traversal either, though both sit on the same lines', !QC.entryMatches(BUG['security-path-traversal'], r3));
  const r5 = r.survivors.find(e => e.id === 'R5');
  check('an attachment row is evidence too', /Actual/.test(r5.evidence) && !/notes\.json/.test(r5.text));
  check('the browser entry still matches on its own words', QC.entryMatches(BUG['browser-search-id'], r.survivors.find(e => e.id === 'R1')));
  check('a split line is kept apart', /submit handler/.test(r.killed[0].split) && !/submit handler/.test(r.killed[0].text));
  // Linking: the entry's sentences say only "the first backup breaks", and the
  // raw finding's receipt names the option; the link carries the catch over.
  const entries = QC.parseReport('- **R6** [code] ⚠️ `scripts/rotate-backups.sh:13` - Should fix. Turning on the null-match option probably does not override the failing one, so the first backup breaks.').survivors;
  const links = QC.linkRaw([{ what: 'Should fix. Turning on the null-match option probably does not override the failing one, so the first backup breaks.', key: 'k1' }, { what: 'something else entirely, long enough', key: 'k1' }], entries);
  check('a raw finding links to the entry its sentence was copied into, and its dedup twin shares the link', links[0].join() === 'R6' && links[1].join() === 'R6', JSON.stringify(links));
});

section('login token window', () => {
  const now = Date.parse('2026-10-03T21:00:00Z');
  const need = 105 * 60 * 1000;
  // The fake tokens are built at runtime: a token-shaped literal after a key name
  // trips the pre-push tripwire, which has no allow-list by design (LESSONS).
  const fake = (kind, n) => ['FAKE', kind, n].join('-');
  const creds = (ms) => JSON.stringify({ claudeAiOauth: { accessToken: fake('ACCESS', 7731), refreshToken: fake('REFRESH', 9907), expiresAt: now + ms } });
  check('a token that outlasts the run window starts the run', QC.tokenWindowProblem(creds(8 * 3600 * 1000), now, need) === null);
  const close = QC.tokenWindowProblem(creds(40 * 60 * 1000), now, need);
  check('a token expiring inside the run window stops it, naming the minutes left', typeof close === 'string' && /expires in 40 min/.test(close), String(close));
  check('an expired token stops it at zero minutes', /expires in 0 min/.test(String(QC.tokenWindowProblem(creds(-5 * 60 * 1000), now, need))));
  check('no credentials file, an unreadable one, or no expiry raises nothing',
    QC.tokenWindowProblem(null, now, need) === null && QC.tokenWindowProblem('not json', now, need) === null &&
    QC.tokenWindowProblem(JSON.stringify({ apiKey: 'z' }), now, need) === null);
  check('the reason never carries a token', !/FAKE-ACCESS-7731|FAKE-REFRESH-9907/.test(String(close)), String(close));
});

section('validity', () => {
  const ok = analyze(makeReviewRun({ caught: ['code-search-prefix'] }));
  check('a clean canned run is valid', ok.valid, ok.reasons.join(', '));
  check('a catch: the bug survived', ok.survived['code-search-prefix'].length === 1);
  check('a miss: an uncaught bug did not survive', ok.survived['security-path-traversal'].length === 0);

  const plugin = analyze(makeReviewRun({ caught: [], mainTools: [
    { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/tmp/qc-run.TEST/home/.claude/plugins/cache/llm-peer-review/tk/7.4.3/skills/shared/hitl-loop.md' } },
    { type: 'tool_use', id: 'r2', name: 'Read', input: { file_path: '/tmp/qc-run.TEST/home/.claude/plugins/data/tk-llm-peer-review/current/skills/shared/toolkit-reference.md' } },
    { type: 'tool_use', id: 'r3', name: 'Bash', input: { command: 'node /tmp/qc-run.TEST/home/.claude/plugins/cache/llm-peer-review/tk/7.4.3/scripts/session-init.js --scope abc..HEAD' } },
  ] }));
  check('a build read through the plugin cache or the stable path is allowed', plugin.valid, plugin.reasons.join(', '));

  const outside = analyze(makeReviewRun({ mainTools: [
    { type: 'tool_use', id: 'o1', name: 'Read', input: { file_path: '/home/someone/Projects/llm-peer-review/scripts/fixtures/quality-check/notebook/answers.json' } },
    { type: 'tool_use', id: 'o2', name: 'Bash', input: { command: 'cat /home/someone/notes.txt | head' } },
    { type: 'tool_use', id: 'o3', name: 'Grep', input: { pattern: 'x', path: '../../../home/someone' } },
  ] }));
  check('an outside read makes the run invalid', !outside.valid && outside.reasons.some(r => /^outside-read:3$/.test(r)), outside.reasons.join(', ') + ' ' + JSON.stringify(outside.outside));

  const judge = analyze(makeReviewRun({ models: { judge: SONNET } }));
  check('a judge on the wrong model makes the run invalid', !judge.valid && judge.reasons.some(r => /^model:tk:audit-skeptic=sonnet/.test(r)), judge.reasons.join(', '));
  const finderWrong = analyze(makeReviewRun({ models: { finder: SONNET } }));
  check('a finder off its arm\'s model makes the run invalid', !finderWrong.valid && finderWrong.reasons.some(r => /^model:tk:review-code-finder=sonnet/.test(r)));
  const finderRight = analyze(makeReviewRun({ models: { finder: SONNET }, meta: { expect: { main: 'opus', finders: 'sonnet' } } }));
  check('a finder on its arm\'s model (Sonnet for arm c) is valid', finderRight.valid, finderRight.reasons.join(', '));

  const denied = analyze(makeReviewRun({ result: { permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'npm audit --json' } }] } }));
  check('a denied call makes the run invalid', !denied.valid && denied.reasons.includes('denied:1'));
  const deniedSub = analyze(makeReviewRun({ mainToolResults: [{ type: 'tool_result', tool_use_id: 'x', is_error: true, content: 'Permission to use Bash with command npm audit --json has been denied.' }] }));
  check('a denial written into a transcript makes the run invalid', !deniedSub.valid && deniedSub.reasons.includes('denied-in-transcript'));

  // #253: a read-only judge's denied scratch experiment is a warning, not an invalid
  // run. The three shapes below are the real denied calls from the 2026-10-13
  // d1b-rerun and fix-d3 runs, with this fixture's paths.
  const PAD = '/tmp/claude-1000/-tmp-qc-run-TEST-project/sess/scratchpad';
  const DENY = 'Permission to use Bash has been denied. IMPORTANT: You *may* attempt to accomplish this action using other tools that might naturally be used to accomplish this goal, e.g. using head instead of cat.';
  let denyN = 0;
  const deniedBy = (type, command, tool) => {
    const id = 'toolu_deny_' + (++denyN);
    const input = tool && tool !== 'Bash' ? { file_path: command, content: 'x' } : { command };
    return { type, tools: [{ type: 'tool_use', id, name: tool || 'Bash', input }], results: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: DENY }] };
  };
  const show = r => (r.valid ? 'valid' : 'INVALID') + ' reasons [' + r.reasons.join(', ') + '] warnings [' + r.warnings.join(', ') + ']';
  const exempt = (r, n) => r.valid && !r.reasons.includes('denied-in-transcript') && r.warnings.includes('denied-experiment:' + n);
  const skepticWrite = 'd=' + PAD + '/globtest; mkdir -p $d/backups && cd $d && bash -c \'set -euo pipefail; shopt -s failglob; shopt -s nullglob; existing=(); for f in backups/notes-*.json; do existing+=("$f"); done; echo reached ${#existing[@]}\'; echo "exit $?"; bash --version | head -1';
  const skepticLoop = 'bash -c \'set -euo pipefail; shopt -s failglob; shopt -s nullglob; existing=(); for f in /tmp/qc-run.TEST/project/backups-none/notes-*.json; do existing+=("$f"); done; echo "after loop: ${#existing[@]}"\'; echo "exit $?"';
  // The fix-d3 verifier's call in full: its comment's "sorts..." is an ellipsis, not a path step.
  const verifierRun = 'S=' + PAD + '; rm -rf $S/r2; mkdir -p $S/r2/data $S/r2/backups && cd $S/r2 && echo \'[]\' > data/notes.json\nSCR=/tmp/qc-run.TEST/project/scripts/rotate-backups.sh\n# empty backups first run\nbash $SCR; echo "exit=$? count=$(ls backups | wc -l)"\nrm backups/*; for i in 1 2 3 4 5 6 7; do echo old$i > backups/notes-2026010$i-000000.json; done\nbash $SCR >/dev/null; echo "normal: $(ls backups | wc -l)"; ls backups\nbash $SCR >/dev/null; bash $SCR >/dev/null; echo "same-second x2: $(ls backups | wc -l)"; ls backups\n# new copy name sorts... check newest present\nmv data/notes.json data/x; bash $SCR; echo "failcopy exit=$? count=$(ls backups|wc -l)"; mv data/x data/notes.json';
  const w1 = analyze(makeReviewRun({ agents: [deniedBy('tk:audit-skeptic', skepticWrite)] }));
  check('253 experiment: a skeptic\'s denied write in its scratchpad is a warning, not an invalid run', exempt(w1, 1), show(w1));
  const w2 = analyze(makeReviewRun({ agents: [deniedBy('tk:audit-skeptic', skepticLoop)] }));
  check('253 experiment: a skeptic\'s denied read-only loop over the scratch project is a warning', exempt(w2, 1), show(w2));
  const w3 = analyze(makeReviewRun({ agents: [deniedBy('tk:fix-verifier', verifierRun)] }));
  check('253 experiment: a verifier\'s denied call on its scratchpad, the project\'s script and /dev/null is a warning', exempt(w3, 1), show(w3));
  const w4 = analyze(makeReviewRun({ agents: [deniedBy('tk:audit-skeptic', skepticWrite), deniedBy('fix-verifier', verifierRun)] }));
  check('253 experiment: two exempt denials in one run, one by an unprefixed agent type, give denied-experiment:2', exempt(w4, 2), show(w4));

  // Every other denial still invalidates the run. The call never ran (it was denied),
  // so this guards scoring, not safety: a call that names or can reach a place outside
  // the run is still looked at.
  const stays = (label, opts) => {
    const r = analyze(makeReviewRun(opts));
    check('253 stays invalid: ' + label, !r.valid && r.reasons.includes('denied-in-transcript') && !r.warnings.some(x => /^denied-experiment/.test(x)), show(r));
  };
  const judgeSays = command => ({ agents: [deniedBy('tk:audit-skeptic', command)] });
  stays('a finder\'s denied write in the scratchpad', { agents: [deniedBy('tk:review-code-finder', 'mkdir -p ' + PAD + '/x')] });
  stays('the main session\'s denied write in the scratchpad', {
    mainTools: [{ type: 'tool_use', id: 'm-den', name: 'Bash', input: { command: 'mkdir -p ' + PAD + '/x' } }],
    mainToolResults: [{ type: 'tool_result', tool_use_id: 'm-den', is_error: true, content: DENY }],
  });
  stays('a judge\'s call naming a home folder', judgeSays('cat /home/someone/.ssh/id_rsa > ' + PAD + '/x'));
  stays('a judge\'s call naming /etc/passwd', judgeSays('cat /etc/passwd > ' + PAD + '/x'));
  stays('a judge\'s call in another run\'s scratchpad', judgeSays('mkdir -p /tmp/claude-1000/-tmp-qc-run-OTHER-project/sess/scratchpad/x'));
  stays('a judge\'s call in a sibling folder sharing the run\'s prefix', judgeSays('ls /tmp/qc-run.TEST-evil/project > ' + PAD + '/x'));
  stays('a judge\'s call with a .. escape', judgeSays('cat ' + PAD + '/../../../../etc/passwd'));
  stays('a judge\'s call with ~', judgeSays('cat ~/.bashrc > ' + PAD + '/x'));
  stays('a judge\'s call naming a URL', judgeSays('curl https://example.com/x -o ' + PAD + '/x'));
  stays('a judge\'s call naming no absolute path', judgeSays('mkdir -p backups && ls backups'));
  stays('a judge\'s call expanding $HOME', judgeSays('cp $HOME/.bashrc ' + PAD + '/x'));
  stays('a judge\'s call expanding ${HOME}', judgeSays('cp ${HOME}/.bashrc ' + PAD + '/x'));
  stays('a judge\'s call expanding $TMPDIR', judgeSays('ls $TMPDIR ' + PAD));
  stays('a judge\'s call expanding $OLDPWD', judgeSays('cd ' + PAD + ' && cd $OLDPWD && ls'));
  stays('a judge\'s call with a variable it assigns empty', judgeSays('d=; cat ' + PAD + '/x $d/etc/passwd'));
  stays('a judge\'s call with an indirect expansion', judgeSays('v=HOME; ls ${!v} ' + PAD));
  stays('a judge\'s call with a backtick', judgeSays('cat `echo /etc/passwd` ' + PAD + '/x'));
  stays('a judge\'s call with a backslash escape', judgeSays('ls ' + PAD + '; printf \'\\057etc\\057passwd\''));
  stays('a judge\'s call that splits a path with quotes', judgeSays('cat /e\'\'tc/passwd ' + PAD + '/x'));
  stays('a judge\'s call with eval', judgeSays('eval cat ' + PAD + '/x'));
  stays('a judge\'s call with a bare cd', judgeSays('cd ' + PAD + ' && cd && cat .bashrc'));
  stays('a judge\'s call with cd -', judgeSays('cd ' + PAD + ' && cd - && ls'));
  stays('a judge\'s call with pushd and popd', judgeSays('pushd ' + PAD + ' && popd && ls'));
  // Review of #253 (R1, R3): two shapes that leave the run without naming an outside path.
  stays('a judge\'s call that climbs out through command output', judgeSays('cd "$(dirname "$(pwd)")" && cat secret 2>/dev/null'));
  stays('a judge\'s call that resolves a path it does not name', judgeSays('cat "$(realpath x)" > ' + PAD + '/x'));
  stays('a judge\'s call with a parent-folder step right after a variable', judgeSays('d=/tmp/qc-run.TEST/; cat $d../etc 2>/dev/null'));
  stays('a judge\'s call with a parent-folder step right after a braced variable', judgeSays('d=/tmp/qc-run.TEST/project; cat ${d}../x > ' + PAD + '/x'));
  stays('a judge\'s denied Write in the scratchpad', { agents: [deniedBy('tk:audit-skeptic', PAD + '/x.txt', 'Write')] });
  // A mixed run is invalid on its other denial; the exempt one is still counted.
  const mixed = analyze(makeReviewRun({ agents: [deniedBy('tk:audit-skeptic', skepticWrite), deniedBy('tk:audit-skeptic', 'cat /etc/passwd > ' + PAD + '/x')] }));
  check('253 stays invalid: a run with one exempt and one non-exempt denial', !mixed.valid && mixed.reasons.includes('denied-in-transcript') && mixed.warnings.includes('denied-experiment:1'), show(mixed));

  const early = analyze(makeReviewRun({ meta: { exitCode: 1 }, result: { subtype: 'error_max_turns', is_error: true } }));
  check('an early end makes the run invalid', !early.valid && early.reasons.includes('exit:1') && early.reasons.includes('ended:error_max_turns'));
  const limit = analyze(makeReviewRun({ synthetic: 'Claude usage limit reached. Your limit will reset at 5pm.' }));
  check('a usage limit is flagged as such', !limit.valid && limit.reasons.includes('usage-limit'));
  const words = analyze(makeReviewRun({ result: { result: 'R2: the delete endpoint has no rate limit.' } }));
  check('a finding that mentions a rate limit is not a usage limit', words.valid, words.reasons.join(', '));

  const empty = analyze(makeReviewRun({ finderOut: { deps: '' } }));
  check('an empty finder makes the run invalid', !empty.valid && empty.reasons.includes('empty-finder:deps'));
  const missing = analyze(makeReviewRun({ lenses: QC.FINDER_KINDS.filter(k => k !== 'browser'), meta: { lenses: QC.FINDER_KINDS } }));
  check('a lens that never ran makes the run invalid', !missing.valid && missing.reasons.includes('missing-lens:browser'));
  const noReport = analyze(makeReviewRun({ noReport: true }));
  check('no report makes the run invalid', !noReport.valid && noReport.reasons.includes('no-report'));
  const broken = analyze(makeReviewRun({ finderOut: { copy: 'I reviewed the README and it looks fine.' } }));
  check('unusable output (no JSONL, no NO FINDINGS) is a contract break, and alone does not invalidate', broken.valid && broken.contractBreaks === 1, broken.reasons.join(', '));
  const wrapped = analyze(makeReviewRun({ caught: ['copy-unclear-headline'], finderOut: { copy: 'I found one problem:\n' + FINDS['copy-unclear-headline']() + '\nFiles cited: README.md' } }));
  check('prose wrapped around usable JSONL is a format note, not a break', wrapped.valid && wrapped.contractBreaks === 0 && wrapped.wrapped === 1, JSON.stringify({ b: wrapped.contractBreaks, w: wrapped.wrapped }));
  const killed = analyze(makeReviewRun({ killed: ['security-path-traversal'] }));
  check('a raw catch the audit killed: raised, not survived, marked', killed.raised['security-path-traversal'].length === 1 && killed.survived['security-path-traversal'].length === 0 && killed.killedRaised['security-path-traversal'] === true);
});

section('scoring bar', () => {
  const all = IDS;
  const noCopy = IDS.filter(id => id !== 'copy-unclear-headline');
  const base = [analyze(makeReviewRun({ caught: all, cost: 6 })), analyze(makeReviewRun({ caught: noCopy, cost: 6 }))];
  const pass = QC.scoreSets([analyze(makeReviewRun({ caught: all, cost: 4 })), analyze(makeReviewRun({ caught: all, cost: 4 }))], base, IDS, { knownId: KNOWN });
  check('a noisy bug (one baseline run of two) is not scored', pass.noisy.includes('copy-unclear-headline') && !pass.stable.includes('copy-unclear-headline'));
  check('a candidate pair that misses nothing passes', pass.verdict === 'PASS', pass.verdict + ' ' + pass.why);
  const noTraversal = noCopy.filter(id => id !== 'security-path-traversal');
  const once = QC.scoreSets([analyze(makeReviewRun({ caught: noTraversal })), analyze(makeReviewRun({ caught: all }))], base, IDS, { knownId: KNOWN });
  check('one miss in a pair is noise: the other run is its rerun', once.verdict === 'PASS', once.verdict + ' ' + once.why);
  const twice = QC.scoreSets([analyze(makeReviewRun({ caught: noTraversal })), analyze(makeReviewRun({ caught: noTraversal }))], base, IDS, { knownId: KNOWN });
  check('a stable catch missed by both runs fails', twice.verdict === 'FAIL' && twice.failed.join() === 'security-path-traversal', twice.verdict + ' ' + twice.why);
  const single = QC.scoreSets([analyze(makeReviewRun({ caught: noTraversal }))], base, IDS, { knownId: KNOWN });
  check('a single run that misses a stable catch asks for one rerun', single.verdict === 'RERUN' && single.single.join() === 'security-path-traversal', single.verdict);
  const withRerun = QC.scoreSets([analyze(makeReviewRun({ caught: noTraversal })), analyze(makeReviewRun({ caught: noTraversal }))], base, IDS, { knownId: KNOWN });
  check('the rerun missing the same bug again fails', withRerun.verdict === 'FAIL');

  const noKnown = all.filter(id => id !== KNOWN);
  const knownMissed = QC.scoreSets([analyze(makeReviewRun({ caught: noKnown })), analyze(makeReviewRun({ caught: noKnown }))], base, IDS, { knownId: KNOWN, requireKnown: true });
  check('known answer: a finder arm that misses it twice fails', knownMissed.verdict === 'FAIL' && knownMissed.failed.includes(KNOWN));
  const baseNoKnown = [analyze(makeReviewRun({ caught: noKnown })), analyze(makeReviewRun({ caught: all }))];
  const page = QC.scoreSets([analyze(makeReviewRun({ caught: all }))], baseNoKnown, IDS, { knownId: KNOWN, requireKnown: true });
  check('known answer: when the baseline does not catch it every time, the arm bar pages', page.verdict === 'PAGE', page.verdict);
  const grade = QC.scoreSets([analyze(makeReviewRun({ caught: all }))], baseNoKnown, IDS, { knownId: KNOWN });
  check('known answer: a grade without the arm bar scores it like any noisy bug', grade.verdict === 'PASS' && grade.noisy.includes(KNOWN));

  const breaks = QC.scoreSets([analyze(makeReviewRun({ caught: all, finderOut: { copy: 'prose' } })), analyze(makeReviewRun({ caught: all, finderOut: { ux: 'prose' } }))], base, IDS, { knownId: KNOWN });
  check('contract breaks in two runs fail', breaks.verdict === 'FAIL' && /contract breaks in 2 runs/.test(breaks.why.join()), breaks.verdict + ' ' + breaks.why);
  const invalidOnly = QC.scoreSets([analyze(makeReviewRun({ caught: all, meta: { exitCode: 1 } }))], base, IDS, { knownId: KNOWN });
  check('a set with no valid run is INVALID, never PASS', invalidOnly.verdict === 'INVALID');
});

section('mapper coverage', () => {
  const files = ['plugin/scripts/a.js', '.claude/scripts/a.js', 'docs/b.md', 'scripts/c.js'];
  const blocks = QC.parseMapperOutput([
    '## .claude/scripts/a.js (and its twin plugin/scripts/a.js)',
    '**Purpose:** Prints the session context as JSON.',
    '',
    '## docs/b.md',
    '**Purpose:** purpose unclear',
    '',
    '## scripts/c.js',
    '**Purpose:** Builds the plugin.',
  ].join('\n'));
  const cov = QC.mapperCoverage(files, new Set(['.claude/scripts/a.js', 'docs/b.md']), blocks);
  check('twin coverage: a file whose twin was opened and that is described counts', cov.covered.includes('plugin/scripts/a.js') && cov.viaTwin.join() === 'plugin/scripts/a.js', JSON.stringify(cov));
  check('purpose unclear is not coverage, even when opened', !cov.covered.includes('docs/b.md'));
  check('described but never opened is not coverage', !cov.covered.includes('scripts/c.js'));
  check('twinOf maps both ways and ignores other folders', QC.twinOf('plugin/skills/x/SKILL.md') === '.claude/skills/x/SKILL.md' && QC.twinOf('.claude/agents/y.md') === 'plugin/agents/y.md' && QC.twinOf('plugin/seed/CLAUDE.md') === null);
  const t = QC.fillMapperTemplate('intro\n**Files in your chunk:**\n{for each file: `- {file.path}`}\nrest', ['a.js', 'b.js']);
  check('the template\'s file-list line becomes the chunk list', t === 'intro\n**Files in your chunk:**\n- a.js\n- b.js\nrest', t);
});

// Every fixture, Notebook and Pocket alike (#278): the key's line ranges exist in
// the built tree, nothing stored is live in this repo, no file a finder reads
// says what was planted, and the renames happen.
const FIXTURE_NAMES = ['notebook', 'pocket'];
section('fixture', () => {
  for (const name of FIXTURE_NAMES) {
    const dir = path.resolve(__dirname, 'fixtures', 'quality-check', name);
    let key = null;
    try { key = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8')); } catch (e) { key = null; }
    if (!key) { check(name + ': the fixture has an answer key', false, 'no readable answers.json in scripts/fixtures/quality-check/' + name); continue; }
    const dest = tmp('qc-test-fixture-' + name + '-');
    QC.copyFixture(path.join(dir, 'base'), dest);
    QC.copyFixture(path.join(dir, 'change'), dest);
    const commands = path.join(dest, '.claude', 'commands');
    check(name + ': renames: dot-claude and dot-gitignore become dot folders, .fixture is dropped',
      fs.existsSync(commands) && fs.readdirSync(commands).some(c => c.endsWith('.md')) && fs.existsSync(path.join(dest, '.gitignore')) && fs.existsSync(path.join(dest, 'package.json')) && fs.existsSync(path.join(dest, 'package-lock.json')));
    for (const b of key.bugs) {
      for (const [file, start, end] of b.lines) {
        const abs = path.join(dest, file);
        const n = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').split('\n').length : 0;
        check(name + ': answer key ' + b.id + ': ' + file + ' exists and holds lines ' + start + '-' + end, n >= end && start >= 1, 'lines in file: ' + n);
      }
    }
    // Inert in this repo: nothing the repo's own tooling would pick up by name.
    const stored = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else stored.push(path.relative(dir, p)); } })(dir);
    const live = stored.filter(p => /(^|\/)(package\.json|package-lock\.json|CLAUDE\.md|\.gitignore)$/.test(p) || /(^|\/)\.claude\//.test(p));
    check(name + ': the stored fixture carries no live package, lockfile, CLAUDE.md, .gitignore or .claude folder', live.length === 0, live.join(', '));
    // Neutral: no file the finders read says what was planted (LESSONS, #204).
    const telling = stored.filter(p => /^(base|change)\//.test(p)).filter(p => /\b(planted|answer key|deliberate(ly)? (bug|broken)|known[- ]answer|quality[- ]check|test fixture)\b/i.test(fs.readFileSync(path.join(dir, p), 'utf8')));
    check(name + ': no fixture file names what was planted', telling.length === 0, telling.join(', '));
  }
});

// Pocket's shape (#278): one planted bug per lens plus one known-answer case,
// seven of them runnable, and the change's lockfile pinning moment where the
// dependency lens can find it. A missing file is reported by name, not thrown.
section('the pocket fixture (#278)', () => {
  const dir = path.resolve(__dirname, 'fixtures', 'quality-check', 'pocket');
  const read = file => { try { return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch (e) { return null; } };
  const key = read('answers.json');
  const lock = read(path.join('change', 'package-lock.json.fixture'));
  if (!key || !lock) {
    check('pocket: one planted bug per lens, one known-answer case, seven runnable', false, [!key && 'no pocket/answers.json', !lock && 'no pocket/change/package-lock.json.fixture'].filter(Boolean).join('; '));
    return;
  }
  const bugs = key.bugs || [];
  const lenses = bugs.filter(b => !b.knownAnswer).map(b => b.lens).sort();
  const known = bugs.filter(b => b.knownAnswer).map(b => b.id);
  const noOracle = bugs.filter(b => b.noOracle).map(b => b.id).sort();
  const moment = (lock.packages || {})['node_modules/moment'] || {};
  check('pocket: one planted bug per lens, one known-answer case, seven runnable',
    bugs.length === 9 && lenses.join() === QC.FINDER_KINDS.slice().sort().join() && known.length === 1
      && noOracle.join() === 'commands-preview-archives,copy-readme-sequence' && bugs.length - noOracle.length === 7
      && !!key.app && key.app.name === 'Pocket' && !!key.selfTestPair
      && moment.version === '2.29.1' && moment.resolved === 'https://registry.npmjs.org/moment/-/moment-2.29.1.tgz' && /^sha512-[A-Za-z0-9+/]+=*$/.test(moment.integrity || ''),
    JSON.stringify({ n: bugs.length, lenses, known, noOracle, app: key.app, moment }));
  // #278 review: the lost-id bug sits in the same file as the capped list, so the
  // known-answer key's "silently drops" wording must also name the rows it drops,
  // or a finding about the edit is credited as the known-answer catch.
  const kb = bugs.find(b => b.knownAnswer);
  const lostId = { file: 'server.js', line: 230, text: 'Blocks. Saving an edit silently drops the expense id, so it can never be edited or deleted again.' };
  const capped = { file: 'server.js', line: 167, text: 'Should fix. The month view silently drops the older expenses, and its count and total leave them out.' };
  check('pocket: a finding that an edit silently drops the id is not the capped-list catch', !!kb && !QC.bugMatches(kb, lostId), lostId.text);
  check('pocket: a finding that the month view silently drops older expenses is the capped-list catch', !!kb && QC.bugMatches(kb, capped), capped.text);
});

// #278: fixtures are folders under scripts/fixtures/quality-check/, chosen by
// name. Notebook moved into its own folder; its hash must not move with it, or
// the saved runs stop being comparable with new ones.
section('fixtures by name (#278)', () => {
  const ROOT = path.resolve(__dirname, 'fixtures', 'quality-check');
  let unknown = '';
  let resolved = null;
  if (typeof QC.fixtureDir === 'function') {
    try { QC.fixtureDir('no-such'); } catch (e) { unknown = e.message; }
    const root = tmp('qc-test-fixtures-root-');
    write(path.join(root, 'alpha', 'answers.json'), '{"bugs":[]}\n');
    try { resolved = QC.fixtureDir('alpha', root); } catch (e) { resolved = 'threw: ' + e.message; }
    let sep = '';
    try { QC.fixtureDir('../notebook'); } catch (e) { sep = e.message; }
    check('fixtureDir resolves a folder under scripts/fixtures/quality-check and refuses an unknown name',
      QC.fixtureDir('notebook') === path.join(ROOT, 'notebook') && /\bnotebook\b/.test(unknown) && /no-such/.test(unknown)
        && resolved === path.join(root, 'alpha') && sep !== '',
      JSON.stringify({ notebook: QC.fixtureDir('notebook'), unknown, resolved, sep }));
  } else check('fixtureDir resolves a folder under scripts/fixtures/quality-check and refuses an unknown name', false, 'fixtureDir is not exported');
  const hash = typeof QC.fixtureHash === 'function' && typeof QC.fixtureDir === 'function' ? QC.fixtureHash(QC.fixtureDir('notebook')) : null;
  // The value the 105 saved runs in reports/quality-check carry: pinned here, so
  // an edit to Notebook's base/ or change/ is a deliberate test change too.
  check('fixtureHash of the notebook fixture is 3b661928401a8724 after the move', hash === '3b661928401a8724', hash === null ? 'fixtureHash or fixtureDir is not exported' : hash);
  const libFile = path.join(ROOT, 'notebook', 'oracles', 'lib.js');
  let lib = null;
  try { lib = fs.existsSync(libFile) ? require(libFile) : null; } catch (e) { lib = null; }
  check('the generic oracle library and loopback.js sit one level above the fixtures',
    fs.existsSync(path.join(ROOT, 'oracle-lib.js')) && fs.existsSync(path.join(ROOT, 'loopback.js'))
      && !!lib && Array.isArray(lib.SEED) && typeof lib.startServer === 'function',
    JSON.stringify({ oracleLib: fs.existsSync(path.join(ROOT, 'oracle-lib.js')), loopback: fs.existsSync(path.join(ROOT, 'loopback.js')), lib: !!lib }));
  const given = typeof QC.parseArgs === 'function' ? QC.parseArgs(['--fixture', 'pocket']) : null;
  const plain = typeof QC.parseArgs === 'function' ? QC.parseArgs([]) : null;
  check('parseArgs reads --fixture and defaults it to notebook',
    !!given && given.fixture === 'pocket' && !!plain && plain.fixture === 'notebook',
    given === null ? 'parseArgs is not exported' : JSON.stringify({ given: given.fixture, plain: plain.fixture }));
});

// #278 Step 2: what the harness held as constants comes from each fixture's
// answer key, and every record says which fixture it ran on.
section('fixture facts and records (#278)', () => {
  const app = ANSWERS.app || {};
  const pair = ANSWERS.selfTestPair || {};
  const reasons = ANSWERS.bugs.filter(b => b.noOracle !== undefined);
  check('answers.json carries the app name, the two commit messages, the self-test pair and each no-oracle reason',
    app.name === 'Notebook' && app.baseMessage === 'Notes app' && app.changeMessage === 'Add search, export, clear all, backups, import and a reset command'
      && pair.correct === 'code-search-prefix' && pair.deletion === 'known-shell-glob'
      && reasons.map(b => b.id).sort().join() === 'commands-contradiction,copy-unclear-headline'
      && reasons.every(b => typeof b.noOracle === 'string' && b.noOracle.length > 20),
    JSON.stringify({ app, pair, noOracle: reasons.map(b => b.id) }));

  // The folder name puts the fixture after the build and before any label, and
  // only when it is not the default, so a Notebook run's name does not change.
  const named = typeof QC.runDirName === 'function';
  const withLabel = named ? QC.runDirName({ stamp: '2026-10-27-101500', kind: 'review-ship-fit', build: 'abc1234', fixture: 'pocket', label: '278 a1' }) : null;
  const noLabel = named ? QC.runDirName({ stamp: '2026-10-27-101500', kind: 'fix', build: 'abc1234', fixture: 'pocket' }) : null;
  const notebook = named ? QC.runDirName({ stamp: '2026-10-27-101500', kind: 'review-ship-fit', build: 'abc1234', fixture: 'notebook', label: 'x' }) : null;
  const rec = typeof QC.fixtureRecord === 'function' ? QC.fixtureRecord('notebook') : null;
  const row = typeof QC.ledgerRow === 'function'
    ? QC.ledgerRow({ role: 'review', arm: 'ship', probe: null, build: { spec: 'HEAD', sha: 'abc' }, fixtureName: 'pocket', endedAt: 'T' }, { costUsd: 1 }, true, 'reports/quality-check/x')
    : null;
  check("a run's record, folder name and ledger row name the fixture",
    withLabel === '2026-10-27-101500-review-ship-fit-abc1234-pocket-278-a1' && noLabel === '2026-10-27-101500-fix-abc1234-pocket'
      && notebook === '2026-10-27-101500-review-ship-fit-abc1234-x'
      && !!rec && rec.fixture === '3b661928401a8724' && rec.fixtureName === 'notebook'
      && !!row && row.fixtureName === 'pocket' && row.build === 'HEAD' && row.sha === 'abc' && row.costUsd === 1 && row.valid === true && row.dir === 'reports/quality-check/x',
    JSON.stringify({ withLabel, noLabel, notebook, rec, row }));

  // A temporary fixtures root holding "alpha", a copy of Notebook's key under
  // another app name, stands in for a second fixture the suite cannot rely on.
  const root = tmp('qc-test-fixtures-alpha-');
  write(path.join(root, 'alpha', 'answers.json'), JSON.stringify({ ...ANSWERS, app: { ...app, name: 'Alpha' } }));
  const alphaDir = makeReviewRun({ caught: ['code-search-prefix'], meta: { fixtureName: 'alpha' } });
  const plainDir = makeReviewRun({ caught: ['code-search-prefix'] });
  let alpha = null;
  let plainRun = null;
  if (typeof QC.checkRun === 'function') {
    try { alpha = QC.checkRun(alphaDir, root); } catch (e) { alpha = { error: e.message }; }
    try { plainRun = QC.checkRun(plainDir); } catch (e) { plainRun = { error: e.message }; }
  }
  check('--check and --judge take the fixture from the saved record',
    !!alpha && alpha.fixtureName === 'alpha' && !!alpha.answers && alpha.answers.app.name === 'Alpha' && alpha.analysis.valid && alpha.analysis.fixtureName === 'alpha'
      && !!plainRun && plainRun.fixtureName === 'notebook' && !!plainRun.answers && plainRun.answers.app.name === 'Notebook',
    alpha === null ? 'checkRun is not exported' : JSON.stringify({ alpha: alpha.error || [alpha.fixtureName, alpha.answers && alpha.answers.app], plain: plainRun.error || [plainRun.fixtureName, plainRun.answers && plainRun.answers.app] }));
  // Failure details stay on one line: the release gate shows only a failing suite's tail.
  const oneLine = s => String(s).replace(/\s+/g, ' ').trim().slice(0, 300);
  const flag = spawnSync('node', [SCRIPT, '--check', plainDir, '--fixture', 'notebook'], { encoding: 'utf8' });
  check('--check given --fixture is a usage error: the record names the fixture', flag.status === 2 && /reads the fixture from the run's record/.test(flag.stderr), oneLine(flag.stdout + flag.stderr));
  const mixed = spawnSync('node', [SCRIPT, '--score', alphaDir, '--against', plainDir], { encoding: 'utf8' });
  check('--score refuses runs of two different fixtures, naming both', mixed.status === 2 && /alpha/.test(mixed.stderr) && /notebook/.test(mixed.stderr), oneLine(mixed.stdout + mixed.stderr));
});

section('model modes', () => {
  const file = model => '---\nname: x\ntools: Read\n' + (model ? 'model: ' + model + '\n' : '') + 'effort: high\n---\nbody\n';
  check('modeFamily: best is the session family whatever the file says', QC.modeFamily('best', file('sonnet'), 'opus') === 'opus' && QC.modeFamily('best', file('sonnet'), 'opus', 'review-code-finder') === 'opus');
  check('modeFamily: best leaves the map helper on its file\'s model, as fit does (#208)',
    QC.modeFamily('best', file('sonnet'), 'opus', 'index-mapper') === 'sonnet' && QC.modeFamily('best', file('inherit'), 'opus', 'index-mapper') === 'opus');
  check('modeFamily: cheap is Sonnet whatever the file says', QC.modeFamily('cheap', file('opus'), 'opus') === 'sonnet');
  check('modeFamily: fit is the file\'s own model', QC.modeFamily('fit', file('sonnet'), 'opus') === 'sonnet' && QC.modeFamily('fit', file('opus'), 'sonnet') === 'opus');
  check('modeFamily: fit reads inherit, no line and a non-alias as the session family',
    QC.modeFamily('fit', file('inherit'), 'opus') === 'opus' && QC.modeFamily('fit', file(null), 'sonnet') === 'sonnet' && QC.modeFamily('fit', file('claude-sonnet-5-5'), 'opus') === 'opus');

  // The ship arm patches nothing and needs no --effort.
  const build = tmp('qc-test-ship-');
  QC.FINDER_KINDS.forEach((k, i) => write(path.join(build, 'agents', 'review-' + k + '-finder.md'), file(i === 0 ? 'sonnet' : 'inherit')));
  const ship = QC.armSettings('review', 'ship', { dir: build }, null);
  check('arm ship: every finder as shipped, marked so nothing is written', ship.length === 8 && ship.every(s => s.shipped) && ship[0].model === 'sonnet' && ship[1].model === 'inherit' && ship[1].effort === 'high');
  const fm = QC.finderModels('fit', build, 'opus');
  check('finderModels: fit gives each finder its own file\'s family', fm.code === 'sonnet' && fm.security === 'opus' && Object.keys(fm).length === 8, JSON.stringify(fm));
  check('finderModels: cheap moves every finder to Sonnet', Object.values(QC.finderModels('cheap', build, 'opus')).every(f => f === 'sonnet'));

  // The mode line.
  const plan = QC.modeLineCheck(['Resolving the scope first.', 'Scope: 1 commit (abc1234..HEAD), 10 files. Models: cheap, from PLAN-fixture.md'], { mode: 'cheap', from: 'PLAN-fixture' });
  check('mode line: found in a later text, with where it came from', plan.ok && plan.first === false, JSON.stringify(plan));
  check('mode line: bold markup still reads', QC.modeLineCheck(['**Models:** best (from the mode: word)'], { mode: 'best', from: 'mode:? ?word|argument' }).ok);
  const wrong = QC.modeLineCheck(['Models: fit, the default'], { mode: 'cheap' });
  check('mode line: the wrong mode fails and says what it wanted', !wrong.ok && /want cheap/.test(wrong.detail), wrong.detail);
  const source = QC.modeLineCheck(['Models: cheap, the default'], { mode: 'cheap', from: 'PLAN-fixture' });
  check('mode line: the right mode from the wrong place fails', !source.ok && /came from/.test(source.detail), source.detail);
  check('mode line: no line at all fails', !QC.modeLineCheck(['Review done.'], { mode: 'fit' }).ok);
  check('mode line: markup around the source does not hide it', QC.modeLineCheck(['Reviewing 1 commit. Models: cheap, from the `mode:` word.'], { mode: 'cheap', from: 'mode:? ?word|argument' }).ok);

  // Finders checked against the mode's families, judges against the session.
  const cheapExpect = { main: 'opus', finders: 'sonnet', finderModels: Object.fromEntries(QC.FINDER_KINDS.map(k => [k, 'sonnet'])) };
  const onSonnet = analyze(makeReviewRun({ caught: IDS, models: { finder: SONNET }, meta: { expect: cheapExpect } }));
  check('a cheap run with every finder on Sonnet and the judge on Opus is valid', onSonnet.valid, onSonnet.reasons.join(', '));
  const perKind = { ...cheapExpect.finderModels, code: 'opus' };
  const mixed = analyze(makeReviewRun({ caught: IDS, models: { finder: SONNET }, meta: { expect: { main: 'opus', finders: null, finderModels: perKind } } }));
  check('finderModels wins per kind: a code finder on Sonnet where its file says Opus is invalid',
    !mixed.valid && mixed.reasons.some(r => /^model:tk:review-code-finder=sonnet \(want opus\)$/.test(r)) && !mixed.reasons.some(r => /security/.test(r)), mixed.reasons.join(', '));

  // The checks a ship run carries: kept apart from validity.
  const line = 'Scope: 1 commit (abc1234..HEAD), 10 files. Models: cheap, from PLAN-fixture.md';
  const shipRun = analyze(makeReviewRun({ caught: IDS, models: { finder: SONNET }, mainTexts: [line], meta: { expect: { ...cheapExpect, modeLine: { mode: 'cheap', from: 'PLAN-fixture' } } } }));
  check('a ship run: the mode check passes, the run is valid, and the first-text rule holds', shipRun.valid && shipRun.checks.length === 1 && shipRun.checks[0].ok && !shipRun.warnings.includes('mode-line-not-first'), JSON.stringify(shipRun.checks));
  check('a ship run: a report that does not open with the mode line is a warning, not a failure', shipRun.warnings.includes('report-opens-without-mode-line') && shipRun.valid);
  const noLine = analyze(makeReviewRun({ caught: IDS, models: { finder: SONNET }, meta: { expect: { ...cheapExpect, modeLine: { mode: 'cheap' } } } }));
  check('a ship run with no mode line: the check fails, the catches still count', noLine.valid && noLine.checks[0].ok === false);
  // A review that skipped the chat scope line still names the mode where its report opens.
  const opened = 'Reviewing 1 commit (`e275ca3..1c24c20`), the range passed in. Models: best, from the mode: word.\n\n';
  const inReport = analyze(makeReviewRun({ caught: IDS, report: opened + '# Review\n\n### Findings\n\n' + reportLine(1, 'code-search-prefix') + '\n\n### Audited out\n\nAudited out: none\n',
    meta: { expect: { main: 'opus', finders: 'opus', modeLine: { mode: 'best', from: 'mode:? ?word|argument' } } } }));
  check('mode line: no mode in chat, but the report opens with it: passes, with a warning',
    inReport.checks[0].ok && inReport.checks[0].where === 'report' && inReport.warnings.includes('mode-line-only-in-report'), JSON.stringify(inReport.checks) + ' ' + inReport.warnings.join(','));
  const conflict = analyze(makeReviewRun({ caught: IDS, mainTexts: ['Models: fit, the default'], report: opened + '# Review\n', meta: { expect: { main: 'opus', finders: 'opus', modeLine: { mode: 'best' } } } }));
  check('mode line: a wrong mode in chat fails even when the report names the right one', !conflict.checks[0].ok && conflict.checks[0].where === 'chat', JSON.stringify(conflict.checks));
  const old = analyze(makeReviewRun({ caught: IDS }));
  check('an older run with no mode expectations carries no checks', Array.isArray(old.checks) && old.checks.length === 0);

  // Text, close and plan checks (the execute and create-plan probes).
  const exec = analyze(makeReviewRun({ caught: IDS, mainTexts: ['This plan\'s Models line is fit, which builds on Opus; this session runs Sonnet 5.5. To match it, start a new session, run `/model opus`, then `/execute`.'],
    meta: { expect: { main: 'opus', texts: ['builds on\\W{0,4}Opus', '/model opus'] } } }));
  check('texts: both patterns found in the session\'s text', exec.checks.length === 2 && exec.checks.every(c => c.ok), JSON.stringify(exec.checks));
  const header = '# Word Count Plan\n\n**Overall Progress:** `0%`\n**Models:** cheap\n\n## TLDR\nCount words.\n';
  const cp = analyze(makeReviewRun({ caught: IDS, plans: { 'PLAN-fixture.md': '# Old\n', 'PLAN-word-count.md': header },
    result: { result: 'The plan is ready. Start a new session, run `/model opus`, then `/execute`.' },
    meta: { expect: { main: 'opus', lastText: ['/model opus'], planLine: { mode: 'cheap', skip: ['PLAN-fixture.md'] } } } }));
  check('planLine and lastText: a new plan with the Models line and the fresh-session close pass', cp.checks.length === 2 && cp.checks.every(c => c.ok), JSON.stringify(cp.checks));
  const late = analyze(makeReviewRun({ caught: IDS, plans: { 'PLAN-word-count.md': '# P\n\n**Overall Progress:** `0%`\n\n## Notes\n**Models:** cheap\n' },
    result: { result: 'Say "go" to run /execute.' }, meta: { expect: { main: 'opus', lastText: ['/model opus'], planLine: { mode: 'cheap', skip: [] } } } }));
  check('planLine: a Models line outside the header does not count; lastText: a "go" close fails', late.checks.every(c => !c.ok), JSON.stringify(late.checks));
  const none = analyze(makeReviewRun({ caught: IDS, plans: { 'PLAN-fixture.md': header }, meta: { expect: { main: 'opus', planLine: { mode: 'cheap', skip: ['PLAN-fixture.md'] } } } }));
  check('planLine: the plans that were already there are skipped', !none.checks[0].ok && /no new plan/.test(none.checks[0].detail), none.checks[0].detail);
  // The In plain words block that opens a plan from the current template (#276).
  const plainPlan = header.replace('## TLDR\nCount words.\n', '## In plain words\n- **The problem:** a.\n- **The goal and how we will know:** b.\n'
    + '- **The cost:** c.\n- **What is left out:** d.\n- **What changes for you:** e.\n\n## Tasks\n');
  const pp = analyze(makeReviewRun({ caught: IDS, plans: { 'PLAN-fixture.md': '# Old\n', 'PLAN-word-count.md': plainPlan },
    meta: { expect: { main: 'opus', planPlain: { skip: ['PLAN-fixture.md'] } } } }));
  check('planPlain: a new plan opening with In plain words and its five labels passes', pp.checks.length === 1 && pp.checks[0].ok, JSON.stringify(pp.checks));
  const pt = analyze(makeReviewRun({ caught: IDS, plans: { 'PLAN-word-count.md': header }, meta: { expect: { main: 'opus', planPlain: { skip: [] } } } }));
  check('planPlain: a plan with the old TLDR heading fails', pt.checks.length === 1 && !pt.checks[0].ok && /In plain words heading/.test(pt.checks[0].detail), JSON.stringify(pt.checks));
  const pm = analyze(makeReviewRun({ caught: IDS, plans: { 'PLAN-word-count.md': plainPlan.replace('- **The cost:** c.\n', '') }, meta: { expect: { main: 'opus', planPlain: { skip: [] } } } }));
  check('planPlain: a block missing a label fails and names it', pm.checks.length === 1 && !pm.checks[0].ok && /The cost/.test(pm.checks[0].detail), JSON.stringify(pm.checks));

  // A probe's verdict: dispatches first, then the checks.
  const pv = QC.probeVerdict({ valid: true, models: { byType: { 'tk:index-mapper': ['claude-sonnet-5-5'] } }, checks: [{ name: 'mode line', ok: true, detail: 'Models: cheap' }] }, { probe: 'index-mode', expect: { byType: { 'tk:index-mapper': 'sonnet' } } });
  check('probeVerdict: the mapper on Sonnet with the mode line passes', pv.ok, pv.why);
  const pf = QC.probeVerdict({ valid: true, models: { byType: { 'tk:index-mapper': ['claude-sonnet-5-5'] } }, checks: [{ name: 'mode line', ok: false, detail: 'no line' }] }, { probe: 'index-mode', expect: { byType: { 'tk:index-mapper': 'sonnet' } } });
  check('probeVerdict: a failed check fails the probe', !pf.ok && /mode line/.test(pf.why), pf.why);
  const pn = QC.probeVerdict({ valid: true, models: { byType: {} }, checks: [] }, { probe: 'review-code-mode', expect: { byType: { 'tk:review-code-finder': 'sonnet' } } });
  check('probeVerdict: no fan-out fails the probe', !pn.ok && /not dispatched/.test(pn.why), pn.why);

  // Flags that would start a session refuse before anything runs.
  const badArm = spawnSync('node', [SCRIPT, '--role', 'review', '--arm', 'z', '--build', 'HEAD'], { encoding: 'utf8' });
  check('an unknown arm is a usage error that names ship', badArm.status === 2 && /a, b, c, h or ship/.test(badArm.stderr), badArm.stderr);
  const onlyShip = spawnSync('node', [SCRIPT, '--role', 'review', '--arm', 'ship', '--only', 'review-deps-finder', '--build', 'HEAD'], { encoding: 'utf8' });
  check('--only with the ship arm is a usage error', onlyShip.status === 2 && /--only applies to a measured arm/.test(onlyShip.stderr), onlyShip.stderr);
  const badMode = spawnSync('node', [SCRIPT, '--role', 'review', '--arm', 'ship', '--build', 'HEAD', '--mode-word', 'fast'], { encoding: 'utf8' });
  check('an unknown mode is a usage error', badMode.status === 2 && /best, fit or cheap/.test(badMode.stderr), badMode.stderr);
});

section('real config check', () => {
  const scratch = '/tmp/qc-run.TEST1';
  const old = Buffer.from('{"at":"1","repo_path":"/home/u/a"}\n');
  const hash = require('crypto').createHash('sha256').update(old).digest('hex').slice(0, 16);
  const grow = s => Buffer.concat([old, Buffer.from(s)]);
  check('appendSource: a line from another project is another session', QC.appendSource(hash, old.length, grow('{"at":"2","repo_path":"/home/u/b"}\n'), scratch) === 'other');
  check('appendSource: a line naming the scratch folder is the run', QC.appendSource(hash, old.length, grow('{"at":"2","repo_path":"' + scratch + '/project"}\n'), scratch) === 'run');
  check('appendSource: changed earlier bytes are a rewrite', QC.appendSource(hash, old.length, Buffer.from('{"at":"9","repo_path":"/home/u/a"}\n{"at":"2"}\n'), scratch) === 'rewritten');
  check('appendSource: a shorter file is a rewrite', QC.appendSource(hash, old.length, Buffer.from('{}\n'), scratch) === 'rewritten');
  const key = '.claude/correction-heartbeat.jsonl';
  const before = { [key]: { raw: hash, norm: hash, size: old.length }, '.claude/settings.json': { raw: 'x', norm: 'x' } };
  const after = (buf, settings) => ({ [key]: { raw: 'new', norm: 'new', size: buf.length, buf }, '.claude/settings.json': { raw: settings, norm: settings } });
  const other = QC.compareSnapshots(before, after(grow('{"repo_path":"/home/u/b"}\n'), 'x'), scratch);
  check('compareSnapshots: another session\'s heartbeat leaves the config unchanged, and says so', other.unchanged && other.otherSessions.includes(key), JSON.stringify(other));
  const mine = QC.compareSnapshots(before, after(grow('{"repo_path":"' + scratch + '/project"}\n'), 'x'), scratch);
  check('compareSnapshots: a heartbeat line from the run is a change', !mine.unchanged && /a line names this run/.test(mine.changed[0]), JSON.stringify(mine));
  const settings = QC.compareSnapshots(before, after(old, 'y'), scratch);
  check('compareSnapshots: any change to a settings file is still a change', !settings.unchanged && settings.changed.includes('.claude/settings.json'), JSON.stringify(settings));
});

section('score command end to end', () => {
  const a = makeReviewRun({ caught: IDS });
  const b = makeReviewRun({ caught: IDS });
  const c = makeReviewRun({ caught: IDS, cost: 2 });
  const r = spawnSync('node', [SCRIPT, '--score', c, '--against', a + ',' + b], { encoding: 'utf8' });
  check('--score prints a verdict and exits 0', r.status === 0 && /VERDICT: PASS/.test(r.stdout), r.stdout + r.stderr);
  const j = spawnSync('node', [SCRIPT, '--score', c, '--score', a, '--against', a + ',' + b, '--json'], { encoding: 'utf8' });
  let parsed = null;
  try { parsed = JSON.parse(j.stdout); } catch (e) { parsed = null; }
  check('--json gives one result per candidate set', Array.isArray(parsed) && parsed.length === 2 && parsed[0].s.verdict === 'PASS', j.stdout.slice(0, 300) + j.stderr);
  const u = spawnSync('node', [SCRIPT, '--role', 'review'], { encoding: 'utf8' });
  check('a run without --arm is a usage error (exit 2) and starts nothing', u.status === 2, u.stdout + u.stderr);
});

section('measured release (#279)', () => {
  // The release gate reads three exports: the review-path hash of a commit, the
  // ledger's runs on a hash (what measures a build), and the score of run folders
  // against run folders. Each case tests the export first, so a missing one fails
  // by the case name rather than throwing out of the section.
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }).stdout.trim();
  const expected = QC.pathHash('review', QC.gitPathFiles(head, 'review'));
  const hashOf = typeof QC.reviewPathHash === 'function' ? QC.reviewPathHash : null;
  check('reviewPathHash gives the review-path hash of a commit and null for an unknown ref',
    !!hashOf && /^[0-9a-f]{16}$/.test(expected) && hashOf(head) === expected && hashOf('nope') === null && hashOf('0'.repeat(40)) === null,
    hashOf ? JSON.stringify({ head: hashOf(head), expected, nope: hashOf('nope') }) : 'reviewPathHash is not exported');

  // A ledger of hand-made run folders: only run.json and analysis.json matter here.
  const ledger = tmp('qc-ledger-');
  const run = (name, meta, valid) => {
    write(path.join(ledger, name, 'run.json'), JSON.stringify(meta));
    write(path.join(ledger, name, 'analysis.json'), JSON.stringify({ valid }));
  };
  const NEW = 'aaaaaaaaaaaaaaaa';
  const OLD = 'bbbbbbbbbbbbbbbb';
  const ship = (hash, at, extra) => ({ role: 'review', arm: 'ship', fixtureName: 'pocket', startedAt: at, build: { sha: 'f'.repeat(40), pathHashes: { review: hash } }, ...(extra || {}) });
  run('2026-10-26-200000-review-ship-fit-fffffff-pocket-1', ship(NEW, '2026-10-26T20:00:00Z'), true);
  run('2026-10-26-210000-review-ship-fit-fffffff-pocket-2', ship(NEW, '2026-10-26T21:00:00Z'), true);
  run('2026-10-20-000000-review-ship-fit-fffffff-pocket-old', ship(OLD, '2026-10-20T00:00:00Z'), true);
  run('2026-10-26-220000-review-ship-fit-fffffff-pocket-invalid', ship(NEW, '2026-10-26T22:00:00Z'), false);
  run('2026-10-26-230000-review-ship-fit-fffffff-notebook', { role: 'review', arm: 'ship', startedAt: '2026-10-26T23:00:00Z', build: { sha: 'f'.repeat(40), pathHashes: { review: NEW } } }, true);
  run('2026-10-26-233000-review-a-only-code-fffffff-pocket', ship(NEW, '2026-10-26T23:30:00Z', { arm: 'a' }), true);
  run('2026-10-26-234000-fix-fffffff-pocket', ship(NEW, '2026-10-26T23:40:00Z', { role: 'fix', arm: null }), true);
  run('2026-10-26-235000-review-ship-fit-0000000-pocket-nohash', { role: 'review', arm: 'ship', fixtureName: 'pocket', startedAt: '2026-10-26T23:50:00Z', build: { sha: '0'.repeat(40) } }, true);
  const fromShaName = '2026-10-27-000000-review-ship-fit-' + head.slice(0, 7) + '-pocket-fromsha';
  run(fromShaName, { role: 'review', arm: 'ship', fixtureName: 'pocket', startedAt: '2026-10-27T00:00:00Z', build: { sha: head } }, true);
  write(path.join(ledger, 'ledger.jsonl'), '{}\n');
  write(path.join(ledger, '2026-10-27-010000-review-ship-fit-fffffff-pocket-going', 'run.json'), JSON.stringify(ship(NEW, '2026-10-27T01:00:00Z')));
  const measured = typeof QC.measuredRelease === 'function' ? QC.measuredRelease : null;
  const names = list => list.map(r => r.name);
  const m = measured ? measured({ newHash: NEW, prevHash: OLD, ledgerDir: ledger }) : null;
  check('measuredRelease picks valid ship-arm runs of the judge fixture by review-path hash',
    !!m && JSON.stringify(names(m.candidates)) === JSON.stringify(['2026-10-26-210000-review-ship-fit-fffffff-pocket-2', '2026-10-26-200000-review-ship-fit-fffffff-pocket-1'])
      && JSON.stringify(names(m.baseline)) === JSON.stringify(['2026-10-20-000000-review-ship-fit-fffffff-pocket-old'])
      && m.unchanged === false && m.candidates.every(r => r.dir === path.join(ledger, r.name) && typeof r.startedAt === 'string'),
    m ? JSON.stringify({ candidates: names(m.candidates), baseline: names(m.baseline), unchanged: m.unchanged }) : 'measuredRelease is not exported');
  const fromSha = measured ? measured({ newHash: expected, prevHash: OLD, ledgerDir: ledger }) : null;
  check('a run saved without the hash is hashed from its commit when that commit is in history; one whose commit is not never matches',
    !!fromSha && JSON.stringify(names(fromSha.candidates)) === JSON.stringify([fromShaName]),
    fromSha ? JSON.stringify(names(fromSha.candidates)) : 'measuredRelease is not exported');
  check('equal hashes read as unchanged', !!measured && measured({ newHash: NEW, prevHash: NEW, ledgerDir: ledger }).unchanged === true);
  const none = measured ? measured({ newHash: NEW, prevHash: OLD, ledgerDir: path.join(ledger, 'missing') }) : null;
  check('a missing ledger folder gives empty lists', !!none && none.candidates.length === 0 && none.baseline.length === 0 && none.unchanged === false, none ? JSON.stringify(none) : 'measuredRelease is not exported');
  check('the judge fixture is the default: a Notebook run on the hash is not a candidate unless asked for',
    !!m && !names(m.candidates).some(n => /notebook/.test(n)) && measured({ newHash: NEW, prevHash: OLD, ledgerDir: ledger, fixtureName: 'notebook' }).candidates.length === 1,
    m ? JSON.stringify(names(m.candidates)) : 'measuredRelease is not exported');
  // The one ledger reader both the gate's info line and measuredRelease use (review R14).
  const lr = typeof QC.ledgerRuns === 'function' ? QC.ledgerRuns(ledger) : null;
  check('ledgerRuns lists every valid ship-arm review run of any fixture with its record, hash and fixture, newest first',
    !!lr && JSON.stringify(names(lr)) === JSON.stringify([fromShaName, '2026-10-26-235000-review-ship-fit-0000000-pocket-nohash', '2026-10-26-230000-review-ship-fit-fffffff-notebook', '2026-10-26-210000-review-ship-fit-fffffff-pocket-2', '2026-10-26-200000-review-ship-fit-fffffff-pocket-1', '2026-10-20-000000-review-ship-fit-fffffff-pocket-old'])
      && lr[0].hash === expected && lr[1].hash === null && lr[2].fixtureName === 'notebook' && lr[3].fixtureName === 'pocket' && lr[3].hash === NEW && lr.every(r => r.meta && r.meta.role === 'review' && r.dir === path.join(ledger, r.name)),
    lr ? JSON.stringify(lr.map(r => [r.name, r.fixtureName, r.hash])) : 'ledgerRuns is not exported');

  const a = makeReviewRun({ caught: IDS });
  const b = makeReviewRun({ caught: IDS });
  const c = makeReviewRun({ caught: IDS, cost: 2 });
  const d = makeReviewRun({ caught: IDS, cost: 2 });
  const score = typeof QC.scoreRunDirs === 'function' ? QC.scoreRunDirs : null;
  const s = score ? score([c, d], [a, b], {}) : null;
  check('scoreRunDirs returns what --score --json prints for the same runs',
    !!s && s.verdict === 'PASS' && !!s.settings && s.settings.candidate.length === 2 && s.settings.baseline.length === 2 && IDS.every(id => s.perId[id]) && s.fixtureName === 'notebook',
    s ? JSON.stringify({ verdict: s.verdict, why: s.why, ids: Object.keys(s.perId || {}) }) : 'scoreRunDirs is not exported');
  const alpha = makeReviewRun({ caught: IDS, meta: { fixtureName: 'alpha' } });
  let refused = null;
  try { if (score) score([alpha], [a], {}); } catch (e) { refused = e.message; }
  check('scoreRunDirs refuses runs of two fixtures by throwing, naming both', !!score && /alpha/.test(refused) && /notebook/.test(refused), score ? String(refused) : 'scoreRunDirs is not exported');
});

section('ledger cost (review R14)', () => {
  check('ledgerCost: a reported cost is entered as it is', JSON.stringify(QC.ledgerCost(4.19, 25)) === JSON.stringify({ costUsd: 4.19 }));
  const none = QC.ledgerCost(null, 25);
  check('ledgerCost: no reported cost is entered at the cap and marked', none.costUsd === 25 && none.costCapped === true, JSON.stringify(none));
  check('ledgerCost: a zero cost is a reported cost, not a missing one', QC.ledgerCost(0, 25).costUsd === 0 && !QC.ledgerCost(0, 25).costCapped);
});

section('budget estimate honors the run cap (issue 221)', () => {
  const rows = [{ role: 'mapper', costUsd: 0.45 }, { role: 'mapper', costUsd: 0.88 }, { role: 'review', costUsd: 'n/a' }];
  check('budgetEstimate: a role with history is sized at its most expensive run', QC.budgetEstimate(rows, 'mapper') === 0.88);
  check('budgetEstimate: a role with no priced run is sized at its default', QC.budgetEstimate(rows, 'review') === QC.DEFAULT_MAX_USD.review);
  check('budgetEstimate: the run cap bounds the estimate, so a $7 first review run is sized at $7, not $25', QC.budgetEstimate(rows, 'review', 7) === 7);
  check('budgetEstimate: a cap above the history leaves the history estimate alone', QC.budgetEstimate(rows, 'mapper', 2) === 0.88);
  check('budgetEstimate: no cap, a zero cap or a bad cap means the estimate stands', QC.budgetEstimate(rows, 'review', 0) === QC.DEFAULT_MAX_USD.review && QC.budgetEstimate(rows, 'review', null) === QC.DEFAULT_MAX_USD.review && QC.budgetEstimate(rows, 'review', NaN) === QC.DEFAULT_MAX_USD.review);
});

section('cleanup steps (review R14, second round)', () => {
  const ran = [];
  const said = [];
  const failed = QC.runSteps([
    ['copy the transcripts', () => ran.push('copy')],
    ['write run.json', () => { throw new Error('disk full'); }],
    ['enter the ledger line', () => ran.push('ledger')],
  ], msg => said.push(msg));
  check('runSteps: a failing step does not skip the ledger line after it', ran.join(',') === 'copy,ledger', ran.join(','));
  check('runSteps: the failure is named and reported, not thrown', failed.join() === 'write run.json' && said.length === 1 && /could not write run\.json: disk full/.test(said[0]), JSON.stringify({ failed, said }));
});

section('a failed cleanup step voids the run (review loop, R20)', () => {
  const fresh = () => ({ valid: true, reasons: [], warnings: [] });
  const clean = QC.markCleanup(fresh(), []);
  check('markCleanup: a clean cleanup leaves a valid run valid', clean.valid === true && clean.reasons.length === 0, JSON.stringify(clean));
  const broken = QC.markCleanup(fresh(), ['write run.json']);
  check('markCleanup: a failed step makes the run invalid and names it', broken.valid === false && broken.reasons.includes('cleanup-failed') && broken.cleanupFailed.join() === 'write run.json', JSON.stringify(broken));
});

section('the fixture server listens on loopback only (review R2)', () => {
  const listenAndSay = form => "const s = require('http').createServer(); s.listen(" + form + ", () => { console.log(s.address().address); s.close(); });";
  for (const form of ['0', "0, '0.0.0.0'", '{ port: 0 }', "{ port: 0, host: '::' }"]) {
    const r = spawnSync(process.execPath, ['--require', QC.LOOPBACK_PRELOAD, '-e', listenAndSay(form)], { encoding: 'utf8', timeout: 10000 });
    check('loopback.js: listen(' + form + ') binds 127.0.0.1', r.stdout.trim() === '127.0.0.1', r.stdout + r.stderr);
  }
  const fixture = fs.readFileSync(path.join(FIXTURE, 'change', 'server.js'), 'utf8');
  check('the fixture itself is untouched: server.js still passes no host', /server\.listen\(PORT, \(\) =>/.test(fixture));
});

// ---------------------------------------------------------------------------
// Research plan item 2 (P1-C1): the scorer refuses a comparison where more than
// one thing moved. Item 3 (P1-C2): a check the runner refused is harness-lost,
// not a model miss.

// A run's setting in the shape runSetting returns: o.harness and o.arm override
// the defaults (one build, Opus high everywhere, Claude Code 2.1.288).
const FINDER_NAMES = QC.FINDER_KINDS.map(k => 'review-' + k + '-finder');
function setting(o) {
  const x = o || {};
  const arm = Object.fromEntries(FINDER_NAMES.map(n => [n, { model: 'opus', effort: 'high', ...(x.arm || {}), ...((x.agents || {})[n] || {}) }]));
  return {
    dir: '/runs/' + (x.name || 'run'), role: x.role || 'review',
    harness: { build: 'b1', session: 'opus/high', claude: '2.1.288', fixture: 'fx', prompt: null, chunk: null, ...(x.harness || {}) },
    arm, labels: { build: x.label || 'aaaaaaa' },
  };
}
function mapperSetting(o) {
  const x = o || {};
  return { dir: '/runs/m', role: 'mapper', harness: { build: 'm1', session: 'opus/high', claude: '2.1.288', fixture: 'fx', prompt: 'p1', chunk: 'c1', ...(x.harness || {}) },
    arm: { 'index-mapper': { model: 'opus', effort: 'medium', ...(x.arm || {}) } }, labels: { build: x.label || 'bbbbbbb' } };
}

section('setting comparison (P1-C1)', () => {
  const base = [setting(), setting()];
  const model = QC.compareSettings([setting({ arm: { model: 'sonnet', effort: 'medium' } })], base);
  check('a clean model A/B: only the arm moved', model.kind === 'model' && !model.confounded && /model A\/B/.test(model.summary) && /harness held/.test(model.summary), JSON.stringify(model));
  const harness = QC.compareSettings([setting({ harness: { build: 'b2' }, label: 'ccccccc' }), setting({ harness: { build: 'b2' }, label: 'ccccccc' })], base);
  check('a clean harness A/B: only the build moved', harness.kind === 'harness' && !harness.confounded && /harness A\/B, build ccccccc .* vs aaaaaaa/.test(harness.summary) && /arm held/.test(harness.summary), JSON.stringify(harness));
  const pair = QC.compareSettings([setting({ arm: { model: 'haiku', effort: 'medium' }, harness: { build: 'b2', claude: '2.1.296' } })], base);
  check('a confounded pair: the arm and the harness both moved, and the moved harness fields are named',
    pair.confounded && pair.kind === 'confounded' && pair.confounds.includes('between: build') && pair.confounds.includes('between: Claude Code')
    && /harness moved too: build .* Claude Code 2\.1\.296 vs 2\.1\.288/.test(pair.summary), JSON.stringify(pair));
  const cc = QC.compareSettings([setting({ harness: { build: 'b2', claude: '2.1.289' } })], base);
  check('a harness A/B on another Claude Code version is confounded, naming only Claude Code', cc.confounded && cc.confounds.join() === 'between: Claude Code', JSON.stringify(cc.confounds));
  const sess = QC.compareSettings([setting({ harness: { session: 'sonnet/high' } })], base);
  check('a moved session model is confounded even with nothing else moved', sess.confounded && sess.confounds.join() === 'between: session model/effort', JSON.stringify(sess));
  const mapper = QC.compareSettings([mapperSetting({ harness: { build: 'm2', prompt: 'p2' } })], [mapperSetting(), mapperSetting()]);
  check('a mapper harness A/B: the prompt moves with the build and is allowed', mapper.kind === 'harness' && !mapper.confounded, JSON.stringify(mapper));
  const promptOnly = QC.compareSettings([mapperSetting({ harness: { prompt: 'p2' } })], [mapperSetting()]);
  check('a mapper prompt that moved on the same build is confounded', promptOnly.confounded && promptOnly.confounds.join() === 'between: mapper prompt hash', JSON.stringify(promptOnly));
  const mapperH = QC.compareSettings([mapperSetting({ arm: { model: 'haiku' }, harness: { build: 'm2', prompt: 'p2', claude: '2.1.296' } })], [mapperSetting({ arm: { model: 'sonnet' } })]);
  check('the mapper-h shape: arm, build, prompt and Claude Code all moved, and the three harness fields are named',
    mapperH.confounded && ['between: build', 'between: mapper prompt hash', 'between: Claude Code'].every(f => mapperH.confounds.includes(f)), JSON.stringify(mapperH.confounds));
  // A field a saved run cannot supply is unknown and never a difference.
  const unknownBuild = QC.compareSettings([setting({ arm: { model: 'haiku' }, harness: { build: null, claude: null } })], base);
  check('an unknown field is not counted: a model A/B whose candidate build and Claude Code are unknown stays clean', unknownBuild.kind === 'model' && !unknownBuild.confounded, JSON.stringify(unknownBuild));
  const halfKnown = QC.compareSettings([setting(), setting({ harness: { build: null } })], base);
  check('a set with one unknown build and one known is still uniform', !halfKnown.confounded && halfKnown.kind === 'same', JSON.stringify(halfKnown));
  // The deps-h shape: a baseline over several builds, efforts and Claude Code versions.
  const mixed = [setting(), setting({ harness: { build: 'b3', claude: '2.1.289' }, arm: { effort: 'medium' }, label: 'ddddddd' })];
  const depsH = QC.compareSettings([setting({ harness: { build: 'b9', claude: '2.1.296' }, agents: { 'review-deps-finder': { model: 'haiku', effort: 'medium' } } })], mixed);
  check('a baseline that is not uniform is confounded, naming its build, Claude Code and arm effort spread',
    depsH.confounded && ['baseline: build', 'baseline: Claude Code', 'baseline: arm effort'].every(f => depsH.confounds.includes(f))
    && /baseline set is not uniform in arm effort: 8 agents/.test(depsH.summary) && /baseline set is not uniform in build: aaaaaaa .* \| ddddddd/.test(depsH.summary), depsH.summary);
  check('sameSetting: unknown fields match, recorded ones must agree',
    QC.sameSetting(setting(), setting({ harness: { build: null } })) && !QC.sameSetting(setting(), setting({ harness: { claude: '2.1.289' } })) && !QC.sameSetting(setting(), setting({ arm: { effort: 'low' } })));
});

// #278: two runs on two fixtures are never one setting, and the score says which.
section('setting comparison names the fixtures (#278)', () => {
  const cmp = QC.compareSettings(
    [{ ...setting({ name: 'p1', harness: { fixture: 'h1h1h1h1h1h1h1h1' } }), labels: { build: 'aaaaaaa', fixture: 'pocket' } }],
    [{ ...setting({ name: 'n1', harness: { fixture: 'h2h2h2h2h2h2h2h2' } }), labels: { build: 'aaaaaaa', fixture: 'notebook' } }]);
  check('the score message names both fixtures when their hashes differ', cmp.confounded && /pocket/.test(cmp.summary) && /notebook/.test(cmp.summary), cmp.summary);
});

section('scoring with settings: CONFOUNDED, --allow-drift, noise (P1-C1)', () => {
  const run = (o, st) => Object.assign(analyze(makeReviewRun(o)), { setting: st });
  const base = [run({ caught: IDS }, setting()), run({ caught: IDS }, setting())];
  const confounded = QC.scoreSets([run({ caught: IDS }, setting({ arm: { model: 'sonnet' }, harness: { build: 'b2' } }))], base, IDS, { knownId: KNOWN });
  check('a confounded comparison returns CONFOUNDED and names the fields', confounded.verdict === 'CONFOUNDED' && /build/.test(confounded.why.join()) && confounded.perId[KNOWN].candidate === '1/1', confounded.verdict + ' ' + confounded.why);
  const drift = QC.scoreSets([run({ caught: IDS }, setting({ arm: { model: 'sonnet' }, harness: { build: 'b2' } }))], base, IDS, { knownId: KNOWN, allowDrift: 'baseline rerun is not affordable today' });
  check('--allow-drift scores it anyway and keeps the reason and the confounds', drift.verdict === 'PASS' && drift.drift.reason === 'baseline rerun is not affordable today' && drift.drift.confounds.includes('between: build'), JSON.stringify(drift.drift));
  const clean = QC.scoreSets([run({ caught: IDS }, setting({ arm: { model: 'sonnet', effort: 'medium' } }))], base, IDS, { knownId: KNOWN });
  check('a clean model A/B is scored as before', clean.verdict === 'PASS' && clean.compare.kind === 'model' && clean.drift === null, clean.verdict);
  check('runs without a setting skip the check, as before', QC.scoreSets([analyze(makeReviewRun({ caught: IDS }))], [analyze(makeReviewRun({ caught: IDS }))], IDS, {}).compare === null);
  // Noise: the baseline setting dropped the traversal in one of three saved runs;
  // a run on another setting that dropped the search bug is not part of the pool.
  const noTraversal = IDS.filter(id => id !== 'security-path-traversal');
  const pool = [...base, run({ caught: noTraversal }, setting({ name: 'third' })), run({ caught: IDS.filter(id => id !== 'code-search-prefix') }, setting({ harness: { build: 'b7' } })),
    run({ caught: [], meta: { exitCode: 1 } }, setting())];
  const weak = QC.scoreSets([run({ caught: noTraversal }, setting({ arm: { model: 'sonnet' } })), run({ caught: noTraversal }, setting({ arm: { model: 'sonnet' } }))], base, IDS, { knownId: KNOWN, pool });
  check('noise: the pool is every valid saved run on the baseline\'s setting', weak.poolRuns === 3 && weak.noise['security-path-traversal'].caught === 2 && weak.noise['security-path-traversal'].runs === 3 && weak.noise['code-search-prefix'].caught === 3, JSON.stringify({ n: weak.poolRuns, noise: weak.noise }));
  check('a 2-run FAIL on a bug the baseline setting itself drops is marked weak', weak.verdict === 'FAIL' && weak.weak.join() === 'security-path-traversal' && /weak: the baseline setting caught it in only 2 of 3 saved runs/.test(weak.why.join()), weak.why.join());
  const firm = QC.scoreSets([run({ caught: noTraversal }, setting({ arm: { model: 'sonnet' } })), run({ caught: noTraversal }, setting({ arm: { model: 'sonnet' } }))], base, IDS, { knownId: KNOWN, pool: base });
  check('a FAIL on a bug the baseline setting always catches is not weak', firm.verdict === 'FAIL' && firm.weak.length === 0 && !/weak/.test(firm.why.join()), firm.why.join());
});

section('run settings from saved folders (P1-C1)', () => {
  // Hashing the build: the arm's lines never count, the prompts do.
  const agent = '---\nname: review-code-finder\ntools: Read\nmodel: inherit\neffort: high\nskills:\n  - review-code-criteria\n---\n\nYou are a Staff Engineer.\n';
  check('stripArmLines: only the model and effort lines go', QC.stripArmLines(agent) === '---\nname: review-code-finder\ntools: Read\nskills:\n  - review-code-criteria\n---\n\nYou are a Staff Engineer.\n', QC.stripArmLines(agent));
  const files = { 'agents/review-code-finder.md': agent, 'commands/review.md': 'review steps', 'commands/index.md': 'not on the review path' };
  const h = QC.pathHash('review', files);
  check('pathHash: the arm\'s patch leaves the build hash alone', h === QC.pathHash('review', { ...files, 'agents/review-code-finder.md': QC.patchAgent(agent, { model: 'haiku', effort: 'medium' }) }));
  check('pathHash: a prompt change moves it', h !== QC.pathHash('review', { ...files, 'agents/review-code-finder.md': agent.replace('Staff Engineer', 'Principal Engineer') }) && h !== QC.pathHash('review', { ...files, 'commands/review.md': 'review steps, reworded' }));
  check('pathHash: files off the role\'s path are ignored, and none at all is unknown', h === QC.pathHash('review', { ...files, 'commands/index.md': 'changed' }) && QC.pathHash('review', { 'commands/index.md': 'x' }) === null);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }).stdout.trim();
  const gitFiles = QC.gitPathFiles(head, 'review');
  const copy = tmp('qc-test-build-copy-');
  for (const [rel, buf] of Object.entries(gitFiles || {})) write(path.join(copy, rel), buf);
  write(path.join(copy, 'commands', 'index.md'), 'off the review path');
  check('git and a build folder give one hash for the same files', gitFiles && Object.keys(gitFiles).length > 10 && QC.pathHash('review', gitFiles) === QC.pathHash('review', QC.dirPathFiles(copy, 'review')), Object.keys(gitFiles || {}).length);
  check('a commit this clone does not have is unknown, not an error', QC.gitPathFiles('0'.repeat(40), 'review') === null);
  check('a build id that is not a commit id never reaches git', QC.gitPathFiles('--output=/tmp/x', 'review') === null && QC.gitPathFiles('HEAD', 'review') === null);

  // A review run recorded with --only: the patched finder from run.json, the rest
  // read from the build's commit; the build hash from git.
  const onlyDir = makeReviewRun({ caught: IDS, meta: { build: { spec: 'HEAD', sha: head, version: '7.6.5' }, session: { model: 'opus', effort: 'high', claude: '2.1.296 (Claude Code)' }, fixture: 'fx',
    patch: [{ agent: 'review-deps-finder', model: 'haiku', effort: 'medium' }] } });
  const only = QC.runSetting(QC.loadRun(onlyDir));
  const shippedCode = fs.readFileSync(path.join(copy, 'agents', 'review-code-finder.md'), 'utf8');
  check('an --only run: the patched finder from run.json, the others as the commit ships them',
    only.arm['review-deps-finder'].model === 'haiku' && only.arm['review-deps-finder'].effort === 'medium'
    && only.arm['review-code-finder'].effort === (QC.frontmatterValue(shippedCode, 'effort') || 'high') && only.arm['review-code-finder'].model === 'opus', JSON.stringify(only.arm));
  check('the build hash of a commit comes from git, and Claude Code is read from its version line', only.harness.build === QC.pathHash('review', gitFiles) && only.harness.claude === '2.1.296' && only.harness.session === 'opus/high', JSON.stringify(only.harness));
  // A tree build from before the hashes were recorded: its build is unknown.
  const tree = QC.runSetting(QC.loadRun(makeReviewRun({ caught: IDS, meta: { build: { spec: 'tree', sha: null, version: '7.5.1' }, session: { model: 'opus', effort: 'high' } } })));
  const lines = QC.settingLines(tree);
  check('a field the folder cannot supply prints as unknown', tree.harness.build === null && /build unknown \(tree 7\.5\.1, no recorded hash\)/.test(lines.harness) && /Claude Code unknown/.test(lines.harness) && /fixture unknown/.test(lines.harness), lines.harness);
  const recorded = QC.runSetting(QC.loadRun(makeReviewRun({ caught: IDS, meta: { build: { spec: 'tree', sha: null, version: '7.6.5', pathHashes: { review: 'feedfacefeedface', mapper: null } } } })));
  check('a build hash recorded at run time is used as it stands (tree builds)', recorded.harness.build === 'feedfacefeedface');

  // The mapper's prompt hash, from the dispatch in the saved transcript.
  const mapperRun = prompt => {
    const dir = tmp('qc-test-mapper-');
    const slug = path.join(dir, 'transcripts', '-tmp-qc-run-TEST-project');
    write(path.join(slug, 'sid.jsonl'), JSON.stringify({ type: 'assistant', message: { model: OPUS, role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_m', name: 'Agent', input: { subagent_type: 'tk:index-mapper', prompt } }] } }) + '\n');
    write(path.join(slug, 'sid', 'subagents', 'agent-m.jsonl'), JSON.stringify({ type: 'assistant', message: { model: 'claude-haiku-4-5', role: 'assistant', content: [{ type: 'text', text: '## a.js\n**Purpose:** x' }] } }) + '\n');
    write(path.join(slug, 'sid', 'subagents', 'agent-m.meta.json'), JSON.stringify({ agentType: 'tk:index-mapper', toolUseId: 'toolu_m' }));
    write(path.join(dir, 'run.json'), JSON.stringify({ role: 'mapper', arm: 'h', chunk: { sourceRef: 'abcdef1234', files: ['a.js'] }, patch: [{ agent: 'index-mapper', model: 'haiku', effort: 'medium' }], expect: { main: 'opus', mapper: 'haiku' } }));
    write(path.join(dir, 'result.json'), JSON.stringify({ session_id: 'sid' }));
    return QC.runSetting(QC.loadRun(dir));
  };
  const m1 = mapperRun('Map these files:\n- a.js');
  const m2 = mapperRun('Map these files:\n\n- a.js  ');
  const m3 = mapperRun('Map these files, briefly:\n- a.js');
  check('mapper: the prompt hash comes from the transcript, whitespace aside', m1.harness.prompt && m1.harness.prompt === m2.harness.prompt && m1.harness.prompt !== m3.harness.prompt, JSON.stringify([m1.harness.prompt, m3.harness.prompt]));
  check('mapper: the arm is the mapper\'s patch, and the chunk is recorded', m1.arm['index-mapper'].model === 'haiku' && m1.arm['index-mapper'].effort === 'medium' && /^abcdef1:/.test(m1.harness.chunk), JSON.stringify(m1));
});

section('kill categories (P1-C2)', () => {
  const v = QC.auditVerdict;
  check('REFUTED and a vote tally are refuted', v('- **R5** [copy] `REFUTED 2/3` - Blocks. X. (two skeptics: unreachable)').category === 'refuted' && v('- **R13** [deps] `REFUTED` - Y. (skeptic: only uniqBy runs)').category === 'refuted');
  check('a check the filter refused is refused (run 2026-10-09-182657 R1)',
    v('- **R1** [security] `RECEIPT FAILED` - Blocks. Static file serving leaks any file on the machine. (the check was refused by the read-only check filter, a two-range sed, so it never ran; the claim was not disproven)').category === 'refused');
  check('the fixed form since 7.6.3 is refused', v('- **R7** `RECEIPT FAILED` - X. (refused: not a read-only command, so the claim was not tested)').category === 'refused');
  check('a check whose output did not show the claim is failed', v('- **R24** [plan] `RECEIPT FAILED` - X. (check `sed -n \'215,222p\' scripts/import-notes.js` printed nothing: the file has 34 lines)').category === 'failed');
  const cb = v('- **R13** [code] `RECEIPT FAILED` - Failglob takes priority over nullglob. (The check could not run: `$TMPDIR` is unset, so `mkdir /rb` was denied and nothing about globbing was shown.) Orchestrator side note, not a receipt: the probe printed `no match` and exit 1.');
  check('"could not run ... denied" (cb6eee1 R13) is failed, not refused, and text after the reason is not the reason', cb.category === 'failed' && /could not run/.test(cb.reason), JSON.stringify(cb));
  check('a finding sentence that says "refused" does not make its kill a refusal', v('- **R9** [copy] `RECEIPT FAILED` - Most user files are probably refused. (check output did not show the claim)').category === 'failed');
  check('parentheses inside a code span do not end the reason', v('- **R2** [code] `RECEIPT FAILED` - X. (check `grep -n "f(" a.js` was refused: an unbalanced pattern)').category === 'refused');
  check('a line with no verdict tag is unknown', v('- **R3** [ux] something').category === 'unknown');

  // One run: the traversal refused, the contradiction refuted, the export failed
  // (its sentence says "refused", its reason does not); a surviving copy finding
  // and a non-planted Audited out line both say "refused" (cb6eee1 R19, 183430 R8).
  const traps = analyze(makeReviewRun({
    caught: ['code-search-prefix', 'copy-unclear-headline'],
    killed: ['security-path-traversal', 'commands-contradiction', 'plan-export-json'],
    whats: { 'plan-export-json': 'Should fix. Export skips the plan: it sends JSON where the plan decided CSV, so a spreadsheet import is refused.' },
    killVerdict: {
      'security-path-traversal': { tag: 'RECEIPT FAILED', reason: 'the check was refused by the read-only check filter, a two-range sed, so it never ran; the claim was not disproven' },
      'plan-export-json': { tag: 'RECEIPT FAILED', reason: 'check output did not show the claim' },
    },
    extraSurvivors: ['- **R{n}** [copy] ⚠️ `README.md:13` - Should fix. The import instruction never names the columns, so most user files are probably refused or misread.'],
    extraKilled: ['- **R{n}** [security] `RECEIPT FAILED` - Should fix. The clear-all request needs no authentication. (check refused: multi-part sed script `86,90p;124p`)'],
  }));
  check('the three kill categories, each from its own Audited out line',
    traps.killedAs['security-path-traversal'].category === 'refused' && traps.killedAs['commands-contradiction'].category === 'refuted' && traps.killedAs['plan-export-json'].category === 'failed',
    JSON.stringify(traps.killedAs));
  check('only the refused planted bug is harness-lost: neither a survivor nor a non-planted kill that says "refused" counts',
    traps.harnessLost.join() === 'security-path-traversal' && !traps.killedAs['copy-unclear-headline'] && traps.survived['copy-unclear-headline'].length === 1, JSON.stringify(traps.harnessLost));
  const reworded = analyze(makeReviewRun({ caught: [], killed: ['ux-clear-all-no-confirm'],
    report: '# Review\n\n### Findings\n\n### Audited out\n\n- **R4** [code, ux] `REFUTED` - One click on Clear all deletes every note, with no confirmation. (skeptic: the handler never attaches)\n- **R5** [copy] `RECEIPT FAILED` - The Clear all label deletes every note with no confirmation. (check refused: a backtick)\n' }));
  check('a reworded kill is found by its words, on an entry whose lens raised the bug only',
    reworded.killedAs['ux-clear-all-no-confirm'].category === 'refuted' && reworded.killedAs['ux-clear-all-no-confirm'].kills.map(k => k.id).join() === 'R4', JSON.stringify(reworded.killedAs));
});

section('harness-lost in the score (P1-C2)', () => {
  const refused = { tag: 'RECEIPT FAILED', reason: 'refused: two-range sed, so the claim was not tested' };
  const all = IDS.filter(id => id !== 'copy-unclear-headline');
  const base = [analyze(makeReviewRun({ caught: all })), analyze(makeReviewRun({ caught: all }))];
  const rest = all.filter(id => id !== 'security-path-traversal');
  const lostRun = () => analyze(makeReviewRun({ caught: rest, killed: ['security-path-traversal'], killVerdict: { 'security-path-traversal': refused } }));
  const twice = QC.scoreSets([lostRun(), lostRun()], base, IDS, { knownId: KNOWN });
  check('a bug harness-lost in two runs gives HARNESS, not FAIL', twice.verdict === 'HARNESS' && twice.harnessBugs.join() === 'security-path-traversal' && twice.failed.length === 0 && /fix the runner, then rerun/.test(twice.why.join()), twice.verdict + ' ' + twice.why);
  check('the harness-lost runs are left out of the candidate count', twice.perId['security-path-traversal'].candidate === '0/0' && twice.perId['security-path-traversal'].harnessLost === 2, JSON.stringify(twice.perId['security-path-traversal']));
  const once = QC.scoreSets([lostRun(), analyze(makeReviewRun({ caught: all }))], base, IDS, { knownId: KNOWN });
  check('one harness-lost run beside a catch passes, shown as 1/1 plus 1 harness-lost (the deps score shape)', once.verdict === 'PASS' && once.perId['security-path-traversal'].candidate === '1/1' && once.perId['security-path-traversal'].harnessLost === 1, JSON.stringify(once.perId['security-path-traversal']));
  const lostAndMissed = QC.scoreSets([lostRun(), analyze(makeReviewRun({ caught: rest }))], base, IDS, { knownId: KNOWN });
  check('one harness-lost run beside a real miss leaves one counted miss: RERUN, not FAIL', lostAndMissed.verdict === 'RERUN' && lostAndMissed.single.join() === 'security-path-traversal', lostAndMissed.verdict + ' ' + lostAndMissed.why);
  const onlyRun = QC.scoreSets([lostRun()], base, IDS, { knownId: KNOWN });
  check('harness-lost in a single run: nothing to judge, so RERUN', onlyRun.verdict === 'RERUN' && onlyRun.unjudged.join() === 'security-path-traversal' && /lost to the harness in its only run/.test(onlyRun.why.join()), onlyRun.verdict + ' ' + onlyRun.why);
  const lostBase = [lostRun(), analyze(makeReviewRun({ caught: all }))];
  const missedTwice = QC.scoreSets([analyze(makeReviewRun({ caught: rest })), analyze(makeReviewRun({ caught: rest }))], lostBase, IDS, { knownId: KNOWN });
  check('a baseline run that lost the bug to the harness is left out of the baseline count: the bug stays stable, and two misses fail',
    missedTwice.verdict === 'FAIL' && missedTwice.failed.includes('security-path-traversal') && missedTwice.perId['security-path-traversal'].baseline === '1/1' && missedTwice.perId['security-path-traversal'].baselineHarnessLost === 1,
    missedTwice.verdict + ' ' + JSON.stringify(missedTwice.perId['security-path-traversal']));
  const refuted = QC.scoreSets([analyze(makeReviewRun({ caught: rest, killed: ['security-path-traversal'] })), analyze(makeReviewRun({ caught: rest, killed: ['security-path-traversal'] }))], base, IDS, { knownId: KNOWN });
  check('a bug a skeptic refuted twice still fails the arm', refuted.verdict === 'FAIL' && refuted.failed.join() === 'security-path-traversal', refuted.verdict);
});

section('score command: settings, CONFOUNDED and --allow-drift end to end', () => {
  const pool = tmp('qc-test-pool-');
  const patch = (model, effort) => QC.FINDER_KINDS.map(k => ({ agent: 'review-' + k + '-finder', model, effort }));
  const meta = (hash, cc, model) => ({ build: { spec: 'x', sha: null, version: '7.6.5', pathHashes: { review: hash, mapper: null } }, session: { model: 'opus', effort: 'high', claude: cc + ' (Claude Code)' }, fixture: 'fx', patch: patch(model, 'high') });
  const a = makeReviewRun({ caught: IDS, meta: meta('1111111111111111', '2.1.300', 'opus') });
  const b = makeReviewRun({ caught: IDS, meta: meta('1111111111111111', '2.1.300', 'opus') });
  const c = makeReviewRun({ caught: IDS, meta: meta('2222222222222222', '2.1.301', 'sonnet') });
  const r = spawnSync('node', [SCRIPT, '--score', c, '--against', a + ',' + b, '--pool', pool], { encoding: 'utf8' });
  check('--score prints a harness line and an arm line for every run', (r.stdout.match(/^  harness (candidate|baseline) /mg) || []).length === 3 && (r.stdout.match(/^  arm     (candidate|baseline) /mg) || []).length === 3
    && /build x 7\.6\.5 \(path 22222222\)/.test(r.stdout) && /code, security, ux, plan, commands, browser, deps, copy sonnet\/high/.test(r.stdout), r.stdout);
  check('a confounded pair: VERDICT CONFOUNDED naming the build and Claude Code', /VERDICT: CONFOUNDED - a model A\/B, arm 8 agents model sonnet vs opus, with the harness moved too: build .* Claude Code 2\.1\.301 vs 2\.1\.300/.test(r.stdout) && r.status === 0, r.stdout);
  const d = spawnSync('node', [SCRIPT, '--score', c, '--against', a + ',' + b, '--pool', pool, '--allow-drift', 'measuring the build and model together on purpose'], { encoding: 'utf8' });
  check('--allow-drift prints its reason and scores the comparison', /DRIFT ALLOWED \(--allow-drift\): measuring the build and model together on purpose/.test(d.stdout) && /VERDICT: PASS \(drift allowed: measuring the build and model together on purpose\)/.test(d.stdout), d.stdout);
  const blank = spawnSync('node', [SCRIPT, '--score', c, '--against', a, '--allow-drift', '  '], { encoding: 'utf8' });
  check('--allow-drift without a reason is a usage error', blank.status === 2 && /needs a reason/.test(blank.stderr), blank.stderr);
  const lost = makeReviewRun({ caught: IDS.filter(id => id !== 'security-path-traversal'), killed: ['security-path-traversal'], meta: meta('1111111111111111', '2.1.300', 'sonnet'),
    killVerdict: { 'security-path-traversal': { tag: 'RECEIPT FAILED', reason: 'the check was refused by the read-only check filter, so it never ran' } } });
  const caughtAll = makeReviewRun({ caught: IDS, meta: meta('1111111111111111', '2.1.300', 'sonnet') });
  const h = spawnSync('node', [SCRIPT, '--score', lost + ',' + caughtAll, '--against', a + ',' + b, '--pool', pool], { encoding: 'utf8' });
  check('the score prints a harness-lost column and names the run and entry', /harness-lost\(candidate\)/.test(h.stdout) && /security-path-traversal\s+2\/2\s+1\/1\s+2\/2\s+1/.test(h.stdout) && /harness-lost: security-path-traversal in qc-test-run-\S+ \(R\d+ RECEIPT FAILED\)/.test(h.stdout) && /comparison: a model A\/B/.test(h.stdout), h.stdout);
});

// ---------------------------------------------------------------------------
// Harness research plan Step 10: the skeptic replay of session 1cefa1a7. Nothing
// here reads the real session log: every log and run folder below is made up, in
// the shapes that log and a saved run hold.

const MF = require(path.resolve(__dirname, '..', '.claude', 'scripts', 'merge-findings.js'));
const HANDBACK_FRAME = '[Subagent hand-back] The text below is the final report of a subagent this session delegated to. The report follows:';
const handback = lines => HANDBACK_FRAME + '\n' + lines.map(l => '  ' + l).join('\n');
const agentCall = (id, type) => ({ type: 'assistant', message: { model: OPUS, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type: type, prompt: '...' } }] } });
const launched = (id, agentId) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'Async agent launched' }] }] }, toolUseResult: { isAsync: true, status: 'async_launched', agentId } });
const peer = (agentId, body) => ({ type: 'user', isMeta: true, message: { role: 'user', content: body }, origin: { kind: 'peer', from: agentId, senderTaskId: agentId, body } });
// Four finder lines: two security, one code on the same line as the second
// security one (the run's one judgment merge), one plan.
const SK = [
  finding('security', 'seed/settings.json', 152, 'Should fix. An allowed remote-add can make a remote a mirror, so a plain push deletes branches.'),
  finding('security', 'scripts/check.js', 530, 'Optional. Reading every media file in full blocks the push past the read limit.', { severity: 'suggest' }),
  finding('code', 'scripts/check.js', 530, 'Should fix. A media file over 64 MB now refuses the push as unreadable.'),
  finding('plan', 'plans/PLAN-a.md', 11, 'Should fix. Both plans still say nothing was pushed, so the record misses the push.'),
];

section('skeptic replay: finder lines from the session log', () => {
  const log = [
    agentCall('toolu_old', 'review-code-finder'), launched('toolu_old', 'old1'),
    peer('old1', handback([finding('code', 'a.js', 1, 'Should fix. An earlier review in the same session found this.')])),
    agentCall('toolu_judge', 'audit-skeptic'), launched('toolu_judge', 'judge1'),
    agentCall('toolu_f1', 'review-security-finder'), launched('toolu_f1', 'sec'),
    agentCall('toolu_f2', 'review-code-finder'), launched('toolu_f2', 'code'),
    agentCall('toolu_f3', 'review-plan-finder'), launched('toolu_f3', 'plan'),
    agentCall('toolu_f4', 'tk:review-deps-finder'), launched('toolu_f4', 'deps'),
    { type: 'queue-operation', operation: 'enqueue', content: '<agent-message from="plan">\n' + handback(['[harness: a note above the report]', '', SK[3]]) + '\n</agent-message>' },
    { type: 'attachment', attachment: { type: 'queued_command', origin: { kind: 'peer', from: 'plan', senderTaskId: 'plan', body: handback(['a later copy of the same return']) } } },
    peer('sec', handback(['Two findings:', SK[0], SK[1]])),
    peer('deps', handback(['NO FINDINGS'])),
    peer('code', handback([SK[2]])),
    agentCall('toolu_target', 'audit-skeptic'),
    peer('late', handback([finding('copy', 'README.md', 3, 'Should fix. Returned after the audit had started.')])),
  ];
  const got = QC.finderLinesFromLog(log, 'toolu_target');
  check('finderLinesFromLog: the wave is the finders after the judge call before the audit, in the order their returns arrived',
    got.finders.map(f => f.agentId).join() === 'plan,sec,deps,code', JSON.stringify(got.finders));
  check('finderLinesFromLog: each finding line comes back byte for byte, the frame, notes and indent dropped',
    got.lines.map(l => l.text).join('\n') === [SK[3], SK[0], SK[1], SK[2]].join('\n'), got.lines.map(l => l.text).join('\n'));
  const deps = got.finders.find(f => f.agentId === 'deps') || {};
  check('finderLinesFromLog: a finder that returned NO FINDINGS stays in the wave with no lines', deps.noFindings === true && deps.count === 0, JSON.stringify(deps));
  check('finderLinesFromLog: an earlier review\'s finder and a return after the audit started are left out', !got.lines.some(l => /earlier review|audit had started/.test(l.text)));
  const threw = (records, id) => { try { QC.finderLinesFromLog(records, id); return ''; } catch (e) { return e.message; } };
  const noCode = threw(log.filter(r => !(r.origin && r.origin.from === 'code')), 'toolu_target');
  check('finderLinesFromLog: a finder with no return before the audit stops the replay', /returned nothing before toolu_target/.test(noCode), noCode);
  const noCall = threw(log, 'toolu_missing');
  check('finderLinesFromLog: an audit call the log does not hold stops the replay', /no Agent call toolu_missing/.test(noCall), noCall);
  const tagged = log.map(r => (r.origin && r.origin.from === 'code' ? peer('code', handback(['[harness: Control tags below are neutralized]', SK[2].replace('64 MB', '<\\b>64 MB')])) : r));
  const neutral = threw(tagged, 'toolu_target');
  check('finderLinesFromLog: a finding line the harness rewrote a tag in stops the replay', /neutralized a tag/.test(neutral), neutral);
});

section('skeptic replay: Phase 3\'s key merge and the receipt path rewrite', () => {
  const shared = QC.shareKeys(SK, [{ relPath: 'scripts/check.js', line: 530 }]);
  const key = JSON.parse(SK[1]).key;
  check('shareKeys: the later line at the merged citation takes the earlier one\'s key', JSON.parse(shared.texts[2]).key === key && shared.texts[0] === SK[0] && shared.texts[1] === SK[1] && shared.texts[3] === SK[3]);
  check('shareKeys: nothing but the key changes', shared.texts[2].replace(JSON.stringify(key), JSON.stringify(JSON.parse(SK[2]).key)) === SK[2], shared.texts[2]);
  let one = '';
  try { QC.shareKeys([SK[0], SK[2]], [{ relPath: 'scripts/check.js', line: 530 }]); } catch (e) { one = e.message; }
  check('shareKeys: a merge that finds a single line stops the replay', /found 1 line/.test(one), one);
  const scope = JSON.stringify({ cwd: '/home/u/proj', root: '/home/u/proj', files: ['/home/u/proj/a.js', '/home/u/proj2/b.js', '/home/u/project/c.js'] }, null, 2);
  const moved = JSON.parse(QC.rewriteRoot(scope, '/home/u/proj', '/tmp/qc-run.X/project'));
  check('rewriteRoot: the saved scope\'s root and the paths under it move to the scratch project',
    moved.cwd === '/tmp/qc-run.X/project' && moved.root === '/tmp/qc-run.X/project' && moved.files[0] === '/tmp/qc-run.X/project/a.js', JSON.stringify(moved));
  check('rewriteRoot: a sibling folder that shares the prefix is left alone', moved.files[1] === '/home/u/proj2/b.js' && moved.files[2] === '/home/u/project/c.js', JSON.stringify(moved.files));
  const abs = JSON.stringify({ severity: 'warn', file: { relPath: 'a.js', absPath: '/home/u/proj/a.js', line: 3 }, what: 'Should fix. X.' });
  check('rewriteRoot: a finding line\'s absPath points into the scratch project', JSON.parse(QC.rewriteRoot(abs, '/home/u/proj', '/tmp/p')).file.absPath === '/tmp/p/a.js');
  check('rewriteRoot: a receipt output with no root in it stays byte for byte', QC.rewriteRoot('421:  maxBuffer: 64,\nexit 0\n', '/home/u/proj', '/tmp/p') === '421:  maxBuffer: 64,\nexit 0\n');
  const p = QC.skepticPrompt({ stamp: '2026-09-22-002749', range: { base: 'c3cfff8c129a', end: 'df408f0cdc9e' }, mergeDir: '/tmp/qc-run.X/review-merge', lines: SK,
    finders: [{ type: 'review-security-finder', noFindings: false }, { type: 'tk:review-deps-finder', noFindings: true }],
    keyMerges: [{ relPath: 'scripts/check.js', line: 530 }], merged: [{ id: 'R1' }, { id: 'R2' }, { id: 'R3' }], mergeSummary: 'merge-findings: 4 raw, 3 merged (1 merge)' });
  check('skepticPrompt: the build\'s /tk:review, entered at Phase 4 with the earlier phases\' files named and a stop before any fix',
    p.startsWith('/tk:review c3cfff8..df408f0 report only, no chaining\n') && /resumes a review at Phase 4/.test(p) && p.includes('/tmp/qc-run.X/review-merge') && p.includes('reports/receipts/2026-09-22-002749/scope.json')
    && /deps returned NO FINDINGS/.test(p) && /merged at scripts\/check\.js:530/.test(p) && /fix nothing/.test(p) && /from R1 to R3/.test(p), p);
});

section('skeptic replay: the scratch checkout and the cited plans', () => {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const g = (args, cwd) => {
    const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr);
    return r.stdout.trim();
  };
  // A source repo: two commits up to the range end, a later commit and a tag
  // after it, and a gitignored plan, as the owner's checkout holds them.
  const src = tmp('qc-test-src-');
  g(['init', '-q'], src);
  write(path.join(src, '.gitignore'), 'plans/\n');
  write(path.join(src, 'a.js'), 'one\n');
  g(['add', '-A'], src); g(['commit', '-q', '-m', 'one'], src);
  write(path.join(src, 'a.js'), 'two\n');
  write(path.join(src, 'b.js'), 'kept out of the archive\n');
  g(['add', '-A'], src); g(['commit', '-q', '-m', 'two'], src);
  const end = g(['rev-parse', 'HEAD'], src);
  write(path.join(src, 'a.js'), 'three\n');
  g(['commit', '-q', '-am', 'later'], src);
  g(['tag', 'v9'], src);
  write(path.join(src, 'plans', 'PLAN-x.md'), '# plan x\n');
  // The scratch project holds the end's tree as an archive leaves it, one file short.
  const project = tmp('qc-test-proj-');
  write(path.join(project, '.gitignore'), 'plans/\n');
  write(path.join(project, 'a.js'), 'two\n');
  const texts = ['{"what":"Should fix. The plan at plans/PLAN-x.md:4 says so."}', 'receipt: /tmp/p/plans/PLAN-x.md and plans/PLAN-gone.md'];
  const c = QC.replayCheckout({ project, end: end.slice(0, 7), repo: src, plansFrom: src, texts });
  check('replayCheckout: the scratch project is a clean checkout of the range end',
    c.head === end && g(['rev-parse', 'HEAD'], project) === end && g(['symbolic-ref', 'HEAD'], project) === 'refs/heads/main' && g(['status', '--porcelain'], project) === '', JSON.stringify(c));
  check('replayCheckout: it holds the end\'s own history and nothing after it (no later commit, tag or remote)',
    c.commits === 2 && g(['rev-list', '--all', '--count'], project) === '2' && g(['tag'], project) === '' && g(['remote'], project) === '', g(['rev-list', '--all', '--count'], project));
  check('replayCheckout: a tracked file the archive left out is restored', fs.existsSync(path.join(project, 'b.js')) && fs.readFileSync(path.join(project, 'a.js'), 'utf8') === 'two\n');
  check('replayCheckout: each cited plan is copied once, with its size and modified time recorded',
    fs.readFileSync(path.join(project, 'plans', 'PLAN-x.md'), 'utf8') === '# plan x\n' && c.plans.length === 2
    && c.plans[1].path === 'plans/PLAN-x.md' && c.plans[1].bytes === 9 && !isNaN(Date.parse(c.plans[1].modified)), JSON.stringify(c.plans));
  check('replayCheckout: a cited plan the checkout lacks is recorded as missing, not invented',
    c.plans[0].path === 'plans/PLAN-gone.md' && c.plans[0].missing === true && !fs.existsSync(path.join(project, 'plans', 'PLAN-gone.md')), JSON.stringify(c.plans[0]));
  let bad = '';
  try { QC.replayCheckout({ project: tmp('qc-test-proj-'), end: 'f'.repeat(40), repo: src, plansFrom: src, texts: [] }); } catch (e) { bad = e.message; }
  check('replayCheckout: a range end the repo does not hold stops the replay', /rev-parse/.test(bad), bad);
});

// A canned skeptic replay run folder. Four dispatches: D1 a paraphrased shard the
// session wrote with the Write tool, asking KEEP or KILL; D2 the --shards file,
// whose copy sits in project-reports; D3 a redispatch of R3 carrying its line byte
// for byte; D4 a general-purpose paraphrase of R3 asking KEEP or KILL, the last
// to rule on it. o.drop: dispatch ids left out; o.final: the session's last text.
function makeSkepticRun(o) {
  o = o || {};
  const dir = tmp('qc-test-skeptic-');
  const project = '/tmp/qc-run.TEST/project';
  const mergeDir = '/tmp/qc-run.TEST/review-merge';
  const stamp = '2026-09-22-002749';
  const sid = 'sess-skeptic';
  const slug = '-tmp-qc-run-TEST-project';
  const pad = '/tmp/claude-1000/' + slug + '/' + sid + '/scratchpad';
  const shardFile = 'reports/receipts/' + stamp + '/audit-tier2-1.txt';
  const plugin = 'node /tmp/qc-run.TEST/home/.claude/plugins/cache/llm-peer-review/tk/7.6.5/scripts/merge-findings.js';
  const drop = o.drop || [];
  const said = content => ({ type: 'assistant', message: { model: OPUS, role: 'assistant', content } });
  const tool = (id, name, input) => said([{ type: 'tool_use', id, name, input }]);
  const result = (id, text) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
  const dispatch = {
    d1: { type: 'audit-skeptic', prompt: 'Tier-2 skeptic shard. Read ' + pad + '/audit-shard-A.md: two Warn findings (R1 to R2). Return exactly one verdict line per ID (R1: KEEP or R1: KILL) plus one line of reasoning each.', ret: 'R1: KEEP\nthe mirror route is real\nR2: KILL\nalready handled' },
    d2: { type: 'tk:audit-skeptic', prompt: 'Tier 2. Your findings and M2\'s instruction for this tier are in ' + shardFile + '; read it in full and follow it exactly.', ret: 'R1: STANDS\nthe mirror route is real\nR2: REFUTED\nalready handled\nR3: STANDS\nthe plans still say so' },
    d3: { type: 'tk:audit-skeptic', prompt: 'Tier 2, a redispatch for R3. The finding, byte for byte:\n' + SK[3] + '\nReturn `RN: REFUTED` or `RN: STANDS` plus one line of reasoning.', ret: 'R3: STANDS\nthe plans still say so' },
    d4: { type: 'general-purpose', prompt: 'Skeptic pass on R3: the plans still say nothing was pushed. Answer R3: KEEP or R3: KILL.', ret: 'R3: KILL\nthe push is recorded elsewhere' },
  };
  const main = [
    tool('w1', 'Write', { file_path: pad + '/audit-shard-A.md', content: '# Audit shard A: R1 to R2\n\n## R1 (security, warn)\nwhat: An allowed remote-add can make a remote a mirror.\n\n## R2 (code + security, merged; warn)\nwhat: A media file over 64 MB refuses the push.\n' }),
    result('w1', 'File created'),
    tool('d1', 'Agent', { subagent_type: dispatch.d1.type, description: 'Audit shard A', prompt: dispatch.d1.prompt }),
    tool('b1', 'Bash', { command: plugin + ' --shards ' + mergeDir + ' --receipts reports/receipts/' + stamp + ' --out reports/receipts/' + stamp }),
    result('b1', JSON.stringify({ shards: [{ tier: 2, file: shardFile, ids: ['R1', 'R2', 'R3'] }], tier3: null, dropped: [] })),
    tool('d2', 'Agent', { subagent_type: dispatch.d2.type, description: 'Tier 2 shard 1', prompt: dispatch.d2.prompt }),
    tool('b2', 'Bash', { command: plugin + ' --verdicts ' + shardFile + ' ' + pad + '/d1-return.txt' }),
    result('b2', JSON.stringify({ tier: '2', ids: ['R1', 'R2'], ok: false, returns: [{ file: 'd1-return.txt', problems: [] }] })),
    tool('d3', 'Agent', { subagent_type: dispatch.d3.type, description: 'R3 again', prompt: dispatch.d3.prompt }),
    tool('d4', 'Agent', { subagent_type: dispatch.d4.type, description: 'R3 skeptic', prompt: dispatch.d4.prompt }),
  ].filter(r => !r.message.content.some(c => drop.includes(c.id)));
  const final = o.final || 'R1: STANDS\nR2: REFUTED\nR3: REFUTED';
  main.push(said([{ type: 'text', text: final }]));
  const slugDir = path.join(dir, 'transcripts', slug);
  write(path.join(slugDir, sid + '.jsonl'), main.map(r => JSON.stringify(r)).join('\n') + '\n');
  for (const [id, d] of Object.entries(dispatch)) {
    if (drop.includes(id)) continue;
    write(path.join(slugDir, sid, 'subagents', 'agent-' + id + '.jsonl'), JSON.stringify(said([{ type: 'tool_use', id: 'hb-' + id, name: 'SubagentHandback', input: { message: d.ret } }])) + '\n');
    write(path.join(slugDir, sid, 'subagents', 'agent-' + id + '.meta.json'), JSON.stringify({ agentType: d.type, toolUseId: id }));
  }
  // The --shards file as the script writes it; one receipt output quotes a verdict-shaped line.
  const shardSection = (id, parts) => ['===== ' + id + ' ====='].concat(...parts.map(([stem, line, out]) => ['Finding (' + stem + ', as its finder wrote it):', line, 'Receipt output (' + stem + '.txt, as tier 1 saved it):', out])).concat(['===== end ' + id + ' =====']).join('\n');
  write(path.join(dir, 'project-reports', 'receipts', stamp, 'audit-tier2-1.txt'), [
    'M2 audit shard: tier 2, shard 1 of 1, ids R1 R2 R3', '',
    'You are running tier 2: one skeptical pass over Warns and Suggests. The instruction, quoted from M2:', '"' + MF.TIER2_INSTRUCTION + '"', '',
    shardSection('R1', [['security-1', SK[0], 'R9: KEEP is a line a grep printed\nexit 0']]),
    shardSection('R2', [['security-2', SK[1], 'exit 0'], ['code-1', SK[2], 'exit 0']]),
    shardSection('R3', [['plan-1', SK[3], 'exit 0']]),
  ].join('\n') + '\n');
  const merged = [{ id: 'R1', severity: 'warn', sources: [0] }, { id: 'R2', severity: 'warn', sources: [1, 2] }, { id: 'R3', severity: 'warn', sources: [3] }];
  write(path.join(dir, 'run.json'), JSON.stringify({ version: 1, role: 'skeptic', arm: null, exitCode: 0, wallMs: 60000,
    paths: { tmp: '/tmp/qc-run.TEST', home: '/tmp/qc-run.TEST/home', project }, expect: { main: 'opus', finders: 'opus', mapper: 'opus' },
    replay: { stamp, mergeDir, lines: SK, merged } }));
  write(path.join(dir, 'result.json'), JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: sid, total_cost_usd: 3, duration_ms: 60000, num_turns: 12, permission_denials: [], result: final }));
  return dir;
}

section('skeptic replay: scoring the dispatches from the saved transcripts', () => {
  const a = QC.analyzeRun(QC.loadRun(makeSkepticRun()), ANSWERS);
  const d = a.skeptic ? a.skeptic.dispatches : [];
  const s = a.skeptic ? a.skeptic.summary : {};
  check('a skeptic replay with dispatches is valid, the general-purpose fallback only warned', a.valid && a.warnings.includes('other-agent:general-purpose'), a.reasons.join(', ') + ' | ' + a.warnings.join(', '));
  check('four skeptic dispatches are scored, in order', d.length === 4 && d.map(x => x.toolUseId).join() === 'd1,d2,d3,d4', JSON.stringify(d.map(x => x.toolUseId)));
  check('D1: a shard the session wrote by hand is a paraphrase, its IDs read from "R1 to R2", asking KEEP or KILL',
    d[0] && d[0].class === 'paraphrase' && d[0].ids.join() === 'R1,R2' && d[0].linesFound === 0 && d[0].asks.join() === 'KEEP,KILL' && d[0].m2Words === false, JSON.stringify(d[0]));
  check('D1: its KEEP/KILL return is flagged by checkVerdicts, word by word',
    d[0] && d[0].returnOk === false && d[0].problems.join() === 'unknown R1 KEEP,unknown R2 KILL', JSON.stringify(d[0] && d[0].problems));
  check('D2: a file merge-findings.js --shards wrote is byte for byte, its IDs from the script, M2\'s words from its preface only',
    d[1] && d[1].class === 'script' && d[1].ids.join() === 'R1,R2,R3' && d[1].linesFound === 3 && d[1].asks.join() === 'REFUTED,STANDS' && d[1].m2Words === true, JSON.stringify(d[1]));
  check('D2: a clean return is clean', d[1] && d[1].returnOk === true && d[1].problems.length === 0, JSON.stringify(d[1] && d[1].problems));
  check('D3: a prompt carrying the finder\'s line byte for byte is verbatim, and its clean return is clean',
    d[2] && d[2].class === 'verbatim' && d[2].ids.join() === 'R3' && d[2].linesFound === 1 && d[2].m2Words && d[2].returnOk === true, JSON.stringify(d[2]));
  check('D4: a general-purpose paraphrase is scored as a skeptic dispatch, and flagged',
    d[3] && d[3].type === 'general-purpose' && d[3].class === 'paraphrase' && d[3].returnOk === false, JSON.stringify(d[3]));
  check('summary: dispatches, byte for byte, paraphrased, returns clean and flagged, --verdicts calls',
    s.dispatches === 4 && s.byteForByte === 2 && s.script === 1 && s.verbatim === 1 && s.paraphrased === 2 && s.unknown === 0
    && s.returnsClean === 2 && s.returnsFlagged === 2 && s.otherWords === 2 && s.verdictsCalls === 1 && s.verdictsRejected === 1 && s.drift === true, JSON.stringify(s));
  check('summary: a finding whose last ruling came from a paraphrase is named; one a byte-for-byte dispatch re-ruled is not',
    s.recorded === 3 && (s.ruledFromParaphrase || []).join() === 'R3', JSON.stringify(s.ruledFromParaphrase));
  const replaced = QC.analyzeRun(QC.loadRun(makeSkepticRun({ drop: ['d4'] })), ANSWERS).skeptic.summary;
  check('a paraphrased dispatch whose findings were dispatched again byte for byte rules on nothing (the wired arm\'s bar)',
    replaced.paraphrased === 1 && replaced.ruledFromParaphrase.length === 0 && replaced.drift === true, JSON.stringify(replaced));
  const unaudited = QC.analyzeRun(QC.loadRun(makeSkepticRun({ final: 'R1: STANDS\nR2: REFUTED\nR3: unaudited' })), ANSWERS).skeptic.summary;
  check('a finding recorded as unaudited was not ruled on, whatever asked about it', unaudited.ruledFromParaphrase.length === 0 && unaudited.recorded === 3, JSON.stringify(unaudited));
  const known = new Map([['R1', { severity: 'warn', lines: [SK[0]] }]]);
  const ctx = { project: '/tmp/qc-run.TEST/project', known, writes: new Map(), bash: [], shards: new Map(), readLocal: () => null };
  const lost = QC.scoreDispatch('Judge R1 in /tmp/review-audit.Q/shard.md and reply R1: KEEP or R1: KILL.', ctx);
  check('scoreDispatch: a named file nothing can read back is unknown, not a paraphrase', lost.class === 'unknown' && lost.ids.join() === 'R1', JSON.stringify(lost));
  const heredoc = QC.scoreDispatch('Judge R1 in /tmp/review-audit.Q/shard.md.', { ...ctx, bash: ["cat > /tmp/review-audit.Q/shard.md <<'EOF'\n" + SK[0] + '\nEOF'] });
  check('scoreDispatch: a file written by a heredoc is read from the command, byte for byte', heredoc.class === 'verbatim' && heredoc.asks.length === 0 && heredoc.m2Words === false, JSON.stringify(heredoc));
  const cited = QC.scoreDispatch('Refute R1; the cited file is plans/PLAN-a.md and seed/settings.json:152.', ctx);
  check('scoreDispatch: a project source file the prompt cites is not an input, so the dispatch is a paraphrase', cited.class === 'paraphrase' && cited.file === null, JSON.stringify(cited));
  const pasted = QC.scoreDispatch('Tier 2. Try to refute each finding; return exactly one line per ID, `RN: REFUTED` or `RN: STANDS`.\n\nR1:\n'
    + SK[0] + '\nReceipt output (code-1.txt, as tier 1 saved it):\n```\n.claude/commands/review.md:260: the "R3: FIXED" / "R3: NOT FIXED" verdict format\nexit 0\n```', ctx);
  check('scoreDispatch: verdict words quoted in receipt output pasted into the prompt are not words it asked for (review R12)',
    pasted.class === 'verbatim' && pasted.asks.join() === 'REFUTED,STANDS' && pasted.m2Words === true, JSON.stringify(pasted));
  const runnerShard = '/tmp/claude-1000/-tmp-qc-run-TEST-project/sess/scratchpad/shard2.txt';
  const quotedFile = QC.scoreDispatch('Judge the findings in ' + runnerShard + ' and return R1: REFUTED or R1: STANDS.',
    { ...ctx, writes: new Map([[runnerShard, 'R1:\n' + SK[0] + '\nreceipt:\n.claude/commands/review.md:260:3. Re-verify per the "R3: FIXED" / "R3: NOT FIXED" format\n70:- **M3.** each returns "R3: FIXED" or "R3: NOT FIXED"\n']]) });
  check('scoreDispatch: a grep line quoted in a runner-written shard is file content, not a verdict word asked for (D2\'s false positive)',
    quotedFile.asks.join() === 'REFUTED,STANDS' && quotedFile.m2Words === true, JSON.stringify(quotedFile));
  const c = spawnSync('node', [SCRIPT, '--check', makeSkepticRun()], { encoding: 'utf8' });
  check('--check prints one line per dispatch and the summary of a skeptic replay',
    c.status === 0 && /D1 audit-skeptic tier 2 R1-R2 \(2\): paraphrase .*asks KEEP\/KILL \(not M2\); return flagged: unknown R1 KEEP, unknown R2 KILL/.test(c.stdout)
    && /D2 tk:audit-skeptic tier 2 R1-R3 \(3\): script \(reports\/receipts\/2026-09-22-002749\/audit-tier2-1\.txt\), lines 3\/3 byte for byte/.test(c.stdout)
    && /summary: 4 dispatches, 2 byte for byte \(1 script, 1 verbatim\), 2 paraphrased, 0 unknown; returns 2 clean, 2 flagged/.test(c.stdout)
    && /ruled on from a paraphrase: R3/.test(c.stdout) && /drift reproduced: yes/.test(c.stdout), c.stdout + c.stderr);
});

section('skeptic replay: the usage line', () => {
  const header = fs.readFileSync(SCRIPT, 'utf8').split('\n').slice(0, 140).join('\n');
  check('the header\'s usage names the skeptic role and its two folders', /node scripts\/quality-check\.js --role skeptic --build <git-ref\|tree> \[--evidence <dir>\] \[--receipts <dir>\]/.test(header));
  const role = spawnSync('node', [SCRIPT, '--role', 'judge', '--build', 'HEAD'], { encoding: 'utf8' });
  check('an unknown role is a usage error that names the skeptic role', role.status === 2 && /review, mapper or skeptic/.test(role.stderr), role.stderr);
  const arm = spawnSync('node', [SCRIPT, '--role', 'skeptic', '--arm', 'ship', '--build', 'HEAD'], { encoding: 'utf8' });
  check('--role skeptic with an arm is a usage error', arm.status === 2 && /takes no --arm/.test(arm.stderr), arm.stderr);
  const empty = tmp('qc-test-no-evidence-');
  const ev = spawnSync('node', [SCRIPT, '--role', 'skeptic', '--build', 'HEAD', '--evidence', empty], { encoding: 'utf8' });
  check('--role skeptic without the session log is a usage error (exit 2) that starts nothing', ev.status === 2 && /needs the evidence folder/.test(ev.stderr) && ev.stdout === '', ev.stdout + ev.stderr);
  const withLog = tmp('qc-test-evidence-');
  write(path.join(withLog, QC.SKEPTIC_REPLAY.session + '.jsonl'), '');
  const rc = spawnSync('node', [SCRIPT, '--role', 'skeptic', '--build', 'HEAD', '--evidence', withLog, '--receipts', empty], { encoding: 'utf8' });
  check('--role skeptic without the run\'s receipts and scope is a usage error (exit 2) that starts nothing', rc.status === 2 && /receipts folder with its scope\.json/.test(rc.stderr) && rc.stdout === '', rc.stdout + rc.stderr);
});

// ---------------------------------------------------------------------------
// The fix role and its oracles (harness research plan Step 11): /review's own
// fix loop runs, then two oracles per runnable planted bug judge the final tree.

const FIXES = require(path.join(FIXTURE, 'oracles', 'self-test-fixes.js'));

section('fix role: every planted bug has an oracle pair or a reason', () => {
  const set = QC.oracleSet(ANSWERS, path.join(FIXTURE, 'oracles'));
  const runnable = Object.keys(set);
  // The not-runnable bugs and the self-test pair come from the answer key (#278).
  const not = ANSWERS.bugs.filter(b => b.noOracle).map(b => b.id);
  const selfPair = ANSWERS.selfTestPair || {};
  check('oracles: each planted bug is runnable or listed as not runnable, never both', IDS.every(id => runnable.includes(id) !== not.includes(id)), JSON.stringify({ runnable, not }));
  check('oracles: the not-runnable list names only planted bugs, each with a reason', not.every(id => IDS.includes(id) && BUG[id].noOracle.length > 20));
  check('oracles: seven runnable bugs, the prompt file and the README wording are not', runnable.length === 7 && not.sort().join() === 'commands-contradiction,copy-unclear-headline', runnable.join());
  check('oracles: every runnable bug has a correct and an empty self-test fix', runnable.every(id => FIXES[id] && FIXES[id].correct.length && FIXES[id].deletion.length));
  check('oracles: the self-test pair is two different runnable bugs', !!selfPair.correct && selfPair.correct !== selfPair.deletion && runnable.includes(selfPair.correct) && runnable.includes(selfPair.deletion));
  const half = tmp('qc-test-oracles-half-');
  write(path.join(half, 'code-search-prefix.gone.js'), '');
  let threw = '';
  try { QC.oracleSet(ANSWERS, half); } catch (e) { threw = e.message; }
  check('oracleSet: half a pair is refused', /code-search-prefix has a gone oracle and no works oracle/.test(threw), threw);
  const stray = tmp('qc-test-oracles-stray-');
  write(path.join(stray, 'no-such-bug.gone.js'), '');
  threw = '';
  try { QC.oracleSet(ANSWERS, stray); } catch (e) { threw = e.message; }
  check('oracleSet: an oracle that names no planted bug is refused', /no-such-bug\.gone\.js/.test(threw), threw);
  // A bug with neither an oracle pair nor a noOracle reason, or with both, is
  // a key error, never a quiet skip (#278).
  const oracles = path.join(FIXTURE, 'oracles');
  const neither = { ...ANSWERS, bugs: ANSWERS.bugs.map(b => (b.id === 'commands-contradiction' ? { ...b, noOracle: undefined } : b)) };
  threw = '';
  try { QC.oracleSet(neither, oracles); } catch (e) { threw = e.message; }
  check('oracleSet: a bug with no oracle pair and no noOracle reason is refused', /commands-contradiction has no oracle pair and no noOracle reason/.test(threw), threw);
  const both = { ...ANSWERS, bugs: ANSWERS.bugs.map(b => (b.id === 'code-search-prefix' ? { ...b, noOracle: 'a reason that should not be here at all' } : b)) };
  threw = '';
  try { QC.oracleSet(both, oracles); } catch (e) { threw = e.message; }
  check('oracleSet: a bug with an oracle pair and a noOracle reason is refused', /code-search-prefix has an oracle pair and a noOracle reason/.test(threw), threw);
});

// Pocket's oracles (#278): the same shape, against Pocket's own key. A missing
// oracles folder is one failing line, not a thrown stack.
section('fix role: every pocket bug has an oracle pair or a reason (#278)', () => {
  const dir = path.resolve(__dirname, 'fixtures', 'quality-check', 'pocket');
  const key = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'));
  const oracles = path.join(dir, 'oracles');
  if (!fs.existsSync(path.join(oracles, 'self-test-fixes.js'))) { check('pocket oracles: the fixture has oracles and self-test fixes', false, 'no pocket/oracles/self-test-fixes.js'); return; }
  const fixes = require(path.join(oracles, 'self-test-fixes.js'));
  let set = null;
  try { set = QC.oracleSet(key, oracles); } catch (e) { check('pocket oracles: oracleSet accepts the folder', false, e.message); return; }
  const runnable = Object.keys(set);
  const not = key.bugs.filter(b => b.noOracle).map(b => b.id).sort();
  const selfPair = key.selfTestPair || {};
  check('pocket oracles: seven runnable bugs, the commands and copy bugs carry reasons', runnable.length === 7 && not.join() === 'commands-preview-archives,copy-readme-sequence' && key.bugs.filter(b => b.noOracle).every(b => b.noOracle.length > 20), JSON.stringify({ runnable, not }));
  check('pocket oracles: every runnable bug has a correct and an empty self-test fix', runnable.every(id => fixes[id] && fixes[id].correct.length && fixes[id].deletion.length), runnable.filter(id => !(fixes[id] && fixes[id].correct.length && fixes[id].deletion.length)).join());
  check('pocket oracles: the self-test pair is two different runnable bugs', !!selfPair.correct && selfPair.correct !== selfPair.deletion && runnable.includes(selfPair.correct) && runnable.includes(selfPair.deletion), JSON.stringify(selfPair));
});

section('fix role: the oracles stay out of the scratch project', () => {
  // The fixture folder holds base/, change/ and oracles/ side by side; the shared
  // oracle library sits one level up, outside every fixture (#278).
  check('the oracles folder sits beside base/ and change/, not inside either',
    ['base', 'change', 'oracles'].every(d => fs.existsSync(path.join(FIXTURE, d))) && path.dirname(QC.ORACLE_LIB) === path.dirname(FIXTURE));
  const dest = tmp('qc-test-fix-project-');
  QC.copyFixture(path.join(FIXTURE, 'base'), dest);
  QC.copyFixture(path.join(FIXTURE, 'change'), dest);
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(path.relative(dest, p)); } })(dest);
  check('the scratch project built from base/ and change/ holds no oracle file', !files.some(f => /\.(gone|works|shared)\.js$|self-test-fixes|(^|\/)lib\.js$/.test(f)), files.join(', '));
  const tells = files.filter(f => /oracle/i.test(fs.readFileSync(path.join(dest, f), 'utf8')));
  check('no project file mentions an oracle', tells.length === 0, tells.join(', '));
});

section('fix role: the prompt, the cap and the usage line', () => {
  const p = QC.fixPrompt(QC.FINDER_KINDS, 'abc1234');
  check('fixPrompt: all eight lenses over the planted change, "no chaining", and no "report only"',
    p === '/tk:review code,security,ux,plan,commands,browser,deps,copy abc1234..HEAD no chaining' && !/report only/.test(p), p);
  check('the fix role has its own default cap, $40', QC.DEFAULT_MAX_USD.fix === 40 && QC.budgetEstimate([], 'fix', null) === 40 && QC.budgetEstimate([], 'fix', 30) === 30);
  check('the other roles\' caps are unchanged', QC.DEFAULT_MAX_USD.review === 25 && QC.DEFAULT_MAX_USD.mapper === 8 && QC.DEFAULT_MAX_USD.skeptic === 25 && QC.DEFAULT_MAX_USD.probe === 5);
  const header = fs.readFileSync(SCRIPT, 'utf8').split('\n').slice(0, 160).join('\n');
  check('the header\'s usage names the fix role, --judge and --oracle-self-test',
    /node scripts\/quality-check\.js --role fix --build <git-ref\|tree>/.test(header) && /--judge <fix-run-dir>/.test(header) && /--oracle-self-test/.test(header));
  const arm = spawnSync('node', [SCRIPT, '--role', 'fix', '--arm', 'ship', '--build', 'HEAD'], { encoding: 'utf8' });
  check('--role fix with an arm is a usage error (exit 2) that starts nothing', arm.status === 2 && /--role fix runs the build as it ships: it takes no --arm/.test(arm.stderr) && arm.stdout === '', arm.stdout + arm.stderr);
  const port = spawnSync('node', [SCRIPT, '--role', 'review', '--arm', 'a', '--build', 'HEAD', '--oracle-port', '3100'], { encoding: 'utf8' });
  check('--oracle-port on another role is a usage error (exit 2) that starts nothing', port.status === 2 && /--oracle-port applies to --role fix/.test(port.stderr) && port.stdout === '', port.stdout + port.stderr);
  const bad = spawnSync('node', [SCRIPT, '--oracle-self-test', '--oracle-port', 'abc'], { encoding: 'utf8' });
  check('a bad --oracle-port is a usage error', bad.status === 2 && /--oracle-port needs a port number/.test(bad.stderr), bad.stderr);
  const role = spawnSync('node', [SCRIPT, '--role', 'judge', '--build', 'HEAD'], { encoding: 'utf8' });
  check('an unknown role is a usage error that names the fix role too', role.status === 2 && /or fix \(the oracle-checked fix run\)/.test(role.stderr), role.stderr);
  const notFix = tmp('qc-test-judge-');
  write(path.join(notFix, 'run.json'), JSON.stringify({ role: 'review' }));
  const judge = spawnSync('node', [SCRIPT, '--judge', notFix], { encoding: 'utf8' });
  check('--judge on a folder that is not a fix run is a usage error', judge.status === 2 && /--judge needs a fix run folder/.test(judge.stderr), judge.stderr);
});

section('fix role: the Digest and the fix verifiers\' returns', () => {
  const md = ['# Review', '', '### Findings', '- **R1** [code] ⚠️ `server.js:61` - x', '', '## Digest', '',
    '- R1: FIXED - the re-check passed', '- **R2**: NOT FIXED - tried a containment check, the receipt still matched',
    '- `R3` [commands]: PAGED - a prompt file needs approval (M9)', '- R4 [ux]: FIXED', '- R6: fixed in the loop, no verdict word',
    'R7: NOT FIXED', '', '## What I could not check', '- R5: FIXED (outside the Digest)'].join('\n');
  const d = QC.parseDigest(md);
  check('parseDigest: one verdict per R-number line, NOT FIXED kept apart from FIXED', JSON.stringify(d) === JSON.stringify({ R1: 'FIXED', R2: 'NOT FIXED', R3: 'PAGED', R4: 'FIXED', R7: 'NOT FIXED' }), JSON.stringify(d));
  check('parseDigest: a report with no Digest gives nothing', Object.keys(QC.parseDigest('# Review\n- R1: FIXED\n')).length === 0);
  const sub = (type, ts, text) => ({ meta: { agentType: type }, records: [{ timestamp: ts }], d: { handback: text, lastText: '' } });
  const v = QC.verifierVerdicts([
    sub('tk:fix-verifier', '2026-10-12T10:05:00Z', 'R2: FIXED\nreceipt: the second round'),
    sub('tk:fix-verifier', '2026-10-12T10:00:00Z', 'R1: FIXED\nreceipt: grep is empty\nR2: NOT FIXED\nreceipt: still there'),
    sub('tk:audit-skeptic', '2026-10-12T09:00:00Z', 'R9: FIXED'),
  ]);
  check('verifierVerdicts: fix-verifier returns only, a later round winning', JSON.stringify(v.verdicts) === JSON.stringify({ R1: 'FIXED', R2: 'FIXED' }) && v.dispatches === 2, JSON.stringify(v));
  check('fixOutcome: fixed, broken (the fake fix), not fixed, unjudged',
    QC.fixOutcome('PASS', 'PASS') === 'fixed' && QC.fixOutcome('PASS', 'FAIL') === 'broken' && QC.fixOutcome('FAIL', 'PASS') === 'not-fixed'
    && QC.fixOutcome('FAIL', 'FAIL') === 'not-fixed' && QC.fixOutcome('PASS', 'UNJUDGED') === 'unjudged' && QC.fixOutcome(null, null) === 'unjudged');
});

// A canned fix run: a review run (makeReviewRun) whose role is fix, its report
// with o.digest appended, o.verifier as one fix-verifier's return, o.oracles as
// oracles.json ({ id: [gone, works] }), o.gitStatus as the project's git status.
function makeFixRun(o) {
  const dir = makeReviewRun({ ...o, meta: { role: 'fix', arm: null, ...(o.meta || {}) } });
  const report = path.join(dir, 'project-reports', 'review-orchestrator-2026-10-03-120000.md');
  if (o.digest) fs.appendFileSync(report, '\n## Digest\n\n' + o.digest.join('\n') + '\n');
  if (o.verifier) {
    const sessionDir = fs.readdirSync(path.join(dir, 'transcripts', '-tmp-qc-run-TEST-project')).find(n => !/\.jsonl$/.test(n));
    const base = path.join(dir, 'transcripts', '-tmp-qc-run-TEST-project', sessionDir, 'subagents', 'agent-v1');
    write(base + '.jsonl', JSON.stringify({ type: 'assistant', timestamp: '2026-10-12T10:00:00Z', message: { model: OPUS, role: 'assistant', content: [{ type: 'text', text: o.verifier }] } }) + '\n');
    write(base + '.meta.json', JSON.stringify({ agentType: 'tk:fix-verifier', toolUseId: 'toolu_verifier' }));
  }
  if (o.oracles) {
    const v = (id, kind, verdict) => ({ verdict, line: verdict + ' ' + id + ' ' + kind + ': canned', exit: { PASS: 0, FAIL: 1, UNJUDGED: 2 }[verdict] });
    write(path.join(dir, 'oracles.json'), JSON.stringify({ port: 3000, oracles: Object.entries(o.oracles).map(([id, [g, w]]) => ({ id, gone: v(id, 'gone', g), works: v(id, 'works', w) })) }));
  }
  if (o.gitStatus !== undefined) write(path.join(dir, 'project-git.json'), JSON.stringify({ status: o.gitStatus, log: '' }));
  return dir;
}

section('fix role: one record per planted bug, from a canned run', () => {
  // R1..R5 in caught order: code-search-prefix, security-path-traversal, plan-export-json, known-shell-glob, browser-search-id.
  const caught = ['code-search-prefix', 'security-path-traversal', 'plan-export-json', 'known-shell-glob', 'browser-search-id'];
  const a = analyze(makeFixRun({
    caught,
    digest: ['- R1: FIXED - the search re-check passed', '- R2: FIXED - containment added', '- R3: NOT FIXED - left for the owner', '- R4: FIXED - the cited block removed'],
    verifier: 'R5: FIXED\nreceipt: the lookup now names #search',
    oracles: {
      'code-search-prefix': ['PASS', 'PASS'], 'security-path-traversal': ['PASS', 'PASS'], 'plan-export-json': ['FAIL', 'FAIL'],
      'known-shell-glob': ['PASS', 'FAIL'], 'browser-search-id': ['PASS', 'UNJUDGED'], 'ux-clear-all-no-confirm': ['FAIL', 'PASS'], 'deps-lodash-cve': ['FAIL', 'PASS'],
    },
    gitStatus: ' M server.js\n?? backups/\n',
  }));
  const b = a.fix && a.fix.bugs;
  check('a canned fix run is valid and reads like a review run', a.valid && a.role === 'fix' && a.survived['code-search-prefix'].length === 1, a.reasons.join(', '));
  check('a fix run that changed the project is not warned for it', !a.warnings.includes('project-changed'), a.warnings.join(', '));
  check('fix record: raised, in the report, said FIXED, gone and works PASS: fixed', b['code-search-prefix'].raised && b['code-search-prefix'].inReport.join() === 'R1'
    && b['code-search-prefix'].said === 'FIXED' && b['code-search-prefix'].outcome === 'fixed' && !b['code-search-prefix'].falseFixed, JSON.stringify(b['code-search-prefix']));
  check('fix record: said FIXED, gone PASS, works FAIL: broken, and a false FIXED (B1\'s miss)', b['known-shell-glob'].outcome === 'broken' && b['known-shell-glob'].falseFixed === true, JSON.stringify(b['known-shell-glob']));
  check('fix record: said NOT FIXED and the symptom reproduces: not fixed, and no false FIXED', b['plan-export-json'].said === 'NOT FIXED' && b['plan-export-json'].outcome === 'not-fixed' && !b['plan-export-json'].falseFixed);
  check('fix record: no Digest line, the fix verifier\'s FIXED is what the run said', b['browser-search-id'].said === 'FIXED' && b['browser-search-id'].reported[0].verifier === 'FIXED' && b['browser-search-id'].reported[0].digest === null);
  check('fix record: an oracle that could not judge makes the bug unjudged, never a false FIXED', b['browser-search-id'].outcome === 'unjudged' && !b['browser-search-id'].falseFixed && a.fix.unjudged.join() === 'browser-search-id');
  check('fix record: a bug the review never raised keeps its oracle verdicts', !b['ux-clear-all-no-confirm'].raised && b['ux-clear-all-no-confirm'].said === null && b['ux-clear-all-no-confirm'].outcome === 'not-fixed');
  check('fix record: the prompt file and the README wording are not runnable', b['commands-contradiction'].outcome === 'not-runnable' && b['copy-unclear-headline'].gone === null);
  check('fix record: the false FIXED list and the counts', a.fix.falseFixed.join() === 'known-shell-glob' && a.fix.digestLines === 4 && a.fix.verifierDispatches === 1 && a.fix.oraclePort === 3000, JSON.stringify({ f: a.fix.falseFixed, d: a.fix.digestLines, v: a.fix.verifierDispatches }));
  check('a fix-verifier on the session model is expected, not another agent', !a.warnings.some(w => /other-agent/.test(w)), a.warnings.join(', '));

  const leftover = analyze(makeFixRun({ caught: ['code-search-prefix'], digest: ['- R1: FIXED'], meta: { leftovers: [{ pid: 4242, cmd: 'node server.js' }] } }));
  check('a fix run that left a process running is warned, and stays valid', leftover.valid && leftover.warnings.includes('left-running:1'), leftover.warnings.join(', '));
  const unjudged = analyze(makeFixRun({ caught: ['code-search-prefix'], digest: ['- R1: FIXED'] }));
  check('a fix run with no oracles.json is warned not-judged, and stays valid', unjudged.valid && unjudged.warnings.includes('not-judged') && unjudged.fix.bugs['code-search-prefix'].outcome === 'not-judged', unjudged.warnings.join(', '));
  const noDigest = analyze(makeFixRun({ caught: ['code-search-prefix'], oracles: { 'code-search-prefix': ['PASS', 'PASS'] } }));
  check('a fix run whose report has no Digest is warned no-digest', noDigest.warnings.includes('no-digest') && noDigest.fix.bugs['code-search-prefix'].said === null);
  const review = analyze(makeReviewRun({ caught: ['code-search-prefix'] }));
  check('a review run gets no fix record', review.fix === undefined);
});

section('fix role: applyEdits and copyTree', () => {
  const t = tmp('qc-test-edits-');
  write(path.join(t, 'a.txt'), 'one two two\n');
  write(path.join(t, 'gone.txt'), 'x');
  QC.applyEdits(t, [{ file: 'a.txt', find: 'one', replace: '1' }, { file: 'gone.txt', remove: true }]);
  check('applyEdits: replaces text found once and removes a file', fs.readFileSync(path.join(t, 'a.txt'), 'utf8') === '1 two two\n' && !fs.existsSync(path.join(t, 'gone.txt')));
  let twice = '';
  try { QC.applyEdits(t, [{ file: 'a.txt', find: 'two', replace: '2' }]); } catch (e) { twice = e.message; }
  let missing = '';
  try { QC.applyEdits(t, [{ file: 'a.txt', find: 'three', replace: '3' }]); } catch (e) { missing = e.message; }
  check('applyEdits: text found twice or not at all is refused', /exactly once/.test(twice) && /exactly once/.test(missing));
  const unfixed = tmp('qc-test-unfixed-');
  QC.copyFixture(path.join(FIXTURE, 'base'), unfixed);
  QC.copyFixture(path.join(FIXTURE, 'change'), unfixed);
  for (const [id, f] of Object.entries(FIXES)) {
    for (const shape of ['correct', 'deletion']) {
      const copy = tmp('qc-test-fix-shape-');
      QC.copyTree(unfixed, copy);
      let err = '';
      try { QC.applyEdits(copy, f[shape]); } catch (e) { err = e.message; }
      check('self-test fix ' + id + ' ' + shape + ' applies to the change tree', err === '', err);
    }
  }
  const src = tmp('qc-test-tree-');
  for (const f of ['.git/HEAD', 'reports/r.md', 'artifacts/html/review.html', 'node_modules/lodash/index.js', '.claude/commands/x.md', 'server.js']) write(path.join(src, f), 'x');
  const dest = path.join(tmp('qc-test-tree-dest-'), 'copy');
  QC.copyTree(src, dest);
  check('copyTree: .git, reports/ and artifacts/ stay behind; node_modules, .claude and the code come along',
    !fs.existsSync(path.join(dest, '.git')) && !fs.existsSync(path.join(dest, 'reports')) && !fs.existsSync(path.join(dest, 'artifacts'))
    && fs.existsSync(path.join(dest, 'node_modules', 'lodash', 'index.js')) && fs.existsSync(path.join(dest, '.claude', 'commands', 'x.md')) && fs.existsSync(path.join(dest, 'server.js')));
});

section('fix role: the fixes diff', () => {
  const repo = tmp('qc-test-fix-diff-');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const g = args => spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, env, encoding: 'utf8' });
  write(path.join(repo, 'server.js'), 'planted\n');
  write(path.join(repo, 'app.js'), 'app\n');
  write(path.join(repo, '.gitignore'), 'reports/\n');
  g(['init', '-q', '-b', 'main']); g(['add', '-A']); g(['commit', '-q', '-m', 'change']);
  const change = g(['rev-parse', 'HEAD']).stdout.trim();
  write(path.join(repo, 'server.js'), 'fixed and committed\n');
  g(['commit', '-q', '-am', 'fix one']);
  write(path.join(repo, 'app.js'), 'fixed, not committed\n');
  write(path.join(repo, 'new-test.js'), 'untracked\n');
  write(path.join(repo, 'reports', 'r.md'), 'ignored\n');
  const statusBefore = g(['status', '--porcelain']).stdout;
  const diff = QC.fixDiff(repo, change);
  check('fixDiff: a committed fix, an uncommitted one and an untracked file are all in the diff',
    /\+fixed and committed/.test(diff) && /\+fixed, not committed/.test(diff) && /new-test\.js/.test(diff) && /\+untracked/.test(diff), diff);
  check('fixDiff: an ignored folder stays out', !/reports\/r\.md/.test(diff));
  check('fixDiff: the project\'s own index is untouched', g(['status', '--porcelain']).stdout === statusBefore, g(['status', '--porcelain']).stdout);
});

// A process that no longer runs, or a zombie waiting for its parent to reap it.
function gone(pid) {
  try { process.kill(pid, 0); } catch (e) { return e.code === 'ESRCH'; }
  try { return /^\d+ \(.*\) Z/.test(fs.readFileSync('/proc/' + pid + '/stat', 'utf8')); } catch (e) { return true; }
}

async function asyncSection(name, fn) {
  try { await fn(); } catch (e) { check(name + ' (section threw)', false, e && e.stack); }
}

(async () => {
  await asyncSection('a timeout stops the whole process group (review R3)', async () => {
    // The shape of the session wrapper: a shell whose child is not exec'd.
    const r = await QC.runGroup('bash', ['-c', 'sleep 30 & echo $!; wait'], {}, 500, 1000);
    const child = Number(r.stdout.trim());
    check('runGroup: a timeout gives status 124 and says so', r.status === 124 && r.timedOut === true, JSON.stringify(r));
    let dead = false;
    for (let i = 0; i < 20 && !(dead = child > 0 && gone(child)); i++) await new Promise(res => setTimeout(res, 100));
    check('runGroup: the shell\'s child is stopped with it, not orphaned', dead && r.wallMs < 5000, 'pid ' + child + ', ' + r.wallMs + ' ms (a 30 s wait means the child ran on)');
    const ok = await QC.runGroup('bash', ['-c', 'echo out; echo err >&2; exit 3'], {}, 10000);
    check('runGroup: a normal exit keeps its status and both streams', ok.status === 3 && ok.stdout === 'out\n' && ok.stderr === 'err\n' && !ok.timedOut, JSON.stringify(ok));
    const left = await QC.runGroup('bash', ['-c', '(exec sleep 30) & echo $!'], {}, 10000);
    const leftover = Number(left.stdout.trim());
    let cleared = false;
    for (let i = 0; i < 20 && !(cleared = leftover > 0 && gone(leftover)); i++) await new Promise(res => setTimeout(res, 100));
    check('runGroup: what the command leaves running in its group is stopped when it exits', left.status === 0 && cleared, JSON.stringify(left));
    const missing = await QC.runGroup('/nonexistent/bin', [], {}, 10000);
    check('runGroup: a command that cannot start resolves, never hangs', missing.status === 124 && /ENOENT/.test(missing.stderr), JSON.stringify(missing));
  });

  await asyncSection('fix role: a verdict counts only when the oracle\'s line and exit code agree', async () => {
    const dir = tmp('qc-test-fake-oracles-');
    write(path.join(dir, 'code-search-prefix.gone.js'), "console.log('PASS code-search-prefix gone: says pass'); process.exit(1);\n");
    write(path.join(dir, 'code-search-prefix.works.js'), "throw new Error('the oracle broke');\n");
    write(path.join(dir, 'known-shell-glob.gone.js'), "console.log('FAIL known-shell-glob gone: still aborts'); process.exit(1);\n");
    write(path.join(dir, 'known-shell-glob.works.js'), "console.log('PASS known-shell-glob works: rotates'); process.exit(0);\n");
    const tree = tmp('qc-test-fake-tree-');
    write(path.join(tree, 'server.js'), '');
    const port = await QC.freePort();
    // A key of just the two bugs the fake folder holds oracles for: every other
    // bug would have neither a pair nor a noOracle reason, which oracleSet refuses.
    const twoBugs = { ...ANSWERS, bugs: ANSWERS.bugs.filter(b => b.id === 'code-search-prefix' || b.id === 'known-shell-glob') };
    const j = await QC.judgeTree(tree, port, { answers: twoBugs, dir });
    const by = Object.fromEntries(j.oracles.map(r => [r.id, r]));
    check('judgeTree: a PASS line with exit 1 is UNJUDGED, not a pass or a fail', by['code-search-prefix'].gone.verdict === 'UNJUDGED', JSON.stringify(by['code-search-prefix'].gone));
    check('judgeTree: an oracle that crashes is UNJUDGED, not a FAIL', by['code-search-prefix'].works.verdict === 'UNJUDGED' && /no verdict line \(exit 1\)/.test(by['code-search-prefix'].works.line), JSON.stringify(by['code-search-prefix'].works));
    check('judgeTree: a line and exit code that agree are the verdict', by['known-shell-glob'].gone.verdict === 'FAIL' && by['known-shell-glob'].works.verdict === 'PASS');
    check('judgeTree: the port is never the real run\'s 3000 in a test', port !== QC.PORT && j.port === port);
  });

  await asyncSection('fix role: what the session left running in the scratch folder is found', async () => {
    if (process.platform !== 'linux') { check('processesUnder: no /proc here, so nothing is found', QC.processesUnder(os.tmpdir()).length === 0); return; }
    const scratch = tmp('qc-test-leftover-');
    const { spawn } = require('child_process');
    const child = spawn('sleep', ['30'], { cwd: scratch, stdio: 'ignore' });
    try {
      await new Promise(res => setTimeout(res, 200));
      const found = QC.processesUnder(scratch);
      check('processesUnder: a process whose working folder is inside the scratch folder is listed', found.some(p => p.pid === child.pid && /sleep 30/.test(p.cmd)), JSON.stringify(found));
      check('processesUnder: nothing outside it is listed', QC.processesUnder(tmp('qc-test-empty-')).length === 0);
    } finally { child.kill('SIGKILL'); }
  });

  // The self-test's required case for the two bugs a test can run without a
  // browser, on one fixture: the full one, browser oracles included, is
  // --oracle-self-test. `prefix` starts every check name, so a failure names
  // its fixture; a missing oracles folder is one failing line, not a stack.
  async function separatesPair(name, prefix) {
    const dir = path.resolve(__dirname, 'fixtures', 'quality-check', name);
    const key = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'));
    const selfPair = key.selfTestPair;
    // One line, not a stack: the release gate shows only a failing suite's tail.
    if (!selfPair) { check(prefix + 'the answer key names the self-test pair', false, 'answers.json has no selfTestPair'); return; }
    const fixesFile = path.join(dir, 'oracles', 'self-test-fixes.js');
    if (!fs.existsSync(fixesFile)) { check(prefix + 'the fixture has oracles and self-test fixes', false, 'no ' + name + '/oracles/self-test-fixes.js'); return; }
    const fixes = require(fixesFile);
    const unfixed = tmp('qc-test-oracle-unfixed-');
    QC.copyFixture(path.join(dir, 'base'), unfixed);
    QC.copyFixture(path.join(dir, 'change'), unfixed);
    const only = [selfPair.correct, selfPair.deletion];
    const port = await QC.freePort();
    const before = await QC.judgeTree(unfixed, port, { fixture: name, answers: key, only });
    for (const r of before.oracles) check(prefix + 'unfixed: the ' + r.id + ' gone oracle FAILs', r.gone.verdict === 'FAIL', r.gone.line);
    const pair = tmp('qc-test-oracle-pair-');
    QC.copyTree(unfixed, pair);
    QC.applyEdits(pair, fixes[selfPair.correct].correct);
    QC.applyEdits(pair, fixes[selfPair.deletion].deletion);
    const after = await QC.judgeTree(pair, port, { fixture: name, answers: key, only });
    const by = Object.fromEntries(after.oracles.map(r => [r.id, r]));
    const c = by[selfPair.correct];
    const d = by[selfPair.deletion];
    check(prefix + 'a correct fix (' + c.id + ') passes gone and works', c.gone.verdict === 'PASS' && c.works.verdict === 'PASS', c.gone.line + ' | ' + c.works.line);
    check(prefix + 'an empty fix (' + d.id + ', the cited lines deleted) passes gone and fails works', d.gone.verdict === 'PASS' && d.works.verdict === 'FAIL', d.gone.line + ' | ' + d.works.line);
  }

  await asyncSection('fix role: the oracles separate a correct fix from an empty one (no browser)', () => separatesPair('notebook', ''));
  await asyncSection('fix role: the oracles separate a correct fix from an empty one on pocket (no browser)', () => separatesPair('pocket', 'on pocket (no browser): '));

  // #278 review: a fix that only hides a planted symptom must not read as fixed.
  // Each edit below is such a fix on Pocket's change tree, and its gone oracle
  // must FAIL. Not a self-test shape: those are a real fix and an empty one.
  await asyncSection('fix role: on pocket, a fix that hides the symptom fails its gone oracle (#278 review)', async () => {
    const dir = path.resolve(__dirname, 'fixtures', 'quality-check', 'pocket');
    const key = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'));
    const unfixed = tmp('qc-test-mask-unfixed-');
    QC.copyFixture(path.join(dir, 'base'), unfixed);
    QC.copyFixture(path.join(dir, 'change'), unfixed);
    const masks = {
      // The count line goes; the list still shows the newest 20 of 25 and says nothing of the rest.
      'known-capped-total': [{
        file: 'server.js',
        find: "    + '<p class=\"summary\">' + rows.length + (rows.length === 1 ? ' expense, ' : ' expenses, ') + money(total) + ' in total</p>\\n'\n",
        replace: '',
      }],
      // The edit is still stored without its id, and answered with a page instead of a redirect.
      'code-edit-drops-id': [{
        file: 'server.js',
        find: "      expenses[index] = checked.value;\n      saveExpenses(expenses);\n      return redirect(res, '/?month=' + monthOf(checked.value.date));\n",
        replace: "      expenses[index] = checked.value;\n      saveExpenses(expenses);\n      return send(res, 200, page('Saved', '<p>Saved. <a href=\"/\">Back to the list</a></p>'));\n",
      }],
    };
    const port = await QC.freePort();
    for (const [id, edits] of Object.entries(masks)) {
      const tree = tmp('qc-test-mask-');
      QC.copyTree(unfixed, tree);
      QC.applyEdits(tree, edits);
      const j = await QC.judgeTree(tree, port, { fixture: 'pocket', answers: key, only: [id] });
      const r = j.oracles.find(x => x.id === id);
      check('on pocket: hiding the ' + id + ' symptom fails its gone oracle', !!r && r.gone.verdict === 'FAIL', r ? r.gone.line : 'no verdict for ' + id);
    }
  });

  // #278 review: the judge runs code the session wrote (the tree's server and its
  // npm scripts, started by the oracles), so it gets the session's stripped
  // environment, never the owner's keys.
  await asyncSection('fix role: the judge and the servers it starts see no key-like variable (#278 review)', async () => {
    const dir = tmp('qc-test-env-oracles-');
    const probe = "const k = process.env.QC_TEST_FAKE_API_KEY; console.log(k ? 'FAIL ID KIND: the oracle sees a key' : 'PASS ID KIND: no key'); process.exit(k ? 1 : 0);\n";
    for (const id of ['code-search-prefix', 'known-shell-glob']) for (const kind of ['gone', 'works']) write(path.join(dir, id + '.' + kind + '.js'), probe.split('ID KIND').join(id + ' ' + kind));
    const tree = tmp('qc-test-env-tree-');
    write(path.join(tree, 'server.js'), '');
    const twoBugs = { ...ANSWERS, bugs: ANSWERS.bugs.filter(b => b.id === 'code-search-prefix' || b.id === 'known-shell-glob') };
    // Built from pieces: a quoted literal after a key-like name trips the push tripwire,
    // which has no allow-list by design (see the lesson on real-shaped fixture secrets).
    process.env.QC_TEST_FAKE_API_KEY = ['not', 'a', 'real', 'key'].join('-');
    try {
      const j = await QC.judgeTree(tree, await QC.freePort(), { answers: twoBugs, dir });
      const seen = j.oracles.filter(r => r.gone.verdict !== 'PASS' || r.works.verdict !== 'PASS').map(r => r.id + ': ' + r.gone.line + ' | ' + r.works.line);
      check('judgeTree: an oracle never sees the owner\'s key-like variables', j.oracles.length === 2 && seen.length === 0, seen.join('; ') || j.oracles.length + ' oracles judged');
      const env = typeof QC.childEnv === 'function' ? QC.childEnv({ PORT: '1' }) : null;
      check('childEnv: a process the harness starts beside the session gets no key-like variable', !!env && !('QC_TEST_FAKE_API_KEY' in env) && env.PORT === '1' && env.PATH === process.env.PATH, env ? 'key kept or PATH lost' : 'childEnv is not exported');
    } finally { delete process.env.QC_TEST_FAKE_API_KEY; }
  });

  // #277: what a measured session may not reach. Each piece is exported and
  // tested on its output: stripSecrets on an env, sessionEnv on the real
  // process.env with one planted name, sessionArgs on the list runSession
  // spawns, restrictionsRecord on a made-up /tmp. The plan's grep target covers
  // the one call the tests cannot see, the record written into run.json.
  section('session restrictions (#277)', () => {
    // FAL_KEY (the toolkit's own video key) and the cloud access pair end in
    // neither _API_KEY nor _TOKEN (review of #277, R14): the strip matches by
    // suffix family, so any name ending _KEY goes.
    const env = { FOO_API_KEY: 'a', X_SECRET: 'b', DB_PASSWORD: 'c', NPM_TOKEN: 'd', FAL_KEY: 'k', AWS_ACCESS_KEY_ID: 'i', AWS_SECRET_ACCESS_KEY: 's', GH_TOKEN: 'e', GITHUB_TOKEN: 'f', CLAUDE_CODE_MESSAGING_TOKEN: 'g', PATH: '/bin' };
    const stripped = typeof QC.stripSecrets === 'function' ? QC.stripSecrets(env) : null;
    check("stripSecrets drops key-like names and keeps Claude Code's own and the GitHub CLI's",
      Array.isArray(stripped) && stripped.join() === 'AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY,DB_PASSWORD,FAL_KEY,FOO_API_KEY,NPM_TOKEN,X_SECRET'
        && !('FOO_API_KEY' in env) && !('X_SECRET' in env) && !('DB_PASSWORD' in env) && !('NPM_TOKEN' in env) && !('FAL_KEY' in env) && !('AWS_ACCESS_KEY_ID' in env)
        && env.GH_TOKEN === 'e' && env.GITHUB_TOKEN === 'f' && env.CLAUDE_CODE_MESSAGING_TOKEN === 'g' && env.PATH === '/bin',
      JSON.stringify({ stripped, left: Object.keys(env) }));

    // The planted name is set on the real environment for this one call only.
    process.env.FOO_API_KEY = 'planted';
    let real = null;
    try { real = typeof QC.sessionEnv === 'function' ? QC.sessionEnv(tmp('qc-test-env-')) : null; } finally { delete process.env.FOO_API_KEY; }
    check('sessionEnv drops a planted FOO_API_KEY from process.env',
      real !== null && !('FOO_API_KEY' in real) && typeof real.PATH === 'string'
        && Array.isArray(real.strippedNames) && real.strippedNames.includes('FOO_API_KEY')
        && !Object.keys(real).includes('strippedNames'),
      real === null ? 'sessionEnv is not exported' : JSON.stringify({ planted: 'FOO_API_KEY' in real, names: real.strippedNames, enumerable: Object.keys(real).includes('strippedNames') }));

    const args = typeof QC.sessionArgs === 'function' ? QC.sessionArgs({ build: '/b', project: '/p', home: '/h', prompt: 'hi', maxUsd: 1 }) : null;
    const at = Array.isArray(args) ? args.indexOf('--disallowedTools') : -1;
    check('sessionArgs passes --disallowedTools with WebFetch and WebSearch',
      at !== -1 && Array.isArray(QC.DISALLOWED_TOOLS) && args[at + 1] === QC.DISALLOWED_TOOLS.join(',')
        && QC.DISALLOWED_TOOLS.includes('WebFetch') && QC.DISALLOWED_TOOLS.includes('WebSearch') && QC.DISALLOWED_TOOLS.includes('Artifact'),
      args === null ? 'sessionArgs is not exported' : JSON.stringify({ at, next: args[at + 1], tools: QC.DISALLOWED_TOOLS }));

    // A made-up /tmp: two plain entries, and a scratchpad root holding one
    // session folder and one loose file. The root itself is never recorded.
    const root = tmp('qc-test-tmp-');
    const scratch = 'claude-' + (typeof process.getuid === 'function' ? process.getuid() : 0);
    fs.mkdirSync(path.join(root, 'a'));
    fs.writeFileSync(path.join(root, 'b'), '');
    fs.mkdirSync(path.join(root, scratch, 'slugA', 'sess1'), { recursive: true });
    fs.writeFileSync(path.join(root, scratch, 'lock'), '');
    const rec = typeof QC.restrictionsRecord === 'function' ? QC.restrictionsRecord(root, ['FOO_API_KEY']) : null;
    check('restrictionsRecord names the tools, the stripped names and the /tmp snapshot',
      rec !== null && rec.disallowedTools.join() === QC.DISALLOWED_TOOLS.join() && rec.strippedEnv.join() === 'FOO_API_KEY'
        && rec.tmpBefore.join() === ['a', 'b', scratch + '/lock', scratch + '/slugA/sess1'].join() && rec.tmpBeforeTruncated === false,
      rec === null ? 'restrictionsRecord is not exported' : JSON.stringify(rec));

    // A 200-name cap dropped the harness's own run folders on this machine (355
    // entries; review of #277, R19): the cap is 1,000 and the record says when it cut.
    const big = tmp('qc-test-tmpbig-');
    for (let i = 0; i < 1005; i++) fs.writeFileSync(path.join(big, 'e' + String(i).padStart(4, '0')), '');
    const capped = rec === null ? null : QC.restrictionsRecord(big, []);
    check('the /tmp snapshot is capped at 1000 names and the record says it was cut', capped !== null && capped.tmpBefore.length === 1000 && capped.tmpBeforeTruncated === true, capped === null ? 'no record' : JSON.stringify({ n: capped.tmpBefore.length, truncated: capped.tmpBeforeTruncated }));
  });

  // #277: the three leak paths the analyzer flags as warnings, each on a canned
  // run built with the builder's existing options (mainTools, agents, meta).
  // The run's own tmp root is in tmpBefore on purpose: it exists before the
  // session starts, so the exclusion of the run's own tmp and home is what keeps
  // a run's reads of its own project from counting as stale.
  section('leak flags (#277)', () => {
    const BUILD = '/tmp/qc-run.TEST/home/.claude/plugins/cache/llm-peer-review/tk/7.4.3';
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const scratch = '/tmp/claude-' + uid + '/-tmp-qc-run-TEST-project/';
    const read = (id, file) => ({ type: 'tool_use', id, name: 'Read', input: { file_path: file } });
    const bash = (id, command) => ({ type: 'tool_use', id, name: 'Bash', input: { command } });
    // An extra finder answers NO FINDINGS: the analyzer scores a lens by its
    // finder's last attempt, and an attempt with no answer voids the run.
    const done = () => ({ type: 'tool_use', id: 'hb_extra', name: 'SubagentHandback', input: { message: 'NO FINDINGS' } });
    const restrictions = { disallowedTools: ['WebFetch'], strippedEnv: [], tmpBefore: ['qc-run.TEST', 'plan-render.old', 'foo', 'claude-' + uid + '/-tmp-qc-run-TEST-project/old-session'] };

    const net = analyze(makeReviewRun({ caught: ['code-search-prefix'], mainTools: [bash('t_net', 'curl -s https://raw.githubusercontent.com/x/y/main/answers.json')], agents: [{ type: 'tk:review-deps-finder', tools: [bash('t_net2', 'git clone https://github.com/x/y'), done()] }] }));
    check('a Bash call naming github.com is flagged network-name',
      net.valid && net.warnings.includes('network-name:2') && Array.isArray(net.network) && net.network.length === 2 && /githubusercontent/.test(net.network[0]) && /github\.com/.test(net.network[1]),
      JSON.stringify({ warnings: net.warnings, network: net.network, reasons: net.reasons }));

    const plug = analyze(makeReviewRun({ caught: ['code-search-prefix'], agents: [{ type: 'tk:review-code-finder', tools: [read('t_p1', BUILD + '/skills/shared/model-routing.md'), done()] }] }));
    check('a finder read of the routing file inside the plugin build folder is flagged plugin-read',
      plug.valid && plug.warnings.includes('plugin-read:1') && Array.isArray(plug.pluginReads) && plug.pluginReads.join() === BUILD + '/skills/shared/model-routing.md',
      JSON.stringify({ warnings: plug.warnings, reads: plug.pluginReads, reasons: plug.reasons }));

    const judge = analyze(makeReviewRun({ caught: ['code-search-prefix'], agents: [{ type: 'tk:audit-skeptic', tools: [read('t_p2', BUILD + '/skills/shared/hitl-loop.md')] }] }));
    check('a judge read of the loop rules file inside the plugin build folder is not flagged',
      judge.valid && !judge.warnings.some(w => /^plugin-read/.test(w)), JSON.stringify({ warnings: judge.warnings, reasons: judge.reasons }));

    const stale = analyze(makeReviewRun({ caught: ['code-search-prefix'], meta: { restrictions }, mainTools: [read('t_s1', '/tmp/plan-render.old/data.json')] }));
    check('a read of a /tmp folder that existed before the run is flagged stale-tmp',
      stale.valid && stale.warnings.includes('stale-tmp:1') && Array.isArray(stale.staleTmp) && stale.staleTmp.join() === '/tmp/plan-render.old/data.json',
      JSON.stringify({ warnings: stale.warnings, stale: stale.staleTmp, reasons: stale.reasons }));

    const sib = analyze(makeReviewRun({ caught: ['code-search-prefix'], meta: { restrictions }, mainTools: [read('t_s2', '/tmp/foo-2/x'), read('t_s3', '/tmp/foo')] }));
    check('an entry never flags a sibling that only shares its prefix',
      sib.valid && sib.warnings.includes('stale-tmp:1') && sib.staleTmp.join() === '/tmp/foo', JSON.stringify({ warnings: sib.warnings, stale: sib.staleTmp }));

    const pads = analyze(makeReviewRun({ caught: ['code-search-prefix'], meta: { restrictions }, mainTools: [read('t_s4', scratch + 'old-session/scratchpad/notes.md'), read('t_s5', scratch + 'new-session/scratchpad/notes.md')] }));
    check("an older session's scratchpad is flagged and the run's own scratchpad is not",
      pads.valid && pads.warnings.includes('stale-tmp:1') && pads.staleTmp.join() === scratch + 'old-session/scratchpad/notes.md',
      JSON.stringify({ warnings: pads.warnings, stale: pads.staleTmp }));

    const own = analyze(makeReviewRun({ caught: ['code-search-prefix'], meta: { restrictions }, mainTools: [read('t_o1', BUILD + '/skills/shared/model-routing.md'), read('t_o2', '/tmp/qc-run.TEST/project/server.js'), read('t_o3', '/tmp/qc-run.TEST/home/.claude/settings.json')] }));
    check("the main session's plugin read and the run's own tmp are not flagged",
      own.valid && !own.warnings.some(w => /^(plugin-read|stale-tmp)/.test(w)), JSON.stringify({ warnings: own.warnings, reasons: own.reasons }));

    const none = analyze(makeReviewRun({ caught: ['code-search-prefix'], meta: { paths: { tmp: '/tmp/qc-run.TEST', home: '/tmp/qc-run.TEST/home', project: '/tmp/qc-run.TEST/project' } }, mainTools: [read('t_n1', '/tmp/plan-render.old/data.json')], agents: [{ type: 'tk:review-code-finder', tools: [read('t_n2', BUILD + '/skills/shared/model-routing.md'), done()] }] }));
    check('a run with no tmpBefore or no buildDir gets neither flag',
      none.valid && !none.warnings.some(w => /^(plugin-read|stale-tmp)/.test(w)), JSON.stringify({ warnings: none.warnings, reasons: none.reasons }));

    // Review of #277, R11 and R13: a read through the shell, a search scoped to
    // the folder that holds the routing file, and a GitHub CLI call that names
    // this repository all dodge the flags when only tool paths and domain
    // names are looked at.
    const shell = analyze(makeReviewRun({ caught: ['code-search-prefix'], meta: { restrictions }, mainTools: [bash('t_sh1', 'cat /tmp/plan-render.old/data.json')] }));
    check('a shell read under a pre-run /tmp folder is flagged stale-tmp',
      shell.valid && shell.warnings.includes('stale-tmp:1') && Array.isArray(shell.staleTmp) && shell.staleTmp.join() === '/tmp/plan-render.old/data.json',
      JSON.stringify({ warnings: shell.warnings, stale: shell.staleTmp, reasons: shell.reasons }));

    const grepped = analyze(makeReviewRun({ caught: ['code-search-prefix'], agents: [{ type: 'tk:review-code-finder', tools: [{ type: 'tool_use', id: 't_g1', name: 'Grep', input: { pattern: 'failglob', path: BUILD + '/skills/shared' } }, done()] }] }));
    check("a finder search scoped to the routing file's folder is flagged plugin-read",
      grepped.valid && grepped.warnings.includes('plugin-read:1') && Array.isArray(grepped.pluginReads) && grepped.pluginReads.join() === BUILD + '/skills/shared',
      JSON.stringify({ warnings: grepped.warnings, reads: grepped.pluginReads, reasons: grepped.reasons }));

    const cli = analyze(makeReviewRun({ caught: ['code-search-prefix'], mainTools: [bash('t_cli1', 'gh api repos/x/llm-peer-review/contents/scripts/fixtures/quality-check/notebook/answers.json'), bash('t_cli2', 'gh api repos/lodash/lodash/releases/latest')] }));
    check('a GitHub CLI call naming this repository is flagged network-name and a call about another repository is not',
      cli.valid && cli.warnings.includes('network-name:1') && Array.isArray(cli.network) && cli.network.length === 1 && /llm-peer-review/.test(cli.network[0]),
      JSON.stringify({ warnings: cli.warnings, network: cli.network, reasons: cli.reasons }));

    const lines = typeof QC.leakLines === 'function' ? QC.leakLines({ network: ['curl x'], pluginReads: ['p'], staleTmp: ['s'] }) : null;
    check('leakLines names the three lists',
      Array.isArray(lines) && lines.length === 3 && /^network: /.test(lines[0]) && /^plugin reads: /.test(lines[1]) && /^stale tmp reads: /.test(lines[2]) && QC.leakLines({}).length === 0,
      lines === null ? 'leakLines is not exported' : JSON.stringify(lines));
    // Printed so a suite run shows the lines a real run would print.
    if (lines) for (const l of lines) console.log('        ' + l);
  });

  console.log('');
  console.log(passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) {
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
  }
})();
