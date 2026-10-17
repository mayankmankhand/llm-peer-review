#!/usr/bin/env node
'use strict';
// fix-scan.js - maintainer scan of a review's FIXED verdicts (issue #252, item 2).
//
// A review's Digest says FIXED, and nothing checked that the fix touched what
// the finding cited: one FIXED was closed by a plan note while the cited script
// never changed (2026-10-03-194128 R11). This scan reads a review report, takes
// every FIXED line of its Digest, finds the finding's cited `path:line`, and
// labels it from the fix diff:
//   hunk touched                  a change lies within 3 lines of the cited
//                                 lines (git's default context), or the cited
//                                 file was deleted
//   file touched, hunk untouched  the cited file changed, but not there
//   file untouched                the cited file did not change at all
//   file absent                   the cited file was not in the reviewed tree
//   unknown                       nothing to compare: a file untracked when
//                                 the review began, a file git ignores (a
//                                 plan, a report), or a binary file
// plus the line label from locusLabel in .claude/scripts/merge-findings.js
// (untouched, rewritten, removed, unknown). It also counts how many recheck
// rows in the receipts folder's results.json sit beside their original, the
// pairing #252 item 1 made possible (run-checks.js keeps every run's rows).
//
// The fix diff comes from, in order:
//   1. --diff <patch> (repeatable: a review fixed in rounds; each file is
//      labeled on its own and the strongest label wins, so a cited line any
//      round touched is touched)
//   2. the newest verify-r<n>-diff.patch in the receipts folder (written by
//      merge-findings.js --shards --tier verify; each round's diff runs from the
//      review's starting point, so the newest holds the others)
//   3. --to <commit>: git diff from the scope's base to that commit
// With none of them, the report is listed as skipped with the reason; a diff
// is never guessed. The base (the reviewed tree) is the receipts folder's
// scope.json `uncommitted.baseline` when it was taken without a
// `baselineError`, else `range.end`; with no scope.json, the cited file is
// assumed to have been in the reviewed tree.
//
// A finding's cited locus is the first backticked token on the line, outside
// the Digest, that starts with its bold R-ID (`- **R6** [plan] ... \`path:line\``),
// the rule the #242 citation replay used. The receipts folder is --receipts,
// else the first reports/receipts/<stamp> folder the report names.
//
//   node scripts/fix-scan.js <report.md>... [--receipts <dir>] [--diff <patch>]... [--to <commit>] [--json]
//
// --json prints one JSON object per report, one per line; without it, one
// readable line per FIXED and one rechecks line per report. Read-only: it
// writes nothing. Exit 0, or 1 on a usage error (nothing on stdout).
// Maintainer-only: lives in scripts/, never in the plugin.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { locusLabel } = require('../.claude/scripts/merge-findings.js');
const { parseDigest } = require('./quality-check.js');

const USAGE = 'usage: node scripts/fix-scan.js <report.md>... [--receipts <dir>] [--diff <patch>]... [--to <commit>] [--json]';
function usage(msg) {
  process.stderr.write('fix-scan: ' + msg + '\n' + USAGE + '\n');
  process.exit(1);
}

