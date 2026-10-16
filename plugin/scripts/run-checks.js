#!/usr/bin/env node
'use strict';
// run-checks.js - the guarded checks runner (issue #221, rule M16).
//
// A review receipt, a plan's must-check line and a project's own test step all
// ask the same question: run this command, does its output show what we
// expect? Until now a model read the output and decided. This script runs a
// list of checks from the project root and decides each one from a
// machine-readable expectation, so pass or fail is the machine's verdict and
// the saved output is the evidence the review page shows.
//
//   node run-checks.js --checks <file.json> --out <dir> [--timeout <ms>] [--rerun-failures]
//   node run-checks.js --plan <plan.md> --lint
//   node run-checks.js --plan <plan.md> --step <N> --phase before|after [--timeout <ms>]
//   node run-checks.js --plan <plan.md> --tally
//   node run-checks.js --checks <file.json> --out <dir> --full [...]
//   node run-checks.js --history [--since <time>]
//
// (The --plan forms read a plan's own check lines; see "Plan mode" below. The
// last two are the full test step's history; see "Full runs" below.)
//
// <file.json> is a JSON array of { id, check, expect }:
//   id      a filename stem: letters, digits, . _ - only, unique in the file
//   check   one shell line, read-only (the allow-list below decides)
//   expect  an object with exactly one of (a prose string, accepted until
//           8.0.0, is now an error like any malformed expect)
//             { "exit": 0 }              the exit code must equal this integer
//             { "match": "regex" }       the saved output must match (multiline)
//             { "noMatch": "regex" }     the saved output must not match
//             { "lines": {min, max} }    non-empty output lines within bounds
//           noMatch and lines pass only when the command ran cleanly: exit 0,
//           or exit 1 with nothing on stderr (grep's no-match), or exit 141
//           with nothing on stderr (a stage cut short by a later `head`). A
//           command that failed (a misspelled path: exit 2, 127) fails both,
//           so an error never confirms an absence or a count. lines counts
//           stdout only. A pipeline runs with pipefail, so a failed early
//           stage is the pipeline's exit code, not the last stage's.
//
// Every check's output is saved as <out>/<id>.txt: stdout, then stderr, then a
// last line `exit N`. That is the exact shape render-html.js reads at a
// finding's receipt slot, and the file is capped at 60,000 bytes (a
// `[truncated]` line marks the cut) because the renderer refuses a receipt
// file over 64 KB. <out> must resolve, through realpath on both sides, under
// the working copy's reports/ folder or the system temp folder: a check's
// output is working data, never a tracked file.
//
// Output, on stdout: exactly one JSON object
//   { "checks": [ { "id", "verdict", "exit", "stdoutFile", "detail",
//                   "ms", "slow", "flaky" } ... ],
//     "summary": { "pass", "fail", "error" },
//     "flags": { "slow", "flaky" } }
// verdict is pass, fail or error. `exit` is the check's exit code (124
// on a timeout, 143 when the output passed the 16 MB buffer and the check was
// stopped, null when nothing ran); `stdoutFile` is the saved file's path
// relative to the project root (absolute when the out folder sits outside it,
// null when nothing was written); `detail` is the last lines of the output for
// a fail, the reason for an error, and empty otherwise. `summary` counts
// verdicts only; `flags` counts the two marks below.
//
// Time, slow and re-run (issue #231, rule M17). A plan step's check runs before
// the work and after it, and that loop needs three facts a verdict alone does
// not carry:
//   ms      the wall time of the run whose output is saved (null when nothing
//           ran). A slow suite is a finding to fix, not a reason to wait.
//   slow    true when a run took over half of --timeout.
//   flaky   true when --rerun-failures re-ran a fail and the second run
//           passed. The verdict stays `fail`: a flip-flop must never read as
//           green to a caller that only counts summary.fail (M5). The failing
//           first run is kept as <out>/first-run/<id>.txt, the second run is
//           <id>.txt. A fail that fails again is a plain fail, its first run
//           kept the same way. A timeout or an overflow is never re-run: that
//           would spend the whole limit again, and slowness is what `slow`
//           reports. Without the flag nothing is re-run, so review receipts
//           behave exactly as before.
// The printed object is also saved as <out>/results.json, with `at` (when the
// run started, ISO time) and `head` (the commit HEAD named, null outside a
// repository) added, and each row's `check` and `expect` (what ran, so a tally
// can tell a check edited after its run), so a later tally can read the
// verdicts and their order. It is saved only when at least one check ran, so a
// run whose every check was refused still writes nothing. A folder several
// runs share (a review's receipts) keeps every run's rows (issue #252): each
// call appends its rows, each row carrying its own run's `at` and `head`, a
// `runs` list holds one entry per call, and the top-level fields are the
// latest call's. See saveRecord.
//
// Plan mode (issue #231, rule M17). A plan step names its own checks in one
// fixed shape, and the runner reads that shape itself, so no model copies a
// plan line into a checks file between the plan and the run:
//   - Check target `<id>`: `<command>` - before `<expect>` - after `<expect>`
//   - Check guard `<id>`: `<command>` - `<expect>`
//   - Check: no target - <reason>
// A span holding a backtick is fenced with two (`` a`b ``). <expect> is the
// runner's own JSON object; a plan check never takes a prose expect, because a
// tally cannot read one. A target fails before the step's work for the reason
// its before expect states and passes after; a guard passes both times; a step
// with no target (a refactor, say) may still carry guards. A step's lines are
// the ones indented under its `- [ ] 🟥 **Step N: name**` line: the next line
// at the left margin (another step, a heading, any other text) ends it. Lines
// in a code fence or an HTML comment are never read, as the page shows them as
// code or not at all (CommonMark's reading: a backtick fence's info string
// holds no backtick, and a fence in a list item ends with its item). No check
// is dropped in silence. Inside a step, a line that looks meant as a check
// line but does not parse (a [ ] box, a * bullet or none, a quote mark,
// lowercase, bold, a missing Check, target or guard) is a lint problem; so is
// a well-formed check line outside every step, a line in the Tasks section or
// under a step that reads like a step line but does not parse (not bold, no
// colon, an [X] box, a missing or other status mark, indented), a step number
// used twice (the two would share one record folder), and a fence or comment
// never closed.
//   --lint    every problem above, and every line that would not run: a step
//             with neither a target nor a no-target line, an id used twice in
//             a step, an expect the runner would refuse (or a lines expect
//             with a key other than min and max, which a run would ignore), a
//             command the guard would refuse (judged the same way a run
//             judges it, without running it), a target whose before and after
//             expects are the same (in any key order).
//   --phase   runs one step's checks with that phase's expects. It refuses
//             (nothing runs) while that step, or the plan outside its steps,
//             has a lint problem, re-runs a failure once (the --rerun-failures
//             rule), and writes to reports/checks/<plan file name>/step-<N>/
//             <phase>/, cleared first. Every folder on that path from
//             reports/ down must be a real folder: a link anywhere on it is
//             refused before anything is cleared or written, so a record never
//             lands outside reports/ or in another step's folder. Each row
//             carries its `role`. In a before phase a target's output is
//             also held against its after expect: one that already meets it
//             fails ("it already meets its after expect"), not retried,
//             because a pass after the work would then prove nothing (M17).
//   --tally   reads each step's two results.json files and gives each step a
//             status: proved (every target passed its before expect and its
//             after expect without a flake, every guard that passed before
//             passed after, and the before record is older than the after
//             one), unproved (with its reasons), noTarget (with its reason;
//             unproved instead when it has guards whose records do not hold
//             up), missing (no target and no no-target line) or problem (any
//             other lint problem). A record counts only when it was written for
//             this plan, step and phase, and a row only when it ran the
//             command, expect and role the plan names now, so neither a check
//             edited after its run nor another plan with the same file name
//             ever proves a step. A record a --checks run wrote names no plan,
//             step or phase and counts on its rows alone; a row with no
//             command recorded (an older runner's) is matched by its id, and
//             the step's `notes` say so. A flaky guard and a guard already
//             failing before are listed, not counted against the step: they
//             are older checks, a finding for review (M17). The plan's
//             problems outside any step are listed, and summary.problems
//             counts them.
// Full runs (issue #248). A full test run that doubled in five days raised
// nothing, because each run's time stayed in the folder it wrote. --full marks
// a --checks list as the project's whole test step (/execute's and /merge's;
// never a review receipt or a plan step) and keeps its cost:
//   history  one row per run appended to reports/checks/history.jsonl in the
//            main working copy (a worktree's run too, so the baseline
//            outlives the worktree): when it started, the commit, the list's
//            key (a hash of its content, so a fallback list written fresh each
//            time keeps one key), the whole run's ms, whether it passed, and
//            the baseline it was measured against and the one after it.
//   grew     the first passing run is the baseline. A passing run over 1.5x
//            the baseline sets flags.grew to 1, and its time becomes the new
//            baseline, so one growth is flagged once. After two fast passes in
//            a row (each under two-thirds of the same baseline; failing and
//            skipped runs between them do not count), the slower of the two
//            becomes the new baseline with no flag, so a suite made faster is
//            measured against its new time (issue #249) and one fluke cannot
//            make the next normal run read as growth (issue #250). A run that
//            failed never moves the baseline. `cost` on the printed object (and in
//            results.json) holds { ms, baselineMs, grew }.
//   skip     a run on a working tree (every tracked file and every untracked
//            file git does not ignore, edits and modes included) and a list
//            that the last run on them passed is skipped: nothing runs, the
//            object carries the passing run's summary and rows plus
//            `skipped: { from, head, note }`, the note reads "skipped: nothing
//            changed since the passing run at <time> (<commit>)", results.json
//            is still written, and a history row marked skipped keeps the
//            baseline. A failing last run on the same tree always runs again.
//            The tree is read with `git ls-files` alone, which never writes or
//            locks the index. Ignored files and refs are not part of it, and a
//            folder outside a repository has no fingerprint, so it never
//            skips; --no-skip runs regardless. A plan step never skips.
// --history [--since <time>] prints what the step cost since a time: runs,
// skipped, totalMs, latestMs, baselineMs, and each growth with the baseline it
// grew from.
//
// The plan must be a regular file inside the project, read through realpath.
// Exit 0 once the plan was read (the statuses and problems are the result);
// exit 1, with one line on stderr, for a plan outside the project, unreadable
// or not a regular file, an unknown step, a lint problem (phase runs), a link
// on the record path, or a bad argument.
//
// Exit code 0 whenever the checks file validated, fails and errors included:
// the verdicts are the result. Exit 1, with one line on stderr and nothing run
// or written, for a malformed checks file, a bad id, or an --out folder that
// is not allowed. One stderr line per refused or errored check.
//
// Why there is a guard. Each receipt check used to be its own tool call and
// went through the permission system one by one. A script with a seeded allow
// row would run every finder-written command unprompted, so the runner is a
// guarded executor, not a shell: a check runs only when every segment of it
// starts with a word on the read-only allow-list and its arguments pass that
// word's own rule. Command substitution, redirection to a file, subshells,
// brace groups, background jobs and environment assignments are refused
// before anything runs. Reads are confined as well: an argument that names an
// existing file or folder must resolve, through realpath, under the project
// root (the harmless device files aside), and a home-relative path (~, $HOME),
// a variable expansion ($PATH) and a parent folder are refused, so a check
// reads the project and nothing else: an allowed reader with the run of the
// disk would carry any secret a steered finder named into the review's
// receipts. The path is resolved the way the kernel will resolve it, one
// segment at a time with every existing prefix through realpath, because a
// lexical resolve cancels `link/..` before anyone looks at the link and the
// kernel does not (second-round audit of the 7.6.3 review: `cat d/../x` with
// d a symlink read the project's parent). The fence judges only the paths a
// check names, so a reader that follows the links it discovers while walking
// the tree (grep -R, rg -L, find -L, diff -r) has that flag refused, as does
// one that opens whatever a folder or a list hands it (diff on a folder,
// sort and wc --files0-from, file -f, find -files0-from), while the forms
// that follow only a named link stay allowed (grep -r, rg, find -H; review of
// 7.6.4, R17). A refused check gets verdict `error` with the reason, no
// file, and nothing executed.
//
// Two spellings the audit used to slip a value past a rule, and the answer to
// each: GNU getopt accepts any unambiguous prefix of a long option (sort
// --out= is --output=, --co= is --compress-program=), so a rule that refuses a
// long option refuses its prefixes too; and a short option that takes a value
// accepts it attached (grep -e. is grep -e .), so grep's and rg's short
// clusters are read letter by letter before the pattern slot is exempted.
//
// What bash runs is what the guard judged. The check text is never handed to
// bash as written: the tokenizer splits it into words, the guard judges those
// words, and rebuildCommand() writes a new line from them with every word in
// single quotes (review of 7.6.3, R1). Bash therefore performs no expansion of
// its own on the line it runs: no wildcard, no tilde, no variable, no ANSI-C
// quote. A spelling that would have expanded after the guard looked (an
// unquoted *, $HOME inside a word, $'...') is refused by the tokenizer with a
// reason that says so, rather than quietly run as literal text, so a finder
// learns to name the file. The one expansion the runner performs itself is the
// node script path (${CLAUDE_PLUGIN_ROOT}, ~ and $HOME forms), and the
// ${CLAUDE_PLUGIN_ROOT} literal in any other word is substituted from the
// environment BEFORE the guard judges that word, so a path built from it is
// fenced like any other (and stays inert text when the variable is unset).
//
// Dependency-free, like every script here. Diagnostics go to stderr; stdout
// is the one JSON object. The script names no command of the toolkit's own,
// because the plugin build rewrites command names in prompts, never in
// scripts.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_TIMEOUT_MS = 120000;
const OUTPUT_CAP_BYTES = 60000;        // render-html.js refuses a receipt over 64 KB
const DETAIL_LINES = 10;
const DETAIL_CHARS = 800;
const MAX_BUFFER = 16 * 1024 * 1024;
const TIMEOUT_EXIT = 124;              // the exit code `timeout(1)` uses
const SIGPIPE_EXIT = 141;              // 128 + SIGPIPE: a stage whose reader closed early
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const EXPECT_KEYS = ['exit', 'match', 'noMatch', 'lines'];

