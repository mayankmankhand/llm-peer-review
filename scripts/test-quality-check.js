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
const FIXTURE = path.resolve(__dirname, 'fixtures', 'quality-check');
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
// o.plans: { name: text } left in the scratch project's plans/ folder.
function makeReviewRun(o) {
  const dir = tmp('qc-test-run-');
  const home = '/tmp/qc-run.TEST/home';
  const project = '/tmp/qc-run.TEST/project';
  const models = { main: OPUS, finder: OPUS, judge: OPUS, ...(o.models || {}) };
  const caughtIds = o.caught || [];
  const killed = o.killed || [];
  const raised = o.raised || [...caughtIds, ...killed];
  const sid = 'sess-' + Math.random().toString(36).slice(2, 8);
  const slugDir = path.join(dir, 'transcripts', '-tmp-qc-run-TEST-project');
  const mainRecords = [];
  const toolUses = [];
  const kinds = o.lenses || QC.FINDER_KINDS;
  kinds.forEach((kind, i) => {
    const toolId = 'toolu_finder_' + i;
    toolUses.push({ type: 'tool_use', id: toolId, name: 'Agent', input: { subagent_type: 'tk:review-' + kind + '-finder', description: kind, prompt: '...' } });
    let out = raised.filter(id => KIND_OF[id] === kind).map(id => FINDS[id]()).join('\n') || 'NO FINDINGS';
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
  for (const t of o.mainTexts || []) mainRecords.push({ type: 'assistant', message: { model: models.main, role: 'assistant', content: [{ type: 'text', text: t }] } });
  mainRecords.push({ type: 'assistant', message: { model: models.main, role: 'assistant', content: toolUses.concat(o.mainTools || []) } });
  mainRecords.push({ type: 'user', message: { role: 'user', content: o.mainToolResults || [] } });
  if (o.synthetic) mainRecords.push({ type: 'assistant', message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: o.synthetic }] } });
  write(path.join(slugDir, sid + '.jsonl'), mainRecords.map(r => JSON.stringify(r)).join('\n') + '\n');
  // The report: survivors, then the Audited out log.
  let n = 0;
  const lines = ['# Review', '', 'Verdict: changes-requested - see below', '', '### Findings', ''];
  for (const id of caughtIds) lines.push(reportLine(++n, id), '  - **Fix:** One line. Ten minutes, or leave it.', '');
  lines.push('### Audited out', '');
  for (const id of killed) lines.push('- **R' + (++n) + '** [' + KIND_OF[id] + '] `REFUTED` - ' + JSON.parse(FINDS[id]()).what + ' (skeptic: not reachable)');
  if (killed.length === 0) lines.push('Audited out: none - all findings survived the audit.');
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
    { type: 'tool_use', id: 'o1', name: 'Read', input: { file_path: '/home/someone/Projects/llm-peer-review/scripts/fixtures/quality-check/answers.json' } },
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

section('fixture', () => {
  const dest = tmp('qc-test-fixture-');
  QC.copyFixture(path.join(FIXTURE, 'base'), dest);
  QC.copyFixture(path.join(FIXTURE, 'change'), dest);
  check('renames: dot-claude and dot-gitignore become dot folders, .fixture is dropped', fs.existsSync(path.join(dest, '.claude', 'commands', 'reset-notes.md')) && fs.existsSync(path.join(dest, '.gitignore')) && fs.existsSync(path.join(dest, 'package.json')) && fs.existsSync(path.join(dest, 'package-lock.json')));
  for (const b of ANSWERS.bugs) {
    for (const [file, start, end] of b.lines) {
      const abs = path.join(dest, file);
      const n = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').split('\n').length : 0;
      check('answer key ' + b.id + ': ' + file + ' exists and holds lines ' + start + '-' + end, n >= end && start >= 1, 'lines in file: ' + n);
    }
  }
  // Inert in this repo: nothing the repo's own tooling would pick up by name.
  const stored = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else stored.push(path.relative(FIXTURE, p)); } })(FIXTURE);
  const live = stored.filter(p => /(^|\/)(package\.json|package-lock\.json|CLAUDE\.md|\.gitignore)$/.test(p) || /(^|\/)\.claude\//.test(p));
  check('the stored fixture carries no live package, lockfile, CLAUDE.md, .gitignore or .claude folder', live.length === 0, live.join(', '));
  // Neutral: no file the finders read says what was planted (LESSONS, #204).
  const telling = stored.filter(p => /^(base|change)\//.test(p)).filter(p => /\b(planted|answer key|deliberate(ly)? (bug|broken)|known[- ]answer|quality[- ]check|test fixture)\b/i.test(fs.readFileSync(path.join(FIXTURE, p), 'utf8')));
  check('no fixture file names what was planted', telling.length === 0, telling.join(', '));
});

section('model modes', () => {
  const file = model => '---\nname: x\ntools: Read\n' + (model ? 'model: ' + model + '\n' : '') + 'effort: high\n---\nbody\n';
  check('modeFamily: best is the session family whatever the file says', QC.modeFamily('best', file('sonnet'), 'opus') === 'opus');
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

  // A probe's verdict: dispatches first, then the checks.
  const pv = QC.probeVerdict({ valid: true, models: { byType: { 'tk:index-mapper': ['claude-sonnet-5-5'] } }, checks: [{ name: 'mode line', ok: true, detail: 'Models: cheap' }] }, { probe: 'index-mode', expect: { byType: { 'tk:index-mapper': 'sonnet' } } });
  check('probeVerdict: the mapper on Sonnet with the mode line passes', pv.ok, pv.why);
  const pf = QC.probeVerdict({ valid: true, models: { byType: { 'tk:index-mapper': ['claude-sonnet-5-5'] } }, checks: [{ name: 'mode line', ok: false, detail: 'no line' }] }, { probe: 'index-mode', expect: { byType: { 'tk:index-mapper': 'sonnet' } } });
  check('probeVerdict: a failed check fails the probe', !pf.ok && /mode line/.test(pf.why), pf.why);
  const pn = QC.probeVerdict({ valid: true, models: { byType: {} }, checks: [] }, { probe: 'review-code-mode', expect: { byType: { 'tk:review-code-finder': 'sonnet' } } });
  check('probeVerdict: no fan-out fails the probe', !pn.ok && /not dispatched/.test(pn.why), pn.why);

  // Flags that would start a session refuse before anything runs.
  const badArm = spawnSync('node', [SCRIPT, '--role', 'review', '--arm', 'z', '--build', 'HEAD'], { encoding: 'utf8' });
  check('an unknown arm is a usage error that names ship', badArm.status === 2 && /a, b, c or ship/.test(badArm.stderr), badArm.stderr);
  const badMode = spawnSync('node', [SCRIPT, '--role', 'review', '--arm', 'ship', '--build', 'HEAD', '--mode-word', 'fast'], { encoding: 'utf8' });
  check('an unknown mode is a usage error', badMode.status === 2 && /best, fit or cheap/.test(badMode.stderr), badMode.stderr);
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

console.log('');
console.log(passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
