#!/usr/bin/env node

// generate-index.js - Scans the codebase and emits a JSON manifest to stdout.
// The /index command consumes this manifest to orchestrate parallel subagent
// analysis and synthesize CODEBASE_MAP.md. No LLM tokens spent here.
//
//   node generate-index.js              the full scan: one JSON manifest
//   node generate-index.js --delta      the refresh scan: one JSON manifest of
//                                       only the map blocks whose files were
//                                       committed since the map's commit, or the
//                                       full one with the reason (issue #254)
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
// A refresh that needs this many chunks or more is a full rebuild instead: at
// that size the delta saves little, and the whole map is re-read fresh.
const FULL_AT_DELTA_CHUNKS = 4;

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

// --- The scan: shared pieces --------------------------------------------------------
// The full scan, the refresh scan (--delta, issue #254) and the merge read the
// same inventory: every tracked file, less the skip rules above.

// git in the project folder, its stdout as text. Throws when git exits
// non-zero; its stderr stays off the terminal, since each caller turns a
// failure into its own reason.
function git(args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  });
}

// Every tracked file with its token estimate, and the skip counts by reason so
// users have a transparent picture of what was excluded. git ls-files already
// respects .gitignore. -z prints each name verbatim and ends it with NUL (issue
// #183): without it git C-quotes any name holding a non-ASCII byte
// ("docs/caf\303\251.md"), no file by that name exists, and the file was
// counted as missing and left out of the map. Throws when git fails.
function inventory() {
  const allFiles = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const files = [];
  const skipCounts = { binary: 0, lockfile: 0, secret: 0, minified: 0, oversized: 0, missing: 0 };
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
    files.push({ path: f, tokens });
  }
  return { files, skipCounts };
}

// HEAD, for staleness tracking in the map header. Empty repos have no HEAD,
// so they keep the placeholder.
function headCommit() {
  try {
    return git(["rev-parse", "HEAD"]).trim();
  } catch {
    return "(no commits yet)";
  }
}

// Dirty-worktree state. Map consumers warn (but do not block) when the map was
// generated against a tree that had uncommitted changes - the commit hash
// alone would lie about freshness.
function dirtyState() {
  try {
    const status = git(["status", "--porcelain"]);
    const dirtyFileCount = status.split("\n").filter((l) => l.trim().length > 0).length;
    return { isDirty: dirtyFileCount > 0, dirtyFileCount };
  } catch {
    return { isDirty: false, dirtyFileCount: 0 };
  }
}

// The directory tree of the kept inventory, as indented list lines. Skipped
// files are left out of it too: it should reflect what subagents actually saw.
function directoryTree(files) {
  const createNode = () => ({ dirs: {}, files: [] });
  const root = createNode();
  for (const { path: fp } of files) {
    const parts = fp.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.dirs[parts[i]]) node.dirs[parts[i]] = createNode();
      node = node.dirs[parts[i]];
    }
    node.files.push(parts[parts.length - 1]);
  }
  const lines = [];
  (function render(node, indent) {
    const prefix = " ".repeat(indent);
    for (const dir of Object.keys(node.dirs).sort(byName)) {
      lines.push(`${prefix}- ${dir}/`);
      render(node.dirs[dir], indent + 2);
    }
    for (const file of node.files.slice().sort(byName)) lines.push(`${prefix}- ${file}`);
  })(root, 0);
  return lines;
}

// The one name order the scan uses: the directory tree's, and the place a new
// map block takes among the old ones.
function byName(a, b) {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

// Greedy bin-packing into chunks of at most CHUNK_TARGET_TOKENS, at most
// maxChunks of them. Units go largest first, each to the chunk with the lowest
// total that still has room. When every chunk is full and the cap is reached, a
// unit overflows into the smallest - the per-chunk overflow flags in the
// manifest warn callers when this happens. units are { tokens, item };
// returns [{ items, totalTokens }].
function packUnits(units, maxChunks) {
  const chunks = [];
  for (const u of [...units].sort((a, b) => b.tokens - a.tokens)) {
    let target = null;
    for (const c of chunks) {
      if (c.totalTokens + u.tokens <= CHUNK_TARGET_TOKENS) {
        if (!target || c.totalTokens < target.totalTokens) target = c;
      }
    }
    if (!target) {
      if (chunks.length < maxChunks) {
        target = { items: [], totalTokens: 0 };
        chunks.push(target);
      } else {
        target = chunks.reduce((a, b) => (a.totalTokens <= b.totalTokens ? a : b));
      }
    }
    target.items.push(u.item);
    target.totalTokens += u.tokens;
  }
  return chunks;
}

// The UTC timestamp for the map header.
function utcTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return [
    now.getUTCFullYear(),
    "-", pad(now.getUTCMonth() + 1),
    "-", pad(now.getUTCDate()),
    " ", pad(now.getUTCHours()),
    ":", pad(now.getUTCMinutes()),
    " UTC",
  ].join("");
}

