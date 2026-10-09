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
// on a timeout, null when nothing ran); `stdoutFile` is the saved file's path
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
// before anything runs. A refused check gets verdict `error` with the reason,
// no file, and nothing executed.
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
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const EXPECT_KEYS = ['exit', 'match', 'noMatch', 'lines'];

// ---------------------------------------------------------------------------
// The tokenizer. A small shell-word reader: single quotes, double quotes and
// backslash escapes build words; an unquoted |, ||, &&, ; or newline ends a
// segment. It refuses, by returning a reason, every unquoted construct that
// could run something the allow-list never saw or write somewhere: a subshell
// or process substitution, a brace group, a here-document, a background job,
// and any redirection other than the exact harmless forms 2>&1, 2>/dev/null,
// >/dev/null, 1>/dev/null and &>/dev/null. Command substitution ($( and
// backticks) and brace parameter expansion (${) are refused wherever they
// appear, quoted or not, because double quotes do not stop them. One brace
// expansion is allowed as an exact literal: ${CLAUDE_PLUGIN_ROOT}, the path
// the plugin build writes in place of .claude/ in every shipped prompt. It
// expands to a folder and nothing else, so it is hidden from the tokenizer
// behind a sentinel and put back into the words afterwards; any other ${ form
// (${x@P} expands prompt escapes and can run a command) stays refused.
// ---------------------------------------------------------------------------
const PLUGIN_ROOT_LITERAL = '${CLAUDE_PLUGIN_ROOT}';
const PLUGIN_ROOT_SENTINEL = '\u0001';
function tokenize(original) {
  if (original.indexOf(PLUGIN_ROOT_SENTINEL) !== -1) return { error: 'refused: control character in the command' };
  const text = original.split(PLUGIN_ROOT_LITERAL).join(PLUGIN_ROOT_SENTINEL);
  if (text.indexOf('`') !== -1) return { error: 'refused: command substitution (backtick)' };
  if (text.indexOf('$(') !== -1) return { error: 'refused: command substitution ($( ))' };
  if (text.indexOf('${') !== -1) return { error: 'refused: brace parameter expansion (${ }); only the exact literal ${CLAUDE_PLUGIN_ROOT} is allowed' };
  const segments = [];
  let words = [];
  let cur = '';
  let have = false;        // a word is open (so '' quoted is still a word)
  let inSingle = false;
  let inDouble = false;
  const n = text.length;
  const flushWord = () => { if (have) { words.push(cur); cur = ''; have = false; } };
  const flushSegment = () => { flushWord(); if (words.length) segments.push(words); words = []; };
  const boundary = (s) => s === '' || /^[\s;|&]/.test(s);   // what may follow a redirection form
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inSingle) { if (c === "'") inSingle = false; else cur += c; continue; }
    if (inDouble) {
      if (c === '"') { inDouble = false; continue; }
      if (c === '\\' && i + 1 < n) { cur += text[i + 1]; i++; continue; }
      cur += c;
      continue;
    }
    if (c === '\\') { if (i + 1 < n) { cur += text[i + 1]; have = true; i++; } continue; }
    if (c === "'") { inSingle = true; have = true; continue; }
    if (c === '"') { inDouble = true; have = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { flushWord(); continue; }
    if (c === '\n' || c === ';') { flushSegment(); continue; }
    if (c === '|') { if (text[i + 1] === '|') i++; flushSegment(); continue; }
    if (c === '&') {
      if (text[i + 1] === '&') { i++; flushSegment(); continue; }
      const rest = text.slice(i);
      if (!have && rest.startsWith('&>/dev/null') && boundary(rest.slice('&>/dev/null'.length))) {
        i += '&>/dev/null'.length - 1;
        continue;
      }
      return { error: 'refused: background operator or unsupported redirection (&)' };
    }
    if (c === '>') {
      const rest = text.slice(i);
      const fd = have ? cur : '';
      let form = null;
      if (fd === '2' && rest.startsWith('>&1')) form = '>&1';
      else if ((fd === '' || fd === '1' || fd === '2') && rest.startsWith('>/dev/null')) form = '>/dev/null';
      if (form && boundary(rest.slice(form.length))) {
        cur = ''; have = false;          // the fd digit was part of the redirection
        i += form.length - 1;
        continue;
      }
      return { error: 'refused: output redirection' };
    }
    if (c === '<') {
      if (text[i + 1] === '<') return { error: 'refused: here-document or here-string (<<)' };
      if (text[i + 1] === '(') return { error: 'refused: process substitution (<( ))' };
      cur += c; have = true;             // a plain `< file` reads a file
      continue;
    }
    if (c === '(' || c === ')') return { error: 'refused: subshell or process substitution ( )' };
    if (c === '{' || c === '}') return { error: 'refused: brace group or brace expansion { }' };
    cur += c; have = true;
  }
  if (inSingle || inDouble) return { error: 'refused: unterminated quote' };
  flushSegment();
  // Put the one allowed brace expansion back; bash expands it when the
  // original text runs.
  return { segments: segments.map((words) => words.map((w) => w.split(PLUGIN_ROOT_SENTINEL).join(PLUGIN_ROOT_LITERAL))) };
}

