#!/usr/bin/env node
'use strict';
// merge-findings.js - the merge, sort and number pass over review findings
// (issue #211). Every runner that collects JSONL findings from several
// workers (the review orchestrator, the upgrade audit's runner, a direct
// fan-out, the full review, the security audit) used to merge the lines that
// share a dedup key, sort them by severity and number them by hand, each in
// its own words. This script does that pass once, the same way every time.
//
//   node merge-findings.js <file>
//   node merge-findings.js <folder>   the same, reading the findings.jsonl
//                                     inside that folder (issue #217)
//
// <file> holds one JSON object per line in the dispatch format (severity,
// specialist, file, what, context, fix, fields, key, receipt). The runner
// writes it with the file-writing tool into a fresh temporary folder: a file
// argument rather than stdin, because a pipe into a script needs permission
// rows of its own while a file argument runs under the script's own row. A
// `NO FINDINGS` line and a `NOT CHECKED: ...` disclosure line are skipped and
// counted; blank lines are ignored; a leading byte order mark is dropped.
//
// Output, on stdout: one JSON object per line, the merged findings sorted
// block, warn, suggest (stable within one severity, so input order holds) and
// numbered `id` R1 onward with no gaps. Findings sharing a `key` become one:
//   - the primary is the highest-severity source, the earliest on a tie;
//   - `severity` is the highest of the sources;
//   - `specialist` is the unique names joined with ", " in first-seen order,
//     one string, which the review shell renders as it is;
//   - `what`, `context`, `fix`, `file`, `locus` and every other property come
//     from the primary; an `id` the primary carried (the upgrade audit's
//     convention id) is kept as `sourceId`, because `id` is the number;
//   - `fields` are the primary's rows followed by the rows of the other
//     sources whose label the primary lacks, so browser evidence rows survive
//     a merge with a code finding;
//   - `receipt` is the primary's, and `receipts` carries every source receipt
//     in input order, because tier 1 runs each of them and a merged finding
//     stands when any one check passes;
//   - `sources` carries the original lines, so nothing a worker wrote is lost.
// An unmerged finding has the same shape, with one-element `receipts` and
// `sources`.
//
// Two findings that describe one defect under different keys are not this
// script's call: the runner gives them one key before running it and records
// the merge in its report.
//
// A finding with no `key` gets one from stableFindingKey below. That is the
// rule render-html.js requires from this file to recognise a finding across
// runs, so the identity a page uses and the identity this pass merges on are
// one rule in one place.
//
// stderr: one summary line,
//   merge-findings: N raw, M merged (K merges), B block / W warn / S suggest, D non-finding line(s) skipped
// and before it, one warning line per finding that breaks a countable rule of
// the finding contract (.claude/skills/shared/finding-contract.md; issue #221):
//   merge-findings: line N (<key>): what 24/18 words; hedge "it appears"
// The rules checked are the word caps (what 18, context 22, fix 20, and 40 of
// open prose before the fix line), the eleven banned hedges, and a `what` that
// does not open with Blocks. / Should fix. / Optional. Warnings only: stdout
// and the exit code are what they would be without them, because the
// contract's judgment rules are not this script's call, and a merge that
// dropped a finding over its prose would hide a defect to tidy a sentence.
// A line that is not a JSON object, or carries an unknown severity, stops the
// run: exit 1, nothing on stdout, and on stderr one JSON object
// {"error":"bad_line","line":<n>,"reason":"..."}. A missing argument, an extra
// one, or a file that cannot be read exits 1 the same way with "usage" or
// "not_found". Dependency-free, like every script here, and it names no
// command: the plugin build rewrites command names in prompts, never in
// scripts.

const fs = require('fs');
const path = require('path');

const SEVERITY_RANK = { block: 0, warn: 1, suggest: 2 };