// ---------------------------------------------------------------------------
// The tokenizer. A small shell-word reader: single quotes, double quotes and
// backslash escapes build words; an unquoted |, ||, &&, ; or newline ends a
// segment. It refuses, by returning a reason, every unquoted construct that
// could run something the allow-list never saw or write somewhere: a subshell
// or process substitution, a brace group, a here-document, a background job,
// and any redirection other than the exact harmless forms 2>&1, 2>/dev/null,
// >/dev/null, 1>/dev/null and &>/dev/null (plus a plain `< file`, which reads
// a file the guard judges). Command substitution ($( and backticks) and brace
// parameter expansion (${) are refused unquoted and inside double quotes,
// where bash expands them; inside single quotes they are literal text (a grep
// pattern for a markdown backtick, say), which bash never expands, so they
// pass (a live run refused real receipts over this, issue 221 Step 9). One
// brace expansion is allowed as an exact literal: ${CLAUDE_PLUGIN_ROOT}, the
// path the plugin build writes in place of .claude/ in every shipped prompt.
// It expands to a folder and nothing else, so it is held in the word as a
// sentinel character and substituted by the guard (from the environment) and
// the rebuild; any other ${ form (${x@P} expands prompt escapes and can run a
// command) stays refused.
//
// Because the rebuilt line quotes every word, bash expands nothing in it. The
// spellings that bash would have expanded in the raw text are refused here,
// each with a reason: $'...' and $"..." (ANSI-C and locale quoting), $HOME
// anywhere but the start of a word (at the start the guard judges it, and the
// node script path needs it), and an unquoted *, ? or [ (the runner does not
// expand wildcards, so a glob would silently match nothing).
//
// The result: { segments, operators, redirections, meta } or { error }.
//   segments      one array of word strings per segment, the ${CLAUDE_PLUGIN_ROOT}
//                 literal spelled out (the rule functions and the tests read this)
//   operators     per segment, the operator that ended it: '|', '||', '&&', ';',
//                 '\n', or null for the last one
//   redirections  per segment, the safe redirection forms consumed, in order
//   meta          per segment, per word: { raw, input, quoted, quote }
//                 raw     the word with the plugin-root sentinel still in it
//                 input   true when the word is the file of an unquoted `<`
//                         (the word keeps a leading `<`, as before)
//                 quoted  true when the word began inside quotes
//                 quote   the quote character that opened it, or null
// ---------------------------------------------------------------------------
const PLUGIN_ROOT_LITERAL = '${CLAUDE_PLUGIN_ROOT}';
const PLUGIN_ROOT_SENTINEL = '\u0001';
const SEGMENT_JOINERS = ['|', '||', '&&'];   // an operator that needs a command on both sides
const SAFE_REDIRECTIONS = ['2>&1', '2>/dev/null', '>/dev/null', '1>/dev/null', '&>/dev/null'];
// Every C0 control character but tab, newline and CR, plus DEL. A NUL would
// make spawnSync throw (the whole run would stop with no JSON), and the rest
// (ESC, vertical tab, the sentinel below) have no place in a command line.
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
function tokenize(original) {
  if (CONTROL_CHAR_RE.test(original)) return { error: 'refused: control character in the command' };
  const text = original;
  const segments = [];
  const operators = [];
  const redirections = [];
  const meta = [];
  let words = [];
  let wordMeta = [];
  let segRedirs = [];
  let cur = '';
  let have = false;        // a word is open (so '' quoted is still a word)
  let curMeta = null;      // the open word's meta
  let inSingle = false;
  let inDouble = false;
  let pendingInput = false;   // an unquoted < was read; the next word is its file
  let prevOp = null;          // the operator that ended the last pushed segment
  const n = text.length;
  const openWord = (quote) => {
    if (have) return;
    have = true;
    curMeta = { raw: '', input: pendingInput, quoted: quote !== null, quote };
    if (pendingInput) { cur = '<'; pendingInput = false; }
  };
  const flushWord = () => {
    if (have) { curMeta.raw = cur; words.push(cur); wordMeta.push(curMeta); cur = ''; have = false; curMeta = null; }
  };
  // Ends a segment on `op` (null at the end of the text).
  const flushSegment = (op) => {
    flushWord();
    if (pendingInput) return 'refused: input redirection (<) without a file';
    if (words.length === 0) {
      if (segRedirs.length) return 'refused: a redirection without a command';
      if (SEGMENT_JOINERS.indexOf(op) !== -1) return "refused: empty command before '" + op + "'";
      if (SEGMENT_JOINERS.indexOf(prevOp) !== -1) return "refused: empty command after '" + prevOp + "'";
      return null;
    }
    segments.push(words); meta.push(wordMeta); redirections.push(segRedirs); operators.push(op);
    words = []; wordMeta = []; segRedirs = [];
    prevOp = op;
    return null;
  };
  const boundary = (s) => s === '' || /^[\s;|&]/.test(s);   // what may follow a redirection form
  // The expansions bash performs outside single quotes; each would run or read
  // something the allow-list never saw. An escaped one (\` or \$) is handled by
  // the backslash branches before these checks and stays literal.
  const expansion = (i, quoted) => {
    const c = text[i];
    const next = text[i + 1] || '';
    if (c === '`') return 'refused: command substitution (backtick)';
    if (c === '$' && next === '(') return 'refused: command substitution ($( ))';
    if (c === '$' && next === '{') return 'refused: brace parameter expansion (${ }); only the exact literal ${CLAUDE_PLUGIN_ROOT} is allowed';
    if (c === '$' && !quoted && (next === "'" || next === '"')) return "refused: ANSI-C or locale quoting ($' and $\"); write the characters themselves";
    if (c === '$' && /^\$HOME(?![A-Za-z0-9_])/.test(text.slice(i))) {
      if (cur !== '') return 'refused: $HOME inside a word (the runner expands nothing; name the file, or put $HOME at the start of the word)';
      return null;
    }
    if (c === '$' && /[A-Za-z_0-9?@#*!-]/.test(next)) return 'refused: variable expansion ($PATH and the like)';
    return null;
  };
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inSingle) { if (c === "'") inSingle = false; else cur += c; continue; }
    if (inDouble) {
      if (c === '"') { inDouble = false; continue; }
      if (c === '\\' && i + 1 < n) {
        // Bash removes the backslash only before these five; elsewhere both stay.
        const d = text[i + 1];
        if (d === '$' || d === '`' || d === '"' || d === '\\' || d === '\n') { cur += d; i++; continue; }
        cur += c; continue;
      }
      if (c === '$' && text.startsWith(PLUGIN_ROOT_LITERAL, i)) { cur += PLUGIN_ROOT_SENTINEL; i += PLUGIN_ROOT_LITERAL.length - 1; continue; }
      const bad = expansion(i, true);
      if (bad) return { error: bad };
      cur += c;
      continue;
    }
    if (c === '\\') { if (i + 1 < n) { openWord(null); cur += text[i + 1]; i++; } continue; }
    if (c === '$' && text.startsWith(PLUGIN_ROOT_LITERAL, i)) { openWord(null); cur += PLUGIN_ROOT_SENTINEL; i += PLUGIN_ROOT_LITERAL.length - 1; continue; }
    const bad = expansion(i, false);
    if (bad) return { error: bad };
    if (c === "'") { openWord("'"); inSingle = true; continue; }
    if (c === '"') { openWord('"'); inDouble = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { flushWord(); continue; }
    if (c === '\n' || c === ';') { const e = flushSegment(c); if (e) return { error: e }; continue; }
    if (c === '|') {
      let op = '|';
      if (text[i + 1] === '|') { i++; op = '||'; }
      const e = flushSegment(op);
      if (e) return { error: e };
      continue;
    }
    if (c === '&') {
      if (text[i + 1] === '&') { i++; const e = flushSegment('&&'); if (e) return { error: e }; continue; }
      const rest = text.slice(i);
      if (!have && !pendingInput && rest.startsWith('&>/dev/null') && boundary(rest.slice('&>/dev/null'.length))) {
        segRedirs.push('&>/dev/null');
        i += '&>/dev/null'.length - 1;
        continue;
      }
      return { error: 'refused: background operator or unsupported redirection (&)' };
    }
    if (c === '>') {
      const rest = text.slice(i);
      const fd = have && !curMeta.quoted ? cur : '';
      let form = null;
      if (fd === '2' && rest.startsWith('>&1')) form = '>&1';
      else if ((fd === '' || fd === '1' || fd === '2') && rest.startsWith('>/dev/null')) form = '>/dev/null';
      if (form && !pendingInput && (fd !== '' || !have) && boundary(rest.slice(form.length))) {
        segRedirs.push(fd + form);
        cur = ''; have = false; curMeta = null;   // the fd digit was part of the redirection
        i += form.length - 1;
        continue;
      }
      return { error: 'refused: output redirection' };
    }
    if (c === '<') {
      const next = text[i + 1] || '';
      if (next === '<') return { error: 'refused: here-document or here-string (<<)' };
      if (next === '(') return { error: 'refused: process substitution (<( ))' };
      if (next === '>' || next === '&') return { error: 'refused: unsupported redirection (<' + next + ')' };
      if (pendingInput) return { error: 'refused: input redirection (<) without a file' };
      if (have) {
        if (/^\d+$/.test(cur) && !curMeta.quoted) return { error: 'refused: unsupported redirection (' + cur + '<)' };
        flushWord();                     // `grep x<f` is `grep x < f`
      }
      pendingInput = true;               // a plain `< file` reads a file; the word is judged
      continue;
    }
    if (c === '(' || c === ')') return { error: 'refused: subshell or process substitution ( )' };
    if (c === '{' || c === '}') return { error: 'refused: brace group or brace expansion { }' };
    if (c === '*' || c === '?' || (c === '[' && !(cur === '' && !have && /^(\s|$)/.test(text[i + 1] || '')))) {
      return { error: "refused: unquoted wildcard '" + c + "' (the runner does not expand wildcards; name the file, or quote the pattern)" };
    }
    openWord(null);
    cur += c;
  }
  if (inSingle || inDouble) return { error: 'refused: unterminated quote' };
  const e = flushSegment(null);
  if (e) return { error: e };
  // The guard and the tests read the words with the one allowed brace
  // expansion spelled out; meta.raw keeps the sentinel for the substitution.
  return {
    segments: segments.map((ws) => ws.map((w) => w.split(PLUGIN_ROOT_SENTINEL).join(PLUGIN_ROOT_LITERAL))),
    operators, redirections, meta,
  };
}

// The ${CLAUDE_PLUGIN_ROOT} literal, as the guard and the rebuild see it: the
// folder from the environment when the variable is set, else the inert
// literal text (the rebuilt line quotes it, so bash never expands it).
function pluginRootValue(env) {
  const v = env && typeof env.CLAUDE_PLUGIN_ROOT === 'string' ? env.CLAUDE_PLUGIN_ROOT : '';
  return v !== '' ? v : null;
}
function substitutePluginRoot(raw, env) {
  if (raw.indexOf(PLUGIN_ROOT_SENTINEL) === -1) return raw;
  const v = pluginRootValue(env);
  return raw.split(PLUGIN_ROOT_SENTINEL).join(v === null ? PLUGIN_ROOT_LITERAL : v);
}

// ---------------------------------------------------------------------------
// The allow-list. One constant, one entry per first word, each a function of
// the segment's arguments returning null (allowed) or the refusal reason. The
// comment on each entry says why the command is read-only, or which of its
// arguments would make it write or execute and are therefore refused.
// ---------------------------------------------------------------------------
const ok = () => null;
const flagIs = (a, names) => names.some((f) => a === f || a.startsWith(f + '='));
// GNU getopt_long (sort, git's option parser too) takes any unambiguous
// prefix of a long option: --out=x is --output=x. `shortest` is the shortest
// prefix that is unambiguous for that program, so a refusal of the full
// option covers every spelling of it, with or without a value.
function longOptionIs(a, name, shortest) {
  const opt = a.split('=')[0];
  return opt.length >= shortest.length && opt.length <= name.length && name.startsWith(opt);
}
// A short-flag cluster (-rnR) read letter by letter, the way grepPositions
// reads one: the first letter that takes a value owns the rest of the word
// (grep -eR is the pattern R, not the flag -R), so the reading stops there.
// True when `letter` is a flag of the cluster.
function clusterHasFlag(a, letter, valueLetters) {
  if (a.length < 2 || a[0] !== '-' || a[1] === '-') return false;
  for (let k = 1; k < a.length; k++) {
    if (a[k] === letter) return true;
    if (valueLetters.indexOf(a[k]) !== -1) return false;
  }
  return false;
}

// sed: an address-print script (1,3p; /re/p; /a/,/b/p) or a plain
// substitution s<d>pattern<d>replacement<d>[flags] with <d> one of / | # , and
// flags from g i p I and digits only. A `;` list of address prints
// (2p;11,17p) is one print script, which finders write to quote two spots of a
// file at once. Nothing else, so no e (execute), w or W (write), r or R (read
// another file), and nothing but another address print after a `;`.
const SED_PRINT_RE = /^(\d+|\$|\/(?:[^\/\\]|\\.)+\/)(,(\d+|\$|\/(?:[^\/\\]|\\.)+\/))?p$/;
const SED_FLAGS_RE = /^-[nEr]+$/;
function isSedPrintList(s) {
  const parts = s.split(';').map((p) => p.trim());
  return parts.every((p) => SED_PRINT_RE.test(p));
}
function isSedSubstitution(s) {
  if (s.length < 4 || s[0] !== 's') return false;
  const d = s[1];
  if ('/|#,'.indexOf(d) === -1) return false;
  const esc = '\\' + d;
  const part = '(?:[^' + esc + '\\\\]|\\\\.)*';
  return new RegExp('^s' + esc + part + esc + part + esc + '[gipI0-9]*$').test(s);
}
function sedRule(args) {
  const scripts = [];
  let positionalScript = false;
  let afterDashDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!afterDashDash) {
      if (a === '--') { afterDashDash = true; continue; }
      if (a === '-e') {
        if (i + 1 >= args.length) return 'refused: sed -e without a script';
        scripts.push(args[++i]);
        continue;
      }
      if (a.length > 1 && a[0] === '-') {
        if (SED_FLAGS_RE.test(a)) continue;
        return "refused: sed flag '" + a + "' (only -n, -E and -r are allowed; -i, -f, -s, -z and the rest are not)";
      }
    }
    if (!positionalScript && scripts.length === 0) { scripts.push(a); positionalScript = true; continue; }
    // every later non-flag argument is an input file, which sed only reads
  }
  for (const s of scripts) {
    if (!isSedPrintList(s) && !isSedSubstitution(s)) {
      return "refused: sed script '" + s + "' is not an address print (1,3p; /re/p), a ; list of them (2p;11,17p) or a plain substitution (s/a/b/g)";
    }
  }
  return null;
}

// find: every action that writes or runs something is named here; the rest
// of find only walks and prints. -L and -follow make the walk follow every
// symbolic link it finds, so a link to an outside folder would list that
// folder's names (R17); -H follows only the starting points, which the fence
// judges, and -P follows none, so both stay. -files0-from reads the starting
// points from a file, so the walk would begin wherever that file says.
const FIND_REFUSED = ['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprintf', '-fls', '-fprint0'];
function findRule(args) {
  for (const a of args) {
    if (FIND_REFUSED.indexOf(a) !== -1) return "refused: find " + a + " writes or runs a command";
    if (a === '-follow') return 'refused: find -follow' + SYMLINK_WALK;
    if (/^-[HLP]*L[HLP]*$/.test(a)) return 'refused: find -L' + SYMLINK_WALK;
    if (a === '-files0-from') return 'refused: find -files0-from walks every starting point a list names, which the read fence cannot judge';
  }
  return null;
}

// git: a read-only subcommand, optionally after --no-pager. No other global
// option: -c and --config-env set config (an alias with a ! runs a program,
// core.fsmonitor runs one on status), -C and --git-dir retarget the
// repository, --exec-path swaps the git binaries. Per subcommand, the
// arguments that write (branch -d, --output) or run a program (--ext-diff, -O)
// are refused.
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'rev-list', 'ls-files', 'ls-tree',
  'merge-base', 'cat-file', 'describe', 'shortlog', 'name-rev', 'blame', 'grep', 'check-ignore', 'branch',
  'worktree', 'config', 'stash']);
const GIT_BRANCH_OK = new Set(['--list', '--show-current', '-a', '-r', '--all', '--contains', '--merged', '--no-merged']);
const GIT_BRANCH_LISTING = ['--list', '--contains', '--merged', '--no-merged'];
const GIT_CONFIG_READERS = ['--get', '--get-all', '--list', '-l'];
const GIT_CONFIG_OK = new Set(GIT_CONFIG_READERS.concat(['--local', '--global', '--system', '--worktree', '--file', '-f',
  '--show-origin', '--show-scope', '--name-only', '-z', '--null', '--type', '--bool', '--int', '--bool-or-int', '--path',
  '--default', '--includes', '--no-includes']));
