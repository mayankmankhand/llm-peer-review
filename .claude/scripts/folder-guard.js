#!/usr/bin/env node
'use strict';
// folder-guard.js - the folder guard (issue #282). A Claude Code PreToolUse
// hook on the calls that run in the shell's folder (a Bash command, a helper
// launch, a skill, a search) and a Stop hook: while Claude's shell sits in a
// folder other than the project's, it stops the call, or the end of the turn,
// and names the one command that steps back.
//
// Why: a `cd` inside one Bash call stays for the next call in the main
// session, and every toolkit script takes its paths from the project root, so
// the next check reads the wrong files or none. The lessons log recorded it in
// five cycles, and once all four reviewers of a review failed together because
// they were launched from a receipts folder. A lesson read at every session
// start did not stop it, so a check does (lessons "Never cd into a subfolder in
// a Bash call; start each call from the project root instead." and "Before
// dispatching typed agents, confirm with `pwd` that the session sits in the
// repo root.").
//
// What passes without a word:
//   - the shell at the project root, CLAUDE_PROJECT_DIR, both sides compared
//     as real paths (case-blind on Windows);
//   - the shell at the top folder of any git working copy: a worktree /merge
//     steps into with a lone cd, a session moved into a worktree, another
//     repository on purpose;
//   - a Bash command whose first part is `cd <absolute path>`, alone or
//     followed by &&: it names its own folder, so the shell's does not matter.
//     A lone `cd <root>` is how Claude steps back, and it asks for no approval;
//   - any other tool, which names its own file.
// Anything else is denied (PreToolUse) or blocked once (Stop), with the reason
// Claude reads: where the shell is, and the cd that steps back.
//
// It never answers "allow", like the push guard: a hook's allow would skip a
// prompt the owner's settings or auto mode would show. And it fails open: a
// crash, a timeout, a missing CLAUDE_PROJECT_DIR or a missing command reader
// prints nothing, so the call runs as it would have without the guard. The
// push guard fails closed because a wrong push cannot be undone; a call in the
// wrong folder can be.
//
// decide(input, env, deps) is the whole judgment, so the suite
// (scripts/test-folder-guard.js) and the replay over saved sessions run it on
// inputs alone; deps.isWorkingCopyTop, deps.realpath and deps.platform default
// to the real ones.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// The calls that run in the shell's folder. On Linux, WSL and macOS, Claude
// Code runs searches through Bash, so Grep and Glob matter only where those
// tools exist; Task is the helper launch's older name.
const GUARDED = new Set(['Bash', 'Agent', 'Task', 'Skill', 'Grep', 'Glob']);
const WHAT = { Bash: 'command', Agent: 'helper launch', Task: 'helper launch', Skill: 'skill', Grep: 'search', Glob: 'search' };
// The git call that tells a working copy's top folder; the hook entry allows 10 s.
const GIT_TIMEOUT_MS = 5000;

// The words come from tokenize in run-checks.js, the checks runner's shell-word
// reader, as in push-guard.js; it loads lazily, so a missing copy is the
// guard's error to handle (decide then stays silent).
let tokenizeFn = null;
function tokenizer() {
  if (tokenizeFn === null) tokenizeFn = require(path.join(__dirname, 'run-checks.js')).tokenize;
  if (typeof tokenizeFn !== 'function') throw new Error('run-checks.js beside the guard exports no tokenize');
  return tokenizeFn;
}

function realpath(p) {
  try { return fs.realpathSync(p); } catch (e) { return p; }
}
function pathApi(platform) { return platform === 'win32' ? path.win32 : path.posix; }
// Two folders are one when their resolved paths match, case-blind on Windows.
function samePath(a, b, platform) {
  const p = pathApi(platform);
  const x = p.resolve(a);
  const y = p.resolve(b);
  return platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}
function isWorkingCopyTop(folder) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: folder, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] });
  if (r.status !== 0 || typeof r.stdout !== 'string' || r.stdout.trim() === '') return false;
  return samePath(realpath(r.stdout.trim()), realpath(folder), process.platform);
}
const DEFAULTS = { isWorkingCopyTop: isWorkingCopyTop, realpath: realpath, platform: process.platform };

