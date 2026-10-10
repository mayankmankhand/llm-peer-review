#!/usr/bin/env node

// generate-index.js - Scans the codebase and emits a JSON manifest to stdout.
// The /index command consumes this manifest to orchestrate parallel subagent
// analysis and synthesize CODEBASE_MAP.md. No LLM tokens spent here.
//
//   node generate-index.js              the scan: one JSON manifest
//   node generate-index.js --finalize   check CODEBASE_MAP.md.tmp, trim it to the
//                                       size cap, and move it into place: one
//                                       JSON result (issues #181, #210)

const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const cwd = process.cwd();

// Tunables
const CHUNK_TARGET_TOKENS = 250_000;
const MAX_CHUNKS = 5;
const CONFIRM_THRESHOLD_TOKENS = 500_000;

// Hard cap on per-file token estimate. Files over this are skipped from the
// subagent inputs to prevent a single huge file from blowing a chunk past
// Sonnet's context window. Generated clients, vendor bundles, and i18n
// blobs are the usual culprits.
const MAX_FILE_TOKENS = 50_000;

// Skip files with no semantic value for the map (binaries, lockfiles, minified).
// git ls-files already respects .gitignore so we only filter the residual.
const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp",
  ".pdf", ".zip", ".tar", ".gz", ".tgz", ".7z", ".rar",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp3", ".mp4", ".webm", ".mov", ".avi", ".wav",
  ".exe", ".dll", ".so", ".dylib", ".bin",
]);

const SKIP_FILENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "uv.lock",
  "composer.lock",
  "go.sum",
  "pubspec.lock",
]);

// Hard-deny secret-bearing patterns. These run before token estimation, so a
// committed .env or private key never reaches subagents even if its parent
// directory is otherwise scanned. Patterns are matched against the FULL path
// (relative to cwd) so dotenv files in subdirectories are also caught.
const SKIP_SECRET_PATTERNS = [
  /(^|\/)\.env(\.|$)/i,           // .env, .env.local, .env.production
  /(^|\/)\.env$/i,
  /(^|\/)id_rsa($|\.|_)/i,        // id_rsa, id_rsa.pub, id_rsa_work
  /(^|\/)id_ed25519($|\.|_)/i,
  /(^|\/)id_ecdsa($|\.|_)/i,
  /(^|\/)credentials?(\.|$)/i,    // credentials, credential.json, credentials.yaml
  /(^|\/)secrets?(\.|$)/i,
  /\.(pem|key|crt|cer|pfx|p12)$/i,
  /(^|\/)\.aws\//i,               // ~/.aws/credentials checked in by mistake
  /(^|\/)\.ssh\//i,
  /\.htpasswd$/i,
];

// Minified-file patterns - the extension-based check above does not catch
// `foo.min.js` because path.extname returns only the last segment.
const SKIP_MINIFIED_PATTERNS = [
  /\.min\.(js|css)$/i,
  /\.min\.(js|css)\.map$/i,
  /\.bundle\.(js|css)$/i,
];

