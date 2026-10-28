#!/usr/bin/env node
'use strict';
//
// test-folder-guard.js - assertions for .claude/scripts/folder-guard.js, the
// folder guard (issue #282): a Claude Code PreToolUse and Stop hook that stops
// a call, or the end of a turn, while Claude's shell sits in a folder other
// than the project's, so a stray `cd` no longer sends the next command, helper
// launch or skill to the wrong place.
//
// Maintainer-only: lives under scripts/, which never ships.
//
// The "decision" cases call decide() on a hook input alone, against scratch
// folders and scratch git repositories; the "hook" cases run the guard the way
// Claude Code runs it: a separate node process with the hook's JSON on stdin
// and CLAUDE_PROJECT_DIR set.
//
// The guard is loaded inside a try, so a missing or broken guard fails each
// case by name instead of crashing the suite. Failure details stay on one
// line: the release gate shows only the last lines of a failing suite.
//
// Usage: node scripts/test-folder-guard.js

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GUARD = path.join(ROOT, '.claude', 'scripts', 'folder-guard.js');

// Hermetic git, as in test-push-guard.js: no global or system config reaches a
// scratch repo or the guard's own git call.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

let passed = 0;
const failures = [];
function oneLine(s) { return String(s).replace(/\s+/g, ' ').trim().slice(0, 240); }
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok    ' + name); return; }
  const d = detail === undefined ? '' : ' - ' + oneLine(detail);
  failures.push(name + d);
  console.log('  FAIL  ' + name + d);
}

let guard = null;
let loadError = null;
try { guard = require(GUARD); } catch (e) { loadError = e; }

// Every decision any case got, for the never-allow case.
const decisions = [];
// decide() on one input; { result } or { error } when it threw or did not load.
function judge(input, env, deps) {
  if (!guard) return { error: 'folder-guard.js did not load: ' + (loadError && loadError.message) };
  try { const d = guard.decide(input, env, deps); decisions.push(d); return { result: d }; } catch (e) { return { error: e.message }; }
}
const shown = (r) => (r.error ? r.error : JSON.stringify(r.result));
const silent = (r) => !r.error && r.result === null;
const denied = (r) => !r.error && r.result !== null && typeof r.result === 'object' && r.result.decision === 'deny';

// Scratch folders: the project (a git repository with one commit and a
// worktree inside it, as /worktree and /merge make them), a subfolder of it,
// a folder outside it, another repository, a folder whose name has a space,
// and a symlink to the project.
const SCRATCH = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'folder-guard-')));
const git = (cwd, args) => spawnSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false'].concat(args), { cwd: cwd, encoding: 'utf8' });
const PROJECT = path.join(SCRATCH, 'project');
const SUB = path.join(PROJECT, 'sub');
const OUTSIDE = path.join(SCRATCH, 'outside');
const OTHER_REPO = path.join(SCRATCH, 'other-repo');
const SPACED = path.join(SCRATCH, 'with space');
const LINK = path.join(SCRATCH, 'link-to-project');
const WORKTREE = path.join(PROJECT, '.claude', 'worktrees', 'wt-1');
for (const d of [PROJECT, SUB, OUTSIDE, OTHER_REPO, SPACED]) fs.mkdirSync(d, { recursive: true });
git(PROJECT, ['init', '-q']);
fs.writeFileSync(path.join(PROJECT, 'README.md'), 'scratch project\n');
git(PROJECT, ['add', '-A']); git(PROJECT, ['commit', '-q', '-m', 'start']);
git(PROJECT, ['worktree', 'add', '-q', '-b', 'wt-1', WORKTREE]);
const WORKTREE_SUB = path.join(WORKTREE, 'src');
fs.mkdirSync(WORKTREE_SUB, { recursive: true });
git(OTHER_REPO, ['init', '-q']);
fs.symlinkSync(PROJECT, LINK);
const ENV = { CLAUDE_PROJECT_DIR: PROJECT };

// The inputs Claude Code sends: PreToolUse for one call, Stop at a turn's end.
function call(tool, cwd, toolInput, extra) {
  return Object.assign({ session_id: 'test', transcript_path: '/dev/null', cwd: cwd, permission_mode: 'default', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput || {}, tool_use_id: 'toolu_test' }, extra || {});
}
const bash = (command, cwd, extra) => call('Bash', cwd, { command: command, description: 'test' }, extra);
const stop = (cwd, active) => ({ session_id: 'test', transcript_path: '/dev/null', cwd: cwd, permission_mode: 'default', hook_event_name: 'Stop', stop_hook_active: active });

