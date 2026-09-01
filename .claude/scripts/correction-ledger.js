#!/usr/bin/env node
'use strict';
//
// correction-ledger.js - record what the human corrected, count it later. (issue #157)
//
// Why this exists:
//   The toolkit fixes problems at the first sighting and never counts them, so a
//   one-off and a recurring pattern look identical. LESSONS.md holds 60+ entries
//   with no frequencies attached, and its own capture rule already assumes counting
//   ("Claude repeated a mistake", "the user typed the same correction twice") while
//   having no counter. This script is the counter.
//
//   The unit is a HUMAN INTERVENTION: Claude produced or asserted something and the
//   user pushed back or asked for something different. Reviews are deliberately NOT
//   logged here: a review writes a durable report every run, so "have I seen this
//   before?" is already answerable for findings and unanswerable for corrections.
//   This ledger instruments the half that has no instrument.
//
// Two-stage coding, borrowed from qualitative error analysis:
//   1. OPEN CODE, written at capture time, free text, in the user's own words.
//      Never a pick from a list: the categories do not exist yet, and a judgment
//      made at n=1 is uninformed.
//   2. AXIAL CODE, assigned later by /error-analysis across the whole corpus, once
//      patterns are actually visible.
//
// PRIVACY - the single most important property of this file:
//   `produced` and `correction` are the PRIVATE LAYER. They hold near-verbatim
//   quotes and can contain anything the user typed. They are never included in a
//   rollup, never rendered into an artifact, and never sent anywhere. The rollup is
//   built from shareable(), an explicit whitelist projection, so reading a private
//   field into a rollup is not expressible rather than merely discouraged. Both
//   fields are also hard-truncated on write, so a long pasted block can never land
//   in the ledger wholesale.
//
// Storage is PER MACHINE, outside any repo, under ~/.claude/. Every row carries the
// repo it came from, so repo-specific and cross-repo questions are both a filter on
// one dataset rather than a decision made at write time (when n=1 makes it unanswerable).
//
// Append-only JSONL throughout, mirroring render-html.js's index: one JSON line per
// record via fs.appendFileSync, never read-then-rewrite, so concurrent sessions
// cannot clobber each other. Axial codes therefore live in a SEPARATE map file and
// are joined at rollup time; rewriting rows in place would break that guarantee.
//
// Zero external dependencies (Node built-ins only), so it adds nothing to the
// quarantined .claude/scripts/package.json.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function die(msg) {
  console.error('correction-ledger.js: ' + msg);
  process.exit(1);
}

// --- storage paths (per machine, outside every repo) ---
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const LEDGER_PATH = path.join(CLAUDE_DIR, 'correction-ledger.jsonl');
const HEARTBEAT_PATH = path.join(CLAUDE_DIR, 'correction-heartbeat.jsonl');
const ROLLUP_PATH = path.join(CLAUDE_DIR, 'correction-rollup.json');
const AXIAL_MAP_PATH = path.join(CLAUDE_DIR, 'correction-axial-map.json');
const TRANSCRIPT_ROOT = path.join(CLAUDE_DIR, 'projects');

// Presence of this file in a repo means: never log anything from this repo. Checked
// before any write, so opted-out work is never captured rather than captured and
// redacted. A marker file (not a setting) so a downstream user can create it with
// `touch` and see it in `git status`.
const OPT_OUT_MARKER = path.join('.claude', '.no-correction-log');

// Hard caps on the private layer. Enforced here rather than requested in a prompt,
// because a prompt's user-facing message is not enforcement.
const MAX_PRIVATE_FIELD = 300;
const MAX_OPEN_CODE = 400;

