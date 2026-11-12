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
//   - while the shell is elsewhere, a Bash command whose first part is
//     `cd <absolute path>`, alone or followed by &&, to one of those two kinds
//     of folder. A lone `cd <root>` is how Claude steps back, and it asks for
//     no approval;
//   - any other tool, which names its own file.
// Anything else is denied (PreToolUse) or blocked once (Stop), with the reason
// Claude reads: where the shell is, and the cd that steps back.
//
// The cd itself is judged too, wherever the shell sits (issue #307): a Bash
// command with a cd to any other folder is denied at that call, wherever the
// cd starts a command (the start, or after &&, ;, ||, | or a new line), full
// path or relative, a bare `cd` and `~` read as the home folder, and `cd -`
// or a folder held in a variable, a backtick or a wildcard refused because
// the guard cannot see it. Before, a command that started with
// `cd <absolute path> &&` passed whatever the folder, the shell stayed there,
// and only the next call was refused: the lessons log recorded that slip
// three times. A helper's cd is left alone (its input
// carries agent_id): Claude Code does not carry it to the helper's next call.
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
const os = require('os');
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

// The home folder a bare `cd` or a `~` names: the hook's own environment first,
// so a test can set it.
function homeOf(env) { return (env && (env.HOME || env.USERPROFILE)) || os.homedir(); }

// The parts of a command where a new command can start: split at &&, ||, ;,
// |, & and a new line, but never inside quotes, and with the body of each
// here-document (`<<WORD` up to the line WORD) skipped. The checks runner's
// word reader refuses quotes holding a $, a here-document and a $( ) outright,
// so the cd reading has its own small reader: the replay over saved sessions
// (issue #307) found Python inside a here-document, and a | inside a quoted
// grep pattern, read as commands when the text was split blindly.
function commandParts(command) {
  const s = String(command);
  const parts = [];
  const pending = [];
  let cur = '';
  let quote = null;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"' && i + 1 < s.length) { cur += s[i + 1]; i += 2; continue; }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '\\' && i + 1 < s.length) { cur += ch + s[i + 1]; i += 2; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; i++; continue; }
    if (s.startsWith('<<', i) && s[i + 2] !== '<') {
      const m = /^<<-?[ \t]*(['"]?)([A-Za-z0-9_]+)\1/.exec(s.slice(i));
      if (m) { pending.push(m[2]); cur += m[0]; i += m[0].length; continue; }
    }
    if (ch === '\n') {
      parts.push(cur);
      cur = '';
      i++;
      while (pending.length) {
        const word = pending.shift();
        while (i < s.length) {
          let end = s.indexOf('\n', i);
          if (end === -1) end = s.length;
          const line = s.slice(i, end);
          i = end + 1;
          if (line.replace(/^\t+/, '') === word) break;
        }
      }
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === '&&' || two === '||') { parts.push(cur); cur = ''; i += 2; continue; }
    if (ch === ';' || ch === '|' || ch === '&') { parts.push(cur); cur = ''; i++; continue; }
    cur += ch;
    i++;
  }
  parts.push(cur);
  return parts;
}

// The words of one part, the shell's way: quotes joined into the word they
// sit in, a backslash taking the next character, a redirection (2>/dev/null)
// ending the word list. `dynamic` marks a word whose value the shell would
// work out at run time ($VAR, a backtick, or an unquoted wildcard), outside
// single quotes.
function partWords(part) {
  const s = String(part);
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length || /[<>]/.test(s[i]) || /^\d+[<>]/.test(s.slice(i))) break;
    let text = '';
    let quoted = false;
    let dynamic = false;
    while (i < s.length && !/\s/.test(s[i]) && !/[<>]/.test(s[i])) {
      const ch = s[i];
      if (ch === "'") {
        const e = s.indexOf("'", i + 1);
        const stop = e === -1 ? s.length : e;
        text += s.slice(i + 1, stop);
        quoted = true;
        i = stop + 1;
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        while (j < s.length && s[j] !== '"') {
          if (s[j] === '\\' && j + 1 < s.length) { text += s[j + 1]; j += 2; continue; }
          if (s[j] === '$' || s[j] === '`') dynamic = true;
          text += s[j];
          j++;
        }
        quoted = true;
        i = j + 1;
        continue;
      }
      if (ch === '\\' && i + 1 < s.length) { text += s[i + 1]; i += 2; continue; }
      if (ch === '$' || ch === '`' || ch === '*' || ch === '?' || ch === '[') dynamic = true;
      text += ch;
      i++;
    }
    out.push({ text: text, quoted: quoted, dynamic: dynamic });
  }
  return out;
}