console.log('\n1. the decision');
{
  const r = judge(bash('ls', PROJECT), ENV);
  check('282: silent at the project root', silent(r), shown(r));
}
{
  const a = judge(bash('ls', OTHER_REPO), ENV);
  const b = judge(bash('git status', WORKTREE), ENV);
  check('282: silent at the top folder of a scratch git repository and of a scratch worktree', silent(a) && silent(b), shown(a) + ' | ' + shown(b));
}
{
  const r = judge(bash('ls', SUB), ENV);
  check('282: a Bash call from a subfolder is denied with the step back named',
    denied(r) && r.result.reason.includes(SUB) && r.result.reason.includes('cd ' + PROJECT), shown(r));
}
{
  const a = judge(bash('ls', OUTSIDE), ENV);
  const b = judge(bash('ls', WORKTREE_SUB), ENV);
  check('282: a call from outside the project, or from a folder inside a worktree, is denied', denied(a) && denied(b), shown(a) + ' | ' + shown(b));
}
{
  const r = judge(bash('cd ' + PROJECT, SUB), ENV);
  check('282: a lone cd to the project root is silent', silent(r), shown(r));
}
{
  const a = judge(bash('cd ' + OUTSIDE + ' && ls', SUB), ENV);
  const b = judge(bash('cd ' + PROJECT + ' && node x.js > out.txt', SUB), ENV);
  check('282: a command that starts with cd to an absolute path and && is silent, even when the reader refuses what follows',
    silent(a) && silent(b), shown(a) + ' | ' + shown(b));
}
{
  const a = judge(bash('cd .. && ls', SUB), ENV);
  const b = judge(bash('cd ' + PROJECT + '; ls', SUB), ENV);
  const c = judge(bash('cd ' + PROJECT + ' || ls', SUB), ENV);
  const d = judge(bash('cd ' + PROJECT + '\nls', SUB), ENV);
  check('282: cd to a relative path, or an absolute cd followed by ; or || or a new line, is denied',
    denied(a) && denied(b) && denied(c) && denied(d), [a, b, c, d].map(shown).join(' | '));
}
{
  const a = judge(bash('cd "' + SPACED + '" && ls', SUB), ENV);
  const b = judge(bash("cd '" + SPACED + "'", SUB), ENV);
  check('282: a quoted absolute path reads as one word', silent(a) && silent(b), shown(a) + ' | ' + shown(b));
}
{
  const got = {
    Agent: judge(call('Agent', SUB, { subagent_type: 'review-code-finder', prompt: 'p' }), ENV),
    Task: judge(call('Task', SUB, { subagent_type: 'general-purpose', prompt: 'p' }), ENV),
    Skill: judge(call('Skill', SUB, { skill: 'writing' }), ENV),
    Grep: judge(call('Grep', SUB, { pattern: 'x' }), ENV),
    Glob: judge(call('Glob', SUB, { pattern: '*.js' }), ENV),
  };
  check('282: an Agent, Task, Skill, Grep or Glob call away from the root is denied',
    Object.keys(got).every((k) => denied(got[k])) && /helper/.test((got.Agent.result || {}).reason) && /skill/.test((got.Skill.result || {}).reason) && /search/.test((got.Grep.result || {}).reason),
    Object.keys(got).map((k) => k + ': ' + shown(got[k])).join(' | '));
}
{
  const a = judge(call('Read', SUB, { file_path: path.join(PROJECT, 'README.md') }), ENV);
  const b = judge(call('Edit', SUB, { file_path: path.join(PROJECT, 'README.md') }), ENV);
  check('282: a Read or Edit call away from the root is silent, since it names its own file', silent(a) && silent(b), shown(a) + ' | ' + shown(b));
}
{
  const agentFields = { agent_id: 'a1b2c3', agent_type: 'review-code-finder' };
  const a = judge(bash('pwd', PROJECT, agentFields), ENV);
  const b = judge(bash('pwd', WORKTREE, agentFields), ENV);
  const c = judge(bash('pwd', PROJECT), ENV);
  const d = judge(call('Agent', PROJECT, { subagent_type: 'review-code-finder', prompt: 'p' }), ENV);
  check('282: a helper agent\'s call from the root or a worktree\'s top folder is silent, with or without the agent fields in the input',
    silent(a) && silent(b) && silent(c) && silent(d), [a, b, c, d].map(shown).join(' | '));
}
{
  const a = judge(stop(SUB, false), ENV);
  const b = judge(stop(SUB, true), ENV);
  const c = judge(stop(PROJECT, false), ENV);
  check('282: a Stop away from the root blocks, and is silent when stop_hook_active is true',
    !a.error && a.result !== null && a.result.decision === 'block' && a.result.reason.includes('cd ' + PROJECT) && silent(b) && silent(c),
    [a, b, c].map(shown).join(' | '));
}
{
  const a = judge(bash('ls', PROJECT), { CLAUDE_PROJECT_DIR: LINK });
  const b = judge(bash('ls', LINK), ENV);
  check('282: a symlinked root compares by real path', silent(a) && silent(b), shown(a) + ' | ' + shown(b));
}
{
  const win = { platform: 'win32', isWorkingCopyTop: () => false, realpath: (p) => p };
  const env = { CLAUDE_PROJECT_DIR: 'C:\\Users\\Me\\Proj' };
  const a = judge(bash('dir', 'c:/users/me/proj'), env, win);
  const b = judge(bash('dir', 'C:\\Users\\Me\\Proj\\sub'), env, win);
  const c = judge(bash("cd 'C:\\Users\\Me\\Proj'", 'C:\\Users\\Me\\Proj\\sub'), env, win);
  check('282: Windows-style paths compare case-blind', silent(a) && denied(b) && silent(c), [a, b, c].map(shown).join(' | '));
}
{
  const a = judge(bash('ls', SUB), {});
  const b = judge({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }, ENV);
  const c = judge(null, ENV);
  const d = judge('not a call', ENV);
  check('282: a missing CLAUDE_PROJECT_DIR, a missing cwd or unreadable input stays silent',
    silent(a) && silent(b) && silent(c) && silent(d), [a, b, c, d].map(shown).join(' | '));
}

