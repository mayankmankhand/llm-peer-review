#!/usr/bin/env node
'use strict';
// session-start.js - the plugin's SessionStart hook (issue #174). Two jobs:
//
//   1. Link. Point ${CLAUDE_PLUGIN_DATA}/current at the running plugin root, so
//      a stable path on this machine always reaches the installed plugin's
//      files (the toolkit-reference fragment is opened through it).
//   2. Version guard. Compare the running plugin version with the version the
//      project recorded in .claude/.toolkit-state.json and tell the user when
//      they differ, plus when the old copy-install still sits beside the plugin.
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
// but setup-project.js writes the state at the top level.
//
// Exit code: always 0. A hook that fails must never block or disturb a session,
// so every error is swallowed (at most one short stderr line).
//
// Dependency-free, like every script under .claude/scripts/.

const fs = require('fs');
const path = require('path');

const STATE_REL = path.join('.claude', '.toolkit-state.json');
const MANIFEST_REL = path.join('.claude', '.toolkit-manifest.json');
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

// The nearest `rel` from startDir upward, or null. The walk stops at the first
// folder holding .git (a folder, or a file in a worktree or submodule), so a
// state file belonging to an enclosing project is never read, or at the
// filesystem root outside any repository.
function findUp(startDir, rel) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, rel);
    if (fs.existsSync(candidate)) return candidate;
    if (fs.existsSync(path.join(dir, '.git'))) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// The plain-text notices for this project, or [] when nothing applies. Both
// versions are validated before use, so neither can carry text of its own.
function notices(projectDir, runningRaw) {
  const out = [];
  const statePath = findUp(projectDir, STATE_REL);
  const state = statePath === null ? null : readJson(statePath);
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
  if (findUp(projectDir, MANIFEST_REL) !== null) {
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

module.exports = { validVersion, parseVersion, compareVersions, referenceVersion, findUp, linkCurrent, notices };
