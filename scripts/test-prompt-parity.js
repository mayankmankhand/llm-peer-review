#!/usr/bin/env node
'use strict';
// Tests that the sentences several prompt files must carry word for word still
// agree (review fix R5, 2026-10-05): the disclosure line a dispatched finder may
// return (`NOT CHECKED: <one sentence>`), the six project seam files under
// `.claude/toolkit/`, and the reload-then-fallback sentence the commands share.
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
const SEAMS = ['review-kinds.md', 'plan-gate.md', 'execute-gate.md', 'fix-rules.md', 'severity-anchors.md', 'do-not-report.md'];
const seamReadme = read('seed/toolkit-README.md');
check('the seed README lists the six files under a heading that counts them', /## The six files/.test(seamReadme) && SEAMS.every(s => seamReadme.includes('| `' + s + '` |')), SEAMS.filter(s => !seamReadme.includes('| `' + s + '` |')).join(', '));
const named = new Map();
for (const [file, text] of prompts) {
  for (const m of text.matchAll(/\.claude\/toolkit\/([A-Za-z-]+\.md)/g)) {
    if (!named.has(m[1])) named.set(m[1], new Set());
    named.get(m[1]).add(file);
  }
}
const unknown = [...named.keys()].filter(n => n !== 'README.md' && !SEAMS.includes(n));
check('every seam a prompt file names is one of the six, or the README setup seeds', unknown.length === 0, unknown.join(', '));
const unread = SEAMS.filter(s => !named.has(s));
check('each of the six is read by at least one prompt file', unread.length === 0, unread.join(', '));
const securityReaders = ['.claude/skills/review-security/SKILL.md', '.claude/skills/security-audit/SKILL.md', '.claude/skills/review-security-criteria/SKILL.md'];
check('the three security reviewers read do-not-report.md, right after the toolkit\'s own list', securityReaders.every(f => read(f).includes('.claude/toolkit/do-not-report.md')), securityReaders.filter(f => !read(f).includes('.claude/toolkit/do-not-report.md')).join(', '));
check('the toolkit reference and the README count the same six files', /six files in `\.claude\/toolkit\/`/.test(read('.claude/skills/shared/toolkit-reference.md')) && /Six files in `\.claude\/toolkit\/`/.test(read('README.md')));

console.log('\n3. the reload-then-fallback sentence');
const SENTENCE = 'run `/reload-plugins` once (an agent added by a plugin install or update, or written this session, registers only after a reload)';
const SITES = [['.claude/commands/review.md', 2], ['.claude/commands/create-plan.md', 1], ['.claude/commands/index.md', 1], ['.claude/commands/execute.md', 1], ['.claude/skills/shared/design-rules.md', 1]];
for (const [file, n] of SITES) check(file + ' carries the sentence word for word, ' + n + ' time' + (n === 1 ? '' : 's'), count(read(file), SENTENCE) === n, count(read(file), SENTENCE) + ' found');
check('model-routing.md, which every site points at, states the registration rule the sentence summarizes', /`\/reload-plugins`/.test(read('.claude/skills/shared/model-routing.md')) && /added by a plugin install or update/.test(read('.claude/skills/shared/model-routing.md')));

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) { console.log('Failed: ' + failures.join(' | ')); process.exit(1); }
