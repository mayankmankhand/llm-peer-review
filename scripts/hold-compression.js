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
//   start  every session start (SessionStart, no matcher). Notes how the stretch began. Prints
//          nothing in this version.
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
// Where it writes, in the project it runs in (an ignored folder): reports/hold-compression/
//   log.jsonl           one row per attempt and per session start
//   sessions/<id>.json  each session's state: its place in the record, the running stage, how the
//                       stretch began, the size at the stretch's first attempt
//
// Off switch: remove the hooks block from .claude/settings.json and set the percentage back to 65
// (or undo the switch-on checkpoint). It takes effect at the next session start.
//
// Exports the reader and the decision function, so the suite and the replay drive the same code.

const fs = require('fs');
const path = require('path');

const HELD = new Set(['explore', 'create-plan', 'execute', 'review', 'document']);
const NEVER_HELD = new Set(['merge', 'review-full', 'pair-debug', 'review-code', 'review-security', 'review-ux',
  'review-copy', 'review-plan', 'review-commands', 'review-deps', 'review-browser']);
const MAX_WINDOW = 1000000;  // the largest window Claude Code allows
const LIMIT_SHARE = 0.9;     // the hold lets go at 90% of the session's window
const PCT_NONE_FROM = 90;    // a percentage at or over this counts as no lowered percentage
const CHUNK = 16 * 1024 * 1024;
const SIZE_WINDOWS = [256 * 1024, 4 * 1024 * 1024, 64 * 1024 * 1024];
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
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
  return { v: 1, transcript: null, offset: 0, stage: null, lastClosed: null, seen: false, firstSize: null };
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
  saveState(opts.dataDir, input.session_id, state);
  row.seen = state.seen;
  appendLog(opts.dataDir, row);
  return { exit: 0, stdout: '', stderr: '' };
}

// Runs one hook call and never throws: on any error the compression goes through and nothing is
// printed. opts: { env, projectDir, dataDir, now }.
function run(mode, text, opts) {
  const o = Object.assign({ env: {}, projectDir: process.cwd(), now: () => new Date() }, opts);
  if (!o.dataDir) o.dataDir = path.join(o.projectDir, 'reports', 'hold-compression');
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
  HELD, NEVER_HELD, LINE_OF, classify, splitParts, closingOf, newState, mayMatter, apply, scanText,
  readRecord, readSize, readPct, limitFor, decide, isHelper, loadState, run,
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