// --- parse args (no dependency on an arg-parsing library) ---
const argv = process.argv.slice(2);
const opts = {
  candidates: false, add: false, heartbeat: false,
  rollup: false, showRollup: false, setAxial: false,
  data: '', since: '', session: '', candidateCount: '', addedCount: ''
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--candidates') opts.candidates = true;
  else if (a === '--add') opts.add = true;
  else if (a === '--heartbeat') opts.heartbeat = true;
  else if (a === '--rollup') opts.rollup = true;
  else if (a === '--show-rollup') opts.showRollup = true;
  else if (a === '--set-axial') opts.setAxial = true;
  else if (a === '--data') opts.data = argv[++i] || '';
  else if (a === '--since') opts.since = argv[++i] || '';
  else if (a === '--session') opts.session = argv[++i] || '';
  else if (a === '--candidate-count') opts.candidateCount = argv[++i] || '';
  else if (a === '--added-count') opts.addedCount = argv[++i] || '';
  else die('unknown argument: ' + a);
}

const modes = ['candidates', 'add', 'heartbeat', 'rollup', 'showRollup', 'setAxial']
  .filter(function (m) { return opts[m]; });
if (modes.length === 0) die('need one of --candidates, --add, --heartbeat, --rollup, --show-rollup, --set-axial');
if (modes.length > 1) die('modes are mutually exclusive, got: ' + modes.join(', '));

const cwd = process.cwd();

// Run a git command from cwd, returning trimmed stdout or null on any failure.
// Mirrors the pattern in session-init.js: argument array (never an interpolated
// string), stderr discarded, and a null return rather than a throw.
function git(args) {
  try {
    return execFileSync('git', args, { cwd: cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) { return null; }
}

// The working copy's root, so a run started from a subdirectory behaves the same
// as one started from the top. Falls back to cwd outside a git checkout.
const repoRoot = git(['rev-parse', '--show-toplevel']) || cwd;

// The MAIN working copy, which is where an opt-out marker lives even when this
// run is inside a linked worktree. `--git-common-dir` points at the main repo's
// .git, so its parent is that working copy. In the main copy it equals repoRoot.
function mainWorktreeRoot() {
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) return repoRoot;
  return path.dirname(common);
}

// Identity. `repo` stays the readable folder name because it is what a human
// reads in a rollup. It is NOT unique: two projects can share a basename, and
// before repo_path existed that collision let one project's heartbeat set
// another's capture window. `repo_path` is the real key; `repo` is the label.
const repoName = path.basename(repoRoot);
const repoPath = repoRoot;

// ==========================================================================
// Shared helpers
// ==========================================================================

// Opt out is checked at the repo root AND at the main working copy's root, not
// at cwd. The marker is untracked by design and `/worktree` does not copy it, so
// a cwd-only check let an opted-out repo produce opted-in worktrees - a privacy
// control failing open, silently, which is the worst way for one to fail.
function optedOut() {
  const roots = [repoRoot, mainWorktreeRoot(), cwd];
  for (let i = 0; i < roots.length; i++) {
    if (roots[i] && fs.existsSync(path.join(roots[i], OPT_OUT_MARKER))) return true;
  }
  return false;
}

// A heartbeat belongs to this project when its recorded path matches. Rows
// written before repo_path existed carry only a name, so they fall back to the
// name comparison rather than being silently dropped from the history.
function isThisRepo(record) {
  if (record.repo_path) return record.repo_path === repoPath;
  return record.repo === repoName;
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // A torn or hand-edited line is skipped rather than fatal: one bad row must
    // not make the whole ledger unreadable.
    try { out.push(JSON.parse(line)); } catch (e) { /* skip */ }
  }
  return out;
}

function appendJsonl(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf-8');
}

function truncate(value, max) {
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max - 3) + '...';
}

