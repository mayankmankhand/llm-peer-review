#!/usr/bin/env node

// pre-push-check.js - the M11 pre-push tripwire (issue #149), hardened from the
// prose instructions each session used to improvise. Run from the project root
// before ANY push:
//
//   node .claude/scripts/pre-push-check.js
//
// What it checks, over the commits the next `git push` would publish:
//   1. Secret scan   - every outgoing commit's ADDED lines against a fixed
//                      pattern list. Per-commit on purpose: a secret added in
//                      one commit and removed in a later one is invisible in
//                      the endpoint diff but still lands in public history.
//   2. Never-push    - .claude/settings.local.json, .env, .env.local appearing
//                      anywhere in the outgoing commits (they must never leave
//                      the machine).
//   3. Settings diff - .claude/settings.json changed in this push: the hunks
//                      are printed so the human can approve the permission
//                      change knowingly (M11's origin: silently added grants).
//
// Contract (mirrors session-init.js / generate-index.js):
//   - stdout = the hit report, and ONLY on a hit. Clean runs print nothing.
//   - stderr = diagnostics only (LESSONS: stdout may be captured by an LLM).
//   - Exit codes: 0 clean (push may proceed silently)
//                 1 hit   (block the push and page the human - M11)
//                 2 error (could not check; fall back to the M11 prose checks,
//                          NEVER push unchecked)
//   - Strictly read-only, zero dependencies, no shell interpolation: git runs
//     via execFileSync with argument arrays (LESSONS: never interpolate
//     variables into inline shell strings).

const { execFileSync } = require("child_process");

// Repo-relative path of this script. Its pattern list would match itself, so
// the scanner skips this one file (the alternative - an allowlist - was
// explicitly scoped out; this is the single hard-coded exception).
const SELF_PATH = ".claude/scripts/pre-push-check.js";

// Files that must never appear in a push, checked against every outgoing
// commit's file list. settings.local.json is matched by full repo path;
// .env / .env.local by basename so they are caught in any subdirectory.
const NEVER_PUSH_PATHS = [".claude/settings.local.json"];
const NEVER_PUSH_BASENAMES = [".env", ".env.local"];

// The shared settings file: legitimate to push, but a change rides along
// silently far too easily - so any change in the outgoing range is a hit
// and the human approves it by saying "push anyway".
const SETTINGS_PATH = ".claude/settings.json";

