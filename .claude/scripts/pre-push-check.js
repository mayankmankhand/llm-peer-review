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
//   2. Never-push    - every name in the NEVER_PUSH_PATHS and
//                      NEVER_PUSH_BASENAMES lists below (the local settings
//                      file, env files, the correction ledger's files, netrc)
//                      NEWLY introduced by the outgoing commits (they must never
//                      leave the machine). A path that already exists at the
//                      range base is published history rather than news - this
//                      repo tracks settings.local.json as the seed template -
//                      and re-alarming on it every time would train the
//                      override reflex the tripwire exists to prevent. With no
//                      remote base nothing can be proven published, so every
//                      match blocks.
//   3. Settings diff - .claude/settings.json changed in this push: the hunks
//                      are printed so the human can approve the permission
//                      change knowingly (M11's origin: silently added grants).
//   4. Version guard - only when this copy runs from inside the tk plugin (a
//                      .claude-plugin/plugin.json sits one folder above it;
//                      the source copy and non-plugin installs have none and
//                      skip this entirely). The version the scan ran as goes
//                      to stderr, and the push is a hit when that version is
//                      OLDER than the one the project recorded in
//                      .claude/.toolkit-state.json (issue #174): an older
//                      plugin scans with older patterns than the project was
//                      set up or audited with. Newer or equal never blocks;
//                      session-start.js tells the user to run /tk:upgrade.
//                      A recorded value that is not a plain version (see the
//                      helpers) is no reference: never printed, never a block.
//
// Fail closed, never open. A file this script cannot parse is REPORTED as
// unscannable, not skipped: a scanner that stays silent about what it could
// not read manufactures false confidence, and its exit 0 is what authorizes
// the push. Three parsing hazards are handled explicitly:
//   - Quoted paths. git C-quotes a path containing a non-ASCII byte (unless
//     core.quotePath=false, which git() sets), or a quote, backslash, or
//     control character (which stay quoted regardless). Both the patch header
//     and the file list decode such paths instead of dropping them.
//   - Content that looks like structure. An added line whose text begins with
//     "++ " renders as "+++ ..." - indistinguishable from a file header by
//     prefix alone. The parser tracks hunk line counts, so a line is only ever
//     read as a header when it is genuinely outside a hunk.
//   - Binary files. git prints one "Binary files ... differ" line and no
//     hunks, so there are no added lines to scan. A binary whose name marks it
//     as a secret container (see SECRET_CONTAINER_* below) is reported as
//     unscannable; other binaries stay silent, with the line drawn there on
//     purpose.
//
// Contract (mirrors session-init.js / generate-index.js):
//   - stdout = the hit report, and ONLY on a hit. Clean runs print nothing.
//   - stderr = diagnostics only (LESSONS: stdout may be captured by an LLM),
//     including the "tk pre-push check <version>" line of a plugin run.
//   - Exit codes: 0 clean (push may proceed silently)
//                 1 hit   (block the push and page the human - M11)
//                 2 error (could not check; fall back to the M11 prose checks,
//                          NEVER push unchecked)
//   - Strictly read-only, zero dependencies, no shell interpolation: git runs
//     via execFileSync with argument arrays (LESSONS: never interpolate
//     variables into inline shell strings).

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Repo-relative paths of this script. Its pattern list would match itself, so
// the scanner skips these files (the alternative - an allowlist - was
// explicitly scoped out; this is the single hard-coded exception). Two paths
// since v7.0.0: the source copy, and the copy the plugin generator commits
// under plugin/ (issue #167) - an exact-path exemption would have scanned that
// second copy against its own patterns and blocked every push.
const SELF_PATHS = [".claude/scripts/pre-push-check.js", "plugin/scripts/pre-push-check.js"];