function gitRule(args) {
  let i = 0;
  if (args[0] === '--no-pager') i = 1;
  const sub = args[i];
  if (sub === undefined) return 'refused: git with no subcommand';
  if (sub[0] === '-') return "refused: git global option '" + sub + "' (only --no-pager may precede the subcommand)";
  if (!GIT_READ.has(sub)) return "refused: git subcommand '" + sub + "' is not read-only";
  const rest = args.slice(i + 1);
  for (const a of rest) {
    // Prefixes too (--out, --ext, --open): git's parse-options takes an unambiguous
    // prefix for most options; where it does not, the refusal costs nothing.
    if (longOptionIs(a, '--output', '--ou') || longOptionIs(a, '--ext-diff', '--ext') || longOptionIs(a, '--open-files-in-pager', '--op')
      || a === '-O' || a.startsWith('-O')) {
      return "refused: git argument '" + a + "' writes a file or runs a program";
    }
  }
  if (sub === 'branch') {
    const listing = rest.some((a) => flagIs(a, GIT_BRANCH_LISTING));
    for (const a of rest) {
      if (a[0] === '-') {
        if (GIT_BRANCH_OK.has(a) || /^--(contains|merged|no-merged)=/.test(a)) continue;
        return "refused: git branch argument '" + a + "' (only listing flags are allowed)";
      }
      if (!listing) return 'refused: git branch with a name creates a branch; use --list to search';
    }
  } else if (sub === 'worktree') {
    if (rest[0] !== 'list') return 'refused: git worktree only as git worktree list';
  } else if (sub === 'stash') {
    if (rest[0] !== 'list') return 'refused: git stash only as git stash list';
  } else if (sub === 'config') {
    if (GIT_CONFIG_READERS.indexOf(rest[0]) === -1) return 'refused: git config only with --get, --get-all, --list or -l first';
    for (const a of rest) {
      if (a[0] === '-' && !GIT_CONFIG_OK.has(a) && !/^--(type|default|file)=/.test(a)) {
        return "refused: git config argument '" + a + "' is not a read option";
      }
    }
  }
  return null;
}

// node: only the toolkit's own read-only scripts, at one of the four places
// they live: the project's .claude/scripts/ (a copy-install or this repo),
// ${CLAUDE_PLUGIN_ROOT}/scripts/ (what the plugin build writes into every
// shipped prompt), and the plugin's stable path under the home folder spelled
// with ~ or $HOME. No other path, no node flag before the path (-e, -p, -r,
// --import and --loader all run code of the caller's choosing), and
// upgrade-audit.js without the two flags that write its record. The runner
// expands the path itself before the run (expandNodePath below), because the
// rebuilt line quotes every word and bash expands nothing in it.
const NODE_SCRIPTS = 'session-init|merge-findings|pre-push-check|upgrade-audit';
const NODE_PATH_RE = new RegExp('^(?:\\.claude\\/scripts|\\$\\{CLAUDE_PLUGIN_ROOT\\}\\/scripts'
  + '|(?:~|\\$HOME)\\/\\.claude\\/plugins\\/data\\/tk-llm-peer-review\\/current\\/scripts)\\/(' + NODE_SCRIPTS + ')\\.js$');
function nodeRule(args) {
  const m = NODE_PATH_RE.exec(args[0] || '');
  if (!m) {
    return 'refused: node may run only session-init.js, merge-findings.js, pre-push-check.js or upgrade-audit.js from .claude/scripts/, '
      + '${CLAUDE_PLUGIN_ROOT}/scripts/ or ~/.claude/plugins/data/tk-llm-peer-review/current/scripts/'
      + (args[0] ? " (got '" + args[0] + "')" : '');
  }
  if (m[1] === 'upgrade-audit') {
    for (const a of args.slice(1)) {
      if (a === '--stamp' || flagIs(a, ['--rollback-to'])) return 'refused: upgrade-audit.js ' + a + ' writes the audit record';
    }
  }
  return null;
}
// The node script path, expanded for the run: ${CLAUDE_PLUGIN_ROOT}/... from
// the environment (refused when the variable is unset or not absolute: an
// unset variable would expand to nothing and leave a path at the disk's
// root), ~/... and $HOME/... from the home folder. Returns { path } or { error }.
function expandNodePath(word, env) {
  if (word.startsWith(PLUGIN_ROOT_LITERAL + '/')) {
    const v = pluginRootValue(env);
    if (v === null) return { error: 'refused: CLAUDE_PLUGIN_ROOT is not set in the environment, so ' + word + ' cannot be resolved' };
    if (!path.isAbsolute(v)) return { error: "refused: CLAUDE_PLUGIN_ROOT is not an absolute path ('" + v + "'), so " + word + ' cannot be resolved' };
    return { path: v + word.slice(PLUGIN_ROOT_LITERAL.length) };
  }
  if (word.startsWith('~/')) return { path: os.homedir() + word.slice(1) };
  if (word.startsWith('$HOME/')) return { path: os.homedir() + word.slice('$HOME'.length) };
  return { path: word };
}

// The ecosystem test entry points. Running a project's tests is the second
// consumer's whole job, so these are allowed although a test suite runs the
// project's own code: that code is the owner's, not the finder's. Each wrapper
// is pinned to its test form; anything else (install, add, run <script>, exec
// <program>) would fetch or run code of the finder's choosing.
const NPM_RUN_RE = /^(test(:[A-Za-z0-9_-]+)?|lint|typecheck|check(:[A-Za-z0-9_-]+)?)$/;
function npmRule(args) {
  if (args[0] === 'test') return null;
  if (args[0] === 'run' && NPM_RUN_RE.test(args[1] || '')) return null;
  return "refused: npm only as 'npm test' or 'npm run test|test:<word>|lint|typecheck|check|check:<word>'";
}
// npx downloads and runs any package by name, so only the named runners.
const NPX_OK = new Set(['jest', 'vitest', 'mocha', 'ava', 'tap', 'playwright', 'tsc', 'eslint']);
function npxRule(args) {
  if (NPX_OK.has(args[0])) return null;
  return "refused: npx may run only jest, vitest, mocha, ava, tap, playwright, tsc or eslint" + (args[0] ? " (got '" + args[0] + "')" : '');
}
function pythonRule(args) {
  if (args[0] === '-m' && args[1] === 'pytest') return null;
  return 'refused: python only as python -m pytest';
}
const goRule = (args) => (args[0] === 'test' || args[0] === 'vet') ? null : 'refused: go only as go test or go vet';
const cargoRule = (args) => (['test', 'check', 'clippy'].indexOf(args[0]) !== -1) ? null : 'refused: cargo only as cargo test, cargo check or cargo clippy';
function makeRule(args) {
  if (['test', 'check', 'lint'].indexOf(args[0]) === -1) return 'refused: make only as make test, make check or make lint';
  for (const a of args) {
    if (/^(-f|-C|-E|--file|--makefile|--directory|--eval)/.test(a)) return "refused: make argument '" + a + "' points make at another file or evaluates text";
  }
  return null;
}
// yarn and pnpm run any script or add any package; only the test script.
const yarnRule = (args) => (args[0] === 'test' || (args[0] === 'run' && args[1] === 'test')) ? null : "refused: yarn only as 'yarn test' or 'yarn run test'";
const pnpmRule = (args) => (args[0] === 'test' || (args[0] === 'run' && args[1] === 'test')) ? null : "refused: pnpm only as 'pnpm test' or 'pnpm run test'";
// bun runs any file or script; only its built-in test runner.
const bunRule = (args) => args[0] === 'test' ? null : "refused: bun only as 'bun test'";
// uv run and poetry run start any program in the project's environment; only
// pytest, as itself or through python -m.
function pytestRunner(name) {
  return (args) => {
    if (args[0] === 'run' && args[1] === 'pytest') return null;
    if (args[0] === 'run' && args[1] === 'python' && args[2] === '-m' && args[3] === 'pytest') return null;
    return "refused: " + name + " only as '" + name + " run pytest' or '" + name + " run python -m pytest'";
  };
}
// bundle exec starts any gem's program; only rspec and rake's test task.
function bundleRule(args) {
  if (args[0] === 'exec' && args[1] === 'rspec') return null;
  if (args[0] === 'exec' && args[1] === 'rake' && args[2] === 'test') return null;
  return "refused: bundle only as 'bundle exec rspec' or 'bundle exec rake test'";
}
// dotnet run, tool and the rest build or run arbitrary projects; only test.
const dotnetRule = (args) => args[0] === 'test' ? null : "refused: dotnet only as 'dotnet test'";

// curl: a dev-server probe and nothing else. The URL must be the local
// machine over plain http (and carry no @, which would turn the local part
// into a username in front of another host); -o may write only to /dev/null;
// no upload, data, request-method or config flag.
const CURL_LOCAL_RE = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:[/?#]\S*)?$/;
function curlRule(args) {
  let urls = 0;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-m' || a === '--max-time') {
      if (!/^\d+(\.\d+)?$/.test(args[i + 1] || '')) return 'refused: curl ' + a + ' needs a number of seconds';
      i++; continue;
    }
    if (/^--max-time=\d+(\.\d+)?$/.test(a)) continue;
    if (a === '-w' || a === '-H') {
      if (i + 1 >= args.length) return 'refused: curl ' + a + ' without a value';
      i++; continue;
    }
    if (a === '-o') {
      if (args[i + 1] !== '/dev/null') return 'refused: curl -o may write only to /dev/null';
      i++; continue;
    }
    if (/^-[sSfIL]+$/.test(a)) continue;
    if (a[0] === '-') return "refused: curl flag '" + a + "' (allowed: -s -S -f -I -L -m -w -H and -o /dev/null)";
    if (a.indexOf('@') !== -1 || !CURL_LOCAL_RE.test(a)) {
      return "refused: curl URL '" + a + "' is not a local dev-server address (http://localhost, http://127.0.0.1 or http://[::1])";
    }
    urls++;
  }
  if (!urls) return 'refused: curl without a URL';
  return null;
}

const ALLOW = {
  // Plain filters and readers: each reads files or stdin and writes only to
  // its own stdout. The few with a write or exec flag have that flag refused.
  grep: grepRule,                             // searches; -R and -S follow the links it finds
  rg: rgRule,                                 // --pre runs a program; -L follows the links it finds
  cat: ok,                                    // concatenates to stdout
  head: ok,                                   // prints the first lines
  tail: ok,                                   // prints the last lines
  wc: wcRule,                                 // counts; --files0-from opens the files a list names
  ls: ok,                                     // lists a folder
  test: ok,                                   // evaluates a condition, prints nothing
  '[': ok,                                    // the same as test
  diff: diffRule,                             // compares, prints the difference; -r opens through the links it finds
  cmp: ok,                                    // compares bytes
  jq: ok,                                     // filters JSON; has no file write or exec
  sort: sortRule,                             // -o writes; --compress-program runs a program; -T picks a temp folder; --files0-from opens the files a list names
  uniq: uniqRule,                             // a second file argument is an output file
  comm: ok,                                   // compares sorted files
  cut: ok,                                    // selects columns
  tr: ok,                                     // translates characters
  echo: ok,                                   // prints its arguments
  printf: ok,                                 // prints its arguments
  stat: ok,                                   // prints file metadata
  file: fileRule,                             // prints a file's type; -C compiles to disk, -f opens the files a list names
  basename: ok,                               // string work on a path
  dirname: ok,                                // string work on a path
  realpath: ok,                               // resolves a path
  readlink: ok,                               // reads a link
  true: ok,                                   // exits 0
  false: ok,                                  // exits 1
  sleep: ok,                                  // waits
  lsof: ok,                                   // lists open files and ports
  sed: sedRule,                               // only print and substitute scripts, no -i
  find: findRule,                             // walks and prints; the acting, the following and the list-fed flags refused
  git: gitRule,                               // read-only subcommands only
  node: nodeRule,                             // the toolkit's own read-only scripts only
  // Ecosystem test entry points.
  npm: npmRule,
  npx: npxRule,
  pytest: ok,
  python: pythonRule,
  python3: pythonRule,
  go: goRule,
  cargo: cargoRule,
  make: makeRule,
  yarn: yarnRule,
  pnpm: pnpmRule,
  bun: bunRule,
  uv: pytestRunner('uv'),
  poetry: pytestRunner('poetry'),
  bundle: bundleRule,
  dotnet: dotnetRule,
  curl: curlRule,                             // local dev-server probe only
};
// sort: -o/--output writes a file. --compress-program names a program sort
// runs on every temporary file it spills (second-round audit: `sort -S 1k
// --compress-program=./x big.txt` ran x many times, and a bare name such as
// gzip runs from PATH), in the = and the separate-word spelling. -T and
// --temporary-directory choose where those files are written. --files0-from
// opens every file named in a list it reads from a file or stdin (second
// round of R17: `find . -type l -printf '%l\0' | sort --files0-from=-` saved
// an outside file's text, the names being the link targets find printed; so
// did a project file holding the outside path), and --fil is its shortest
// unambiguous prefix (--fi is shared with --field-separator). Each long
// option is refused by its unambiguous prefixes as well (--out, --co, --t,
// --fil).
function sortRule(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/^-[A-Za-z]*o/.test(a) || longOptionIs(a, '--output', '--o')) return 'refused: sort -o writes a file';
    if (longOptionIs(a, '--compress-program', '--co')) return 'refused: sort --compress-program runs a program on its temporary files';
    if (/^-[A-Za-z]*T/.test(a) || longOptionIs(a, '--temporary-directory', '--t')) return 'refused: sort -T writes temporary files to a folder of the check\'s choosing';
    if (longOptionIs(a, '--files0-from', '--fil')) return 'refused: sort --files0-from' + LIST_READ;
  }
  return null;
}
// wc --files0-from (--f and longer: no other wc long option starts with f)
// opens every file a list names the same way; it prints counts and the names,
// never text, but what it opens the fence never judged. file -f and
// --files-from (--f and longer) open every file a list names to type them;
// -f is read inside a cluster the way grepPositions reads one (file's
// value-taking letters are e, F, f, m and P), and -C compiles a magic file to
// disk in either spelling.
function wcRule(args) {
  for (const a of args) {
    if (a === '--') break;
    if (longOptionIs(a, '--files0-from', '--f')) return 'refused: wc --files0-from' + LIST_READ;
  }
  return null;
}
const FILE_SHORT_VALUE = 'eFfmP';
function fileRule(args) {
  for (const a of args) {
    if (a === '--') break;
    if (a === '--compile' || clusterHasFlag(a, 'C', FILE_SHORT_VALUE)) return 'refused: file -C compiles a magic file to disk';
    if (longOptionIs(a, '--files-from', '--f') || clusterHasFlag(a, 'f', FILE_SHORT_VALUE)) return 'refused: file -f (--files-from)' + LIST_READ;
  }
  return null;
}
// uniq's -f, -s and -w take a value; a second remaining positional argument
// is the output file, which is a write.
function uniqRule(args) {
  let positional = 0;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-f' || a === '-s' || a === '-w') { i++; continue; }
    if (a.length > 1 && a[0] === '-') continue;
    positional++;
  }
  return positional > 1 ? 'refused: uniq with an output file writes it' : null;
}

const ENV_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const FLAG_VALUE_RE = /^(-{1,2}[A-Za-z0-9][A-Za-z0-9_-]*)=([\s\S]+)$/;   // --flag=value or -x=value

