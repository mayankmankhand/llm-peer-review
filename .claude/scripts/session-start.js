#!/usr/bin/env node
'use strict';
// session-start.js - the plugin's SessionStart hook (issue #174). Two jobs:
//
//   1. Link. Point ${CLAUDE_PLUGIN_DATA}/current at the running plugin root, so
//      a stable path on this machine always reaches the installed plugin's
//      files (the toolkit-reference fragment is opened through it).
//   2. Version guard. Compare the running plugin version with the version the
//      project recorded in .claude/.toolkit-state.json and tell the user when
//      they differ, plus when the old copy-install still sits beside the plugin:
//      its manifest, or (with no state file yet) VERSION beside
//      .claude/commands/review.md or the old installer's rules-file stamp, the
//      same markers setup-project.js migrates by (see copyInstallMarkers).
//
//   node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.js"
//
// Inputs: Claude Code passes a JSON object on stdin whose `source` is startup,
// resume, clear or compact. Warnings are printed for every source except
// compact (a compaction is not a new session, and repeating the notice there is
// noise); the link is made for every source. The project is CLAUDE_PROJECT_DIR,
// else the working folder.
//
// Output: hook stdout goes into Claude's context, not in front of the user, so
// every notice opens with an instruction to relay it in plain words. Silent when
// nothing applies.
//
// The recorded-version rule matches pre-push-check.js, which blocks a push when
// the running plugin is OLDER than the project's reference, and setup-project.js,
// which writes the state. The version helpers are duplicated in both on purpose:
// the pre-push check is also copied into non-plugin installs, which would not
// carry a shared module. Only a validated version is ever printed (see the
// helpers), because this output lands in Claude's context.
//
// The state file is looked for from the project folder upward to the git top
// level: Claude opened in a subfolder sets CLAUDE_PROJECT_DIR to that subfolder,
// but setup-project.js writes the state at the top level. The walk never reaches
// the home directory (its .claude is Claude Code's own config folder), and an
// unusable state file on the way is skipped (see walkUp and readStateUp).
//
// Exit code: always 0. A hook that fails must never block or disturb a session,
// so every error is swallowed (at most one short stderr line).
//
// Dependency-free, like every script under .claude/scripts/.

const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_REL = path.join('.claude', '.toolkit-state.json');
const STDIN_TIMEOUT_MS = 1000;

function note(msg) {
  try { process.stderr.write('session-start: ' + msg + '\n'); } catch (e) { /* nothing left to do */ }
}

function readJson(abs) {
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { return null; }
}

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
// >>> copy-install markers (7.1.0) >>>
// Byte-identical in setup-project.js and session-start.js, from this marker to
// the closing one (it uses the version helpers above);
// scripts/test-session-start.js fails when the copies drift.
//
// The files an old copy-install left in one folder, each something a project of
// its own would not have by accident:
//   manifest     .claude/.toolkit-manifest.json, written by installers from v5.5.0;
//   versionFile  VERSION beside .claude/commands/review.md (setup.sh copied
//                VERSION into projects from v4.0, setup.ps1 only from v5.1);
//   stamp        a .claude/rules/toolkit.md carrying the managed-file comment
//                the installers wrote into it: `<!-- Toolkit version: X |
//                Managed by LLM Peer Review` from v1.4, or before that `<!-- This
//                file is managed by the LLM Peer Review toolkit.` This is how an
//                install from before VERSION was copied into projects is
//                recognized. It needs no review.md beside it: the toolkit
//                shipped no review.md command for part of that era (removed in
//                v2, back in v3.5), and the comment alone is the toolkit's own.
// A stamp naming 7.0.0 or later is no marker, and it also cancels versionFile:
// /tk:setup seeds that same file stamped with the plugin version, and the
// toolkit's own repository carries it beside its own VERSION and review.md,
// while every installer that wrote a 7.x stamp also wrote a manifest, which
// stays a marker. A project with its own review.md and no marker has none.
// Only the presence of VERSION is read here, never its content, and a marker
// says nothing about whose VERSION it is (setup-project.js's versionFileOwner
// decides that for a migration).
// Returns { manifest, versionFile, stamp }, stamp null or { version } where
// version is validated (null when the stamp names no usable version).
const COPY_STAMP = /<!-- Toolkit version: ([^|\r\n]*)\| Managed by LLM Peer Review/;
const COPY_STAMP_EARLY = /<!-- This file is managed by the LLM Peer Review toolkit\./;
const COPY_STAMP_READ_BYTES = 4096;
function copyInstallMarkers(dir) {
  const isFile = (rel) => { try { return fs.statSync(path.join(dir, rel)).isFile(); } catch (e) { return false; } };
  const found = { manifest: isFile(path.join('.claude', '.toolkit-manifest.json')), versionFile: false, stamp: null };
  let pluginStamp = false;
  const rules = path.join('.claude', 'rules', 'toolkit.md');
  if (isFile(rules)) {
    let head = null;
    try {
      const fd = fs.openSync(path.join(dir, rules), 'r');
      try {
        const buf = Buffer.alloc(COPY_STAMP_READ_BYTES);
        head = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0));
      } finally { fs.closeSync(fd); }
    } catch (e) { head = null; }
    const m = head === null ? null : COPY_STAMP.exec(head);
    if (m) {
      const v = validVersion(m[1]);
      if (v !== null && compareVersions(v, '7.0.0') !== -1) pluginStamp = true;
      else found.stamp = { version: v };
    } else if (head !== null && COPY_STAMP_EARLY.test(head)) {
      found.stamp = { version: null };
    }
  }
  found.versionFile = !pluginStamp && isFile(path.join('.claude', 'commands', 'review.md')) && isFile('VERSION');
  return found;
}
// <<< copy-install markers <<<