// classify: return null if the file should be kept; otherwise return a short
// reason string so the manifest can report skip counts by category. Splitting
// the categories makes it easy to add a `--why-skipped <file>` mode later if
// users complain about a file being missing from the map.
function classifySkip(filePath) {
  const base = path.basename(filePath);
  if (SKIP_FILENAMES.has(base)) return "lockfile";
  if (SKIP_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return "binary";
  for (const pat of SKIP_SECRET_PATTERNS) if (pat.test(filePath)) return "secret";
  for (const pat of SKIP_MINIFIED_PATTERNS) if (pat.test(filePath)) return "minified";
  return null;
}

// Cheap token estimate: file bytes / 4. Accurate enough for chunking,
// no LLM call needed. Reading the file via stat avoids loading contents.
// For dense formats (minified, CJK) this underestimates - that is why we
// also skip minified files and cap per-file tokens at MAX_FILE_TOKENS.
function estimateTokens(absPath) {
  try {
    return Math.ceil(fs.statSync(absPath).size / 4);
  } catch {
    return 0;
  }
}

function emitError(code, message) {
  process.stdout.write(JSON.stringify({ error: code, message }) + "\n");
  process.exit(1);
}

// --finalize (issue #181). /index writes the synthesized map to
// CODEBASE_MAP.md.tmp and then makes this one call. The steps it replaces were
// prose that Claude turned into a shell compound (two command substitutions,
// grep, mv and rm), and default permission mode stops to ask about every part
// of that; this call runs under the scanner's own allowed-tools row. It checks
// the temp file the way /index step 5 always described, renames it over
// CODEBASE_MAP.md (a rename is atomic, so no reader sees a half-written map),
// removes the legacy INDEX.md as step 6 did, and prints one JSON object:
//
//   {"finalized":true,"map":"CODEBASE_MAP.md","bytes":<n>,"tokens":<n>,
//    "tokensBefore":<n>,"trimmed":[<labels>],"overCap":<bool>,
//    "minimal":<bool>,"replaced":<bool>,"indexRemoved":<bool>}        exit 0
//   {"finalized":false,"error":"<code>","reason":"<one sentence>"}    exit 1
//
// The size cap (issue #210). The map is read at the start of every session
// that uses it, so /index keeps it under about 10k tokens, measured the way
// the scan measures a file: bytes divided by four. When the temp file is over
// the cap, --finalize trims it here, in the fixed order the trim policy has
// always had (the Module Guide is the semantic core, so everything else goes
// first): the directory tree to depth 3, then to depth 2, then the Gotchas,
// Conventions and Navigation Guide sections. Each step runs only while the
// map is still over the cap, a step that cuts nothing is skipped and left out
// of the record, and the record is the `<!-- Trimmed: ... -->` line this
// script writes into the header block (replacing one the map already has) and
// the `trimmed` array in the JSON. `tokensBefore` is the temp file's size,
// `tokens` and `bytes` the written map's. A map still over the cap after every
// step is written anyway and flagged `overCap`: the one cut left is shortening
// the Module Guide's entries, which is a judgment /index keeps for itself and
// may make before running --finalize once more. A map under the cap is never
// rewritten, so it lands byte for byte.
//
// Any failure deletes the temp file and leaves CODEBASE_MAP.md and INDEX.md as
// they were.
const MAP_FILE = "CODEBASE_MAP.md";
const MAP_TMP_FILE = MAP_FILE + ".tmp";
const LEGACY_INDEX_FILE = "INDEX.md";
const MAP_MIN_BYTES = 200; // a map must be larger than this
const MAP_TOKEN_CAP = 10_000; // the trim policy's cap, at four bytes a token
const MAP_TITLE = "# Codebase Map";
const tokensOf = (bytes) => Math.ceil(bytes / 4);

// The trim steps, in order. Each takes the map's lines and returns
// { lines, changed }.
const TRIM_STEPS = [
  { label: "tree-to-depth-3", apply: (lines) => collapseTree(lines, 3) },
  { label: "tree-to-depth-2", apply: (lines) => collapseTree(lines, 2) },
  { label: "gotchas", apply: (lines) => dropSection(lines, "Gotchas") },
  { label: "conventions", apply: (lines) => dropSection(lines, "Conventions") },
  { label: "navigation-guide", apply: (lines) => dropSection(lines, "Navigation Guide") },
];

// The [start, end) line range of the "## <name>" section, heading included,
// up to the next "## " heading or the end of the file; null when the map has
// no such section. Fenced code is skipped on the way, so a heading-shaped
// line inside a code block is never a boundary.
function sectionBounds(lines, name) {
  let inFence = false;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (start === -1) {
      if (line.trimEnd() === "## " + name) start = i;
    } else if (/^## /.test(line)) {
      return [start, i];
    }
  }
  return start === -1 ? null : [start, lines.length];
}

// Remove a section whole. The blank line before its heading stays as the
// separator between its neighbours; for the last section of the file that
// blank goes too and the final empty element (the file's closing newline)
// is kept, so the map still ends with exactly one newline.
function dropSection(lines, name) {
  const bounds = sectionBounds(lines, name);
  if (bounds === null) return { lines, changed: false };
  let [start, end] = bounds;
  if (end === lines.length) {
    if (lines[lines.length - 1] === "") end = lines.length - 1;
    if (start > 0 && lines[start - 1] === "") start -= 1;
  }
  return { lines: lines.slice(0, start).concat(lines.slice(end)), changed: true };
}