// Read confinement. A word that names something on this machine must resolve
// under the project root: a relative name stays inside, a pattern or a flag
// value names nothing and passes, and anything that exists elsewhere (an
// absolute path, a parent folder, a symlink that lands outside) is refused,
// quoted or not. The shell's two spellings of the home folder are refused for
// an unquoted word: ~ only when the word began unquoted (bash never
// tilde-expands a quoted word, and the rebuilt line quotes everything, so a
// quoted "~/.claude/..." is a search pattern: review R7), $HOME unless the
// word was single-quoted (every other variable is refused by the tokenizer;
// $HOME reaches this far so the node script path $HOME/.claude/plugins/.../
// scripts/x.js, which nodeRule owns, keeps working). The harmless device files
// a check may read from are listed; a block device would be the disk itself.
// `< file` reads a file, so the word behind the < is judged.
const DEV_READ_OK = ['/dev/null', '/dev/zero', '/dev/urandom', '/dev/random', '/dev/stdin'];
// Resolves `w` from `root` (already real) the way the kernel will when bash
// opens it: one segment at a time, every existing prefix through realpath, so
// a `..` after a symlinked folder steps up from the folder the link points AT.
// path.resolve cancels `link/..` lexically before anything looks at the link,
// which let `cat d/../secret` (d a symlink to the project) read the project's
// parent: the lexical result named a file that did not exist, so the old
// existence check never ran realpath (second-round audit). A missing prefix
// stays lexical (the kernel would stop there with ENOENT; nothing is read).
// Returns { abs, escaped }: escaped says a `..` segment left the root.
function physicalResolve(root, w) {
  let cur = path.isAbsolute(w) ? '/' : root;
  let escaped = false;
  for (const seg of w.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { cur = path.dirname(cur); if (!isUnder(cur, root)) escaped = true; continue; }
    cur = path.join(cur, seg);
    const real = realpathOrNull(cur);
    if (real !== null) cur = real;
  }
  return { abs: cur, escaped };
}
function outsideProject(word, root, meta) {
  const m = meta || {};
  const w = m.input && word.startsWith('<') ? word.slice(1) : word;
  if (w === '' || w === '-') return null;
  if (w[0] === '~' && !m.quoted) return "refused: home-relative path '" + word + "'";
  if (/^\$HOME(?![A-Za-z0-9_])/.test(w) && m.quote !== "'") return "refused: home-relative path '" + word + "'";
  if (root === null) return 'refused: the project root could not be resolved';
  // The device files are matched by their spelling (/dev/stdin is a link to
  // whatever stdin is), but only when no `..` could have been cancelled.
  if (w.split('/').indexOf('..') === -1 && DEV_READ_OK.indexOf(path.resolve(root, w)) !== -1) return null;
  const { abs, escaped } = physicalResolve(root, w);
  if (DEV_READ_OK.indexOf(abs) !== -1) return null;
  if (fs.existsSync(abs)) {
    const real = realpathOrNull(abs);
    if (real === null) return "refused: '" + word + "' could not be resolved";
    if (!isUnder(real, root)) return "refused: '" + word + "' is outside the project root";
    return null;
  }
  // Nothing there to read, so a pattern or a flag value passes; a `..` that
  // climbed above the root is still refused, so a parent path never passes
  // on the strength of a file that happens to be absent right now.
  if (escaped) return "refused: '" + word + "' is outside the project root (its .. climbs above it)";
  return null;
}

// grep and rg: the search pattern is text, never a file, so it is exempt from
// the fence (a pattern that spells an outside path, such as the toolkit's own
// docs quoting a plugin folder, is still a legitimate search: review R7). The
// pattern is the first non-flag argument, or every value of -e / --regexp
// (separate, attached as -ePAT, or --regexp=PAT, --regexp by its unambiguous
// prefixes --reg and longer). The -f / --file value names a file and stays
// judged, in each spelling (-f FILE, -fFILE, -nfFILE, --file FILE,
// --file=FILE; --file has no unambiguous prefix: --files-with-matches and
// --fixed-strings share them). A short cluster is read letter by letter, the
// first value-taking letter owning the rest of the word or the next word
// (second-round audit: `grep -e. ../x` put the pattern inside the cluster,
// so the outside file took the exempt slot). The values of the other flags
// that take one are skipped over so a count or a context width is never
// mistaken for the pattern. The lists hold only options that truly take a
// value: a flag wrongly listed would skip the real pattern and exempt the
// file in its place; a flag missing from the list only mistakes a value for
// the pattern and judges the pattern, which refuses more, never less.
// Returns a Set of exempt word indices and a list of extra words to judge.
const GREP_SHORT_VALUE = 'efmABCdDX';
const RG_SHORT_VALUE = 'efmABCdgtTMjEr';
const GREP_VALUE_FLAGS = ['--max-count', '--include', '--exclude', '--exclude-dir', '--label', '--context', '--after-context', '--before-context', '--directories', '--devices', '--binary-files'];
const RG_VALUE_FLAGS = GREP_VALUE_FLAGS.concat(['--glob', '--iglob', '--type', '--type-not', '--type-add', '--max-depth', '--max-filesize', '--max-columns', '--encoding', '--threads', '--context-separator', '--field-context-separator', '--field-match-separator', '--path-separator', '--replace', '--sort', '--sortr', '--dfa-size-limit', '--regex-size-limit', '--ignore-file', '--engine', '--colors']);
function grepPositions(cmd, words, meta) {
  const exempt = new Set();
  const judge = [];
  const valueFlags = cmd === 'rg' ? RG_VALUE_FLAGS : GREP_VALUE_FLAGS;
  const shortValue = cmd === 'rg' ? RG_SHORT_VALUE : GREP_SHORT_VALUE;
  let positional = null;
  let explicit = false;
  let afterDashDash = false;
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (meta[i] && meta[i].input) continue;                    // `< file` is never the pattern
    if (!afterDashDash && w === '--') { afterDashDash = true; continue; }
    if (!afterDashDash && w.length > 1 && w[0] === '-') {
      if (w[1] === '-') {
        if (longOptionIs(w, '--regexp', '--reg')) {
          explicit = true;
          if (w.indexOf('=') !== -1) exempt.add(i); else if (i + 1 < words.length) exempt.add(++i);
          continue;
        }
        if (w === '--file') { i++; continue; }                   // the value is a plain word: judged
        if (valueFlags.indexOf(w) !== -1) { i++; continue; }
        continue;                                                // --x=value is judged whole by the fence loop
      }
      for (let k = 1; k < w.length; k++) {
        const letter = w[k];
        if (shortValue.indexOf(letter) === -1) continue;
        const attached = w.slice(k + 1);
        if (letter === 'e') { explicit = true; if (attached === '' && i + 1 < words.length) exempt.add(++i); }
        else if (letter === 'f') { if (attached !== '') judge.push(attached); else i++; }
        else if (attached === '') i++;
        break;
      }
      continue;
    }
    if (positional === null) positional = i;
  }
  if (!explicit && positional !== null) exempt.add(positional);
  return { exempt, judge };
}

// The readers that walk a tree and open what they find (R17, review of
// 7.6.4). The fence judges every path a check names and follows a named link
// through realpath, but a walker that follows the links it discovers reads
// through a link the fence never saw: a project holding a directory link to
// an outside folder let `grep -R pattern .` save that folder's text into a
// receipt. grep -r, --recursive and rg follow only the links named on the
// command line, so they stay; grep -R and --dereference-recursive (every
// unambiguous prefix: --der and longer, the --de ones are ambiguous with
// --devices), BSD grep's -S (file links under -R), rg -L and --follow (--fol
// and longer), and diff -r and --recursive (--rec and longer; a recursive
// compare opens the files it finds) are refused, in the separate and the
// clustered spelling, with the cluster read the way grepPositions reads it.
// ls -R prints names only and stays allowed; the other readers on the list
// take named paths, which the fence judges.
//
// Second round (same review): the skeptics got outside through two readers
// that open what they are HANDED rather than what they walk. A folder named
// to diff: a directory compare, recursive or not, opens every file it finds
// in the two folders, and GNU diff follows a file symlink by default (the
// opt-out is --no-dereference), so `diff dirA dirB` with dirA/x a link to an
// outside file saved that file's text while the fence judged only the two
// folder names; -N, -y, a trailing slash and --from-file=dirB were the same
// hole. So diffFolderOperand refuses every operand that resolves to an
// existing folder, positional or a --from-file / --to-file value, resolved
// the way the fence resolves a path. A list of names: sort --files0-from
// opens every NUL-terminated name it reads from a file or from stdin, and
// find -printf '%l' or git show of a tracked link prints an outside target
// as a name, so the pipe `find . -type l -printf '%l\0' | sort
// --files0-from=-` saved the outside text. The list-fed flags are refused on
// every reader that has one (sort and wc --files0-from, file -f, find
// -files0-from); the name printers stay, since a name is not a read.
const SYMLINK_WALK = ' follows symbolic links while walking the tree, which the read fence cannot judge';
const LIST_READ = ' opens every file a list names, which the read fence cannot judge';
function isFolder(root, w) {
  if (root === null) return false;
  try { return fs.statSync(physicalResolve(root, w).abs).isDirectory(); } catch (e) { return false; }
}
// Every diff operand that is a folder: the positional words and the value of
// a --from-file= / --to-file= spelling (a separate-word value is a positional
// word already). A flag's own value that happens to name a folder (-L dir)
// is refused as well, which costs a label and nothing else. Runs after the
// fence, so an outside folder keeps its outside reason.
function diffFolderOperand(words, meta, root, env) {
  for (let i = 1; i < words.length; i++) {
    if (meta[i].input) continue;
    const w = substitutePluginRoot(meta[i].raw, env);
    let cand = w;
    if (w.length > 1 && w[0] === '-') {
      const fv = FLAG_VALUE_RE.exec(w);
      if (!fv) continue;
      cand = fv[2];
    }
    if (cand === '' || cand === '-') continue;
    if (isFolder(root, cand)) {
      return "refused: diff on the folder '" + cand + "' opens every file it finds there and follows the symbolic links among them, which the read fence cannot judge (name the files instead)";
    }
  }
  return null;
}
const DIFF_SHORT_VALUE = 'CDFILSUWxX';
function grepRule(args) {
  for (const a of args) {
    if (a === '--') break;
    if (longOptionIs(a, '--dereference-recursive', '--der')) return 'refused: grep --dereference-recursive (-R)' + SYMLINK_WALK + ' (grep -r follows only the links a check names)';
    if (clusterHasFlag(a, 'R', GREP_SHORT_VALUE)) return 'refused: grep -R' + SYMLINK_WALK + ' (grep -r follows only the links a check names)';
    if (clusterHasFlag(a, 'S', GREP_SHORT_VALUE)) return 'refused: grep -S' + SYMLINK_WALK;
  }
  return null;
}
function rgRule(args) {
  for (const a of args) {
    if (a === '--') break;
    if (flagIs(a, ['--pre', '--pre-glob'])) return 'refused: rg --pre runs a preprocessor command';
    if (longOptionIs(a, '--follow', '--fol')) return 'refused: rg --follow (-L)' + SYMLINK_WALK;
    if (clusterHasFlag(a, 'L', RG_SHORT_VALUE)) return 'refused: rg -L' + SYMLINK_WALK;
  }
  return null;
}
function diffRule(args) {
  for (const a of args) {
    if (a === '--') break;
    if (longOptionIs(a, '--recursive', '--rec')) return 'refused: diff --recursive (-r)' + SYMLINK_WALK + ' (a recursive compare opens the files it finds)';
    if (clusterHasFlag(a, 'r', DIFF_SHORT_VALUE)) return 'refused: diff -r' + SYMLINK_WALK + ' (a recursive compare opens the files it finds)';
  }
  return null;
}

// The guard over one parsed check. Returns null when every segment is allowed,
// else the first refusal reason. `root` is the resolved project root the reads
// are confined to, `env` the environment the check would run with (for the
// ${CLAUDE_PLUGIN_ROOT} substitution).
function guardParsed(parsed, root, env) {
  if (!parsed.segments.length) return 'refused: empty command';
  for (let s = 0; s < parsed.segments.length; s++) {
    const words = parsed.segments[s];
    const meta = parsed.meta[s];
    const cmd = words[0];
    if (ENV_ASSIGN_RE.test(cmd)) return "refused: environment assignment '" + cmd.split('=')[0] + "=...' before the command";
    const rule = Object.prototype.hasOwnProperty.call(ALLOW, cmd) ? ALLOW[cmd] : null;
    if (!rule) return "refused: first word '" + cmd + "' is not on the read-only allow-list";
    const reason = rule(words.slice(1));
    if (reason) return reason;
    const positions = (cmd === 'grep' || cmd === 'rg') ? grepPositions(cmd, words, meta) : { exempt: new Set(), judge: [] };
    for (let i = 1; i < words.length; i++) {
      // The node script path is nodeRule's: it pins it to the toolkit's own
      // read-only scripts, the plugin folder's copies included.
      if (cmd === 'node' && i === 1) continue;
      if (positions.exempt.has(i)) continue;
      // The word as bash would have seen it: the plugin root from the environment.
      const judged = substitutePluginRoot(meta[i].raw, env);
      const outside = outsideProject(judged, root, meta[i]);
      if (outside) return outside;
      // --flag=value: the value may name a file (diff --from-file=...).
      const fv = FLAG_VALUE_RE.exec(judged);
      if (fv) {
        const outsideValue = outsideProject(fv[2], root, { quoted: meta[i].quoted, quote: meta[i].quote });
        if (outsideValue) return outsideValue;
      }
    }
    for (const w of positions.judge) {
      const outside = outsideProject(substitutePluginRoot(w, env), root, {});
      if (outside) return outside;
    }
    if (cmd === 'diff') {
      const folder = diffFolderOperand(words, meta, root, env);
      if (folder) return folder;
    }
  }
  return null;
}

// The guard over one whole check, from its text. `cwd` is the project root the
// reads are confined to (the process's own by default); `env` the environment
// the check would run with (process.env by default).
function guardCheck(text, cwd, env) {
  const t = tokenize(text);
  if (t.error) return t.error;
  return guardParsed(t, realpathOrNull(cwd || process.cwd()), env || process.env);
}