// Files that must never appear in a push, checked against every outgoing
// commit's file list. settings.local.json is matched by full repo path;
// .env / .env.local by basename so they are caught in any subdirectory.
//
// The correction-* files are the issue #157 ledger. They normally live at
// ~/.claude/, outside every repo, so git cannot commit them and .gitignore has
// nothing to act on. They are listed here anyway because this is the layer that
// still catches them: .gitignore does not stop `git add -f`, and a copy made into
// a repo for any reason would carry verbatim fragments of what the user typed.
const NEVER_PUSH_PATHS = [".claude/settings.local.json"];
const NEVER_PUSH_BASENAMES = [
  ".env", ".env.local",
  "correction-ledger.jsonl", "correction-heartbeat.jsonl",
  "correction-rollup.json", "correction-axial-map.json",
  // The load-bearing one. Every name above lives at ~/.claude/, outside any repo,
  // so git could not commit it anyway. correction-rows.json is the hand-off file
  // /document writes before --add, it carries both private fields UNtruncated, and
  // its path is chosen at runtime rather than fixed in code. The script deletes it
  // after a successful append; this catches the run where that did not happen.
  "correction-rows.json",
  // A committed .netrc is never legitimate: the whole file is credentials, so
  // there is no line pattern to match and the name alone is the check (#164).
  // _netrc is the Windows spelling of the same file.
  //
  // .npmrc and .pypirc are deliberately NOT here. Both are routinely committed
  // with no credential in them at all (registry URLs, save-exact, index-url), so
  // flagging them by name would block ordinary pushes and train the "push anyway"
  // reflex this tripwire exists to prevent. Their token lines are caught by the
  // npm-token and pypi-token patterns instead - one pattern per registry, because
  // the two token formats share nothing. An earlier draft of this comment claimed
  // npm-token covered both, which was false and left .pypirc with no cover at all.
  ".netrc", "_netrc"
];

// The shared settings file: legitimate to push, but a change rides along
// silently far too easily - so any change in the outgoing range is a hit
// and the human approves it by saying "push anyway".
const SETTINGS_PATH = ".claude/settings.json";

// Binary files whose NAME says they hold key material. The line scanner cannot
// read a binary at all: git emits a single "Binary files ... differ" line for
// it and no hunks, and until the holistic review (R20) the parser had no branch
// for that line, so a committed .pfx passed in silence - the opposite of the
// fail-closed contract above. Reporting every binary would re-alarm on each
// icon and font and train the "push anyway" reflex the tripwire exists to
// prevent; reporting none is the silence being fixed. So the line is drawn at
// the name: an added or modified binary matching one of these is reported as
// unscannable (exit 1, check it by hand), any other binary stays silent. A
// TEXT file under one of these names (a PEM .key, an armored .asc) never reaches
// this list - it has hunks, and the private-key-block pattern is the better
// check for it.
const SECRET_CONTAINER_EXTENSIONS = [
  ".pfx", ".p12", ".jks", ".keystore", ".kdbx", ".gpg", ".asc", ".der", ".key",
];
const SECRET_CONTAINER_BASENAMES = ["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"];

