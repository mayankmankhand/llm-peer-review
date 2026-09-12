#!/usr/bin/env node

// session-init.js - Aggregates everything a cycle command (/explore, /create-plan,
// /pair-debug, /execute) reads at session start into ONE JSON object on stdout, so
// the command makes a single call instead of 4-5 sequential file/git roundtrips
// (CODEBASE_MAP.md staleness checks, LESSONS.md, plans/ listing, worktree detection).
//
// Contract (mirrors generate-index.js):
//   - stdout = exactly one JSON object (the data). Nothing else is ever written there.
//   - stderr = human-readable diagnostics only, and only when something is off
//     (LESSONS: "Diagnostic output to stderr when stdout is captured by another LLM").
//   - Strictly READ-ONLY: never writes a file, never mutates git state.
//   - Fail-soft: exits 0 even when optional inputs (map, lessons, plans) are absent.
//     A missing piece is reported as exists:false / empty, not an error, so callers
//     degrade gracefully. The only hard requirement is a working git checkout.
//   - Zero dependencies: only Node built-ins (child_process, fs, path).

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const cwd = process.cwd();

// Run a git command, returning trimmed stdout or null on any failure. git's own
// stderr is discarded (stdio ignore) so a benign failure (e.g. shallow clone,
// no commits yet) never leaks onto our stdout or the user's terminal.
function git(args) {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

// Read a repo-relative file, returning its contents or null if it does not exist
// or cannot be read. Never throws.
function readFileSafe(relPath) {
  try {
    return fs.readFileSync(path.join(cwd, relPath), "utf8");
  } catch {
    return null;
  }
}

// --- Worktree state -------------------------------------------------------
// A worktree is detected when the per-worktree git dir differs from the shared
// common dir - the same check the commands do today with two rev-parse calls.
const gitDir = git("rev-parse --git-dir");
const commonDir = git("rev-parse --git-common-dir");
const worktree = {
  isWorktree: gitDir !== null && commonDir !== null && gitDir !== commonDir,
  gitDir,
  commonDir,
  branch: git("rev-parse --abbrev-ref HEAD"),
};

// --- Codebase map summary + freshness ------------------------------------
// The full map body (often ~18KB) is intentionally NOT embedded - the command
// reads it directly when it needs module-level detail. What the script provides
// is the freshness verdict (so the command skips its own rev-parse/rev-list
// roundtrips) plus the System Overview paragraph as a lightweight summary.
const MAP_FILE = "CODEBASE_MAP.md";
const mapRaw = readFileSafe(MAP_FILE);
const headCommit = git("rev-parse HEAD");
let map;
if (mapRaw === null) {
  map = { exists: false };
} else {
  // Header shape: <!-- Commit: <hash> (generated_while_dirty: N files) -->
  const commitMatch = mapRaw.match(/<!--\s*Commit:\s*([0-9a-f]+)/i);
  const mapCommit = commitMatch ? commitMatch[1] : null;
  const generatedWhileDirty = /generated_while_dirty/i.test(mapRaw);

  // commits-behind: how many commits HEAD has moved past the map's commit.
  // Null when either hash is missing or the range query fails (rebased history,
  // shallow clone) - the command treats null as "can't tell, don't warn".
  let commitsBehind = null;
  if (mapCommit && headCommit) {
    const countStr = git(`rev-list --count ${mapCommit}..HEAD`);
    if (countStr !== null && /^\d+$/.test(countStr)) {
      commitsBehind = parseInt(countStr, 10);
    }
  }

  // Lightweight summary: the System Overview paragraph, if the map has one.
  // Stop at the next heading of ANY level (## or ###) so a sub-heading nested
  // under System Overview cannot drag a whole section into the summary (R4).
  let overview = null;
  const ovMatch = mapRaw.match(/##\s*System Overview\s*\n+([\s\S]*?)(?:\n#{2,3}\s|\s*$)/i);
  if (ovMatch) overview = ovMatch[1].trim();

  map = {
    exists: true,
    path: MAP_FILE,
    commit: mapCommit,
    headCommit,
    commitsBehind,
    // Commands warn only at >=10 commits behind; single-commit drift is noise.
    stale: commitsBehind !== null && commitsBehind >= 10,
    generatedWhileDirty,
    overview,
  };
}

// --- Lessons index --------------------------------------------------------
// LESSONS.md is already the short index (one line per lesson); the full write-ups
// live in LESSONS-detail.md and are opened on demand by the command, not here.
// The index is small, so its full content is bundled to save the separate read.
const LESSONS_FILE = "LESSONS.md";
const lessonsRaw = readFileSafe(LESSONS_FILE);
const lessons =
  lessonsRaw === null
    ? { exists: false }
    : {
        exists: true,
        path: LESSONS_FILE,
        hasDetail: fs.existsSync(path.join(cwd, "LESSONS-detail.md")),
        content: lessonsRaw,
      };

// --- Plans ----------------------------------------------------------------
// List plans/PLAN-*.md newest-first by mtime, each with its progress percentage
// and a coarse status derived from the "Overall Progress" line the plan carries.
const PLANS_DIR = "plans";
let plans = [];
let newestPlan = null;
try {
  const withMeta = fs
    .readdirSync(path.join(cwd, PLANS_DIR))
    .filter((f) => /^PLAN-.*\.md$/.test(f))
    .map((name) => {
      const full = path.join(cwd, PLANS_DIR, name);
      let progress = null;
      let mtime = 0;
      try {
        mtime = fs.statSync(full).mtimeMs;
        const body = fs.readFileSync(full, "utf8");
        // Anchor to the start of a line (multiline flag) so a prose mention of
        // "Overall Progress" mid-sentence cannot win over the real header (R5).
        const pm = body.match(/^\s*\**Overall Progress:\**\s*`?(\d{1,3})%/im);
        if (pm) progress = parseInt(pm[1], 10);
      } catch {
        // Unreadable plan: keep it in the list with null progress rather than
        // dropping it, so the command still sees the file exists.
      }
      let status;
      if (progress === 100) status = "done";
      else if (progress === null || progress === 0) status = "todo";
      else status = "in-progress";
      return { name, progress, status, mtime };
    });

  withMeta.sort((a, b) => b.mtime - a.mtime);
  newestPlan = withMeta.length ? withMeta[0].name : null;
  // Drop the internal mtime from the payload - sorting was its only purpose.
  plans = withMeta.map(({ mtime, ...rest }) => rest);
} catch {
  // No plans/ directory yet - an empty list is the correct answer, not an error.
  plans = [];
  newestPlan = null;
}

// --- Emit -----------------------------------------------------------------
const payload = {
  generatedAt: new Date().toISOString(),
  cwd,
  worktree,
  map,
  lessons,
  plans,
  newestPlan,
};

process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