// ---------------------------------------------------------------------------
// The rebuilt line: what bash actually runs. Every word the guard judged, in
// single quotes (a quote inside a word becomes '\''), so bash expands nothing;
// an input-redirect word as `< 'file'`; the segment's safe redirections after
// its words, in their original order; the segments joined by their recorded
// operators. The node script path is expanded by the runner itself (see
// expandNodePath), and the ${CLAUDE_PLUGIN_ROOT} literal elsewhere is the
// same text the guard judged. Returns { line } or { error }.
// ---------------------------------------------------------------------------
function singleQuote(s) { return "'" + s.replace(/'/g, "'\\''") + "'"; }
function rebuildCommand(parsed, env) {
  const out = [];
  for (let s = 0; s < parsed.segments.length; s++) {
    const words = parsed.segments[s];
    const meta = parsed.meta[s];
    const parts = [];
    for (let i = 0; i < words.length; i++) {
      let text;
      if (words[0] === 'node' && i === 1) {
        const e = expandNodePath(words[i], env);
        if (e.error) return { error: e.error };
        text = e.path;
      } else {
        text = substitutePluginRoot(meta[i].raw, env);
      }
      if (meta[i].input) parts.push('< ' + singleQuote(text.startsWith('<') ? text.slice(1) : text));
      else parts.push(singleQuote(text));
    }
    for (const r of parsed.redirections[s]) parts.push(r);
    out.push(parts.join(' '));
  }
  let line = '';
  for (let s = 0; s < out.length; s++) {
    line += out[s];
    const op = parsed.operators[s];
    if (s + 1 < out.length) line += op === '\n' ? '\n' : ' ' + op + ' ';
  }
  return { line };
}

// ---------------------------------------------------------------------------
// Expectations. `body` is the saved output without the exit line; `parts`,
// when given, is { stdout, stderr } so a negative or counting expectation can
// tell a clean no-match (grep: exit 1, nothing on stderr) from a command that
// failed (a misspelled path: exit 2 and an error on stderr). A failed command
// never confirms an absence: before this rule, a typo in a receipt's path made
// every noMatch pass and every stderr line count toward lines (review R1).
// ---------------------------------------------------------------------------
function decide(expect, exitCode, body, parts) {
  const stderr = parts && typeof parts.stderr === 'string' ? parts.stderr : '';
  const stdout = parts && typeof parts.stdout === 'string' ? parts.stdout : body;
  const quiet = stderr.trim() === '';
  // Exit 141 is 128 + SIGPIPE: with pipefail on, a pipeline reports it when an
  // early stage was still writing after a later stage such as `head -5` had
  // read what it wanted and closed. Nothing failed, so with a silent stderr it
  // is as clean as exit 0 (review of 7.6.3, R6).
  const ran = exitCode === 0 || (exitCode === 1 && quiet) || (exitCode === SIGPIPE_EXIT && quiet);
  const err = (reason) => ({ verdict: 'error', detail: reason });
  // A prose expect was model-judged until 8.0.0; it is refused now, like any
  // malformed expect, so the check still runs and saves but proves nothing.
  if (typeof expect === 'string') return err('a prose expect was removed in 8.0.0; use an object with exactly one of exit, match, noMatch, lines');
  if (expect === null || typeof expect !== 'object' || Array.isArray(expect)) {
    return err('expect must be an object with exactly one of exit, match, noMatch, lines');
  }
  const keys = Object.keys(expect);
  if (keys.length !== 1 || EXPECT_KEYS.indexOf(keys[0]) === -1) {
    return err('expect must have exactly one of exit, match, noMatch, lines (got ' + (keys.length ? keys.join(', ') : 'no keys') + ')');
  }
  const k = keys[0];
  const v = expect[k];
  let passed;
  if (k === 'exit') {
    if (!Number.isInteger(v)) return err('expect.exit must be an integer');
    passed = v === exitCode;
  } else if (k === 'match' || k === 'noMatch') {
    if (typeof v !== 'string') return err('expect.' + k + ' must be a regex string');
    let re;
    try { re = new RegExp(v, 'm'); } catch (e) { return err('expect.' + k + ' is not a valid regex: ' + e.message); }
    const hit = re.test(body);
    passed = k === 'match' ? hit : (!hit && ran);
  } else {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return err('expect.lines must be an object with integer min and/or max');
    const hasMin = v.min !== undefined;
    const hasMax = v.max !== undefined;
    if (!hasMin && !hasMax) return err('expect.lines needs min or max');
    if ((hasMin && !Number.isInteger(v.min)) || (hasMax && !Number.isInteger(v.max))) return err('expect.lines min and max must be integers');
    const count = stdout.split('\n').filter((l) => l.trim() !== '').length;
    passed = ran && (!hasMin || count >= v.min) && (!hasMax || count <= v.max);
  }
  return { verdict: passed ? 'pass' : 'fail', detail: '' };
}

// The last lines of the saved output, for a fail's detail.
function tailDetail(body) {
  const lines = body.replace(/\n+$/, '').split('\n');
  let out = lines.slice(-DETAIL_LINES).join('\n');
  if (out.length > DETAIL_CHARS) out = out.slice(out.length - DETAIL_CHARS);
  return out;
}

// ---------------------------------------------------------------------------
// Running one allowed check and saving its output.
// ---------------------------------------------------------------------------
function checkEnv() {
  const env = Object.assign({}, process.env);
  delete env.BASH_ENV;                 // a file bash would source before the check
  delete env.ENV;                      // the same, for sh mode
  for (const k of Object.keys(env)) {
    // An exported shell function named like an allowed word would replace it.
    if (k.startsWith('BASH_FUNC_')) delete env[k];
  }
  env.GIT_PAGER = 'cat';
  env.PAGER = 'cat';
  return env;
}

// `line` is the rebuilt line, never the check text as written. pipefail makes
// a pipeline's exit code the last non-zero one among its stages, so a grep
// over a missing file piped to head no longer reports head's exit 0.
function runCheck(line, cwd, timeout, env) {
  const r = spawnSync('bash', ['-o', 'pipefail', '-c', line], {
    cwd, timeout, env: env || checkEnv(), encoding: 'utf8', maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Node reports a timeout as ETIMEDOUT and an output past maxBuffer as
  // ENOBUFS; both kill the child with SIGTERM, so the signal alone cannot tell
  // them apart (review R18: the overflow used to be reported as a timeout).
  const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
  const overflow = !!(r.error && r.error.code === 'ENOBUFS');
  if (r.error && !timedOut && !overflow && r.status === null && !r.signal) {
    return { failed: 'bash could not be started: ' + r.error.message };
  }
  let exit;
  if (timedOut) exit = TIMEOUT_EXIT;
  else if (typeof r.status === 'number') exit = r.status;
  else if (r.signal) exit = 128 + (os.constants.signals[r.signal] || 1);
  else exit = 1;
  let stdout = r.stdout || '';
  let stderr = r.stderr || '';
  if (timedOut) stderr += (stderr && !stderr.endsWith('\n') ? '\n' : '') + 'run-checks: timed out after ' + timeout + ' ms\n';
  if (overflow) {
    // Keep room for the note below the cap, so the saved file says why it ends.
    stdout = Buffer.from(stdout, 'utf8').subarray(0, OUTPUT_CAP_BYTES - 1000).toString('utf8') + '\n[truncated]\n';
    stderr += (stderr && !stderr.endsWith('\n') ? '\n' : '') + 'run-checks: output passed the ' + (MAX_BUFFER / 1048576) + ' MB buffer and the check was stopped\n';
  }
  let body = stdout;
  if (body && !body.endsWith('\n')) body += '\n';
  body += stderr;
  if (body && !body.endsWith('\n')) body += '\n';
  if (Buffer.byteLength(body, 'utf8') > OUTPUT_CAP_BYTES) {
    body = Buffer.from(body, 'utf8').subarray(0, OUTPUT_CAP_BYTES).toString('utf8');
    if (!body.endsWith('\n')) body += '\n';
    body += '[truncated]\n';
  }
  return { exit, body, stdout, stderr, timedOut, overflow };
}

// ---------------------------------------------------------------------------
// The --out folder. Allowed roots: <cwd>/reports, the system temp folder, /tmp
// and /private/tmp when they exist. Both sides go through realpath, so a
// symlink under reports/ that lands outside is refused for where it lands and
// a /tmp that is really /private/tmp is not refused for its spelling. The
// candidate is judged BEFORE it is created, through its nearest existing
// ancestor, so a refused folder is never created; it is judged again after.
// ---------------------------------------------------------------------------
function realpathOrNull(p) {
  try { return fs.realpathSync(p); } catch (e) { return null; }
}
function realpathOfNearest(p) {
  const rest = [];
  let cur = p;
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    rest.unshift(path.basename(cur));
    cur = parent;
  }
  const real = realpathOrNull(cur);
  return real === null ? null : path.join(real, ...rest);
}
function isUnder(candidate, root) {
  const rel = path.relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}
function allowedRoots(cwd) {
  const reports = path.join(cwd, 'reports');
  try { fs.mkdirSync(reports, { recursive: true }); } catch (e) { /* unwritable: the root is simply absent */ }
  const roots = [];
  for (const r of [reports, os.tmpdir(), '/tmp', '/private/tmp']) {
    const real = fs.existsSync(r) ? realpathOrNull(r) : null;
    if (real && roots.indexOf(real) === -1) roots.push(real);
  }
  return roots;
}
// Returns the resolved out folder, created, or throws with the reason.
function prepareOutDir(outArg, cwd) {
  const resolved = path.resolve(cwd, outArg);
  const roots = allowedRoots(cwd);
  const describe = () => 'under ' + path.join(cwd, 'reports') + ' or the system temp folder (' + os.tmpdir() + ')';
  const before = realpathOfNearest(resolved);
  if (before === null || !roots.some((r) => isUnder(before, r))) {
    throw new Error('--out ' + outArg + ' resolves to ' + (before || resolved) + ', which is not ' + describe());
  }
  try { fs.mkdirSync(resolved, { recursive: true }); } catch (e) { throw new Error('--out ' + outArg + ' could not be created: ' + e.message); }
  const after = realpathOrNull(resolved);
  if (after === null || !roots.some((r) => isUnder(after, r))) {
    throw new Error('--out ' + outArg + ' resolves to ' + (after || resolved) + ', which is not ' + describe());
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// The checks file. The whole file is validated before anything runs.
// ---------------------------------------------------------------------------
function loadChecks(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new Error('--checks ' + file + ' could not be read: ' + e.message); }
  let data;
  try { data = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { throw new Error('--checks ' + file + ' is not valid JSON: ' + e.message); }
  if (!Array.isArray(data)) throw new Error('--checks ' + file + ' must hold a JSON array of { id, check, expect }');
  const seen = new Set();
  data.forEach((c, i) => {
    const at = 'checks[' + i + ']';
    if (c === null || typeof c !== 'object' || Array.isArray(c)) throw new Error(at + ' is not an object');
    if (typeof c.id !== 'string' || !ID_RE.test(c.id)) {
      throw new Error(at + '.id ' + JSON.stringify(c.id) + ' is not a valid id (letters, digits, . _ - only, starting with a letter or digit, at most 81 characters, no path separators)');
    }
    if (seen.has(c.id)) throw new Error(at + '.id ' + JSON.stringify(c.id) + ' is a duplicate');
    seen.add(c.id);
    if (typeof c.check !== 'string' || c.check === '') throw new Error(at + '.check must be a non-empty string');
  });
  // Only the three fields: a `role` is plan mode's to give, never a file's.
  return data.map((c) => ({ id: c.id, check: c.check, expect: c.expect }));
}

const USAGE = 'usage: node run-checks.js --checks <file.json> --out <dir> [--timeout <ms>] [--rerun-failures]\n'
  + '  --checks          a JSON array of { id, check, expect }\n'
  + '  --out             where <id>.txt and results.json are saved; must be under reports/ or the system temp folder\n'
  + '  --timeout         per check, in milliseconds (default ' + DEFAULT_TIMEOUT_MS + '); a run over half of it is flagged slow\n'
  + '  --rerun-failures  run a failing check once more; a pass the second time stays a fail, flagged flaky\n'
  + '  --full            this list is the project\'s full test step: time it, add a row to the main copy\'s\n'
  + '                    reports/checks/history.jsonl, and flag a pass over 1.5x the baseline (flags.grew, cost);\n'
  + '                    after two fast passes in a row (each under two-thirds of the baseline), the slower\n'
  + '                    becomes the new baseline, with no flag;\n'
  + '                    skipped, with a note (`skipped`), when the tree and the list match the last passing run\n'
  + '  --no-skip         with --full: run even when nothing changed\n'
  + '  expect            exactly one of (a prose string is an error since 8.0.0)\n'
  + '                    {"exit": 0}  {"match": "regex"}  {"noMatch": "regex"}  {"lines": {"min": 1, "max": 3}}\n'
  + '                    (regexes are tested with the multiline flag against the saved output)\n'
  + '  stdout            one JSON object: { checks: [{ id, verdict, exit, stdoutFile, detail, ms, slow, flaky }], summary, flags }\n'
  + '  exit code         0 when the checks file validated (verdicts are the result); 1 for a malformed file or a refused --out\n'
  + 'plan mode: node run-checks.js --plan <plan.md> (--lint | --tally | --step <N> --phase before|after [--timeout <ms>])\n'
  + '  --lint            every check line in the plan that would not run, as problems\n'
  + '  --step --phase    run one step\'s checks with that phase\'s expects into reports/checks/<plan>/step-<N>/<phase>/\n'
  + '  --tally           each step: proved, unproved (with reasons), noTarget, missing or problem\n'
  + 'history: node run-checks.js --history [--since <time>]\n'
  + '  --history         what the full test step cost: runs, skipped, totalMs, latestMs, baselineMs, grew\n'
  + '  --since           only the runs that started at or after this time (ISO, e.g. 2026-10-15T01:00:00Z)\n';

function parseArgs(argv) {
  const opts = { checks: '', out: '', timeout: DEFAULT_TIMEOUT_MS, rerunFailures: false, help: false,
    plan: '', lint: false, tally: false, step: '', phase: '', full: false, noSkip: false, history: false, since: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--rerun-failures') opts.rerunFailures = true;
    else if (a === '--full') opts.full = true;
    else if (a === '--no-skip') opts.noSkip = true;
    else if (a === '--history') opts.history = true;
    else if (a === '--since') opts.since = argv[++i] || '';
    else if (a === '--plan') opts.plan = argv[++i] || '';
    else if (a === '--lint') opts.lint = true;
    else if (a === '--tally') opts.tally = true;
    else if (a === '--step') opts.step = argv[++i] || '';
    else if (a === '--phase') opts.phase = argv[++i] || '';
    else if (a === '--checks') opts.checks = argv[++i] || '';
    else if (a === '--out') opts.out = argv[++i] || '';
    else if (a === '--timeout') {
      const v = argv[++i];
      if (!/^\d+$/.test(v || '') || Number(v) <= 0) throw new Error('--timeout needs a positive number of milliseconds');
      opts.timeout = Number(v);
    } else throw new Error("unknown argument '" + a + "'");
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Running the list. attempt() runs a rebuilt line once and decides it; runOne()
// judges a check and, with --rerun-failures, gives a fail its second run;
// runAll() runs the list, counts it and saves results.json.
// ---------------------------------------------------------------------------
// The saved file's path as rows report it: relative to the project root, or
// absolute when the out folder sits outside it.
function shownPath(cwd, file) {
  const rel = path.relative(cwd, file);
  return (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) ? file : rel;
}

// One run of a judged line: run it, time it, save its output to `file`, decide
// it. A save that fails leaves the verdict `error`, as a refusal does.
// `notYet` (a before-phase target only) is the target's after expect: output
// that already meets it fails, because passing after the work would then prove
// nothing (M17). The same output would show the same, so it is not retried.
function attempt(line, expect, opts, cwd, env, file, notYet) {
  const started = Date.now();
  const run = runCheck(line, cwd, opts.timeout, env);
  const ms = Date.now() - started;
  if (run.failed) return { verdict: 'error', exit: null, detail: run.failed, ms, saved: false };
  const out = { verdict: 'error', exit: run.exit, detail: '', ms, saved: false, retry: !run.timedOut && !run.overflow };
  try {
    fs.writeFileSync(file, run.body + 'exit ' + run.exit + '\n');
    out.saved = true;
  } catch (e) {
    out.detail = 'could not save the output to ' + file + ': ' + e.message;
    return out;
  }
  if (run.timedOut || run.overflow) {
    out.verdict = 'fail';
    out.detail = run.overflow ? 'output passed the ' + (MAX_BUFFER / 1048576) + ' MB buffer and the check was stopped' : tailDetail(run.body);
  } else {
    const parts = { stdout: run.stdout, stderr: run.stderr };
    const d = decide(expect, run.exit, run.body, parts);
    out.verdict = d.verdict;
    out.detail = d.verdict === 'fail' ? tailDetail(run.body) : d.detail;
    if (out.verdict === 'pass' && notYet !== undefined && decide(notYet, run.exit, run.body, parts).verdict === 'pass') {
      out.verdict = 'fail';
      out.detail = 'it already meets its after expect, so passing after the work would prove nothing (M17): fix the check or its stated failure';
      out.retry = false;
    }
  }
  return out;
}

function runOne(c, opts, cwd, outDir, root, env) {
  const row = { id: c.id, verdict: 'error', exit: null, stdoutFile: null, detail: '', ms: null, slow: false, flaky: false };
  // Tokenize, judge, rebuild: bash runs the rebuilt line and never c.check.
  const parsed = tokenize(c.check);
  let refusal = parsed.error || guardParsed(parsed, root, env);
  let line = null;
  if (!refusal) {
    const built = rebuildCommand(parsed, env);
    if (built.error) refusal = built.error; else line = built.line;
  }
  if (refusal) { row.detail = refusal; return row; }

  const file = path.join(outDir, c.id + '.txt');
  let a = attempt(line, c.expect, opts, cwd, env, file, c.notYet);
  let slow = a.ms > opts.timeout / 2;
  if (opts.rerunFailures && a.verdict === 'fail' && a.retry) {
    // Keep the failing run where the review and the tally can read it, then
    // run the same judged line again into <id>.txt.
    const firstDir = path.join(outDir, 'first-run');
    let kept = false;
    try {
      fs.mkdirSync(firstDir, { recursive: true });
      fs.renameSync(file, path.join(firstDir, c.id + '.txt'));
      kept = true;
    } catch (e) {
      process.stderr.write('run-checks: ' + c.id + ': could not keep the first run: ' + e.message + '\n');
    }
    const second = attempt(line, c.expect, opts, cwd, env, file, c.notYet);
    slow = slow || second.ms > opts.timeout / 2;
    if (second.verdict === 'pass') {
      row.flaky = true;
      a = Object.assign({}, second, {
        verdict: 'fail',
        detail: 'failed, then passed when run again' + (kept ? ' (the failing run is first-run/' + c.id + '.txt)' : ''),
      });
    } else {
      a = second;
    }
  }
  row.verdict = a.verdict;
  row.exit = a.exit;
  row.detail = a.detail;
  row.ms = a.ms;
  row.slow = slow;
  if (a.saved) row.stdoutFile = shownPath(cwd, file);
  return row;
}

// The commit the run saw, for results.json; null outside a repository.
function headCommit(cwd) {
  const r = spawnSync('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const sha = (r.stdout || '').trim();
  return r.status === 0 && /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
}

// `extra` (plan mode: plan, step, phase) leads both the printed object and
// results.json; a check's `role` (target or guard, plan mode only) is copied
// onto its row. results.json rows also carry the check's command and expect.
// `decorate` (a --full run) adds to the result once every check has run and
// before results.json is saved, so the saved record and the printed object
// carry the same fields.
function runAll(checks, opts, cwd, outDir, extra, decorate) {
  const env = checkEnv();              // the same environment the guard judges with
  const root = realpathOrNull(cwd);
  const at = new Date().toISOString();
  const results = [];
  const summary = { pass: 0, fail: 0, error: 0 };
  const flags = { slow: 0, flaky: 0 };
  for (const c of checks) {
    const row = runOne(c, opts, cwd, outDir, root, env);
    if (c.role) row.role = c.role;
    if (row.verdict === 'error') process.stderr.write('run-checks: ' + c.id + ': ' + row.detail + '\n');
    summary[row.verdict]++;
    if (row.slow) flags.slow++;
    if (row.flaky) flags.flaky++;
    results.push(row);
  }
  const result = Object.assign({}, extra || {}, { checks: results, summary, flags });
  if (decorate) decorate(result);
  // Saved only when a check ran: a run whose every check was refused writes
  // nothing at all, as it always has, so a refusal never leaves a record that
  // looks like evidence.
  if (results.some((r) => r.stdoutFile !== null)) {
    const rows = results.map((r, i) => Object.assign({}, r, { check: checks[i].check, expect: checks[i].expect }));
    saveRecord(outDir, Object.assign({ at, head: headCommit(cwd) }, result, { checks: rows }));
  }
  return result;
}

// ---------------------------------------------------------------------------
// The saved record (issue #252). Every write of <out>/results.json goes through
// saveRecord, which adds to the record already in the folder instead of
// replacing it. A review's recheck run writes into the folder that holds the
// receipts its finding was proved with, and a rewrite deleted the very row the
// recheck was checked against (0 of 19 saved rechecks sat beside their
// original). Each row carries its own run's `at` and `head`; `runs` keeps one
// { at, head, summary, flags } per call (`skipped: true` on a --full skip); the
// top-level fields are the latest call's, so a reader of one run sees what it
// always saw. A record written before #252 (no `runs`) counts as one run. A
// plan phase clears its folder first, so its record is still its own run alone
// and --tally reads exactly what it read before. A file there that is not a
// readable record is moved aside to results.prev-<n>.json, never overwritten.
// Receipts from parallel finders can be saved at the same moment, so the
// read-merge-write runs under a lock file; a lock older than LOCK_STALE_MS was
// left by a run that crashed mid-save and is cleared.
// ---------------------------------------------------------------------------
const LOCK_WAIT_MS = 10000;
const LOCK_STALE_MS = 30000;
function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
// True once this process holds the lock; false when it could not get it in time.
function takeLock(lock) {
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { fs.closeSync(fs.openSync(lock, 'wx')); return true; } catch (e) { if (e.code !== 'EEXIST') return false; }
    try {
      if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) { fs.rmSync(lock, { force: true }); continue; }
    } catch (e) { continue; }   // released between the open and the stat: try again
    if (Date.now() > until) return false;
    sleepMs(50);
  }
}
// The record already in the folder: null when there is none, { rec } when the
// file is one, { bad: true } when something else is on that path.
function priorRecord(file) {
  let st;
  try { st = fs.lstatSync(file); } catch (e) { return null; }
  if (!st.isFile()) return { bad: true };
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (r !== null && typeof r === 'object' && Array.isArray(r.checks)) return { rec: r };
  } catch (e) { /* not JSON: set aside below */ }
  return { bad: true };
}
// Move an unreadable results.json to the first free results.prev-<n>.json.
function setAside(outDir, file) {
  for (let n = 1; ; n++) {
    const aside = path.join(outDir, 'results.prev-' + n + '.json');
    try { fs.lstatSync(aside); continue; } catch (e) { /* free */ }
    fs.renameSync(file, aside);
    process.stderr.write('run-checks: ' + file + ' was not a readable record; moved it to ' + aside + '\n');
    return;
  }
}
function saveRecord(outDir, record) {
  const file = path.join(outDir, 'results.json');
  const lock = file + '.lock';
  const locked = takeLock(lock);
  if (!locked) process.stderr.write('run-checks: could not lock ' + file + '; saving without the lock\n');
  const headOf = (r) => (r.head === undefined ? null : r.head);
  const runOf = (r) => Object.assign({ at: r.at, head: headOf(r), summary: r.summary, flags: r.flags }, r.skipped ? { skipped: true } : {});
  const stamp = (rows, r) => rows.map((c) => (c && typeof c === 'object' && c.at === undefined ? Object.assign({}, c, { at: r.at, head: headOf(r) }) : c));
  try {
    let rows = [];
    let runs = [];
    const prior = priorRecord(file);
    if (prior && prior.bad) setAside(outDir, file);
    else if (prior) {
      rows = stamp(prior.rec.checks, prior.rec);
      runs = Array.isArray(prior.rec.runs) ? prior.rec.runs : [runOf(prior.rec)];
    }
    const merged = Object.assign({}, record, { checks: rows.concat(stamp(record.checks, record)), runs: runs.concat([runOf(record)]) });
    // Written beside the record and renamed over it, so a reader never sees half a file.
    const tmp = file + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(merged) + '\n');
    fs.renameSync(tmp, file);
  } catch (e) {
    process.stderr.write('run-checks: could not save ' + file + ': ' + e.message + '\n');
  } finally {
    if (locked) fs.rmSync(lock, { force: true });
  }
}

// ---------------------------------------------------------------------------
// The full test step's history (issue #248). A --full run is the project's
// whole test step, the one /execute and /merge run, and only it is recorded:
// a review receipt or a plan step's check is never the suite, and a skipped
// receipt would lose the output its finding points at.
// ---------------------------------------------------------------------------
const GROWTH_FACTOR = 1.5;
// Two passing runs in a row under this share of the baseline bring it down to
// the slower of the two, so a suite made faster is measured against its new time
// rather than the old one: left at the old time, the growth flag could not fire
// again until a run was slower than any before it (issue #249). One such run is
// not enough, because 1.5 x 2/3 is exactly one: after a single fluke the next run
// at the old normal time read as growth (issue #250). It raises no flag.
const SHRINK_FACTOR = 2 / 3;
const HISTORY_REL = path.join('reports', 'checks', 'history.jsonl');

// The main working copy's root, the folder holding the shared .git, so a
// worktree's run lands in the same history as the main copy's and the
// baseline outlives the worktree. Outside a repository, or in a layout with
// no .git folder to anchor on, it is the folder the run started in. Git older
// than 2.31 prints the flag back first, so the path is the last line.
function mainCopyRoot(cwd) {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const lines = (r.stdout || '').trim().split('\n');
  const common = lines[lines.length - 1];
  if (r.status !== 0 || !common || path.basename(common) !== '.git') return cwd;
  return path.dirname(common);
}

// The history file's path. It is appended to, so a link or a non-folder on
// the way to it (or a history that is itself a link) is refused, as a record
// folder's is: a write never lands outside the main copy's reports/.
function historyFile(cwd) {
  const root = mainCopyRoot(cwd);
  const bad = linkOnRecordPath(root, path.join('reports', 'checks'));
  if (bad) throw new Error('the history ' + HISTORY_REL + ' was not used: ' + bad + ' is a link or not a folder');
  const file = path.join(root, HISTORY_REL);
  let st = null;
  try { st = fs.lstatSync(file); } catch (e) { /* not written yet */ }
  if (st && !st.isFile()) throw new Error('the history ' + HISTORY_REL + ' was not used: it is a link or not a file');
  return file;
}

// Every row, oldest first. A line that does not parse (a write cut short) is
// skipped rather than fatal: one torn row must not stop the test step.
function readHistory(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r === 'object' && typeof r.at === 'string' && !isNaN(Date.parse(r.at))) rows.push(r);
    } catch (e) { /* torn line */ }
  }
  return rows;
}

function appendHistory(file, row) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(row) + '\n');
  } catch (e) {
    process.stderr.write('run-checks: could not add to ' + HISTORY_REL + ': ' + e.message + '\n');
  }
}