// Accept a timestamp only when it really is one, otherwise fall back.
//
// This matters more than it looks. `at` is the one whitelisted field whose value
// comes from outside the script, so without this check it is a free-text channel
// straight through the projection below: the whitelist only holds if every field
// inside it is either derived here or format-validated on write.
function isoOrNull(value) {
  if (typeof value !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.test(value)) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

// THE privacy boundary. Everything downstream of the ledger reads rows through
// this projection, so `produced` and `correction` cannot reach a rollup, a report,
// or anything that gets displayed. Adding a field here is a deliberate act, and
// every field added must be derived in this script or validated on write.
//
// `repo_path` is deliberately NOT here. It is an absolute path on this machine,
// which is exactly the kind of thing that should not travel into a rendered view.
// It exists only to tell two same-named projects apart when filtering heartbeats,
// which is done against raw records, never through this projection.
function shareable(row) {
  return {
    at: row.at,
    repo: row.repo,
    kind: row.kind,
    scope: row.scope,
    stage: row.stage,
    open_code: row.open_code,
    axial_code: row.axial_code == null ? null : row.axial_code
  };
}

// ==========================================================================
// Mode: --candidates (the deterministic pre-filter)
//
// Finds human turns that MIGHT be interventions, so a model only has to read those
// rather than the whole transcript. No judgment happens here; that is the point.
// Structural data comes from a script, not an LLM.
// ==========================================================================

// Claude Code stores transcripts under ~/.claude/projects/<encoded-cwd>/. The
// encoding replaces path separators with hyphens. The second form is a fallback for
// paths containing characters the primary form leaves untouched.
function transcriptDir() {
  const candidates = [
    cwd.replace(/[/\\]/g, '-'),
    cwd.replace(/[^A-Za-z0-9]/g, '-')
  ];
  for (let i = 0; i < candidates.length; i++) {
    const dir = path.join(TRANSCRIPT_ROOT, candidates[i]);
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

// Top-level session transcripts only.
//
// EXCLUDING /subagents/ IS LOAD-BEARING. Subagent transcripts are prompts this
// toolkit wrote to itself, with no human in them, and they outnumber real session
// files roughly eight to one. Including them would fill the ledger with the
// toolkit talking to itself.
function sessionFiles(dir) {
  const out = [];
  (function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (let i = 0; i < entries.length; i++) {
      const p = path.join(d, entries[i].name);
      if (entries[i].isDirectory()) {
        if (entries[i].name === 'subagents') continue; // never descend
        walk(p);
      } else if (entries[i].name.endsWith('.jsonl')) {
        // Defence in depth, tested RELATIVE to the scan root. Testing the whole
        // absolute path would also match a project whose own directory is named
        // something like "subagents-lab", excluding every file and reporting the
        // result as "captured and found nothing" - a silent, permanent zero that
        // is indistinguishable from the honest answer.
        if (path.relative(dir, p).split(path.sep).indexOf('subagents') !== -1) continue;
        out.push(p);
      }
    }
  })(dir);
  return out;
}

// Strip harness-inserted markup so only what the human actually typed is examined.
function humanText(entry) {
  const content = entry.message && entry.message.content;
  let text = null;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    // A tool result is the harness talking, not the human.
    if (content.some(function (c) { return c.type === 'tool_result'; })) return null;
    text = content.filter(function (c) { return c.type === 'text'; })
                  .map(function (c) { return c.text; }).join(' ');
  }
  if (!text) return null;
  const clean = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<command-[a-z]+>[\s\S]*?<\/command-[a-z]+>/g, '')
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, '')
    .trim();
  return clean || null;
}

// A slash command's full prompt text arrives as a user message. It is machine text,
// so it is not a human turn.
function isCommandExpansion(text) {
  return /\*\*Use this when:\*\*/.test(text) || /^ARGUMENTS:/m.test(text);
}

// This filter is NEGATIVE by design: it removes what is definitely not a human
// intervention and keeps everything else. It does not try to guess which turns are
// interventions, because that guess is exactly what fails.
//
// It was originally written the other way round, as a positive match on pushback
// words. Tested against a live session it caught 3 of 5 real interventions and
// missed two questions that challenged the work without containing a single
// pushback word ("should we keep it gitignored?", "how will downstream projects
// absorb this?"). A 40% miss rate, and a missed row is invisible forever because
// nothing downstream can detect a candidate that was never surfaced. A false
// candidate, by contrast, costs a few tokens in one extra read.
//
// So the asymmetry decides the shape: reject only the certain non-humans (machine
// text, bare acknowledgments) and let the extractor judge the rest.
//
// The pushback list below survives as a HINT on each candidate, never as a gate,
// so the extractor can prioritize without the filter deciding anything.
const PUSHBACK = new RegExp([
  "\\bthat'?s not\\b", "\\bthis is not\\b", "\\bnot (correct|right|true|what)\\b",
  '\\bincorrect\\b', '\\bwrong\\b', '\\brevert\\b', '\\bundo\\b',
  '\\bno,', '\\bnope\\b', "\\bi (said|told you|meant)\\b",
  '\\bactually\\b', '\\binstead\\b', "\\bdon'?t\\b", '\\bstop\\b',
  '\\bwhy did you\\b', "\\bshouldn'?t\\b", "\\bisn'?t\\b", "\\baren'?t\\b",
  "\\bdoesn'?t\\b", "\\bdidn'?t\\b", '\\bbut\\b', '\\bhowever\\b',
  '\\bare you sure\\b', "\\bi don'?t think\\b", '\\brather than\\b',
  '\\bprefer\\b', '\\bmissed\\b', '\\bforgot\\b', '\\bagain\\b'
].join('|'), 'i');

