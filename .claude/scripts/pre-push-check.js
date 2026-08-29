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
// Fail closed, never open. A file this script cannot parse is REPORTED as
// unscannable, not skipped: a scanner that stays silent about what it could
// not read manufactures false confidence, and its exit 0 is what authorizes
// the push. Two parsing hazards are handled explicitly:
//   - Quoted paths. git C-quotes a path containing a non-ASCII byte (unless
//     core.quotePath=false, which git() sets), or a quote, backslash, or
//     control character (which stay quoted regardless). Both the patch header
//     and the file list decode such paths instead of dropping them.
//   - Content that looks like structure. An added line whose text begins with
//     "++ " renders as "+++ ..." - indistinguishable from a file header by
//     prefix alone. The parser tracks hunk line counts, so a line is only ever
//     read as a header when it is genuinely outside a hunk.
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

// Global twins of the patterns above, used only for masking: replace() with a
// non-global regex rewrites one occurrence, which would leave a second secret
// on the same line readable in the report.
const MASK_PATTERNS = PATTERNS.map((p) => new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g"));

// Run git with an argument ARRAY (never a shell string). core.quotePath=false
// keeps non-ASCII paths unescaped; paths containing a quote, backslash, or
// control character are still C-quoted and are decoded by unquotePath below.
// Returns stdout, or null on any failure - callers decide whether null is
// benign or fatal.
function git(args) {
  try {
    return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
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

// Decode a path git wrapped in double quotes with C-style escapes. Returns the
// real path, the input unchanged when it was not quoted, or null when the
// quoted form cannot be decoded - callers treat null as unscannable (a hit),
// never as "nothing to see here".
function unquotePath(p) {
  if (!p.startsWith('"')) return p;
  if (p.length < 2 || !p.endsWith('"')) return null;
  const body = p.slice(1, -1);
  const SIMPLE = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  const bytes = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      bytes.push(...Buffer.from(body[i], "utf8"));
      continue;
    }
    const esc = body[++i];
    if (esc === undefined) return null;
    if (esc >= "0" && esc <= "7") {
      const oct = body.slice(i, i + 3);
      if (!/^[0-7]{3}$/.test(oct)) return null;
      bytes.push(parseInt(oct, 8));
      i += 2;
    } else if (Object.prototype.hasOwnProperty.call(SIMPLE, esc)) {
      bytes.push(SIMPLE[esc]);
    } else {
      return null;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

// Mask EVERY secret on the line, not just the match that triggered the report:
// one line can carry two credentials, and a separate report line is emitted per
// matching pattern - so masking only the trigger republishes its neighbour.
function mask(line) {
  let out = line;
  for (const re of MASK_PATTERNS) out = out.replace(re, (m) => m.slice(0, 4) + "****");
  return out.trim().slice(0, 200);
}

// --- 1. Which commits would a push publish? -------------------------------
// Preference order for the range base:
//   upstream (@{u})       - the branch has been pushed before: exactly what
//                           `git push` would send.
//   remote default branch - never-pushed branch: everything since it forked.
//                           origin/HEAD exists after a clone but NOT after a
//                           hand-added remote, so the common default branch
//                           names are probed too.
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
    const candidates = [];
    const remoteHead = git(["symbolic-ref", "refs/remotes/origin/HEAD"]);
    if (remoteHead !== null) candidates.push(remoteHead.trim().replace("refs/remotes/", ""));
    candidates.push("origin/main", "origin/master");
    for (const candidate of candidates) {
      const mergeBase = git(["merge-base", "HEAD", candidate]);
      if (mergeBase !== null) {
        base = mergeBase.trim();
        break;
      }
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
  let pending = 0; // added lines still expected in the current hunk

  for (const line of patch.split("\n")) {
    // A "diff --git" line always starts a new file section: use it to resync
    // in case a malformed hunk left a stale count behind.
    if (line.startsWith("diff --git ")) {
      pending = 0;
      file = null;
      continue;
    }

    if (pending > 0) {
      // Inside a hunk, every line is content - never structure. This is what
      // stops an added line reading "++ foo" from impersonating a header.
      if (line.startsWith("+")) {
        pending--;
        const added = line.slice(1);
        if (file !== null && file !== SELF_PATH) {
          for (const p of PATTERNS) {
            if (p.re.test(added)) {
              hits.secrets.push("[" + p.name + "] " + file + " @ " + short + " line " + newLine + ": " + mask(added));
            }
          }
        }
        newLine++;
      }
      continue; // removed lines and "\ No newline" markers carry no new content
    }

    // Outside a hunk: headers and hunk starts only.
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4);
      if (raw === "/dev/null") {
        file = null; // deletion: nothing added to scan
        continue;
      }
      const decoded = unquotePath(raw);
      if (decoded === null || !decoded.startsWith("b/")) {
        // Unparseable path: report it rather than silently skipping the file.
        hits.unscannable.push(raw + " @ " + short);
        file = null;
      } else {
        file = decoded.slice(2);
      }
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      newLine = parseInt(hunk[1], 10);
      pending = hunk[2] === undefined ? 1 : parseInt(hunk[2], 10);
    }
  }

  // File-level checks ride on the same commit walk. -z keeps paths raw and
  // NUL-separated, so nothing here needs unquoting.
  const names = git(["diff-tree", "-r", "--name-only", "--no-commit-id", "--root", "-m", "-z", sha]);
  if (names === null) fail("git diff-tree --name-only failed on commit " + sha + ".");
  for (const f of new Set(names.split("\0").filter(Boolean))) {
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

const hits = { secrets: [], neverPush: [], unscannable: [], settingsCommits: new Set() };
for (const sha of commits) scanCommit(sha, hits);

const clean =
  hits.secrets.length === 0 &&
  hits.neverPush.length === 0 &&
  hits.unscannable.length === 0 &&
  hits.settingsCommits.size === 0;
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
if (hits.unscannable.length > 0) {
  out.push("Files whose path could not be parsed - NOT scanned, check them by hand:");
  for (const s of hits.unscannable) out.push("  " + s);
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
