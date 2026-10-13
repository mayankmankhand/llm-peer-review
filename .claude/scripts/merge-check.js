#!/usr/bin/env node
'use strict';
// merge-check.js - the lost-work checks behind /merge (issue #232, rule M16).
//
// Several worktree branches open at once are each blind to what lands on main
// after they were cut. A conflict fix made while landing one of them can drop
// work it never saw, or drop its own work, and a squash or a rebase hides the
// fix from history. This script decides both from git alone, so the verdict is
// the machine's and the plain line it prints is the evidence:
//
//   rule 1  a line another landing added to main after this branch's cut point,
//           which this landing removes. The branch never saw that line, so
//           removing it is an accident of conflict fixing, or a choice someone
//           has to state.
//   rule 2  a line this branch itself added that does not make it into the
//           landing. Copies are counted per file: against git's own merge of
//           main and the branch (`git merge-tree`) where the file merges
//           cleanly, so a line both sides added identically (which git keeps
//           once) is not flagged; by main's copies plus the branch's minus the
//           common ancestor's where it conflicts, so a dropped `}` is caught
//           even when another `}` is still there.
//   cut     the branch's cut point is not on main: it was cut from another
//           branch, so landing it would land that branch's commits too.
//
// The cut point is the commit the branch was cut from. It is RECORDED when the
// branch is made or named (--record-cut), never worked out at landing time:
// once a branch has been updated from main, or rebased, git's merge-base has
// moved past every line the branch never saw, and rule 1 would see nothing.
// That is measured, not assumed: in the #232 replays merge-base missed every
// loss after a squash or a rebase. The rules this file implements (the lookup
// order, what counts as a landing, the PR and commit-message formats, where a
// changelog block goes) are written down once, in
// .claude/skills/shared/merge-rules.md.
//
// Modes, exactly one per call:
//   --record-cut [<branch>]       record branch.<name>.tkCut when it is absent
//                                 (from the branch log, else merge-base) and print it
//   --cut <branch> [--pr <N> | --pr-body <file>]
//                                 the branch's cut point and where it came from
//   --pr <N>                      read PR <N> through gh or glab; print its parts
//   --pr-body <file|->            print the parts of a PR body (raw text, or the
//                                 JSON gh or glab prints)
//   --landing --before <sha> --after <sha> --cut <sha> --tip <sha> [--kept <file>]
//                                 rules 1, 2 and cut for one landing: main before
//                                 it, the result (main after it, or the updated
//                                 branch about to land), the cut point, and the
//                                 branch's own tip before any update from main
//   --since <ref>                 the same checks for every landing on main's
//                                 first-parent line after <ref>
//   --decisions --cut <sha> --tip <sha> --out <file> [--pr <N> | --pr-body <file>]
//                                 write the file the decision-checker agent reads:
//                                 this PR's decisions, then each landing's after the cut
//   --style [local-merge|host-merge|host-squash]
//                                 the repo's landing habit; with a value, record it
//   --changelog-place <changelog> <block>
//                                 the line number a changelog block goes before
//   --marker | --mark <sha>       read or write the last checked landing
// Common: --main <ref> names the default branch (otherwise the remote's default
// branch, else `main`, else `master`).
//
// Output: one JSON object on stdout; on stderr one plain line per flag and a
// summary line. Exit 0 when nothing is flagged, 1 when anything is, 2 on a
// usage or git error (one line on stderr). Only --record-cut, --mark and
// --style with a value write to git config, and only --decisions writes a file,
// the one --out names. Every git call
// takes an argument list, never a shell string, and runs at the repository's
// top level. Dependency-free.
//
//   node merge-check.js --landing --before <sha> --after <sha> --cut <sha> --tip <sha>

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_BUFFER = 64 * 1024 * 1024;
const CUT_LINE_RE = /^Cut from:[ \t]*([0-9a-f]{7,40})\b/m;
const KEPT_LINE_RE = /^Kept on purpose: ([0-9a-f]{7,40}) (.+?): (.*)$/;
const MARKER_RE = /^(?:<{7}|>{7}|\|{7})(?: |$)|^={7}$/;
const HOST_COMMITTER = 'noreply@github.com';   // GitHub's web-flow committer on button merges
const STYLE_SCAN = 50;                          // first-parent commits read to learn the habit
const USAGE = 'usage: node merge-check.js --record-cut [<branch>] | --cut <branch> [--pr <N> | --pr-body <file>] | --pr <N> | --pr-body <file|-> | --landing --before <sha> --after <sha> --cut <sha> --tip <sha> [--kept <file>] | --since <ref> | --decisions --cut <sha> --tip <sha> --out <file> [--pr <N> | --pr-body <file>] | --style [local-merge|host-merge|host-squash] | --changelog-place <changelog> <block> | --marker | --mark <sha>  [--main <ref>]';

class UsageError extends Error {}

// ---- git -------------------------------------------------------------------
let TOP = null;   // the repository's top level; every git call runs there

function run(cmd, args) {
  return spawnSync(cmd, args, { cwd: TOP || process.cwd(), encoding: 'utf8', maxBuffer: MAX_BUFFER });
}
function git(args) {
  const r = run('git', args);
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('git ' + args[0] + ' failed: ' + String(r.stderr || '').trim().split('\n')[0]);
  return r.stdout;
}
function gitOk(args) { return run('git', args).status === 0; }
function gitTry(args) { const r = run('git', args); return r.status === 0 ? r.stdout : null; }