// Collapse the Directory Tree to `depth` levels. The tree is the markdown
// list /index step 4 renders from the manifest, one level per two spaces of
// indentation; the unit is read from the list itself (its smallest non-zero
// indent), so a tree indented by four still collapses by level. Lines deeper
// than `depth` are dropped; everything else in the section is kept.
function collapseTree(lines, depth) {
  const bounds = sectionBounds(lines, "Directory Tree");
  if (bounds === null) return { lines, changed: false };
  const items = [];
  for (let i = bounds[0] + 1; i < bounds[1]; i++) {
    const m = /^( *)[-*+] /.exec(lines[i]);
    if (m) items.push({ at: i, indent: m[1].length });
  }
  let unit = 0;
  for (const it of items) if (it.indent > 0 && (unit === 0 || it.indent < unit)) unit = it.indent;
  if (unit === 0) unit = 2;
  const drop = new Set(items.filter((it) => Math.floor(it.indent / unit) + 1 > depth).map((it) => it.at));
  if (drop.size === 0) return { lines, changed: false };
  return { lines: lines.filter((_, i) => !drop.has(i)), changed: true };
}

// Write the Trimmed line into the header block, the run of comment lines
// above the title that --finalize has already checked begins with the
// Generated line. A Trimmed line already there (one the map's author wrote)
// is replaced, so the record is this script's and appears once.
function withTrimmedHeader(lines, labels) {
  const record = "<!-- Trimmed: " + labels.join(", ") + " -->";
  const titleAt = lines.findIndex((l) => l.trimEnd() === MAP_TITLE);
  const out = lines.slice();
  let lastComment = -1;
  for (let i = 0; i < titleAt; i++) {
    if (out[i].startsWith("<!-- Trimmed:")) { out[i] = record; return out; }
    if (out[i].startsWith("<!--")) lastComment = i;
  }
  out.splice(lastComment + 1, 0, record);
  return out;
}

function finalizeMap() {
  const tmpPath = path.join(cwd, MAP_TMP_FILE);
  const mapPath = path.join(cwd, MAP_FILE);

  function fail(code, reason) {
    // unlink removes a file or a symlink, never a folder; a temp file that is
    // already gone is the state a failure should leave anyway.
    try { fs.unlinkSync(tmpPath); } catch { /* nothing to remove */ }
    process.stdout.write(JSON.stringify({ finalized: false, error: code, reason }) + "\n");
    process.exit(1);
  }

  let stat;
  try {
    stat = fs.lstatSync(tmpPath);
  } catch {
    fail("no_temp_map", `${MAP_TMP_FILE} was not found in ${cwd}. Write the map there first.`);
  }
  // A symlink or a folder in its place is refused, never moved over the map.
  if (!stat.isFile()) fail("not_a_file", `${MAP_TMP_FILE} is not a regular file.`);

  let buf;
  try {
    buf = fs.readFileSync(tmpPath);
  } catch (e) {
    fail("unreadable", `${MAP_TMP_FILE} could not be read: ${e.message}`);
  }
  if (buf.length <= MAP_MIN_BYTES) {
    fail("too_small", `${MAP_TMP_FILE} is ${buf.length} bytes; a map must be over ${MAP_MIN_BYTES}.`);
  }
  const text = buf.toString("utf8");
  const lines = text.split(/\r?\n/);
  if (!lines[0].startsWith("<!-- Generated:")) {
    fail("no_generated_header", `The first line of ${MAP_TMP_FILE} is not the <!-- Generated: ... --> header.`);
  }
  const titleAt = lines.findIndex((l) => l.trimEnd() === MAP_TITLE);
  if (titleAt === -1) fail("no_title", `${MAP_TMP_FILE} has no "${MAP_TITLE}" heading.`);
  // The empty-repo minimal map (/index, "Empty repo") has no Module Guide,
  // because the scan kept no file to describe, and its header says so with a
  // "<!-- Files: 0, ..." line. Only the header above the title counts, so a map
  // that merely quotes such a line in its body still needs its Module Guide.
  const minimal = lines.slice(0, titleAt).some((l) => l.startsWith("<!-- Files: 0,"));
  if (!minimal && !lines.some((l) => l.startsWith("## Module Guide"))) {
    fail("no_module_guide", `${MAP_TMP_FILE} has no "## Module Guide" section.`);
  }

  // The size cap: trim in order while over it, then write the trimmed map
  // back to the temp file so the rename below stays the one atomic step. The
  // file's own line endings are kept (CRLF when it has any). Each measurement
  // includes the Trimmed line the map will carry, so a map the loop leaves
  // under the cap is under it as written.
  const tokensBefore = tokensOf(buf.length);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const trimmed = [];
  let current = lines;
  let bytes = buf.length;
  if (!minimal && tokensOf(bytes) > MAP_TOKEN_CAP) {
    for (const step of TRIM_STEPS) {
      if (tokensOf(bytes) <= MAP_TOKEN_CAP) break;
      const result = step.apply(current);
      if (!result.changed) continue;
      current = result.lines;
      trimmed.push(step.label);
      bytes = Buffer.byteLength(withTrimmedHeader(current, trimmed).join(eol));
    }
    if (trimmed.length > 0) {
      const out = withTrimmedHeader(current, trimmed).join(eol);
      bytes = Buffer.byteLength(out);
      try {
        fs.writeFileSync(tmpPath, out);
      } catch (e) {
        fail("trim_write_failed", `The trimmed map could not be written back to ${MAP_TMP_FILE}: ${e.message}`);
      }
    }
  }
  const overCap = tokensOf(bytes) > MAP_TOKEN_CAP;

  const replaced = fs.existsSync(mapPath);
  try {
    fs.renameSync(tmpPath, mapPath);
  } catch (e) {
    fail("rename_failed", `${MAP_TMP_FILE} could not be renamed over ${MAP_FILE}: ${e.message}`);
  }

  // The INDEX.md migration: the flat-tree INDEX.md that CODEBASE_MAP.md replaced
  // goes only after the new map is in place. The name must match exactly: on a
  // case-insensitive filesystem (macOS, Windows) a lookup of INDEX.md also finds
  // a project's own index.md, which is not the toolkit's to delete.
  let indexRemoved = false;
  const legacyPath = path.join(cwd, LEGACY_INDEX_FILE);
  try {
    if (fs.readdirSync(cwd).includes(LEGACY_INDEX_FILE) && fs.lstatSync(legacyPath).isFile()) {
      fs.unlinkSync(legacyPath);
      indexRemoved = true;
    }
  } catch (e) {
    process.stderr.write(`generate-index: ${LEGACY_INDEX_FILE} was not removed: ${e.message}\n`);
  }

  process.stdout.write(JSON.stringify({
    finalized: true,
    map: MAP_FILE,
    bytes,
    tokens: tokensOf(bytes),
    tokensBefore,
    trimmed,
    overCap,
    minimal,
    replaced,
    indexRemoved,
  }) + "\n");
  process.exit(0);
}