// Secret patterns scanned against ADDED lines only. Hand-picked common
// formats, not exhaustive by design (decision: self-contained beats a
// gitleaks dependency). Names appear in the report; keep them readable.
const PATTERNS = [
  { name: "private-key-block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { name: "openai-key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  // fal.ai keys (the design workflow's FAL_KEY): a UUID, a colon, 32 hex characters.
  { name: "fal-key", re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}\b/ },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  // GitLab tokens (issue #164). glpat- is the personal access token the toolkit
  // itself authenticates with through glab, so on a GitLab-hosted install it is
  // the single most likely credential to appear in the tree. The five prefixes on
  // the second line are GitLab's deploy, runner, service-account, pipeline-trigger
  // and cluster-agent tokens, which share the same body shape.
  { name: "gitlab-pat", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { name: "gitlab-token", re: /\b(?:gldt|glrt|glsoat|glptt|glcbt)-[A-Za-z0-9_-]{20,}\b/ },
  // npm automation and granular access tokens: npm_ plus exactly 36 characters.
  // The shape that actually occurs is an .npmrc line
  // (//registry.npmjs.org/:_authToken=npm_...), which secret-assignment below
  // cannot catch: the value is unquoted AND the key is not one of its names.
  { name: "npm-token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  // PyPI API tokens: the literal prefix pypi- then a long base64url body. Added
  // because .pypirc is deliberately absent from the never-push list above, so this
  // pattern is the only thing standing between a publish token and a push. The
  // legacy npm token (a bare hex UUID with no prefix) is knowingly NOT matched: a
  // pattern for it would fire on every UUID in the tree.
  { name: "pypi-token", re: /\bpypi-[A-Za-z0-9_-]{16,}\b/ },
  // A JSON Web Token: three dot-separated base64url segments. Anchored on BOTH
  // the header and the payload starting with eyJ (what base64 makes of a JSON
  // object opening with a brace and a quote), because one eyJ alone is ordinary
  // base64 and would fire on any encoded blob.
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  // A .netrc credential record. Anchored on the RECORD SHAPE, never on the bare
  // word "password": netrc keywords are whitespace-separated pairs, so a real
  // credential line carries "machine <host>" or "login <user>" first. A pattern
  // matching the bare word fires on ordinary English - the reporter's first
  // attempt flagged the sentence "(password) is Enterprise-only ...", and
  // excluding English one phrase at a time is unwinnable.
  //
  // The concession is that a bare "password hunter2" line no longer matches, and
  // neither does a record split one keyword per line. A file actually NAMED .netrc
  // is caught by name above whatever its layout; what stays uncovered is a
  // multi-line record written into a file with another name, such as a setup
  // script heredoc. This pattern catches the single-line form of that case only.
  //
  // The value must ALSO look like a credential: eight characters or more and at
  // least one digit. Without that, the keyword pair alone matched ordinary English
  // - "The login and password fields are required." and "machine learning login and
  // password fields" both fired, because any filler word satisfies the middle slot
  // and any six-letter word satisfies the value. A false positive is not mere noise
  // here: this scanner has no allow-list, so a spurious block teaches the "push
  // anyway" reflex it exists to prevent.
  //
  // The residue after the shape and value requirements was documentation that SHOWS
  // a record rather than describing one: a realistic example carries a digit, so it
  // matched, and the only way past a block is --no-verify - the reflex this scanner
  // exists to prevent. Asking every downstream project to adopt a writing convention
  // is not a fix. So the pattern takes file context too (issue #166): it does not
  // apply to markdown, which is where documentation lives.
  //
  // What that costs, stated plainly: a real netrc record pasted into a markdown file
  // is missed by THIS pattern. What still covers that file: a file actually named
  // .netrc or _netrc is blocked by name whatever its extension or contents, and every
  // other pattern (url-with-credentials, secret-assignment, and each token format)
  // still scans markdown unchanged. Only this one heuristic steps aside, and only
  // where prose is expected.
  //
  // The narrower rule - fire inside a fenced code block, skip in prose - is not
  // available: the scanner reads `git diff --unified=0`, which yields added lines
  // with no surrounding context, so there is no way to know whether a line sits
  // inside a fence. A guess would fail open or fail loud, and both are worse.
  {
    name: "netrc-record",
    re: /\b(?:machine\s+[\w.-]+\s+(?:login\s+\S+\s+)?|login\s+\S+\s+)password\s+(?=\S*[0-9])\S{8,}/i,
    skipFile: (f) => /\.(?:md|markdown|mdx)$/i.test(f),
  },
  // A URL carrying user:password before the host. The lookahead after :// skips a
  // mail client's mangled link (issue #168): some clients linkify an address that
  // is already a mailto: link and write https://mailto:user@example.com, which
  // otherwise reads as username "mailto", password "user". tel: gets the same
  // treatment. The word must be followed by its colon, so a real username that
  // only STARTS with one (mailtoadmin, telco) is still caught.
  //
  // The concession: a real credential whose username is exactly "mailto" or "tel"
  // is missed. It has the same shape as a mangled link, so no pattern can tell the
  // two apart, and a downstream project cannot patch this around a false positive
  // because the plugin does not keep local edits.
  //
  // render-html.js keeps the broader form in its receipt masker on purpose: there
  // it only hides text on a published page, where masking a mailto link costs
  // nothing.
  { name: "url-with-credentials", re: /\b[a-z][a-z0-9+.-]*:\/\/(?!(?:mailto|tel):)[^\s/:@'"]+:[^\s/:@'"]+@[^\s/]+/i },
  // A key name, then = or :, then a quoted value of 8 characters or more.
  //
  // A placeholder is not a value (issue #178). The pattern never looked at the
  // value, so `const ROOT_TOKEN = '${CLAUDE_PLUGIN_ROOT}'` blocked a push while
  // the 7-character '${NAME}' passed: length alone decided. The negative
  // lookahead right after the opening quote refuses the match when the WHOLE
  // value, up to the quote that opened it, is exactly one of three shapes:
  //   ${IDENT}           a shell or compose variable; IDENT is a letter or _
  //                      followed by letters, digits and _
  //   ${{ a.b }}         a GitHub Actions expression over a dotted path of such
  //                      identifiers, inner spaces optional
  //   your-key-here      letter segments joined by - or _, no digit, one whole
  //                      segment being "your" (sk-proj-your-key-here included)
  // Anything more is treated as a value: a default (${X:-lit}), a literal before
  // or after (lit${X}, ${X}lit, ${{ a.b }}lit), an expression holding a literal
  // (${{ a || 'lit' }}), angle brackets, a digit. A refused position does not
  // end the search - the regex is tried at every later position, so a real
  // assignment after a placeholder on the same line still hits - and the token
  // patterns above still scan inside placeholder text, so a real sk- body under
  // a "your" name is still caught.
  //
  // What is detected is otherwise unchanged: the (?=[^"']{8,}["']) lookahead is
  // the old rule, under which the first quote of either kind ends the value. The
  // rest of the match, to the SAME quote that opened the value (a backslash
  // escapes one character), only decides what mask() hides: the old match
  // stopped at an apostrophe inside "Tr0ub4dor's...", and the report printed
  // the rest of the secret. A value with the other quote inside its first 8
  // characters is still not detected; widening that is a separate change.
  {
    name: "secret-assignment",
    re: /((?:password|passwd|pwd|secret|token|api[_-]?key)["']?\s*[:=]\s*(["']))(?!(?:\$\{[a-z_]\w*\}|\$\{\{\s*[a-z_]\w*(?:\.[a-z_]\w*)*\s*\}\}|(?:[a-z]+[-_])*your(?:[-_][a-z]+)*)\2)(?=[^"']{8,}["'])(?:\\[\s\S]|(?!\2)[^\\])*(\2?)/i,
    // What mask() hides of a match: the value only. Group 1 is the key through
    // the opening quote and group 3 the closing quote (empty when the line ends
    // first), so the key, the operator and both quotes stay readable.
    hide: (m) => [m.index + m[1].length, m.index + m[0].length - m[3].length],
  },
];

// Global twins of the patterns above, DERIVED from PATTERNS with .map(), so a new
// pattern is masked automatically and there is no second list to keep in sync.
// Used only for masking: a non-global regex finds one occurrence, which would
// leave a second secret on the same line readable in the report. Each twin
// carries its pattern's hide rule, if it has one.
const MASK_PATTERNS = PATTERNS.map((p) => ({
  re: new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g"),
  hide: p.hide,
}));

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

// Split a "diff --git a/P b/P" header into its two raw sides plus the decoded
// path. P appears twice, so the split point is the MIDDLE of the text rather
// than a space: a path may contain spaces, and "a and b.pfx" is a legal name
// that also defeats splitting the binary notice below on " and ". Returns null
// when the halves do not decode to the same path - diff-tree without -M never
// reports a rename, so that is a parse failure, and the caller reports it
// rather than guessing (holistic review, R20).
function headerSides(rest) {
  if (rest.length % 2 === 0) return null; // "X X" is always odd in length
  const mid = (rest.length - 1) / 2;
  if (rest[mid] !== " ") return null;
  const sides = { a: rest.slice(0, mid), b: rest.slice(mid + 1) };
  const a = unquotePath(sides.a);
  const b = unquotePath(sides.b);
  if (a === null || b === null) return null;
  if (!a.startsWith("a/") || !b.startsWith("b/") || a.slice(2) !== b.slice(2)) return null;
  sides.path = b.slice(2);
  return sides;
}

// Is this repo path named like a secret container? Basename first (id_rsa has
// no extension), then extension, both case-insensitive so Client.PFX counts.
function isSecretContainer(repoPath) {
  const basename = repoPath.split("/").pop().toLowerCase();
  if (SECRET_CONTAINER_BASENAMES.includes(basename)) return true;
  const dot = basename.lastIndexOf(".");
  return dot !== -1 && SECRET_CONTAINER_EXTENSIONS.includes(basename.slice(dot));
}

// Does this path already exist at the range base? If so a push cannot leak it:
// it is already on the remote. Returns false when there is no base, so an
// unprovable case still blocks (fail closed).
function existsInBase(path, base) {
  if (base === null) return false;
  return git(["cat-file", "-e", base + ":" + path]) !== null;
}

// Mask EVERY secret on the line, not just the match that triggered the report:
// one line can carry two credentials, and a separate report line is emitted per
// matching pattern - so masking only the trigger republishes its neighbour.
//
// Every pattern reads the ORIGINAL line, the text the scan read, and marks the
// characters it hides; each marked run is then printed as **** (issue #178). A
// match keeps its first 4 characters unless its pattern has a hide rule
// (secret-assignment hides its whole value and nothing else). Rewriting the
// line one pattern at a time instead would let one rewrite change what the
// next pattern sees, so the mask could stop following the scan's own rule.
function mask(line) {
  const hidden = new Array(line.length).fill(false);
  for (const p of MASK_PATTERNS) {
    for (const m of line.matchAll(p.re)) {
      const [from, to] = p.hide ? p.hide(m) : [m.index + 4, m.index + m[0].length];
      for (let i = from; i < to; i++) hidden[i] = true;
    }
  }
  let out = "";
  for (let i = 0; i < line.length; i++) {
    if (!hidden[i]) out += line[i];
    else if (i === 0 || !hidden[i - 1]) out += "****";
  }
  return out.trim().slice(0, 200);
}

// --- Version guard helpers (issue #174) -------------------------------------
// Copies of the block below live in session-start.js and setup-project.js
// (scripts/setup/setup.sh copies this file alone into non-plugin installs). It
// keeps single quotes, unlike the rest of this file, so it stays byte-identical
// to the other two copies.
// >>> version helpers (issue #174) >>>
// Byte-identical in session-start.js, pre-push-check.js and setup-project.js,
// from this marker to the closing one. Each script must run on its own (the
// pre-push check is also copied alone into non-plugin installs), so there is no
// shared module; scripts/test-pre-push-check.js fails when the copies drift.
//
// A version is only ever taken from a string of one fixed, harmless shape:
// dotted numbers (one to four parts), an optional -suffix of letters, digits and
// dots, at most 32 characters. The state file these read is committed to the
// project, so a cloned repository controls it, and session-start.js prints the
// version into Claude's context: any other text there would be injected into
// it. A value of any other shape is no usable version - never printed, never
// compared, never a block.
const VERSION_SHAPE = /^\d+(\.\d+){0,3}(-[0-9A-Za-z.]+)?$/;
const VERSION_MAX_LENGTH = 32;
// The version as a safe string (surrounding whitespace dropped), or null.
function validVersion(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length <= VERSION_MAX_LENGTH && VERSION_SHAPE.test(t) ? t : null;
}
// Dotted numeric parts, any -suffix ignored: 7.0.1 < 7.1.0 < 7.10.0. Null for
// anything validVersion refuses, so a malformed value never produces a verdict.
function parseVersion(v) {
  const t = validVersion(v);
  return t === null ? null : t.split('-')[0].split('.').map(Number);
}
// -1, 0 or 1 as a is older than, equal to, or newer than b; null when either is unusable.
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null || pb === null) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
// The version a project is recorded at: auditedVersion (a /tk:upgrade stamped
// it, or a fresh setup wrote it), else previousVersion (a migration's old
// copy-install version), else version. The first key that names a version
// decides, validated: null when none names one or that value is unusable (no
// fall-through to a later key, so a malformed stamp cannot pick the reference).
function referenceVersion(state) {
  if (!state || typeof state !== 'object') return null;
  for (const key of ['auditedVersion', 'previousVersion', 'version']) {
    if (typeof state[key] === 'string' && state[key].trim() !== '') return validVersion(state[key]);
  }
  return null;
}
// <<< version helpers <<<

// The version of the plugin this copy runs from, or null for the source copy
// and every non-plugin install (no manifest one folder above the script).
function runningPluginVersion() {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".claude-plugin", "plugin.json"), "utf8"));
    return meta && typeof meta.version === "string" ? meta.version : null;
  } catch {
    return null;
  }
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
  let section = null; // the current "diff --git" header's sides, for binary notices

  for (const line of patch.split("\n")) {
    // A "diff --git" line always starts a new file section: use it to resync
    // in case a malformed hunk left a stale count behind.
    if (line.startsWith("diff --git ")) {
      pending = 0;
      file = null;
      section = headerSides(line.slice(11));
      continue;
    }

    if (pending > 0) {
      // Inside a hunk, every line is content - never structure. This is what
      // stops an added line reading "++ foo" from impersonating a header.
      if (line.startsWith("+")) {
        pending--;
        const added = line.slice(1);
        if (file !== null && !SELF_PATHS.includes(file)) {
          for (const p of PATTERNS) {
            // A pattern may exempt itself by FILE, not by content: see netrc-record
            // (issue #166). Content-based allow-listing is still refused - that is
            // what teaches the "push anyway" reflex - but a heuristic whose false
            // positives all land in one file type may decline that file type.
            if (p.skipFile && p.skipFile(file)) continue;
            if (p.re.test(added)) {
              hits.secrets.push("[" + p.name + "] " + file + " @ " + short + " line " + newLine + ": " + mask(added));
            }
          }
        }
        newLine++;
      }
      continue; // removed lines and "\ No newline" markers carry no new content
    }

    // Outside a hunk: headers, hunk starts, and the one-line binary notice.
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4);
      if (raw === "/dev/null") {
        file = null; // deletion: nothing added to scan
        continue;
      }
      const decoded = unquotePath(raw);
      if (decoded === null || !decoded.startsWith("b/")) {
        // Unparseable path: report it rather than silently skipping the file.
        hits.unscannable.push(raw + " @ " + short + " (path could not be parsed)");
        file = null;
      } else {
        file = decoded.slice(2);
      }
      continue;
    }
    if (line.startsWith("Binary files ")) {
      // A binary section has this line instead of "+++" and hunks, so nothing
      // above ever sees it. The notice is matched EXACTLY against the header's
      // sides rather than split on " and ", which a path can contain; the three
      // shapes git prints are add, modify and delete. Anything else is a parse
      // failure and is reported, never skipped (holistic review, R20).
      const notice = line.slice(13);
      if (section === null) {
        hits.unscannable.push(notice + " @ " + short + " (binary; path could not be parsed)");
        continue;
      }
      const added = notice === "/dev/null and " + section.b + " differ";
      const modified = notice === section.a + " and " + section.b + " differ";
      const deleted = notice === section.a + " and /dev/null differ";
      if (!added && !modified && !deleted) {
        hits.unscannable.push(notice + " @ " + short + " (binary; path could not be parsed)");
      } else if (!deleted && isSecretContainer(section.path)) {
        // Deleting a binary publishes nothing new. Adding or changing one that
        // is named like key material cannot be read here, so the human must.
        hits.unscannable.push(section.path + " @ " + short + " (binary secret container; cannot be scanned)");
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
      hits.neverPushRaw.push({ path: f, short: short });
    }
    if (f === SETTINGS_PATH) hits.settingsCommits.add(short);
  }
}