console.log('\n2. the hook, run the way Claude Code runs it');
const outputs = [];
function runHook(input) {
  const r = spawnSync(process.execPath, [GUARD], { cwd: SCRATCH, input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: Object.assign({}, process.env, ENV), timeout: 60000 });
  const got = { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json: null };
  if (got.stdout.trim() !== '') { try { got.json = JSON.parse(got.stdout); } catch (e) { got.json = 'not-json'; } }
  outputs.push(got);
  return got;
}
const showHook = (got) => 'exit ' + got.status + ': ' + (got.stdout || got.stderr || '(nothing)');
{
  const got = runHook(bash('ls', PROJECT));
  check('282: the hook prints nothing at the project root', got.status === 0 && got.stdout.trim() === '', showHook(got));
}
{
  const got = runHook(bash('ls', SUB));
  const h = (got.json && got.json.hookSpecificOutput) || {};
  check('282: the hook prints one PreToolUse deny object from a subfolder',
    got.status === 0 && h.hookEventName === 'PreToolUse' && h.permissionDecision === 'deny' && String(h.permissionDecisionReason).includes(SUB), showHook(got));
}
{
  const got = runHook(stop(SUB, false));
  check('282: the hook prints one Stop block object at the end of a turn in a subfolder',
    got.status === 0 && got.json && got.json.decision === 'block' && String(got.json.reason).includes('cd ' + PROJECT), showHook(got));
}
{
  const got = runHook('not json at all');
  check('282: the hook exits 0 with nothing printed on garbage input', got.status === 0 && got.stdout.trim() === '', showHook(got));
}
check('282: no decision is ever allow',
  decisions.every((d) => d === null || (d.decision === 'deny' || d.decision === 'block'))
    && outputs.every((o) => !/"permissionDecision"\s*:\s*"allow"/.test(o.stdout) && !/"decision"\s*:\s*"(?:allow|approve)"/.test(o.stdout)),
  JSON.stringify(decisions.filter((d) => d && d.decision !== 'deny' && d.decision !== 'block')).slice(0, 200));

git(PROJECT, ['worktree', 'remove', '--force', WORKTREE]);
fs.rmSync(SCRATCH, { recursive: true, force: true });
console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach((f) => console.log('  - ' + f));
process.exit(1);
