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
//   Artifact index (issue #154; stamp and sync from the holistic pass) - three
//   extra modes that do not render anything:
//   node .claude/scripts/render-html.js --index-add --type <shell> --name <name> \
//                                       [--local <path>] --url <url>
//   node .claude/scripts/render-html.js --index-url --name <name>
//   node .claude/scripts/render-html.js --index-sync
//
//   --index-add   append one JSONL row {at, type, name, local, url} to
//                 artifacts/html/index.jsonl (the log of every artifact
//                 published to a hosted page). Timestamps itself, so callers
//                 never shell out to `date`. When --local names a file that
//                 exists, it also stamps that file (see "The hosted stamp"
//                 below); a missing file is a one-line stderr warning and the
//                 row is still appended. --local is optional, but when given it
//                 must name an .html (or .htm) mirror and resolve under the
//                 repo root, through any symlink, or the command fails before
//                 anything is written. --url must be an https:// URL with no
//                 whitespace, quotes, backslash, or angle brackets: it is
//                 written into an HTML comment, so nothing that could close
//                 the comment is admitted.
//   --index-url   print the most recently recorded URL for --name, or nothing at
//                 all when there is no record. Exit 0 either way, so an absent
//                 index reads as "no record" rather than an error.
//   --index-sync  regenerate every stamp from the index: newest row per local
//                 file wins, one stamp per file that still exists. Prints
//                 "index-sync: <n> stamped, <m> missing" on stdout, with
//                 ", <k> skipped" appended only when a row was refused (not an
//                 .html mirror, or resolving outside the repository), lists
//                 the missing and skipped paths on stderr, and exits 0 either
//                 way.
//
//   The hosted stamp. After a publish, line 1 of the local mirror is
//     <!-- hosted: <url> -->
//   and the file's own first line (the doctype) becomes line 2. The index row
//   is the record; the stamp is a derived copy of it, there so anyone opening
//   the local file finds its hosted page without opening the index. Mirrors
//   are never hand-edited: a URL changes by appending a row (--index-add), and
//   --index-sync catches every mirror up to the index. The stamp is one short
//   line so the <title> stays inside the first 8KB the hosted publisher scans.
//
//   --shell    which template under .claude/skills/shared/shells/ to use
//   --name     filename prefix, e.g. review-orchestrator, review-code, debate-gpt,
//              document, explore-<slug>, audit-html, PLAN-issue-<n>. The timestamp
//              is appended unless --stable is set.
//   --data     path to a JSON file. If omitted or "-", JSON is read from stdin.
//   --out-dir  output directory. Default: artifacts/html. Resolved against the
//              current working directory (relative or absolute both work) and
//              created if missing. Lets plan views land in plans/ instead.
//   --no-abs   strip the paths that identify this machine out of the payload
//              before rendering (issue #155 item 2): every absPath key goes, and
//              in ordinary text the repo root becomes a relative path and the
//              home directory becomes "~", both as a prefix (~/...) and as a
//              bare whole token (holistic review, R14); /tmp and /usr are left
//              alone. Five shells turn a finding's file reference into a
//              vscode://file/<absPath> editor link, so a rendered page carries
//              this machine's directory layout and account name. That is
//              harmless in a local file and is a disclosure once the page is
//              published, so the publish path passes this flag and the local
//              fallback does not. Each of the five shells treats a missing
//              absPath as "render this reference as plain text" rather than
//              building an editor link from the relative path, which would leak
//              nothing but be dead for every viewer. A file object that carried
//              only absPath gets a relPath derived from it first - repo-relative
//              under the main or working copy, "external file" elsewhere - so
//              the reference is not hidden (holistic review, R27). Images are
//              embedded as data: URIs BEFORE the strip runs, so a screenshot
//              under the home directory still embeds (holistic review, R1). See
//              "Viewing the Artifact" in .claude/rules/html-outputs.md.
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
  // index modes (issue #154; --index-sync from the holistic pass)
  indexAdd: false, indexUrl: false, indexSync: false, type: '', local: '', url: ''
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
  else if (a === '--index-sync') opts.indexSync = true; // boolean flag
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
//   Regenerate every mirror's line-1 stamp from the index (after a re-render
//   dropped one, a restored backup, or a row appended by hand):
//     node .claude/scripts/render-html.js --index-sync
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
const REPO_ROOT = mainRepoRoot();
const INDEX_PATH = path.resolve(REPO_ROOT, 'artifacts/html', 'index.jsonl');

