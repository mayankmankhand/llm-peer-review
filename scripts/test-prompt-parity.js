#!/usr/bin/env node
'use strict';
// Tests that the sentences several prompt files must carry word for word still
// agree (review fix R5, 2026-10-05): the disclosure line a dispatched finder may
// return (`NOT CHECKED: <one sentence>`), the eight project seam files under
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
// Two files in the folder are no seam: the README setup seeds, and the adoption
// record /tk:upgrade's stamp writes (issue #257).
const NOT_SEAMS = ['README.md', 'adoption.md'];
const unknown = [...named.keys()].filter(n => !NOT_SEAMS.includes(n) && !SEAMS.includes(n));
check('every seam a prompt file names is one of the eight, the README setup seeds, or the adoption record the stamp writes', unknown.length === 0, unknown.join(', '));
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
  const launchers = (text) => grants(text).filter((g) => !unpackGrant.test(g) && (g === 'Bash' || /^"?Bash\((\*|claude|node|bash|sh |CCR_FORCE_BUNDLE|exec)/.test(g)));

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
}

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) { console.log('Failed: ' + failures.join(' | ')); process.exit(1); }
