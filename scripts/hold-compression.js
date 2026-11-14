#!/usr/bin/env node
'use strict';
// hold-compression.js - holds an automatic compression while a loop stage is running, and lets it
// through at the stage's closing call (issue 293). Maintainer-only: it lives under scripts/, is
// switched on by a hooks block in this repo's own .claude/settings.json, and is never built into
// the plugin.
//
// Why. When a long session is compressed, Claude Code keeps a summary and only the start of each
// loaded instruction file. A compression partway through a review, a docs step or a build drops
// the later steps of that stage's instructions. Held until the stage's closing call, the
// compression lands between stages, where the plan, the reports and the fix log are already saved.
//
// How Claude Code runs it (argv[2] is the mode; the hook's JSON arrives on stdin):
//   pre    before an automatic compression (PreCompact, matcher auto). Exit 2 refuses it; Claude
//          Code then tries again before the next call. Any other exit lets it through.
//   start  every session start (SessionStart, no matcher). Notes how the stretch began. Prints one
//          line only in two cases: after a compression this script let through with a handoff
//          note, and at a fresh start when it has stopped doing its job (the warning below).
//
// The rule, in order (each attempt gets one log row naming the line that decided it):
//   1. the input, the session's record or its size cannot be read, or anything throws: through
//      (it fails open: Claude Code proceeds on any exit code other than 2)
//   2. the attempt is not one this script holds: a helper's (its record sits in a subagents
//      folder, or the input carries an agent id), or one whose trigger is not auto: through
//   3. no lowered percentage is in force (CLAUDE_AUTOCOMPACT_PCT_OVERRIDE from the environment,
//      else from the project's .claude/settings.json; 90 or more counts as none): through
//   4. this stretch was not seen from its beginning (a resumed session, or no note of how the
//      session started), so the size at which the compression came due cannot be trusted: through
//   5. the size has reached the limit of the hold: through
//   6. no stage is running: through
//   otherwise: held (exit 2).
//
// Before it reads the record, an attempt waits for Claude Code's pending write of the latest call
// (see settle below): usually about 200 ms, never more than 1 second.
//
// The limit is worked out per session, never a fixed number: the size at the first attempt since
// the last compression, divided by the percentage, is the session's window (never taken as more
// than 1,000,000 tokens); the limit is 90% of that window.
//
// A stage starts when one of the five stage commands (explore, create-plan, execute, review,
// document, with or without tk: in front) is typed or loaded by name through the Skill tool. It
// ends at its own closing call, made by a main-session tool call at the start of a command part:
//   explore, execute, review   node <path>/session-init.js --chain <stage>
//   create-plan                node <path>/render-html.js --shell plan
//   document                   the write of the cycle marker .last-cycle (Write, or a > redirect)
// A closing call for a stage that is not the running one changes nothing. A second stage command
// replaces the running stage. merge, review-full, pair-debug and the single review kinds are
// never held: starting one ends the running stage. Words in a tool's output, a helper's row, a
// pasted message, a command's arguments or a request blob row never start or end a stage.
//
// The handoff note. When a compression is let through after a stage's closing call and before the
// next stage starts, the script writes a short note holding only what a script can know for
// certain: the finished stage and its closing call word for word, the next stage, the newest plan
// and its progress line, the newest exploration summary and review report, the branch, and the
// saved checkpoints since the stage began. A part it cannot read is left out. The restart that
// follows that compression prints one line naming the note and the next step; nothing is printed
// after a compression at the limit, after one the owner typed, or twice for one compression.
//
// The warning. At a fresh session start, at most once a day, one line is printed when the log
// holds a row not yet reported where the script could not read its input or the record, or when
// the last 14 days hold at least 5 compressions let through and not one held call. The line gives
// the count and the off switch. Only the log's last 2 MB are read, so the start stays quick.
//
// Where it writes, in the project it runs in (an ignored folder): reports/hold-compression/
//   log.jsonl           one row per attempt and per session start
//   sessions/<id>.json  each session's state: its place in the record, the running stage, the
//                       last stage closed, how the stretch began, the size at the stretch's first
//                       attempt, and a note waiting to be pointed to
//   notes/              the handoff notes
//   warned.json         the day of the last warning and how much of the log it covered
//
// Off switch: remove the hooks block from .claude/settings.json and set the percentage back to 65
// (or undo the switch-on checkpoint). It takes effect at the next session start.
//
// Exports the reader and the decision function, so the suite and the replay drive the same code.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HELD = new Set(['explore', 'create-plan', 'execute', 'review', 'document']);
const NEVER_HELD = new Set(['merge', 'review-full', 'pair-debug', 'review-code', 'review-security', 'review-ux',
  'review-copy', 'review-plan', 'review-commands', 'review-deps', 'review-browser']);