// --- Main -----------------------------------------------------------------
// Name the version that ran first, on stderr, so it shows on every outcome
// (clean, hit, or could-not-check) without breaking the silent-stdout contract.
const RUNNING_VERSION = runningPluginVersion();
if (RUNNING_VERSION !== null) process.stderr.write("tk pre-push check " + RUNNING_VERSION + "\n");

const { commits, base } = outgoingCommits();
if (commits.length === 0) process.exit(0); // nothing outgoing, nothing to say

const hits = { secrets: [], neverPushRaw: [], neverPush: [], unscannable: [], settingsCommits: new Set(), buildStale: null, versionBehind: null };
for (const sha of commits) scanCommit(sha, hits);

// Version guard (issue #174). The state file is read from the repository root
// the scan covers, falling back to the working folder outside a readable repo.
// No state file, no reference, or an unparseable version: no verdict, no block.
if (RUNNING_VERSION !== null) {
  const topLevel = git(["rev-parse", "--show-toplevel"]);
  const root = topLevel === null ? process.cwd() : topLevel.trim();
  let state = null;
  try {
    state = JSON.parse(fs.readFileSync(path.join(root, ".claude", ".toolkit-state.json"), "utf8"));
  } catch {
    state = null;
  }
  // Both sides validated: the report prints them, and only a version of the
  // fixed shape is ever printed (the same rule as session-start.js).
  const reference = referenceVersion(state);
  const running = validVersion(RUNNING_VERSION);
  if (reference !== null && running !== null && compareVersions(running, reference) === -1) {
    hits.versionBehind = { running: running, reference: reference };
  }
}