// Arguments: none for the scan, or --finalize alone. Anything else is refused
// rather than ignored, so a mistyped flag never prints a manifest in place of
// the result the caller is waiting for.
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--finalize") finalizeMap();
if (args.length > 0) {
  emitError("bad_arguments", `Unknown arguments: ${args.join(" ")}. Run with no arguments to scan, or with --finalize alone.`);
}

// Get all tracked files via git (respects .gitignore automatically). -z prints
// each name verbatim and ends it with NUL (issue #183): without it git C-quotes
// any name holding a non-ASCII byte ("docs/caf\303\251.md"), no file by that
// name exists, and the file was counted as missing and left out of the map.
let raw;
try {
  raw = execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" });
} catch {
  emitError("git_failed", "git ls-files failed - not a git repository?");
}

const allFiles = raw.split("\0").filter(Boolean);

// Capture HEAD commit for staleness tracking in the map header
let commit = "(no commits yet)";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
} catch {
  // Empty repos have no HEAD - keep the placeholder
}

// Capture dirty-worktree state. Map consumers warn (but do not block) when
// the map was generated against a tree that had uncommitted changes - the
// commit hash alone would lie about freshness.
let dirtyFileCount = 0;
let isDirty = false;
try {
  const status = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
  dirtyFileCount = status.split("\n").filter((l) => l.trim().length > 0).length;
  isDirty = dirtyFileCount > 0;
} catch {
  // Not a git repo (already errored above) or git missing - leave at defaults
}

// Build the file inventory with token estimates. Track skip counts by reason
// so users have a transparent picture of what was excluded.
const fileInventory = [];
const skipCounts = {
  binary: 0, lockfile: 0, secret: 0, minified: 0, oversized: 0, missing: 0,
};

for (const f of allFiles) {
  const reason = classifySkip(f);
  if (reason) {
    skipCounts[reason]++;
    continue;
  }
  const tokens = estimateTokens(path.join(cwd, f));
  // File listed by git but missing on disk (e.g., staged-then-deleted). Drop
  // it from the inventory so subagents are not asked to read a vanished file.
  if (tokens === 0 && !fs.existsSync(path.join(cwd, f))) {
    skipCounts.missing++;
    continue;
  }
  // Per-file size cap. A single oversized file (huge generated client,
  // vendored library, large i18n bundle) would otherwise dominate a chunk
  // and bust Sonnet's context window. Skip with reason so the user can see
  // why a particular file is not in the map.
  if (tokens > MAX_FILE_TOKENS) {
    skipCounts.oversized++;
    continue;
  }
  fileInventory.push({ path: f, tokens });
}