// What every scan starts from: the inventory and the header facts.
function scanBase() {
  let inv;
  try {
    inv = inventory();
  } catch {
    emitError("git_failed", "git ls-files failed - not a git repository?");
  }
  return {
    files: inv.files,
    skipCounts: inv.skipCounts,
    totalTokens: inv.files.reduce((s, f) => s + f.tokens, 0),
    commit: headCommit(),
    ...dirtyState(),
    timestamp: utcTimestamp(),
  };
}

// The manifest both scans print. The project totals describe the whole
// project on either scan (the map header records them); `fields` carries the
// scan's own: mode, readTokens (what the subagents will read) and the delta
// or fallback fields. chunks stay last.
function manifest(base, fields, chunks) {
  // Per-chunk overflow detection. The project-total check does not catch the
  // case where most chunks are small but one is oversized (because MAX_CHUNKS
  // was hit). The ids of the oversized chunks go out too (overflowChunkIds),
  // so /index reads which chunks not to auto-retry instead of comparing each
  // chunk's total with the target itself (#226, M16).
  const overflowChunks = chunks.filter((c) => c.totalTokens > CHUNK_TARGET_TOKENS);
  const anyChunkOverflows = overflowChunks.length > 0;
  return {
    timestamp: base.timestamp,
    commit: base.commit,
    isDirty: base.isDirty,
    dirtyFileCount: base.dirtyFileCount,
    totalFiles: base.files.length,
    skippedFiles: Object.values(base.skipCounts).reduce((a, b) => a + b, 0),
    skipCounts: base.skipCounts,
    totalTokens: base.totalTokens,
    ...fields,
    largestChunkTokens: chunks.reduce((m, c) => Math.max(m, c.totalTokens), 0),
    chunkTargetTokens: CHUNK_TARGET_TOKENS,
    maxFileTokens: MAX_FILE_TOKENS,
    maxChunks: MAX_CHUNKS,
    confirmThresholdTokens: CONFIRM_THRESHOLD_TOKENS,
    // needsConfirm is true if EITHER what the subagents will read exceeds the
    // threshold, OR any single chunk exceeds the per-chunk target. Both cases
    // mean the generation might run into context-window limits or cost more
    // than the user expects, so the /index command prompts before proceeding.
    needsConfirm: fields.readTokens > CONFIRM_THRESHOLD_TOKENS || anyChunkOverflows,
    anyChunkOverflows,
    // Empty when no chunk is over the target.
    overflowChunkIds: overflowChunks.map((c) => c.id),
    directoryTree: directoryTree(base.files),
    chunks,
  };
}

function print(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

// The full scan: every kept file, packed into at most MAX_CHUNKS chunks of
// { id, files: [{path, tokens}], totalTokens }. `extra` carries a --delta
// fallback's fullReason (and deltaChunks, when the delta was counted).
function printFull(base, extra) {
  const chunks = packUnits(base.files.map((f) => ({ tokens: f.tokens, item: f })), MAX_CHUNKS)
    .map((c, id) => ({ id, files: c.items, totalTokens: c.totalTokens }));
  print(manifest(base, { mode: "full", readTokens: base.totalTokens, ...extra }, chunks));
}

// --- The map's parts (issue #254) -----------------------------------------------------
// The refresh reads a map as: the lines above its first "## " section (the
// header comments, the title and the lines under it), its "## " sections, and
// inside the Module Guide its "### " blocks, each with a **Files:** line.
// Fenced code is skipped, so a heading-shaped line in a code block is never a
// boundary. Either line ending is read; the text's own is kept for writing.

// The indices in [from, to) of the lines that start with `prefix`, outside
// fenced code.
function headingsAt(lines, prefix, from, to) {
  const at = [];
  let inFence = false;
  for (let i = from; i < to; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && lines[i].startsWith(prefix)) at.push(i);
  }
  return at;
}

// { eol, top, titleAt, sections: [{ name, lines }] }. The empty string a
// closing newline leaves at the end is not a line.
function parseMap(text) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  const titleAt = lines.findIndex((l) => l.trimEnd() === MAP_TITLE);
  const heads = headingsAt(lines, "## ", titleAt + 1, lines.length);
  return {
    eol,
    titleAt,
    top: lines.slice(0, heads.length > 0 ? heads[0] : lines.length),
    sections: heads.map((h, i) => ({
      name: lines[h].slice(3).trim(),
      lines: lines.slice(h, i + 1 < heads.length ? heads[i + 1] : lines.length),
    })),
  };
}