// The dedup key: the file's relative path, a colon, and the first eight
// normalized words of `what` after its severity lead. The lead goes because
// every sentence one opens with one, so leaving it in would start every key
// with the same words (v6.3.0 review, R12); HTML tags go because the shell
// renders `what` as markup; the line number stays out because a line moves
// whenever the file above it changes, and a moved line read as one finding
// resolved and a new one opened (R10). Path plus claim is the identity, and a
// key the finding already carries wins.
const SEVERITY_LEAD = /^\s*(?:blocks?|should fix|optional)\b[.:]?\s*/i;
function stableFindingKey(f) {
  if (f.key) return String(f.key);
  const loc = f.file ? (f.file.relPath || '') : '';
  const claim = String(f.what || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(SEVERITY_LEAD, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, '')
    .split(/\s+/).filter(Boolean).slice(0, 8).join('-');
  return loc + ':' + claim;
}

// An error the command-line body reports as its JSON line; thrown rather than
// exited so the functions stay usable from another script.
function badInput(error, line, reason) {
  const e = new Error(reason);
  e.error = error;
  e.line = line;
  return e;
}

// The findings in a JSONL text, with `lines[i]` the line number of
// `findings[i]` (kept beside the finding, never on it: `sources` carries each
// line as written), plus the count of non-finding lines (NO FINDINGS, NOT
// CHECKED) skipped on the way.
function parseLines(text) {
  const findings = [];
  const lineNumbers = [];
  let skipped = 0;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const n = i + 1;
    if (line === '') continue;
    if (line === 'NO FINDINGS' || line.startsWith('NOT CHECKED:')) { skipped++; continue; }
    let obj;
    try { obj = JSON.parse(line); } catch (e) { throw badInput('bad_line', n, 'line ' + n + ' is not JSON: ' + e.message); }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw badInput('bad_line', n, 'line ' + n + ' is not a JSON object');
    const sev = String(obj.severity === undefined ? '' : obj.severity).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(SEVERITY_RANK, sev)) {
      throw badInput('bad_line', n, 'line ' + n + ' has severity ' + JSON.stringify(obj.severity) + '; expected block, warn or suggest');
    }
    findings.push(obj);
    lineNumbers.push(n);
  }
  return { findings, skipped, lines: lineNumbers };
}

const rankOf = (f) => SEVERITY_RANK[String(f.severity).toLowerCase()];

// The rows of the primary, then each other source's rows whose label the
// primary lacks. A row without a string label is kept only from the primary.
function unionFields(primary, members) {
  const out = [];
  const seen = new Set();
  for (const row of primary.fields || []) {
    if (row && typeof row.label === 'string') seen.add(row.label);
    out.push(row);
  }
  for (const m of members) {
    if (m === primary) continue;
    for (const row of m.fields || []) {
      if (!row || typeof row.label !== 'string' || seen.has(row.label)) continue;
      seen.add(row.label);
      out.push(row);
    }
  }
  return out;
}

// Merge the findings that share a key, sort by severity (stable), and number
// the result R1 onward. Returns the output objects in order.
function mergeFindings(findings) {
  const groups = new Map();
  findings.forEach((f, order) => {
    const key = stableFindingKey(f);
    if (!groups.has(key)) groups.set(key, { key, order, members: [] });
    groups.get(key).members.push(f);
  });
  const merged = [];
  for (const g of groups.values()) {
    let primary = g.members[0];
    for (const m of g.members) if (rankOf(m) < rankOf(primary)) primary = m;
    const out = {};
    for (const prop of Object.keys(primary)) {
      if (prop === 'id') out.sourceId = primary.id;
      else out[prop] = primary[prop];
    }
    out.severity = String(primary.severity).toLowerCase();
    const names = [];
    for (const m of g.members) {
      const name = m.specialist === undefined ? '' : String(m.specialist);
      if (name !== '' && !names.includes(name)) names.push(name);
    }
    if (names.length) out.specialist = names.join(', ');
    const fields = unionFields(primary, g.members);
    if (fields.length) out.fields = fields; else delete out.fields;
    out.key = g.key;
    out.receipts = g.members.filter((m) => m.receipt !== undefined).map((m) => m.receipt);
    out.sources = g.members.slice();
    merged.push({ out, rank: rankOf(primary), order: g.order });
  }
  merged.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return merged.map((m, i) => Object.assign({ id: 'R' + (i + 1) }, m.out));
}

