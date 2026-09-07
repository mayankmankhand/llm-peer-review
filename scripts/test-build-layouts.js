#!/usr/bin/env node
'use strict';
//
// test-build-layouts.js - assertions for .claude/scripts/build-layouts.js and
// its per-tool emitters under .claude/scripts/layouts/ (issue #144).
//
// Maintainer-only: lives under scripts/, which the installers never propagate.
// Follows the repo's dependency-free test convention (test-pre-push-check.js,
// test-correction-ledger.js): assert, print, exit non-zero on any failure.
//
// Every run builds into a throwaway copy of this repo's .claude/ under the OS
// temp directory, so nothing here touches the real generated files.
//
// Usage: node scripts/test-build-layouts.js

const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..');
// The single-tool tests build and check with the SAME tool list: --check with no
// --tools reads .claude/.toolkit-tools.json, which names every tool, and would
// rightly report the other tools' files as missing.
const TOOLS_ONE = 'codex';
let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' :: ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' :: ' + detail : '')); }
}
function sha(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function read(root, rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function exists(root, rel) { return fs.existsSync(path.join(root, rel)); }

// A sandbox is a copy of .claude/ plus CLAUDE.md; the build reads nothing else.
function makeSandbox(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-layouts-' + label + '-'));
  // Filter on the path RELATIVE to .claude/: this repo may itself live under a
  // directory named worktrees, and an absolute-path test would copy nothing.
  const srcRoot = path.join(REPO, '.claude');
  fs.cpSync(srcRoot, path.join(root, '.claude'), {
    recursive: true,
    filter: src => { const parts = path.relative(srcRoot, src).split(path.sep); return !parts.includes('worktrees') && !parts.includes('node_modules'); },
  });
  for (const stale of ['.claude/.toolkit-generated.json']) if (exists(root, stale)) fs.unlinkSync(path.join(root, stale));
  if (fs.existsSync(path.join(REPO, 'CLAUDE.md'))) fs.copyFileSync(path.join(REPO, 'CLAUDE.md'), path.join(root, 'CLAUDE.md'));
  return root;
}
function build(root, args) {
  const r = spawnSync(process.execPath, [path.join(root, '.claude/scripts/build-layouts.js'), '--root', root].concat(args || []), { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
function walk(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
function generatedFiles(root) {
  return ['.agents', '.codex', '.cursor'].flatMap(d => walk(path.join(root, d))).concat(exists(root, 'AGENTS.md') ? [path.join(root, 'AGENTS.md')] : []).sort();
}
function cleanup(root) { fs.rmSync(root, { recursive: true, force: true }); }

// --- 1. determinism and the record ------------------------------------------
function determinismTests() {
  console.log('\n1. two builds from the same source are byte-identical');
  const a = makeSandbox('det-a'), b = makeSandbox('det-b');
  try {
    const ra = build(a, ['--tools', 'codex,cursor,antigravity']);
    const rb = build(b, ['--tools', 'codex,cursor,antigravity']);
    check('the build exits 0', ra.status === 0 && rb.status === 0, ra.stderr.slice(0, 200));
    const fa = generatedFiles(a).map(p => path.relative(a, p));
    const fb = generatedFiles(b).map(p => path.relative(b, p));
    check('both sandboxes produce the same file list', JSON.stringify(fa) === JSON.stringify(fb), fa.length + ' vs ' + fb.length);
    const same = fa.every(rel => sha(path.join(a, rel)) === sha(path.join(b, rel)));
    check('every generated file is byte-identical across sandboxes', same);
    check('the record is byte-identical too', read(a, '.claude/.toolkit-generated.json') === read(b, '.claude/.toolkit-generated.json'));
    const again = build(a, []);
    check('a rebuild over an unchanged source writes nothing', /: 0 written/.test(again.stdout), again.stdout.trim());
    check('--check passes right after a build', build(a, ['--check']).status === 0);
    const rec = JSON.parse(read(a, '.claude/.toolkit-generated.json'));
    check('the record names all three tools', JSON.stringify(rec.tools) === JSON.stringify(['antigravity', 'codex', 'cursor']));
    check('the record covers every generated file', Object.keys(rec.files).length === fa.length, Object.keys(rec.files).length + ' vs ' + fa.length);
  } catch (e) { check('determinism test ran', false, e.message); }
  cleanup(a); cleanup(b);
}

// --- 2. --check catches stale and hand-edited output ---------------------------
function checkTests() {
  console.log('\n2. --check names a stale file and a hand-edited file');
  const sb = makeSandbox('check');
  try {
    build(sb, ['--tools', 'codex']);
    const skill = '.agents/skills/review-code/SKILL.md';
    fs.appendFileSync(path.join(sb, skill), 'tampered\n');
    let r = build(sb, ['--tools', TOOLS_ONE, '--check']);
    check('a hand edit fails --check', r.status === 1);
    check('the hand edit is named as hand-edited', r.stderr.indexOf('hand-edited') !== -1 && r.stderr.indexOf(skill) !== -1, r.stderr.slice(0, 300));
    r = build(sb, ['--tools', TOOLS_ONE]);
    check('the build refuses to overwrite the hand edit', r.status === 1 && r.stderr.indexOf('refusing') !== -1, r.stderr.slice(0, 200));
    r = build(sb, ['--tools', TOOLS_ONE, '--force']);
    check('--force replaces it after a backup', r.status === 0 && fs.readdirSync(sb).some(n => n.startsWith('.toolkit-backup-')), r.stderr.slice(0, 200));
    // a real source change makes the output stale rather than hand-edited
    const src = path.join(sb, '.claude/skills/review-code/SKILL.md');
    fs.writeFileSync(src, fs.readFileSync(src, 'utf8').replace('Code quality review', 'Code quality review (changed)'));
    r = build(sb, ['--tools', TOOLS_ONE, '--check']);
    check('a source change fails --check as stale', r.status === 1 && r.stderr.indexOf('stale') !== -1, r.stderr.slice(0, 300));
    r = build(sb, ['--tools', TOOLS_ONE]);
    check('the rebuild writes the stale file', r.status === 0 && /: 1 written/.test(r.stdout), r.stdout.trim());
  } catch (e) { check('check test ran', false, e.message); }
  cleanup(sb);
}

// --- 3. the inliner ------------------------------------------------------------
function inlinerTests() {
  console.log('\n3. whole-line tokens inline the two loop-critical fragments and point at the rest');
  const sb = makeSandbox('inline');
  try {
    build(sb, ['--tools', 'codex']);
    const doc = read(sb, '.agents/skills/review-code/SKILL.md');
    check('hitl-loop.md is inlined', doc.indexOf('<!-- inlined from .claude/skills/shared/hitl-loop.md -->') !== -1);
    check('severity-anchors.md is inlined', doc.indexOf('<!-- inlined from .claude/skills/shared/severity-anchors.md -->') !== -1);
    check('output-template.md becomes a pointer', /^> Read `\.claude\/skills\/shared\/output-template\.md` now/m.test(doc));
    check('no injection token survives as a whole line', !/^!`cat /m.test(doc));
    // a token mentioned mid-sentence is prose, not a directive
    const src = path.join(sb, '.claude/commands/worktree.md');
    fs.appendFileSync(src, '\nThe form !`cat .claude/skills/shared/hitl-loop.md` is how Claude Code inlines a fragment.\n');
    build(sb, ['--tools', TOOLS_ONE]);
    const wt = read(sb, '.agents/skills/worktree/SKILL.md');
    check('a token inside prose is left alone', wt.indexOf('The form !`cat .claude/skills/shared/hitl-loop.md` is how') !== -1 && wt.indexOf('<!-- inlined from') === -1);
  } catch (e) { check('inliner test ran', false, e.message); }
  cleanup(sb);
}

// --- 4. AGENTS.md marker merge -------------------------------------------------
function agentsMdTests() {
  console.log('\n4. AGENTS.md merges between markers and keeps the user text');
  const sb = makeSandbox('agents');
  try {
    fs.writeFileSync(path.join(sb, 'AGENTS.md'), '# Mine\n\nKeep this line.\n');
    build(sb, ['--tools', 'codex']);
    let md = read(sb, 'AGENTS.md');
    check('the user text survives above the block', md.startsWith('# Mine\n\nKeep this line.'));
    check('the block is present once', md.split('<!-- toolkit:start -->').length === 2 && md.split('<!-- toolkit:end -->').length === 2);
    check('--check passes with user text around the block', build(sb, ['--tools', TOOLS_ONE, '--check']).status === 0);
    fs.writeFileSync(path.join(sb, 'AGENTS.md'), md + '\nMore of mine after the block.\n');
    check('user text added outside the block is not a hand edit', build(sb, ['--tools', TOOLS_ONE, '--check']).status === 0);
    fs.writeFileSync(path.join(sb, 'AGENTS.md'), read(sb, 'AGENTS.md').replace('# Toolkit rules (digest)', '# Toolkit rules (edited)'));
    check('an edit inside the block is a hand edit', build(sb, ['--tools', TOOLS_ONE, '--check']).status === 1);
    build(sb, ['--tools', TOOLS_ONE, '--force']);
    fs.appendFileSync(path.join(sb, 'AGENTS.md'), '\n' + 'x'.repeat(33 * 1024) + '\n');
    const r = build(sb, ['--tools', TOOLS_ONE, '--check']);
    check('a file over 32 KiB draws the Codex cap warning', r.stderr.indexOf('over 32768 bytes') !== -1, r.stderr.slice(0, 200));
    const clean = build(sb, ['--clean', 'codex']);
    check('--clean of the last tool removes the block and keeps the user text', clean.status === 0 && read(sb, 'AGENTS.md').indexOf('toolkit:start') === -1 && read(sb, 'AGENTS.md').indexOf('Keep this line.') !== -1);
  } catch (e) { check('AGENTS.md test ran', false, e.message); }
  cleanup(sb);
}

// --- 5. one permission entry, four grammars ---------------------------------------
function permissionTests() {
  console.log('\n5. one permission entry is translated into every grammar');
  const sb = makeSandbox('perm');
  try {
    build(sb, ['--tools', 'codex,cursor,antigravity']);
    const rules = read(sb, '.codex/rules/toolkit.rules');
    check('Codex: a prefix_rule for render-html.js', /prefix_rule\(pattern=\["node", "\.claude\/scripts\/render-html\.js"\]/.test(rules));
    check('Codex: codex review is allow-listed (Codex-only entry)', /\["codex", "review"\]/.test(rules));
    const cursor = JSON.parse(read(sb, '.cursor/permissions.toolkit.json'));
    check('Cursor: terminalAllowlist carries the prefix', Array.isArray(cursor.terminalAllowlist) && cursor.terminalAllowlist.indexOf('node .claude/scripts/render-html.js') !== -1);
    check('Cursor: the Codex-only entry is absent', cursor.terminalAllowlist.indexOf('codex review') === -1);
    const agy = JSON.parse(read(sb, '.agents/settings.toolkit.json'));
    check('Antigravity: command(prefix) carries the prefix', agy.permissions.allow.indexOf('command(node .claude/scripts/render-html.js)') !== -1);
    check('Antigravity: a write_file rule with the workspace placeholder', agy.permissions.allow.some(x => /^write_file\(.*__WORKSPACE__/.test(x)));
    const p = spawnSync(process.execPath, [path.join(sb, '.claude/scripts/build-layouts.js'), '--root', sb, '--claude-settings', '--print'], { encoding: 'utf8' });
    const cc = JSON.parse(p.stdout);
    check('Claude Code: Bash(prefix *) plus the exact form for a script', cc.permissions.allow.indexOf('Bash(node .claude/scripts/render-html.js *)') !== -1 && cc.permissions.allow.indexOf('Bash(node .claude/scripts/render-html.js)') !== -1);
    check('Claude Code: the piped browse.js form passes through', cc.permissions.allow.indexOf('Bash(cat * | node .claude/scripts/browse.js *)') !== -1);
    check('no translation carries an absolute path', !/\/home\/|\/Users\/|[A-Z]:\\/.test(rules + JSON.stringify(cursor) + JSON.stringify(agy) + p.stdout));
  } catch (e) { check('permission test ran', false, e.message); }
  cleanup(sb);
}

// --- 6. skills: aliases, exclusions, the never-chained flag ----------------------
function skillTests() {
  console.log('\n6. Cursor aliases, project-context, and the never-chained skills');
  const sb = makeSandbox('skills');
  try {
    build(sb, ['--tools', 'codex,cursor,antigravity']);
    const cursorSkills = fs.readdirSync(path.join(sb, '.cursor/skills')).sort();
    check('Cursor carries exactly the two aliases', JSON.stringify(cursorSkills) === JSON.stringify(['tk-review', 'tk-review-security']), cursorSkills.join(','));
    check('the alias is named tk-review in its frontmatter', /^name: tk-review$/m.test(read(sb, '.cursor/skills/tk-review/SKILL.md')));
    check('project-context is never emitted', !exists(sb, '.agents/skills/project-context'));
    for (const n of ['ask-gpt', 'ask-gemini', 'peer-review']) {
      const doc = read(sb, '.agents/skills/' + n + '/SKILL.md');
      check(n + ' carries disable-model-invocation', /^disable-model-invocation: true$/m.test(doc));
      check(n + ' has its openai.yaml with implicit invocation off', exists(sb, '.agents/skills/' + n + '/agents/openai.yaml') && /allow_implicit_invocation:\s*false/.test(read(sb, '.agents/skills/' + n + '/agents/openai.yaml')));
    }
    check('an ordinary skill has no openai.yaml', !exists(sb, '.agents/skills/review-code/agents/openai.yaml'));
    const shared = read(sb, '.agents/skills/review/SKILL.md');
    check('a shared skill carries all three host-note sections', (shared.match(/^### On /mg) || []).length === 3);
    check('the alias carries only the Cursor section', (read(sb, '.cursor/skills/tk-review/SKILL.md').match(/^### On /mg) || []).length === 1);
    const agents = JSON.parse(JSON.stringify(fs.readdirSync(path.join(sb, '.codex/agents')).sort()));
    check('Codex has four agent files and no model key', agents.length === 4 && agents.every(f => !/^model\s*=/m.test(read(sb, '.codex/agents/' + f))));
    check('Antigravity agents never list a never-chained skill', fs.readdirSync(path.join(sb, '.agents/agents')).every(f => !/ask-gpt|ask-gemini|peer-review/.test(read(sb, '.agents/agents/' + f))));
  } catch (e) { check('skill test ran', false, e.message); }
  cleanup(sb);
}

// --- 7. chain-hook.js fires once ---------------------------------------------------
function chainHookTests() {
  console.log('\n7. chain-hook.js fires once per handoff');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-hook-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const hook = path.join(REPO, '.claude/scripts/chain-hook.js');
    const run = (args, input) => spawnSync(process.execPath, [hook].concat(args), { cwd: root, encoding: 'utf8', input: input || '' });
    check('--set records a pending handoff', run(['--set', '/review', '--from', 'execute']).status === 0 && /"pending"/.test(run(['--status']).stdout));
    const first = run(['--tool', 'cursor'], '{"status":"completed","loop_count":0}');
    check('the first stop fires the follow-up', /followup_message/.test(first.stdout) && /\/review/.test(first.stdout), first.stdout);
    const second = run(['--tool', 'cursor'], '{"status":"completed","loop_count":1}');
    check('the second stop is silent', second.stdout.trim() === '{}', second.stdout);
    run(['--set', '/document']);
    check('Codex gets decision block', /"decision":"block"/.test(run(['--tool', 'codex'], '{}').stdout));
    run(['--set', '/document']);
    check('Antigravity gets decision continue', /"decision":"continue"/.test(run(['--tool', 'antigravity'], '{}').stdout));
    run(['--set', 'none']);
    check('"no chaining" stays silent', run(['--tool', 'cursor'], '{}').stdout.trim() === '{}');
    check('a force push is denied by the shell guard', /"permission":"deny"/.test(run(['--tool', 'cursor', '--guard-shell'], '{"command":"git push --force-with-lease origin main"}').stdout));
    check('an ordinary push is allowed', /"permission":"allow"/.test(run(['--tool', 'cursor', '--guard-shell'], '{"command":"git push origin main"}').stdout));
  } catch (e) { check('chain-hook test ran', false, e.message); }
  cleanup(root);
}

// --- 8. the generated Cursor paths are not ignored ---------------------------------
function gitignoreTests() {
  console.log('\n8. a generated Cursor path is not ignored by this repo\'s .gitignore');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ignore-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    fs.copyFileSync(path.join(REPO, '.gitignore'), path.join(root, '.gitignore'));
    const probe = rel => spawnSync('git', ['-C', root, 'check-ignore', '-q', rel]).status === 0;
    for (const rel of ['.cursor/hooks.json', '.cursor/skills/tk-review/SKILL.md', '.cursor/agents/review-finder.md', '.cursor/rules/toolkit.mdc', '.cursor/permissions.toolkit.json']) {
      check(rel + ' is not ignored', !probe(rel));
    }
    for (const rel of ['.cursor/mcp.json', '.cursor/plans/p.md', '.cursor/rules/mine.mdc', '.claude/settings.local.json']) {
      check(rel + ' stays ignored', probe(rel));
    }
  } catch (e) { check('gitignore test ran', false, e.message); }
  cleanup(root);
}

// --- run --------------------------------------------------------------------
determinismTests();
checkTests();
inlinerTests();
agentsMdTests();
permissionTests();
skillTests();
chainHookTests();
gitignoreTests();

console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach(f => console.log('  - ' + f));
console.log('');
process.exit(1);
