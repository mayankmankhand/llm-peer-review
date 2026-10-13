#!/usr/bin/env node
'use strict';
// Tests that the sentences several prompt files must carry word for word still
// agree (review fix R5, 2026-10-05): the disclosure line a dispatched finder may
// return (`NOT CHECKED: <one sentence>`), the eight project seam files under
// `.claude/toolkit/`, the reload-then-fallback sentence the commands share, and
// the PR parts, the kept-on-purpose key and the decisions file /merge relies on.
// Each of these lives in more than one file on purpose (an inlined fragment, a
// seed, a command that parses what another file tells a finder to emit), so an
// edit to one copy and not the others is exactly the drift this suite catches.
// Reads the source tree only. Run: node scripts/test-prompt-parity.js

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (detail ? ' - ' + String(detail).slice(0, 400) : '')); }
}
// Every markdown file under the prompt folders, as [relative path, text].
function promptFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.md')) out.push([rel, read(rel)]);
    }
  };
  for (const d of ['.claude/commands', '.claude/skills', '.claude/agents', '.claude/rules']) walk(d);
  return out;
}
const count = (text, needle) => text.split(needle).length - 1;

console.log('\n1. the NOT CHECKED line');
const format = read('.claude/skills/shared/dispatch-format.md');
const review = read('.claude/commands/review.md');
const disclosure = format.split(/\r?\n/).find(l => l.startsWith('**One optional line beside them: `NOT CHECKED: <one sentence>`.**'));
check('dispatch-format.md defines the line in one paragraph, as a disclosure with no ID, receipt or audit', !!disclosure && /it gets no ID, no receipt and no audit/.test(disclosure) && /never a `NOT CHECKED:` line; it is a finding/.test(disclosure));
check('review.md inlines dispatch-format.md whole, so the orchestrator parses the format the finder was given', /cat \.claude\/skills\/shared\/dispatch-format\.md/.test(review) && !review.includes(disclosure));
check('review.md keeps the line out of its parse-failure rule', /a `NOT CHECKED:` line beside the JSONL or `NO FINDINGS` is part of the format, not a parse failure/.test(review));
check('review.md sets each line aside for What I could not check, never as a finding', /Set each `NOT CHECKED:` line aside with its specialist's name for "What I could not check"/.test(review) && /each `NOT CHECKED:` line a specialist returned goes under the latter/.test(review));
check('report-format.md names the line among the could-not-check rows', /a `NOT CHECKED:` line a dispatched specialist returned/.test(read('.claude/skills/shared/report-format.md')));
check('the dispatch contract a finder preloads names the line as a disclosure, never a finding', /`NOT CHECKED:` lines beside them, as that format defines: a disclosure, never a finding/.test(read('.claude/skills/dispatch-contract/SKILL.md')));
const prompts = promptFiles();
const bareDisclosures = prompts.filter(([, t]) => /NOT CHECKED[^:]/.test(t.replace(/NOT CHECKED:/g, ''))).map(([f]) => f);
check('every prompt file that names the line spells it with its colon', bareDisclosures.length === 0, bareDisclosures.join(', '));

console.log('\n2. the project seam files');
const SEAMS = ['review-kinds.md', 'plan-gate.md', 'execute-gate.md', 'fix-rules.md', 'severity-anchors.md', 'do-not-report.md', 'checks.json', 'generated.json'];
const seamReadme = read('seed/toolkit-README.md');
check('the seed README lists the eight files under a heading that counts them', /## The eight files/.test(seamReadme) && SEAMS.every(s => seamReadme.includes('| `' + s + '` |')), SEAMS.filter(s => !seamReadme.includes('| `' + s + '` |')).join(', '));
const named = new Map();
for (const [file, text] of prompts) {
  for (const m of text.matchAll(/\.claude\/toolkit\/([A-Za-z-]+\.(?:md|json))/g)) {
    if (!named.has(m[1])) named.set(m[1], new Set());
    named.get(m[1]).add(file);
  }
}
const unknown = [...named.keys()].filter(n => n !== 'README.md' && !SEAMS.includes(n));
check('every seam a prompt file names is one of the eight, or the README setup seeds', unknown.length === 0, unknown.join(', '));
const unread = SEAMS.filter(s => !named.has(s));
check('each of the eight is read by at least one prompt file', unread.length === 0, unread.join(', '));
// Issue #221: the seventh seam is JSON, not prose, and its reader is the checks runner, called from the execute stage's test step.
check('checks.json is read by the runner call in execute.md, at the test step', /node \.claude\/scripts\/run-checks\.js --checks \.claude\/toolkit\/checks\.json --out/.test(read('.claude/commands/execute.md')));
const securityReaders = ['.claude/skills/review-security/SKILL.md', '.claude/skills/security-audit/SKILL.md', '.claude/skills/review-security-criteria/SKILL.md'];
check('the three security reviewers read do-not-report.md, right after the toolkit\'s own list', securityReaders.every(f => read(f).includes('.claude/toolkit/do-not-report.md')), securityReaders.filter(f => !read(f).includes('.claude/toolkit/do-not-report.md')).join(', '));
// The sentence moved from README.md to docs/EXTENDING.md on 2026-10-09, when the README became a front door and the manual moved into docs/.
check('the toolkit reference and the extending guide count the same eight files', /eight files in `\.claude\/toolkit\/`/.test(read('.claude/skills/shared/toolkit-reference.md')) && /Eight files in `\.claude\/toolkit\/`/.test(read('docs/EXTENDING.md')));
check('the extending guide lists checks.json', /^\| `checks\.json` \|/m.test(read('docs/EXTENDING.md')));
// Issue #232: the eighth seam is JSON too, read by the merge-check script through the merge rules.
check('the extending guide lists generated.json, and merge-rules.md defines it', /^\| `generated\.json` \|/m.test(read('docs/EXTENDING.md')) && read('.claude/skills/shared/merge-rules.md').includes('.claude/toolkit/generated.json'));
// Issue #231 added rule M17, so the fix-rules sentence every loop stage carries counts to M17. It is
// pinned word for word so the next rule's sweep is one grep and a drift in one file is caught here.
const FIX_RULES = 'Additive only: they may add a precondition or an always-ask action, and a line that loosens or removes any of M1 to M17 is void.';
const FIX_RULES_SITES = prompts.filter(([, text]) => /\*\*Project fix rules\*\* \(from/.test(text)).map(([file]) => file);
check('eighteen prompt files carry the project fix rules paragraph', FIX_RULES_SITES.length === 18, FIX_RULES_SITES.length + ' found');
for (const file of FIX_RULES_SITES) check(file + ' carries the fix-rules sentence word for word, once', count(read(file), FIX_RULES) === 1, count(read(file), FIX_RULES) + ' found');
// Written as a class, so this file never holds the old range as a literal a sweep would find.
const staleRule = prompts.filter(([, text]) => /M1 to M1[56]|M1-M1[56]/.test(text)).map(([file]) => file);
check('no prompt file still counts the loop rules to M15 or M16', staleRule.length === 0, staleRule.join(', '));

console.log('\n3. the reload-then-fallback sentence');
const SENTENCE = 'run `/reload-plugins` once (an agent added by a plugin install or update, or written this session, registers only after a reload)';
const SITES = [['.claude/commands/review.md', 2], ['.claude/commands/create-plan.md', 1], ['.claude/commands/index.md', 1], ['.claude/commands/execute.md', 1], ['.claude/commands/document.md', 1], ['.claude/commands/merge.md', 1], ['.claude/skills/shared/design-rules.md', 2]];
for (const [file, n] of SITES) check(file + ' carries the sentence word for word, ' + n + ' time' + (n === 1 ? '' : 's'), count(read(file), SENTENCE) === n, count(read(file), SENTENCE) + ' found');
check('model-routing.md, which every site points at, states the registration rule the sentence summarizes', /`\/reload-plugins`/.test(read('.claude/skills/shared/model-routing.md')) && /added by a plugin install or update/.test(read('.claude/skills/shared/model-routing.md')));

console.log('\n4. the merge helper sentence');
// Issue #211: every runner that combines JSONL from several workers hands the
// lines to merge-findings.js through one sentence, word for word, so the nine
// call sites cannot drift back into nine hand-written versions of the pass.
const MERGE = 'Write every finding line this run collected, the workers\' lines and any the runner authored itself, into `findings.jsonl` in a fresh folder from `mktemp -d /tmp/review-merge.XXXXXX` with the Write tool, then run `node .claude/scripts/merge-findings.js` on that file, typed as literal words: its stdout is the deduplicated, sorted, numbered set (R1 onward, no gaps) and its stderr line carries the raw and merged counts.';
const MERGE_SITES = ['.claude/commands/review.md', '.claude/skills/upgrade/SKILL.md', '.claude/skills/shared/criteria-code.md', '.claude/skills/shared/criteria-commands.md', '.claude/skills/shared/criteria-copy.md', '.claude/skills/shared/criteria-plan.md', '.claude/skills/shared/criteria-ux.md', '.claude/skills/review-full/SKILL.md', '.claude/skills/security-audit/SKILL.md'];
for (const file of MERGE_SITES) check(file + ' carries the merge sentence word for word, once', count(read(file), MERGE) === 1, count(read(file), MERGE) + ' found');
// Review 2026-10-05, R2: the one judgment the helper leaves to the runner, a
// defect reported under two keys, is stated beside the merge sentence at every
// site in the review command's words, so a direct run re-keys the same way.
const REKEY = 'Two findings that describe one defect under different keys are the one judgment this pass leaves to you: before running the helper, give the later one the earlier one\'s `key` and record the merge in the report\'s dedup notes.';
for (const file of MERGE_SITES) check(file + ' carries the re-key sentence word for word, once', count(read(file), REKEY) === 1, count(read(file), REKEY) + ' found');
const byHand = prompts.filter(([, t]) => /Assign R-IDs yourself|assigns Finding IDs after dedup|combine and renumber their findings/.test(t)).map(([f]) => f);
check('no prompt file keeps the old by-hand wording of the pass', byHand.length === 0, byHand.join(', '));
const describers = ['.claude/skills/shared/finding-id-system.md', '.claude/skills/shared/dispatch-format.md', '.claude/skills/shared/hitl-loop.md'];
check('the three fragments that describe the pass name the helper', describers.every(f => read(f).includes('merge-findings.js')), describers.filter(f => !read(f).includes('merge-findings.js')).join(', '));
check('the helper exists where the sentence points', fs.existsSync(path.join(REPO, '.claude/scripts/merge-findings.js')));

console.log('\n5. the merge parts (#232)');
// /document writes the PR body parts, merge-rules.md defines them, and /merge
// reads them back through merge-check.js; /merge writes the kept-on-purpose key
// merge-rules.md defines and merge-check.js reads; and the decisions file the
// script writes has the two headings the decision-checker agent is told to read.
const RULES = read('.claude/skills/shared/merge-rules.md');
const DOC = read('.claude/commands/document.md');
const MERGE_CMD = read('.claude/commands/merge.md');
const CHECKER = read('.claude/agents/decision-checker.md');
const MC_SRC = read('.claude/scripts/merge-check.js');
const mc = require(path.join(REPO, '.claude', 'scripts', 'merge-check.js'));
const PARTS = ['## Decisions', '## Changelog', 'Cut from:'];
for (const [file, text] of [['merge-rules.md', RULES], ['document.md', DOC]]) check(file + ' names the three PR parts', PARTS.every(p => text.includes(p)), PARTS.filter(p => !text.includes(p)).join(', '));
check('merge.md inlines merge-rules.md and host-cli.md, so it reads the parts and the host rows from their one home', MERGE_CMD.includes('!`cat .claude/skills/shared/merge-rules.md`') && MERGE_CMD.includes('!`cat .claude/skills/shared/host-cli.md`'));
const SHA = 'a'.repeat(40);
const body = 'Summary.\n\n## Decisions\n- Go right - the map says so\n\n## Changelog\n````markdown\n- Right turns.\n````\n\nCut from: ' + SHA + '\n';
const got = mc.parseBody(body);
check('merge-check.js reads back the three parts written the way merge-rules.md lays them out', got.decisions === '- Go right - the map says so' && got.changelog === '- Right turns.' && got.cutFrom === SHA, JSON.stringify(got));
const KEY = 'Kept on purpose: <short sha of the commit that added the line> <file>: <line text>';
check('merge-rules.md defines the kept-on-purpose key, and merge.md writes it into the landing message', RULES.includes(KEY) && MERGE_CMD.includes('`Kept on purpose:` line'));
const kept = mc.parseKept('Kept on purpose: abc1234 src/app.js: return \'alpha v2 (A: faster)\';');
check('merge-check.js reads a kept line in that key, file and text apart', kept.length === 1 && kept[0].sha === 'abc1234' && kept[0].file === 'src/app.js' && kept[0].text === 'return \'alpha v2 (A: faster)\';', JSON.stringify(kept));
for (const [file, text] of [['decision-checker.md', CHECKER], ['merge-rules.md', RULES], ['merge-check.js', MC_SRC]]) check(file + ' names the decisions file\'s two headings', text.includes('## This PR') && text.includes('## Landing '), file);
check('merge.md dispatches the decision-checker by name with no model, and document.md names /merge', /subagent_type=decision-checker/.test(MERGE_CMD) && /no model parameter/.test(MERGE_CMD) && DOC.includes('`/merge <N>`'));

// 8.0.0: Claude Code swaps any single pasted command output over about 30,000
// bytes for a 2 KB preview (measured 2026-10-13: 30,000 arrived whole, 30,500
// did not), so a file a command or skill pastes whole with an inline cat must
// stay under that, with margin. hitl-loop.md crossed it at 7.6.3 and the
// review commands saw only its first 2 KB until the 8.0.0 split.
const PASTE_LIMIT = 28500;
{
  const walk = (dir) => fs.readdirSync(path.join(REPO, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(dir + '/' + e.name) : e.name.endsWith('.md') ? [dir + '/' + e.name] : []);
  const pasted = new Set();
  for (const f of [...walk('.claude/commands'), ...walk('.claude/skills')]) {
    for (const m of read(f).matchAll(/!`cat ([^ `]+)[^`]*`/g)) pasted.add(m[1]);
  }
  const over = [...pasted].filter(rel => fs.existsSync(path.join(REPO, rel))).map(rel => [rel, fs.statSync(path.join(REPO, rel)).size]).filter(([, size]) => size > PASTE_LIMIT);
  check('every file a command or skill pastes whole is at most ' + PASTE_LIMIT + ' bytes (' + pasted.size + ' pasted files)', pasted.size > 10 && over.length === 0, over.map(([rel, size]) => rel + ' ' + size).join(', '));
}

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) { console.log('Failed: ' + failures.join(' | ')); process.exit(1); }