// A commit a ref names, as a full sha; null when it names none. A ref that
// starts with "-" is refused so it can never be read as an option.
function resolveCommit(ref) {
  if (typeof ref !== 'string' || !ref || ref.startsWith('-')) return null;
  const out = gitTry(['rev-parse', '--verify', '--quiet', ref + '^{commit}']);
  return out ? out.trim() : null;
}

const ancestorCache = new Map();
function isAncestor(a, b) {
  const key = a + ' ' + b;
  if (!ancestorCache.has(key)) ancestorCache.set(key, a === b || gitOk(['merge-base', '--is-ancestor', a, b]));
  return ancestorCache.get(key);
}

// The default branch: --main when given; else the remote's default branch, as
// the local branch when one exists (this repo's local main runs ahead of the
// remote until a release); else `main`, else `master`.
function defaultMain(given) {
  if (given !== undefined) {
    if (!resolveCommit(given)) throw new UsageError('--main ' + given + ' does not name a commit');
    return given;
  }
  const head = gitTry(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (head) {
    const remoteRef = head.trim();
    const local = remoteRef.replace(/^[^/]+\//, '');
    if (gitOk(['show-ref', '--verify', '--quiet', 'refs/heads/' + local])) return local;
    return remoteRef;
  }
  for (const b of ['main', 'master']) if (gitOk(['show-ref', '--verify', '--quiet', 'refs/heads/' + b])) return b;
  throw new UsageError('cannot tell the default branch: pass --main <ref>');
}

// ---- files and lines ---------------------------------------------------------
// The paths a project declares as generated (.claude/toolkit/generated.json):
// rules 1 and 2 skip them, because a landing rebuilds them instead of merging.
function generatedPaths(notes) {
  const file = path.join(TOP, '.claude', 'toolkit', 'generated.json');
  if (!fs.existsSync(file)) return [];
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { notes.push('.claude/toolkit/generated.json is not valid JSON, so no path is treated as generated'); return []; }
  if (!Array.isArray(data)) { notes.push('.claude/toolkit/generated.json is not a JSON array, so no path is treated as generated'); return []; }
  const out = [];
  for (const entry of data) {
    if (!entry || !Array.isArray(entry.paths)) { notes.push('an entry in .claude/toolkit/generated.json has no "paths" list and was skipped'); continue; }
    // A leading ":" would be git pathspec magic, not a path: refused.
    for (const p of entry.paths) if (typeof p === 'string' && p.trim() && !p.trim().startsWith(':')) out.push(p.trim());
  }
  return out;
}
function excludeSpecs(paths) { return paths.map((p) => ':(exclude)' + p); }

// Files that differ between two commits, as repository paths (NUL-separated,
// so a name with spaces or quotes arrives intact). A submodule pointer (mode
// 160000 on either side) is left out: it names a commit, not lines, so neither
// rule has text to read there and git blame on it fails.
function changedFiles(a, b, excl) {
  const raw = git(['diff', '--raw', '-z', '--no-renames', '--no-ext-diff', a, b, '--', '.'].concat(excl)).split('\0');
  const files = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const modes = raw[i].replace(/^:/, '').split(' ');
    if (modes[0] !== '160000' && modes[1] !== '160000') files.push(raw[i + 1]);
  }
  return files;
}

// The hunk headers of a zero-context diff of one file. Only `@@ -` lines are
// headers: every content line starts with a space, +, - or a backslash.
function hunks(a, b, file) {
  const out = git(['diff', '-U0', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', a, b, '--', ':(literal)' + file]);
  const list = [];
  for (const line of out.split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) list.push({ oldStart: +m[1], oldCount: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newCount: m[4] === undefined ? 1 : +m[4] });
  }
  return list;
}

// Who wrote each line of a range: porcelain blame, where a content line always
// starts with a tab and a header line with the 40-hex sha.
function blame(rev, file, start, count) {
  const out = git(['blame', '--porcelain', '-L', start + ',+' + count, rev, '--', file]);
  const rows = [];
  let sha = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('\t')) { rows.push({ sha, text: line.slice(1) }); continue; }
    const m = /^([0-9a-f]{40}) \d+ \d+/.exec(line);
    if (m) sha = m[1];
  }
  return rows;
}

const fileCache = new Map();
function fileLines(rev, file) {
  const key = rev + ':' + file;
  if (!fileCache.has(key)) {
    const out = gitTry(['cat-file', '-p', rev + ':' + file]);
    fileCache.set(key, out === null ? [] : out.split('\n'));
  }
  return fileCache.get(key);
}

// A line is compared without its trailing whitespace (so CRLF and LF agree);
// whitespace-only lines are never flagged.
function keyText(s) { return String(s).replace(/\s+$/, ''); }
function counts(lines, skipMarkers) {
  const m = new Map();
  for (const l of lines) {
    const t = keyText(l);
    if (!t.trim() || (skipMarkers && MARKER_RE.test(t))) continue;
    m.set(t, (m.get(t) || 0) + 1);
  }
  return m;
}