// The Module Guide's lead (its heading and any lines before the first block)
// and its blocks, { heading, lines, patterns }; null when the map has no
// Module Guide. patterns is null for a block without a **Files:** line.
function moduleGuide(sections) {
  const s = sections.find((x) => x.name === "Module Guide");
  if (!s) return null;
  const at = headingsAt(s.lines, "### ", 1, s.lines.length);
  return {
    lead: s.lines.slice(0, at.length > 0 ? at[0] : s.lines.length),
    blocks: at.map((h, i) => {
      const lines = s.lines.slice(h, i + 1 < at.length ? at[i + 1] : s.lines.length);
      return { heading: lines[0].slice(4).trim(), lines, patterns: filesPatterns(lines) };
    }),
  };
}

// A block's **Files:** patterns, comma-separated: a path, a pattern with `*`
// (any name inside one folder) or `**` (any depth), or a folder ending in `/`
// (everything under it). Backticks around a pattern and a leading ./ are
// dropped. null when the block has no Files line.
function filesPatterns(lines) {
  const line = lines.find((l) => l.startsWith("**Files:**"));
  if (line === undefined) return null;
  return line
    .slice("**Files:**".length)
    .split(",")
    .map((p) => p.trim().replace(/^`+|`+$/g, "").trim().replace(/^\.\//, ""))
    .filter(Boolean);
}

function patternRegex(pattern) {
  const p = pattern.endsWith("/") ? pattern + "**" : pattern;
  let re = "";
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "*" && p[i + 1] === "*") {
      // "**/" may stand for no folder at all, so src/**/a.js matches src/a.js.
      if (p[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (p[i] === "*") {
      re += "[^/]*";
    } else {
      re += p[i].replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp("^" + re + "$");
}

// A test of whether a path belongs to a block with these patterns.
function covers(patterns) {
  const res = patterns.map(patternRegex);
  return (p) => res.some((r) => r.test(p));
}

// A block's text as a subagent receives it: its lines without the blank ones
// that separate it from the next block.
function blockText(lines) {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end--;
  return lines.slice(0, end).join("\n");
}

function readMapText(file) {
  try {
    if (!fs.lstatSync(file).isFile()) return null;
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// The commit in a map's header lines, resolved to its full hash: the same
// pattern session-init.js reads. null when there is none or git does not know
// it.
function headerCommit(headerLines) {
  for (const l of headerLines) {
    const m = /<!--\s*Commit:\s*([0-9a-f]+)/i.exec(l);
    if (!m) continue;
    try {
      return git(["rev-parse", "--verify", "--quiet", m[1] + "^{commit}"]).trim();
    } catch {
      return null;
    }
  }
  return null;
}

function isAncestor(a, b) {
  try {
    git(["merge-base", "--is-ancestor", a, b]);
    return true;
  } catch {
    return false;
  }
}

// An existing map, ready for a refresh: { map, guide, since }, or { reason }
// naming why it is not. The checks run in the order /index Step 1 lists the
// reasons. The malformed test is the three byte tests session-init.js and
// --finalize run, in the same form, so all three agree on a map.
function deltaReady(text) {
  if (text === null) return { reason: "no_map" };
  const raw = text.split(/\r?\n/);
  if (
    Buffer.byteLength(text) <= MAP_MIN_BYTES ||
    !raw[0].startsWith("<!-- Generated:") ||
    !raw.some((l) => l.trimEnd() === MAP_TITLE)
  ) {
    return { reason: "malformed_map" };
  }
  const map = parseMap(text);
  const guide = moduleGuide(map.sections);
  if (!guide || guide.blocks.length === 0) return { reason: "no_blocks" };
  if (guide.blocks.some((b) => !b.patterns || b.patterns.length === 0)) return { reason: "no_files_lines" };
  const since = headerCommit(map.top.slice(0, map.titleAt));
  if (!since) return { reason: "unknown_commit" };
  return { map, guide, since };
}

// What was committed between the map's commit and `end`, sorted into the map's
// blocks. Committed changes only: a map built on a dirty tree already describes
// those edits, so diffing the working tree would re-send them on every refresh,
// and an edit not yet committed is picked up once it is. A rename counts as a
// delete plus an add. Changed files pass the scan's skip rules (they must be in
// `files`, the kept inventory); a deleted file passes the name rules.
//
// A block is touched when a changed file or a deleted one matches it, and is
// sent out with its text. It is dropped when none of its patterns match a kept
// file and at least one matched a file this diff deleted: its files went away.
// One that matches nothing and lost nothing was already dead when the map was
// written (a typo in its Files line): it is kept as it is and named, so a
// pattern typo never silently deletes a block. A changed file no block covers
// is a new file.
function computeDelta(guide, since, end, files) {
  const kept = new Map(files.map((f) => [f.path, f]));
  const out = git(["diff", "--name-status", "--no-renames", "-z", since, end]).split("\0");
  const changed = [];
  const deleted = [];
  for (let i = 0; i + 1 < out.length; i += 2) {
    const status = out[i];
    const p = out[i + 1];
    if (status === "D") {
      if (!classifySkip(p)) deleted.push(p);
    } else if (kept.has(p)) {
      changed.push(kept.get(p));
    }
  }
  const tests = guide.blocks.map((b) => covers(b.patterns));
  const touched = [];
  const dropped = [];
  const dead = [];
  guide.blocks.forEach((b, i) => {
    const has = tests[i];
    const lost = deleted.filter(has);
    if (!files.some((f) => has(f.path))) {
      (lost.length > 0 ? dropped : dead).push(b.heading);
      return;
    }
    const mine = changed.filter((f) => has(f.path));
    if (mine.length > 0 || lost.length > 0) {
      touched.push({ heading: b.heading, text: blockText(b.lines), files: mine, deleted: lost });
    }
  });
  const anyBlock = (p) => tests.some((has) => has(p));
  return {
    touched,
    dropped,
    dead,
    newFiles: changed.filter((f) => !anyBlock(f.path)),
    changedFiles: changed.length + deleted.length,
    keptBlocks: guide.blocks.length - touched.length - dropped.length,
    uncoveredFiles: files.filter((f) => !anyBlock(f.path)).length,
  };
}

// --delta (issue #254): the refresh scan. It reads CODEBASE_MAP.md and sends
// only what was committed since the commit in its header: each touched block
// (its text plus its changed files) and each new file is one unit, packed the
// way the full scan packs files but with no cap on the count. A map it cannot
// refresh, or a refresh that would need FULL_AT_DELTA_CHUNKS chunks or more,
// falls back to the full scan and says why in fullReason. The base commit
// comes from the map's own header rather than an argument, so the blocks and
// the commit always come from one file and a wrong commit can never skip
// changed files.
function printDelta() {
  const base = scanBase();
  const ready = deltaReady(readMapText(path.join(cwd, MAP_FILE)));
  if (ready.reason) return printFull(base, { fullReason: ready.reason });
  if (!isAncestor(ready.since, "HEAD")) return printFull(base, { fullReason: "unknown_commit" });

  const d = computeDelta(ready.guide, ready.since, "HEAD", base.files);
  const sum = (fs_) => fs_.reduce((s, f) => s + f.tokens, 0);
  const units = [
    ...d.touched.map((b) => ({ tokens: sum(b.files) + tokensOf(Buffer.byteLength(b.text)), item: { block: b } })),
    ...d.newFiles.map((f) => ({ tokens: f.tokens, item: { file: f } })),
  ];
  const packed = packUnits(units, Infinity);
  if (packed.length >= FULL_AT_DELTA_CHUNKS) {
    return printFull(base, { fullReason: "delta_chunks", deltaChunks: packed.length });
  }
  const chunks = packed.map((c, id) => ({
    id,
    blocks: c.items.filter((x) => x.block).map((x) => x.block),
    newFiles: c.items.filter((x) => x.file).map((x) => x.file),
    totalTokens: c.totalTokens,
  }));
  print(manifest(base, {
    mode: "delta",
    readTokens: units.reduce((s, u) => s + u.tokens, 0),
    since: ready.since,
    changedFiles: d.changedFiles,
    deltaChunks: packed.length,
    keptBlocks: d.keptBlocks,
    droppedBlocks: d.dropped,
    deadBlocks: d.dead,
    uncoveredFiles: d.uncoveredFiles,
  }, chunks));
}

// Arguments: none for the full scan, --delta for the refresh scan, or
// --finalize alone. Anything else is refused rather than ignored, so a
// mistyped flag never prints a manifest in place of the result the caller is
// waiting for.
const args = process.argv.slice(2);
const argsAre = (...want) => args.length === want.length && want.every((w, i) => args[i] === w);
if (argsAre()) printFull(scanBase(), {});
else if (argsAre("--delta")) printDelta();
else if (argsAre("--finalize")) finalizeMap();
else {
  emitError("bad_arguments", `Unknown arguments: ${args.join(" ")}. Run with no arguments to scan everything, with --delta to scan what was committed since the map's commit, or with --finalize alone.`);
}
