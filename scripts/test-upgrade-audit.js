#!/usr/bin/env node
'use strict';
// test-upgrade-audit.js - assertions for .claude/scripts/upgrade-audit.js
// (issue #167, Step 6). A fixture conventions file and a fixture project
// shaped like the real downstream cases seen on 2026-09-12: a command that
// pastes criteria into a review-finder dispatch, an inline-cat of a toolkit
// skill, a script called by path, an untyped dispatch, a custom agent, a
// locally modified toolkit script recorded by the migration, dead permission
// entries, a stale seed stamp, and a clean custom rule that must yield nothing.
//
//   node scripts/test-upgrade-audit.js

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '..', '.claude', 'scripts', 'upgrade-audit.js');
let passed = 0; const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (detail ? ' - ' + String(detail).slice(0, 300) : '')); }
}
function write(root, rel, content) { const a = path.join(root, rel); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, content); }

const CONVENTIONS = `# Toolkit Conventions

### C-1: Refer to toolkit pieces by name, never by path
- **Since:** 7.0.0
- **Scope:** prompt-files+claude-md
- **Detector:** regex
- **Looks behind:** \`\\.claude/(commands|agents|skills|scripts)/\`
- **Fix:** use the scoped name (tk:<name>) or the stable script path

### C-2: A dispatch names a typed agent
- **Since:** 7.0.0
- **Scope:** prompt-files
- **Detector:** regex
- **Looks behind:** \`subagent_type=(tk:)?review-finder\\b\`
- **Fix:** dispatch tk:review-<kind>-finder

### C-3: Criteria reach a worker by preload, not by paste
- **Since:** 7.0.0
- **Scope:** prompt-files
- **Detector:** regex
- **Looks behind:** \`PASTE THE SKILL'S REVIEW CRITERIA\`
- **Fix:** preload a criteria skill on the agent

### C-4: Seeded files carry the current stamp
- **Since:** 7.0.0
- **Scope:** seed-stamp
- **Detector:** seed-stamp
- **Fix:** rerun /tk:setup or update the stamp

### C-5: Toolkit scripts are upstream-only
- **Since:** 7.0.0
- **Scope:** local-edits
- **Detector:** local-edits
- **Fix:** file the change upstream

### C-6: Permissions point at the plugin, not at removed scripts
- **Since:** 7.0.0
- **Scope:** settings-local
- **Detector:** dead-permissions
- **Fix:** remove the entries

### C-7: A future convention
- **Since:** 8.0.0
- **Scope:** prompt-files
- **Detector:** regex
- **Looks behind:** \`Ours\`
- **Fix:** none yet

### C-8: Finders and judges carry no edit tools
- **Since:** 7.0.0
- **Scope:** agents
- **Detector:** agent-tools
- **Fix:** declare tools: Read, Grep, Glob

### C-0: An old convention
- **Since:** 6.0.0
- **Scope:** prompt-files
- **Detector:** regex
- **Looks behind:** \`Ours\`
- **Fix:** already applied everywhere
`;

const plugin = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-plugin-'));
write(plugin, '.claude-plugin/plugin.json', JSON.stringify({ name: 'tk', version: '7.0.0' }));
write(plugin, 'skills/shared/conventions.md', CONVENTIONS);
write(plugin, 'scripts/render-html.js', 'plugin copy\n');

const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-proj-'));
write(proj, '.claude/commands/myteam-presend.md', [
  '# Presend', '',
  'Dispatch `subagent_type=review-finder` with this prompt:', '',
  '[PASTE THE SKILL\'S REVIEW CRITERIA here]', '',
  '!`cat .claude/skills/project-context/SKILL.md`', '',
  'Then run `node .claude/scripts/browse.js` and open with `bash .claude/scripts/open-artifact.sh`.', '',
].join('\n'));
write(proj, '.claude/commands/myteam-research.md', '# Research\n\nDispatch `subagent_type=myteam-researcher`. Ours.\n');
write(proj, '.claude/agents/myteam-researcher.md', '---\nname: myteam-researcher\n---\nOurs.\n');
write(proj, '.claude/agents/myteam-reviewer.md', '---\nname: myteam-reviewer\ndescription: Reviews our bank pages\ntools:\n  - Read\n  - Edit\n---\nOurs.\n');
write(proj, '.claude/agents/myteam-judge.md', '---\nname: myteam-judge\ndescription: Judges a plan\n---\nOurs.\n');
write(proj, '.claude/agents/myteam-scout.md', '---\nname: myteam-scout\ndescription: Read-only scout\ntools: Read, Grep\n---\nOurs.\n');
write(proj, '.claude/rules/bank-safety.md', '# Bank safety\n\nNever edit a number. Ours.\n');
write(proj, '.claude/rules/toolkit.md', '# Toolkit Rules\n\n<!-- Toolkit version: 6.3.3 | Managed by LLM Peer Review. -->\n');
write(proj, 'CLAUDE.md', '# Project\n\nSee `.claude/skills/shared/hitl-loop.md` for the loop.\n');
write(proj, '.claude/settings.local.json', JSON.stringify({ permissions: { allow: ['Bash(git add *)', 'Bash(node .claude/scripts/render-html.js *)', 'Bash(cat * | node /abs/p/.claude/scripts/browse.js *)'] } }));
write(proj, '.claude/.toolkit-state.json', JSON.stringify({ version: '6.3.3', path: 'copy-migrated' }));
write(proj, '.claude/.toolkit-migration.json', JSON.stringify({ from: '6.3.3', to: '7.0.0', modified: [{ rel: '.claude/scripts/render-html.js', backup: '.toolkit-backup-x-plugin/.claude/scripts/render-html.js', pluginCopy: 'scripts/render-html.js' }] }));
write(proj, '.toolkit-backup-x-plugin/.claude/scripts/render-html.js', 'plugin copy\n// my fix\n');

