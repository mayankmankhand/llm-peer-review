#!/usr/bin/env node
'use strict';
// quote-guard.js - the apostrophe check (issue #310). A Claude Code PreToolUse
// hook on Bash: Claude Code runs it before every Bash command Claude makes,
// and it blocks a command whose single-quoted text an apostrophe cuts. An
// inline program written inside single quotes (node -e '...') that holds a
// possessive ("the plan's steps") ends its quote at the apostrophe, so bash
// either stops with a quoting error or runs the command on the wrong words.
// It happened three times although a lesson warned about it; the way through
// is to put the text in a file, which the block says.
//
// The reader, judge(command): command text in, null or { reason, cut } out.
// It blocks only when single-quoted text is clearly cut:
//   continues  a closing single quote followed directly by a letter, which
//              continues the word: 'the plan's steps' reads as 'the plan' + s...
//   unclosed   a single quote that is never closed.
// It reads the text the way bash does, enough to leave alone every place an
// apostrophe is a plain character or is not read at all:
//   - here-document bodies (<<'EOF', <<EOF, <<-EOF): text, never quotes;
//   - comments (# at the start of a word);
//   - double-quoted text, where a single quote is a plain character, except
//     inside a $( ) or a backtick there, where quotes are real again;
//   - $'...' strings, where \' is an escaped quote;
//   - a backslash-escaped apostrophe outside quotes, and so the '\'' form.
// Where its reading is simpler than bash's, it can go either way. A << read
// as a here-document in arithmetic makes it read less of the command, so it
// may miss a cut. A case pattern's ) inside a double-quoted $( ) ends that
// $( ) early, so a double-quoted apostrophe after it can look unclosed and a
// command that would run is blocked (review of #310); the block's own way
// through, the text in a file, still works. The replay over this repository's
// saved commands found no block of that shape.
//
// The hook, main(): the call arrives as JSON on stdin. The script prints one
// deny answer, or nothing, and always exits 0. It has no failure rule in the
// hook entry, so a crash or a hang lets the command through: a missed cut
// costs one failed command, a stuck guard would cost every command. It does
// nothing when the environment variable TK_QUOTE_GUARD is off, so a project
// can switch it off. It names no command of the toolkit: the plugin build
// rewrites command names in prompts, never in scripts.

const fs = require('fs');