const MAX_WINDOW = 1000000;  // the largest window Claude Code allows
const LIMIT_SHARE = 0.9;     // the hold lets go at 90% of the session's window
const PCT_NONE_FROM = 90;    // a percentage at or over this counts as no lowered percentage
const CHUNK = 16 * 1024 * 1024;
const SIZE_WINDOWS = [256 * 1024, 4 * 1024 * 1024, 64 * 1024 * 1024];
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
// The stage that follows each one, as the handoff note and the printed line name it.
const NEXT = {
  explore: '/create-plan', 'create-plan': '/execute, once the owner says go', execute: '/review',
  review: '/document', document: 'none, the cycle is complete',
};
const NOTE_MAX_AGE_MS = 15 * 60 * 1000; // a note older than this is never pointed to
const WARN_DAYS = 14;
const WARN_MIN_THROUGH = 5;
const LOG_TAIL = 2 * 1024 * 1024;
const OFF_SWITCH = 'To switch it off, remove the hooks block from .claude/settings.json and set CLAUDE_AUTOCOMPACT_PCT_OVERRIDE back to 65.';
// The rule line each reason belongs to (see the header). A hold names no line.
const LINE_OF = {
  'unreadable-input': 1, 'unreadable-record': 1, 'unreadable-size': 1, error: 1,
  'not-auto': 2, helper: 2, 'no-lowered-pct': 3, 'not-seen': 4, limit: 5, 'no-stage': 6, held: null,
};

// ---- commands and closing calls ----------------------------------------------------------------------

