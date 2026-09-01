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
//                                       [--out-dir <dir>] [--stable] [--no-abs]
//   echo '<json>' | node .claude/scripts/render-html.js --shell review --name review-orchestrator
//
//   Artifact index (issue #154) - two extra modes that do not render anything:
//   node .claude/scripts/render-html.js --index-add --type <shell> --name <name> \
//                                       --local <path> --url <url>
//   node .claude/scripts/render-html.js --index-url --name <name>
//
//   --index-add  append one JSONL record to artifacts/html/index.jsonl (the log
//                of every artifact published to a hosted page). Timestamps
//                itself, so callers never shell out to `date`.
//   --index-url  print the most recently recorded URL for --name, or nothing at
//                all when there is no record. Exit 0 either way, so an absent
//                index reads as "no record" rather than an error.
//
//   --shell    which template under .claude/skills/shared/shells/ to use
//   --name     filename prefix, e.g. review-orchestrator, review-code, debate-gpt,
//              document, explore-<slug>, audit-html, PLAN-issue-<n>. The timestamp
//              is appended unless --stable is set.
//   --data     path to a JSON file. If omitted or "-", JSON is read from stdin.
//   --out-dir  output directory. Default: artifacts/html. Resolved against the
//              current working directory (relative or absolute both work) and
//              created if missing. Lets plan views land in plans/ instead.
//   --no-abs   strip every absolute local path from the payload before rendering
//              (issue #155 item 2). Five shells turn a finding's file reference
//              into a vscode://file/<absPath> editor link, so a rendered page
//              carries this machine's directory layout and account name. That is
//              harmless in a local file and is a disclosure once the page is
//              published, so the publish path passes this flag and the local
//              fallback does not. Each of the five shells treats a missing
//              absPath as "render this reference as plain text" rather than
//              building an editor link from the relative path, which would leak
//              nothing but be dead for every viewer. See "Viewing the Artifact"
//              in .claude/rules/html-outputs.md.
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
const opts = {
  shell: '', name: '', data: '', outDir: 'artifacts/html', stable: false,
  noAbs: false,
  // index modes (issue #154)
  indexAdd: false, indexUrl: false, type: '', local: '', url: ''
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--shell') opts.shell = argv[++i] || '';
  else if (a === '--name') opts.name = argv[++i] || '';
  else if (a === '--data') opts.data = argv[++i] || '';
  else if (a === '--out-dir') opts.outDir = argv[++i] || '';
  else if (a === '--stable') opts.stable = true; // boolean flag, takes no value
  else if (a === '--no-abs') opts.noAbs = true; // boolean flag, takes no value
  else if (a === '--index-add') opts.indexAdd = true; // boolean flag
  else if (a === '--index-url') opts.indexUrl = true; // boolean flag
  else if (a === '--type') opts.type = argv[++i] || '';
  else if (a === '--local') opts.local = argv[++i] || '';
  else if (a === '--url') opts.url = argv[++i] || '';
  else die('unknown argument: ' + a);
}