// Generated-plugin freshness (issue #167). Only the toolkit repository carries
// both the marketplace file and the maintainer generator; every downstream copy
// of this script sees neither and skips the check, so a downstream push never
// fails on a script it does not have.
//
// The check runs against the commit being pushed, not the working folder. The
// outgoing range always ends at HEAD, and build-plugin.js resolves its source
// and plugin/ from its own location, so running HEAD's copy of the generator
// inside HEAD's exported tree checks exactly what lands. Run in place, it read
// the working folder: an uncommitted edit blocked a clean push, and a stale
// plugin/ that was committed passed once the working copy had been rebuilt
// (review of the v7.0.0 release, R3).
const BUILD_CHECK_MARKER = ".claude-plugin/marketplace.json";
const BUILD_SCRIPT = "scripts/build-plugin.js";

// Write every file of HEAD's tree under dir, with no shell and no tar: one
// `git ls-tree` for the list, one `git cat-file --batch` for the contents.
// Returns false when git cannot supply the tree.
function exportHeadTree(dir) {
  const { spawnSync } = require("child_process");
  const path = require("path");
  const ls = spawnSync("git", ["ls-tree", "-r", "-z", "HEAD"], { maxBuffer: 64 * 1024 * 1024 });
  if (ls.status !== 0) return false;
  const blobs = ls.stdout.toString("utf8").split("\0").filter(Boolean).map((entry) => {
    const tab = entry.indexOf("\t");
    const meta = entry.slice(0, tab).split(" ");
    return { type: meta[1], sha: meta[2], name: entry.slice(tab + 1) };
  }).filter((e) => e.type === "blob");
  const cat = spawnSync("git", ["cat-file", "--batch"], { input: blobs.map((e) => e.sha).join("\n") + "\n", maxBuffer: 1024 * 1024 * 1024 });
  if (cat.status !== 0) return false;
  const buf = cat.stdout;
  let offset = 0;
  for (const e of blobs) {
    const newline = buf.indexOf(10, offset);
    if (newline === -1) return false;
    const size = parseInt(buf.slice(offset, newline).toString("utf8").split(" ")[2], 10);
    if (!Number.isFinite(size)) return false;
    const start = newline + 1;
    const abs = path.join(dir, e.name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf.slice(start, start + size));
    offset = start + size + 1;
  }
  return true;
}