// A command or skill name: { stage } for a held stage, { unheld } for a command never held, else null.
function classify(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim().replace(/^\//, '').replace(/^tk:/, '');
  if (HELD.has(n)) return { stage: n };
  if (NEVER_HELD.has(n)) return { unheld: n };
  return null;
}

// Splits shell text into command parts, each { words, redirects }. Quotes are honored (a separator
// or a redirect inside quotes is plain text and the quotes are removed), a backslash escapes the
// next character, a heredoc's body is dropped, and ; & | ( ) ` $( and a newline start a new part.
// Enough to find where a command starts; it is not a full shell parser.
function splitParts(text) {
  const s = String(text);
  const parts = [];
  let words = [], redirects = [], word = '', inWord = false, redirect = null;
  const heredocs = [];
  const endWord = () => {
    if (!inWord) return;
    if (redirect) { redirects.push({ kind: redirect, target: word }); redirect = null; } else words.push(word);
    word = ''; inWord = false;
  };
  const endPart = () => {
    endWord();
    if (words.length || redirects.length) parts.push({ words, redirects });
    words = []; redirects = []; redirect = null;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      if (s[i + 1] !== '\n') { word += s[i + 1]; inWord = true; }
      i += 2; continue;
    }
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      const end = j < 0 ? s.length : j;
      word += s.slice(i + 1, end); inWord = true; i = end + 1; continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\' && j + 1 < s.length) { word += s[j + 1]; j += 2; } else { word += s[j]; j++; }
      }
      inWord = true; i = j + 1; continue;
    }
    if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      // A heredoc: note its delimiter; the body is dropped at the next newline.
      endWord();
      let j = i + 2;
      if (s[j] === '-') j++;
      while (s[j] === ' ' || s[j] === '\t') j++;
      let delim = '';
      while (j < s.length && !/[\s;&|<>()]/.test(s[j])) {
        if (s[j] === "'" || s[j] === '"') {
          const k = s.indexOf(s[j], j + 1);
          delim += s.slice(j + 1, k < 0 ? s.length : k);
          j = k < 0 ? s.length : k + 1;
        } else { delim += s[j]; j++; }
      }
      if (delim) heredocs.push(delim);
      i = j; continue;
    }
    if (c === '\n') {
      endPart();
      i++;
      while (heredocs.length) {
        const d = heredocs.shift();
        while (i < s.length) {
          const nl = s.indexOf('\n', i);
          const end = nl < 0 ? s.length : nl;
          const line = s.slice(i, end);
          i = nl < 0 ? s.length : nl + 1;
          if (line.replace(/^\t+/, '') === d) break;
        }
      }
      continue;
    }
    if (c === '$' && s[i + 1] === '(') { endPart(); i += 2; continue; }
    if (c === ';' || c === '&' || c === '|' || c === '(' || c === ')' || c === '`') { endPart(); i++; continue; }
    if (c === '>' || c === '<') {
      if (inWord && /^\d+$/.test(word)) { word = ''; inWord = false; } else endWord();
      let j = i + 1;
      if (c === '>' && (s[j] === '>' || s[j] === '|')) j++;
      if (s[j] === '&') { i = j + 1; continue; } // >&2: a descriptor, not a file
      redirect = c === '>' ? 'out' : 'in';
      i = j; continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { endWord(); i++; continue; }
    word += c; inWord = true; i++;
  }
  endPart();
  return parts;
}

// The stage a tool call closes, or null: { stage, call } where call is the command word for word.
function closingOf(block) {
  if (!block || !block.input) return null;
  if (block.name === 'Write') {
    const file = String(block.input.file_path || '');
    return path.basename(file) === '.last-cycle' ? { stage: 'document', call: 'Write ' + file } : null;
  }
  if (block.name !== 'Bash') return null;
  const command = String(block.input.command || '');
  for (const part of splitParts(command)) {
    if (part.redirects.some((r) => r.kind === 'out' && path.basename(r.target) === '.last-cycle')) return { stage: 'document', call: command.trim() };
    const w = part.words;
    let k = 0;
    while (k < w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[k])) k++; // leading NAME=value words
    if (k >= w.length || path.basename(w[k]) !== 'node' || k + 1 >= w.length) continue;
    const file = path.basename(w[k + 1]);
    const args = w.slice(k + 2);
    if (file === 'session-init.js') {
      const at = args.indexOf('--chain');
      if (at >= 0 && HELD.has(args[at + 1])) return { stage: args[at + 1], call: command.trim() };
    } else if (file === 'render-html.js') {
      const at = args.indexOf('--shell');
      if (at >= 0 && args[at + 1] === 'plan') return { stage: 'create-plan', call: command.trim() };
    }
  }
  return null;
}

// ---- the record reader ---------------------------------------------------------------------------------

function newState() {
  return { v: 1, transcript: null, offset: 0, stage: null, lastClosed: null, seen: false, firstSize: null, pendingNote: null };
}

// Forget where the reader was, as for a record it has not read before.
function resetReader(state) {
  state.offset = 0;
  state.stage = null;
  state.lastClosed = null;
}

// A cheap test on the raw line, so only the few lines that can start or end a stage are parsed.
// Metadata rows (request blobs, titles, snapshots) start with {"type": and are never read.
function mayMatter(line) {
  if (!line || line.startsWith('{"type":')) return false;
  if (line.includes('"isSidechain":true')) return false;
  if (line.includes('"compact_boundary"') || line.includes('<command-name>')) return true;
  if (!line.includes('"tool_use"')) return false;
  if (line.includes('"name":"Skill"')) return true;
  if (line.includes('"name":"Bash"') && (line.includes('session-init.js') || line.includes('render-html.js') || line.includes('.last-cycle'))) return true;
  return line.includes('"name":"Write"') && line.includes('.last-cycle');
}