// Secret patterns scanned against ADDED lines only. Hand-picked common
// formats, not exhaustive by design (decision: self-contained beats a
// gitleaks dependency). Names appear in the report; keep them readable.
const PATTERNS = [
  { name: "private-key-block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { name: "openai-key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "url-with-credentials", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:[^\s/:@'"]+@[^\s/]+/i },
  {
    name: "secret-assignment",
    re: /(password|passwd|pwd|secret|token|api[_-]?key)["']?\s*[:=]\s*["'][^"']{8,}["']/i,
  },
];

// Run git with an argument ARRAY (never a shell string). Returns stdout, or
// null on any failure - callers decide whether null is benign or fatal.
function git(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function fail(msg) {
  process.stderr.write("pre-push-check: " + msg + "\n");
  process.stderr.write("pre-push-check: falling back - run the M11 prose checks; do not push unchecked.\n");
  process.exit(2);
}

// Mask a matched secret: keep the first 4 characters, replace the rest, so the
// report (which lands in chat logs) never republishes the secret it caught.
function mask(line, re) {
  return line.replace(re, (m) => m.slice(0, 4) + "****").trim().slice(0, 200);
}

// --- 1. Which commits would a push publish? -------------------------------
// Preference order for the range base:
//   upstream (@{u})       - the branch has been pushed before: exactly what
//                           `git push` would send.
//   merge-base w/ default - never-pushed branch: everything since it forked
//                           from the remote default branch.
//   nothing               - empty/new remote: every commit on HEAD is outgoing.
function outgoingCommits() {
  if (git(["symbolic-ref", "--quiet", "--short", "HEAD"]) === null) {
    fail("detached HEAD - cannot determine what a push would publish.");
  }
  let base = null;
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream !== null) {
    base = upstream.trim();
  } else {
    const remoteHead = git(["symbolic-ref", "refs/remotes/origin/HEAD"]);
    if (remoteHead !== null) {
      const def = remoteHead.trim().replace("refs/remotes/", "");
      const mb = git(["merge-base", "HEAD", def]);
      if (mb !== null) base = mb.trim();
    }
  }
  const range = base === null ? ["HEAD"] : [base + "..HEAD"];
  const out = git(["rev-list", ...range]);
  if (out === null) fail("git rev-list failed - cannot enumerate outgoing commits.");
  return { commits: out.split("\n").filter(Boolean), base };
}

// --- 2. Scan one commit ---------------------------------------------------
// diff-tree flags: -r recurse, -p patch, --unified=0 exact hit lines, --root
// so the very first commit of a repo diffs against the empty tree, -m so a
// merge commit shows real per-parent patches (an "evil merge" can introduce a
// secret no parent had; the cost is a possible duplicate report, accepted).
function scanCommit(sha, hits) {
  const patch = git(["diff-tree", "-r", "-p", "--unified=0", "--no-color", "--root", "-m", sha]);
  if (patch === null) fail("git diff-tree failed on commit " + sha + ".");
  const short = sha.slice(0, 7);

  let file = null; // repo-relative path of the file the current hunk touches
  let newLine = 0; // line number in the NEW file, tracked from @@ headers

  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.startsWith("+++ b/") ? line.slice(6) : null; // null = /dev/null (deletion)
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      newLine = parseInt(hunk[1], 10);
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const added = line.slice(1);
    if (file !== null && file !== SELF_PATH) {
      for (const p of PATTERNS) {
        if (p.re.test(added)) {
          hits.secrets.push(
            "[" + p.name + "] " + file + " @ " + short + " line " + newLine + ": " + mask(added, p.re)
          );
        }
      }
    }
    newLine++;
  }

  // File-level checks ride on the same commit walk.
  const names = git(["diff-tree", "-r", "--name-only", "--no-commit-id", "--root", "-m", sha]);
  if (names === null) fail("git diff-tree --name-only failed on commit " + sha + ".");
  for (const f of new Set(names.split("\n").filter(Boolean))) {
    const basename = f.split("/").pop();
    if (NEVER_PUSH_PATHS.includes(f) || NEVER_PUSH_BASENAMES.includes(basename)) {
      hits.neverPush.push(f + " @ " + short);
    }
    if (f === SETTINGS_PATH) hits.settingsCommits.add(short);
  }
}

// --- Main -----------------------------------------------------------------
const { commits, base } = outgoingCommits();
if (commits.length === 0) process.exit(0); // nothing outgoing, nothing to say

const hits = { secrets: [], neverPush: [], settingsCommits: new Set() };
for (const sha of commits) scanCommit(sha, hits);

const clean = hits.secrets.length === 0 && hits.neverPush.length === 0 && hits.settingsCommits.size === 0;
if (clean) process.exit(0); // silent when clean, by contract

const out = [];
out.push("PRE-PUSH TRIPWIRE HIT - push blocked (M11)");
out.push("");
if (hits.secrets.length > 0) {
  out.push("Possible secrets in outgoing commits (matched value masked):");
  for (const s of hits.secrets) out.push("  " + s);
  out.push("");
}
if (hits.neverPush.length > 0) {
  out.push("Never-push files in outgoing commits:");
  for (const s of hits.neverPush) out.push("  " + s);
  out.push("");
}
if (hits.settingsCommits.size > 0) {
  out.push("Shared settings file (" + SETTINGS_PATH + ") changes in this push:");
  const diffArgs = base === null
    ? ["show", "HEAD", "--no-color", "--", SETTINGS_PATH]
    : ["diff", "--no-color", base + "..HEAD", "--", SETTINGS_PATH];
  const diff = git(diffArgs);
  out.push(diff === null || diff.trim() === "" ? "  (touched in: " + [...hits.settingsCommits].join(", ") + ")" : diff.trimEnd());
  out.push("");
}
out.push("Commits scanned: " + commits.length + (base === null ? " (no remote base - full history)" : ""));
process.stdout.write(out.join("\n") + "\n");
process.exit(1);