// Words that can stand before a command at the start of a part.
const LEADS = new Set(['{', '!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', 'time']);

// Every folder a command's cd words go to, resolved the way the shell would: a
// relative path against the shell's folder, a bare `cd`, `~` and `~/...` from
// the home folder. A target the guard cannot know comes back as null: `cd -`
// (the previous folder) and a folder held in a variable, a backtick or a
// wildcard. A cd
// inside ( ) or $( ) runs in a subshell and moves nothing, so its part starts
// with `(` or `$(` and is not read as a cd.
function cdTargets(command, here, env, platform) {
  const p = pathApi(platform);
  const targets = [];
  for (const part of commandParts(command)) {
    const words = partWords(part);
    let k = 0;
    while (k < words.length && !words[k].quoted && LEADS.has(words[k].text)) k++;
    if (k >= words.length || words[k].quoted || words[k].text !== 'cd') continue;
    k++;
    while (k < words.length && !words[k].quoted && /^-[LPe@]+$/.test(words[k].text)) k++;
    const arg = words[k];
    if (arg === undefined) targets.push(homeOf(env));
    else if (arg.dynamic || (arg.text === '-' && !arg.quoted)) targets.push(null);
    else if (!arg.quoted && (arg.text === '~' || arg.text.startsWith('~/'))) targets.push(p.resolve(homeOf(env), arg.text.slice(2)));
    else targets.push(p.resolve(here, arg.text));
  }
  return targets;
}

// A folder as Claude would type it in the step back: bare when plain, quoted
// otherwise (a space, a quote, a backslash).
function shellWord(p) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(p) ? p : "'" + String(p).replace(/'/g, "'\\''") + "'";
}
function denyReason(here, root, what) {
  return 'folder-guard: Claude\'s shell is in ' + here + ', not the project folder ' + root + ', so this ' + what + ' would run in the wrong place. Step back with `cd ' + shellWord(root) +
    '` as a Bash command of its own, then run it again. A command that needs another folder names it in its own paths instead of moving into it.';
}
function cdReason(target, root) {
  const where = target === null ? 'a folder the guard cannot see (`cd -`, or a folder held in a variable, a backtick or a wildcard),' : target + ',';
  return 'folder-guard: this command moves Claude\'s shell to ' + where + ' outside the project folder ' + root +
    ', and the move would stay in force for the next command. Name that folder in the command\'s own paths instead of moving into it (for example `ls <folder>/` or `grep -n x <folder>/<file>`). A cd to the project folder, or to the top folder of a git working copy such as a worktree, still runs.';
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
  // The two kinds of folder the shell may sit in, or a cd may go to.
  const allowed = (folder) => samePath(d.realpath(folder), root, d.platform) || d.isWorkingCopyTop(d.realpath(folder));
  const hereOk = samePath(here, root, d.platform) || d.isWorkingCopyTop(here);
  if (stopping) return hereOk ? null : { decision: 'block', reason: stopReason(here, root) };
  if (input.tool_name === 'Bash') {
    const command = input.tool_input && input.tool_input.command;
    if (typeof command !== 'string') return null;
    // The cd itself (#307), for the main session only: a helper's input carries
    // agent_id, and its cd never reaches its next call.
    const helper = typeof input.agent_id === 'string' && input.agent_id !== '';
    if (!helper) {
      let targets;
      try { targets = cdTargets(command, here, env, d.platform); } catch (e) { return null; }
      for (const t of targets) if (t === null || !allowed(t)) return { decision: 'deny', reason: cdReason(t, root) };
    }
    if (hereOk) return null;
    let named;
    try { named = startsWithAbsoluteCd(command, d.platform); } catch (e) { return null; }
    if (named) return null;
  } else if (hereOk) return null;
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

module.exports = { decide: decide, startsWithAbsoluteCd: startsWithAbsoluteCd, cdTargets: cdTargets, commandParts: commandParts };