function begin(kind, state, at) {
  if (!kind) return;
  state.stage = kind.stage ? { name: kind.stage, at: at || null } : null;
  state.lastClosed = null;
}

// The text a person typed, when the row is a typed message (a string, or text blocks only).
function typedText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || !content.length || content.some((b) => !b || b.type !== 'text')) return '';
  return content.map((b) => String(b.text || '')).join('\n');
}

const TYPED_COMMAND = /^\s*(?:<command-message>[^<]*<\/command-message>\s*)?<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/;

// Applies one parsed row of the main session to the state.
function apply(o, state) {
  if (!o || o.isSidechain) return;
  if (o.type === 'system' && o.subtype === 'compact_boundary') { state.firstSize = null; return; }
  if (o.type === 'user' && o.message && !o.isMeta) {
    // A typed command opens the row; the same words later in a pasted message do not count.
    const m = TYPED_COMMAND.exec(typedText(o.message.content));
    if (m) begin(classify(m[1]), state, o.timestamp);
    return;
  }
  if (o.type !== 'assistant' || !o.message || !Array.isArray(o.message.content)) return;
  for (const b of o.message.content) {
    if (!b || b.type !== 'tool_use' || !b.input) continue;
    if (b.name === 'Skill') { begin(classify(b.input.skill), state, o.timestamp); continue; }
    const c = closingOf(b);
    if (c && state.stage && state.stage.name === c.stage) {
      state.lastClosed = { stage: c.stage, call: c.call.slice(0, 2000), startedAt: state.stage.at, at: o.timestamp || null };
      state.stage = null;
    }
  }
}

// Applies every line of a block of whole lines; returns how many were parsed.
function scanText(text, state) {
  let parsed = 0;
  for (const line of text.split('\n')) {
    if (!mayMatter(line)) continue;
    let o;
    try { o = JSON.parse(line); } catch (e) { continue; }
    parsed++;
    apply(o, state);
  }
  return parsed;
}

// Reads the record from the state's saved place to its last whole line, and moves the place on.
// A line still being written is left for the next read. Throws when the record cannot be read.
function readRecord(file, state) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size < state.offset) { resetReader(state); state.seen = false; } // a different file now
    let pos = state.offset;
    let carry = Buffer.alloc(0);
    let bytesRead = 0, parsed = 0;
    while (pos < size) {
      const buf = Buffer.alloc(Math.min(CHUNK, size - pos));
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      pos += n;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      const nl = data.lastIndexOf(10);
      if (nl < 0) { carry = data; continue; }
      parsed += scanText(data.toString('utf8', 0, nl), state);
      state.offset += nl + 1;
      bytesRead += nl + 1;
      carry = data.subarray(nl + 1);
    }
    return { bytesRead, parsed };
  } finally { fs.closeSync(fd); }
}

// Claude Code runs this hook before it writes the latest call and its tool result to the record,
// and writes them while the hook runs: 41 to 82 ms in, in one burst, in the live fix round's
// measurement (reports/checks/PLAN-issue-293/live/flush-probe-result.jsonl). Read at once, the
// record is one call behind, and after a stage's closing call the script would hold the first
// attempt and let the next one through, after the next stage had already loaded. So it waits
// until the record grows and then stays quiet, or until a floor passes with no growth, never
// longer than a cap. Returns the time waited, in ms.
const SETTLE = { floorMs: 300, quietMs: 120, capMs: 1000, stepMs: 20 };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function settle(file, s) {
  const started = Date.now();
  const sizeNow = () => { try { return fs.statSync(file).size; } catch (e) { return -1; } };
  let last = sizeNow();
  let grewAt = null;
  for (;;) {
    const now = Date.now() - started;
    if (now >= s.capMs || (grewAt === null ? now >= s.floorMs : now - grewAt >= s.quietMs)) break;
    sleep(s.stepMs);
    const size = sizeNow();
    if (size !== last) { last = size; grewAt = Date.now() - started; }
  }
  return Date.now() - started;
}