// Make `<dataDir>/current` point at target. Factored with the platform and fs
// injected so the Windows branch is testable anywhere. win32 uses a junction
// (no symlink privilege needed) and cannot rename over one, so it removes the
// old link first; POSIX builds a temp link beside the old one and renames it
// over, so `current` is never missing.
//
// A real folder (or file) at `current` is a stale copy, not user content: the
// data folder belongs to the plugin and only this hook makes `current`, but the
// 7.0.x hook ran `ln -sfn`, which Git Bash on Windows turns into a plain copy.
// Left in place, that copy would serve the old plugin's files forever. So it is
// moved aside, the link is made, and only then is the copy deleted; if the link
// cannot be made the copy is moved back. Returns true when the link is in place.
function linkCurrent(dataDir, target, platform, fsImpl) {
  const f = fsImpl || fs;
  const link = path.join(dataDir, 'current');
  f.mkdirSync(dataDir, { recursive: true });
  let existing = null;
  try { existing = f.lstatSync(link); } catch (e) { existing = null; }
  let aside = null;
  if (existing && !existing.isSymbolicLink()) {
    aside = link + '.stale-' + process.pid + '-' + Date.now();
    f.renameSync(link, aside);
    existing = null;
  }
  if (existing) {
    let current = null;
    try { current = f.readlinkSync(link); } catch (e) { current = null; }
    if (current !== null && path.resolve(dataDir, current) === path.resolve(target)) return true;
  }
  try {
    if (platform === 'win32') {
      if (existing) f.unlinkSync(link);
      f.symlinkSync(target, link, 'junction');
    } else {
      const tmp = link + '.tmp-' + process.pid + '-' + Date.now();
      try {
        f.symlinkSync(target, tmp, 'dir');
        f.renameSync(tmp, link);
      } catch (e) {
        try { f.unlinkSync(tmp); } catch (e2) { /* the temp link was never made */ }
        throw e;
      }
    }
  } catch (e) {
    if (aside) { try { f.renameSync(aside, link); } catch (e2) { /* the copy stays aside; the next session retries */ } }
    throw e;
  }
  if (aside) {
    try { f.rmSync(aside, { recursive: true, force: true }); } catch (e) { note('replaced the old copy at ' + link + ' but could not delete it from ' + aside); }
  }
  return true;
}

// A path's spellings to compare: as given and its real path, case-folded on
// Windows. Both sides of the home comparison use them, so a home directory or a
// project reached through a symlink (process.cwd() is already resolved) still
// matches.
function pathForms(p) {
  const forms = [path.resolve(p)];
  try { forms.push(fs.realpathSync(p)); } catch (e) { /* a missing folder has no real path */ }
  return process.platform === 'win32' ? forms.map(f => f.toLowerCase()) : forms;
}
function homeDirs() {
  let home = '';
  try { home = os.homedir(); } catch (e) { home = ''; }
  return home ? pathForms(home) : [];
}
const isHome = (dir, home) => pathForms(dir).some(f => home.indexOf(f) !== -1);