// Bare acknowledgments that advance the loop without saying anything about the
// work. A message made only of these words carries no intervention to extract.
const PROCEDURAL = [
  'go', 'ok', 'okay', 'yes', 'yep', 'yeah', 'no', 'nope', 'sure', 'proceed',
  'continue', 'next', 'done', 'approved', 'approve', 'good', 'great', 'perfect',
  'thanks', 'thank', 'you', 'sounds', 'lgtm', 'ship', 'it', 'y', 'n', 'please'
];

function isProcedural(text) {
  // \p{L} rather than a-z: stripping non-ASCII would empty the word list for any
  // message written in a non-Latin script, and the branch below would then call a
  // real correction in Hindi, Japanese or Cyrillic a bare acknowledgment. That is
  // the failure this filter's whole design forbids, not the cheap one it accepts.
  const words = text.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  // Fail OPEN on no recognizable words. A message this long made only of symbols
  // or digits is unusual enough to be worth one extra read, and the asymmetry
  // that governs this whole file says a dropped candidate is the costlier error.
  if (words.length === 0) return false;
  if (words.length > 4) return false;   // long enough to be saying something
  return words.every(function (w) { return PROCEDURAL.indexOf(w) !== -1; });
}

function couldBeIntervention(text) {
  if (text.length < 15) return false;        // too short to carry a point
  if (isCommandExpansion(text)) return false; // machine text, not the human
  if (isProcedural(text)) return false;       // "go", "sounds good", "yes please"
  return true;                                // everything else: let a model judge
}

function assistantText(entry) {
  const content = entry.message && entry.message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(function (c) { return c.type === 'text'; })
                  .map(function (c) { return c.text; }).join(' ');
  }
  return '';
}

function runCandidates() {
  const result = {
    repo: repoName, optedOut: optedOut(), everCaptured: false,
    // `scanned` separates "there was nothing to find" from "there was nothing to
    // look in". Both produce an empty candidate list, and without this field a
    // caller cannot tell them apart, so it records a heartbeat for a scan that
    // never happened and the ledger permanently reports a failed scan as a clean
    // one. A stderr line is not countable; this is.
    scanned: false,
    window: { from: null, to: new Date().toISOString() },
    candidates: []
  };

  if (result.optedOut) {
    // Report it rather than silently returning nothing, so a caller can say why.
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  const dir = transcriptDir();
  if (!dir) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    console.error('correction-ledger.js: no transcript directory for this project; nothing to scan');
    return;
  }
  result.scanned = true;

  // Window. Default is everything since this repo last captured, which is exactly
  // "not yet looked at". With no prior capture, fall back to the CURRENT session
  // only: this is forward-only by design and must not mine the whole backlog.
  const beats = readJsonl(HEARTBEAT_PATH).filter(isThisRepo);
  result.everCaptured = beats.length > 0;
  let files = sessionFiles(dir);
  let since = opts.since || null;
  if (!since && beats.length > 0) since = beats[beats.length - 1].at;
  if (!since) {
    // First run here: newest session file only.
    files = files
      .map(function (f) { return { f: f, m: fs.statSync(f).mtimeMs }; })
      .sort(function (a, b) { return b.m - a.m; })
      .slice(0, 1)
      .map(function (x) { return x.f; });
  }
  result.window.from = since;

  for (let i = 0; i < files.length; i++) {
    let lines;
    try { lines = fs.readFileSync(files[i], 'utf-8').split('\n'); } catch (e) { continue; }
    let lastAssistant = '';
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j].trim();
      if (!line) continue;
      let entry;
      try { entry = JSON.parse(line); } catch (e) { continue; }

      if (entry.type === 'assistant') {
        const t = assistantText(entry);
        if (t) lastAssistant = t;
        continue;
      }
      if (entry.type !== 'user') continue;

      const text = humanText(entry);
      if (!text) continue;
      if (since && entry.timestamp && entry.timestamp < since) continue;
      if (!couldBeIntervention(text)) continue;

      result.candidates.push({
        at: entry.timestamp || null,
        session: entry.sessionId || path.basename(files[i], '.jsonl'),
        // A hint for prioritization, never a gate. See the PUSHBACK comment above.
        has_pushback_marker: PUSHBACK.test(text),
        // Context for the extractor to read. These are NOT the stored row: the row's
        // private fields are short summaries the extractor writes, capped on --add.
        assistant_said: truncate(lastAssistant, 800),
        human_said: truncate(text, 1200)
      });
    }
  }

  result.candidates.sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