// The size of the last main-session call, read from the end of the record: input plus cache-read
// plus cache-creation tokens. Null when no such call is found in the record's last 64 MB.
function readSize(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    for (const win of SIZE_WINDOWS) {
      const len = Math.min(win, size);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      const lines = buf.toString('utf8').split('\n');
      const first = len < size ? 1 : 0; // a cut window's first line is partial
      for (let i = lines.length - 1; i >= first; i--) {
        const l = lines[i];
        if (!l || l.startsWith('{"type":') || !l.includes('"usage"') || !l.includes('"assistant"') || l.includes('"isSidechain":true')) continue;
        let o;
        try { o = JSON.parse(l); } catch (e) { continue; }
        if (o.type !== 'assistant' || o.isSidechain || !o.message || !o.message.usage) continue;
        const u = o.message.usage;
        const n = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        if (n > 0) return n;
      }
      if (len >= size) break;
    }
    return null;
  } finally { fs.closeSync(fd); }
}

// ---- the rule --------------------------------------------------------------------------------------

function pctFrom(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < PCT_NONE_FROM ? n : null;
}

// The lowered percentage in force, or null. The environment wins; the project's settings file is
// read only when the environment has no value.
function readPct(env, projectDir) {
  const v = env && env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
  if (v !== undefined && v !== null && String(v).trim() !== '') return pctFrom(v);
  try {
    const s = JSON.parse(fs.readFileSync(path.join(projectDir, '.claude', 'settings.json'), 'utf8'));
    return pctFrom(s && s.env && s.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE);
  } catch (e) { return null; }
}

function limitFor(firstSize, pct) {
  return Math.floor(LIMIT_SHARE * Math.min(firstSize * 100 / pct, MAX_WINDOW));
}

// facts: { error, trigger, helper, pct, seen, size, firstSize, stage }. Returns { hold, reason, limit }.
function decide(f) {
  if (f.error) return { hold: false, reason: f.error };
  if (f.trigger !== 'auto') return { hold: false, reason: 'not-auto' };
  if (f.helper) return { hold: false, reason: 'helper' };
  if (f.pct == null) return { hold: false, reason: 'no-lowered-pct' };
  if (!f.seen) return { hold: false, reason: 'not-seen' };
  const limit = limitFor(f.firstSize == null ? f.size : f.firstSize, f.pct);
  if (f.size >= limit) return { hold: false, reason: 'limit', limit };
  if (!f.stage) return { hold: false, reason: 'no-stage', limit };
  return { hold: true, reason: 'held', limit };
}

function isHelper(input) {
  return Boolean(input.agent_id) || String(input.transcript_path).split(/[\\/]/).includes('subagents');
}

// ---- state and log ------------------------------------------------------------------------------------

function statePath(dataDir, id) { return path.join(dataDir, 'sessions', id + '.json'); }

// The session's saved state, or null when there is none (or it cannot be read).
function loadState(dataDir, id) {
  try { return Object.assign(newState(), JSON.parse(fs.readFileSync(statePath(dataDir, id), 'utf8'))); } catch (e) { return null; }
}

function saveState(dataDir, id, state) {
  const file = statePath(dataDir, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
}

function appendLog(dataDir, row) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(path.join(dataDir, 'log.jsonl'), JSON.stringify(row) + '\n');
}

// The hook input, or null when it is not an object naming a usable session id and record path.
function parseInput(text) {
  let input;
  try { input = JSON.parse(text); } catch (e) { return null; }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (!SESSION_ID.test(String(input.session_id || ''))) return null;
  if (typeof input.transcript_path !== 'string' || !input.transcript_path) return null;
  return input;
}