// A checks list's identity is its content, not its path, so the one-entry
// fallback list written into a fresh scratch folder on every run keeps one
// key, and so one baseline.
function checksKey(checks) {
  return crypto.createHash('sha256').update(canonical(checks)).digest('hex');
}

// The baseline in force for a key: the newest row of that key that carries
// one. Every row carries the baseline as it stood after it, so a failing run
// passes the baseline on unchanged.
function baselineFor(rows, key) {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].key === key && typeof rows[i].baselineMs === 'number') return rows[i].baselineMs;
  }
  return null;
}

// The newest real passing run of this list: a skipped row ran nothing and a
// failing run measures nothing, so neither counts when two fast passes are
// looked for in a row (issue #250).
function lastPassFor(rows, key) {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].key === key && !rows[i].skipped && rows[i].passed === true && typeof rows[i].ms === 'number') return rows[i];
  }
  return null;
}

// What the working tree holds, as one hash: every tracked file and every
// untracked file git does not ignore, edits and modes included, so a skip
// can trust that the suite would read exactly what the passing run read.
// Read-only by construction: `git ls-files` never writes the index and takes
// no lock (unlike `git status` or `git add`, which refresh it), so another git
// process holding the index lock changes nothing here. A file git still lists
// with its staged id and does not report modified is taken at that id; a
// modified or untracked file is hashed from disk the way git hashes a blob.
// Ignored files (installed packages, .env.local) are not part of it, and
// neither are refs: --no-skip forces a run. Null outside a repository, or
// when git cannot list the tree, and a null fingerprint never skips.
function fingerprint(cwd) {
  const ls = (args) => {
    const r = spawnSync('git', ['--no-optional-locks', 'ls-files', '-z'].concat(args), { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'ignore'] });
    return r.status === 0 ? r.stdout.split('\0').filter(Boolean) : null;
  };
  const staged = ls(['-s']);
  const modified = ls(['-m']);
  const deleted = ls(['-d']);
  const untracked = ls(['-o', '--exclude-standard']);
  if (!staged || !modified || !deleted || !untracked) return null;
  const changed = new Set(modified.concat(untracked));
  const gone = new Set(deleted);
  const lines = [];
  for (const entry of staged) {
    const tab = entry.indexOf('\t');
    const file = entry.slice(tab + 1);
    if (gone.has(file)) lines.push('D ' + file);
    else if (!changed.has(file)) lines.push('I ' + entry.slice(0, tab) + ' ' + file);
  }
  for (const file of changed) {
    if (gone.has(file)) continue;
    const abs = path.join(cwd, file);
    let st;
    try { st = fs.lstatSync(abs); } catch (e) { lines.push('D ' + file); continue; }
    let body;
    if (st.isSymbolicLink()) body = Buffer.from(fs.readlinkSync(abs));
    else if (st.isFile()) body = fs.readFileSync(abs);
    else { lines.push('X ' + file); continue; }      // a nested repository git lists as a folder
    const blob = crypto.createHash('sha1').update('blob ' + body.length + '\0').update(body).digest('hex');
    const mode = st.isSymbolicLink() ? '120000' : (st.mode & 0o111 ? '100755' : '100644');
    lines.push('W ' + mode + ' ' + blob + ' ' + file);
  }
  lines.sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

// The newest run (not a skip) of this list on this exact tree, or null.
function lastRunOn(rows, key, print) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!r.skipped && r.key === key && r.fingerprint === print) return r;
  }
  return null;
}

// A skip: nothing changed since `prior` passed on the same tree with the same
// list, so running again could only show a flake. It prints the same shape a
// run does, with the passing run's summary and rows, `skipped` and its note,
// writes results.json, and adds a history row marked skipped that keeps the
// baseline and is never counted as a run.
function skipRun(checks, prior, cwd, outDir, file, key, print, against) {
  const at = new Date().toISOString();
  const head = headCommit(cwd);
  const note = 'skipped: nothing changed since the passing run at ' + prior.at + (prior.head ? ' (' + String(prior.head).slice(0, 7) + ')' : '');
  const priorRows = Array.isArray(prior.checks) ? prior.checks : [];
  const rows = priorRows.map((c) => ({ id: c.id, verdict: c.verdict, exit: null, stdoutFile: null, detail: note, ms: null, slow: false, flaky: false }));
  const summary = prior.summary && typeof prior.summary === 'object' ? Object.assign({}, prior.summary) : { pass: rows.length, fail: 0, error: 0 };
  const result = { checks: rows, summary, flags: { slow: 0, flaky: 0, grew: 0 }, cost: { ms: 0, baselineMs: against, grew: false }, skipped: { from: prior.at, head: prior.head || null, note } };
  const byId = new Map(checks.map((c) => [c.id, c]));
  const saved = rows.map((r) => Object.assign({}, r, byId.has(r.id) ? { check: byId.get(r.id).check, expect: byId.get(r.id).expect } : {}));
  saveRecord(outDir, Object.assign({ at, head }, result, { checks: saved }));
  appendHistory(file, { at, head, key, fingerprint: print, ms: 0, passed: true, skipped: true, from: prior.at,
    againstMs: against, baselineMs: against, grew: false, summary, checks: priorRows });
  process.stderr.write('run-checks: ' + note + '\n');
  return result;
}

