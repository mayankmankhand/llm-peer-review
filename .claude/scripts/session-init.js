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
//   - git always runs with an argument ARRAY, never a shell string, so nothing a
//     caller passes (a range typed into /review) can reach a shell.
//
// Modes:
//   node session-init.js                          the session-start object
//   node session-init.js --scope [<base>..<end>]  what a review covers (#182, below)
// Any other argument prints {"generatedAt", "cwd", "error"} and exits 0.
//
// Session-start object: generatedAt, cwd, worktree, map, lessons, plans, newestPlan.
// Each plans[] entry is { name, progress, status, startCommit }. startCommit (#182)
// is the sha on the plan's `**Start commit:** <sha>` line (exactly that spelling, at
// the start of a line, 7 to 40 hex characters, nothing after it), which /execute
// writes into the plan header once when it starts; null when the plan has none.
//
// --scope [<base>..<end>] (#182)
//   /execute commits every green step, so a review that looked only at uncommitted
//   work found nothing after a chained /execute. This mode names the commits a
//   review covers as well as the uncommitted work, in ONE JSON object:
//
//   {
//     "generatedAt": "2026-09-14T12:00:00.000Z",
//     "cwd": "/abs/folder/it/ran/in",
//     "root": "/abs/working/copy/root",        every path below is relative to it
//     "source": "argument" | "plan" | "unpushed" | "none",
//     "reason": null | "<code>",                set only when source is "none"
//     "message": null | "<one plain sentence>", set when source is "none", and when
//                                               the newest plan is shipped (it names
//                                               the range to pass; "plan" below)
//     "head": { "commit": "<sha>" | null, "branch": "main" | null,
//               "detached": false, "unborn": false },
//     "plan": null | {                          the newest plan, on a no-argument run
//       "name": "PLAN-issue-184.md",            (null when no plans/PLAN-*.md exists,
//                                               or when a range argument was given)
//       "startCommit": "<sha>" | null,          the full sha of its Start commit line
//       "commits": 12,                          commits after the start (when it resolves)
//       "unpushed": 3,                          source "plan" only: how many of them are
//                                               not on the remote (all, with no remote)
//       "reason": "plan-no-start" | "plan-start-missing" | "plan-start-not-ancestor"
//               | "plan-no-commits" | "plan-shipped"      only when the plan was NOT used
//     },
//     "range": null | {                         null when source is "none"
//       "base": "<sha>", "end": "<sha>",        the review covers base..end
//       "baseFrom": "argument" | "plan" | "upstream" | "default-branch",
//       "baseRef": "v7.1.0" | "PLAN-issue-184.md" | "refs/remotes/origin/main",
//                                               as typed, the plan file, or the ref used
//       "endRef": "HEAD",                                    as typed, or HEAD
//       "commitCount": 20,                      commits in base..end
//       "commits": [ { "sha": "<sha>", "subject": "Add x" } ],   newest 20 at most, newest first
//       "capped": true, "omitted": 5,           unpushed only: older commits left out
//       "fullBase": "<sha>",                    the base before the cap (equals base when
//                                               not capped); <fullBase>..HEAD includes them
//       "files": [ { "path": "docs/a b.md", "added": 3, "deleted": 1, "binary": false } ],
//       "added": 30, "deleted": 4
//     },
//     "uncommitted": {                          always reported, whatever the source
//       "staged":    { "files": [ ... ], "added": 60, "deleted": 0 },
//       "unstaged":  { "files": [ ... ], "added": 0, "deleted": 0 },
//       "untracked": { "files": [ ... ], "added": 80, "deleted": 0 }
//     },
//     "totals": { "lines": 174, "added": 170, "deleted": 4, "fileCount": 3, "binaryCount": 1 }
//   }
//
//   source "argument": base and end are the argument's two sides resolved to full
//     commit shas (an empty side means HEAD, as in git). base must be an ancestor of
//     end. The whole range is reviewed; only the commit list stops at 20.
//   source "plan" (no argument, #184): the newest plans/PLAN-*.md by modification
//     time carries a Start commit that exists, is an ancestor of HEAD, has commits
//     after it, and at least one of those commits is not on the remote (with no
//     remote, no upstream and no default branch, every commit counts as unpushed).
//     base is that start, end is HEAD, never capped: a review covers its own plan's
//     commits, however many. Only the newest plan is consulted; an older plan with a
//     start line is never used. When the plan does not apply, "plan.reason" says why
//     and the unpushed source runs; when every commit after the start is already on
//     the remote ("plan-shipped"), "message" names the range to pass.
//   source "unpushed" (no argument, when no plan applies): base is the merge-base of HEAD with its upstream
//     (@{u}, trusted only when it resolves under refs/remotes/), else with the
//     remote's default branch (the target of refs/remotes/origin/HEAD, else
//     origin/main, else origin/master; a lone remote not named origin stands in for
//     origin). end is HEAD. When more than 20 commits are unpushed, base moves to
//     HEAD~20 (when the real base is its ancestor), so the review covers the newest
//     20: capped is true and omitted counts the older ones left out.
//   source "none", reason is one of: no-remote, no-base, detached-head, unborn-head,
//     not-ancestor, bad-revision (a side names no commit), invalid-range (not
//     <base>..<end>). Uncommitted work and totals are still reported.
//   A file entry is { path, added, deleted, binary }, plus oldPath for a rename or
//     copy. A binary (and anything unreadable) has null line counts. Untracked line
//     counts come from reading the file: one per newline, plus an unterminated last
//     line, as git counts a new file; a NUL in the first 8000 bytes means binary.
//   totals.lines is added + deleted across range, staged, unstaged and untracked:
//     the number the review's size gate reads. fileCount and binaryCount count
//     distinct paths.
//   On a git failure: the same object with source "none", reason "error", and an
//     "error" field; exit 0.