// ==========================================================================
// Mode: --add (append accepted rows)
//
// Input is a JSON array of objects on --data, so the fields never have to survive
// shell quoting. `repo`, `repo_path`, `kind` and `axial_code` are derived here and
// a caller cannot influence them. `at` IS taken from the caller when it supplies
// one, because the original exchange's timestamp is more useful than the moment of
// writing, but only after isoOrNull() confirms it is a timestamp. Say this
// accurately: an earlier version of this comment claimed the script stamped `at`
// itself, and a comment that overstates a guarantee is worse than none.
// ==========================================================================

function runAdd() {
  if (!opts.data) die('--add requires --data <file> containing a JSON array of rows');
  if (optedOut()) {
    // Nothing is written. Not a redacted row, not an empty row: nothing.
    console.error('correction-ledger.js: ' + OPT_OUT_MARKER + ' present, wrote nothing for ' + repoName);
    process.stdout.write(JSON.stringify({ added: 0, optedOut: true }) + '\n');
    return;
  }

  let rows;
  try { rows = JSON.parse(fs.readFileSync(opts.data, 'utf-8')); }
  catch (e) { die('could not read --data as JSON: ' + e.message); }
  if (!Array.isArray(rows)) die('--data must contain a JSON array');
  if (rows.length === 0) {
    process.stdout.write(JSON.stringify({ added: 0, optedOut: false }) + '\n');
    return;
  }

  // Validate the WHOLE batch before writing anything, so --add is all-or-nothing.
  // Validating inside the append loop left earlier rows permanently written when a
  // later one failed, and the natural response to the error - fix that row and run
  // again - then re-appended them. Append-only storage has no rollback, so a
  // duplicated row is indistinguishable afterwards from a genuine recurrence, and
  // recurrence count is the single number this whole feature exists to produce.
  for (let i = 0; i < rows.length; i++) {
    if (!(rows[i] || {}).open_code) {
      die('row ' + i + ' has no open_code; the open code is the whole point of a row. Nothing was written.');
    }
  }

  const now = new Date().toISOString();
  let added = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const scope = r.scope === 'toolkit' ? 'toolkit' : 'project';
    appendJsonl(LEDGER_PATH, {
      // Accepted from the caller because the original exchange's timestamp is the
      // more useful one, but only when it really is a timestamp: this field is on
      // the shareable whitelist, so an unvalidated one is a text channel through it.
      at: isoOrNull(r.at) || now,
      repo: repoName,                        // derived, never taken from input
      repo_path: repoPath,                   // derived; the real identity, not shareable
      kind: 'human',                         // one value today; the extension point
      scope: scope,
      stage: truncate(r.stage || 'unknown', 40),
      // PRIVATE LAYER. Capped here so a long pasted block cannot land wholesale.
      produced: truncate(r.produced, MAX_PRIVATE_FIELD),
      correction: truncate(r.correction, MAX_PRIVATE_FIELD),
      // SHAREABLE LAYER.
      open_code: truncate(r.open_code, MAX_OPEN_CODE),
      axial_code: null,                      // assigned later, via the axial map
      session: truncate(r.session || opts.session || '', 64)
    });
    added++;
  }

  // Delete the caller's temp file. It holds both private fields UNtruncated, and
  // its path is chosen by whoever called this rather than fixed here, so it is the
  // one file in this feature that can end up somewhere it should not. Removing it
  // the moment it is no longer needed is cheaper than guarding every place it
  // might land. A failure to unlink is not worth failing the append over.
  try { fs.unlinkSync(opts.data); } catch (e) { /* best effort */ }

  process.stdout.write(JSON.stringify({ added: added, ledger: LEDGER_PATH }) + '\n');
}

