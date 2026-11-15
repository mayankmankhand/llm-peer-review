#!/usr/bin/env node
'use strict';
//
// test-quote-guard.js - assertions for quote-guard.js, the apostrophe check
// (issue #310): a Claude Code PreToolUse hook on Bash that blocks a command
// whose single-quoted text an apostrophe cuts, before bash runs it on the
// wrong words. Three times an inline Node program holding a possessive inside
// single quotes failed this way although a lesson warned about it.
//
// Maintainer-only: lives under scripts/, which never ships.
//
// The "reader" cases call judge() on command text alone. The "hook" cases run
// the script the way Claude Code runs it: a separate node process with the
// PreToolUse JSON on stdin. The script is loaded from whichever of
// .claude/scripts/ (shipped to every install) and scripts/ (this repository
// only) holds it, inside a try, so a missing or broken script fails each case
// by name instead of crashing the suite. Failure details stay on one line:
// the release gate shows only the last lines of a failing suite.
//
// Usage: node scripts/test-quote-guard.js

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CANDIDATES = [path.join(ROOT, '.claude', 'scripts', 'quote-guard.js'), path.join(ROOT, 'scripts', 'quote-guard.js')];
const SCRIPT = CANDIDATES.find(function (p) { return fs.existsSync(p); }) || CANDIDATES[0];

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
try { guard = require(SCRIPT); } catch (e) { loadError = e; }

// judge(command): null when the command passes, else { reason } naming the cut.
function judged(command) {
  if (!guard) return { error: 'quote-guard.js did not load: ' + (loadError && loadError.message) };
  try { return { result: guard.judge(command) }; } catch (e) { return { error: e.message }; }
}
function blocked(command) { const r = judged(command); return !r.error && r.result !== null && typeof r.result === 'object' && typeof r.result.reason === 'string'; }
function passes(command) { const r = judged(command); return !r.error && r.result === null; }
function show(command) { const r = judged(command); return r.error || JSON.stringify(r.result); }

// The PreToolUse input Claude Code sends for one Bash call.
function bashCall(command) {
  return { session_id: 'test', transcript_path: '/dev/null', cwd: ROOT, permission_mode: 'default',
    hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: command, description: 'test' }, tool_use_id: 'toolu_test' };
}
// Runs the script as Claude Code runs a hook: its exit status and the answer
// it printed, 'none' when it printed nothing.
function runHook(input, env) {
  if (!fs.existsSync(SCRIPT)) return { status: null, decision: 'missing', reason: 'no quote-guard.js in .claude/scripts/ or scripts/' };
  const r = spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify(input), encoding: 'utf8', timeout: 30000,
    env: Object.assign({}, process.env, { TK_QUOTE_GUARD: '' }, env || {}) });
  const got = { status: r.status, decision: 'none', reason: '', raw: (r.stdout || '') + (r.stderr || '') };
  if ((r.stdout || '').trim() !== '') {
    try {
      const h = JSON.parse(r.stdout).hookSpecificOutput || {};
      got.decision = h.hookEventName === 'PreToolUse' ? String(h.permissionDecision) : 'not-pretooluse';
      got.reason = String(h.permissionDecisionReason || '');
    } catch (e) { got.decision = 'not-json'; }
  }
  return got;
}

console.log('\n1. an apostrophe that cuts single-quoted text is blocked');
// The two recorded repeats (2026-10-28, 2026-11-10), rewritten with neutral
// text: an inline Node program holding a possessive inside single quotes.
const REPEAT_1 = "node -e 'const fs = require(\"fs\"); fs.appendFileSync(\"notes.md\", \"The replay's count and the page's link.\\n\")'";
const REPEAT_2 = "node -e 'const rule = \"a check that fails before the fix is the step's proof\"; console.log(rule.length)' 2>&1 | tail -2";
(function () {
  const r1 = judged(REPEAT_1);
  const r2 = judged(REPEAT_2);
  const names = function (r) { return !!(r.result && /file/.test(r.result.reason) && /apostrophe/.test(r.result.reason)); };
  check('310: an apostrophe that cuts single-quoted text is blocked with the file route named', blocked(REPEAT_1) && blocked(REPEAT_2) && names(r1) && names(r2),
    show(REPEAT_1) + ' | ' + show(REPEAT_2));
})();
check('310: an unclosed single quote is blocked', blocked("echo don't stop") && blocked("grep -n 'unfinished pattern file.txt"),
  show("echo don't stop") + ' | ' + show("grep -n 'unfinished pattern file.txt"));