// Run the list as the full test step: time the whole run, compare a pass with
// the baseline, and append one row. The first passing run is the baseline; a
// passing run over 1.5x it is flagged (flags.grew 1) and becomes the new
// baseline, so the same growth is flagged once, never on every later run. A
// second passing run in a row under two-thirds of it brings it down too, to the
// slower of the two, unflagged (two fast passes in a row, issue #250). A
// failing run (a fail, an error, a flake) never moves the baseline: one cut
// short or one that ran into its time limit would mislead it. Before running,
// a tree and list the last run on them passed is skipped (skipRun), unless
// --no-skip; a failing last run on the same tree is never skipped.
// `file` is historyFile()'s answer, taken before the out folder was made.
function runFull(checks, opts, cwd, outDir, file) {
  const key = checksKey(checks);
  const rows = readHistory(file);
  const print = fingerprint(cwd);
  if (!opts.noSkip && print !== null) {
    const prior = lastRunOn(rows, key, print);
    if (prior && prior.passed) return skipRun(checks, prior, cwd, outDir, file, key, print, baselineFor(rows, key));
  }
  const started = Date.now();
  let row = null;
  const result = runAll(checks, opts, cwd, outDir, null, (res) => {
    const ms = Date.now() - started;
    const passed = checks.length > 0 && res.summary.fail === 0 && res.summary.error === 0 && res.flags.flaky === 0;
    const against = baselineFor(rows, key);
    const grew = passed && against !== null && ms > against * GROWTH_FACTOR;
    // Two fast passes in a row (issue #250): one fast run can be a fluke, and
    // moving the baseline down on it made the next run at the old normal time
    // read as growth. The pair is this run and the newest earlier real pass,
    // measured against the same baseline; the slower of the two becomes the new one.
    const fast = passed && against !== null && ms < against * SHRINK_FACTOR;
    const prior = fast ? lastPassFor(rows, key) : null;
    const shrank = prior !== null && prior.againstMs === against && prior.ms < against * SHRINK_FACTOR;
    res.flags.grew = grew ? 1 : 0;
    res.cost = { ms, baselineMs: against, grew };
    row = {
      at: new Date(started).toISOString(), head: headCommit(cwd), key, fingerprint: print, ms, passed,
      againstMs: against, baselineMs: shrank ? Math.max(prior.ms, ms) : passed && (against === null || grew) ? ms : against, grew,
      summary: res.summary, checks: res.checks.map((c) => ({ id: c.id, verdict: c.verdict, ms: c.ms })),
    };
  });
  appendHistory(file, row);
  return result;
}

// What the full test step cost, for a cycle page: runs and skips since a
// time, their total, the latest passing run against its baseline, and each
// run that grew past it (with the baseline it grew from).
function historyReport(cwd, since) {
  const all = readHistory(historyFile(cwd));
  const rows = all.filter((r) => since === null || Date.parse(r.at) >= since);
  const ran = rows.filter((r) => !r.skipped);
  const passes = ran.filter((r) => r.passed);
  const last = passes.length ? passes[passes.length - 1] : null;
  return {
    since: since === null ? null : new Date(since).toISOString(),
    runs: ran.length,
    skipped: rows.length - ran.length,
    totalMs: ran.reduce((s, r) => s + (typeof r.ms === 'number' ? r.ms : 0), 0),
    latestMs: last ? last.ms : null,
    baselineMs: last ? baselineFor(all, last.key) : null,
    grew: ran.filter((r) => r.grew).map((r) => ({ at: r.at, ms: r.ms, baselineMs: typeof r.againstMs === 'number' ? r.againstMs : null })),
  };
}

// ---------------------------------------------------------------------------
// Plan mode: reading a plan's check lines, linting them, running one step's
// phase, and tallying the records (see "Plan mode" in the header).
// ---------------------------------------------------------------------------
const STEP_RE = /^- \[[ x]\] (?:🟥|🟨|🟩) \*\*Step ([0-9]+[a-z]?): (.+?)\*\*/;
// A line that reads like a step line but is not one: at the left margin, a
// list line on "Step N" (not bold, no colon, no space, an [X] box, a missing
// or other status mark); indented, one on a bold "**Step N:". It is a lint
// problem and ends the step above it, so its check lines never run as that
// step's. It is looked for only in the Tasks section or under a step, so an
// Outcomes note such as "- **Step 2:** done" is never one.
const LOOSE_STEP_RE = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(?:[^\w\s`*]+\s*)?(?:\*\*)?Step\s*[0-9]+[a-z]?\b/i;
const INDENTED_STEP_RE = /^\s+(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(?:[^\w\s`*]+\s*)?\*\*Step\s*[0-9]+[a-z]?\s*:/i;
const STEP_ARG_RE = /^[0-9]+[a-z]?$/;
// One code span: fenced with two backticks when it holds a backtick, else one.
const SPAN = '(?:``\\s?(.+?)\\s?``|`([^`]+)`)';
const TARGET_LINE_RE = new RegExp('^\\s*- Check target ' + SPAN + ': ' + SPAN + ' - before ' + SPAN + ' - after ' + SPAN + '\\s*$');
const GUARD_LINE_RE = new RegExp('^\\s*- Check guard ' + SPAN + ': ' + SPAN + ' - ' + SPAN + '\\s*$');
const NO_TARGET_RE = /^\s*- Check: no target - (\S.*?)\s*$/;
// A line that may be meant as a check line. Either it starts the way the three
// shapes do (`- Check target`, `- Check guard`, `- Check:`), or it is a near
// miss of their skeleton, in any case and with or without a bullet, a [ ] box,
// a status mark, bold or a quote mark: Check and/or target or guard, then the
// id in a code span and a colon, or "Check: no target". One the shapes do not
// parse is a lint problem, so a near miss never drops a check in silence,
// while "Check that the page loads" or "Check `npm test` passes" is not one.
const CHECK_START_RE = /^\s*- Check(?:\s+(?:target|guard)\b|\s*:)/;
const NEAR_CHECK_RE = new RegExp('^\\s*(?:>\\s*)*(?:(?:[-*+]|\\d+[.)])\\s+)?(?:\\[[ xX]\\]\\s*)?(?:[^\\w\\s`*>]+\\s*)?(?:\\*\\*)?'
  + '(?:checks?(?:\\*\\*)?\\s*:?\\s*(?:\\*\\*)?\\s*no[\\s-]+target'
  + '|checks?(?:\\*\\*)?\\s+(?:(?:target|guard)s?(?:\\*\\*)?\\s*)?`[^`]+`\\s*:'
  + '|(?:target|guard)s?(?:\\*\\*)?\\s*`[^`]+`\\s*:)', 'i');
// A code fence opens on three or more backticks or tildes at the start of a
// line; a backtick fence's info string holds no backtick, so a line such as
// "```npm test``` runs it" is inline code, as CommonMark reads it.
const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const PLAN_BASE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

// The span texts of a match, in order (each SPAN has two capture groups).
function spanTexts(m) {
  const out = [];
  for (let i = 1; i < m.length; i += 2) out.push(m[i] !== undefined ? m[i] : m[i + 1]);
  return out;
}
function parseExpect(text) {
  try { return { value: JSON.parse(text) }; } catch (e) { return { error: 'is not JSON: ' + e.message }; }
}
// null when the expect is a machine object the runner would decide, else why not.
function expectProblem(e) {
  if (e.error) return e.error;
  const v = e.value;
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return 'needs a machine expect ({"exit": 0}, {"match": ...}, {"noMatch": ...} or {"lines": ...}), not ' + JSON.stringify(v);
  }
  const d = decide(v, 0, '', { stdout: '', stderr: '' });
  if (d.verdict === 'error') return d.detail;
  // A key decide() would ignore (a misspelled "mx") makes a weaker check than
  // the plan reads as, and two expects look different when they are not.
  if (v.lines && Object.keys(v.lines).some((k) => k !== 'min' && k !== 'max')) return 'expect.lines takes only min and max';
  return null;
}
// The same three judgments a run makes before anything executes: tokenize,
// guard, rebuild. null when the run would accept the command.
function judgeCommand(text, root, env) {
  const parsed = tokenize(text);
  if (parsed.error) return parsed.error;
  const refusal = guardParsed(parsed, root, env);
  if (refusal) return refusal;
  const built = rebuildCommand(parsed, env);
  return built.error || null;
}

// Whether an HTML comment is still open at the end of `text`, given whether
// one was open at its start: read left to right, each `<!--` opens one and
// each `-->` closes it, and `<!-->` and `<!--->` are whole comments.
function commentOpenAfter(text, open) {
  let i = 0;
  for (;;) {
    if (open) {
      const close = text.indexOf('-->', i);
      if (close === -1) return true;
      open = false;
      i = close + 3;
    } else {
      const start = text.indexOf('<!--', i);
      if (start === -1) return false;
      if (text.startsWith('<!-->', start)) { i = start + 5; continue; }
      if (text.startsWith('<!--->', start)) { i = start + 6; continue; }
      open = true;
      i = start + 4;
    }
  }
}

