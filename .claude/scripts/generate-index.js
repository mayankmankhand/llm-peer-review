#!/usr/bin/env node

// generate-index.js - Scans the codebase and emits a JSON manifest to stdout.
// The /index command consumes this manifest to orchestrate parallel subagent
// analysis and synthesize CODEBASE_MAP.md. No LLM tokens spent here.

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const cwd = process.cwd();

// Tunables (defaults documented in plans/PLAN-issue-97.md)
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

// Get all tracked files via git (respects .gitignore automatically)
let raw;
try {
  raw = execSync("git ls-files", { cwd, encoding: "utf8" });
} catch {
  emitError("git_failed", "git ls-files failed - not a git repository?");
}

const allFiles = raw.split("\n").map((f) => f.trim()).filter(Boolean);

// Capture HEAD commit for staleness tracking in the map header
let commit = "(no commits yet)";
try {
  commit = execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
} catch {
  // Empty repos have no HEAD - keep the placeholder
}

// Capture dirty-worktree state. Map consumers warn (but do not block) when
// the map was generated against a tree that had uncommitted changes - the
// commit hash alone would lie about freshness.
let dirtyFileCount = 0;
let isDirty = false;
try {
  const status = execSync("git status --porcelain", { cwd, encoding: "utf8" });
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
// projects over the project-total threshold.
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
  directoryTree: treeLines,
  chunks,
};

process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