// ==========================================================================
// Mode: --heartbeat
//
// Records that capture RAN here, separately from whether it found anything. Without
// this, an empty ledger is ambiguous: a downstream project that never runs
// /document, or whose /document was shadowed by a global command, looks exactly
// like a user who never corrected Claude.
// ==========================================================================

function runHeartbeat() {
  if (optedOut()) {
    process.stdout.write(JSON.stringify({ recorded: false, optedOut: true }) + '\n');
    return;
  }
  appendJsonl(HEARTBEAT_PATH, {
    at: new Date().toISOString(),
    repo: repoName,
    repo_path: repoPath,   // the real key; `repo` alone collides across projects
    session: opts.session || '',
    candidates: Number(opts.candidateCount || 0),
    added: Number(opts.addedCount || 0)
  });
  process.stdout.write(JSON.stringify({ recorded: true, heartbeat: HEARTBEAT_PATH }) + '\n');
}

// ==========================================================================
// Modes: --rollup / --show-rollup
//
// The rollup groups by `kind` FIRST, even though only one kind exists today, so a
// second kind added later cannot be silently pooled into the same ranking. Pooling
// human-labeled and machine-labeled rows would make a count meaningless.
// ==========================================================================

function readAxialMap() {
  if (!fs.existsSync(AXIAL_MAP_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(AXIAL_MAP_PATH, 'utf-8')) || {}; }
  catch (e) { return {}; }
}

function buildRollup() {
  // Rows are projected through shareable() immediately. Nothing below this line can
  // see a private field, which is what makes the privacy guarantee structural.
  const rows = readJsonl(LEDGER_PATH).map(shareable);
  const beats = readJsonl(HEARTBEAT_PATH);
  const axial = readAxialMap();

  // Compute the range; do not assume it. Rows arrive in append order while `at`
  // carries the original exchange's timestamp, and appends from different repos
  // interleave, so first-and-last produced windows that ended before they began.
  const ats = rows.map(function (r) { return r.at; }).filter(Boolean).sort();

  const out = {
    generated_at: new Date().toISOString(),
    rows: rows.length,
    ever_captured: beats.length > 0,
    repos_captured: Array.from(new Set(beats.map(function (b) { return b.repo; }))).sort(),
    window: {
      from: ats.length ? ats[0] : null,
      to: ats.length ? ats[ats.length - 1] : null
    },
    kinds: {}
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const kind = r.kind || 'human';
    // An unlabeled row is counted honestly as unlabeled rather than folded into a
    // neighbouring bucket, so a ranking never borrows confidence it has not earned.
    const label = r.axial_code || axial[r.open_code] || '(unlabeled)';
    if (!out.kinds[kind]) out.kinds[kind] = { total: 0, buckets: {} };
    const k = out.kinds[kind];
    k.total++;
    if (!k.buckets[label]) {
      k.buckets[label] = {
        axial_code: label, count: 0, scope_split: { toolkit: 0, project: 0 },
        repos: [], last_seen: null,
        // The open codes themselves, with how often each occurs. Without these the
        // rollup carried only labels and counts, so axial coding - whose entire
        // job is reading open codes and grouping them - had no data source, and on
        // a first run every label is "(unlabeled)". They are on the shareable
        // whitelist already, so surfacing them costs nothing and stays inside the
        // privacy boundary; `produced` and `correction` remain unreachable.
        open_codes: {}
      };
    }
    const b = k.buckets[label];
    b.count++;
    if (r.scope === 'toolkit') b.scope_split.toolkit++; else b.scope_split.project++;
    if (b.repos.indexOf(r.repo) === -1) b.repos.push(r.repo);
    if (!b.last_seen || String(r.at) > String(b.last_seen)) b.last_seen = r.at;
    if (r.open_code) b.open_codes[r.open_code] = (b.open_codes[r.open_code] || 0) + 1;
  }

  // Buckets become a ranked array per kind, biggest first, and each bucket's open
  // codes become a ranked array too so the most frequent wording leads.
  Object.keys(out.kinds).forEach(function (kind) {
    const k = out.kinds[kind];
    k.buckets = Object.keys(k.buckets)
      .map(function (label) {
        const b = k.buckets[label];
        b.open_codes = Object.keys(b.open_codes)
          .map(function (text) { return { open_code: text, count: b.open_codes[text] }; })
          .sort(function (x, y) { return y.count - x.count; });
        return b;
      })
      .sort(function (a, b) { return b.count - a.count; });
  });

  return out;
}