// ==========================================================================
// Index modes (issue #154). These run INSTEAD of a render and return early.
//
// Why the index lives in this script rather than a shell one-liner or a new
// file: an `echo ... >>` append plus a `grep`/`tail` lookup would each need
// their own permission entry, and a brand-new script would need a permission
// entry AND matching copy steps in both installers (setup.sh and setup.ps1),
// which is exactly the mirror-drift trap that has bitten this repo before.
// This script is already permitted and already propagated, so extending it
// costs nothing downstream. It also keeps structural data in deterministic
// code rather than in model-composed shell.
//
//   Append one record (after a successful publish):
//     node .claude/scripts/render-html.js --index-add --type review \
//          --name review-orchestrator --local <path> --url <url>
//
//   Look up the most recent URL recorded for a name (used by the identity-keyed
//   types, plan and docview, to update their existing page instead of making a
//   new one). Prints the URL, or NOTHING when there is no record yet, so a
//   caller can branch on empty output. Exit 0 either way; a missing index file
//   is "no record", not an error.
//     node .claude/scripts/render-html.js --index-url --name PLAN-issue-154
//
// The file is append-only JSONL at artifacts/html/index.jsonl - one self-
// contained JSON object per line. It is never read-then-rewritten, so two
// sessions publishing at once cannot clobber each other's history, and it never
// grows a re-read cost the way a markdown table would.
// ==========================================================================
// The index is keyed to the REPOSITORY, not the working directory (issue #155
// item 5). A worktree is a second working copy of the same repo, so resolving
// against process.cwd() gave each worktree its own empty index: the --index-url
// lookup found no record for a plan that had already been published, and the
// identity-keyed types created a duplicate hosted page instead of updating the
// one that existed. `git rev-parse --git-common-dir` names the SHARED .git for
// the whole repo (".git" in the main copy, an absolute path to it from inside a
// worktree), so its parent is the main working copy in both cases.
//
// Falling back to cwd is deliberate rather than fatal: this script must stay
// usable outside a repo, and an index in the wrong place is a far smaller
// failure than a render that refuses to run. child_process is core Node, so
// this keeps the zero-dependency promise above.
function mainRepoRoot() {
  try {
    const common = require('child_process')
      .execFileSync('git', ['rev-parse', '--git-common-dir'],
                    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim();
    if (!common) return process.cwd();
    return path.dirname(path.resolve(process.cwd(), common));
  } catch (e) {
    return process.cwd(); // not a repo, or no git on PATH
  }
}
const INDEX_PATH = path.resolve(mainRepoRoot(), 'artifacts/html', 'index.jsonl');

if (opts.indexAdd && opts.indexUrl) die('--index-add and --index-url are mutually exclusive');

// The index modes return early, before any render validation, so a command line
// that mixes them with render flags would silently win: exit 0, nothing rendered,
// and an index path printed on stdout - which callers feed straight to
// open-artifact.sh, opening a JSONL file in the browser instead of an artifact.
// Every caller here is a model composing a command from a prompt file, which is
// exactly where two documented invocations get merged into one, so fail loudly
// rather than half-succeeding. (issue #154 review, R11)
if (opts.indexAdd || opts.indexUrl) {
  const renderFlags = [];
  if (opts.shell) renderFlags.push('--shell');
  if (opts.data) renderFlags.push('--data');
  if (opts.stable) renderFlags.push('--stable');
  if (opts.noAbs) renderFlags.push('--no-abs');
  if (opts.outDir !== 'artifacts/html') renderFlags.push('--out-dir');
  if (renderFlags.length) {
    die('index modes take no render arguments (got ' + renderFlags.join(', ') +
        '); run the render and the index step as separate commands');
  }
}

if (opts.indexAdd) {
  if (!opts.name) die('--index-add requires --name');
  if (!opts.url) die('--index-add requires --url');
  // Timestamp is produced here so callers never have to shell out to `date`.
  const record = {
    at: new Date().toISOString(),
    type: opts.type || '',
    name: opts.name,
    local: opts.local || '',
    url: opts.url
  };
  // JSON.stringify handles quoting/escaping, so a name or path containing a
  // quote or backslash cannot corrupt the line.
  fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
  fs.appendFileSync(INDEX_PATH, JSON.stringify(record) + '\n', 'utf-8');
  process.stdout.write(INDEX_PATH + '\n');
  process.exit(0);
}

if (opts.indexUrl) {
  if (!opts.name) die('--index-url requires --name');
  let found = '';
  if (fs.existsSync(INDEX_PATH)) {
    const lines = fs.readFileSync(INDEX_PATH, 'utf-8').split('\n');
    // Scan forward and keep the last match: the newest record for a name wins,
    // which is what makes a re-published stable artifact resolve to its current
    // page. A malformed line is skipped rather than fatal - a half-written line
    // from an interrupted run must not break every later lookup.
    for (const line of lines) {
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch (e) { continue; }
      if (rec && rec.name === opts.name && typeof rec.url === 'string' && rec.url) {
        found = rec.url;
      }
    }
  }
  if (found) process.stdout.write(found + '\n');
  process.exit(0);
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

// ==========================================================================
// Payload transforms (issue #155 items 2 and 3). Both rewrite the parsed data
// in place, before it is serialized into the page, so every shell gets the same
// treatment without any shell knowing these exist.
// ==========================================================================

// --- item 2: strip absolute local paths when the page is destined to be published ---
//
// Five shells (review, document, explore, debate, audit) render a finding's file
// reference as <a href="vscode://file/<absPath>"><relPath></a>, and each one
// documents that the href falls back to relPath when absPath is absent. So the
// whole fix is to delete the field: the link degrades to plain relative text and
// nothing else in the page changes. Deleting the KEY (rather than blanking it)
// is what triggers each shell's `file.absPath || file.relPath` fallback.
//
// Recursive because the field is nested at different depths per shell - inside
// findings, inside change rows, inside audit candidates - and a top-level-only
// walk would silently miss most of them.
function stripAbsPaths(node) {
  if (Array.isArray(node)) { node.forEach(stripAbsPaths); return; }
  if (node === null || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    if (key === 'absPath') delete node[key];
    else stripAbsPaths(node[key]);
  }
}

// --- item 3: embed local images as data: URIs ---
//
// browse.js writes screenshots to /tmp and returns the filesystem path, which a
// review payload carries inside a trusted-HTML field as <img src="/tmp/...">.
// That renders locally (a file:// page can reach /tmp) and is always broken once
// the page is published, because a hosted page cannot read this machine's disk
// and the artifact CSP blocks off-origin images regardless. A data: URI is the
// only form that works in BOTH viewports, and it also makes the local file
// genuinely self-contained, which is what the shells claim to be.
//
// Budget: published artifacts cap at 16MB and base64 inflates by ~4/3. A single
// `responsive` action produces three full-page PNGs, so a naive embed can blow
// the cap on its own. Everything over budget is dropped with a VISIBLE note -
// the failure this replaces was a silently broken image, and swapping it for a
// silently missing one would be no improvement.
const EMBED_BUDGET_BYTES = 12 * 1024 * 1024; // encoded; leaves headroom for the page itself
let embedBudgetLeft = EMBED_BUDGET_BYTES;

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};

function humanSize(bytes) { return (bytes / (1024 * 1024)).toFixed(1) + 'MB'; }

// Replace one <img src="..."> whose src is a local file. Returns the tag to use.
function embedOneImage(tag, quote, src) {
  // Anything already inline or remote is left exactly as it is.
  if (/^(data:|https?:|file:)/i.test(src)) return tag;
  const ext = path.extname(src).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) return tag; // not an image type we can inline; leave it alone
  let buf;
  try {
    buf = fs.readFileSync(src);
  } catch (e) {
    // Missing or unreadable: never abort the render over one screenshot.
    process.stderr.write('note: image not readable, omitted: ' + src + '\n');
    return '<em class="img-omitted">image unavailable (' + path.basename(src) + ')</em>';
  }
  const encodedSize = Math.ceil(buf.length / 3) * 4;
  if (encodedSize > embedBudgetLeft) {
    process.stderr.write('note: image over embed budget, omitted: ' + src +
                         ' (' + humanSize(buf.length) + ')\n');
    return '<em class="img-omitted">image omitted (' + path.basename(src) +
           ', ' + humanSize(buf.length) + ' - over the embed budget)</em>';
  }
  embedBudgetLeft -= encodedSize;
  return tag.replace(quote + src + quote,
                     quote + 'data:' + mime + ';base64,' + buf.toString('base64') + quote);
}

// Walk every string in the payload looking for <img> tags. Strings are where
// these live: the shells take "trusted inline HTML" in field values, so an
// image arrives as markup inside a value, not as a structured path field.
function embedImages(node) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (typeof node[i] === 'string') node[i] = embedInString(node[i]);
      else embedImages(node[i]);
    }
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    if (typeof node[key] === 'string') node[key] = embedInString(node[key]);
    else embedImages(node[key]);
  }
}

function embedInString(str) {
  if (str.indexOf('<img') === -1) return str;
  return str.replace(/<img\b[^>]*?\ssrc=(["'])(.*?)\1[^>]*>/gi,
                     function (tag, quote, src) { return embedOneImage(tag, quote, src); });
}

if (opts.noAbs) stripAbsPaths(parsed);
embedImages(parsed);

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
