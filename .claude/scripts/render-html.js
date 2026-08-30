#!/usr/bin/env node
'use strict';
//
// render-html.js - inject a compact findings JSON into a prebuilt HTML shell and
// write a self-contained artifact: uniquely-timestamped by default, or
// identity-keyed with --stable. (issues #120, #127, #129)
//
// Why this exists:
//   Toolkit commands (/review, /document, /explore, /ask-*, /audit-html) used to
//   make Claude hand-write the entire ~13KB HTML file - all CSS, structure, and
//   every finding card - as model output. That was slow (#120). Worse, the files
//   were named by date only, so a same-day re-run collided; Claude's Write tool
//   refuses to overwrite a file it has not read this session, forcing a
//   Read-then-Write of the old file and doubling the cost (#127, and a second
//   cause of #120).
//
//   This script flips the model: Claude emits ONLY the small JSON payload. The
//   boilerplate lives once in a prebuilt shell (.claude/skills/shared/shells/
//   <shell>-shell.html). This script reads the shell, inlines the shared design
//   tokens (tokens.css) and the JSON data into the shell's two slots, computes a
//   YYYY-MM-DD-HHMMSS filename (collision-proof, with a -N guard for same-second
//   runs), and writes the file. A script overwriting a file has no
//   "read-before-overwrite" constraint, so the Read-then-Write cycle is gone.
//
//   The output is a single self-contained file: inline CSS, inline JSON, inline
//   renderer JS. No CDN, works offline on file://.
//
//   The page's <title> is taken from the payload ("title", or "topic" for the
//   debate and explore shells) so each artifact carries its own name rather than
//   the shell's generic default. That tag is the page identity in a browser tab
//   and, when the artifact is published to a hosted page, its name there too.
//
// Usage:
//   node .claude/scripts/render-html.js --shell <review|debate|document|explore|audit|plan|docview> \
//                                       --name <basename> [--data <file>] \
//                                       [--out-dir <dir>] [--stable]
//   echo '<json>' | node .claude/scripts/render-html.js --shell review --name review-orchestrator
//
//   --shell    which template under .claude/skills/shared/shells/ to use
//   --name     filename prefix, e.g. review-orchestrator, review-code, debate-gpt,
//              document, explore-<slug>, audit-html, PLAN-issue-<n>. The timestamp
//              is appended unless --stable is set.
//   --data     path to a JSON file. If omitted or "-", JSON is read from stdin.
//   --out-dir  output directory. Default: artifacts/html. Resolved against the
//              current working directory (relative or absolute both work) and
//              created if missing. Lets plan views land in plans/ instead.
//   --stable   write exactly <name>.html in the out dir - no timestamp, no -N
//              collision guard - overwriting any existing file. This exists for
//              identity-keyed outputs that pair with a markdown file and are
//              REPLACED on re-run, like plans/PLAN-issue-<n>.html next to
//              PLAN-issue-<n>.md: a re-plan must refresh the one view, not pile
//              up timestamped copies. (issue #129)
//
// Output: writes <out-dir>/<name>-<timestamp>.html, or <out-dir>/<name>.html with
//   --stable (out-dir defaults to artifacts/html under the CURRENT working
//   directory, i.e. the project root), and prints that path to stdout. Only the
//   path goes to stdout (callers capture it to hand to open-artifact.sh);
//   diagnostics go to stderr. Exit 0 on success, 1 on any error.
//
// Zero external dependencies (Node built-ins only), so it adds nothing to the
// quarantined .claude/scripts/package.json.

const fs = require('fs');
const path = require('path');

function die(msg) {
  console.error('render-html.js: ' + msg);
  process.exit(1);
}

// --- parse args (no dependency on an arg-parsing library) ---
const argv = process.argv.slice(2);
const opts = { shell: '', name: '', data: '', outDir: 'artifacts/html', stable: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--shell') opts.shell = argv[++i] || '';
  else if (a === '--name') opts.name = argv[++i] || '';
  else if (a === '--data') opts.data = argv[++i] || '';
  else if (a === '--out-dir') opts.outDir = argv[++i] || '';
  else if (a === '--stable') opts.stable = true; // boolean flag, takes no value
  else die('unknown argument: ' + a);
}

if (!opts.shell) die('missing --shell <review|debate|document|explore|audit|plan|docview>');
if (!opts.name) die('missing --name <basename>');
if (!opts.outDir) die('--out-dir given without a directory');

// Sanitize the name into a safe filename fragment - no slashes, no path traversal.
// Distinct names can collapse to the same prefix (e.g. "a/b" and "a-b" both
// become "a-b"); the -N timestamp guard below is the backstop against collisions
// (in --stable mode there is no guard: overwriting is the intended behavior).
const safeName = opts.name.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[-_.]+/, '_');
if (!safeName) die('--name produced an empty filename');

// Validate the shell against the allowlist before it is used to build a path.
const SHELLS = ['review', 'debate', 'document', 'explore', 'audit', 'plan', 'docview'];
if (!SHELLS.includes(opts.shell)) {
  die('invalid --shell "' + opts.shell + '"; valid shells: ' + SHELLS.join(', '));
}