function audit(args) {
  const r = spawnSync('node', [SCRIPT, '--project', proj, '--plugin-root', plugin, ...(args || [])], { encoding: 'utf8' });
  const findings = (r.stdout || '').split('\n').filter(Boolean).map(l => JSON.parse(l));
  return { status: r.status, findings, summary: r.stderr || '' };
}

console.log('\n1. detectors over the downstream-shaped fixture');
let r = audit();
check('exit 0 with findings on stdout and a summary on stderr', r.status === 0 && r.findings.length > 0 && /candidate finding/.test(r.summary), r.summary);
const by = (id) => r.findings.filter(f => f.id === id);
check('C-1 flags the inline-cat of a toolkit skill', by('C-1').some(f => f.file.relPath === '.claude/commands/myteam-presend.md' && /project-context/.test(f.receipt.expect)));
check('C-1 flags a script called by path', by('C-1').some(f => /browse\.js/.test(f.receipt.expect)));
check('C-1 reaches CLAUDE.md', by('C-1').some(f => f.file.relPath === 'CLAUDE.md'));
check('C-1 never flags the seeded rules file', !by('C-1').some(f => f.file.relPath === '.claude/rules/toolkit.md'));
check('C-2 flags the untyped review-finder dispatch', by('C-2').length === 1 && by('C-2')[0].file.line === 3);
check('C-2 does not flag a project agent dispatch', !by('C-2').some(f => f.file.relPath === '.claude/commands/myteam-research.md'));
check('C-3 flags pasted criteria', by('C-3').length === 1 && /PASTE/.test(by('C-3')[0].receipt.check));
check('C-4 flags the stale seed stamp', by('C-4').length === 1 && /6\.3\.3/.test(by('C-4')[0].what) && /7\.0\.0/.test(by('C-4')[0].what));
check('C-5 carries the local edit with a diff receipt', by('C-5').length === 1 && /^diff /.test(by('C-5')[0].receipt.check) && by('C-5')[0].fields.some(x => x.label === 'Your copy'));
check('C-8 flags a reviewer agent that grants Edit, at its tools line', by('C-8').some(f => f.file.relPath === '.claude/agents/myteam-reviewer.md' && f.file.line === 4 && /Edit/.test(f.what)));
check('C-8 flags a judge agent with no tools line', by('C-8').some(f => f.file.relPath === '.claude/agents/myteam-judge.md' && f.file.line === 1 && /no tools list/.test(f.what)));
check('C-8 leaves a read-only scout and a non-role agent alone', !by('C-8').some(f => /scout|researcher/.test(f.file.relPath)));
check('C-6 lists the dead permission entries', by('C-6').length === 1 && by('C-6')[0].fields[0].value.includes('render-html.js') && by('C-6')[0].fields[0].value.includes('browse.js') && !by('C-6')[0].fields[0].value.includes('git add'));
check('the clean custom rule yields nothing', !r.findings.some(f => f.file.relPath === '.claude/rules/bank-safety.md'));
check('every finding has a receipt with a check and an expectation', r.findings.every(f => f.receipt && f.receipt.check && f.receipt.expect));
check('every finding opens with its severity phrase', r.findings.every(f => /^(Should fix\.|Optional\.|Blocks\.)/.test(f.what)));

console.log('\n2. version range');
check('a convention since 8.0.0 is out of range for a 7.0.0 plugin', by('C-7').length === 0);
check('a convention since 6.0.0 is out of range when installed is 6.3.3', by('C-0').length === 0);
check('the summary names the conventions in range', /\[C-1, C-2, C-3, C-4, C-5, C-6, C-8\]/.test(r.summary), r.summary);
r = audit(['--from', '5.0.0']);
check('--from widens the range to include the 6.0.0 convention', by('C-0').length > 0);
write(proj, '.claude/.toolkit-state.json', JSON.stringify({ version: '7.0.0', path: 'copy-migrated', previousVersion: '6.3.3' }));
r = audit();
check('right after a migration the range starts at the copy-install version, not at the plugin version', /6\.3\.3 -> 7\.0\.0/.test(r.summary) && by('C-1').length > 0, r.summary);
const st = spawnSync('node', [SCRIPT, '--project', proj, '--plugin-root', plugin, '--stamp'], { encoding: 'utf8' });
const stamped = JSON.parse(fs.readFileSync(path.join(proj, '.claude', '.toolkit-state.json'), 'utf8'));
check('--stamp records the audited version and keeps the rest of the state', st.status === 0 && stamped.auditedVersion === '7.0.0' && stamped.version === '7.0.0' && stamped.previousVersion === '6.3.3' && stamped.path === 'copy-migrated' && /stamped/.test(st.stderr), st.stderr);
r = audit();
check('after the stamp the range is empty', /7\.0\.0 -> 7\.0\.0/.test(r.summary) && r.findings.length === 0, r.summary);
fs.rmSync(path.join(proj, '.claude', '.toolkit-state.json'));
r = audit();
check('with no state file every convention up to the plugin version applies', by('C-0').length > 0 && by('C-7').length === 0 && /start -> 7\.0\.0/.test(r.summary), r.summary);

console.log('\n3. errors');
const bad = spawnSync('node', [SCRIPT, '--project', proj, '--plugin-root', plugin, '--conventions', '/nonexistent.md'], { encoding: 'utf8' });
check('a missing conventions file exits 1', bad.status === 1 && /not found/.test(bad.stderr));

fs.rmSync(plugin, { recursive: true, force: true }); fs.rmSync(proj, { recursive: true, force: true });
console.log('');
if (!failures.length) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1);