// True when a command's first part is `cd <absolute path>`, followed by
// nothing or by &&. The reader judges the whole command first; when it refuses
// something later on (an output redirect, a $( )), the part before the first
// && is read alone, since that part is all the rule needs.
function startsWithAbsoluteCd(command, platform) {
  const read = tokenizer();
  const firstPart = (t) => {
    if (!t || t.error || !Array.isArray(t.segments) || t.segments.length === 0) return null;
    const words = t.segments[0];
    if (words.length !== 2 || words[0] !== 'cd' || !pathApi(platform).isAbsolute(words[1])) return null;
    return { op: t.operators[0], more: t.segments.length > 1 };
  };
  const whole = firstPart(read(command));
  if (whole) return whole.op === '&&' || !whole.more;
  const cut = command.indexOf('&&');
  if (cut === -1) return false;
  const head = firstPart(read(command.slice(0, cut)));
  return head !== null && !head.more;
}

// A folder as Claude would type it in the step back: bare when plain, quoted
// otherwise (a space, a quote, a backslash).
function shellWord(p) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(p) ? p : "'" + String(p).replace(/'/g, "'\\''") + "'";
}
function denyReason(here, root, what) {
  return 'folder-guard: Claude\'s shell is in ' + here + ', not the project folder ' + root + ', so this ' + what + ' would run in the wrong place. Step back with `cd ' + shellWord(root) +
    '` as a Bash command of its own, then run it again. A command that has to run elsewhere can start with `cd <full path> &&`, which the guard lets through.';
}
function stopReason(here, root) {
  return 'folder-guard: Claude\'s shell is still in ' + here + ', not the project folder ' + root + '. Step back with `cd ' + shellWord(root) +
    '` as a Bash command of its own before ending the turn, so the next command or slash command runs in the project folder.';
}

// The judgment: null (say nothing), { decision: 'deny', reason } for a call,
// or { decision: 'block', reason } for the end of a turn.
function decide(input, env, deps) {
  if (input === null || typeof input !== 'object') return null;
  const d = Object.assign({}, DEFAULTS, deps || {});
  const rootRaw = env && env.CLAUDE_PROJECT_DIR;
  if (typeof rootRaw !== 'string' || rootRaw === '' || typeof input.cwd !== 'string' || input.cwd === '') return null;
  const stopping = input.hook_event_name === 'Stop';
  // A stop that already follows a stop hook's block: say nothing, so the guard
  // can never hold a turn open.
  if (stopping && input.stop_hook_active === true) return null;
  if (!stopping && !GUARDED.has(input.tool_name)) return null;
  const root = d.realpath(rootRaw);
  const here = d.realpath(input.cwd);
  if (samePath(here, root, d.platform) || d.isWorkingCopyTop(here)) return null;
  if (stopping) return { decision: 'block', reason: stopReason(here, root) };
  if (input.tool_name === 'Bash') {
    const command = input.tool_input && input.tool_input.command;
    if (typeof command !== 'string') return null;
    let named;
    try { named = startsWithAbsoluteCd(command, d.platform); } catch (e) { return null; }
    if (named) return null;
  }
  return { decision: 'deny', reason: denyReason(here, root, WHAT[input.tool_name]) };
}

// The hook's entry: read the call, print one answer or nothing, exit 0. Any
// failure prints nothing, so the call runs as it would without the guard.
function main() {
  let out = null;
  try {
    const d = decide(JSON.parse(fs.readFileSync(0, 'utf8')), process.env);
    if (d && d.decision === 'block') out = { decision: 'block', reason: d.reason };
    else if (d && d.decision === 'deny') out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } };
  } catch (e) {
    out = null;
  }
  if (out !== null) process.stdout.write(JSON.stringify(out) + '\n');
}

if (require.main === module) main();

module.exports = { decide: decide, startsWithAbsoluteCd: startsWithAbsoluteCd };