function git(root, args) {
  const r = spawnSync('git', ['-C', root].concat(args), { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return r.error ? { status: -1, stdout: '' } : { status: r.status, stdout: r.stdout || '' };
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// Each FIXED R-ID's cited locus: { path, line } or null when the finding line
// names none. The Digest section itself is skipped, since its lines start with
// the plain R-ID and quote checks in backticks.
function citedLoci(md) {
  const loci = {};
  let inDigest = false;
  let level = 0;
  for (const line of String(md).split(/\r?\n/)) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      if (/^digest\b/i.test(h[2].replace(/[*_`]/g, '').trim())) { inDigest = true; level = h[1].length; continue; }
      if (inDigest && h[1].length <= level) inDigest = false;
    }
    if (inDigest) continue;
    const m = /^\s*(?:[-*]\s+)?(?:#{1,6}\s+)?\*\*R(\d+)\*\*/.exec(line);
    if (!m || loci['R' + m[1]] !== undefined) continue;
    const tick = /`([^`]+)`/.exec(line.slice(m[0].length));
    if (!tick) { loci['R' + m[1]] = null; continue; }
    const t = tick[1].trim();
    const at = /^(.+?):(\d+(?:\s*[-–]\s*\d+)?)$/.exec(t);
    if (at) loci['R' + m[1]] = { path: at[1], line: at[2].replace(/\s+/g, '') };
    else if (/[/.]/.test(t) && !/\s/.test(t)) loci['R' + m[1]] = { path: t, line: null };
    else loci['R' + m[1]] = null;
  }
  return loci;
}

// The receipts folder: the one given, else the first reports/receipts/<stamp>
// the report names that exists.
function receiptsFor(md, given, root) {
  if (given) return path.resolve(given);
  for (const m of String(md).matchAll(/reports\/receipts\/([A-Za-z0-9._-]+)/g)) {
    const dir = path.join(root, 'reports', 'receipts', m[1]);
    try { if (fs.statSync(dir).isDirectory()) return dir; } catch (e) { /* next */ }
  }
  return null;
}

// The newest verify-r<n>-diff.patch in a receipts folder, or null.
function newestVerifyDiff(dir) {
  if (!dir) return null;
  let best = null;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return null; }
  for (const name of names) {
    const m = /^verify-r(\d+)-diff\.patch$/.exec(name);
    if (m && (!best || Number(m[1]) > best.round)) best = { round: Number(m[1]), file: path.join(dir, name) };
  }
  return best ? best.file : null;
}

// Recheck rows paired with their original. Only a top-level results.json can
// pair: a recheck row in a subfolder's results.json, or one whose id has no
// <lens>-<n> prefix, is counted as unpairable.
const RECHECK = /recheck/i;
const PREFIX = /^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*-\d+)-recheck/i;
function rechecks(dir) {
  const out = { paired: 0, unpaired: 0, unpairable: 0 };
  if (!dir) return out;
  const rowsOf = (file) => { const r = readJson(file); return r && Array.isArray(r.checks) ? r.checks.filter((c) => c && typeof c.id === 'string') : []; };
  const top = rowsOf(path.join(dir, 'results.json'));
  const ids = new Set(top.map((c) => c.id));
  for (const c of top) {
    if (!RECHECK.test(c.id)) continue;
    const m = PREFIX.exec(c.id);
    if (!m) out.unpairable++;
    else if (ids.has(m[1])) out.paired++;
    else out.unpaired++;
  }
  const walk = (d, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const sub = path.join(d, e.name);
      out.unpairable += rowsOf(path.join(sub, 'results.json')).filter((c) => RECHECK.test(c.id)).length;
      if (depth < 3) walk(sub, depth + 1);
    }
  };
  walk(dir, 0);
  return out;
}

// The four hunk labels, from locusLabel's file and line labels.
// The cited hunk is the cited lines plus git's 3 lines of context (locusLabel's
// `near`), so a fix a line beside an imprecise citation is not flagged.
function hunkLabel(l) {
  if (l.file === 'absent' || l.file === 'new') return 'file absent';
  if (l.file === 'untracked' || l.file === 'ignored' || l.line === 'unknown') return 'unknown';
  if (l.file === 'deleted' || l.line === 'rewritten' || l.line === 'removed' || l.near > 0) return 'hunk touched';
  if (l.file === 'changed') return 'file touched, hunk untouched';
  return 'file untouched';
}
const STRENGTH = ['file untouched', 'file touched, hunk untouched', 'hunk touched'];
const LINE_STRENGTH = ['untouched', 'removed', 'rewritten'];
// Of several labels (one per --diff file), the one that touched the most.
function strongest(labels) {
  return labels.reduce((best, l) => {
    if (!best) return l;
    const a = STRENGTH.indexOf(hunkLabel(best));
    const b = STRENGTH.indexOf(hunkLabel(l));
    if (b !== a) return b > a ? l : best;
    return LINE_STRENGTH.indexOf(l.line) > LINE_STRENGTH.indexOf(best.line) ? l : best;
  }, null);
}

function scanReport(file, opts, root) {
  const md = fs.readFileSync(file, 'utf8');
  const receipts = receiptsFor(md, opts.receipts, root);
  const scope = receipts ? readJson(path.join(receipts, 'scope.json')) : null;
  const u = scope && scope.uncommitted ? scope.uncommitted : {};
  let base = u.baseline && !u.baselineError ? u.baseline : scope && scope.range && scope.range.end ? scope.range.end : null;
  // A harness run's scope names commits of its own scratch project, which this
  // repository never had: with no base to look in, the cited file is assumed to
  // have been in the reviewed tree, as with no scope.json at all.
  let baseNote;
  if (base && git(root, ['cat-file', '-e', base + '^{commit}']).status !== 0) {
    baseNote = 'base ' + base + ' is not in this repository; cited files are assumed to have been in the reviewed tree';
    base = null;
  }
  const untrackedAtStart = u.untracked && Array.isArray(u.untracked.files)
    ? u.untracked.files.map((f) => (typeof f === 'string' ? f : f && f.path)).filter(Boolean) : [];
  const row = Object.assign({ report: file, receipts, base }, baseNote ? { baseNote } : {}, { diff: null, rechecks: rechecks(receipts), fixed: [] });

  let patches = null;
  if (opts.diffs.length) { patches = opts.diffs.map((d) => fs.readFileSync(d, 'utf8')); row.diff = { source: 'diff', files: opts.diffs }; }
  else if (newestVerifyDiff(receipts)) { const f = newestVerifyDiff(receipts); patches = [fs.readFileSync(f, 'utf8')]; row.diff = { source: 'verify', files: [f] }; }
  else if (opts.to && base) {
    const d = git(root, ['diff', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', base, opts.to]);
    if (d.status === 0) { patches = [d.stdout]; row.diff = { source: 'to', files: [], to: opts.to }; }
  }
  if (!patches) {
    row.skipped = 'no fix diff: no --diff, no verify-r<n>-diff.patch in ' + (receipts || 'any receipts folder') + (opts.to ? ', and --to has no base (no scope.json)' : ', no --to');
    return row;
  }
  const digest = parseDigest(md);
  const loci = citedLoci(md);
  for (const id of Object.keys(digest).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
    if (digest[id] !== 'FIXED') continue;
    const locus = loci[id] || null;
    if (!locus) { row.fixed.push({ id, locus: null, hunk: 'no locus', file: null, line: null }); continue; }
    const l = strongest(patches.map((patch) => locusLabel(locus.path, locus.line, { root, base: base || undefined, patch, untrackedAtStart })));
    row.fixed.push({ id, locus: locus.path + (locus.line ? ':' + locus.line : ''), hunk: hunkLabel(l), file: l.file, line: l.line });
  }
  return row;
}

function main(argv) {
  const opts = { reports: [], receipts: null, diffs: [], to: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) usage(a + ' needs a value'); return v; };
    if (a === '--receipts') opts.receipts = val();
    else if (a === '--diff') opts.diffs.push(val());
    else if (a === '--to') opts.to = val();
    else if (a === '--json') opts.json = true;
    else if (a.startsWith('--')) usage('unknown option ' + a);
    else opts.reports.push(a);
  }
  if (!opts.reports.length) usage('name at least one report');
  for (const f of opts.reports.concat(opts.diffs)) {
    try { if (!fs.statSync(f).isFile()) usage(f + ' is not a file'); } catch (e) { usage(f + ' does not exist'); }
  }
  const root = process.cwd();
  const lines = [];
  for (const f of opts.reports) {
    const row = scanReport(f, opts, root);
    if (opts.json) { lines.push(JSON.stringify(row)); continue; }
    lines.push(f + (row.skipped ? ': skipped, ' + row.skipped : ''));
    for (const x of row.fixed) lines.push('  ' + x.id + ' FIXED ' + (x.locus || '(no locus)') + ' -> ' + x.hunk + (x.line ? ' (' + x.line + ')' : ''));
    lines.push('  rechecks: ' + row.rechecks.paired + ' paired, ' + row.rechecks.unpaired + ' unpaired, ' + row.rechecks.unpairable + ' unpairable');
  }
  process.stdout.write(lines.join('\n') + '\n');
}

module.exports = { citedLoci, rechecks, hunkLabel, scanReport };
if (require.main === module) main(process.argv.slice(2));