// The plan's steps in order, each { step, name, line, targets, guards,
// noTarget, problems }, and its problems outside any step, each { line,
// problem }. A step's lines are the ones indented under its step line: the
// next line at the left margin (another step, a heading, any text) ends it.
// Lines in a code fence or an HTML comment are skipped, as the page shows
// them as code or not at all.
function parsePlan(text) {
  const steps = [];
  const problems = [];
  let cur = null;
  let inTasks = false;   // under a "## Tasks" heading
  let fence = null;      // { mark, indent, line } while inside a code fence
  let comment = null;    // { line } while inside a comment that spans lines
  text.split(/\r?\n/).forEach((line, i) => {
    const n = i + 1;
    const t = line.trim();
    const indent = line.length - line.trimStart().length;
    const f = FENCE_RE.exec(line);
    if (fence) {
      // Closed by a bare run of the same character, at least as long. A
      // fence inside a list item also ends with its item, at the first line
      // less indented than the fence, which is then read as usual.
      if (f && f[2][0] === fence.mark[0] && f[2].length >= fence.mark.length && f[3].trim() === '') { fence = null; return; }
      if (t === '' || indent >= fence.indent) return;
      fence = null;
    }
    if (comment) { if (!commentOpenAfter(line, true)) comment = null; return; }
    if (f && !(f[2][0] === '`' && f[3].includes('`'))) { fence = { mark: f[2], indent: f[1].length, line: n }; return; }
    if (t.startsWith('<!--')) { if (commentOpenAfter(t, false)) comment = { line: n }; return; }
    const s = STEP_RE.exec(line);
    if (s) {
      cur = { step: s[1], name: s[2].trim(), line: n, targets: [], guards: [], noTarget: null, problems: [] };
      steps.push(cur);
      return;
    }
    if ((cur || inTasks) && (LOOSE_STEP_RE.test(line) || INDENTED_STEP_RE.test(line))) {
      problems.push({ line: n, problem: 'a step line that does not parse (a step line reads - [ ] 🟥 **Step N: name**): ' + t });
      cur = null;
      return;
    }
    if (/^##\s/.test(line)) inTasks = /^##\s+Tasks\b/i.test(line);
    if (t !== '' && indent === 0) cur = null;
    if (!cur) {
      if (TARGET_LINE_RE.test(line) || GUARD_LINE_RE.test(line) || NO_TARGET_RE.test(line)) {
        problems.push({ line: n, problem: 'a check line outside any step (a step\'s check lines are indented under it), so it never runs: ' + t });
      }
      return;
    }
    if (!CHECK_START_RE.test(line) && !NEAR_CHECK_RE.test(line)) return;
    let m;
    if ((m = TARGET_LINE_RE.exec(line))) {
      const [id, check, before, after] = spanTexts(m);
      cur.targets.push({ id, check, before: parseExpect(before), after: parseExpect(after), line: n });
    } else if ((m = GUARD_LINE_RE.exec(line))) {
      const [id, check, expect] = spanTexts(m);
      cur.guards.push({ id, check, expect: parseExpect(expect), line: n });
    } else if ((m = NO_TARGET_RE.exec(line))) {
      if (cur.noTarget === null) cur.noTarget = m[1];
      else cur.problems.push({ line: n, problem: 'a second "Check: no target" line' });
    } else {
      cur.problems.push({ line: n, problem: 'a check line that does not parse: ' + t });
    }
  });
  if (fence) problems.push({ line: fence.line, problem: 'a code fence that is never closed, so no line after it is read' });
  if (comment) problems.push({ line: comment.line, problem: 'an HTML comment that is never closed, so no line after it is read' });
  // Two steps with one number would share one record folder, and a phase run
  // would only ever find the first: each is a problem, so neither runs.
  const at = {};
  for (const st of steps) (at[st.step] = at[st.step] || []).push(st.line);
  for (const st of steps) {
    if (at[st.step].length > 1) st.problems.push({ line: st.line, problem: 'step ' + st.step + ' is used more than once in this plan (lines ' + at[st.step].join(', ') + ')' });
  }
  return { steps, problems };
}

// Every problem in one step, as { line, problem }; the one for a step with no
// check line at all also carries `missing`, which the tally reports as its own
// status.
function lintStep(st, root, env) {
  const problems = st.problems.slice();
  const add = (line, problem) => problems.push({ line, problem });
  if (st.targets.length && st.noTarget !== null) add(st.line, 'has both a target and a "Check: no target" line');
  if (!st.targets.length && st.noTarget === null) problems.push({ line: st.line, problem: 'has no target and no "Check: no target - <reason>" line', missing: true });
  const seen = new Set();
  for (const c of st.targets.concat(st.guards)) {
    if (!ID_RE.test(c.id)) add(c.line, "the id '" + c.id + "' is not a valid id (letters, digits, . _ - only, starting with a letter or digit)");
    if (seen.has(c.id)) add(c.line, "the id '" + c.id + "' is used more than once in this step");
    seen.add(c.id);
    const refusal = judgeCommand(c.check, root, env);
    if (refusal) add(c.line, "'" + c.id + "' " + refusal);
  }
  for (const t of st.targets) {
    for (const k of ['before', 'after']) {
      const p = expectProblem(t[k]);
      if (p) add(t.line, "'" + t.id + "' " + k + ' expect ' + p);
    }
    if (!t.before.error && !t.after.error && canonical(t.before.value) === canonical(t.after.value)) {
      add(t.line, "'" + t.id + "' has the same expect before and after, so it cannot show a change");
    }
  }
  for (const g of st.guards) {
    const p = expectProblem(g.expect);
    if (p) add(g.line, "'" + g.id + "' expect " + p);
  }
  return problems;
}

// The plan, read through realpath and fenced to the project: { text, base, rel }.
function readPlan(planArg, cwd) {
  const root = realpathOrNull(cwd);
  const real = realpathOrNull(path.resolve(cwd, planArg));
  if (real === null) throw new Error('--plan ' + planArg + ' could not be found');
  if (!root || real === root || !isUnder(real, root)) throw new Error('--plan ' + planArg + ' must be a file inside the project (' + (root || cwd) + ')');
  // A folder, a pipe or a device is never read: a pipe would wait forever.
  let isFile = false;
  try { isFile = fs.statSync(real).isFile(); } catch (e) { throw new Error('--plan ' + planArg + ' could not be read: ' + e.message); }
  if (!isFile) throw new Error('--plan ' + planArg + ' must be a regular file');
  let text;
  try { text = fs.readFileSync(real, 'utf8'); } catch (e) { throw new Error('--plan ' + planArg + ' could not be read: ' + e.message); }
  const base = path.basename(real).replace(/\.md$/i, '');
  if (!PLAN_BASE_RE.test(base)) throw new Error('--plan ' + planArg + ': the file name must be letters, digits, . _ - only, start with a letter or digit, and be at most 121 characters before .md');
  return { text: text.replace(/^﻿/, ''), base, rel: path.relative(root, real), root };
}
const recordRel = (base, step, phase) => path.join('reports', 'checks', base, 'step-' + step, phase);

// The first part of a record path, from reports/ down, that is a link or not a
// folder (project-relative), or null when every part that exists is a real
// folder. Records are read, cleared and written only through such a path, so a
// link can never send a write or a delete outside the project's reports/, or
// into another step's folder.
function linkOnRecordPath(cwd, rel) {
  let cur = cwd;
  for (const part of rel.split(path.sep)) {
    cur = path.join(cur, part);
    let st;
    try { st = fs.lstatSync(cur); } catch (e) { return null; }   // the rest is not there yet
    if (st.isSymbolicLink() || !st.isDirectory()) return path.relative(cwd, cur);
  }
  return null;
}

// Empty a phase's record folder and make it again, so no file from an earlier
// run stays behind looking like this run's. Returns the folder. A link on its
// path is refused before anything is cleared or written.
function freshRecordDir(rel, cwd) {
  const refuse = (part) => new Error('the record folder ' + rel + ' was not used: ' + part + ' is a link or not a folder');
  const bad = linkOnRecordPath(cwd, rel);
  if (bad) throw refuse(bad);
  const abs = path.join(cwd, rel);
  fs.rmSync(abs, { recursive: true, force: true });
  fs.mkdirSync(abs, { recursive: true });
  const root = realpathOrNull(cwd);
  if (linkOnRecordPath(cwd, rel) || !root || realpathOrNull(abs) !== path.join(root, rel)) throw refuse(rel);
  return abs;
}

function lintPlan(opts, cwd) {
  const plan = readPlan(opts.plan, cwd);
  const parsed = parsePlan(plan.text);
  const env = checkEnv();
  const problems = parsed.problems.map((p) => ({ step: null, line: p.line, problem: p.problem }));
  if (!parsed.steps.length) problems.push({ step: null, line: null, problem: 'no step lines found (a step line reads - [ ] 🟥 **Step N: name**)' });
  const list = parsed.steps.map((st) => {
    for (const p of lintStep(st, plan.root, env)) problems.push({ step: st.step, line: p.line, problem: p.problem });
    return { step: st.step, name: st.name, targets: st.targets.map((t) => t.id), guards: st.guards.map((g) => g.id), noTarget: st.noTarget };
  });
  problems.sort((x, y) => (x.line === null ? Infinity : x.line) - (y.line === null ? Infinity : y.line));
  return { plan: plan.rel, steps: list, problems, summary: { steps: parsed.steps.length, problems: problems.length } };
}

function runPlanPhase(opts, cwd) {
  const plan = readPlan(opts.plan, cwd);
  const parsed = parsePlan(plan.text);
  const st = parsed.steps.find((s) => s.step === opts.step);
  if (!st) throw new Error('step ' + opts.step + ' is not in ' + plan.rel);
  const env = checkEnv();
  // A problem outside the steps (a step line that does not parse, a fence
  // never closed) means the plan may not say what it seems to, so it stops
  // every step's run, not only its own.
  const problems = parsed.problems.concat(lintStep(st, plan.root, env));
  if (problems.length) {
    throw new Error((parsed.problems.length ? 'the plan' : 'step ' + st.step) + ' has lint problems, so nothing ran (fix the plan, then run --lint): '
      + problems.map((p) => 'line ' + p.line + ': ' + p.problem).join('; '));
  }
  // A before run also holds each target's output against its after expect,
  // which must not hold yet (`notYet`, see attempt).
  const checks = st.targets.map((t) => ({ id: t.id, check: t.check, expect: opts.phase === 'before' ? t.before.value : t.after.value, role: 'target',
    notYet: opts.phase === 'before' ? t.after.value : undefined }))
    .concat(st.guards.map((g) => ({ id: g.id, check: g.check, expect: g.expect.value, role: 'guard' })));
  const outDir = freshRecordDir(recordRel(plan.base, st.step, opts.phase), cwd);
  return runAll(checks, { timeout: opts.timeout, rerunFailures: true }, cwd, outDir, { plan: plan.rel, step: st.step, phase: opts.phase });
}

// A phase's results.json: null when the phase never ran, { why } when a file
// is there but cannot count (a link on its path, not this plan's, step's or
// phase's, or not a record), else { rec }.
function readRecord(cwd, rel, want) {
  const bad = linkOnRecordPath(cwd, rel);
  if (bad) return { why: bad + ' is a link or not a folder' };
  const file = path.join(cwd, rel, 'results.json');
  let st;
  try { st = fs.lstatSync(file); } catch (e) { return null; }
  if (!st.isFile()) return { why: 'its results.json is a link or not a file' };
  let r;
  try { r = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { why: 'its results.json is not valid JSON' }; }
  const isRow = (c) => c !== null && typeof c === 'object' && typeof c.id === 'string' && typeof c.verdict === 'string';
  if (r === null || typeof r !== 'object' || !Array.isArray(r.checks) || !r.checks.every(isRow)) return { why: 'its results.json does not hold check rows' };
  if (typeof r.at !== 'string' || isNaN(Date.parse(r.at))) return { why: 'its results.json has no valid time (at)' };
  for (const k of ['plan', 'step', 'phase']) {
    if (r[k] !== undefined && String(r[k]) !== want[k]) return { why: 'it was written for ' + k + ' ' + JSON.stringify(r[k]) + ', not ' + JSON.stringify(want[k]) };
  }
  return { rec: r };
}

// JSON with sorted keys, so key order never decides whether two expects match.
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v !== null && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
// True when a recorded row ran another command, expect or role than the plan
// names now. A row with no command recorded (an older runner's) is matched by
// its id alone, and the tally says so in the step's notes.
function drifted(row, check, expect, role) {
  if (row.check === undefined) return false;
  return row.check !== check || canonical(row.expect) !== canonical(expect) || (row.role !== undefined && row.role !== role);
}

// Judge one step's two records into row.reasons, row.brokenBefore and
// row.notes: each target showed its stated failure before and passed after,
// each guard that passed before passed after, every row ran what the plan
// names now, and the before run is older than the after run.
function judgeRecords(st, before, after, row) {
  const reasons = row.reasons;
  // A Map, so an id such as "constructor" or "__proto__" is never read off a
  // plain object's prototype as a result that never ran.
  const byId = (rec) => new Map(rec.checks.map((c) => [c.id, c]));
  const recorded = { before: byId(before), after: byId(after) };
  for (const phase of ['before', 'after']) {
    const bare = st.targets.concat(st.guards).filter((c) => recorded[phase].has(c.id) && recorded[phase].get(c.id).check === undefined).map((c) => c.id);
    if (bare.length) row.notes.push('the ' + phase + ' record names no command for ' + bare.join(', ') + ' (an older runner wrote it), so those are matched by id alone');
  }
  const b = recorded.before;
  const a = recorded.after;
  const changed = (kind, id, phase) => kind + " '" + id + "' ran a different command, expect or role " + phase + ' than the plan names now (run the phase again)';
  const flake = (c) => (c.flaky ? ', flaky' : '');
  for (const t of st.targets) {
    const bt = b.get(t.id);
    const at = a.get(t.id);
    if (!bt) reasons.push("target '" + t.id + "' has no before result");
    else if (drifted(bt, t.check, t.before.value, 'target')) reasons.push(changed('target', t.id, 'before'));
    else if (bt.verdict !== 'pass') reasons.push("target '" + t.id + "' did not show its stated failure before (" + bt.verdict + flake(bt) + ')');
    if (!at) reasons.push("target '" + t.id + "' has no after result");
    else if (drifted(at, t.check, t.after.value, 'target')) reasons.push(changed('target', t.id, 'after'));
    else if (at.verdict !== 'pass') reasons.push("target '" + t.id + "' did not pass after (" + at.verdict + flake(at) + ')');
  }
  for (const g of st.guards) {
    const bg = b.get(g.id);
    const ag = a.get(g.id);
    if (!bg) { reasons.push("guard '" + g.id + "' has no before result"); continue; }
    if (drifted(bg, g.check, g.expect.value, 'guard')) { reasons.push(changed('guard', g.id, 'before')); continue; }
    if (bg.verdict !== 'pass') { row.brokenBefore.push(g.id); continue; }
    if (!ag) reasons.push("guard '" + g.id + "' has no after result");
    else if (drifted(ag, g.check, g.expect.value, 'guard')) reasons.push(changed('guard', g.id, 'after'));
    else if (ag.verdict !== 'pass' && !ag.flaky) reasons.push("guard '" + g.id + "' failed after");
  }
  if (!(Date.parse(before.at) < Date.parse(after.at))) reasons.push('the before record is not older than the after record');
}

function tallyPlan(opts, cwd) {
  const plan = readPlan(opts.plan, cwd);
  const parsed = parsePlan(plan.text);
  const env = checkEnv();
  // The plan's problems outside any step, as the lint lists them, counted in
  // the summary too: a caller that reads only the counts still sees them.
  const problems = parsed.problems.map((p) => ({ step: null, line: p.line, problem: p.problem }));
  if (!parsed.steps.length) problems.push({ step: null, line: null, problem: 'no step lines found (a step line reads - [ ] 🟥 **Step N: name**)' });
  const summary = { steps: parsed.steps.length, proved: 0, unproved: 0, noTarget: 0, missing: 0, problem: 0, flaky: 0, slow: 0, problems: problems.length };
  const out = parsed.steps.map((st) => {
    const row = { step: st.step, name: st.name, status: '', reasons: [], notes: [], flaky: [], slow: [], brokenBefore: [] };
    const want = (phase) => ({ plan: plan.rel, step: st.step, phase });
    const before = readRecord(cwd, recordRel(plan.base, st.step, 'before'), want('before'));
    const after = readRecord(cwd, recordRel(plan.base, st.step, 'after'), want('after'));
    for (const r of [before, after]) {
      for (const c of (r && r.rec ? r.rec.checks : [])) {
        if (c.flaky && row.flaky.indexOf(c.id) === -1) row.flaky.push(c.id);
        if (c.slow && row.slow.indexOf(c.id) === -1) row.slow.push(c.id);
      }
    }
    const problems = lintStep(st, plan.root, env);
    if (problems.some((p) => !p.missing)) {
      row.status = 'problem';
      row.reasons = problems.map((p) => 'line ' + p.line + ': ' + p.problem);
    } else if (problems.length) {
      row.status = 'missing';
    } else {
      // A step with checks needs both records, whether its checks are targets
      // or only guards (a refactor); a no-target step with no guard needs none.
      if (st.targets.length || st.guards.length) {
        for (const [phase, r] of [['before', before], ['after', after]]) {
          if (!r) row.reasons.push('no ' + phase + ' record');
          else if (r.why) row.reasons.push('the ' + phase + ' record cannot count: ' + r.why);
        }
        if (before && before.rec && after && after.rec) judgeRecords(st, before.rec, after.rec, row);
      }
      if (st.noTarget !== null) {
        row.reason = st.noTarget;
        row.status = row.reasons.length ? 'unproved' : 'noTarget';
      } else {
        row.status = row.reasons.length ? 'unproved' : 'proved';
      }
    }
    summary[row.status]++;
    if (row.flaky.length) summary.flaky++;
    if (row.slow.length) summary.slow++;
    return row;
  });
  return { plan: plan.rel, steps: out, problems, summary };
}

function main(argv) {
  const fail = (reason) => { process.stderr.write('run-checks: ' + reason + '\n'); process.exit(1); };
  let opts;
  try { opts = parseArgs(argv); } catch (e) { fail(e.message + '\n' + USAGE.trimEnd()); }
  if (opts.help) { process.stdout.write(USAGE); return; }
  const cwd = process.cwd();
  if (opts.history) {
    if (opts.checks || opts.out || opts.plan || opts.full || opts.lint || opts.tally || opts.step || opts.phase || opts.rerunFailures) {
      fail('--history takes only --since');
    }
    let since = null;
    if (opts.since) {
      since = Date.parse(opts.since);
      if (isNaN(since)) fail('--since needs a time, such as 2026-10-15T01:00:00Z');
    }
    let report;
    try { report = historyReport(cwd, since); } catch (e) { fail(e.message); }
    process.stdout.write(JSON.stringify(report) + '\n');
    return;
  }
  if (opts.since) fail('--since goes with --history');
  if (opts.plan || opts.lint || opts.tally || opts.step || opts.phase) {
    // Plan mode writes its own records, so it takes no --checks and no --out.
    if (!opts.plan) fail('--lint, --tally, --step and --phase go with --plan <plan.md>\n' + USAGE.trimEnd());
    if (opts.checks || opts.out) fail('--plan cannot be combined with --checks or --out (a plan run keeps its own records)');
    if (opts.full) fail('--full goes only with --checks: a plan step\'s checks are never the full test step');
    const phaseRun = !!(opts.step || opts.phase);
    if ([opts.lint, opts.tally, phaseRun].filter(Boolean).length !== 1) fail('--plan needs exactly one of --lint, --tally, or --step <N> --phase before|after');
    if (phaseRun && (!STEP_ARG_RE.test(opts.step) || (opts.phase !== 'before' && opts.phase !== 'after'))) {
      fail('--step takes a step number such as 3 or 5a, and --phase takes before or after');
    }
    let result;
    try { result = opts.lint ? lintPlan(opts, cwd) : opts.tally ? tallyPlan(opts, cwd) : runPlanPhase(opts, cwd); } catch (e) { fail(e.message); }
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }
  if (!opts.checks || !opts.out) fail('--checks and --out are both required\n' + USAGE.trimEnd());
  let checks;
  try { checks = loadChecks(opts.checks); } catch (e) { fail(e.message); }
  // A refused history stops a full run before its out folder is made.
  let history = null;
  if (opts.full) { try { history = historyFile(cwd); } catch (e) { fail(e.message); } }
  let outDir;
  try { outDir = prepareOutDir(opts.out, cwd); } catch (e) { fail(e.message); }
  let result;
  try { result = opts.full ? runFull(checks, opts, cwd, outDir, history) : runAll(checks, opts, cwd, outDir); } catch (e) { fail(e.message); }
  process.stdout.write(JSON.stringify(result) + '\n');
}

// fingerprint is also the toolkit repo's release gate's (issue #249): one
// definition of "the same files" for a skipped test run and a reused pass.
module.exports = { tokenize, guardCheck, rebuildCommand, decide, ALLOW, main, parsePlan, fingerprint };
if (require.main === module) main(process.argv.slice(2));