// --- resolve the shell template and shared tokens (they live next to this script) ---
const shellsDir = path.join(__dirname, '..', 'skills', 'shared', 'shells');
const shellPath = path.join(shellsDir, opts.shell + '-shell.html');
const tokensPath = path.join(shellsDir, 'tokens.css');
if (!fs.existsSync(shellPath)) die('shell template not found: ' + shellPath);
if (!fs.existsSync(tokensPath)) die('tokens.css not found: ' + tokensPath);

// --- read the JSON data (from --data file, or stdin) ---
let rawData;
try {
  if (!opts.data || opts.data === '-') rawData = fs.readFileSync(0, 'utf-8'); // fd 0 = stdin
  else rawData = fs.readFileSync(opts.data, 'utf-8');
} catch (e) {
  die('could not read data: ' + e.message);
}

let parsed;
try {
  parsed = JSON.parse(rawData);
} catch (e) {
  die('data is not valid JSON: ' + e.message);
}

// Re-stringify with every "<" escaped to < so the JSON can live inside a
// <script> block without "</script>" ever terminating it early. JSON.parse in
// the shell decodes < back to "<" transparently.
const safeJson = JSON.stringify(parsed)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

const shellHtml = fs.readFileSync(shellPath, 'utf-8');
const tokensCss = fs.readFileSync(tokensPath, 'utf-8');

// --- inject into the shell's two slots ---
// Function-form replacements so "$" sequences in the CSS/JSON are inserted
// literally (string-form replacement would treat $& / $1 / $$ specially).
// Each placeholder must appear EXACTLY ONCE. The first-occurrence replace means
// a duplicate leaves a raw literal in the rendered output with no error signal.
function countOccurrences(str, sub) { return str.split(sub).length - 1; }
if (countOccurrences(shellHtml, '/*__TOKENS__*/') !== 1)
  die('shell must contain /*__TOKENS__*/ exactly once: ' + shellPath);
if (countOccurrences(shellHtml, '__RENDER_DATA__') !== 1)
  die('shell must contain __RENDER_DATA__ exactly once: ' + shellPath);
const out = shellHtml
  .replace('/*__TOKENS__*/', function () { return tokensCss; })
  .replace('__RENDER_DATA__', function () { return safeJson; });

// --- name the page from the payload (issue #154) ---
// The <title> tag is the page's identity wherever it is viewed: the browser tab
// locally, and the hosted page's name when the artifact is published. A publish
// cannot override it - a title supplied alongside the file is only a fallback
// for a file that has none, and the tag always wins - so the tag is the ONLY
// place a per-artifact name can come from. Without this, every published review
// is called "Review" and every plan "Plan", which makes a list of them useless.
//
// Each shell ships a sensible static default in its <head>; this swaps in the
// payload's own name when it has one. Two field names cover all seven shells:
//   review, document, audit, docview, plan -> "title"
//   debate, explore                        -> "topic"
// When the payload carries neither, the shell's default stands and the output is
// byte-identical to what it was before this step.
function escapeHtmlText(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const rawTitle = [parsed.title, parsed.topic].find(function (t) {
  return typeof t === 'string' && t.trim() !== '';
});

let finalHtml = out;
if (rawTitle) {
  // Every shell carries exactly one <title> in its <head>, so a first-occurrence
  // replace is unambiguous. Non-greedy so a malformed shell cannot swallow the
  // rest of the document. Function-form replacement so "$" sequences in the
  // title are inserted literally, matching the two slot injections above.
  let replaced = false;
  finalHtml = out.replace(/<title>[\s\S]*?<\/title>/, function () {
    replaced = true;
    return '<title>' + escapeHtmlText(rawTitle.trim()) + '</title>';
  });
  // Not fatal: a missing <title> costs the page its name, not its content. Warn
  // on stderr so stdout stays the output path and nothing downstream breaks.
  if (!replaced) {
    console.error('render-html.js: warning: no <title> found in ' + opts.shell +
                  '-shell.html; page keeps the shell default');
  }
}

// --- compute the output path ---
function pad(n) { return String(n).padStart(2, '0'); }
const d = new Date();
const ts = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' +
           pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());

// path.resolve handles both relative (against the cwd, i.e. the project root)
// and absolute --out-dir values. --out-dir is a trusted local argument; only
// --name needed sanitizing above.
const outDir = path.resolve(process.cwd(), opts.outDir);
fs.mkdirSync(outDir, { recursive: true });

let outPath;
if (opts.stable) {
  // Stable mode: identity-keyed filename, overwritten freely on every run.
  // The point is replacement (a re-plan refreshes plans/PLAN-issue-<n>.html in
  // place), so no timestamp and no -N guard. (issue #129)
  outPath = path.join(outDir, safeName + '.html');
} else {
  // Collision-proof: the common case is <name>-<ts>.html. A same-second re-run
  // gets -2, -3, ... so a fast double run never overwrites a prior artifact.
  outPath = path.join(outDir, safeName + '-' + ts + '.html');
  let n = 2;
  while (fs.existsSync(outPath)) {
    outPath = path.join(outDir, safeName + '-' + ts + '-' + n + '.html');
    n++;
  }
}

fs.writeFileSync(outPath, finalHtml, 'utf-8');
process.stdout.write(outPath + '\n'); // stdout = the path only; callers capture it