// ---- kept on purpose -----------------------------------------------------------
// "Kept on purpose: <sha of the commit that added the line> <file>: <line text>"
// in any commit message on main's first-parent line (the landing's own message,
// a later landing's, or an empty commit that only records acceptances), or in
// a --kept file. Keyed on the commit that wrote the line, the file and the
// text, so a same-text line another commit wrote stays flagged.
function parseKept(text) {
  const recs = [];
  for (const raw of String(text).split('\n')) {
    const m = KEPT_LINE_RE.exec(raw.replace(/\r$/, ''));
    if (m) recs.push({ sha: m[1], file: m[2], text: keyText(m[3]).trim() });
  }
  return recs;
}
function makeKept(mainRef, keptFile) {
  let recs = null;
  return function () {
    if (recs === null) {
      recs = parseKept(gitTry(['log', '--first-parent', '--format=%B', mainRef]) || '');
      if (keptFile) recs = recs.concat(parseKept(fs.readFileSync(keptFile, 'utf8')));
    }
    return recs;
  };
}
function isKept(recs, sha, file, text) {
  const t = keyText(text).trim();
  return recs.some((r) => sha.startsWith(r.sha) && r.file === file && r.text === t);
}

// ---- attribution ---------------------------------------------------------------
function describe(sha) {
  const s = gitTry(['log', '-1', '--format=%h %s', sha]);
  return s ? s.trim() : sha.slice(0, 7);
}
// The landing on main that brought a commit in: the first first-parent commit
// after the cut that contains it, described by its short sha and subject.
function makeAttributor(cut, before) {
  let list = null;
  const cache = new Map();
  return function (sha) {
    if (cache.has(sha)) return cache.get(sha);
    if (list === null) list = (gitTry(['rev-list', '--first-parent', '--reverse', before, '^' + cut]) || '').split('\n').filter(Boolean);
    const found = list.find((c) => isAncestor(sha, c));
    const label = describe(found || sha);
    cache.set(sha, label);
    return label;
  };
}

// ---- the rules -------------------------------------------------------------------
function keepLine(f) { return 'Kept on purpose: ' + f.addedBy.slice(0, 7) + ' ' + f.file + ': ' + f.line; }

// Rule 1: each line the landing removes from main, blamed where it stood; flag
// it when the commit that wrote it is not reachable from the cut point.
function ruleOne(c, excl, kept) {
  const flags = [];
  let suppressed = 0;
  const attribute = makeAttributor(c.cut, c.before);
  for (const f of changedFiles(c.before, c.after, excl)) {
    for (const h of hunks(c.before, c.after, f)) {
      if (h.oldCount === 0) continue;
      for (const row of blame(c.before, f, h.oldStart, h.oldCount)) {
        const text = keyText(row.text);
        if (!text.trim() || !row.sha || isAncestor(row.sha, c.cut)) continue;
        if (isKept(kept(), row.sha, f, text)) { suppressed++; continue; }
        const flag = { rule: 1, file: f, line: text.trim(), addedBy: row.sha, addedIn: attribute(row.sha) };
        flag.keep = keepLine(flag);
        flags.push(flag);
      }
    }
  }
  return { flags, suppressed };
}

// git's own merge of two commits, without touching any working tree: the
// merged tree and the set of files it could not merge cleanly. null when this
// git has no `merge-tree --write-tree` (it needs git 2.38). With -z the output
// is the tree id, then one `<mode> <id> <stage>\t<path>` entry per side of each
// conflicted file, NUL-separated, so a path arrives intact.
function autoMerge(a, b) {
  const r = run('git', ['merge-tree', '--write-tree', '-z', '--no-messages', a, b]);
  if (r.error || (r.status !== 0 && r.status !== 1)) return null;
  const parts = String(r.stdout || '').split('\0');
  if (!/^[0-9a-f]{40,64}$/.test(parts[0] || '')) return null;
  const conflicted = new Set();
  for (const p of parts.slice(1)) {
    const m = /^\d{6} [0-9a-f]{40,64} \d\t([\s\S]+)$/.exec(p);
    if (m) conflicted.add(m[1]);
  }
  return { tree: parts[0], conflicted };
}

// Rule 2: each line the branch added since it last met main (the merge-base of
// main and its own tip) must be in the result as many times as a faithful
// merge keeps it; a shortfall, capped at the branch's own copies, is flagged.
// The expectation per file: where git merged the file cleanly, git's own result
// (which keeps a line both sides added identically once); where it conflicted,
// main's copies plus the branch's minus the common ancestor's, because git's
// conflict hunks can slide a shared line such as `}` out of both sides and its
// keep-both text then holds one copy for two blocks.
function ruleTwo(c, excl, kept, notes) {
  const flags = [];
  let suppressed = 0;
  const mbOut = gitTry(['merge-base', c.before, c.tip]);
  if (!mbOut) { notes.push('rule 2: main and the branch share no history, so its own lines were not checked'); return { flags, suppressed }; }
  const base = mbOut.trim();
  const auto = autoMerge(c.before, c.tip);
  if (!auto) notes.push('rule 2: this git has no merge-tree --write-tree (git 2.38 or newer), so every file is counted by formula; a line both sides added identically can show as a flag');
  for (const f of changedFiles(base, c.tip, excl)) {
    const tipLines = fileLines(c.tip, f);
    const added = new Map();   // text -> { count, firstLine }
    for (const h of hunks(base, c.tip, f)) {
      for (let n = h.newStart; n < h.newStart + h.newCount; n++) {
        const t = keyText(tipLines[n - 1] || '');
        if (!t.trim()) continue;
        const e = added.get(t) || { count: 0, firstLine: n };
        e.count++;
        added.set(t, e);
      }
    }
    if (!added.size) continue;
    const after = counts(fileLines(c.after, f), false);
    let expected;
    if (auto && !auto.conflicted.has(f)) expected = counts(fileLines(auto.tree, f), true);
    else {
      const tip = counts(tipLines, false), before = counts(fileLines(c.before, f), false), mb = counts(fileLines(base, f), false);
      expected = new Map();
      for (const t of added.keys()) expected.set(t, (tip.get(t) || 0) + (before.get(t) || 0) - (mb.get(t) || 0));
    }
    for (const [t, e] of added) {
      const missing = Math.min(e.count, (expected.get(t) || 0) - (after.get(t) || 0));
      if (missing <= 0) continue;
      const by = (blame(c.tip, f, e.firstLine, 1)[0] || {}).sha || c.tip;
      if (isKept(kept(), by, f, t)) { suppressed++; continue; }
      const flag = { rule: 2, file: f, line: t.trim(), addedBy: by, missing };
      flag.keep = keepLine(flag);
      flags.push(flag);
    }
  }
  return { flags, suppressed };
}