// The working copy this command runs in. In the main copy it IS the repo root;
// in a worktree it is the worktree, whose own plans/ and artifacts/html/ hold
// the files a render there wrote. The index is shared (above), but the mirror
// is local to the copy that rendered it, so stamping must accept both roots:
// a worktree's artifact refused as "outside the repo" was the first thing the
// holistic-pass review caught in this design.
function workRoot() {
  try {
    const top = require('child_process')
      .execFileSync('git', ['rev-parse', '--show-toplevel'],
                    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim();
    return top ? path.resolve(top) : process.cwd();
  } catch (e) {
    return process.cwd();
  }
}
const WORK_ROOT = workRoot();

// ==========================================================================
// The hosted stamp (holistic pass, plan Step 3). The index row is the record;
// line 1 of the local mirror carries a DERIVED copy of its URL:
//     <!-- hosted: https://claude.ai/code/artifact/... -->
// so anyone opening the local file, or grepping the directory, finds the page
// it was published to without opening the index. Mirrors are never hand-
// edited: a URL changes by appending a row (--index-add), and --index-sync
// regenerates every stamp from the index. Markdown twins (PLAN-*.md) are not
// stamped: Claude reads those.
//
// One short line, always the FIRST line. The hosted publisher scans only the
// first 8KB of a file for its <title>, so a stamp anywhere else, or a long
// one, could push the title out of that window and rename the page.
// ==========================================================================
// Admits a trailing CR: a mirror re-saved with CRLF line endings keeps its
// stamp, and without this the next publish saw no stamp and added a second one
// (holistic-pass review, R15).
const STAMP_RE = /^<!-- hosted: \S+ -->\r?$/;

function hostedStamp(url) { return '<!-- hosted: ' + url + ' -->'; }

// The stamp is one line inside an HTML comment, so a URL carrying whitespace
// or a comment-closing sequence could split the line or close the comment
// early and inject markup into every mirror. The old denylist named "-->" and
// missed "--!>", which browsers also treat as closing a comment (holistic-pass
// review, R12), so this is an allowlist instead: https, then no whitespace, no
// angle brackets, no quotes, no backslash. No caller in this repo publishes
// over plain http, and the hosted pages the stamp exists for are https only,
// so http is not admitted.
const STAMPABLE_URL_RE = /^https:\/\/[^\s<>"'`\\]+$/;
function stampableUrl(url) {
  return typeof url === 'string' && STAMPABLE_URL_RE.test(url);
}

// A stamp is an HTML comment on line 1, so it only belongs in an HTML file: a
// markdown twin, a JSON payload, or a script with a shebang would be corrupted
// by it, and nothing stopped a --local or a hand-written row from naming one
// (holistic-pass review, R14, R18). --index-add refuses anything else before
// the row is written; --index-sync skips such a row with a note.
function htmlMirror(p) {
  const ext = path.extname(p).toLowerCase();
  return ext === '.html' || ext === '.htm';
}

// --index-sync rewrites whichever files the index names, so a --local must
// never be able to point it at a file elsewhere on the disk: anything that
// resolves outside the repository is refused, at --index-add time (a die,
// before the row is written) and at sync time (skipped with a note). "The
// repository" means the main copy OR the working copy this command runs in.
//
// An absolute --local is the path the render printed, but it is normalized
// rather than trusted as-is: an absolute row carrying ".." after the root
// prefix passed the old string-prefix test and stamped a file outside the
// repository (holistic-pass review, R11). Normalizing also makes two spellings
// of one file ("/a/./b.html" and "/a/b.html") one sync key. A relative path is
// resolved against the working copy that rendered it. At sync time a relative
// row is tried against the main root first and then this working copy, so a
// row written from a worktree still finds its file when synced from that
// worktree.
function resolveLocal(local) { return path.resolve(WORK_ROOT, local); }
function resolveForSync(local) {
  if (path.isAbsolute(local)) return path.resolve(local);
  const inMain = path.resolve(REPO_ROOT, local);
  if (REPO_ROOT === WORK_ROOT || fs.existsSync(inMain)) return inMain;
  return path.resolve(WORK_ROOT, local);
}

// Windows compares paths case-insensitively, and the cwd and git's canonical
// spelling of one directory can differ in case there, so a worktree publish
// died before the append (holistic-pass review, R16). The comparison folds
// case on win32 only; posix behavior is unchanged. The platform is a parameter
// so the suite can exercise the win32 branch from Linux, and
// RENDER_HTML_PLATFORM is the hook that feeds it; nothing else reads it.
const PLATFORM = process.env.RENDER_HTML_PLATFORM || process.platform;
function pathKey(p, platform) {
  return (platform || PLATFORM) === 'win32' ? p.toLowerCase() : p;
}

// A candidate that exists is resolved through the filesystem, and so is the
// root, before the prefix test: a symlink inside the repository pointing at a
// file outside it is judged by where it lands (holistic-pass review, R17),
// and realpath on BOTH sides keeps a root reached through a symlink (/tmp
// against /private/tmp on macOS) from false-negating. A candidate that does
// not exist has nothing to resolve and is checked on its normalized string
// form alone; stampFile cannot write a file that is not there anyway.
function realOrSelf(p) { try { return fs.realpathSync(p); } catch (e) { return p; } }
function underRoot(abs, root, platform) {
  let candidate = path.resolve(abs);
  let base = path.resolve(root);
  if (fs.existsSync(candidate)) { candidate = realOrSelf(candidate); base = realOrSelf(base); }
  candidate = pathKey(candidate, platform);
  base = pathKey(base, platform);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  return candidate.startsWith(prefix);
}
function underRepoRoot(abs) { return underRoot(abs, REPO_ROOT) || underRoot(abs, WORK_ROOT); }

// Put the stamp on line 1 of one file, replacing an existing stamp rather
// than adding a second, and leaving everything after it byte-identical.
// Returns true when the file carries the stamp, false when it could not be
// read (missing or unreadable) - the caller decides whether that is a warning
// (--index-add) or a count (--index-sync). A write failure is fatal: the file
// was there and readable a moment ago, so something is genuinely wrong.
function stampFile(abs, url) {
  let raw;
  try { raw = fs.readFileSync(abs, 'utf-8'); } catch (e) { return false; }
  // A UTF-8 BOM is dropped rather than carried along. Kept, it landed on line
  // 2 in front of the doctype, where a browser sees it as text before the
  // doctype (holistic-pass review, R19). Every shell declares its charset in
  // a <meta>, so the BOM was never doing anything. `raw` stays as read so the
  // no-change test below still writes when only the BOM went.
  const content = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  const nl = content.indexOf('\n');
  const first = nl === -1 ? content : content.slice(0, nl);
  // When line 1 is a stamp, the WHOLE line is replaced, a trailing CR from a
  // CRLF re-save included: the stamp is always written in its own LF form,
  // and everything from the first "\n" on is left byte-identical.
  const stamped = STAMP_RE.test(first)
    ? hostedStamp(url) + (nl === -1 ? '\n' : content.slice(nl))
    : hostedStamp(url) + '\n' + content;
  if (stamped === raw) return true; // already current: no write, no mtime churn
  try { fs.writeFileSync(abs, stamped, 'utf-8'); }
  catch (e) { die('could not write the hosted stamp to ' + abs + ': ' + e.message); }
  return true;
}

// Every parseable row of the index, in file order; [] when there is no index.
// A malformed line is skipped rather than fatal - a half-written line from an
// interrupted run must not break every later lookup or sync.
function readIndexRows() {
  if (!fs.existsSync(INDEX_PATH)) return [];
  const rows = [];
  for (const line of fs.readFileSync(INDEX_PATH, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch (e) { continue; }
    if (rec && typeof rec === 'object') rows.push(rec);
  }
  return rows;
}

const indexModes = [opts.indexAdd, opts.indexUrl, opts.indexSync].filter(Boolean).length;
if (indexModes > 1) die('--index-add, --index-url, and --index-sync are mutually exclusive');

// The index modes return early, before any render validation, so a command line
// that mixes them with render flags would silently win: exit 0, nothing rendered,
// and an index path printed on stdout - which callers feed straight to
// open-artifact.sh, opening a JSONL file in the browser instead of an artifact.
// Every caller here is a model composing a command from a prompt file, which is
// exactly where two documented invocations get merged into one, so fail loudly
// rather than half-succeeding. (issue #154 review, R11)
if (indexModes) {
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
  if (!stampableUrl(opts.url)) {
    die('--url must be an https:// URL with no whitespace, quotes, backslash, or angle brackets: ' + opts.url);
  }
  // --local stays optional (older callers omit it). When given, it is checked
  // BEFORE the row is written, so a bad path leaves the index untouched.
  let localAbs = '';
  if (opts.local) {
    if (!htmlMirror(opts.local)) die('--local must name an .html mirror, not ' + opts.local);
    localAbs = resolveLocal(opts.local);
    if (!underRepoRoot(localAbs)) {
      die('--local must resolve inside the repository (main copy ' + REPO_ROOT +
          (WORK_ROOT !== REPO_ROOT ? ' or this working copy ' + WORK_ROOT : '') + '); got ' + localAbs);
    }
  }
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
  // The row is the record and the stamp is derived from it, so the row goes in
  // first and a file that cannot be stamped costs the stamp, never the record.
  // Missing is ordinary, not an error: a worktree caller passing a relative
  // path names a file the main copy does not have, and a timestamped artifact
  // may already have been cleaned up. Warn on stderr; stdout stays the index
  // path so callers that capture it are unaffected.
  if (localAbs && !stampFile(localAbs, opts.url)) {
    process.stderr.write('index-add: local file not found, row recorded without a stamp: ' +
                         localAbs + '\n');
  }
  process.stdout.write(INDEX_PATH + '\n');
  process.exit(0);
}

if (opts.indexUrl) {
  if (!opts.name) die('--index-url requires --name');
  // Scan forward and keep the last match: the newest record for a name wins,
  // which is what makes a re-published stable artifact resolve to its current
  // page.
  let found = '';
  for (const rec of readIndexRows()) {
    if (rec.name === opts.name && typeof rec.url === 'string' && rec.url) found = rec.url;
  }
  if (found) process.stdout.write(found + '\n');
  process.exit(0);
}

if (opts.indexSync) {
  // One stamp per FILE, newest row for that file wins. For the identity-keyed
  // types (plan, docview) every row names the same mirror, so this is "newest
  // URL per name" - the rule --index-url applies - and a stamp can never
  // disagree with a lookup. For the timestamped types every run has its own
  // mirror AND its own page under a shared name ("document",
  // "review-orchestrator"), so keying by name would stamp each older mirror
  // with the newest run's URL. Keying by file is right for both, and it is
  // what --index-add already does one row at a time. Null-prototype map, so a
  // path can never read a value off Object.prototype. The key is the
  // normalized path, case-folded on win32 (holistic-pass review, R16); the
  // value keeps the row's own spelling for the stamp and the messages.
  const byFile = Object.create(null);
  for (const rec of readIndexRows()) {
    if (typeof rec.local === 'string' && rec.local && stampableUrl(rec.url)) {
      const abs = resolveForSync(rec.local);
      byFile[pathKey(abs)] = { abs: abs, url: rec.url };
    }
  }
  let stamped = 0, missing = 0, skipped = 0;
  for (const key of Object.keys(byFile)) {
    const abs = byFile[key].abs;
    if (!htmlMirror(abs)) {
      skipped++;
      process.stderr.write('index-sync: skipped, not an .html mirror: ' + abs + '\n');
    } else if (!underRepoRoot(abs)) {
      skipped++;
      process.stderr.write('index-sync: skipped, resolves outside the repository: ' + abs + '\n');
    } else if (stampFile(abs, byFile[key].url)) {
      stamped++;
    } else {
      missing++;
      process.stderr.write('index-sync: local file not found: ' + abs + '\n');
    }
  }
  // "<n> stamped, <m> missing" is the line the docs quote; the skip count is
  // appended only when there is one, so that line stays exact whenever
  // nothing was refused.
  process.stdout.write('index-sync: ' + stamped + ' stamped, ' + missing + ' missing' +
                       (skipped ? ', ' + skipped + ' skipped' : '') + '\n');
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
// treatment without any shell knowing these exist. Item 3 (images) runs before
// item 2 (the strip); the call site at the end of this section says why.
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
// The repo root and the home directory, computed once. Anything under them that
// appears as literal text in a payload string is rewritten; the repo prefix
// becomes a relative path and the home prefix becomes "~".
//
// These two prefixes are the scope on purpose: together they are what identifies
// the machine and its owner. A path elsewhere on the filesystem (/tmp, /usr) is
// left alone because it discloses nothing about this user - browse.js screenshot
// paths under /tmp are the common case, and their images are inlined as data
// URIs anyway. Say "removes the paths that identify this machine", never "removes
// every absolute path", wherever this flag is described.
const HOME_DIR = (function () {
  try { const h = require('os').homedir(); return h && h !== '/' ? h : ''; } catch (e) { return ''; }
})();

const ABS_PREFIXES = (function () {
  const out = [];
  try { const r = mainRepoRoot(); if (r && r !== '/') out.push([r + path.sep, '']); } catch (e) {}
  if (HOME_DIR) out.push([HOME_DIR + path.sep, '~' + path.sep]);
  // Longest first, so the repo root (usually inside home) wins over the home prefix.
  return out.sort(function (a, b) { return b[0].length - a[0].length; });
})();

// Both prefix pairs end in a separator, so a BARE home path with nothing after
// it - a shell prompt, "HOME=/home/user", "$HOME is /home/user" - slid through
// and leaked the account name (holistic review, R14). This second pass turns
// the bare form into "~", and only as a whole token: when the next character
// continues the same path segment (/home/user2, /home/user-old, /home/user.bak
// are other directories) the match is refused, while a sentence-ending period
// is part of no path and does not block it. It runs AFTER the prefix pairs,
// longest-first order intact, so anything under home is already ~/... by the
// time it looks; and it names only the home directory, so /tmp and /usr stay
// untouched as promised above.
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const BARE_HOME_RE = HOME_DIR
  ? new RegExp(escapeRegExp(HOME_DIR) + '(?![A-Za-z0-9_-]|\\.[A-Za-z0-9_-])', 'g')
  : null;

function scrubAbsInString(str) {
  let out = str;
  for (const [prefix, replacement] of ABS_PREFIXES) {
    if (out.indexOf(prefix) !== -1) out = out.split(prefix).join(replacement);
  }
  if (BARE_HOME_RE && out.indexOf(HOME_DIR) !== -1) out = out.replace(BARE_HOME_RE, '~');
  return out;
}

// A file object that carried only absPath (no relPath) lost its whole reference
// here: the key was deleted, the object shrank to {line}, and every shell's
// `relPath || absPath` guard then hid it entirely (holistic review, R27). So
// before the key goes, a missing relPath is derived from it: the path made
// relative to whichever repository root contains it - the main copy or this
// working copy, longest first so a worktree nested inside the main copy strips
// its own root - or the literal "external file" when it is under neither. That
// text carries no path at all on purpose: a bare basename would read like a
// repo-relative reference and point at nothing. path.resolve first, so a ".."
// after the root prefix cannot pass as inside it; pathKey folds case on win32
// the way the containment checks above do.
const REL_ROOTS = [REPO_ROOT, WORK_ROOT]
  .filter(function (r, i, all) { return r && r !== '/' && all.indexOf(r) === i; })
  .sort(function (a, b) { return b.length - a.length; });

function relPathFromAbs(abs) {
  const candidate = path.resolve(abs);
  for (const root of REL_ROOTS) {
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if (pathKey(candidate).startsWith(pathKey(prefix))) return candidate.slice(prefix.length);
  }
  return 'external file';
}

// Deleting the absPath KEY is what triggers each shell's plain-text branch, so
// that stays - provided relPath is there for the shell to fall back to, which
// relPathFromAbs above guarantees. But a key-name denylist alone cannot support
// what the --no-abs description in html-outputs.md promises: absolute paths
// also appear as ordinary TEXT inside prose fields, receipt commands, and <pre>
// evidence blocks, and those shipped untouched (issue #155 review, R6). The
// page is published to a private hosted page without an ask, so this function
// is the only thing standing between the page and this machine's paths - it
// has to be true.
function stripAbsPaths(node) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (typeof node[i] === 'string') node[i] = scrubAbsInString(node[i]);
      else stripAbsPaths(node[i]);
    }
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    if (key === 'absPath') {
      // A relPath the payload already carries wins; only a missing or blank
      // one is derived (holistic review, R27). Object.keys was snapshotted
      // above, so the derived value is not re-visited by the scrub - and it
      // needs no scrub, being repo-relative or a fixed label.
      if (typeof node.absPath === 'string' && node.absPath &&
          !(typeof node.relPath === 'string' && node.relPath.trim())) {
        node.relPath = relPathFromAbs(node.absPath);
      }
      delete node[key];
    } else if (typeof node[key] === 'string') {
      node[key] = scrubAbsInString(node[key]);
    } else {
      stripAbsPaths(node[key]);
    }
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
  // Anchor the swap to the src attribute. A plain string replace hits the FIRST
  // occurrence anywhere in the tag, so a duplicate path in an earlier attribute
  // would take the data URI and leave src pointing at the local file.
  const uri = 'data:' + mime + ';base64,' + buf.toString('base64');
  const q = quote || '"';
  return tag.replace(/(\ssrc=)(?:(["']).*?\2|[^\s>]+)/i, function (m, lead) {
    return lead + q + uri + q;
  });
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

// Attributes are consumed as (quoted-value | non-'>') so a ">" INSIDE a quoted
// value (alt="cart > checkout") no longer ends the tag early, and src accepts an
// unquoted value. Both shapes previously fell through with no data URI, no note,
// and no stderr line - the silent breakage this feature exists to remove
// (issue #155 review, R20).
const IMG_RE = /<img\b(?:"[^"]*"|'[^']*'|[^>])*?\ssrc=(?:(["'])(.*?)\1|([^\s>]+))(?:"[^"]*"|'[^']*'|[^>])*>/gi;

function embedInString(str) {
  if (str.indexOf('<img') === -1) return str;
  const out = str.replace(IMG_RE, function (tag, quote, quoted, bare) {
    return embedOneImage(tag, quote || '', quoted !== undefined ? quoted : bare);
  });
  // A tag the regex still cannot parse must not fail silently: say so once.
  if (out.indexOf('<img') !== -1 && !/<img\b[^>]*src=(?:["']?)data:/i.test(out)) {
    IMG_RE.lastIndex = 0;
    if (!IMG_RE.test(out)) process.stderr.write('note: an <img> tag could not be parsed for embedding\n');
    IMG_RE.lastIndex = 0;
  }
  return out;
}

// --- item 4: the review finding contract (issue #161) ---
//
// Three prompt-side attempts to bound review length have all lost: a ~800-word
// budget inlined into nine skills, and a "one line" spec for the `what` field,
// are both ignored by the measured output (2,359 words per page, 61% of `what`
// fields over 20 words). A cap a model is asked to respect is not a cap. These
// run here, in code, where the count is mechanical.
//
// Two rules, and the second is the one with teeth:
//   1. Per-field caps are COUNTED and reported to stderr. They are not
//      annotated onto the page: a page carrying "[24 words, cap 18]" next to
//      inflated prose is still a page of inflated prose.
//   2. The PAGE budget is enforced by DEMOTION. Findings are ranked, and the
//      lowest-ranked are demoted to one-line rows until the page fits. Nothing
//      is ever truncated and nothing is ever dropped: a demoted finding still
//      renders, as its first sentence alone, and the markdown on disk carries
//      every finding in full regardless.
// So verbosity is paid for in visibility rather than in a footnote: an inflated
// finding pushes other findings off the open page, which is a cost the author
// of the payload can see in the stderr line the very next run.
const REVIEW_CAPS = {
  what: 18, context: 22, fix: 20,   // per-finding prose, in words
  pageWords: 700,                    // total open prose on the page
  openFindings: 9,                   // hard ceiling regardless of word count
  receiptLines: 6, receiptCols: 160  // the attached machine output
};

// Labels from the retired four-field template. A payload still carrying them
// was authored against a contract that no longer exists, so rendering it would
// silently ship the old format. They are refused - but the RENDER is not, because
// aborting would leave a 21-finding run with no artifact at all. The fields are
// dropped, the render continues, and the refusal is named on stderr.
const RETIRED_FIELD_LABELS = /^\s*(why it matters|example|suggested fix)\s*:?\s*$/i;

const SEV_ORDER = { block: 0, warn: 1, suggest: 2 };
const reviewNotes = [];

function proseWords(str) {
  if (typeof str !== 'string') return 0;
  return str.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
}

// Every finding on the OPEN page. The Audited out group is deliberately excluded:
// those are findings the audit killed, they are not part of the reader's budget,
// and they are not ranked against surviving work.
function openFindings(data) {
  const out = [];
  const groups = Array.isArray(data.groups) ? data.groups : [];
  groups.forEach(function (g) {
    if (g && typeof g.label === 'string' && /^audited out$/i.test(g.label.trim())) return;
    (Array.isArray(g && g.findings) ? g.findings : []).forEach(function (f) { if (f) out.push(f); });
  });
  if (Array.isArray(data.findings)) data.findings.forEach(function (f) { if (f) out.push(f); });
  return out;
}

// Rank by LOCUS, not by the severity label. severity-anchors.md states that a
// self-assigned severity is unreliable in both directions and that paging
// deliberately ignores it; ranking the page by it would repeat that mistake.
// `locus: "user"` marks a finding only the human can answer (a fact they hold,
// a reversal of intent, a file that always asks). Severity breaks ties, and the
// payload's own order breaks those - so a payload that sets no locus at all
// degrades to exactly today's behavior rather than to something surprising.
function rankFindings(findings) {
  return findings
    .map(function (f, i) { return { f: f, i: i }; })
    .sort(function (a, b) {
      const al = a.f.locus === 'user' ? 0 : 1, bl = b.f.locus === 'user' ? 0 : 1;
      if (al !== bl) return al - bl;
      const as = SEV_ORDER[a.f.severity] === undefined ? 9 : SEV_ORDER[a.f.severity];
      const bs = SEV_ORDER[b.f.severity] === undefined ? 9 : SEV_ORDER[b.f.severity];
      if (as !== bs) return as - bs;
      return a.i - b.i;
    })
    .map(function (x) { return x.f; });
}

// --- the receipts folder (issue #162: R1, and the wiring the v6.3.0 review found missing) ---
//
// The renderer attaches only output it read off disk, but "off disk" alone
// guaranteed nothing: the first real run of v6.3.0 filled six receipts from
// files typed by hand, and the page could not tell them from real ones. So the
// file has to come from where the tier-1 runner saves each check's output as
// it runs - reports/receipts/ under the working copy, the folder M2 in
// hitl-loop.md names - and it has to be a plain file of sane size. Anything
// else is dropped with a note naming the file. The guarantee is process-level:
// the runner writes there at check time, and nothing here can prove a file was
// not typed. It is not cryptographic, and the note is what makes a refused
// file visible instead of silent.
const RECEIPTS_DIR = path.join('reports', 'receipts');
const RECEIPT_MAX_BYTES = 64 * 1024;

// Returns null when the file may be read, else one short reason. The folder is
// judged through realpath on both sides (underRoot), so a symlink inside it
// that lands outside is refused for where it lands. Either root counts, the
// main copy's or this working copy's, for the same reason the stamp accepts
// both: a worktree writes its receipts beside its own artifacts.
function receiptFileProblem(p) {
  const abs = path.resolve(WORK_ROOT, p);
  const roots = [path.join(REPO_ROOT, RECEIPTS_DIR), path.join(WORK_ROOT, RECEIPTS_DIR)];
  if (!roots.some(function (r) { return underRoot(abs, r); })) return 'outside ' + RECEIPTS_DIR + path.sep;
  let st;
  try { st = fs.statSync(abs); } catch (e) { return 'unreadable'; }
  if (!st.isFile()) return 'not a regular file';
  if (st.size > RECEIPT_MAX_BYTES) return 'larger than ' + (RECEIPT_MAX_BYTES / 1024) + ' KB';
  return null;
}

// Pull the check's real output in from the file the tier-1 runner wrote.
//
// This is the whole point of the slot. Every other byte of the payload was typed
// by a model, so a pasted stdout is indistinguishable from an invented one - and
// a fabricated evidence block is worse than a vague paragraph, because it looks
// authoritative. Reading the bytes here makes the claim true: the renderer, not
// the model, put those characters on the page. Mirrors how images are embedded.
//
// A missing, unreadable, or refused file degrades to no receipt. It never fails
// the render: the evidence is an attachment, and a run that loses one is still
// a valid report.
function loadReceipt(f) {
  const r = f.receipt;
  if (!r || typeof r !== 'object') return;

  // A finding carried forward from the previous page arrives in rendered form:
  // its stdout is what the run that produced it read off disk, and there is no
  // file to re-read. The flag is renderer-set (the payload's copy is stripped
  // before this runs), so it cannot be used to smuggle inline text past the
  // guard below.
  if (f.carried) { delete r.stdoutFile; return; }

  // Inline `stdout` with no file behind it is model-typed text wearing machine
  // output's clothes, which is the one thing this slot exists to prevent. It is
  // dropped rather than rendered: a fabricated receipt is strictly worse than no
  // receipt, because the monospace block is exactly what makes a reader stop
  // doubting. Only bytes THIS RUN read off disk survive to the page.
  const hasFile = typeof r.stdoutFile === 'string' && r.stdoutFile;
  if (!hasFile && r.stdout !== undefined) {
    reviewNotes.push('receipt for ' + (f.id || '?') + ' supplied stdout inline with no ' +
                     'stdoutFile; dropped (only output the renderer read off disk is shown)');
    delete r.stdout;
  }

  if (hasFile) {
    const problem = receiptFileProblem(r.stdoutFile);
    let raw = null;
    if (!problem) {
      try { raw = fs.readFileSync(path.resolve(WORK_ROOT, r.stdoutFile), 'utf-8'); } catch (e) { raw = null; }
    }
    if (problem && problem !== 'unreadable') {
      reviewNotes.push('receipt for ' + (f.id || '?') + ' refused (' + problem + '), receipt dropped: ' + r.stdoutFile);
      delete f.receipt;
      return;
    }
    if (raw === null) {
      reviewNotes.push('receipt output unreadable, receipt dropped: ' + r.stdoutFile);
      delete f.receipt;
      return;
    }
    let lines = raw.replace(/\s+$/, '').split('\n');
    // The runner saves raw stdout, but a wrapped capture may already carry the
    // command line. Rendering ours on top of theirs echoes it twice, which is
    // exactly what an unedited terminal dump looks like. Drop the duplicate.
    if (lines.length && r.cmd && lines[0].replace(/^\$\s*/, '').trim() === String(r.cmd).trim()) {
      lines = lines.slice(1);
    }
    // The runner appends "exit N" as the file's last line. It is the machine's
    // own exit status, so it wins over whatever the payload typed, and it comes
    // off the list BEFORE the six-line cut: testing the last line after the
    // cut lost the status on exactly the long outputs where it mattered most
    // (v6.3.0 review, R6).
    const exitLine = lines.length ? /^\s*exit\s+(\d+)\s*$/i.exec(lines[lines.length - 1]) : null;
    if (exitLine) {
      lines.pop();
      r.exit = Number(exitLine[1]);
    }
    const kept = lines.slice(0, REVIEW_CAPS.receiptLines)
      .map(function (l) { return l.length > REVIEW_CAPS.receiptCols ? l.slice(0, REVIEW_CAPS.receiptCols - 1) + '…' : l; });
    if (lines.length > REVIEW_CAPS.receiptLines) {
      kept.push('... ' + (lines.length - REVIEW_CAPS.receiptLines) + ' more lines');
    }
    r.stdout = kept;
  }
  // The path is this machine's and never belongs on the page, published or not.
  delete r.stdoutFile;
  if (!Array.isArray(r.stdout) || !r.stdout.length) {
    // Nothing to show. An authored check with no captured output is not evidence.
    if (!r.cmd) delete f.receipt;
  }
}

// Drop any field row still wearing a retired label. Returns how many went.
function refuseRetiredLabels(f) {
  if (!Array.isArray(f.fields)) return 0;
  const kept = f.fields.filter(function (row) {
    return !(row && typeof row.label === 'string' && RETIRED_FIELD_LABELS.test(row.label));
  });
  const dropped = f.fields.length - kept.length;
  if (kept.length) f.fields = kept; else delete f.fields;
  return dropped;
}

// The Audited out group: findings the audit killed, rendered behind the page's
// one disclosure. They are not ranked and not budgeted, but they obey the same
// receipt and label rules as the open page - an invented receipt is likeliest
// on exactly the finding the audit already rejected (v6.3.0 review, R7).
function auditedFindings(data) {
  const out = [];
  (Array.isArray(data.groups) ? data.groups : []).forEach(function (g) {
    if (!(g && typeof g.label === 'string' && /^audited out$/i.test(g.label.trim()))) return;
    (Array.isArray(g.findings) ? g.findings : []).forEach(function (f) { if (f) out.push(f); });
  });
  return out;
}

function applyReviewContract(data) {
  const findings = openFindings(data);
  let retired = 0;
  const over = [];

  // The receipt and label rules run over EVERY finding, killed ones included.
  auditedFindings(data).forEach(function (f) {
    loadReceipt(f);
    retired += refuseRetiredLabels(f);
  });

  findings.forEach(function (f) {
    loadReceipt(f);
    retired += refuseRetiredLabels(f);

    // Count the prose. Attachments are evidence, not prose, and never counted.
    const w = { what: proseWords(f.what), context: proseWords(f.context), fix: proseWords(f.fix) };
    f._words = w.what + w.context + w.fix;
    ['what', 'context', 'fix'].forEach(function (k) {
      if (w[k] > REVIEW_CAPS[k]) over.push((f.id || '?') + ' ' + k + ' ' + w[k] + '/' + REVIEW_CAPS[k]);
    });
  });

  if (retired) {
    reviewNotes.push('refused ' + retired + ' field row(s) using the retired four-field labels ' +
                     '(Why it matters / Example / Suggested fix); they were dropped, not rendered');
  }
  if (!findings.length) return;

  // Demote from the bottom of the ranking until the page fits.
  const ranked = rankFindings(findings);

  // Write the ranking back into the payload, or it changes nothing: the shell
  // renders groups[] in the order it receives them, so a ranking computed and
  // left in a local variable is exactly the "renders in payload order" bug this
  // is meant to fix. The specialist groups collapse into one ranked list -
  // grouping by specialist put a Suggest above eight Warns in a real artifact,
  // and each finding already carries its own [specialist] tag, so nothing is
  // lost. The Audited out group is preserved untouched, after the survivors.
  if (Array.isArray(data.groups)) {
    const audited = data.groups.filter(function (g) {
      return g && typeof g.label === 'string' && /^audited out$/i.test(g.label.trim());
    });
    data.groups = [{ label: '', findings: ranked }].concat(audited);
  } else if (Array.isArray(data.findings)) {
    data.findings = ranked;
  }

  // The budget is spent on Blocks first, in rank order, and only then on the
  // rest: a floor on demotion, not on order. Ranking by locus stands, so a
  // Block still renders below a user-locus Suggest; but when the page is full
  // it is the lowest-ranked non-Block that goes to a one-line row, and a Block
  // is demoted only once every open finding is a Block. Without this, nine
  // optional items could bury a blocker on a page whose job is surfacing it
  // (v6.3.0 review, R9).
  const isBlock = function (f) { return f.severity === 'block'; };
  const order = ranked.filter(isBlock).concat(ranked.filter(function (f) { return !isBlock(f); }));
  let spent = 0, open = 0, demoted = 0;
  order.forEach(function (f) {
    const fits = (spent + f._words) <= REVIEW_CAPS.pageWords && open < REVIEW_CAPS.openFindings;
    if (fits) { spent += f._words; open += 1; delete f.demoted; }
    else { f.demoted = true; demoted += 1; }
    delete f._words;
  });

  over.forEach(function (o) { reviewNotes.push('over cap: ' + o); });
  reviewNotes.push('open prose ' + spent + '/' + REVIEW_CAPS.pageWords + ' words, ' +
                   open + ' open, ' + demoted + ' demoted to one-line rows');
}

// Embed FIRST, then strip. The scrub rewrites the home-directory prefix to ~/,
// and a screenshot left under the home directory but outside the repo was
// rewritten before the embedder read it, so the publish-bound render alone
// showed "image unavailable" while the local render embedded it fine
// (holistic review, R1). A data: URI carries no path, so once the image is
// inline there is nothing left for the scrub to touch.
// --- item 5: the standing review page (issue #161) ---
//
// A new timestamped page every run is a backlog, and no per-page redesign
// touches a backlog: cut every page to 600 words and after forty cycles there
// are forty unread pages. Reading one changes nothing about the next, so
// reading is unpaid work with no terminus.
//
// So the review page is identity-keyed like a plan view: one page per repo, at
// one URL, replaced in place. What that buys is a page that can go EMPTY, and
// going empty means something.
//
// The other half is memory. Because the file at the stable path is the previous
// run's page, this run can read it and say what changed. A finding the reader
// already saw and left alone should not present itself as news.
// The severity phrase leads every sentence one, so it is stripped before the
// claim words are taken: otherwise the first two of eight words were always
// "should fix" (v6.3.0 review, R12). The line number is out of the key too,
// because a line moves whenever the file above it changes, and a moved line
// read as one finding resolved and a new one opened (R10). Path plus claim is
// the identity; the payload's own `key`, when it carries one, wins.
const SEVERITY_LEAD = /^\s*(?:blocks?|should fix|optional)\b[.:]?\s*/i;
function stableFindingKey(f) {
  if (f.key) return String(f.key);
  const loc = f.file ? (f.file.relPath || '') : '';
  const claim = String(f.what || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(SEVERITY_LEAD, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, '')
    .split(/\s+/).filter(Boolean).slice(0, 8).join('-');
  return loc + ':' + claim;
}

// Pull the payload back out of a page this script wrote earlier. Three states,
// because two of them used to collapse into one: no page at all is a first
// run, and says so; a page that exists but cannot be read (a hand-edited file,
// a page from an older version) is NOT a first run, and calling it one told
// the reader nothing here was new when in fact nothing could be compared
// (v6.3.0 review, R8).
function priorPayload(file) {
  if (!fs.existsSync(file)) return { state: 'none' };
  let html;
  try { html = fs.readFileSync(file, 'utf-8'); } catch (e) { return { state: 'unreadable' }; }
  const m = html.match(/<script[^>]*id="render-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { state: 'unreadable' };
  try { return { state: 'ok', data: JSON.parse(m[1]) }; } catch (e) { return { state: 'unreadable' }; }
}

// Which lenses a finding belongs to: its `specialist` ("code", "code, ux",
// "[code, ux]"), falling back to the group it sits in. Lowercased tokens.
function specialistsOf(f, groupLabel) {
  const raw = (typeof f.specialist === 'string' && f.specialist) || groupLabel || '';
  return raw.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
}
function openFindingsWithLabels(data) {
  const out = [];
  (Array.isArray(data.groups) ? data.groups : []).forEach(function (g) {
    if (g && typeof g.label === 'string' && /^audited out$/i.test(g.label.trim())) return;
    const label = g && typeof g.label === 'string' ? g.label : '';
    (Array.isArray(g && g.findings) ? g.findings : []).forEach(function (f) { if (f) out.push({ f: f, label: label }); });
  });
  if (Array.isArray(data.findings)) data.findings.forEach(function (f) { if (f) out.push({ f: f, label: '' }); });
  return out;
}

// Merge by lens (issue #162, R18). The standing page is the repository's open
// findings, and a direct single-lens run (/review-code) sees only its own
// lens. Replacing the page with that would report every other lens's open
// finding as resolved, and a focused run cannot pass the full set because it
// never saw it. So a payload names the lenses that ran in `lenses`, and every
// open finding on the previous page whose lenses are all outside that list is
// carried forward, marked, ranked and budgeted with the rest, and counted as
// still open. A payload with no `lenses` is a full run and replaces the whole
// page, which is what every run did before this key existed.
function carryForward(data, prior) {
  if (prior.state !== 'ok') return;
  if (!Array.isArray(data.lenses) || !data.lenses.length) return;
  const lenses = data.lenses.map(function (l) { return String(l).toLowerCase().trim(); }).filter(Boolean);
  const present = {};
  openFindings(data).forEach(function (f) { present[stableFindingKey(f)] = true; });

  const carried = [];
  openFindingsWithLabels(prior.data).forEach(function (item) {
    const specs = specialistsOf(item.f, item.label);
    // A finding no lens can be read from is carried rather than resolved: the
    // page never reports as done what it cannot attribute to a lens that ran.
    const ran = specs.some(function (sp) { return lenses.indexOf(sp) !== -1; });
    if (ran) return;
    const key = stableFindingKey(item.f);
    if (present[key]) return;
    const copy = JSON.parse(JSON.stringify(item.f));
    delete copy.isNew; delete copy.demoted; delete copy._key;
    copy.carried = true;
    present[key] = true;
    carried.push(copy);
  });
  if (!carried.length) return;
  if (Array.isArray(data.groups)) data.groups.push({ label: '', findings: carried });
  else if (Array.isArray(data.findings)) data.findings = data.findings.concat(carried);
  else data.groups = [{ label: '', findings: carried }];
  reviewNotes.push('carried ' + carried.length + ' open finding(s) forward from lenses this run did not check (' +
                   lenses.join(', ') + ' ran)');
}

function markWhatChanged(data, prior) {
  const findings = openFindings(data);
  findings.forEach(function (f) { f._key = stableFindingKey(f); });

  if (prior.state === 'none') {
    data.sinceLast = findings.length
      ? 'First review recorded for this repository.'
      : 'First review recorded for this repository. Nothing open.';
    return;
  }
  if (prior.state === 'unreadable') {
    data.sinceLast = findings.length
      ? 'The previous page could not be read, so nothing here is marked new.'
      : 'Nothing open. The previous page could not be read.';
    return;
  }
  const before = {};
  openFindings(prior.data).forEach(function (f) { before[stableFindingKey(f)] = true; });

  let fresh = 0, carried = 0;
  findings.forEach(function (f) {
    if (!before[f._key]) { f.isNew = true; fresh += 1; }
    else if (f.carried) { carried += 1; }
  });
  const still = findings.length - fresh;
  const gone = Object.keys(before).filter(function (k) {
    return !findings.some(function (f) { return f._key === k; });
  }).length;

  const stillClause = still + ' still open from last time' +
    (carried ? ' (' + carried + ' carried from ' + (carried === 1 ? 'a lens' : 'lenses') + ' this run did not check)' : '');
  const parts = [];
  if (fresh) parts.push(fresh + (fresh === 1 ? ' new finding' : ' new findings'));
  if (still) parts.push(stillClause);
  if (gone) parts.push(gone + ' resolved since');
  // A page whose findings are exactly the ones the reader already saw says so
  // first: a finding they left alone must not present itself as news, and a
  // moved line is the same finding (R10), so it lands here rather than as one
  // resolved and one new.
  if (!fresh && !gone && still) {
    data.sinceLast = 'Nothing has changed since you last opened this page: ' + stillClause + '.';
  } else {
    data.sinceLast = parts.length
      ? 'Since you last opened this page: ' + parts.join(', ') + '.'
      : 'Nothing has changed since you last opened this page.';
  }
  if (!findings.length) data.sinceLast = 'Nothing open. ' + (gone ? gone + ' resolved since you last looked.' : '');
}

// The review contract runs FIRST: it reads each receipt's output off disk, and
// the strip below would rewrite those paths out from under it.
if (opts.shell === 'review') {
  // Three flags are the renderer's to set and never the payload's. A payload
  // that arrives carrying them is stripped before anything reads them, or
  // `carried: true` beside an inline stdout would walk straight past the
  // receipt guard.
  openFindings(parsed).concat(auditedFindings(parsed)).forEach(function (f) {
    delete f.carried; delete f.isNew; delete f.demoted;
  });
  // In stable mode the output path is deterministic, so the page this run is
  // about to replace can be read before it is overwritten. That is the whole
  // memory mechanism: the previous page IS the record of what the reader last
  // saw. A timestamped run has no predecessor to compare against and simply
  // skips this, which is why the standing page and the memory are one change
  // rather than two.
  let prior = { state: 'none' };
  if (opts.stable) {
    prior = priorPayload(path.join(path.resolve(process.cwd(), opts.outDir), safeName + '.html'));
    carryForward(parsed, prior);
  }
  applyReviewContract(parsed);
  if (opts.stable) {
    markWhatChanged(parsed, prior);
    openFindings(parsed).forEach(function (f) { delete f._key; });
  }
}
// The debate page carries the same finding shape in its Recommended Actions,
// and the retired labels were refused only on the review shell (v6.3.0
// review, R23). Same rule, same note.
if (opts.shell === 'debate' && parsed.synthesis && Array.isArray(parsed.synthesis.actions)) {
  let retired = 0;
  parsed.synthesis.actions.forEach(function (a) { if (a && typeof a === 'object') retired += refuseRetiredLabels(a); });
  if (retired) {
    reviewNotes.push('refused ' + retired + ' field row(s) using the retired four-field labels ' +
                     '(Why it matters / Example / Suggested fix); they were dropped, not rendered');
  }
}
embedImages(parsed);
if (opts.noAbs) stripAbsPaths(parsed);

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
// Walks the shell's comment markers as a state machine and returns the first
// defect as { line, what }, or null when every comment opens once and closes
// once. Three defects, all with the same symptom: an opener while a comment is
// already open (HTML comments do not nest - the inner closer ends the OUTER
// comment), a closer while no comment is open (a stray "-->" typed into prose
// ends the header just the same), and a comment that never closes. The
// symptom is what matters, so all three are refused, not just the one that
// shipped (review of #159, R3).
function findCommentDefect(html) {
  const marker = /<!--|-->/g;
  let open = false, m;
  while ((m = marker.exec(html)) !== null) {
    const line = html.slice(0, m.index).split('\n').length;
    if (m[0] === '<!--') {
      if (open) return { line: line, what: 'a comment opener inside an open comment' };
      open = true;
    } else {
      if (!open) return { line: line, what: 'a comment closer with no comment open' };
      open = false;
    }
  }
  if (open) return { line: html.split('\n').length, what: 'a comment that never closes' };
  return null;
}
if (countOccurrences(shellHtml, '/*__TOKENS__*/') !== 1)
  die('shell must contain /*__TOKENS__*/ exactly once: ' + shellPath);
if (countOccurrences(shellHtml, '__RENDER_DATA__') !== 1)
  die('shell must contain __RENDER_DATA__ exactly once: ' + shellPath);
// A shell's header comment must open once and close once. Anything else ends
// the header early, and everything after that point renders as visible page
// text above the title with no other error signal anywhere - the render
// succeeds and prints a path (issue #159, v6.1.0 plan-shell regression).
// Refuse it here, naming the line.
const defect = findCommentDefect(shellHtml);
if (defect)
  die('shell has a malformed HTML comment - ' + defect.what + ' - which ends the ' +
      'header comment early and renders the rest as page text: ' +
      shellPath + ':' + defect.line);
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

// The contract accounting goes to STDERR, beside the path, never into it.
// stdout carries the path alone because callers capture it; stderr is where a
// human (and the session handing over the link) sees a verbosity regression on
// the run that caused it, rather than six weeks later in an audit nobody runs.
if (reviewNotes.length) {
  reviewNotes.forEach(function (n) { console.error('render-html.js: ' + n); });
}

process.stdout.write(outPath + '\n'); // stdout = the path only; callers capture it