check('310: the reason names where the quote was cut', (function () {
  const r = judged(REPEAT_2);
  return !!(r.result && r.result.reason.indexOf("step'") !== -1 && /line 1/.test(r.result.reason));
})(), show(REPEAT_2));

console.log('\n2. text that cannot break passes');
// Each shape holds an apostrophe that bash reads as a plain character, or no
// apostrophe at all. Blocking any of them would stop a command that works.
const CLEAN = [
  ['a here-document body', "cat > notes.md <<'EOF'\nThe owner's call, and the plan's steps.\nEOF"],
  ['an unquoted here-document body', 'cat > notes.md <<EOF\nIt\'s here.\nEOF\necho done'],
  ['a tab-stripped here-document body', "cat <<-'EOF'\n\tdon't\n\tEOF"],
  ["Claude Code's commit form with a quote and an apostrophe in the message", 'git commit -m "$(cat <<\'EOF\'\nHe said "don\'t" twice.\n\nCo-Authored-By: Claude\nEOF\n)"'],
  ['a comment', "ls -la # check what's there\necho next"],
  ['double-quoted text', 'echo "it\'s the owner\'s call"'],
  ['an inline program in double quotes', 'python3 -c "print(\'it\')" && node -e "console.log(\'x\')"'],
  ["a $'...' string", "printf $'it\\'s\\n'"],
  ['a backslash-escaped apostrophe outside quotes', "echo it\\'s"],
  ["the '\\'' form", "echo 'it'\\''s the owner'\\''s call'"],
  ['a single-quoted span followed by a double-quoted one', "echo 'a'\"b\""],
  ['a plain command', 'git status --short'],
  ['a single-quoted span followed by a dollar or a slash', "echo 'a'$HOME 'b'/c"],
  ['a command substitution in double quotes holding single quotes', "echo \"$(printf '%s' 'x')\""],
  ['an awk program', "awk -F'\\t' '{print $1}' data.tsv | sort | uniq -c"],
];
(function () {
  const wrong = CLEAN.filter(function (c) { return !passes(c[1]); });
  check('310: text that cannot break passes', guard !== null && wrong.length === 0,
    guard === null ? show('') : wrong.map(function (c) { return c[0] + ': ' + show(c[1]); }).join(' | '));
})();

console.log('\n3. the hook, run the way Claude Code runs it');
check('310: the hook answers deny for a cut command and nothing for a clean one', (function () {
  const cut = runHook(bashCall(REPEAT_1));
  const clean = runHook(bashCall('git status --short'));
  const other = runHook(Object.assign(bashCall(''), { tool_name: 'Read', tool_input: { file_path: "/notes/it's.md" } }));
  return cut.status === 0 && cut.decision === 'deny' && /apostrophe/.test(cut.reason) &&
    clean.status === 0 && clean.decision === 'none' && other.status === 0 && other.decision === 'none';
})(), JSON.stringify([runHook(bashCall(REPEAT_1)).decision, runHook(bashCall('git status --short')).decision]));
check('310: the check does nothing when it is switched off', (function () {
  const off = runHook(bashCall(REPEAT_1), { TK_QUOTE_GUARD: 'off' });
  return off.status === 0 && off.decision === 'none';
})(), JSON.stringify(runHook(bashCall(REPEAT_1), { TK_QUOTE_GUARD: 'off' })));
check('310: input that is not a tool call gets no answer and exit 0', (function () {
  if (!fs.existsSync(SCRIPT)) return false;
  const r = spawnSync(process.execPath, [SCRIPT], { input: "{not json, don't", encoding: 'utf8', timeout: 30000 });
  return r.status === 0 && (r.stdout || '').trim() === '';
})());

console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach((f) => console.log('  - ' + f));
process.exit(1);