// Visit startDir and each folder above it, nearest first, until visit returns
// something other than null (that value is returned) or the walk ends (null).
// The walk ends:
//   - before the home directory, which is never a project root: its .claude is
//     the user's Claude Code config folder, so a project outside any repository
//     must never read state from there;
//   - after the first folder holding .git (a folder, or a file in a worktree or
//     submodule), so a state file belonging to an enclosing project is never read;
//   - at the filesystem root.
function walkUp(startDir, visit) {
  const home = homeDirs();
  let dir = path.resolve(startDir);
  for (;;) {
    if (isHome(dir, home)) return null;
    const found = visit(dir);
    if (found !== null) return found;
    if (fs.existsSync(path.join(dir, '.git'))) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// The nearest existing `rel` from startDir upward, or null.
function findUp(startDir, rel) {
  return walkUp(startDir, (dir) => {
    const candidate = path.join(dir, rel);
    return fs.existsSync(candidate) ? candidate : null;
  });
}

// The nearest usable state object from startDir upward, or null. A candidate
// that cannot be used as state at all (unreadable, a folder, not JSON, or JSON
// that is not an object) is skipped and the walk goes on, so a stray broken file
// in a subfolder never silences the top-level state. A parseable object is used
// even when its version keys are malformed: that yields no reference, exactly
// as referenceVersion refuses to fall through to a later key, so a crafted stamp
// can never hand the choice to a state file further up.
function readStateUp(startDir) {
  return walkUp(startDir, (dir) => {
    const state = readJson(path.join(dir, STATE_REL));
    return state !== null && typeof state === 'object' && !Array.isArray(state) ? state : null;
  });
}

// Whether the old copy-install still sits in this project: the nearest folder
// from startDir upward with any copy-install marker (see copyInstallMarkers,
// shared with setup-project.js) has a manifest, or has VERSION beside
// .claude/commands/review.md or the old rules stamp while no state file was
// found. The last two are exactly the shapes /tk:setup migrates without a
// manifest, and a state file means setup already ran there (a plugin project's
// seeded rules file carries a 7.x stamp, which is no marker and cancels the
// VERSION one, so its own review.md and VERSION stay silent either way; so does
// the toolkit's own repository). A manifest notifies with or without state.
function copyInstallBeside(startDir, state) {
  const found = walkUp(startDir, (dir) => {
    const m = copyInstallMarkers(dir);
    return m.manifest || m.versionFile || m.stamp !== null ? m : null;
  });
  return found !== null && (found.manifest || state === null);
}

// The plain-text notices for this project, or [] when nothing applies. Both
// versions are validated before use, so neither can carry text of its own.
function notices(projectDir, runningRaw) {
  const out = [];
  const state = readStateUp(projectDir);
  const reference = referenceVersion(state);
  const running = validVersion(runningRaw);
  const cmp = reference === null || running === null ? null : compareVersions(running, reference);
  if (cmp === -1) {
    out.push('Toolkit version notice - tell the user this in plain words at the start of your reply: '
      + 'this project was last set up or audited with toolkit ' + reference + ', but this session runs the tk plugin '
      + running + ', which is older. Pushes from this project will be blocked by the pre-push check until the plugin '
      + 'is updated: run `claude plugin update tk@llm-peer-review`, then restart Claude Code.');
  } else if (cmp === 1) {
    out.push('Toolkit version notice - tell the user this in plain words at the start of your reply: '
      + 'this project was set up or audited with toolkit ' + reference + ', and this session runs the tk plugin '
      + running + ', which is newer. Run /tk:upgrade in this project so its own files are checked against the newer '
      + 'conventions.');
  }
  if (copyInstallBeside(projectDir, state)) {
    out.push('Toolkit install notice - tell the user this in plain words at the start of your reply: '
      + 'the old copy-install of the toolkit is still in this project beside the tk plugin, so both /review and '
      + '/tk:review exist and it is easy to run the stale one. Run /tk:setup to migrate the project onto the plugin.');
  }
  return out;
}

// Read the hook's JSON from stdin, never waiting on a terminal and never longer
// than the timeout, then hand back the `source` (null when unknown).
function readSource(done) {
  if (process.stdin.isTTY) { done(null); return; }
  let buf = '';
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    try { process.stdin.removeAllListeners(); process.stdin.destroy(); } catch (e) { /* already closed */ }
    let source = null;
    try { const input = JSON.parse(buf); if (input && typeof input.source === 'string') source = input.source; } catch (e) { source = null; }
    done(source);
  };
  const timer = setTimeout(finish, STDIN_TIMEOUT_MS);
  try {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { buf += chunk; });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  } catch (e) {
    finish();
  }
}

function main() {
  process.on('uncaughtException', (e) => { note(String(e && e.message || e)); process.exitCode = 0; });
  const pluginRoot = path.join(__dirname, '..');
  const meta = readJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'));
  // No plugin.json: this is the repository's source copy or a non-plugin run.
  if (!meta || typeof meta.version !== 'string') return;
  const running = meta.version;

  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  if (dataDir) {
    try { linkCurrent(dataDir, pluginRoot, process.platform); } catch (e) { note('could not link ' + path.join(dataDir, 'current') + ': ' + e.message); }
  }

  readSource((source) => {
    if (source === 'compact') return;
    try {
      const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
      const lines = notices(projectDir, running);
      if (lines.length) process.stdout.write(lines.join('\n\n') + '\n');
    } catch (e) {
      note(e.message);
    }
    process.exitCode = 0;
  });
}

if (require.main === module) {
  try { main(); } catch (e) { note(e.message); process.exitCode = 0; }
}

module.exports = { validVersion, parseVersion, compareVersions, referenceVersion, copyInstallMarkers, copyInstallBeside, findUp, readStateUp, linkCurrent, notices };
