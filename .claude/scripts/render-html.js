#!/usr/bin/env node
'use strict';
//
// render-html.js - inject a compact findings JSON into a prebuilt HTML shell and
// write a self-contained, uniquely-timestamped artifact. (issues #120, #127)
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
// Usage:
//   node .claude/scripts/render-html.js --shell <review|debate|document|explore|audit> \
//                                       --name <basename> [--data <file>]
//   echo '<json>' | node .claude/scripts/render-html.js --shell review --name review-orchestrator
//
//   --shell  which template under .claude/skills/shared/shells/ to use
//   --name   filename prefix, e.g. review-orchestrator, review-code, debate-gpt,
//            document, explore-<slug>, audit-html. The timestamp is appended.
//   --data   path to a JSON file. If omitted or "-", JSON is read from stdin.
//
// Output: writes artifacts/html/<name>-<timestamp>.html (under the CURRENT working
//   directory, i.e. the project root) and prints that path to stdout. Only the
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
const opts = { shell: '', name: '', data: '' };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--shell') opts.shell = argv[++i] || '';
  else if (a === '--name') opts.name = argv[++i] || '';
  else if (a === '--data') opts.data = argv[++i] || '';
  else die('unknown argument: ' + a);
}

if (!opts.shell) die('missing --shell <review|debate|document|explore|audit>');
if (!opts.name) die('missing --name <basename>');

// Sanitize the name into a safe filename fragment - no slashes, no path traversal.
// Distinct names can collapse to the same prefix (e.g. "a/b" and "a-b" both
// become "a-b"); the -N timestamp guard below is the backstop against collisions.
const safeName = opts.name.replace(/[^A-Za-z0-9._-]/g, '-');
if (!safeName) die('--name produced an empty filename');

// Validate the shell against the allowlist before it is used to build a path.
const SHELLS = ['review', 'debate', 'document', 'explore', 'audit'];
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
if (shellHtml.indexOf('/*__TOKENS__*/') === -1) die('shell missing /*__TOKENS__*/ slot: ' + shellPath);
if (shellHtml.indexOf('__RENDER_DATA__') === -1) die('shell missing __RENDER_DATA__ slot: ' + shellPath);
const out = shellHtml
  .replace('/*__TOKENS__*/', function () { return tokensCss; })
  .replace('__RENDER_DATA__', function () { return safeJson; });

// --- compute the timestamped output path ---
function pad(n) { return String(n).padStart(2, '0'); }
const d = new Date();
const ts = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' +
           pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());

const outDir = path.join(process.cwd(), 'artifacts', 'html');
fs.mkdirSync(outDir, { recursive: true });

// Collision-proof: the common case is <name>-<ts>.html. A same-second re-run
// gets -2, -3, ... so a fast double run never overwrites a prior artifact.
let outPath = path.join(outDir, safeName + '-' + ts + '.html');
let n = 2;
while (fs.existsSync(outPath)) {
  outPath = path.join(outDir, safeName + '-' + ts + '-' + n + '.html');
  n++;
}

fs.writeFileSync(outPath, out, 'utf-8');
process.stdout.write(outPath + '\n'); // stdout = the path only; callers capture it