// An empty result must say WHICH empty it is. "Never captured here" and "captured
// and found nothing" call for completely different actions, and a silent empty body
// would hide the difference.
function emptyStatus(rollup) {
  if (rollup.rows > 0) return null;
  if (!rollup.ever_captured) {
    return {
      empty: true,
      reason: 'never-captured',
      message: 'Capture has never run on this machine. It fires at /document, so this means ' +
               'either /document has not run since this shipped, a global ~/.claude/commands/document.md ' +
               'is shadowing the project copy, or a customized document.md was kept instead of the update.'
    };
  }
  return {
    empty: true,
    reason: 'nothing-found',
    message: 'Capture has run, and found no interventions to record. The ledger is genuinely empty.'
  };
}

function runRollup(writeIt) {
  const rollup = buildRollup();
  const empty = emptyStatus(rollup);
  if (empty) rollup.status = empty;
  if (writeIt) {
    fs.mkdirSync(path.dirname(ROLLUP_PATH), { recursive: true });
    fs.writeFileSync(ROLLUP_PATH, JSON.stringify(rollup, null, 2) + '\n', 'utf-8');
  }
  process.stdout.write(JSON.stringify(rollup, null, 2) + '\n');
}

// ==========================================================================
// Mode: --set-axial (merge open-code to category assignments)
//
// The axial map is a full-file overwrite, so a caller that wrote only its newest
// assignments silently dropped every earlier one and the counts this feature
// exists to produce quietly shrank. Merging in code rather than asking a prompt to
// remember to read first makes that impossible.
//
// It also keeps every write in this feature behind the one Bash permission the
// script already needs. Writing ~/.claude/ directly from a skill would need a
// filesystem permission no install grants, so the write would simply be refused.
// ==========================================================================

function runSetAxial() {
  if (!opts.data) die('--set-axial requires --data <file> containing a JSON object of open_code to category');
  let incoming;
  try { incoming = JSON.parse(fs.readFileSync(opts.data, 'utf-8')); }
  catch (e) { die('could not read --data as JSON: ' + e.message); }
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    die('--data must contain a JSON object mapping open codes to category names');
  }

  const existing = readAxialMap();
  const before = Object.keys(existing).length;
  const merged = Object.assign({}, existing, incoming);   // incoming wins on conflict
  fs.mkdirSync(path.dirname(AXIAL_MAP_PATH), { recursive: true });
  fs.writeFileSync(AXIAL_MAP_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  try { fs.unlinkSync(opts.data); } catch (e) { /* best effort */ }

  process.stdout.write(JSON.stringify({
    existing: before,
    incoming: Object.keys(incoming).length,
    total: Object.keys(merged).length,
    map: AXIAL_MAP_PATH
  }) + '\n');
}

// --- dispatch ---
if (opts.candidates) runCandidates();
else if (opts.add) runAdd();
else if (opts.heartbeat) runHeartbeat();
else if (opts.rollup) runRollup(true);
else if (opts.showRollup) runRollup(false);
else if (opts.setAxial) runSetAxial();