// After <<: an optional - (strip leading tabs), blanks, then the delimiter,
// quoted ('EOF', "EOF", \EOF) or bare.
const HEREDOC_DELIMITER = /^(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\?([A-Za-z0-9_][A-Za-z0-9_.-]*))/;
const LETTER = /[A-Za-z]/;
const WORD_BREAK = /[\s;&|(]/;

// The position after the bodies of the pending here-documents, which start at
// `from` (the line after their opener) and end at their delimiter lines.
function skipBodies(text, from, pending) {
  let pos = from;
  for (const doc of pending) {
    for (;;) {
      if (pos >= text.length) return text.length;
      const nl = text.indexOf('\n', pos);
      const end = nl === -1 ? text.length : nl;
      let line = text.slice(pos, end).replace(/\r$/, '');
      if (doc.strip) line = line.replace(/^\t+/, '');
      pos = nl === -1 ? text.length : nl + 1;
      if (line === doc.delimiter) break;
    }
  }
  return pos;
}

// The first cut in the text: { index, kind } or null. A stack of frames
// tracks where quotes are real: 'shell' at the top and inside a $( ) (where
// `depth` counts the ( ) inside it), 'dq' inside double quotes, 'bt' inside
// backticks.
function findCut(text) {
  const n = text.length;
  const stack = [{ mode: 'shell', sub: false, depth: 0 }];
  const pending = [];
  let wordStart = true;
  let i = 0;
  while (i < n) {
    const frame = stack[stack.length - 1];
    const c = text[i];
    if (frame.mode === 'dq') {
      if (c === '\\') { i += 2; continue; }
      if (c === '"') { stack.pop(); i += 1; wordStart = false; continue; }
      if (c === '$' && text[i + 1] === '(') { stack.push({ mode: 'shell', sub: true, depth: 0 }); i += 2; wordStart = true; continue; }
      if (c === '`') { stack.push({ mode: 'bt' }); i += 1; wordStart = true; continue; }
      i += 1;
      continue;
    }
    // A shell or backtick frame: quotes, comments and here-documents are real.
    if (frame.mode === 'bt' && c === '`') { stack.pop(); i += 1; wordStart = false; continue; }
    if (c === '\\') { i += 2; wordStart = false; continue; }
    if (c === '\n') {
      i += 1;
      if (pending.length) { i = skipBodies(text, i, pending); pending.length = 0; }
      wordStart = true;
      continue;
    }
    if (c === '#' && wordStart) {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? n : nl;
      continue;
    }
    if (c === "'") {
      const close = text.indexOf("'", i + 1);
      if (close === -1) return { index: i, kind: 'unclosed' };
      if (LETTER.test(text[close + 1] || '')) return { index: close, kind: 'continues' };
      i = close + 1;
      wordStart = false;
      continue;
    }
    if (c === '$' && text[i + 1] === "'") {
      let j = i + 2;
      while (j < n && text[j] !== "'") j += text[j] === '\\' ? 2 : 1;
      if (j >= n) return null;                 // an unclosed $'...' is not an apostrophe cut
      i = j + 1;
      wordStart = false;
      continue;
    }
    if (c === '"') { stack.push({ mode: 'dq' }); i += 1; wordStart = false; continue; }
    if (c === '`') { stack.push({ mode: 'bt' }); i += 1; wordStart = true; continue; }
    if (c === '$' && text[i + 1] === '(') { stack.push({ mode: 'shell', sub: true, depth: 0 }); i += 2; wordStart = true; continue; }
    if (c === '(') { if (frame.sub) frame.depth += 1; i += 1; wordStart = true; continue; }
    if (c === ')') {
      if (frame.sub) { if (frame.depth > 0) frame.depth -= 1; else stack.pop(); }
      i += 1;
      wordStart = false;
      continue;
    }
    if (c === '<' && text[i + 1] === '<') {
      if (text[i + 2] === '<') { i += 3; wordStart = true; continue; }   // a here-string: its word is read as usual
      const m = HEREDOC_DELIMITER.exec(text.slice(i + 2));
      if (m) {
        pending.push({ strip: m[1] === '-', delimiter: m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]) });
        i += 2 + m[0].length;
        wordStart = false;
        continue;
      }
      i += 2;
      continue;
    }
    wordStart = WORD_BREAK.test(c);
    i += 1;
  }
  return null;
}

// Where the cut is, as a person reads it: line and column (from 1), and the
// text around it on that line, control characters shown as spaces.
function locate(text, index) {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const lineStart = before.lastIndexOf('\n') + 1;
  const lineEnd = text.indexOf('\n', index) === -1 ? text.length : text.indexOf('\n', index);
  const from = Math.max(lineStart, index - 30);
  const to = Math.min(lineEnd, index + 16);
  const near = (from > lineStart ? '...' : '') + text.slice(from, to).replace(/[\u0000-\u001f\u007f]/g, ' ') + (to < lineEnd ? '...' : '');
  return { line: line, column: index - lineStart + 1, near: near };
}

function judge(command) {
  if (typeof command !== 'string') return null;
  const cut = findCut(command);
  if (cut === null) return null;
  const at = locate(command, cut.index);
  const where = 'at line ' + at.line + ', column ' + at.column + ' (near `' + at.near + '`)';
  const what = cut.kind === 'continues'
    ? 'an apostrophe ends the single-quoted text ' + where + ' and a letter follows it, so bash would read the rest of the text as other words'
    : 'an apostrophe opens single-quoted text ' + where + ' that is never closed, so bash would stop with a quoting error';
  return {
    cut: { kind: cut.kind, line: at.line, column: at.column },
    reason: 'quote-guard blocked this command before it ran: ' + what + '. Put the text in a file instead: write it with the file-writing tool and pass the file ' +
      '(an inline program goes in a script file run with node or python, a commit message in a file passed to git commit -F).',
  };
}

// The hook's entry: read the call, print a deny answer or nothing, exit 0.
function main() {
  try {
    if (String(process.env.TK_QUOTE_GUARD || '').trim().toLowerCase() === 'off') return;
    const call = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (call === null || typeof call !== 'object' || call.tool_name !== 'Bash') return;
    const command = call.tool_input && call.tool_input.command;
    const verdict = judge(command);
    if (verdict === null) return;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason } }) + '\n');
  } catch (e) {
    // A crash lets the command through (see the header).
  }
}

if (require.main === module) main();

module.exports = { judge: judge, findCut: findCut, main: main };