function buildCheckAtHead() {
  const os = require("os");
  const path = require("path");
  const { spawnSync } = require("child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pre-push-build-"));
  let exported = false;
  let result = null;
  try {
    exported = exportHeadTree(dir);
    const script = path.join(dir, BUILD_SCRIPT);
    if (exported && fs.existsSync(script)) {
      const r = spawnSync(process.execPath, [script, "--check", "--quiet"], { cwd: dir, encoding: "utf8" });
      if (r.status !== 0) result = (r.stderr || r.stdout || "").trim() || "build-plugin --check failed with status " + r.status;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (!exported) fail("could not export the pushed commit's tree for the generated-plugin check.");
  return result;
}

if (fs.existsSync(BUILD_CHECK_MARKER) && fs.existsSync(BUILD_SCRIPT)) {
  hits.buildStale = buildCheckAtHead();
}

// Keep only never-push paths this push would actually publish for the first
// time; one base lookup per distinct path, after the walk rather than inside it.
const publishedAlready = new Map();
for (const candidate of hits.neverPushRaw) {
  if (!publishedAlready.has(candidate.path)) {
    publishedAlready.set(candidate.path, existsInBase(candidate.path, base));
  }
  if (!publishedAlready.get(candidate.path)) {
    hits.neverPush.push(candidate.path + " @ " + candidate.short);
  }
}

const clean =
  hits.secrets.length === 0 &&
  hits.neverPush.length === 0 &&
  hits.unscannable.length === 0 &&
  hits.settingsCommits.size === 0 &&
  hits.buildStale === null &&
  hits.versionBehind === null;
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
  out.push("Files this scanner could not read - NOT scanned, check them by hand:");
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
if (hits.buildStale !== null) {
  out.push("Generated plugin/ is stale against .claude/ in the commit being pushed (run: node scripts/build-plugin.js, then commit):");
  for (const line of hits.buildStale.split("\n")) out.push("  " + line);
  out.push("");
}
if (hits.versionBehind !== null) {
  out.push("Toolkit plugin is older than this project's recorded version (issue #174):");
  out.push("  This check ran as tk " + hits.versionBehind.running + ", but .claude/.toolkit-state.json records toolkit " + hits.versionBehind.reference + ".");
  out.push("  An older plugin scans with older checks than this project was set up or audited with.");
  out.push("  Fix: run `claude plugin update tk@llm-peer-review` and restart Claude Code (or open a session in this");
  out.push("  project so the newer installed version is the one running), then push again.");
  out.push("");
}
out.push("Commits scanned: " + commits.length + (base === null ? " (no remote base - full history)" : ""));
// Silent when clean, by contract: an empty report writes nothing, not a bare
// newline, so a caller capturing stdout sees exactly what the report holds.
if (out.length) process.stdout.write(out.join("\n") + "\n");
process.exit(1);
