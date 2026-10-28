#!/usr/bin/env node
'use strict';
// Tests that the sentences several prompt files must carry word for word still
// agree (review fix R5, 2026-10-05): the disclosure line a dispatched finder may
// return (`NOT CHECKED: <one sentence>`), the nine project seam files under
// `.claude/toolkit/`, the reload-then-fallback sentence the commands share, and
// the PR parts, the kept-on-purpose key and the decisions file /merge relies on,
// and the check-at-source sentence the rules seed and the manual share (#241).
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
const SEAMS = ['review-kinds.md', 'plan-gate.md', 'execute-gate.md', 'fix-rules.md', 'severity-anchors.md', 'do-not-report.md', 'checks.json', 'generated.json', 'issue-labels.md'];
const seamReadme = read('seed/toolkit-README.md');
check('the seed README lists the nine files under a heading that counts them', /## The nine files/.test(seamReadme) && SEAMS.every(s => seamReadme.includes('| `' + s + '` |')), SEAMS.filter(s => !seamReadme.includes('| `' + s + '` |')).join(', '));
const named = new Map();
for (const [file, text] of prompts) {
  for (const m of text.matchAll(/\.claude\/toolkit\/([A-Za-z-]+\.(?:md|json))/g)) {
    if (!named.has(m[1])) named.set(m[1], new Set());
    named.get(m[1]).add(file);
  }
}
// Two files in the folder are no seam: the README setup seeds, and the adoption
// record /tk:upgrade's stamp writes (issue #257).
const NOT_SEAMS = ['README.md', 'adoption.md'];
const unknown = [...named.keys()].filter(n => !NOT_SEAMS.includes(n) && !SEAMS.includes(n));
check('every seam a prompt file names is one of the nine, the README setup seeds, or the adoption record the stamp writes', unknown.length === 0, unknown.join(', '));
const unread = SEAMS.filter(s => !named.has(s));
check('each of the nine is read by at least one prompt file', unread.length === 0, unread.join(', '));
// Issue #221: the seventh seam is JSON, not prose, and its reader is the checks runner, called from the execute stage's test step.
check('checks.json is read by the runner call in execute.md, at the test step', /node \.claude\/scripts\/run-checks\.js --checks \.claude\/toolkit\/checks\.json --out/.test(read('.claude/commands/execute.md')));
const securityReaders = ['.claude/skills/review-security/SKILL.md', '.claude/skills/security-audit/SKILL.md', '.claude/skills/review-security-criteria/SKILL.md'];
check('the three security reviewers read do-not-report.md, right after the toolkit\'s own list', securityReaders.every(f => read(f).includes('.claude/toolkit/do-not-report.md')), securityReaders.filter(f => !read(f).includes('.claude/toolkit/do-not-report.md')).join(', '));
// The sentence moved from README.md to docs/EXTENDING.md on 2026-10-09, when the README became a front door and the manual moved into docs/.
check('the toolkit reference and the extending guide count the same nine files', /nine files in `\.claude\/toolkit\/`/.test(read('.claude/skills/shared/toolkit-reference.md')) && /Nine files in `\.claude\/toolkit\/`/.test(read('docs/EXTENDING.md')));
check('the extending guide lists checks.json', /^\| `checks\.json` \|/m.test(read('docs/EXTENDING.md')));
// Issue #232: the eighth seam is JSON too, read by the merge-check script through the merge rules.
check('the extending guide lists generated.json, and merge-rules.md defines it', /^\| `generated\.json` \|/m.test(read('docs/EXTENDING.md')) && read('.claude/skills/shared/merge-rules.md').includes('.claude/toolkit/generated.json'));
// Issue #268: the ninth seam replaces /create-issue's questions and labels instead of adding to them.
// Its read carries a label, because an absent file pastes Claude Code's "no output" note, and the
// command says what each host does with a label the repository lacks (GitLab creates it silently).
const createIssue = read('.claude/commands/create-issue.md');
check('create-issue reads the issue-labels seam under its label and states each host on a missing label', createIssue.includes('!`cat .claude/toolkit/issue-labels.md 2>/dev/null || true`') && createIssue.includes('(from `.claude/toolkit/issue-labels.md`)') && createIssue.includes('GitLab creates') && !createIssue.includes('makes the create command fail') && /^\| `issue-labels\.md` \|/m.test(read('docs/EXTENDING.md')));
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
// Issues #267 and #272: the re-verify round runs through merge-findings.js
// --verify, and the fix-verifier agent quotes the two sentences of M3 it
// applies, the trust order and the verifier instruction, word for word and once
// each, with none of the runner's steps (no `--mechanical` in the file), so the
// rule and the agent cannot drift apart and the agent never reads the runner's
// procedure as its own. The bullet must name the mode, so this case fails on
// the pair that predates it rather than passing on any two matching copies.
{
  const m3 = (read('.claude/skills/shared/hitl-loop.md').split('\n').find((l) => l.startsWith('- **M3.')) || '').replace(/^- /, '');
  const agent = read('.claude/agents/fix-verifier.md');
  const TRUST = 'Trust order for verification signals: a runnable check first, a different model second, a fresh same-model context last.';
  const { M3_INSTRUCTION } = require(path.join(REPO, '.claude', 'scripts', 'merge-findings.js'));
  check('the fix-verifier agent quotes the M3 trust order and the verifier instruction once each, and none of the runner steps',
    m3.length > 0 && m3.includes('merge-findings.js --verify') && m3.includes(TRUST) && m3.includes(M3_INSTRUCTION)
      && count(agent, TRUST) === 1 && count(agent, M3_INSTRUCTION) === 1 && !agent.includes('--mechanical'),
    m3.length ? 'trust order in the agent: ' + count(agent, TRUST) + ', instruction: ' + count(agent, M3_INSTRUCTION) + ', --mechanical in the agent: ' + agent.includes('--mechanical') + '; the bullet names the mode: ' + m3.includes('merge-findings.js --verify') : 'no M3 bullet found');
  // R3 of the #272 review: the 450-word bar on M3 was measured by hand when the
  // rule was trimmed (814 -> 432); this case holds it, so a rule that grows back
  // past the bar fails here instead of passing every check.
  const m3Words = m3.split(/\s+/).filter(Boolean).length;
  check('the M3 bullet stays at or under 450 words (#272)', m3Words > 0 && m3Words <= 450, m3Words + ' words');
}

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

console.log('\n6. the check-at-source sentence (#241)');
// Issue #241: one sentence in the seeded rules file's Self-Service paragraph
// says a claim with a checkable source is checked there before it is stated.
// The manual's "Check at the source" part carries it word for word, and so
// must the plugin's emitted seed, which is what a downstream project receives;
// the two stages that point to the part name it. The sentence is read from the
// rules seed rather than written here, so this suite pins its two anchor
// phrases and its agreement across files, not its exact wording.
{
  const rulesText = read('.claude/rules/toolkit.md');
  const selfService = (/^## Self-Service\r?\n\r?\n([^\r\n]+)/m.exec(rulesText) || [])[1] || '';
  const anchored = selfService.split(/(?<=\.)\s+(?=[A-Z])/).filter(s => s.includes('checkable source') && s.includes('from memory'));
  const sentence = anchored.length === 1 ? anchored[0] : '';
  check('241: the rules seed\'s Self-Service paragraph holds one sentence with "checkable source" and "from memory"', sentence !== '', anchored.length + ' found');
  const manual = read('.claude/skills/shared/toolkit-reference.md');
  const part = (/^### Check at the source\r?\n([\s\S]*?)(?=^###? |^<\/guidelines>)/m.exec(manual) || [])[1] || '';
  check('241: the manual\'s Check at the source part carries that sentence word for word, once', sentence !== '' && count(part, sentence) === 1, part ? count(part, sentence) + ' found' : 'no "### Check at the source" part');
  check('241: the manual\'s Check at the source part points the run-it shape to M16', /\bM16\b/.test(part));
  for (const file of ['.claude/commands/explore.md', '.claude/commands/execute.md']) check('241: ' + file + ' names "Check at the source"', read(file).includes('"Check at the source"'));
  const emitted = read('plugin/seed/rules-toolkit.md');
  check('241: the emitted plugin seed carries that sentence word for word, once', sentence !== '' && count(emitted, sentence) === 1, sentence ? count(emitted, sentence) + ' found' : 'no sentence in the rules seed');
  const mutatedPart = part.replace(sentence, sentence.replace(/\bchecked\b/, 'verified'));
  check('241: mutation: one changed word in the manual\'s copy trips the word-for-word check', sentence !== '' && mutatedPart !== part && count(mutatedPart, sentence) === 0);
}

// 275: the explore gate matches the three reach labels literally (REACH_LABELS
// in session-init.js), and three prompt files spell them out for the model that
// writes the summary, so a label that drifts in one place fails the chain in
// every project. Read the code's list and hold each prompt copy to it.
{
  const gate = read('.claude/scripts/session-init.js');
  const m = /const REACH_LABELS = \[([^\]]+)\];/.exec(gate);
  const labels = m ? m[1].split(',').map(s => s.trim().replace(/^"|"$/g, '')) : [];
  const EXPECTED = ['Other installs', 'Other sessions and unreleased work', 'What the user gets back'];
  check('275: session-init.js names the three reach labels M14 fixes', labels.join('|') === EXPECTED.join('|'), labels.join(' | '));
  for (const file of ['.claude/skills/shared/hitl-stages.md', '.claude/commands/explore.md', '.claude/commands/create-plan.md']) {
    const text = read(file).toLowerCase();
    const missing = labels.filter(l => !text.includes(l.toLowerCase()));
    check('275: ' + file + ' spells every reach label the gate matches', labels.length === 3 && missing.length === 0, missing.length ? 'missing: ' + missing.join(' | ') : '');
  }
}

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
// The upgrade audit's C-19 (issue #244) holds a project's own pasted files in
// .claude/toolkit/ to the same limit, so the two numbers must never drift.
{
  const limitDrift = (text) => {
    const m = /^const PASTE_LIMIT = (\d+);/m.exec(text);
    return !m ? 'no PASTE_LIMIT line in upgrade-audit.js' : Number(m[1]) !== PASTE_LIMIT ? 'upgrade-audit.js has ' + m[1] + ', this guard ' + PASTE_LIMIT : '';
  };
  const auditText = read('.claude/scripts/upgrade-audit.js');
  check('paste limit: upgrade-audit.js uses the same limit as this guard', limitDrift(auditText) === '', limitDrift(auditText));
  const mutated = auditText.replace(/^const PASTE_LIMIT = \d+;/m, 'const PASTE_LIMIT = ' + (PASTE_LIMIT + 1) + ';');
  check('paste limit: mutation: a different number in upgrade-audit.js trips the check', mutated !== auditText && limitDrift(mutated) !== '', limitDrift(mutated));
}

// --- the cycle page's time section (issue #248, review R6) ----------------------
// /document pastes two scripts' outputs into timeBreakdown under two keys it
// names in prose, and the shell reads them by name. Nothing else ties the two,
// so a rename on either side would leave the section silently empty. The keys
// are read from document.md's own sentence and looked up in the shell.
{
  const SHELL = read('.claude/skills/shared/shells/document-shell.html');
  const keysDrift = (doc, shell) => {
    const m = /set `timeBreakdown` to `\{"(\w+)": <the first JSON>, "(\w+)": <the second JSON>\}`/.exec(doc);
    if (!m) return 'document.md no longer names the two timeBreakdown keys in its usual sentence';
    const missing = [m[1], m[2]].filter((k) => !new RegExp('\\btb\\.' + k + '\\b').test(shell));
    return missing.length ? 'document-shell.html does not read ' + missing.map((k) => 'tb.' + k).join(' or ') : '';
  };
  check('time section: the two keys document.md writes are the keys document-shell.html reads', keysDrift(DOC, SHELL) === '', keysDrift(DOC, SHELL));
  const renamedShell = SHELL.replace(/tb\.testCost/g, 'tb.testRuns');
  const renamedDoc = DOC.replace('"testCost": <the second JSON>', '"cost": <the second JSON>');
  check('time section: mutation: a key renamed on either side trips the check',
    keysDrift(DOC, renamedShell) !== '' && keysDrift(renamedDoc, SHELL) !== '', keysDrift(DOC, renamedShell) + ' | ' + keysDrift(renamedDoc, SHELL));
}

// --- /cloud: typed only, never a launch Claude can start (issue #263) ----------
// The skill hands a self-contained brief to a Claude Code cloud session. Claude
// Code refuses to start one from Claude's own shell ("interactive only"), so the
// skill writes a start.sh beside the brief and the user runs it from a terminal.
// These cases pin what keeps that safe: the skill never loads on its own, no
// copy of it pre-approves a command that could start a session (the plugin build
// adds a grant for every toolkit script a skill runs, and allowed-tools grants
// whatever it lists), the start line puts the task text right after --cloud
// (which takes it as its own value), both briefs carry the rules that keep a
// cloud copy from pushing anything, and the plugin carries the briefs where its
// skill reads them. Missing files read as empty, so they fail here, not crash.
{
  const optional = (rel) => (fs.existsSync(path.join(REPO, rel)) ? read(rel) : '');
  const SRC = optional('.claude/skills/cloud/SKILL.md');
  const PLUG = optional('plugin/skills/cloud/SKILL.md');
  const BRIEFS = ['research-brief.md', 'review-brief.md'];
  const frontmatter = (text) => (/^---\r?\n([\s\S]*?)\r?\n---/.exec(text) || [])[1] || '';
  const typedOnly = (text) => /^disable-model-invocation:\s*true\s*$/m.test(frontmatter(text));
  // allowed-tools entries, in the inline form and the YAML list form.
  const grants = (text) => {
    const lines = frontmatter(text).split(/\r?\n/);
    const at = lines.findIndex((l) => /^allowed-tools:/.test(l));
    if (at < 0) return [];
    const out = lines[at].replace(/^allowed-tools:\s*/, '').split(/,\s*/).filter(Boolean);
    for (let i = at + 1; i < lines.length && /^\s+- /.test(lines[i]); i++) out.push(lines[i].replace(/^\s+- /, '').trim());
    return out;
  };
  // The one node grant allowed is the skill's own unpack script, which only
  // reads a saved page and writes files; it cannot start a session.
  const unpackGrant = /^"?Bash\(node \S*skills\/cloud\/unpack\.js \*\)"?$/;
  // A known-safe set, not a ban list, so a new grant (`Bash(env *)`, `Bash(npx *)`)
  // fails here until someone checks it cannot start a session: the file tools,
  // six read-only git commands, the unpack script, and the plugin's mktemp row.
  const SAFE = [/^Read$/, /^Write$/, /^Bash\(git (ls-files|rev-parse|merge-base|check-ignore|rev-list|status) \*\)$/, unpackGrant, /^"?Bash\(mktemp -d \/tmp\/\*\)"?$/];
  const launchers = (text) => grants(text).filter((g) => !SAFE.some((re) => re.test(g)));

  check('263: the cloud skill never fires on its own (disable-model-invocation: true), in the source and the plugin', typedOnly(SRC) && typedOnly(PLUG),
    (SRC ? '' : 'no .claude/skills/cloud/SKILL.md; ') + (PLUG ? '' : 'no plugin/skills/cloud/SKILL.md'));
  check('263: no copy of the cloud skill pre-approves a command that could start a cloud session', SRC !== '' && PLUG !== '' && launchers(SRC).length === 0 && launchers(PLUG).length === 0,
    [...launchers(SRC), ...launchers(PLUG)].join(', '));
  const startLine = /CCR_FORCE_BUNDLE=1 exec claude [^\n]*--cloud "\$\(cat [^)\n]*brief\.md\)"/.exec(SRC);
  check('263: the start script the skill writes puts the task text right after --cloud', !!startLine && !/--cloud\s+-/.test(startLine[0]), startLine ? startLine[0] : 'no CCR_FORCE_BUNDLE=1 exec claude ... --cloud "$(cat ...brief.md)" line');
  check('263: the skill tells the user to run its one start line and never runs it itself', /`bash [^`\s]*start\.sh`/.test(SRC) && SRC.includes('Never run `start.sh` or `claude --cloud` yourself'));
  // The plugin copy must still ask git about the project's own file: the build
  // keeps that phrase (a SITE_OVERRIDES entry) instead of rewriting it to the
  // plugin's folder, where git ls-files would never find it.
  const repoCheck = '`git ls-files .claude/commands/review.md`';
  check('263: review mode runs only where the toolkit lives in the repo, and names why elsewhere, in the source and the plugin',
    [SRC, PLUG].every((t) => t.includes(repoCheck) && t.includes('cloud sessions never load plugins')));
  for (const brief of BRIEFS) {
    const text = optional('.claude/skills/cloud/' + brief);
    const rules = ['Never commit, push, create a branch or open a pull request.', 'Never call `add_repo`', 'Make no change git would commit', '/tmp', '`git status --porcelain`', 'The summary comes first', '<script type="text/markdown" id="report-markdown">', '<script type="text/plain" class="run-file" data-name="'];
    const missing = rules.filter((r) => !text.includes(r));
    check('263: ' + brief + ' carries the no-push rules, the summary-first shape, the report block and the run-file blocks', text !== '' && missing.length === 0, text ? 'missing: ' + missing.join(' | ') : 'no .claude/skills/cloud/' + brief);
  }
  // Everything a run produced comes back (owner, 2026-10-18), and a file name
  // read off the page is another session's data, so it must not leave files/.
  // A review range need not be on the branch the cloud session starts on, so
  // the review must read the files the range ends at (found in the Verify step).
  check('263: review-brief.md checks out the range\'s last commit before the review reads any file',
    optional('.claude/skills/cloud/review-brief.md').includes('git checkout --detach <the commit id after the two dots in {{RANGE}}>'));
  // Found in the Verify step: the cloud session stops at a prompt before it
  // publishes, and a page with every run file is too big to pass through the
  // chat, so the skill warns about the prompt and unpacks the page on disk.
  check('263: the walk-through warns that the session asks once to publish its page',
    SRC.includes('the session asks once for permission to publish its page to claude.ai'));
  check('263: the plugin carries unpack.js and its skill runs and grants it from the plugin',
    fs.existsSync(path.join(REPO, 'plugin/skills/cloud/unpack.js')) && PLUG.includes('node ${CLAUDE_PLUGIN_ROOT}/skills/cloud/unpack.js --page')
      && grants(PLUG).some((g) => unpackGrant.test(g) && g.includes('${CLAUDE_PLUGIN_ROOT}')));
  check('263: the skill saves every run file under files/ and keeps each name inside it',
    SRC.includes('class="run-file"') && SRC.includes('so no name can reach outside `files/`'));
  const plugBriefs = BRIEFS.filter((b) => fs.existsSync(path.join(REPO, 'plugin/skills/cloud', b)) && PLUG.includes('${CLAUDE_PLUGIN_ROOT}/skills/cloud/' + b));
  check('263: the plugin carries both briefs and its skill reads them from the plugin', plugBriefs.length === BRIEFS.length, 'found ' + plugBriefs.join(', '));
  const untyped = SRC.replace(/^disable-model-invocation:.*\r?\n/m, '');
  check('263: mutation: the skill without disable-model-invocation trips the first case', SRC !== '' && untyped !== SRC && !typedOnly(untyped));
  // The upload carries unpushed work on purpose, so before the start line the
  // walk-through says how much of it GitHub does not have, and what a session
  // that broke the no-push rule would expose (review of 46bf362..2d1061a, R2).
  check('263: the walk-through counts the commits and edits GitHub does not have and warns before the start line',
    SRC.includes('`git rev-list --count HEAD --not --remotes`') && SRC.includes('`git status --porcelain --untracked-files=no`')
      && SRC.includes('GitHub does not have yet') && SRC.indexOf('GitHub does not have yet') < SRC.indexOf('Paste this one line'));
  const widened = SRC.replace(/^allowed-tools:\r?\n/m, (m) => m + '  - Bash(env *)\n');
  check('263: mutation: a new grant outside the known-safe set trips the no-launch case', widened !== SRC && launchers(widened).join() === 'Bash(env *)', launchers(widened).join(', '));
}

console.log('\n7. the rules a review loads by name (#261)');
// Twelve files run the loop and used to paste its rules at the top of every
// run. They now load them through three skills at the point the rules are
// first needed, and all twelve say so in one sentence, so a skipped load is
// the one failure this change adds and a drifted sentence is what this
// section catches. The page rules load only when the gate fires, and the gate
// itself stays inline so the decision never waits on a fragment loaded after it.
const LOOP_FILES = [
  '.claude/commands/review.md',
  '.claude/skills/review-browser/SKILL.md', '.claude/skills/review-code/SKILL.md',
  '.claude/skills/review-commands/SKILL.md', '.claude/skills/review-copy/SKILL.md',
  '.claude/skills/review-deps/SKILL.md', '.claude/skills/review-plan/SKILL.md',
  '.claude/skills/review-security/SKILL.md', '.claude/skills/review-ux/SKILL.md',
  '.claude/skills/review-full/SKILL.md', '.claude/skills/security-audit/SKILL.md',
  '.claude/skills/upgrade/SKILL.md',
];
const PAGE_FILES = LOOP_FILES.filter(f => !f.includes('/upgrade/'));
const LOAD_LINE = '**Load the loop rules and the report rules now**, through the Skill tool: `Skill(loop-rules)`, then `Skill(report-rules)`. Everything from here on cites them, so do not go on without both in context.';
const GATE_LINE = '**The gate:** render the review page whenever this run has any surviving finding, or this branch\'s standing page already exists (`node .claude/scripts/render-html.js --standing --name review` prints `"exists":true`; M16), so the run can carry it forward or take it to empty. Skip only when there are no findings and no page yet.';
const PAGE_LINE = '**When the gate fires, load the page rules now**, through the Skill tool: `Skill(review-page)`, and render per them: the shell, the payload, the `--no-abs` decision and how the page reaches the user all live there.';
const LOOP_FRAGMENTS = ['hitl-loop.md', 'hitl-stages.md', 'report-format.md', 'finding-contract.md', 'html-outputs.md'];
const PAGE_FRAGMENTS = ['html-render-review.md', 'html-viewing.md'];
const pasteOf = (name) => '!`cat .claude/skills/shared/' + name + '`';
// Where the load sentence must sit: after the heading that opens the phase
// that first needs the rules, before the next heading. A sentence that counts
// once but drifted below its phase would load the rules too late (review #261).
const loadSpan = (rel) => rel.endsWith('/review.md') ? ['### Phase 2: Dispatch', '### Phase 3']
  : rel.includes('/upgrade/') ? ['## Procedure', '<procedure>'] : ['## Audit Before the Report', '## Output Format'];
// The paste-era wordings the twelve files used for a fragment they no longer
// hold: a position ("inlined under", "inlined below", "inlined at the end",
// "inlined in Phase 2"), "the inlined template" or "are inlined for". Pastes that remain (the
// criteria, the dispatch format) may still be described as inlined.
const STALE_PASTE = /\binlined (below|under|here|at the end|in Phase \d)\b|\bthe inlined\b|\b(is|are) inlined (for|below|under|at the end)\b/i;
{
  const misses = [];
  for (const rel of LOOP_FILES) {
    const text = read(rel);
    if (count(text, LOAD_LINE) !== 1) misses.push(rel + ': load sentence x' + count(text, LOAD_LINE));
    const [opens, closes] = loadSpan(rel);
    const at = text.indexOf(LOAD_LINE), from = text.indexOf(opens), to = text.indexOf(closes, from + 1);
    if (at >= 0 && !(from >= 0 && to > from && at > from && at < to)) misses.push(rel + ': load sentence outside ' + opens + ' .. ' + closes);
    for (const n of LOOP_FRAGMENTS) if (text.includes(pasteOf(n))) misses.push(rel + ' still pastes ' + n);
    const stale = text.split(/\r?\n/).filter(l => STALE_PASTE.test(l)).length;
    if (stale) misses.push(rel + ': ' + stale + ' line(s) still say a fragment is inlined');
  }
  check('the 12 loop files load loop-rules and report-rules before Phase 3 with one wording and paste none of their five fragments', misses.length === 0, misses.join('; '));
}
{
  const misses = [];
  for (const rel of PAGE_FILES) {
    const text = read(rel);
    if (count(text, GATE_LINE) !== 1) misses.push(rel + ': gate sentence x' + count(text, GATE_LINE));
    if (count(text, PAGE_LINE) !== 1) misses.push(rel + ': page load sentence x' + count(text, PAGE_LINE));
    for (const n of PAGE_FRAGMENTS) if (text.includes(pasteOf(n))) misses.push(rel + ' still pastes ' + n);
  }
  const upgrade = read('.claude/skills/upgrade/SKILL.md');
  if (upgrade.includes('Skill(review-page)')) misses.push('upgrade loads review-page, which renders no review page');
  for (const n of PAGE_FRAGMENTS) if (upgrade.includes(pasteOf(n))) misses.push('upgrade pastes ' + n);
  check('the 11 page files load review-page at the gate with one wording and paste neither of its fragments', misses.length === 0, misses.join('; '));
}

console.log('\n8. the writing rules (#276, #280)');
// The dash rule (Rule 6) lives in six files, each in its own form, and Rule 8
// ("Everyday words") in the rules seed and the manual. Nothing pinned either
// before, so one reworded copy could drift from the rest unseen. The dash
// anchors and Rule 8's sixteen everyday names are literals here, never read
// from the files under test, so a rule that loses a name fails this case.
{
  const DASH_FILES = ['.claude/rules/toolkit.md', '.claude/skills/shared/toolkit-reference.md', '.claude/skills/setup/SKILL.md',
    '.claude/skills/upgrade/SKILL.md', '.claude/skills/cloud/review-brief.md', '.claude/skills/cloud/research-brief.md'];
  const DASH_KEEP = ['no spaced hyphen standing in for one', 'Quoted, dictated or locked text is never changed, even for a dash'];
  const DASH_GONE = ['Use regular hyphens', 'use a hyphen or rewrite'];
  const dashMisses = [];
  for (const rel of DASH_FILES) {
    const text = read(rel);
    for (const s of DASH_KEEP) if (!text.includes(s)) dashMisses.push(rel + ' lacks "' + s + '"');
    for (const s of DASH_GONE) if (text.includes(s)) dashMisses.push(rel + ' still says "' + s + '"');
  }
  check('276: the dash rule\'s six copies forbid a spaced hyphen as a dash and keep quoted text', dashMisses.length === 0, dashMisses.join('; '));

  // A numbered rule's whole line in a rules block, found by its number and bold label.
  const ruleLine = (text, n, label) => text.split(/\r?\n/).find(l => l.startsWith(n + '. **' + label + '**')) || '';
  const EVERYDAY = ['a reviewer', 'a double-check', 'a separate check of the fix', 'a question for you', 'the review summary', 'the proof',
    'the log', 'the check before', 'moving on by itself', 'the starter copy', 'the practice project', 'the test rig', 'review type',
    'a side copy of the project', 'a saved checkpoint', 'undo'];
  const rulesText = read('.claude/rules/toolkit.md');
  const rule6 = ruleLine(rulesText, 6, 'No em dashes or en dashes');
  const rule8 = ruleLine(rulesText, 8, 'Everyday words');
  const rule8Missing = [...EVERYDAY, 'the receipt row or the step\'s file list', 'Skill(writing)'].filter(s => !rule8.includes(s));
  check('276: Rule 8 in the rules seed names the sixteen everyday words', rule8 !== '' && rule8Missing.length === 0,
    rule8 ? 'missing: ' + rule8Missing.join(' | ') : 'no "8. **Everyday words**" line in .claude/rules/toolkit.md');
  const rule8Words = rule8.split(/\s+/).filter(Boolean).length;
  check('276: Rule 8 stays at or under 220 words', rule8Words > 0 && rule8Words <= 220, rule8Words + ' words');

  // The manual restates the rules block, so its two lines must match the seed's.
  const manualText = read('.claude/skills/shared/toolkit-reference.md');
  const sameRules = (manual) => rule6 !== '' && rule8 !== ''
    && ruleLine(manual, 6, 'No em dashes or en dashes') === rule6 && ruleLine(manual, 8, 'Everyday words') === rule8;
  check('276: the manual\'s Rule 6 and Rule 8 match the rules seed word for word', sameRules(manualText),
    'Rule 6 ' + (rule6 !== '' && ruleLine(manualText, 6, 'No em dashes or en dashes') === rule6 ? 'matches' : 'differs')
      + ', Rule 8 ' + (rule8 !== '' && ruleLine(manualText, 8, 'Everyday words') === rule8 ? 'matches' : 'differs'));
  // A project receives the plugin's emitted seed, where the build scopes the load to the plugin.
  const emitted8 = ruleLine(read('plugin/seed/rules-toolkit.md'), 8, 'Everyday words');
  check('276: the emitted plugin seed carries Rule 8 with Skill(tk:writing)',
    rule8 !== '' && emitted8 === rule8.replace('Skill(writing)', 'Skill(tk:writing)') && !emitted8.includes('Skill(writing)'),
    emitted8 ? emitted8.slice(0, 160) : 'no Rule 8 line in plugin/seed/rules-toolkit.md');
  const mutatedManual = rule8 === '' ? manualText : manualText.replace(rule8, rule8.replace(/\bproof\b/, 'receipt'));
  check('276: mutation: one changed word in the manual\'s Rule 8 trips the word-for-word check', mutatedManual !== manualText && !sameRules(mutatedManual));

  // The plain block opens the exploration summary and the plan. The M14 shape
  // and the two stages that write it spell out its heading and five labels, so
  // a label renamed in one of the three places fails here.
  const PLAIN = ['## In plain words', '**The problem:**', '**The goal and how we will know:**', '**The cost:**', '**What is left out:**', '**What changes for you:**'];
  const plainMisses = [];
  for (const rel of ['.claude/skills/shared/hitl-stages.md', '.claude/commands/explore.md', '.claude/commands/create-plan.md']) {
    const text = read(rel);
    for (const s of PLAIN) if (!text.includes(s)) plainMisses.push(rel + ' lacks ' + s);
  }
  check('276: the In plain words heading and its five labels sit in hitl-stages.md, explore.md and create-plan.md', plainMisses.length === 0, plainMisses.join('; '));
}

// #281: the lessons rules the owner approved stay in /document, and the trim
// guide keeps its nine steps in order under its heading, so a rewrite that drops
// one fails here (review of #281, R6).
{
  const LESSONS_RULES = [
    'skip the read when its full text is still visible earlier in this conversation',
    'as the rule only, a bold lead of about 120 bytes with nothing after it',
    'add a dated incident line to that lesson\'s write-up instead of a new index line',
    'when a write-up records its third incident, offer the owner to turn the rule into a check',
    'A lead you shorten is renamed in both files',
    'in the order under "Trimming the index"',
    'after the edits, run `--lessons` again',
  ];
  check('281: document.md keeps the lessons rules the owner approved', LESSONS_RULES.every(s => DOC.includes(s)), LESSONS_RULES.filter(s => !DOC.includes(s)).join(' | '));
  const REF = read('.claude/skills/shared/toolkit-reference.md');
  const STEPS = ['0. **Strip what holds no lesson.**', '1. **Not this project\'s lesson.**', '2. **Write-ups in the index.**', '3. **Already said in an always-read file.**',
    '4. **Superseded or contradicted.**', '5. **Enforced by a check.**', '6. **Repeats and families.**', '7. **Long leads.**', '8. **One-offs.**'];
  const head = REF.indexOf('#### Trimming the index');
  const at = STEPS.map(s => REF.indexOf(s));
  check('281: the trim guide holds its nine steps, 0 to 8, in order under its heading', head > -1 && at.every((p, i) => p > head && (i === 0 || p > at[i - 1])), JSON.stringify({ head, at }));
}

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');

if (failures.length) { console.log('Failed: ' + failures.join(' | ')); process.exit(1); }