const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const cwd = process.cwd();

// Run a git command, returning trimmed stdout or null on any failure. git's own
// stderr is discarded (stdio ignore) so a benign failure (e.g. shallow clone,
// no commits yet) never leaks onto our stdout or the user's terminal.
function git(args) {
  try {
    return execFileSync("git", args, {
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

function emit(payload) {
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

// ==========================================================================
// Default mode: the session-start object
// ==========================================================================

// `**Start commit:** <sha>`, written once into the plan header by /execute (#182).
// Exactly that spelling at the start of a line, one sha of 7 to 40 hex characters,
// and nothing after it but spaces (and a CR, for a plan saved with Windows line
// endings), so a sentence that merely mentions the field never matches.
const START_COMMIT_LINE = /^\*\*Start commit:\*\*[ \t]+([0-9a-fA-F]{7,40})[ \t]*\r?$/m;

function sessionStart() {
  // --- Worktree state -------------------------------------------------------
  // A worktree is detected when the per-worktree git dir differs from the shared
  // common dir - the same check the commands do today with two rev-parse calls.
  const gitDir = git(["rev-parse", "--git-dir"]);
  const commonDir = git(["rev-parse", "--git-common-dir"]);
  const worktree = {
    isWorktree: gitDir !== null && commonDir !== null && gitDir !== commonDir,
    gitDir,
    commonDir,
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
  };

  // --- Codebase map summary + freshness ------------------------------------
  // The full map body (often ~18KB) is intentionally NOT embedded - the command
  // reads it directly when it needs module-level detail. What the script provides
  // is the freshness verdict (so the command skips its own rev-parse/rev-list
  // roundtrips) plus the System Overview paragraph as a lightweight summary.
  const MAP_FILE = "CODEBASE_MAP.md";
  const mapRaw = readFileSafe(MAP_FILE);
  const headCommit = git(["rev-parse", "HEAD"]);
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
      const countStr = git(["rev-list", "--count", `${mapCommit}..HEAD`]);
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
  const { plans, newestPlan } = readPlans(cwd);

  return {
    generatedAt: new Date().toISOString(),
    cwd,
    worktree,
    map,
    lessons,
    plans,
    newestPlan,
  };
}

// List plans/PLAN-*.md newest-first by mtime, each with its progress percentage,
// a coarse status derived from the "Overall Progress" line the plan carries, and
// the commit /execute started it from (#182). Shared by the session-start object
// (reads under the launch folder, as it always has) and by --scope, which consults
// the newest plan first (#184) and reads under the git root, so a run from a
// subfolder finds the same plan (review of #184, R7).
function readPlans(base) {
  const PLANS_DIR = "plans";
  let plans = [];
  let newestPlan = null;
  try {
    const withMeta = fs
      .readdirSync(path.join(base, PLANS_DIR))
      .filter((f) => /^PLAN-.*\.md$/.test(f))
      .map((name) => {
        const full = path.join(base, PLANS_DIR, name);
        let progress = null;
        let startCommit = null;
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
          const body = fs.readFileSync(full, "utf8");
          // Anchor to the start of a line (multiline flag) so a prose mention of
          // "Overall Progress" mid-sentence cannot win over the real header (R5).
          const pm = body.match(/^\s*\**Overall Progress:\**\s*`?(\d{1,3})%/im);
          if (pm) progress = parseInt(pm[1], 10);
          const sc = body.match(START_COMMIT_LINE);
          if (sc) startCommit = sc[1].toLowerCase();
        } catch {
          // Unreadable plan: keep it in the list with null progress rather than
          // dropping it, so the command still sees the file exists.
        }
        let status;
        if (progress === 100) status = "done";
        else if (progress === null || progress === 0) status = "todo";
        else status = "in-progress";
        return { name, progress, status, startCommit, mtime };
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
  return { plans, newestPlan };
}

// ==========================================================================
// --scope mode: what a review covers (#182)
// ==========================================================================

// The newest commits a review names, and how many unpushed commits it takes on
// before it leaves the older ones out (the same 20 /document falls back to).
const SCOPE_COMMIT_CAP = 20;
// git's own binary test for a new file: a NUL among the first 8000 bytes.
const BINARY_SNIFF_BYTES = 8000;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

// Git for --scope: an argument ARRAY, run from the working copy's root, with raw
// bytes back, so a path with a space or a non-ASCII byte reaches fs exactly as git
// printed it. core.quotePath=false as pre-push-check.js sets (the -z forms below
// print paths verbatim anyway). Never throws: callers get ok:false and decide.
//
// Read-only in practice, not just in intent. Porcelain `git diff` rewrites
// .git/index when a file was touched without changing, even with
// GIT_OPTIONAL_LOCKS=0 (seen on git 2.43), and a held index lock makes a commit
// running at the same moment fail. So the diffs are plumbing (diff-tree,
// diff-index, diff-files), which never refresh the index, and git status runs with
// GIT_OPTIONAL_LOCKS=0, which is exactly what that variable exists to stop.
function gitScope(args, where, input) {
  const r = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: where,
    env: Object.assign({}, process.env, { GIT_OPTIONAL_LOCKS: "0" }),
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) return { ok: false, status: null, stdout: Buffer.alloc(0), stderr: String(r.error.message) };
  return { ok: r.status === 0, status: r.status, stdout: r.stdout, stderr: String(r.stderr || "") };
}

// stdout as text with its one trailing newline removed (a path may end in a space,
// so no trim).
function gitText(args, where) {
  const r = gitScope(args, where);
  return r.ok ? r.stdout.toString("utf8").replace(/\r?\n$/, "") : null;
}

// First line of git's complaint, for an error field.
function gitComplaint(r, what) {
  const first = String(r.stderr || "").split("\n").find((l) => l.trim()) || "exit " + r.status;
  return what + " failed: " + first.trim().slice(0, 200);
}

// Split -z output into its NUL-terminated fields, as Buffers.
function splitNul(buf) {
  const fields = [];
  let start = 0;
  while (start < buf.length) {
    const nul = buf.indexOf(0, start);
    if (nul === -1) {
      fields.push(buf.subarray(start));
      break;
    }
    fields.push(buf.subarray(start, nul));
    start = nul + 1;
  }
  return fields;
}

// --numstat -z: "<added>\t<deleted>\t<path>\0" per file, or for a rename or copy
// "<added>\t<deleted>\t\0<old path>\0<new path>\0". "-" counts mean a binary and
// become null. Splitting on NUL and tab bytes keeps a path byte-exact (neither byte
// occurs inside a UTF-8 character). Null when the output has an unexpected shape.
function parseNumstat(buf) {
  const fields = splitNul(buf);
  const files = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const t1 = f.indexOf(9);
    const t2 = t1 === -1 ? -1 : f.indexOf(9, t1 + 1);
    if (t2 === -1) return null;
    const added = f.subarray(0, t1).toString("latin1");
    const deleted = f.subarray(t1 + 1, t2).toString("latin1");
    let pathBuf = f.subarray(t2 + 1);
    let oldBuf = null;
    if (pathBuf.length === 0) {
      if (i + 2 >= fields.length) return null;
      oldBuf = fields[++i];
      pathBuf = fields[++i];
    }
    const binary = added === "-" && deleted === "-";
    if (!binary && !(/^\d+$/.test(added) && /^\d+$/.test(deleted))) return null;
    const entry = { path: pathBuf.toString("utf8") };
    if (oldBuf) entry.oldPath = oldBuf.toString("utf8");
    entry.added = binary ? null : Number(added);
    entry.deleted = binary ? null : Number(deleted);
    entry.binary = binary;
    // The path's exact bytes as a latin1 key, for matching against git status.
    // Not enumerable, so it never reaches the JSON.
    Object.defineProperty(entry, "key", { value: pathBuf.toString("latin1") });
    files.push(entry);
  }
  return files;
}

// git status --porcelain=v2 -z (git 2.11+), for two things the diffs cannot say:
// which paths really differ from the index (status refreshes its view in memory,
// so a file that was only touched drops out, where diff-files still lists a touched
// binary), and which files are untracked. Entry shapes, fields split on spaces with
// the path last:
//   1 XY sub mH mI mW hH hI <path>
//   2 XY sub mH mI mW hH hI Xscore <path>\0<original path>
//   u XY sub m1 m2 m3 mW h1 h2 h3 <path>
//   ? <path>
// Y (the second status letter) is "." when the work tree matches the index.
// Unstaged paths come back as latin1 keys (one character per byte, so two different
// names never collide); untracked paths as raw Buffers. Null on an unexpected shape.
function parseStatus(buf) {
  const FIELDS_BEFORE_PATH = { "1": 8, "2": 9, u: 10 };
  const fields = splitNul(buf);
  const unstaged = new Set();
  const untracked = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const type = String.fromCharCode(f[0]);
    if (type === "?") {
      untracked.push(f.subarray(2));
      continue;
    }
    const skip = FIELDS_BEFORE_PATH[type];
    if (skip === undefined) continue; // "!" ignored and "#" headers are never requested
    let at = 0;
    for (let s = 0; s < skip; s++) {
      at = f.indexOf(0x20, at) + 1;
      if (at === 0) return null;
    }
    if (type === "2") i++; // the original path is its own field
    if (f[3] !== 0x2e) unstaged.add(f.subarray(at).toString("latin1"));
  }
  return { unstaged, untracked };
}

// Lines an untracked file adds, counted as git counts a new file: one per newline,
// plus a last line with no newline. null line counts for a binary, and for anything
// that is not a regular file or a symlink, which is never read (a FIFO would block).
// A symlink is not followed: git records its target as one line. The file is read
// in chunks, so a large one costs time, not memory.
function untrackedEntry(rootBytes, relBuf) {
  const entry = { path: relBuf.toString("utf8"), added: null, deleted: null, binary: false };
  const abs = Buffer.concat([rootBytes, Buffer.from("/"), relBuf]);
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return entry;
  }
  if (st.isSymbolicLink()) return Object.assign(entry, { added: 1, deleted: 0 });
  if (!st.isFile()) return entry;
  let fd;
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0) | (fs.constants.O_NOFOLLOW || 0);
    fd = fs.openSync(abs, flags);
    if (!fs.fstatSync(fd).isFile()) return entry; // swapped since the lstat
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    let newlines = 0;
    let lastByte = -1;
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      const view = chunk.subarray(0, n);
      if (total < BINARY_SNIFF_BYTES && view.subarray(0, BINARY_SNIFF_BYTES - total).includes(0)) {
        entry.binary = true;
        return entry;
      }
      for (let at = view.indexOf(10); at !== -1; at = view.indexOf(10, at + 1)) newlines++;
      lastByte = view[n - 1];
      total += n;
    }
    entry.added = newlines + (total > 0 && lastByte !== 10 ? 1 : 0);
    entry.deleted = 0;
    return entry;
  } catch {
    return entry;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // nothing to do
      }
    }
  }
}

function sumLines(files) {
  let added = 0;
  let deleted = 0;
  for (const f of files) {
    if (typeof f.added === "number") added += f.added;
    if (typeof f.deleted === "number") deleted += f.deleted;
  }
  return { files, added, deleted };
}

// Staged, unstaged and untracked work, whatever the range turned out to be.
function uncommittedWork(root, rootBytes, head) {
  // Staged: the index against HEAD, or against the empty tree on a branch with no
  // commits yet (hashed, not written, so it is right for SHA-256 repositories too).
  let against = head.commit;
  if (!against) {
    const empty = gitScope(["hash-object", "-t", "tree", "--stdin"], root, "");
    if (!empty.ok) return { error: gitComplaint(empty, "git hash-object") };
    against = empty.stdout.toString("utf8").trim();
  }
  const stagedRun = gitScope(["diff-index", "--cached", "--numstat", "-z", "-M", against], root);
  if (!stagedRun.ok) return { error: gitComplaint(stagedRun, "git diff-index") };
  const staged = parseNumstat(stagedRun.stdout);

  const filesRun = gitScope(["diff-files", "--numstat", "-z"], root);
  if (!filesRun.ok) return { error: gitComplaint(filesRun, "git diff-files") };
  const worktreeFiles = parseNumstat(filesRun.stdout);

  const statusRun = gitScope(["status", "--porcelain=v2", "-z", "--untracked-files=all"], root);
  if (!statusRun.ok) return { error: gitComplaint(statusRun, "git status") };
  const status = parseStatus(statusRun.stdout);

  if (staged === null || worktreeFiles === null || status === null) {
    return { error: "git printed a file list in an unexpected shape" };
  }
  const unstaged = worktreeFiles.filter((f) => status.unstaged.has(f.key));
  const untracked = status.untracked.map((relBuf) => untrackedEntry(rootBytes, relBuf));
  return {
    staged: sumLines(staged),
    unstaged: sumLines(unstaged),
    untracked: sumLines(untracked),
  };
}

function none(reason, message) {
  return { none: { reason, message } };
}

// Resolve a revision to a full commit sha, or null. Tags peel to their commit.
function resolveCommit(rev, root) {
  const sha = gitText(["rev-parse", "--verify", "-q", rev + "^{commit}"], root);
  return sha !== null && SHA.test(sha) ? sha : null;
}

// true when `older` is an ancestor of (or the same commit as) `newer`: nothing is
// reachable from older that newer lacks. null when git cannot tell.
function isAncestor(older, newer, root) {
  const count = gitText(["rev-list", "--count", newer + ".." + older], root);
  return count === null ? null : count === "0";
}

function quoteRev(rev) {
  return JSON.stringify(rev.length > 80 ? rev.slice(0, 80) + "..." : rev);
}

// <base>..<end> as typed. Git's own range syntax: an empty side means HEAD. Refused:
// no "..", three dots (a symmetric difference, not a line of history), a second
// "..", and a side starting with "-", which git would read as an option.
function parseRangeArgument(given) {
  const at = given.indexOf("..");
  if (at === -1) return null;
  const base = given.slice(0, at);
  const end = given.slice(at + 2);
  if (end.startsWith(".") || end.includes("..")) return null;
  if (base.startsWith("-") || end.startsWith("-")) return null;
  return { base: base || "HEAD", end: end || "HEAD" };
}

function scopeFromArgument(given, head, root) {
  const typed = parseRangeArgument(given);
  if (!typed) {
    return none("invalid-range", "The range " + quoteRev(given) + " is not <base>..<end> with two dots, for example abc1234..HEAD.");
  }
  const base = resolveCommit(typed.base, root);
  const end = resolveCommit(typed.end, root);
  for (const [side, rev, sha] of [["base", typed.base, base], ["end", typed.end, end]]) {
    if (sha !== null) continue;
    if (head.unborn && (rev === "HEAD" || rev === "@")) {
      return none("unborn-head", "This branch has no commits yet, so " + quoteRev(given) + " has no commits to review.");
    }
    return none("bad-revision", "The range " + side + " " + quoteRev(rev) + " does not name a commit in this repository.");
  }
  const ancestor = isAncestor(base, end, root);
  if (ancestor === null) return { error: "git rev-list failed while checking the range" };
  if (!ancestor) {
    return none("not-ancestor", "The base " + quoteRev(typed.base) + " is not an ancestor of " + quoteRev(typed.end) + ", so the range is not one line of history. Pass a base that the end descends from.");
  }
  return { range: { source: "argument", base, end, fullBase: base, baseFrom: "argument", baseRef: typed.base, endRef: typed.end, capped: false } };
}

function scopeUnpushed(head, root) {
  if (head.unborn) return none("unborn-head", "This branch has no commits yet, so there are no commits to review.");
  if (head.detached) {
    return none("detached-head", "HEAD is detached (not on a branch), so there is no upstream to compare it with. Pass a range, for example <base>..HEAD.");
  }
  const base = unpushedBase(root);
  if (base.error || base.none) return base;
  return capUnpushed(head, root, base);
}

// Where "pushed" is measured from: the merge-base of HEAD with its upstream, else
// with the remote's default branch. Shared by the unpushed source and the plan
// source (#184). Returns { fullBase, baseFrom, baseRef }, { none }, or { error }.
function unpushedBase(root) {
  let fullBase = null;
  let baseFrom = null;
  let baseRef = null;

  // 1. The upstream, trusted only when it is a remote-tracking ref: a branch set to
  //    track a local branch would call commits "pushed" that never left the machine.
  const upstream = gitText(["rev-parse", "--symbolic-full-name", "@{u}"], root);
  if (upstream && upstream.startsWith("refs/remotes/")) {
    const mb = gitText(["merge-base", "HEAD", upstream], root);
    if (mb && SHA.test(mb)) {
      fullBase = mb;
      baseFrom = "upstream";
      baseRef = upstream;
    }
  }

  // 2. The remote's default branch. Full ref names throughout: a local branch
  //    literally named "origin/main" would otherwise win the name lookup.
  if (fullBase === null) {
    const listed = gitText(["remote"], root);
    if (listed === null) return { error: "git remote failed" };
    const remotes = listed.split("\n").filter(Boolean);
    if (remotes.length === 0) {
      return none("no-remote", "This repository has no remote, so no commit counts as unpushed. Pass a range, for example <base>..HEAD.");
    }
    const remote = remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0] : null;
    if (remote !== null) {
      const prefix = "refs/remotes/" + remote + "/";
      const candidates = [];
      const remoteHead = gitText(["symbolic-ref", "-q", prefix + "HEAD"], root);
      if (remoteHead && remoteHead.startsWith(prefix)) candidates.push(remoteHead);
      for (const name of ["main", "master"]) {
        if (!candidates.includes(prefix + name)) candidates.push(prefix + name);
      }
      for (const ref of candidates) {
        const mb = gitText(["merge-base", "HEAD", ref], root);
        if (mb && SHA.test(mb)) {
          fullBase = mb;
          baseFrom = "default-branch";
          baseRef = ref;
          break;
        }
      }
    }
    if (fullBase === null) {
      const tried = remote === null ? "several remotes, none named origin" : "tried " + remote + "/HEAD, " + remote + "/main and " + remote + "/master";
      return none("no-base", "No upstream branch and no default branch on the remote to compare with (" + tried + "). Pass a range, for example <base>..HEAD.");
    }
  }
  return { fullBase, baseFrom, baseRef };
}

// The cap. More than 20 unpushed commits: review the newest 20 along the branch's
// own line (first parents), starting at HEAD~20, but only when the real base is an
// ancestor of it, so the shorter range never reaches commits that are already
// pushed. Otherwise the whole range stays.
function capUnpushed(head, root, { fullBase, baseFrom, baseRef }) {
  const end = head.commit;
  const totalText = gitText(["rev-list", "--count", fullBase + ".." + end], root);
  if (totalText === null || !/^\d+$/.test(totalText)) return { error: "git rev-list failed while counting unpushed commits" };
  const total = Number(totalText);
  let base = fullBase;
  let capped = false;
  if (total > SCOPE_COMMIT_CAP) {
    const boundary = resolveCommit(end + "~" + SCOPE_COMMIT_CAP, root);
    if (boundary !== null && boundary !== fullBase && isAncestor(fullBase, boundary, root) === true) {
      base = boundary;
      capped = true;
    }
  }
  return { range: { source: "unpushed", base, end, fullBase, baseFrom, baseRef, endRef: "HEAD", capped, total } };
}

// The plan source (#184). A review typed with no range used to take the newest
// unpushed commits and never look at the plan, so on a pushed branch it found
// nothing and after a long cycle it dropped the oldest commits. The newest plan's
// start commit now comes first, while some commit after it is still unpushed; once
// every commit after the start is on the remote the plan counts as shipped and the
// unpushed fallback runs, with a message naming the plan's range to pass.
//
// Returns { plan, range } when the plan applies; { plan } carrying plan.reason when
// it does not (the caller falls through to the unpushed source); { plan: null }
// when there is no plan at all; { error } when git failed.
function scopePlan(head, root) {
  const { plans } = readPlans(root);
  if (plans.length === 0) return { plan: null };
  const newest = plans[0];
  const plan = { name: newest.name, startCommit: newest.startCommit };
  const skip = (reason) => ({ plan: Object.assign(plan, { reason }) });
  if (newest.startCommit === null) return skip("plan-no-start");
  const start = resolveCommit(newest.startCommit, root);
  if (start === null) return skip("plan-start-missing");
  plan.startCommit = start;
  if (head.unborn) return skip("plan-start-not-ancestor");
  if (start === head.commit) return skip("plan-no-commits");
  const ancestor = isAncestor(start, head.commit, root);
  if (ancestor === null) return { error: "git rev-list failed while checking the plan's start commit" };
  if (!ancestor) return skip("plan-start-not-ancestor");

  const totalText = gitText(["rev-list", "--count", start + ".." + head.commit], root);
  if (totalText === null || !/^\d+$/.test(totalText)) return { error: "git rev-list failed while counting the plan's commits" };
  plan.commits = Number(totalText);

  // How many commits after the start are not on the remote: reachable from HEAD but
  // from neither the start nor the pushed base. With no remote, no upstream and no
  // default branch, nothing is known to be pushed, so all of them count.
  const base = unpushedBase(root);
  if (base.error) return { error: base.error };
  let unpushed = plan.commits;
  if (!base.none) {
    const count = gitText(["rev-list", "--count", head.commit, "^" + start, "^" + base.fullBase], root);
    if (count === null || !/^\d+$/.test(count)) return { error: "git rev-list failed while counting the plan's unpushed commits" };
    unpushed = Number(count);
  }
  if (unpushed === 0) return skip("plan-shipped");
  plan.unpushed = unpushed;
  return {
    plan,
    range: { source: "plan", base: start, end: head.commit, fullBase: start, baseFrom: "plan", baseRef: newest.name, endRef: "HEAD", capped: false },
  };
}

// The one plain sentence a shipped plan leaves behind: the range to pass by hand.
function shippedMessage(plan) {
  const short = plan.startCommit.slice(0, 7);
  const n = plan.commits;
  return "The newest plan " + plan.name + " starts at " + short + " and all of its " + n + " commit" + (n === 1 ? "" : "s") +
    " are already on the remote; pass " + short + "..HEAD as the review's range to cover them.";
}

// The range's commits, files and line counts.
function describeRange(r, root) {
  const spec = r.base + ".." + r.end;
  const countText = gitText(["rev-list", "--count", spec], root);
  if (countText === null || !/^\d+$/.test(countText)) return { error: "git rev-list failed on " + spec };
  const commitCount = Number(countText);

  // --no-show-signature: log.showSignature=true would otherwise print gpg lines
  // into the output. A subject never holds a newline, so one line is one commit.
  const log = gitScope(
    ["log", "--no-color", "--no-show-signature", "--topo-order", "--format=%H%x09%s", "--max-count=" + SCOPE_COMMIT_CAP, spec],
    root
  );
  if (!log.ok) return { error: gitComplaint(log, "git log") };
  const commits = [];
  for (const line of log.stdout.toString("utf8").split("\n")) {
    if (line === "") continue;
    const tab = line.indexOf("\t");
    const sha = tab === -1 ? line : line.slice(0, tab);
    if (!SHA.test(sha)) return { error: "git log printed an unexpected line" };
    commits.push({ sha, subject: tab === -1 ? "" : line.slice(tab + 1) });
  }

  // The plumbing form of `git diff --numstat -z <base> <end>`, with rename
  // detection asked for explicitly so the counts do not depend on diff.renames.
  const diff = gitScope(["diff-tree", "-r", "--numstat", "-z", "-M", r.base, r.end], root);
  if (!diff.ok) return { error: gitComplaint(diff, "git diff-tree") };
  const files = parseNumstat(diff.stdout);
  if (files === null) return { error: "git diff-tree printed a file list in an unexpected shape" };
  const counted = sumLines(files);

  return {
    base: r.base,
    end: r.end,
    baseFrom: r.baseFrom,
    baseRef: r.baseRef,
    endRef: r.endRef,
    commitCount,
    commits,
    capped: r.capped,
    omitted: r.capped ? Math.max(0, r.total - commitCount) : 0,
    fullBase: r.fullBase,
    files: counted.files,
    added: counted.added,
    deleted: counted.deleted,
  };
}

function scopeTotals(range, uncommitted) {
  const lists = [range ? range.files : [], uncommitted.staged.files, uncommitted.unstaged.files, uncommitted.untracked.files];
  let added = 0;
  let deleted = 0;
  const paths = new Set();
  const binaries = new Set();
  for (const list of lists) {
    for (const f of list) {
      if (typeof f.added === "number") added += f.added;
      if (typeof f.deleted === "number") deleted += f.deleted;
      paths.add(f.path);
      if (f.binary) binaries.add(f.path);
    }
  }
  return { lines: added + deleted, added, deleted, fileCount: paths.size, binaryCount: binaries.size };
}

function scope(args) {
  const out = {
    generatedAt: new Date().toISOString(),
    cwd,
    root: null,
    source: "none",
    reason: null,
    message: null,
    head: null,
    plan: null,
    range: null,
    uncommitted: null,
    totals: null,
  };
  const fail = (error) => Object.assign(out, { source: "none", reason: "error", message: error, plan: null, range: null, uncommitted: null, totals: null, error });

  if (args.length > 1) return fail("--scope takes at most one argument, a <base>..<end> range");
  const given = args.length === 1 ? args[0].trim() : "";

  const top = gitScope(["rev-parse", "--show-toplevel"], cwd);
  if (!top.ok) return fail(gitComplaint(top, "git rev-parse --show-toplevel (is this a git working tree?)"));
  // The root as text for git's cwd and the JSON, and as its exact bytes for the
  // untracked file reads, so a non-UTF-8 folder name still opens.
  let rootBytes = top.stdout;
  while (rootBytes.length && (rootBytes[rootBytes.length - 1] === 10 || rootBytes[rootBytes.length - 1] === 13)) {
    rootBytes = rootBytes.subarray(0, rootBytes.length - 1);
  }
  const root = rootBytes.toString("utf8");
  out.root = root;

  // HEAD: a branch (symbolic-ref exits 1 when detached) and a commit (rev-parse
  // --verify exits 1 when the branch has no commits yet).
  const branchRun = gitScope(["symbolic-ref", "-q", "HEAD"], root);
  if (!branchRun.ok && branchRun.status !== 1) return fail(gitComplaint(branchRun, "git symbolic-ref HEAD"));
  const commitRun = gitScope(["rev-parse", "--verify", "-q", "HEAD^{commit}"], root);
  if (!commitRun.ok && commitRun.status !== 1) return fail(gitComplaint(commitRun, "git rev-parse HEAD"));
  const branchRef = branchRun.ok ? branchRun.stdout.toString("utf8").trim() : null;
  const commit = commitRun.ok ? commitRun.stdout.toString("utf8").trim() : null;
  if (commit !== null && !SHA.test(commit)) return fail("git rev-parse HEAD printed an unexpected value");
  if (branchRef === null && commit === null) return fail("HEAD is neither a branch nor a commit");
  out.head = {
    commit,
    branch: branchRef === null ? null : branchRef.replace(/^refs\/heads\//, ""),
    detached: branchRef === null,
    unborn: commit === null,
  };

  // A typed range always wins. With none, the newest plan comes first (#184), then
  // the unpushed commits.
  let found;
  if (given) {
    found = scopeFromArgument(given, out.head, root);
  } else {
    const viaPlan = scopePlan(out.head, root);
    if (viaPlan.error) return fail(viaPlan.error);
    out.plan = viaPlan.plan;
    found = viaPlan.range ? { range: viaPlan.range } : scopeUnpushed(out.head, root);
  }
  if (found.error) return fail(found.error);
  if (found.none) {
    out.reason = found.none.reason;
    out.message = found.none.message;
  } else {
    const range = describeRange(found.range, root);
    if (range.error) return fail(range.error);
    out.source = found.range.source;
    out.range = range;
    if (out.plan !== null && out.plan.reason === "plan-shipped") out.message = shippedMessage(out.plan);
  }

  const uncommitted = uncommittedWork(root, rootBytes, out.head);
  if (uncommitted.error) return fail(uncommitted.error);
  out.uncommitted = uncommitted;
  out.totals = scopeTotals(out.range, uncommitted);
  return out;
}

// --- Dispatch ---------------------------------------------------------------
// No process.exit after writing: stdout into a pipe is asynchronous on macOS, and
// exiting early could cut a long JSON object short.
const cliArgs = process.argv.slice(2);
if (cliArgs.length === 0) {
  emit(sessionStart());
} else if (cliArgs[0] === "--scope") {
  let result;
  try {
    result = scope(cliArgs.slice(1));
  } catch (e) {
    // Fail soft on anything unforeseen too: the caller always gets one JSON object.
    result = { generatedAt: new Date().toISOString(), cwd, source: "none", reason: "error", message: String(e && e.message), error: String(e && e.message) };
  }
  emit(result);
} else {
  emit({ generatedAt: new Date().toISOString(), cwd, error: "unknown argument: " + cliArgs[0] + " (expected no argument, or --scope [<base>..<end>])" });
}