// ---------------------------------------------------------------------------
// The allow-list. One constant, one entry per first word, each a function of
// the segment's arguments returning null (allowed) or the refusal reason. The
// comment on each entry says why the command is read-only, or which of its
// arguments would make it write or execute and are therefore refused.
// ---------------------------------------------------------------------------
const ok = () => null;
const flagIs = (a, names) => names.some((f) => a === f || a.startsWith(f + '='));

// sed: an address-print script (1,3p; /re/p; /a/,/b/p) or a plain
// substitution s<d>pattern<d>replacement<d>[flags] with <d> one of / | # , and
// flags from g i p I and digits only. Nothing else, so no e (execute), w or W
// (write), r or R (read another file), and no second command after a `;`.
const SED_PRINT_RE = /^(\d+|\$|\/(?:[^\/\\]|\\.)+\/)(,(\d+|\$|\/(?:[^\/\\]|\\.)+\/))?p$/;
const SED_FLAGS_RE = /^-[nEr]+$/;
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
    if (!SED_PRINT_RE.test(s) && !isSedSubstitution(s)) {
      return "refused: sed script '" + s + "' is not an address print (1,3p; /re/p) or a plain substitution (s/a/b/g)";
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
    if (flagIs(a, ['--output', '--ext-diff', '--open-files-in-pager']) || a === '-O' || a.startsWith('-O')) {
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
// upgrade-audit.js without the two flags that write its record.
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

// The ecosystem test entry points. Running a project's tests is the second
// consumer's whole job, so these are allowed although a test suite runs the
// project's own code: that code is the owner's, not the finder's.
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
  sort: (a) => a.some((x) => /^-[A-Za-z]*o/.test(x) || flagIs(x, ['--output'])) ? 'refused: sort -o writes a file' : null,
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
  curl: curlRule,                             // local dev-server probe only
};
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

// The guard over one whole check. Returns null when every segment is allowed,
// else the first refusal reason.
function guardCheck(text) {
  const t = tokenize(text);
  if (t.error) return t.error;
  if (!t.segments.length) return 'refused: empty command';
  for (const words of t.segments) {
    const cmd = words[0];
    if (ENV_ASSIGN_RE.test(cmd)) return "refused: environment assignment '" + cmd.split('=')[0] + "=...' before the command";
    const rule = Object.prototype.hasOwnProperty.call(ALLOW, cmd) ? ALLOW[cmd] : null;
    if (!rule) return "refused: first word '" + cmd + "' is not on the read-only allow-list";
    const reason = rule(words.slice(1));
    if (reason) return reason;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Expectations. `body` is the saved output without the exit line.
// ---------------------------------------------------------------------------
function decide(expect, exitCode, body) {
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
    passed = k === 'match' ? hit : !hit;
  } else {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return err('expect.lines must be an object with integer min and/or max');
    const hasMin = v.min !== undefined;
    const hasMax = v.max !== undefined;
    if (!hasMin && !hasMax) return err('expect.lines needs min or max');
    if ((hasMin && !Number.isInteger(v.min)) || (hasMax && !Number.isInteger(v.max))) return err('expect.lines min and max must be integers');
    const count = body.split('\n').filter((l) => l.trim() !== '').length;
    passed = (!hasMin || count >= v.min) && (!hasMax || count <= v.max);
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

function runCheck(check, cwd, timeout) {
  const r = spawnSync('bash', ['-c', check], {
    cwd, timeout, env: checkEnv(), encoding: 'utf8', maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT') || (r.status === null && r.signal === 'SIGTERM' && !!r.error);
  if (r.error && !timedOut && r.error.code !== 'ENOBUFS' && r.status === null && !r.signal) {
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
  let body = stdout;
  if (body && !body.endsWith('\n')) body += '\n';
  body += stderr;
  if (body && !body.endsWith('\n')) body += '\n';
  if (Buffer.byteLength(body, 'utf8') > OUTPUT_CAP_BYTES) {
    body = Buffer.from(body, 'utf8').subarray(0, OUTPUT_CAP_BYTES).toString('utf8');
    if (!body.endsWith('\n')) body += '\n';
    body += '[truncated]\n';
  }
  return { exit, body, timedOut };
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

  const results = [];
  const summary = { pass: 0, fail: 0, model: 0, error: 0 };
  for (const c of checks) {
    const row = { id: c.id, verdict: 'error', exit: null, stdoutFile: null, detail: '' };
    const refusal = guardCheck(c.check);
    if (refusal) {
      row.detail = refusal;
    } else {
      const run = runCheck(c.check, cwd, opts.timeout);
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
          if (run.timedOut) {
            row.verdict = 'fail';
            row.detail = tailDetail(run.body);
          } else {
            const d = decide(c.expect, run.exit, run.body);
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

module.exports = { tokenize, guardCheck, decide, ALLOW, main };
if (require.main === module) main(process.argv.slice(2));
