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
// A line that is not a JSON object, or carries an unknown severity, stops the
// run: exit 1, nothing on stdout, and on stderr one JSON object
// {"error":"bad_line","line":<n>,"reason":"..."}. A missing argument, an extra
// one, or a file that cannot be read exits 1 the same way with "usage" or
// "not_found". Dependency-free, like every script here, and it names no
// command: the plugin build rewrites command names in prompts, never in
// scripts.

const fs = require('fs');

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

// The findings in a JSONL text, each with its line number, plus the count of
// non-finding lines (NO FINDINGS, NOT CHECKED) skipped on the way.
function parseLines(text) {
  const findings = [];
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
  }
  return { findings, skipped };
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
  if (argv.length !== 1) fail('usage', null, 'usage: node merge-findings.js <findings.jsonl>');
  let text;
  try { text = fs.readFileSync(argv[0], 'utf8'); } catch (e) { fail('not_found', null, argv[0] + ' could not be read: ' + e.message); }
  let parsed;
  try { parsed = parseLines(text); } catch (e) { fail(e.error || 'bad_line', e.line, e.message); }
  const merged = mergeFindings(parsed.findings);
  if (merged.length) process.stdout.write(merged.map((m) => JSON.stringify(m)).join('\n') + '\n');
  process.stderr.write(summaryLine(parsed.findings.length, merged, parsed.skipped) + '\n');
}

module.exports = { stableFindingKey, parseLines, mergeFindings, main };
if (require.main === module) main(process.argv.slice(2));
