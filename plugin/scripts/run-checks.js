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
//   node run-checks.js --checks <file.json> --out <dir> [--timeout <ms>]
//
// <file.json> is a JSON array of { id, check, expect }:
//   id      a filename stem: letters, digits, . _ - only, unique in the file
//   check   one shell line, read-only (the allow-list below decides)
//   expect  a string (prose; the verdict is `model` and the caller judges), or
//           an object with exactly one of
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
//   { "checks": [ { "id", "verdict", "exit", "stdoutFile", "detail" } ... ],
//     "summary": { "pass", "fail", "model", "error" } }
// verdict is pass, fail, model or error. `exit` is the check's exit code (124
// on a timeout, 143 when the output passed the 16 MB buffer and the check was
// stopped, null when nothing ran); `stdoutFile` is the saved file's path
// relative to the project root (absolute when the out folder sits outside it,
// null when nothing was written); `detail` is the last lines of the output for
// a fail, the reason for an error, and empty otherwise.
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
// d a symlink read the project's parent). A refused check gets verdict
// `error` with the reason, no file, and nothing executed.
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
// of find only walks and prints.
const FIND_REFUSED = ['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprintf', '-fls', '-fprint0'];
function findRule(args) {
  for (const a of args) if (FIND_REFUSED.indexOf(a) !== -1) return "refused: find " + a + " writes or runs a command";
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
  grep: ok,                                   // searches; no exec or write flag
  rg: (a) => a.some((x) => flagIs(x, ['--pre', '--pre-glob'])) ? 'refused: rg --pre runs a preprocessor command' : null,
  cat: ok,                                    // concatenates to stdout
  head: ok,                                   // prints the first lines
  tail: ok,                                   // prints the last lines
  wc: ok,                                     // counts
  ls: ok,                                     // lists a folder
  test: ok,                                   // evaluates a condition, prints nothing
  '[': ok,                                    // the same as test
  diff: ok,                                   // compares, prints the difference
  cmp: ok,                                    // compares bytes
  jq: ok,                                     // filters JSON; has no file write or exec
  sort: sortRule,                             // -o writes; --compress-program runs a program; -T picks a temp folder
  uniq: uniqRule,                             // a second file argument is an output file
  comm: ok,                                   // compares sorted files
  cut: ok,                                    // selects columns
  tr: ok,                                     // translates characters
  echo: ok,                                   // prints its arguments
  printf: ok,                                 // prints its arguments
  stat: ok,                                   // prints file metadata
  file: (a) => a.some((x) => x === '-C' || x === '--compile') ? 'refused: file -C compiles a magic file to disk' : null,
  basename: ok,                               // string work on a path
  dirname: ok,                                // string work on a path
  realpath: ok,                               // resolves a path
  readlink: ok,                               // reads a link
  true: ok,                                   // exits 0
  false: ok,                                  // exits 1
  sleep: ok,                                  // waits
  lsof: ok,                                   // lists open files and ports
  sed: sedRule,                               // only print and substitute scripts, no -i
  find: findRule,                             // walks and prints; the acting flags refused
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
// --temporary-directory choose where those files are written. Each long
// option is refused by its unambiguous prefixes as well (--out, --co, --t).
function sortRule(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/^-[A-Za-z]*o/.test(a) || longOptionIs(a, '--output', '--o')) return 'refused: sort -o writes a file';
    if (longOptionIs(a, '--compress-program', '--co')) return 'refused: sort --compress-program runs a program on its temporary files';
    if (/^-[A-Za-z]*T/.test(a) || longOptionIs(a, '--temporary-directory', '--t')) return 'refused: sort -T writes temporary files to a folder of the check\'s choosing';
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
  if (typeof expect === 'string') return { verdict: 'model', detail: '' };
  if (expect === null || typeof expect !== 'object' || Array.isArray(expect)) {
    return err('expect must be a string or an object with exactly one of exit, match, noMatch, lines');
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
  return data;
}

const USAGE = 'usage: node run-checks.js --checks <file.json> --out <dir> [--timeout <ms>]\n'
  + '  --checks   a JSON array of { id, check, expect }\n'
  + '  --out      where <id>.txt is saved; must be under reports/ or the system temp folder\n'
  + '  --timeout  per check, in milliseconds (default ' + DEFAULT_TIMEOUT_MS + ')\n'
  + '  expect     a prose string (verdict model), or exactly one of\n'
  + '             {"exit": 0}  {"match": "regex"}  {"noMatch": "regex"}  {"lines": {"min": 1, "max": 3}}\n'
  + '             (regexes are tested with the multiline flag against the saved output)\n'
  + '  stdout     one JSON object: { checks: [{ id, verdict, exit, stdoutFile, detail }], summary }\n'
  + '  exit code  0 when the checks file validated (verdicts are the result); 1 for a malformed file or a refused --out\n';

function parseArgs(argv) {
  const opts = { checks: '', out: '', timeout: DEFAULT_TIMEOUT_MS, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
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

function main(argv) {
  const fail = (reason) => { process.stderr.write('run-checks: ' + reason + '\n'); process.exit(1); };
  let opts;
  try { opts = parseArgs(argv); } catch (e) { fail(e.message + '\n' + USAGE.trimEnd()); }
  if (opts.help) { process.stdout.write(USAGE); return; }
  if (!opts.checks || !opts.out) fail('--checks and --out are both required\n' + USAGE.trimEnd());
  const cwd = process.cwd();
  let checks;
  try { checks = loadChecks(opts.checks); } catch (e) { fail(e.message); }
  let outDir;
  try { outDir = prepareOutDir(opts.out, cwd); } catch (e) { fail(e.message); }
  const env = checkEnv();              // the same environment the guard judges with
  const root = realpathOrNull(cwd);

  const results = [];
  const summary = { pass: 0, fail: 0, model: 0, error: 0 };
  for (const c of checks) {
    const row = { id: c.id, verdict: 'error', exit: null, stdoutFile: null, detail: '' };
    // Tokenize, judge, rebuild: bash runs the rebuilt line and never c.check.
    const parsed = tokenize(c.check);
    let refusal = parsed.error || guardParsed(parsed, root, env);
    let line = null;
    if (!refusal) {
      const built = rebuildCommand(parsed, env);
      if (built.error) refusal = built.error; else line = built.line;
    }
    if (refusal) {
      row.detail = refusal;
    } else {
      const run = runCheck(line, cwd, opts.timeout, env);
      if (run.failed) {
        row.detail = run.failed;
      } else {
        const file = path.join(outDir, c.id + '.txt');
        try {
          fs.writeFileSync(file, run.body + 'exit ' + run.exit + '\n');
          const rel = path.relative(cwd, file);
          row.stdoutFile = (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) ? file : rel;
        } catch (e) {
          row.detail = 'could not save the output to ' + file + ': ' + e.message;
        }
        row.exit = run.exit;
        if (!row.detail) {
          if (run.timedOut || run.overflow) {
            row.verdict = 'fail';
            row.detail = run.overflow ? 'output passed the ' + (MAX_BUFFER / 1048576) + ' MB buffer and the check was stopped' : tailDetail(run.body);
          } else {
            const d = decide(c.expect, run.exit, run.body, { stdout: run.stdout, stderr: run.stderr });
            row.verdict = d.verdict;
            row.detail = d.verdict === 'fail' ? tailDetail(run.body) : d.detail;
          }
        }
      }
    }
    if (row.verdict === 'error') process.stderr.write('run-checks: ' + c.id + ': ' + row.detail + '\n');
    summary[row.verdict]++;
    results.push(row);
  }
  process.stdout.write(JSON.stringify({ checks: results, summary }) + '\n');
}

module.exports = { tokenize, guardCheck, rebuildCommand, decide, ALLOW, main };
if (require.main === module) main(process.argv.slice(2));