// ---- the handoff note --------------------------------------------------------------------------------

// A path as the session sees it: relative to the project when it lies inside it, with / separators.
function shown(projectDir, file) {
  const rel = path.relative(projectDir, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : file;
}

// The newest file in dir whose name matches re, as a path relative to the project, or null.
function newest(projectDir, dir, re) {
  try {
    const abs = path.join(projectDir, dir);
    let best = null, bestMs = -1;
    for (const name of fs.readdirSync(abs)) {
      if (!re.test(name)) continue;
      const ms = fs.statSync(path.join(abs, name)).mtimeMs;
      if (ms > bestMs) { best = name; bestMs = ms; }
    }
    return best ? dir + '/' + best : null;
  } catch (e) { return null; }
}

function git(projectDir, args) {
  try {
    return execFileSync('git', args, { cwd: projectDir, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) { return null; }
}

// A fenced block that holds text as it is, whatever backticks the text carries.
function fenced(text) {
  const runs = String(text).match(/`+/g) || [];
  const fence = '`'.repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
  return fence + '\n' + text + '\n' + fence;
}

// Writes the note for a finished stage; returns its path as the session sees it.
function writeNote(closed, opts) {
  const p = opts.projectDir;
  const out = [
    '# Handoff note',
    '',
    'Written by scripts/hold-compression.js at ' + opts.now().toISOString() + ', when it let a compression through between stages. '
      + 'It holds only what a script can know for certain; anything said only in chat is in Claude Code\'s own summary.',
    '',
    '- **Finished stage:** ' + closed.stage,
    '- **Next stage:** ' + (NEXT[closed.stage] || 'unknown'),
  ];
  const plan = newest(p, 'plans', /^PLAN-.*\.md$/);
  if (plan) {
    let progress = null;
    try { progress = (fs.readFileSync(path.join(p, plan), 'utf8').split('\n').find((l) => l.startsWith('**Overall Progress:**')) || '').trim() || null; } catch (e) { /* left out */ }
    out.push('- **Newest plan:** ' + plan + (progress ? ' (' + progress + ')' : ''));
  }
  const explore = newest(p, 'reports/explore', /\.md$/);
  if (explore) out.push('- **Newest exploration summary:** ' + explore);
  const review = newest(p, 'reports', /^review-.*\.md$/);
  if (review) out.push('- **Newest review report:** ' + review);
  const branch = git(p, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch) out.push('- **Branch:** ' + branch);
  const log = closed.startedAt ? git(p, ['log', '--since=' + closed.startedAt, '-n', '30', '--format=%h %s']) : null;
  if (log !== null && closed.startedAt) {
    out.push('- **Saved checkpoints since the stage began:**' + (log ? '' : ' none'));
    for (const l of log ? log.split('\n') : []) out.push('  - ' + l);
  }
  out.push('', '## The closing call, word for word', '', 'Run it again when its result is not in view.', '', fenced(closed.call), '');
  const dir = path.join(opts.dataDir, 'notes');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = opts.now().toISOString().replace(/[:.]/g, '-');
  for (let n = 1; ; n++) {
    const file = path.join(dir, stamp + '-' + closed.stage + (n > 1 ? '-' + n : '') + '.md');
    try { fs.writeFileSync(file, out.join('\n'), { flag: 'wx' }); return shown(p, file); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}

// The line printed at the restart after a compression this script let through with a note.
function noteLine(note) {
  return 'Handoff note: the ' + note.stage + ' stage finished before this compression, and its note is ' + note.path
    + '. Next step: ' + (NEXT[note.stage] || 'unknown') + '. If the result of the ' + note.stage
    + ' stage\'s closing call is not in view, run it again; the note has it word for word.\n';
}

// ---- the warning -------------------------------------------------------------------------------------

// One line at a fresh start, at most once a day, when the script has stopped doing its job.
function warning(opts) {
  const logFile = path.join(opts.dataDir, 'log.jsonl');
  const markFile = path.join(opts.dataDir, 'warned.json');
  const now = opts.now();
  const today = now.toISOString().slice(0, 10);
  let mark = {};
  try { mark = JSON.parse(fs.readFileSync(markFile, 'utf8')) || {}; } catch (e) { mark = {}; }
  if (mark.day === today) return '';
  let size;
  try { size = fs.statSync(logFile).size; } catch (e) { return ''; }
  const from = Math.max(0, size - LOG_TAIL);
  const buf = Buffer.alloc(size - from);
  const fd = fs.openSync(logFile, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
  const since = now.getTime() - WARN_DAYS * 86400000;
  const reported = Number(mark.reported) || 0;
  let at = from, unread = 0, firstUnread = null, through = 0, heldCalls = 0;
  const lines = buf.toString('utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = at;
    at += Buffer.byteLength(line) + 1;
    if (!line || (i === 0 && from > 0)) continue; // a cut first line
    let r;
    try { r = JSON.parse(line); } catch (e) { continue; }
    if (start >= reported && LINE_OF[r.reason] === 1) { unread++; if (!firstUnread) firstUnread = String(r.t || '').slice(0, 10); }
    if (r.event === 'pre' && Date.parse(r.t) >= since) {
      if (r.decision === 'held') heldCalls++;
      else if (r.decision === 'through') through++;
    }
  }
  const parts = [];
  if (unread) parts.push(unread + (unread === 1 ? ' call' : ' calls') + ' since ' + firstUnread + ' could not read the hook input or the session record');
  if (through >= WARN_MIN_THROUGH && heldCalls === 0) parts.push('the last ' + WARN_DAYS + ' days hold ' + through + ' compressions let through and not one held');
  if (!parts.length) return '';
  fs.writeFileSync(markFile, JSON.stringify({ day: today, reported: size }));
  return 'hold-compression warning: ' + parts.join('; and ') + ' (log: reports/hold-compression/log.jsonl). ' + OFF_SWITCH + '\n';
}

// ---- the two modes ----------------------------------------------------------------------------------

function preCompact(text, opts) {
  const started = Date.now();
  const row = { t: opts.now().toISOString(), event: 'pre' };
  const input = parseInput(text);
  const facts = {};
  let state = null;
  if (!input) facts.error = 'unreadable-input';
  else {
    row.session = input.session_id;
    facts.trigger = input.trigger;
    facts.helper = isHelper(input);
    if (facts.trigger === 'auto' && !facts.helper) facts.pct = readPct(opts.env, opts.projectDir);
    if (facts.trigger === 'auto' && !facts.helper && facts.pct != null) {
      // A session with no note of how it started is not seen from its beginning.
      state = loadState(opts.dataDir, input.session_id) || newState();
      if (state.transcript !== input.transcript_path) {
        if (state.transcript) state.seen = false;
        resetReader(state);
        state.transcript = input.transcript_path;
      }
      row.wait = settle(input.transcript_path, opts.settle);
      try { readRecord(input.transcript_path, state); } catch (e) { facts.error = 'unreadable-record'; }
      if (!facts.error) {
        try { facts.size = readSize(input.transcript_path); } catch (e) { facts.size = null; }
        if (facts.size == null) facts.error = 'unreadable-size';
      }
      facts.seen = state.seen;
      facts.stage = state.stage ? state.stage.name : null;
      facts.firstSize = state.firstSize;
    }
  }
  const verdict = decide(facts);
  if (state) {
    if (state.firstSize == null && verdict.limit !== undefined) state.firstSize = facts.size;
    // Let through after a stage's closing call and before the next stage starts: write the note
    // the next restart points to. Any other let-through leaves no note waiting.
    if (!verdict.hold && !facts.error) {
      state.pendingNote = null;
      if (!state.stage && state.lastClosed) {
        row.note = writeNote(state.lastClosed, opts);
        state.pendingNote = { path: row.note, stage: state.lastClosed.stage, at: opts.now().toISOString() };
        state.lastClosed = null;
      }
    }
    saveState(opts.dataDir, input.session_id, state);
  }
  Object.assign(row, {
    decision: verdict.hold ? 'held' : 'through', reason: verdict.reason, line: LINE_OF[verdict.reason],
    trigger: facts.trigger === undefined ? null : facts.trigger || null, stage: facts.stage || null,
    size: facts.size == null ? null : facts.size, first: state ? state.firstSize : null,
    pct: facts.pct == null ? null : facts.pct, limit: verdict.limit === undefined ? null : verdict.limit,
    ms: Date.now() - started,
  });
  appendLog(opts.dataDir, row);
  return { exit: verdict.hold ? 2 : 0, stdout: '', stderr: verdict.hold ? 'Compression held until the running stage ends.\n' : '' };
}

function sessionStart(text, opts) {
  const row = { t: opts.now().toISOString(), event: 'start' };
  const input = parseInput(text);
  if (!input) {
    Object.assign(row, { reason: 'unreadable-input', line: 1 });
    appendLog(opts.dataDir, row);
    return { exit: 0, stdout: '', stderr: '' };
  }
  row.session = input.session_id;
  row.source = input.source || null;
  const state = loadState(opts.dataDir, input.session_id) || newState();
  if (state.transcript !== input.transcript_path) { resetReader(state); state.transcript = input.transcript_path; }
  // A fresh start, a /clear and the restart after a compression begin a stretch this script sees
  // from its beginning; a resumed session (or a source it does not know) does not.
  state.seen = input.source === 'startup' || input.source === 'clear' || input.source === 'compact';
  state.firstSize = null;
  if (input.source === 'clear') { state.stage = null; state.lastClosed = null; }
  let stdout = '';
  if (input.source === 'compact') {
    // Point to the note only for the compression this script just let through with one.
    const note = state.pendingNote;
    if (note && opts.now().getTime() - Date.parse(note.at) <= NOTE_MAX_AGE_MS) { stdout = noteLine(note); row.printed = 'note'; }
  }
  state.pendingNote = null;
  saveState(opts.dataDir, input.session_id, state);
  if (input.source === 'startup') {
    stdout = warning(opts);
    if (stdout) row.printed = 'warning';
  }
  row.seen = state.seen;
  appendLog(opts.dataDir, row);
  return { exit: 0, stdout, stderr: '' };
}

// Runs one hook call and never throws: on any error the compression goes through and nothing is
// printed. opts: { env, projectDir, dataDir, now }.
function run(mode, text, opts) {
  const o = Object.assign({ env: {}, projectDir: process.cwd(), now: () => new Date() }, opts);
  if (!o.dataDir) o.dataDir = path.join(o.projectDir, 'reports', 'hold-compression');
  o.settle = Object.assign({}, SETTLE, opts && opts.settle);
  try {
    if (mode === 'pre') return preCompact(text, o);
    if (mode === 'start') return sessionStart(text, o);
    return { exit: 0, stdout: '', stderr: '' };
  } catch (e) {
    try { appendLog(o.dataDir, { t: new Date().toISOString(), event: mode, decision: 'through', reason: 'error', line: 1, error: String(e && e.message || e).slice(0, 200) }); } catch (e2) { /* nowhere to write */ }
    return { exit: 0, stdout: '', stderr: '' };
  }
}

module.exports = {
  HELD, NEVER_HELD, LINE_OF, TYPED_COMMAND, typedText, classify, splitParts, closingOf, newState, mayMatter, apply, scanText,
  readRecord, readSize, readPct, limitFor, decide, isHelper, loadState, writeNote, noteLine, warning, run,
};

if (require.main === module) {
  let text = '';
  try { text = fs.readFileSync(0, 'utf8'); } catch (e) { text = ''; }
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const r = run(process.argv[2], text, { env: process.env, projectDir });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = r.exit;
}