function cutFlag(cut, before, mainRef) {
  return { rule: 'cut', cut, message: 'the cut ' + cut.slice(0, 7) + ' is not on ' + mainRef + ': this branch was cut from another branch, so landing it would also land that branch\'s commits' };
}

function checkLanding(c, mainRef, excl, kept, notes) {
  const flags = [];
  if (!isAncestor(c.cut, c.before)) flags.push(cutFlag(c.cut, c.before, mainRef));
  const one = ruleOne(c, excl, kept);
  const two = c.tip ? ruleTwo(c, excl, kept, notes) : { flags: [], suppressed: 0 };
  return { flags: flags.concat(one.flags, two.flags), suppressed: one.suppressed + two.suppressed };
}

// ---- landings on main ------------------------------------------------------------
// A first-parent commit on main is a landing when it has two parents, or carries
// a `Cut from:` line (a squash /merge made), or is a GitHub button commit (the
// web-flow committer: a `(#N)` subject is a squash, anything else part of a
// rebase). Everything else is a direct commit, which saw all of main.
function landingKind(sha) {
  const [parents, ce, subject, body] = git(['log', '-1', '--format=%P%x00%ce%x00%s%x00%B', sha]).split('\0');
  const np = String(parents).trim().split(/\s+/).filter(Boolean).length;
  const cut = CUT_LINE_RE.exec(body || '');
  const s = String(subject || '').trim();
  if (np >= 2) return { kind: 'merge', cut: cut ? cut[1] : null, subject: s };
  if (cut) return { kind: 'squash', cut: cut[1], subject: s };
  if (String(ce || '').trim().toLowerCase() === HOST_COMMITTER) return { kind: /\(#\d+\)$/.test(s) ? 'host-squash' : 'host-rebase', cut: null, subject: s };
  return { kind: 'direct', cut: null, subject: s };
}
function prNumber(subject) {
  const m = /(?:Merge pull request #|Merge PR #|Merge MR !|\(#)(\d+)/.exec(subject || '');
  return m ? Number(m[1]) : null;
}

function since(ref, mainRef, excl, kept, notes) {
  const from = resolveCommit(ref);
  if (!from) throw new UsageError('--since ' + ref + ' does not name a commit');
  const list = (gitTry(['rev-list', '--first-parent', '--reverse', mainRef, '^' + from]) || '').split('\n').filter(Boolean);
  const landings = [];
  let direct = 0, suppressed = 0;
  for (const L of list) {
    const k = landingKind(L);
    if (k.kind === 'direct') { direct++; continue; }
    const parents = git(['rev-list', '--parents', '-n', '1', L]).trim().split(/\s+/).slice(1);
    const entry = { commit: L, subject: k.subject, kind: k.kind, pr: prNumber(k.subject), cut: null, cutSource: null, weaker: false, rule1: 'checked', rule2: 'checked', flags: [] };
    if (k.cut) { entry.cut = resolveCommit(k.cut); entry.cutSource = 'landing message'; if (!entry.cut) entry.rule1 = 'not checkable: the landing names a cut this repository does not have'; }
    else if (k.kind === 'merge') { entry.cut = git(['merge-base', parents[0], parents[1]]).trim(); entry.cutSource = 'merge-base'; entry.weaker = true; }
    else entry.rule1 = 'not checkable: no recorded cut (read the PR body\'s Cut from: line and rerun with --landing)';
    const tip = k.kind === 'merge' ? parents[1] : null;
    if (!tip) entry.rule2 = 'not checkable: a squash or rebase keeps no branch tip';
    if (entry.cut) {
      const r = checkLanding({ before: parents[0], after: L, cut: entry.cut, tip }, mainRef, excl, kept, notes);
      entry.flags = r.flags;
      suppressed += r.suppressed;
    }
    landings.push(entry);
  }
  return { landings, directCommits: direct, suppressed };
}

// ---- the cut point ---------------------------------------------------------------
function branchExists(b) { return gitOk(['show-ref', '--verify', '--quiet', 'refs/heads/' + b]); }
function checkBranch(b) {
  if (!b || b.startsWith('-') || !gitOk(['check-ref-format', '--branch', b])) throw new UsageError('not a branch name: ' + b);
  if (!branchExists(b)) throw new UsageError('no local branch named ' + b);
}
function currentBranch() {
  const out = gitTry(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!out) throw new UsageError('HEAD is detached: name the branch');
  return out.trim();
}
// The branch log's oldest entry, when it is the branch's creation from a local
// ref or commit. A branch created from a remote-tracking ref is a fetched copy
// of someone's branch, not a cut, so it does not count.
function branchLogCut(b) {
  const out = gitTry(['reflog', 'show', '--format=%H%x00%gs', 'refs/heads/' + b]);
  if (!out) return null;
  const rows = out.split('\n').filter(Boolean);
  if (!rows.length) return null;
  const [sha, subject] = rows[rows.length - 1].split('\0');
  const m = /^branch: Created from (.+)$/.exec(String(subject || '').trim());
  if (!m) return null;
  const remotes = (gitTry(['remote']) || '').split('\n').filter(Boolean);
  if (remotes.some((r) => m[1].startsWith(r + '/'))) return null;
  return resolveCommit(sha);
}
function recordedCut(b) {
  const out = gitTry(['config', '--get', 'branch.' + b + '.tkCut']);
  return out ? resolveCommit(out.trim()) : null;
}
function cutFor(b, mainRef, body) {
  checkBranch(b);
  const rec = recordedCut(b);
  if (rec) return { branch: b, cut: rec, source: 'recorded', weaker: false };
  if (body && body.cutFrom) {
    const c = resolveCommit(body.cutFrom);
    if (c) return { branch: b, cut: c, source: 'pr-body', weaker: false };
  }
  const log = branchLogCut(b);
  if (log) return { branch: b, cut: log, source: 'branch-log', weaker: false };
  const mb = gitTry(['merge-base', mainRef, 'refs/heads/' + b]);
  if (mb) return { branch: b, cut: mb.trim(), source: 'merge-base', weaker: true };
  return { branch: b, cut: null, source: 'none', weaker: true };
}
function recordCut(b, mainRef) {
  checkBranch(b);
  const rec = recordedCut(b);
  if (rec) return { branch: b, cut: rec, source: 'recorded', written: false };
  const log = branchLogCut(b);
  const mb = log ? null : gitTry(['merge-base', mainRef, 'refs/heads/' + b]);
  const cut = log || (mb ? mb.trim() : null);
  if (!cut) throw new Error('no cut point found for ' + b + ': it shares no history with ' + mainRef);
  git(['config', 'branch.' + b + '.tkCut', cut]);
  return { branch: b, cut, source: log ? 'branch-log' : 'merge-base', written: true };
}

// ---- PR bodies -------------------------------------------------------------------
// The parts /document writes (merge-rules.md): a `## Decisions` section, a
// `## Changelog` section holding the block in a fence, and a `Cut from:` line.
function parseBody(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let decisions = null, changelog = null;
  const di = lines.findIndex((l) => /^##\s+Decisions\s*$/.test(l));
  if (di >= 0) {
    const out = [];
    // The part ends at the next heading, or at the Cut from: line when no
    // Changelog part sits between them.
    for (let i = di + 1; i < lines.length && !/^##\s/.test(lines[i]) && !/^Cut from:/.test(lines[i]); i++) out.push(lines[i]);
    decisions = out.join('\n').trim() || null;
  }
  const ci = lines.findIndex((l) => /^##\s+Changelog\s*$/.test(l));
  if (ci >= 0) {
    let i = ci + 1;
    while (i < lines.length && !lines[i].trim()) i++;
    const fm = /^(`{3,}|~{3,})/.exec(lines[i] || '');
    if (fm) {
      const close = new RegExp('^\\' + fm[1][0] + '{' + fm[1].length + ',}\\s*$');
      const out = [];
      for (i += 1; i < lines.length && !close.test(lines[i]); i++) out.push(lines[i]);
      changelog = out.join('\n').replace(/\s+$/, '') || null;
    }
  }
  const cm = CUT_LINE_RE.exec(lines.join('\n'));
  return { decisions, changelog, cutFrom: cm ? cm[1] : null };
}
// What /merge does for each part a PR body lacks (merge-rules.md, "The PR body
// parts"): a PR opened before the parts existed still lands, through these.
function missingParts(p, notes) {
  if (!p.cutFrom) notes.push('no Cut from: line: /merge takes the cut from the branch\'s own record, else its branch log, else the merge-base, which is a weaker check');
  if (!p.decisions) notes.push('no ## Decisions part: the decision check reads what this PR decides from its text and its changes');
  if (!p.changelog) notes.push('no ## Changelog part: a changelog edit of its own keeps both sides on a conflict');
  return p;
}
function readBodyArg(arg) {
  const raw = arg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(arg, 'utf8');
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object') {
      if (typeof j.body === 'string') return j.body;
      if (typeof j.description === 'string') return j.description;
    }
  } catch (e) { /* not JSON: a raw body */ }
  return raw;
}
function onPath(cmd) {
  return String(process.env.PATH || '').split(path.delimiter).some((d) => {
    try { fs.accessSync(path.join(d, cmd), fs.constants.X_OK); return true; } catch (e) { return false; }
  });
}
// The host CLI, chosen the way .claude/skills/shared/host-cli.md says: the
// origin remote's host by substring, else the one CLI that is installed.
function hostCli() {
  const url = String(gitTry(['config', '--get', 'remote.origin.url']) || '');
  if (url.includes('github.com')) return 'gh';
  if (url.includes('gitlab.com')) return 'glab';
  const have = ['gh', 'glab'].filter(onPath);
  if (have.length === 1) return have[0];
  throw new UsageError(have.length ? 'both gh and glab are installed and the remote names neither host: pass --pr-body' : 'neither gh nor glab is installed: pass --pr-body');
}
function readPr(n) {
  if (!/^\d+$/.test(String(n))) throw new UsageError('--pr takes a PR number');
  const cli = hostCli();
  const args = cli === 'gh'
    ? ['pr', 'view', String(n), '--json', 'number,title,body,headRefName,headRefOid,state']
    : ['mr', 'view', String(n), '--output', 'json'];
  const r = run(cli, args);
  if (r.error || r.status !== 0) throw new Error(cli + ' could not read #' + n + ': ' + String(r.stderr || r.error || '').trim().split('\n')[0]);
  const j = JSON.parse(r.stdout);
  const pr = cli === 'gh'
    ? { number: j.number, title: j.title, state: j.state, branch: j.headRefName, head: j.headRefOid, body: j.body || '' }
    : { number: j.iid, title: j.title, state: j.state, branch: j.source_branch, head: j.sha, body: j.description || '' };
  return Object.assign(pr, parseBody(pr.body), { host: cli });
}

// ---- style, changelog, marker -----------------------------------------------------
// The landing styles /merge offers (merge-rules.md, "The marker and the style"):
// a merge commit made on this machine, the host's merge button, or the host's
// squash. A rebase habit lands as a squash, because a rebase leaves no landing
// commit to carry the record.
const STYLES = ['local-merge', 'host-merge', 'host-squash'];
// GitLab's merge button writes this line into the merge commit's message.
const GITLAB_MERGE_RE = /^See merge request \S+!\d+\s*$/m;
function styleOf(sha) {
  const k = landingKind(sha);
  if (k.kind === 'direct') return null;
  if (k.kind === 'host-rebase') return 'rebase';
  if (k.kind !== 'merge') return 'host-squash';
  const [ce, body] = git(['log', '-1', '--format=%ce%x00%B', sha]).split('\0');
  return String(ce || '').trim().toLowerCase() === HOST_COMMITTER || GITLAB_MERGE_RE.test(body || '') ? 'host-merge' : 'local-merge';
}
function style(mainRef, value) {
  if (value !== undefined) {
    if (!STYLES.includes(value)) throw new UsageError('--style records ' + STYLES.join(', ') + ' or nothing');
    git(['config', 'tk.mergeStyle', value]);
    return { style: value, source: 'recorded', written: true };
  }
  const rec = String(gitTry(['config', '--get', 'tk.mergeStyle']) || '').trim();
  if (STYLES.includes(rec)) return { style: rec, source: 'recorded' };
  const list = (gitTry(['rev-list', '--first-parent', '-n', String(STYLE_SCAN), mainRef]) || '').split('\n').filter(Boolean);
  const n = { 'local-merge': 0, 'host-merge': 0, 'host-squash': 0, rebase: 0 };
  for (const c of list) { const k = styleOf(c); if (k) n[k]++; }
  const squashes = n['host-squash'] + n.rebase;
  const max = Math.max(n['local-merge'], n['host-merge'], squashes);
  const s = max === 0 ? 'unknown' : n['local-merge'] === max ? 'local-merge' : n['host-merge'] === max ? 'host-merge' : 'host-squash';
  return { style: s, source: 'history', counts: n, scanned: list.length };
}

// Where a changelog block goes (merge-rules.md): a block that opens with its
// own `## ` heading goes directly above the file's first `## ` section, so the
// newest entry is on top and never inside a released version; a block of bare
// entries goes directly below an `## Unreleased` heading; with neither anchor,
// after the title and the blank lines under it.
function changelogPlace(clFile, blockFile) {
  const lines = fs.readFileSync(clFile, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const block = fs.readFileSync(blockFile, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const first = block.find((l) => l.trim()) || '';
  const isSection = (l) => /^##\s/.test(l);
  if (isSection(first)) {
    const i = lines.findIndex(isSection);
    if (i >= 0) return { line: i + 1, rule: 'above the first section' };
  } else {
    const u = lines.findIndex((l) => /^##\s+\[?unreleased\b/i.test(l));
    if (u >= 0) return { line: u + 2, rule: 'below the Unreleased heading' };
  }
  const t = lines.findIndex((l) => /^#\s/.test(l));
  let at = t >= 0 ? t + 1 : 0;
  while (at < lines.length && !lines[at].trim()) at++;
  return { line: at + 1, rule: 'after the title' };
}

// ---- the decisions file (rule 3) ---------------------------------------------------
// The one file the decision-checker agent reads (merge-rules.md, "The decisions
// file"): a `## This PR` part, then a `## Landing <short sha>: <subject>` part for
// each landing on main after the cut, oldest first. A part holds its decision
// list; one with none (a PR from before the lists existed, a list that says
// `None recorded`, a landing whose message has no `Decisions:` lines) holds its
// text and its changes instead, generated paths left out, cut at DIFF_LINES lines.
const DIFF_LINES = 150;
function listed(lines) {
  const out = lines.filter((l) => /^\s*[-*]\s+\S/.test(l)).map((l) => l.trim());
  if (!out.length || (out.length === 1 && /^[-*]\s+None recorded\.?$/i.test(out[0]))) return null;
  return out;
}
function messageDecisions(message) {
  const lines = String(message || '').replace(/\r\n/g, '\n').split('\n');
  const i = lines.findIndex((l) => /^Decisions:\s*$/.test(l));
  if (i < 0) return null;
  let j = i + 1;
  while (j < lines.length && /^\s*[-*]\s+\S/.test(lines[j])) j++;
  return listed(lines.slice(i + 1, j));
}
// A diff in a fence longer than any backtick run inside it.
function changesOf(a, b, excl) {
  const out = git(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-U1', a, b, '--', '.'].concat(excl)).replace(/\n$/, '');
  if (!out) return '(no changes outside generated paths)';
  const lines = out.split('\n');
  const shown = lines.length > DIFF_LINES ? lines.slice(0, DIFF_LINES).concat('... (' + (lines.length - DIFF_LINES) + ' more lines left out)') : lines;
  const fence = '`'.repeat(Math.max(3, ...(out.match(/`+/g) || []).map((r) => r.length + 1)));
  return fence + 'diff\n' + shown.join('\n') + '\n' + fence;
}
// A PR body file as --pr-body takes it (raw text, or gh's or glab's JSON), with its title when the JSON has one.
function readPrArg(arg) {
  const raw = arg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(arg, 'utf8');
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object') return { title: typeof j.title === 'string' ? j.title : null, body: typeof j.body === 'string' ? j.body : typeof j.description === 'string' ? j.description : '' };
  } catch (e) { /* not JSON: a raw body */ }
  return { title: null, body: raw };
}
function decisionsFile(o, mainRef, excl) {
  const c = {};
  for (const k of ['cut', 'tip']) {
    if (o['--' + k] === undefined) throw new UsageError('--decisions needs --' + k);
    c[k] = resolveCommit(o['--' + k]);
    if (!c[k]) throw new UsageError('--' + k + ' ' + o['--' + k] + ' does not name a commit');
  }
  if (!o['--out']) throw new UsageError('--decisions needs --out <file>');
  const pr = o['--pr'] ? readPr(o['--pr']) : o['--pr-body'] ? readPrArg(o['--pr-body']) : { title: null, body: '' };
  const own = listed(String(parseBody(pr.body).decisions || '').split('\n'));
  const name = o['--pr'] ? 'PR #' + pr.number + ': ' + pr.title : (pr.title || 'The branch at ' + c.tip.slice(0, 7));
  const out = ['## This PR', '', name, ''];
  if (own) out.push(...own);
  else {
    out.push('No decision list: read what it decides from its text and its changes.', '');
    if (pr.body && pr.body.trim()) out.push(pr.body.trim(), '');
    out.push(changesOf(git(['merge-base', mainRef, c.tip]).trim(), c.tip, excl));
  }
  const landings = [];
  for (const L of (gitTry(['rev-list', '--first-parent', '--reverse', mainRef, '^' + c.cut]) || '').split('\n').filter(Boolean)) {
    const k = landingKind(L);
    if (k.kind === 'direct') continue;
    const d = messageDecisions(git(['log', '-1', '--format=%B', L]));
    out.push('', '## Landing ' + L.slice(0, 7) + ': ' + k.subject, '');
    if (d) out.push(...d);
    else out.push('No decision list: read what it decided from its changes.', '', changesOf(L + '^1', L, excl));
    landings.push({ commit: L, subject: k.subject, decisions: d ? d.length : 0 });
  }
  const file = path.resolve(o['--out']);
  fs.writeFileSync(file, out.join('\n') + '\n');
  return { file, cut: c.cut, tip: c.tip, thisPr: own ? 'decisions' : 'text and changes', landings };
}

// ---- output ------------------------------------------------------------------------
// A flag from --since carries `landing` (its short sha and subject), so each
// line says which landing dropped it when several are checked at once.
function plainLine(f) {
  const at = f.landing ? 'landing ' + f.landing + ': ' : '';
  if (f.rule === 'cut') return at + 'cut: ' + f.message;
  if (f.rule === 1) return at + f.file + ': "' + f.line + '" was added by ' + f.addedIn + ' after this branch was cut, and this landing removes it';
  return at + f.file + ': "' + f.line + '" is this branch\'s own line (' + f.addedBy.slice(0, 7) + ')' + (f.missing > 1 ? ', ' + f.missing + ' copies,' : '') + ' and it does not make it into the landing';
}
function finish(result, flags, suppressed, notes) {
  result.flagged = flags.length;
  result.keptOnPurpose = suppressed;
  result.notes = notes;
  process.stdout.write(JSON.stringify(result) + '\n');
  for (const f of flags) process.stderr.write(plainLine(f) + '\n');
  for (const n of notes) process.stderr.write('note: ' + n + '\n');
  const byRule = { 1: 0, 2: 0, cut: 0 };
  for (const f of flags) byRule[f.rule]++;
  process.stderr.write(flags.length
    ? 'merge-check: ' + flags.length + ' flagged (rule 1: ' + byRule[1] + ', rule 2: ' + byRule[2] + ', cut: ' + byRule.cut + ')' + (suppressed ? ', ' + suppressed + ' kept on purpose' : '') + '\n'
    : 'merge-check: clean' + (suppressed ? ' (' + suppressed + ' kept on purpose)' : '') + '\n');
  return flags.length ? 1 : 0;
}

// ---- arguments ---------------------------------------------------------------------
const VALUE_FLAGS = new Set(['--before', '--after', '--cut', '--tip', '--kept', '--since', '--main', '--pr', '--pr-body', '--mark', '--out']);
const OPTIONAL_VALUE_FLAGS = new Set(['--record-cut', '--style']);
const BARE_FLAGS = new Set(['--landing', '--marker', '--decisions']);
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (Object.prototype.hasOwnProperty.call(o, a)) throw new UsageError('given twice: ' + a);
    if (VALUE_FLAGS.has(a)) {
      if (i + 1 >= argv.length || (argv[i + 1].startsWith('--') && argv[i + 1] !== '-')) throw new UsageError('missing value for ' + a);
      o[a] = argv[++i];
    } else if (OPTIONAL_VALUE_FLAGS.has(a)) {
      o[a] = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
    } else if (a === '--changelog-place') {
      if (i + 2 >= argv.length) throw new UsageError('--changelog-place takes a changelog file and a block file');
      o[a] = [argv[++i], argv[++i]];
    } else if (BARE_FLAGS.has(a)) o[a] = true;
    else throw new UsageError('unknown argument: ' + a);
  }
  return o;
}

function main(argv) {
  const o = parseArgs(argv);
  const top = gitTry(['rev-parse', '--show-toplevel']);
  if (!top) throw new UsageError('not inside a git repository');
  TOP = top.trim();
  const notes = [];
  if (o['--changelog-place']) {
    const [cl, block] = o['--changelog-place'];
    return finish(Object.assign({ mode: 'changelog-place' }, changelogPlace(path.resolve(cl), path.resolve(block))), [], 0, notes);
  }
  if (o['--pr-body'] && !o['--cut'] && !o['--decisions']) return finish(Object.assign({ mode: 'pr-body' }, missingParts(parseBody(readBodyArg(o['--pr-body'])), notes)), [], 0, notes);
  if (o['--pr'] && !o['--cut'] && !o['--decisions']) return finish(Object.assign({ mode: 'pr' }, missingParts(readPr(o['--pr']), notes)), [], 0, notes);
  if (o['--marker']) {
    const v = gitTry(['config', '--get', 'tk.landingChecked']);
    return finish({ mode: 'marker', marker: v ? v.trim() : null }, [], 0, notes);
  }
  if (o['--mark']) {
    const sha = resolveCommit(o['--mark']);
    if (!sha) throw new UsageError('--mark ' + o['--mark'] + ' does not name a commit');
    git(['config', 'tk.landingChecked', sha]);
    return finish({ mode: 'mark', marker: sha, written: true }, [], 0, notes);
  }
  const mainRef = defaultMain(o['--main']);
  if (o['--record-cut']) {
    const b = o['--record-cut'] === true ? currentBranch() : o['--record-cut'];
    return finish(Object.assign({ mode: 'record-cut', main: mainRef }, recordCut(b, mainRef)), [], 0, notes);
  }
  if (o['--style']) return finish(Object.assign({ mode: 'style', main: mainRef }, style(mainRef, o['--style'] === true ? undefined : o['--style'])), [], 0, notes);
  const excl = excludeSpecs(generatedPaths(notes));
  const kept = makeKept(mainRef, o['--kept']);
  if (o['--landing']) {
    const c = {};
    for (const k of ['before', 'after', 'cut', 'tip']) {
      if (o['--' + k] === undefined) throw new UsageError('--landing needs --' + k);
      c[k] = resolveCommit(o['--' + k]);
      if (!c[k]) throw new UsageError('--' + k + ' ' + o['--' + k] + ' does not name a commit');
    }
    const r = checkLanding(c, mainRef, excl, kept, notes);
    if (!changedFiles(c.before, c.after, excl).length) notes.push('the landing changes nothing on ' + mainRef + ' outside generated paths and submodule pointers');
    return finish({ mode: 'landing', main: mainRef, before: c.before, after: c.after, cut: c.cut, tip: c.tip, flags: r.flags }, r.flags, r.suppressed, notes);
  }
  if (o['--since']) {
    const r = since(o['--since'], mainRef, excl, kept, notes);
    const flags = [].concat.apply([], r.landings.map((l) => l.flags.map((f) => Object.assign({ landing: l.commit.slice(0, 7) + ' (' + l.subject + ')' }, f))));
    const notCheckable = r.landings.filter((l) => l.rule1 !== 'checked').length;
    if (notCheckable) notes.push(notCheckable + ' landing(s) could not be checked for rule 1; see each landing\'s rule1 field');
    return finish({ mode: 'since', main: mainRef, since: resolveCommit(o['--since']), landings: r.landings, directCommits: r.directCommits }, flags, r.suppressed, notes);
  }
  if (o['--decisions']) {
    const r = decisionsFile(o, mainRef, excl);
    if (!r.landings.length) notes.push('no landing reached ' + mainRef + ' after the cut, so there is nothing to contradict');
    return finish(Object.assign({ mode: 'decisions', main: mainRef }, r), [], 0, notes);
  }
  if (o['--cut']) {
    let body = null;
    if (o['--pr-body']) body = parseBody(readBodyArg(o['--pr-body']));
    else if (o['--pr']) body = readPr(o['--pr']);
    const r = cutFor(o['--cut'], mainRef, body);
    r.onMain = r.cut ? isAncestor(r.cut, resolveCommit(mainRef)) : false;
    return finish(Object.assign({ mode: 'cut', main: mainRef }, r), [], 0, notes);
  }
  throw new UsageError('no mode given');
}

if (require.main === module) {
  let code;
  try { code = main(process.argv.slice(2)); }
  catch (e) {
    process.stderr.write('merge-check: ' + (e && e.message ? e.message : String(e)) + '\n');
    if (e instanceof UsageError) process.stderr.write(USAGE + '\n');
    code = 2;
  }
  process.exitCode = code;
}

module.exports = { parseBody, parseKept, changelogPlace, keyText };