let totalTokens = 0;
for (const f of fileInventory) totalTokens += f.tokens;

// Build the directory tree from the kept inventory (skipped files are
// excluded from the tree too - it should reflect what subagents actually saw).
function createNode() {
  return { dirs: {}, files: [] };
}

const root = createNode();
for (const { path: fp } of fileInventory) {
  const parts = fp.split("/");
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!node.dirs[parts[i]]) node.dirs[parts[i]] = createNode();
    node = node.dirs[parts[i]];
  }
  node.files.push(parts[parts.length - 1]);
}

const treeLines = [];
function render(node, indent) {
  const prefix = " ".repeat(indent);
  const dirNames = Object.keys(node.dirs).sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" })
  );
  for (const dir of dirNames) {
    treeLines.push(`${prefix}- ${dir}/`);
    render(node.dirs[dir], indent + 2);
  }
  const sortedFiles = node.files.slice().sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" })
  );
  for (const file of sortedFiles) {
    treeLines.push(`${prefix}- ${file}`);
  }
}
render(root, 0);

// Greedy bin-packing into chunks <= CHUNK_TARGET_TOKENS, at most MAX_CHUNKS.
// Sort largest-first, assign each file to the chunk with the lowest current
// total that still has room. If all chunks are full and we are at MAX_CHUNKS,
// overflow into the smallest - the per-chunk-overflow flag below warns
// callers when this happens.
const sorted = [...fileInventory].sort((a, b) => b.tokens - a.tokens);
const chunks = [];

for (const f of sorted) {
  let target = null;
  for (const c of chunks) {
    if (c.totalTokens + f.tokens <= CHUNK_TARGET_TOKENS) {
      if (!target || c.totalTokens < target.totalTokens) target = c;
    }
  }
  if (!target) {
    if (chunks.length < MAX_CHUNKS) {
      target = { id: chunks.length, files: [], totalTokens: 0 };
      chunks.push(target);
    } else {
      target = chunks.reduce((a, b) => (a.totalTokens <= b.totalTokens ? a : b));
    }
  }
  target.files.push(f);
  target.totalTokens += f.tokens;
}

// Per-chunk overflow detection. The project-total `needsConfirm` flag does
// not catch the case where most chunks are small but one is oversized
// (because MAX_CHUNKS was hit). Set the overflow flag - the /index command
// uses it to widen the cost-confirm prompt to any overflow case, not just
// projects over the project-total threshold. The ids of the oversized chunks
// go out too (overflowChunkIds), so /index reads which chunks not to
// auto-retry instead of comparing each chunk's total with the target itself
// (#226, M16).
const overflowChunks = chunks.filter((c) => c.totalTokens > CHUNK_TARGET_TOKENS);
const anyChunkOverflows = overflowChunks.length > 0;
const largestChunkTokens = chunks.reduce((m, c) => Math.max(m, c.totalTokens), 0);

// Build the UTC timestamp
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const timestamp = [
  now.getUTCFullYear(),
  "-", pad(now.getUTCMonth() + 1),
  "-", pad(now.getUTCDate()),
  " ", pad(now.getUTCHours()),
  ":", pad(now.getUTCMinutes()),
  " UTC",
].join("");

const totalSkipped = Object.values(skipCounts).reduce((a, b) => a + b, 0);

const manifest = {
  timestamp,
  commit,
  isDirty,
  dirtyFileCount,
  totalFiles: fileInventory.length,
  skippedFiles: totalSkipped,
  skipCounts,
  totalTokens,
  largestChunkTokens,
  chunkTargetTokens: CHUNK_TARGET_TOKENS,
  maxFileTokens: MAX_FILE_TOKENS,
  maxChunks: MAX_CHUNKS,
  confirmThresholdTokens: CONFIRM_THRESHOLD_TOKENS,
  // needsConfirm is true if EITHER the project total exceeds the threshold,
  // OR any single chunk exceeds the per-chunk target. Both cases mean the
  // generation might run into context-window limits or cost more than the
  // user expects, so the /index command prompts before proceeding.
  needsConfirm: totalTokens > CONFIRM_THRESHOLD_TOKENS || anyChunkOverflows,
  anyChunkOverflows,
  // Empty when no chunk is over the target.
  overflowChunkIds: overflowChunks.map((c) => c.id),
  directoryTree: treeLines,
  chunks,
};

process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