// The finding contract's countable rules (issue #221, D10): the word caps, the
// eleven banned hedges and the severity phrase. Words are counted the way
// render-html.js counts them (tags stripped, whitespace-separated), so the two
// scripts never disagree about one finding. The judgment rules (an honest harm
// verb, a cost in the fix line) stay with the audit.
const CONTRACT_CAPS = { what: 18, context: 22, fix: 20, prose: 40 };
const SEVERITY_PHRASE = /^\s*(?:Blocks|Should fix|Optional)\./;
const BANNED_HEDGES = [
  'it appears', 'it is possible that', 'could potentially', 'consider whether',
  'it may be worth', 'you might want to', 'arguably', 'in a sense',
  'it is worth noting', 'somewhat', 'in certain scenarios',
];
const HEDGE_RE = new RegExp('\\b(?:' + BANNED_HEDGES.join('|') + ')\\b', 'gi');
const untagged = (s) => (typeof s === 'string' ? s.replace(/<[^>]*>/g, ' ') : '');
const proseWords = (s) => untagged(s).split(/\s+/).filter(Boolean).length;

// One stderr line for a finding that breaks a countable rule, or null.
function contractWarning(f, lineNo) {
  const broken = [];
  const w = { what: proseWords(f.what), context: proseWords(f.context), fix: proseWords(f.fix) };
  for (const k of ['what', 'context', 'fix']) {
    if (w[k] > CONTRACT_CAPS[k]) broken.push(k + ' ' + w[k] + '/' + CONTRACT_CAPS[k] + ' words');
  }
  if (w.what + w.context > CONTRACT_CAPS.prose) broken.push('open prose ' + (w.what + w.context) + '/' + CONTRACT_CAPS.prose + ' words');
  if (!SEVERITY_PHRASE.test(untagged(f.what))) broken.push('what opens without Blocks. / Should fix. / Optional.');
  const hedges = untagged([f.what, f.context, f.fix].filter((s) => typeof s === 'string').join(' ')).match(HEDGE_RE) || [];
  const seen = [];
  for (const h of hedges) { const key = h.toLowerCase(); if (!seen.includes(key)) seen.push(key); }
  if (seen.length) broken.push('hedge ' + seen.map((h) => JSON.stringify(h)).join(', '));
  if (!broken.length) return null;
  return 'merge-findings: line ' + lineNo + ' (' + stableFindingKey(f) + '): ' + broken.join('; ');
}

function summaryLine(raw, merged, skipped) {
  const count = (sev) => merged.filter((m) => m.severity === sev).length;
  const merges = raw - merged.length;
  return 'merge-findings: ' + raw + ' raw, ' + merged.length + ' merged (' + merges + ' merge' + (merges === 1 ? '' : 's') + '), '
    + count('block') + ' block / ' + count('warn') + ' warn / ' + count('suggest') + ' suggest, '
    + skipped + ' non-finding line(s) skipped';
}

function main(argv) {
  const fail = (error, line, reason) => {
    const out = { error };
    if (line !== null && line !== undefined) out.line = line;
    out.reason = reason;
    process.stderr.write(JSON.stringify(out) + '\n');
    process.exit(1);
  };
  if (argv.length !== 1) fail('usage', null, 'usage: node merge-findings.js <findings.jsonl, or the folder that holds it>');
  // Issue #217: the merge sentence names the folder right before this call, so
  // a runner may hand over the folder; the findings.jsonl inside it is then the
  // file. The check must not throw on a path that does not exist: that case is
  // left to the read below, which reports it as not_found.
  let file = argv[0];
  try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'findings.jsonl'); } catch (e) { /* absent: the read below reports it */ }
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { fail('not_found', null, file + ' could not be read: ' + e.message); }
  let parsed;
  try { parsed = parseLines(text); } catch (e) { fail(e.error || 'bad_line', e.line, e.message); }
  parsed.findings.forEach((f, i) => {
    const warning = contractWarning(f, parsed.lines[i]);
    if (warning) process.stderr.write(warning + '\n');
  });
  const merged = mergeFindings(parsed.findings);
  if (merged.length) process.stdout.write(merged.map((m) => JSON.stringify(m)).join('\n') + '\n');
  process.stderr.write(summaryLine(parsed.findings.length, merged, parsed.skipped) + '\n');
}

module.exports = { stableFindingKey, parseLines, mergeFindings, contractWarning, main };
if (require.main === module) main(process.argv.slice(2));
