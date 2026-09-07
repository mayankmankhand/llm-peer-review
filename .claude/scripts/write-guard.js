#!/usr/bin/env node
'use strict';
//
// write-guard.js - the M2 write-guard around a finder subagent (issue #144).
//
// Why this exists:
//   In Claude Code a finder cannot edit: its agent file grants no Edit or Write
//   tool and the harness enforces that. Outside Claude Code the flag is not a
//   guarantee - Codex ignores a read-only role under a writing parent (issue
//   40130) and Cursor's readonly also blocks shell, which two lenses need. A
//   finder that edits applies changes before the M2 audit has judged them,
//   which is the exact bypass the audit exists to prevent. So the guard is
//   toolkit-side: snapshot before the finder runs, revert anything it changed
//   afterwards, and say so, so the orchestrator redispatches once (M2's
//   failed-subagent rule).
//
// Usage (from the project root, around every finder dispatch outside Claude Code):
//   node .claude/scripts/write-guard.js begin <label>
//   ... dispatch the finder, wait for it ...
//   node .claude/scripts/write-guard.js end <label>
//
//   begin  records HEAD and every working-tree change git status shows, and
//          keeps a copy of each changed file, under
//          reports/receipts/write-guard/<label>/ (gitignored with reports/).
//   end    compares the tree with the snapshot, restores every file the
//          finder touched (a changed file gets its snapshot copy back, a new
//          file is deleted, a newly staged path is unstaged), and prints ONE
//          line on stdout:
//            CLEAN                                   nothing changed
//            INVALID: reverted <n> change(s): <paths> the finder wrote; its
//                                                    output is void, redispatch once
//          A moved HEAD (the finder committed) is reported as INVALID too but
//          is never rewound here: undoing a commit is the human's call.
//
// Paths under reports/ and artifacts/ are ignored: receipts and rendered pages
// are exactly what a run is supposed to write there. Files git ignores never
// appear in git status and so are never touched.
//
// Contract: stdout = the one verdict line (end) or nothing (begin); stderr =
// diagnostics. Exit 0 on a verdict, 2 when the guard itself could not run (not
// a git repo, no snapshot for the label). Zero dependencies; git runs through
// execFileSync with argument arrays, never a shell string.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function die(msg) { console.error('write-guard.js: ' + msg); process.exit(2); }
function git(args, opts) {
  return execFileSync('git', args, Object.assign({ stdio: ['ignore', 'pipe', 'pipe'] }, opts || {})).toString();
}

const [mode, label] = process.argv.slice(2);
if (!['begin', 'end'].includes(mode) || !label || !/^[A-Za-z0-9._-]+$/.test(label)) {
  die('usage: write-guard.js begin|end <label>   (label: letters, digits, dot, dash, underscore)');
}

let ROOT;
try { ROOT = git(['rev-parse', '--show-toplevel']).trim(); } catch (e) { die('not inside a git repository'); }
const STATE_DIR = path.join(ROOT, 'reports', 'receipts', 'write-guard', label);
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const COPY_DIR = path.join(STATE_DIR, 'content');
const IGNORED_PREFIXES = ['reports/', 'artifacts/'];

function head() { try { return git(['rev-parse', 'HEAD'], { cwd: ROOT }).trim(); } catch (e) { return ''; } }
function sha(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return 'absent';
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
// Every path git status reports, with its working-tree hash. Renames and
// copies carry two NUL-separated paths in -z output; both are recorded.
function changes() {
  const out = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: ROOT });
  const parts = out.split('\0');
  const result = {};
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const xy = entry.slice(0, 2), rel = entry.slice(3);
    const paths = [rel];
    if (xy[0] === 'R' || xy[0] === 'C') { i++; if (parts[i]) paths.push(parts[i]); }
    for (const p of paths) {
      if (IGNORED_PREFIXES.some(pre => p.startsWith(pre))) continue;
      result[p] = { xy, hash: sha(p) };
    }
  }
  return result;
}
function tracked(rel) {
  try { git(['ls-files', '--error-unmatch', '--', rel], { cwd: ROOT }); return true; } catch (e) { return false; }
}
function staged(rel) {
  try { return git(['diff', '--cached', '--name-only', '--', rel], { cwd: ROOT }).trim() !== ''; } catch (e) { return false; }
}

if (mode === 'begin') {
  const snap = { head: head(), files: changes() };
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  fs.mkdirSync(COPY_DIR, { recursive: true });
  for (const rel of Object.keys(snap.files)) {
    if (snap.files[rel].hash === 'absent') continue;
    const dest = path.join(COPY_DIR, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dest);
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(snap, null, 2) + '\n');
  console.error('write-guard: begin ' + label + ' (' + Object.keys(snap.files).length + ' pre-existing change(s) recorded)');
  process.exit(0);
}

// mode === 'end'
if (!fs.existsSync(STATE_FILE)) die('no snapshot for label ' + label + '; run begin first');
const snap = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
const now = changes();
const reverted = [];
function restoreFromSnapshot(rel) {
  const copy = path.join(COPY_DIR, rel);
  const target = path.join(ROOT, rel);
  if (snap.files[rel].hash === 'absent') { if (fs.existsSync(target)) fs.rmSync(target, { force: true }); return; }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(copy, target);
}
for (const rel of Object.keys(now)) {
  const before = snap.files[rel];
  if (before && before.hash === now[rel].hash) continue;
  if (staged(rel)) { try { git(['reset', '-q', 'HEAD', '--', rel], { cwd: ROOT }); } catch (e) { /* new file with no HEAD version: unstage below */ try { git(['rm', '-q', '--cached', '--', rel], { cwd: ROOT }); } catch (e2) {} } }
  if (before) restoreFromSnapshot(rel);
  else if (tracked(rel)) git(['checkout', 'HEAD', '--', rel], { cwd: ROOT });
  else fs.rmSync(path.join(ROOT, rel), { recursive: true, force: true });
  reverted.push(rel);
}
for (const rel of Object.keys(snap.files)) {
  if (now[rel]) continue;                       // still changed the same way, handled above
  if (sha(rel) === snap.files[rel].hash) continue; // unchanged since the snapshot after all
  restoreFromSnapshot(rel);
  reverted.push(rel);
}
const headMoved = snap.head && head() !== snap.head;
if (headMoved) console.error('write-guard: HEAD moved from ' + snap.head.slice(0, 7) + ' to ' + head().slice(0, 7) + ' while the finder ran; commits are never rewound here');
if (reverted.length || headMoved) {
  console.log('INVALID: reverted ' + reverted.length + ' change(s)' + (reverted.length ? ': ' + reverted.sort().join(', ') : '') + (headMoved ? ' (and HEAD moved)' : ''));
} else {
  console.log('CLEAN');
}
