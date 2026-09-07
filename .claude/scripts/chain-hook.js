#!/usr/bin/env node
'use strict';
//
// chain-hook.js - the M14 chain-state backstop outside Claude Code (issue #144).
//
// Why this exists:
//   In Claude Code one stage invokes the next through the Skill tool. Cursor,
//   Codex, and Antigravity have no such tool: the handoff is prose ("now run
//   /review"), which the model follows almost always and a tool never forces.
//   Each of those tools does have a Stop hook that can hand the agent a
//   follow-up when a turn ends. This script is that hook's brain: the finishing
//   stage records what comes next, and when the turn ends the hook reads the
//   record and, if the handoff is still pending, tells the tool to continue
//   with it - exactly once.
//
// The record: artifacts/html/.chain-state.json under the working copy (that
// directory is gitignored and already holds document.md's .last-cycle marker):
//   { "next": "/review", "status": "pending" | "fired" | "stopped", "from": "execute" }
//
// Usage:
//   node .claude/scripts/chain-hook.js --set /review [--from execute]   a stage records its handoff (M14)
//   node .claude/scripts/chain-hook.js --set none                        "no chaining": the turn may end
//   node .claude/scripts/chain-hook.js --clear                           forget the record
//   node .claude/scripts/chain-hook.js --status                          print the record (for humans)
//   node .claude/scripts/chain-hook.js --tool cursor|codex|antigravity   Stop-hook mode: reads the
//                                                                        tool's JSON on stdin, prints
//                                                                        the tool's continuation JSON
//                                                                        when a handoff is pending,
//                                                                        then marks it fired
//   node .claude/scripts/chain-hook.js --tool cursor --guard-shell       Cursor beforeShellExecution
//                                                                        mode: denies a force push (M9)
//
// Per-tool output, from each tool's hooks documentation:
//   cursor       {"followup_message": "..."}   (empty object = nothing to add;
//                Cursor caps automatic follow-ups at loop_limit, default 5)
//   codex        {"decision": "block", "reason": "..."}   (no output = let it stop)
//   antigravity  {"decision": "continue", "reason": "..."} (empty object = let it stop)
//
// Fires once: after emitting a continuation the record is marked fired, so an
// interrupted or repeated turn never re-fires a stale handoff; each tool's own
// continuation cap is the outer bound. Zero dependencies.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function die(msg) { console.error('chain-hook.js: ' + msg); process.exit(2); }

const argv = process.argv.slice(2);
const opts = { set: null, from: '', clear: false, status: false, tool: '', guardShell: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--set') opts.set = String(argv[++i] || '').trim();
  else if (a === '--from') opts.from = String(argv[++i] || '').trim();
  else if (a === '--clear') opts.clear = true;
  else if (a === '--status') opts.status = true;
  else if (a === '--tool') opts.tool = String(argv[++i] || '').trim();
  else if (a === '--guard-shell') opts.guardShell = true;
  else die('unknown argument: ' + a);
}

function root() {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch (e) { return process.cwd(); }
}
const STATE = path.join(root(), 'artifacts', 'html', '.chain-state.json');
function readState() {
  if (!fs.existsSync(STATE)) return null;
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { return null; }
}
function writeState(s) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n');
}
function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) { return {}; }
}

if (opts.set !== null) {
  if (!opts.set) die('--set needs a stage such as /review, or none');
  if (opts.set === 'none') writeState({ next: null, status: 'stopped', from: opts.from });
  else {
    if (!/^\/[a-z][a-z0-9-]*$/.test(opts.set)) die('--set expects a slash command name such as /review');
    writeState({ next: opts.set, status: 'pending', from: opts.from });
  }
  process.exit(0);
}
if (opts.clear) { if (fs.existsSync(STATE)) fs.unlinkSync(STATE); process.exit(0); }
if (opts.status) { const s = readState(); console.log(s ? JSON.stringify(s) : '(no chain state)'); process.exit(0); }
if (!opts.tool) die('nothing to do: pass --set, --clear, --status, or --tool');
if (!['cursor', 'codex', 'antigravity'].includes(opts.tool)) die('unknown tool: ' + opts.tool);

const input = readStdin();

if (opts.guardShell) {
  if (opts.tool !== 'cursor') die('--guard-shell is a Cursor beforeShellExecution hook');
  const cmd = String(input.command || '');
  const force = /\bgit\s+push\b[^|;&\n]*(\s--force(-with-lease|-if-includes)?\b|\s-f\b|\s\+\S)/.test(cmd);
  if (force) {
    console.log(JSON.stringify({ permission: 'deny', user_message: 'Force push blocked by the toolkit (M9: force pushes always ask a human).', agent_message: 'A force push is an always-ask action (M9). Stop and ask the user; never retry it on your own.' }));
  } else {
    console.log(JSON.stringify({ permission: 'allow' }));
  }
  process.exit(0);
}

// Stop-hook mode
const state = readState();
const pending = state && state.status === 'pending' && state.next;
const capped = opts.tool === 'cursor' && Number(input.loop_count || 0) >= 5;
if (!pending || capped) {
  if (opts.tool !== 'codex') console.log('{}');
  process.exit(0);
}
const reason = 'Continue with ' + state.next + ': it is the next stage, chained per M14' + (state.from ? ' from ' + state.from : '') + '. Announce the handoff in one line and run it now. If a hard stop is open (a revert, an unanswered page, a tripwire hit), stop instead and say which.';
writeState(Object.assign({}, state, { status: 'fired' }));
if (opts.tool === 'cursor') console.log(JSON.stringify({ followup_message: reason }));
else if (opts.tool === 'codex') console.log(JSON.stringify({ decision: 'block', reason }));
else console.log(JSON.stringify({ decision: 'continue', reason }));
