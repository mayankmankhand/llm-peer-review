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
//   ... [--root <dir>] [--rev <commit>] [--base <commit>]
//                                     where the citation check looks; see below
//   node merge-findings.js --shards <file or folder> --receipts <dir> --out <dir> [--drop R3,R7]
//                                     writes the skeptics' shards (below)
//   node merge-findings.js --verdicts <shard file> <return file>...
//   node merge-findings.js --verdicts --tier <2|3|verify> --ids R1,R2 <return file>...
//                                     checks what the judges sent back (below)
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
//
// The citation check (harness research, P5-C3): after the merge, each merged
// finding's `file.relPath` is resolved and its `file.line` compared with the
// file's line count, and a citation that cannot be right gets one more stderr
// line, keyed by the merged id so the runner can carry it to the skeptics:
//   merge-findings: citation R3 (<key>): line 18 is past the end of x.md (14 lines)
// The statuses are missing-file (no such path, and git never had it),
// deleted-file (not in the copy checked, but git history has it),
// deleted-in-range (absent now, present at --base), line-out-of-range, and
// outside-project (the path climbs out of the root). Where it looks: the
// working copy under --root, default the current folder, which is what a live
// review read; --rev <commit> checks that commit instead (git cat-file and git
// show), which is how a saved report is replayed against the end of the range
// it reviewed. Like the contract warnings it never changes stdout or the exit
// code: a citation the checker cannot place is a question for the skeptic, not
// a reason to drop a finding, and a wrong line in an otherwise sound finding
// is still a sound finding.
// --shards (harness research, P5-C1) merges the same input the same way and
// writes the M2 audit's inputs into --out, a fresh folder (the run's receipts
// folder is the natural place): audit-tier2-<k>.txt, one per 7 surviving Warns
// and Suggests in R order, and audit-tier3.txt, the one ballot all three voters
// read, over the surviving Blocks. --drop names the IDs tier 1 killed (RECEIPT
// FAILED), which go in no shard. Each file opens with a header line,
//   M2 audit shard: tier 2, shard 1 of 2, ids R2 R3 R4
// then M2's instruction for that tier word for word, then one section per
// finding: each source line exactly as its finder wrote it, and the output tier 1
// saved for it, read from <receipts>/<lens>-<n>.txt (<lens> the line's
// specialist, `inline` when it has none; <n> its count within that lens), plus
// one Citation check line when the citation check above fails, worded so the
// skeptic judges the claim against the file rather than refuting it over a line
// number. Nothing is retyped, so a runner has nothing to paraphrase. A receipt
// file that is missing stops the run before anything is written (exit 1,
// "missing_receipt"), and a shard file that already exists is never replaced
// ("exists"). stdout is one JSON object: {shards: [{tier, file, ids}], tier3:
// {tier, file, ids, voters: 3} | null, dropped}.
//
// --verdicts reads one judge's return (tier 2, or the verifier) or up to three
// (tier 3's voters), each saved to a file, against the IDs it was sent: from the
// shard file's header line, or from --tier and --ids. A verdict line is an R-ID
// and a colon at the start of a line (markdown marks and indentation aside),
// followed by one word of that tier's closed set: REFUTED or STANDS; tier 3 adds
// DOWNGRADE Warn and DOWNGRADE Suggest; the verifier says FIXED or NOT FIXED. A
// split: line belongs to the verdict above it. A line of prose after an ID and
// a colon (an evidence list, say) is not a verdict and decides nothing; an
// all-capitals word there (KEEP, KILL) is a verdict outside the set. stdout is one JSON object,
// {tier, ids, ok, returns: [{file, problems}]}; a problem is a missing ID, an
// extra ID, an unknown word (KEEP, KILL) or two lines that disagree for one ID,
// and any problem makes ok false and the exit code 1, with nothing decided,
// because M2 redispatches a malformed return rather than reading around it. When
// ok, it adds verdicts (one per ID, in M2's words), splits, and for tier 3 the
// ballots per ID, the tally (two or more REFUTED kill as "REFUTED 2/3" or "3/3",
// else two or more STANDS, else the higher DOWNGRADE; with two ballots, kill or
// downgrade only when both agree; with one, the ID is listed as unaudited) and
// notes, one per DOWNGRADE ballot that named none of M2's three Block conditions
// and so counted as STANDS. The severity floor in severity-anchors.md is the
// runner's to apply.
//
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
// line as written), `texts[i]` its line as written (trimmed; what --shards
// copies), plus the count of non-finding lines (NO FINDINGS, NOT CHECKED)
// skipped on the way.
function parseLines(text) {
  const findings = [];
  const lineNumbers = [];
  const texts = [];
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
    texts.push(line);
  }
  return { findings, skipped, lines: lineNumbers, texts };
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

// The citation check. Line numbers come as a number or a "12" / "12-18"
// string; a range is checked by its last line. Returns null when the citation
// can be placed, or { status, detail }.
const { spawnSync } = require('child_process');
function citedLine(line) {
  if (typeof line === 'number' && Number.isFinite(line)) return line;
  const m = typeof line === 'string' ? line.trim().match(/^(\d+)(?:\s*[-\u2013]\s*(\d+))?$/) : null;
  return m ? Number(m[2] || m[1]) : null;
}
const lineCount = (text) => (text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));
// git inside the root, never through a shell: the path and the commit are
// arguments, so nothing a finding carries can reach a shell.
function git(root, args) {
  const r = spawnSync('git', ['-C', root].concat(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.error ? { status: -1, stdout: '' } : { status: r.status, stdout: r.stdout || '' };
}
function citationCheck(file, opts) {
  if (!file || typeof file.relPath !== 'string' || file.relPath.trim() === '') return null;
  const o = opts || {};
  const root = path.resolve(o.root || process.cwd());
  const rel = path.posix.normalize(file.relPath.trim().replace(/\\/g, '/')).replace(/^\.\//, '');
  if (path.isAbsolute(rel) || rel === '..' || rel.startsWith('../')) {
    return { status: 'outside-project', detail: file.relPath + ' leaves the project' };
  }
  let text = null;
  if (o.rev) {
    const shown = git(root, ['show', o.rev + ':' + rel]);
    if (shown.status === 0) text = shown.stdout;
  } else {
    try { const abs = path.join(root, rel); if (fs.statSync(abs).isFile()) text = fs.readFileSync(abs, 'utf8'); } catch (e) { text = null; }
  }
  if (text === null) {
    if (o.base && git(root, ['cat-file', '-e', o.base + ':' + rel]).status === 0) {
      return { status: 'deleted-in-range', detail: rel + ' existed at ' + o.base + ' and is gone' };
    }
    const history = git(root, ['log', '-1', '--format=%h'].concat(o.rev ? [o.rev] : []).concat(['--', rel]));
    if (history.status === 0 && history.stdout.trim() !== '') {
      return { status: 'deleted-file', detail: rel + ' is not in ' + (o.rev ? o.rev : 'the working copy') + ', though git history has it' };
    }
    return { status: 'missing-file', detail: rel + ' does not exist' + (o.rev ? ' at ' + o.rev : '') };
  }
  const line = citedLine(file.line);
  const total = lineCount(text);
  if (line !== null && (line < 1 || line > total)) {
    return { status: 'line-out-of-range', detail: 'line ' + line + ' is past the end of ' + rel + ' (' + total + ' lines)' };
  }
  return null;
}
// One stderr line per merged finding whose citation cannot be right.
function citationWarnings(merged, opts) {
  const out = [];
  for (const m of merged) {
    const c = citationCheck(m.file, opts);
    if (c) out.push('merge-findings: citation ' + m.id + ' (' + m.key + '): ' + c.status + ': ' + c.detail);
  }
  return out;
}

// ==========================================================================
// --shards and --verdicts: the audit's bytes and its answers, by script
// (harness research, P5-C1)
// ==========================================================================
//
// A runner once wrote its own skeptic shards: every finding paraphrased, no
// receipt output at all, and a prompt asking for KEEP or KILL in place of M2's
// words, so the run's verdicts were read off a vocabulary M2 never defined.
// --shards writes the shards from the bytes on disk instead, and --verdicts
// checks what comes back against the IDs it was sent and M2's closed set.

// M2's two skeptic instructions, word for word as `.claude/skills/shared/hitl-loop.md`
// and the audit-skeptic agent quote them. A test compares all three, so a change
// to M2 that is not carried here fails the suite rather than drifting.
const TIER2_INSTRUCTION = 'Try to refute each finding using its receipt output. The default prior is rejection: when in doubt, refute. Return exactly one line per ID - `RN: REFUTED` or `RN: STANDS` - plus one line of reasoning each. If you refute a finding that contains a true sub-claim, add one more line, `split: <the sub-claim in one line>`, so the true part is not lost with the false one.';
const TIER3_INSTRUCTION = 'Try to refute each finding using its receipt output. The default prior is rejection: when in doubt, refute. Return exactly one line per ID - `RN: REFUTED`, `RN: STANDS`, `RN: DOWNGRADE Warn`, or `RN: DOWNGRADE Suggest` - plus one line of reasoning each. `DOWNGRADE` means the claim is real but not a Block, and its reasoning line must name which Block condition fails: not reachable through a normal user action, harms only the user who triggers it, or a workaround exists. If you refute a finding that contains a true sub-claim, add one more line, `split: <the sub-claim in one line>`.';
// One skeptic per 7 findings, ceiling (M2 tier 2).
const SHARD_SIZE = 7;
const SHARD_HEADER = /^M2 audit shard: tier (2|3), [^\n]*?, ids ((?:R\d+)(?: R\d+)*)[ \t]*\r?$/;

const byNumber = (a, b) => Number(a.slice(1)) - Number(b.slice(1));

// The receipt file stem of each finding line, in input order: `<lens>-<n>`, where
// <lens> is the finder that wrote the line (`inline` for a line with no
// specialist, the orchestrator's own path) and <n> counts that lens's lines from
// 1. That is the id the runner gave each check when tier 1 ran it
// (`.claude/skills/shared/report-format.md`, "Where the report is written").
function receiptStems(findings) {
  const seen = {};
  return findings.map((f) => {
    const named = f.specialist === undefined ? '' : String(f.specialist).trim();
    const lens = named === '' ? 'inline' : named;
    seen[lens] = (seen[lens] || 0) + 1;
    return lens + '-' + seen[lens];
  });
}

// Build every shard's text from the parsed input and the receipts folder. Throws
// a badInput error (missing_receipt, usage) before anything is written.
function buildShards(parsed, opts) {
  const merged = mergeFindings(parsed.findings);
  const indexOf = new Map(parsed.findings.map((f, i) => [f, i]));
  const stems = receiptStems(parsed.findings);
  const ids = merged.map((m) => m.id);
  const drop = (opts.drop || []).slice().sort(byNumber);
  for (const id of drop) if (!ids.includes(id)) throw badInput('usage', null, '--drop names ' + id + ', which the merge did not produce (R1 to R' + ids.length + ')');

  // Each source's saved receipt output, or null when tier 1 saved none. The checks
  // runner writes no file for a check it refused, and a merged finding stands if
  // any one of its checks passed, so a missing output stops the run only when no
  // source of the finding has one.
  const saved = (src, i, stem) => {
    if (/[\\/]|^\.\.?$/.test(stem)) throw badInput('missing_receipt', parsed.lines[i], 'line ' + parsed.lines[i] + ': specialist ' + JSON.stringify(src.specialist) + ' cannot name a receipt file');
    try { return fs.readFileSync(path.join(opts.receipts, stem + '.txt'), 'utf8'); } catch (e) { return null; }
  };
  const section = (m) => {
    const parts = ['===== ' + m.id + ' ====='];
    const outputs = m.sources.map((src) => {
      const i = indexOf.get(src);
      return src.receipt === undefined ? undefined : saved(src, i, stems[i]);
    });
    const anySaved = outputs.some((b) => typeof b === 'string');
    m.sources.forEach((src, k) => {
      const i = indexOf.get(src);
      const stem = stems[i];
      parts.push('Finding (' + stem + ', as its finder wrote it):', parsed.texts[i]);
      const bytes = outputs[k];
      if (bytes === undefined) {
        parts.push('Receipt output: none; this line carries no receipt.');
      } else if (bytes === null) {
        const file = path.join(opts.receipts, stem + '.txt');
        if (!anySaved) throw badInput('missing_receipt', parsed.lines[i], 'no saved receipt output for ' + m.id + ' at ' + file + ' (line ' + parsed.lines[i] + ', id ' + stem + ')');
        parts.push('Receipt output (' + stem + '.txt): none saved; tier 1 refused or did not run this check, so this source is untested.');
      } else {
        parts.push('Receipt output (' + stem + '.txt, as tier 1 saved it):', bytes.endsWith('\n') ? bytes.slice(0, -1) : bytes);
      }
    });
    const c = citationCheck(m.file, opts);
    if (c) {
      parts.push('Citation check: ' + c.detail + '. This says the citation is wrong, not that the claim is wrong: judge the claim against the file itself.');
    }
    parts.push('===== end ' + m.id + ' =====');
    return parts.join('\n');
  };

  const kept = merged.filter((m) => !drop.includes(m.id));
  // Every section in R order first, so a missing receipt names the lowest ID.
  const sections = new Map(kept.map((m) => [m.id, section(m)]));
  const blocks = kept.filter((m) => m.severity === 'block');
  const rest = kept.filter((m) => m.severity !== 'block');
  const preface = (tierLine, instruction) => [
    tierLine + ' The instruction, quoted from M2:',
    '"' + instruction + '"',
    '',
    'Each finding below is the line its finder wrote, and each receipt output is the file tier 1 saved in ' + opts.receipts + ', both copied byte for byte by merge-findings.js --shards. A finding that two finders raised carries both lines and both outputs.',
  ].join('\n');

  const files = [];
  const count = Math.ceil(rest.length / SHARD_SIZE);
  for (let k = 0; k < count; k++) {
    const group = rest.slice(k * SHARD_SIZE, (k + 1) * SHARD_SIZE);
    const header = 'M2 audit shard: tier 2, shard ' + (k + 1) + ' of ' + count + ', ids ' + group.map((m) => m.id).join(' ');
    files.push({ tier: 2, name: 'audit-tier2-' + (k + 1) + '.txt', ids: group.map((m) => m.id),
      text: [header, '', preface('You are running tier 2: one skeptical pass over Warns and Suggests.', TIER2_INSTRUCTION), ''].concat(group.map((m) => sections.get(m.id))).join('\n') + '\n' });
  }
  if (blocks.length) {
    const header = 'M2 audit shard: tier 3, the ballot for all three voters, ids ' + blocks.map((m) => m.id).join(' ');
    files.push({ tier: 3, name: 'audit-tier3.txt', ids: blocks.map((m) => m.id),
      text: [header, '', preface('You are running tier 3: one of three independent voters over Blocks.', TIER3_INSTRUCTION), ''].concat(blocks.map((m) => sections.get(m.id))).join('\n') + '\n' });
  }
  return { files, dropped: drop };
}

// The verdict words each judge may use (M2 tiers 2 and 3, M3's verifier), longest
// first so NOT FIXED is tried before FIXED.
const VERDICT_SETS = {
  2: ['REFUTED', 'STANDS'],
  3: ['DOWNGRADE Suggest', 'DOWNGRADE Warn', 'REFUTED', 'STANDS'],
  verify: ['NOT FIXED', 'FIXED'],
};
// M2's three Block conditions, in its own words. A DOWNGRADE ballot whose
// reasoning names none of them counts as STANDS.
const BLOCK_CONDITIONS = [/reachab|normal user action/i, /user who triggers|harms only/i, /workaround/i];

// Strip what markdown and the hand-back frame put around a line: indentation, a
// list or quote marker, and a leading bold, italic or code mark.
function bare(line) {
  return line.replace(/^\s+/, '').replace(/^(?:>\s*)+/, '').replace(/^(?:[-*+]|\d+[.)])\s+/, '').replace(/^(?:\*\*|__|`|\*|_)+/, '');
}
const VERDICT_LINE = /^(R\d+)(?:\*\*|__|`|\*|_)*\s*:\s*(?:\*\*|__|`|\*|_)*\s*(.*)$/;

// One return read against the IDs it was sent. A verdict line is an R-ID followed
// by a colon at the start of a line; a mention of an ID anywhere else (a summary,
// a file list) is not one, so a prose report reads as every ID missing.
function readReturn(text, ids, tier) {
  const words = VERDICT_SETS[tier];
  const problems = [];
  const decided = {};
  const splits = {};
  const unknownIds = new Set();
  const proseIds = new Set();
  let last = null;
  let waiting = null; // the verdict whose reasoning is still on the next line
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const s = bare(lines[i]);
    const split = s.match(/^split:\s*(.*)$/i);
    if (split) {
      if (last) (splits[last] = splits[last] || []).push(split[1].trim());
      waiting = null;
      continue;
    }
    const m = s.match(VERDICT_LINE);
    if (!m) {
      if (waiting && s.trim() !== '') { waiting.reason = s.trim(); waiting = null; }
      continue;
    }
    waiting = null;
    const id = m[1];
    const rest = m[2].replace(/^(?:\*\*|__|`|\*|_)+/, '');
    const word = words.find((w) => rest.toLowerCase().startsWith(w.toLowerCase()) && !/[A-Za-z0-9]/.test(rest.charAt(w.length)));
    if (!word) {
      const token = (rest.match(/^[^\s.,;:*`_-]*/) || [''])[0];
      // An all-capitals word where a verdict goes (KEEP, KILL, DOWNGRADE in tier
      // 2) is a verdict outside the closed set. Anything else is prose about the
      // ID, such as an evidence list under the verdicts: it decides nothing, and
      // the ID is missing only if no verdict line names it.
      if (/^[A-Z]{2,}$/.test(token)) {
        problems.push({ kind: 'unknown', id, line: i + 1, word: token, text: lines[i].trim().slice(0, 120) });
        unknownIds.add(id);
      } else {
        proseIds.add(id);
      }
      continue;
    }
    if (!ids.includes(id)) { problems.push({ kind: 'extra', id, line: i + 1 }); continue; }
    if (decided[id]) {
      if (decided[id].verdict !== word) problems.push({ kind: 'conflict', id, line: i + 1, first: decided[id].verdict, second: word });
      continue;
    }
    const reason = rest.slice(word.length).replace(/^[\s*_`.,:;\u2013\u2014-]+/, '').trim();
    decided[id] = { verdict: word, reason };
    last = id;
    if (reason === '') waiting = decided[id];
  }
  for (const id of ids) {
    if (decided[id] || unknownIds.has(id)) continue;
    problems.push(proseIds.has(id) ? { kind: 'missing', id, note: 'named only in prose lines, never with a verdict word' } : { kind: 'missing', id });
  }
  problems.sort((a, b) => (a.line || Infinity) - (b.line || Infinity));
  return { problems, decided, splits };
}

// M2 tier 3's tally over the valid ballots, in M2's order. Three ballots: two or
// more REFUTED kill, else two or more STANDS keep, else the higher DOWNGRADE. Two
// (a voter that failed its redispatch): kill only when both refute, downgrade
// only when both downgrade, otherwise it stays a Block. Fewer: unaudited.
function tallyBlock(ballots) {
  const refuted = ballots.filter((b) => b === 'REFUTED').length;
  const stands = ballots.filter((b) => b === 'STANDS').length;
  const downs = ballots.filter((b) => b.startsWith('DOWNGRADE'));
  const higher = downs.includes('DOWNGRADE Warn') ? 'DOWNGRADE Warn' : 'DOWNGRADE Suggest';
  if (ballots.length >= 3) {
    if (refuted >= 2) return 'REFUTED ' + refuted + '/3';
    if (stands >= 2) return 'STANDS';
    return higher;
  }
  if (ballots.length === 2) {
    if (refuted === 2) return 'REFUTED 2/3';
    if (downs.length === 2) return higher;
    return 'STANDS';
  }
  return null;
}

// Check every return, and decide only when all of them are clean: a malformed
// return is redispatched (M2), never read around.
function checkVerdicts(tier, ids, returns) {
  const read = returns.map((r) => Object.assign({ file: r.file }, readReturn(r.text, ids, tier)));
  const out = { tier: String(tier), ids, ok: read.every((r) => r.problems.length === 0), returns: read.map((r) => ({ file: r.file, problems: r.problems })) };
  if (!out.ok) return out;
  const splits = {};
  for (const r of read) for (const [id, list] of Object.entries(r.splits)) splits[id] = (splits[id] || []).concat(list);
  out.verdicts = {};
  out.splits = splits;
  if (String(tier) !== '3') {
    for (const id of ids) out.verdicts[id] = read[0].decided[id].verdict;
    return out;
  }
  out.ballots = {};
  out.unaudited = [];
  out.notes = [];
  for (const id of ids) {
    out.ballots[id] = read.map((r, k) => {
      const d = r.decided[id];
      if (d.verdict.startsWith('DOWNGRADE') && !BLOCK_CONDITIONS.some((c) => c.test(d.reason))) {
        out.notes.push(id + ': ballot ' + (k + 1) + ' said ' + d.verdict + ' without naming a Block condition, so it counts as STANDS');
        return 'STANDS';
      }
      return d.verdict;
    });
    const v = tallyBlock(out.ballots[id]);
    if (v === null) out.unaudited.push(id); else out.verdicts[id] = v;
  }
  return out;
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
  const usage = 'usage: node merge-findings.js <findings.jsonl, or the folder that holds it> [--root <dir>] [--rev <commit>] [--base <commit>]';
  if (argv[0] === '--shards') return shardsMain(argv.slice(1), fail);
  if (argv[0] === '--verdicts') return verdictsMain(argv.slice(1), fail);
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' || a === '--rev' || a === '--base') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) fail('usage', null, usage);
      opts[a.slice(2)] = v;
      i++;
    } else if (a.startsWith('--')) fail('usage', null, usage);
    else positional.push(a);
  }
  if (positional.length !== 1) fail('usage', null, usage);
  argv = positional;
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
  for (const w of citationWarnings(merged, opts)) process.stderr.write(w + '\n');
  if (merged.length) process.stdout.write(merged.map((m) => JSON.stringify(m)).join('\n') + '\n');
  process.stderr.write(summaryLine(parsed.findings.length, merged, parsed.skipped) + '\n');
}

// --shards <findings.jsonl or folder> --receipts <dir> --out <dir> [--drop R3,R7] [--root/--rev/--base]
function shardsMain(argv, fail) {
  const usage = 'usage: node merge-findings.js --shards <findings.jsonl, or its folder> --receipts <receipts folder> --out <folder> [--drop <R-ids killed at tier 1>] [--root <dir>] [--rev <commit>] [--base <commit>]';
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--receipts', '--out', '--drop', '--root', '--rev', '--base'].includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) fail('usage', null, usage);
      opts[a.slice(2)] = v;
      i++;
    } else if (a.startsWith('--')) fail('usage', null, usage);
    else positional.push(a);
  }
  if (positional.length !== 1 || !opts.receipts || !opts.out) fail('usage', null, usage);
  if (opts.drop !== undefined) {
    opts.drop = opts.drop.split(',').map((s) => s.trim()).filter(Boolean);
    if (!opts.drop.every((id) => /^R\d+$/.test(id))) fail('usage', null, usage);
  }
  let file = positional[0];
  try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'findings.jsonl'); } catch (e) { /* the read below reports it */ }
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { fail('not_found', null, file + ' could not be read: ' + e.message); }
  let built;
  try { built = buildShards(parseLines(text), opts); } catch (e) { fail(e.error || 'bad_line', e.line, e.error === 'usage' ? e.message + '. ' + usage : e.message); }
  // Every shard is checked before any is written: one that exists already is
  // evidence of an earlier run and is never replaced.
  for (const f of built.files) {
    if (fs.existsSync(path.join(opts.out, f.name))) fail('exists', null, path.join(opts.out, f.name) + ' already exists; give --out a fresh folder');
  }
  try { fs.mkdirSync(opts.out, { recursive: true }); } catch (e) { fail('not_found', null, opts.out + ' could not be made: ' + e.message); }
  for (const f of built.files) fs.writeFileSync(path.join(opts.out, f.name), f.text, { flag: 'wx' });
  const t3 = built.files.find((f) => f.tier === 3);
  process.stdout.write(JSON.stringify({
    shards: built.files.filter((f) => f.tier === 2).map((f) => ({ tier: 2, file: path.join(opts.out, f.name), ids: f.ids })),
    tier3: t3 ? { tier: 3, file: path.join(opts.out, t3.name), ids: t3.ids, voters: 3 } : null,
    dropped: built.dropped,
  }) + '\n');
}

// --verdicts <shard file> <return>...   or   --verdicts --tier <2|3|verify> --ids <R1,R2> <return>...
function verdictsMain(argv, fail) {
  const usage = 'usage: node merge-findings.js --verdicts <shard file> <return file>... | --verdicts --tier <2|3|verify> --ids <R1,R2,...> <return file>... (tier 2 and verify take one return, tier 3 one to three)';
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tier' || a === '--ids') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) fail('usage', null, usage);
      opts[a.slice(2)] = v;
      i++;
    } else if (a.startsWith('--')) fail('usage', null, usage);
    else positional.push(a);
  }
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { fail('not_found', null, f + ' could not be read: ' + e.message); } return ''; };
  let tier;
  let ids;
  if (opts.tier !== undefined || opts.ids !== undefined) {
    if (!opts.tier || !opts.ids || !Object.prototype.hasOwnProperty.call(VERDICT_SETS, opts.tier)) fail('usage', null, usage);
    tier = opts.tier;
    ids = opts.ids.split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length || !ids.every((id) => /^R\d+$/.test(id))) fail('usage', null, usage);
  } else {
    if (!positional.length) fail('usage', null, usage);
    const first = read(positional.shift()).split('\n')[0].replace(/^\uFEFF/, '');
    const h = first.match(SHARD_HEADER);
    if (!h) fail('usage', null, 'the shard file does not open with an "M2 audit shard:" line; pass --tier and --ids instead. ' + usage);
    tier = h[1];
    ids = h[2].split(' ');
  }
  const max = tier === '3' ? 3 : 1;
  if (positional.length < 1 || positional.length > max) fail('usage', null, usage);
  const out = checkVerdicts(tier, ids, positional.map((f) => ({ file: f, text: read(f) })));
  process.stdout.write(JSON.stringify(out) + '\n');
  if (!out.ok) process.exitCode = 1;
}

module.exports = { stableFindingKey, parseLines, mergeFindings, contractWarning, citationCheck, citationWarnings, receiptStems, buildShards, readReturn, tallyBlock, checkVerdicts, TIER2_INSTRUCTION, TIER3_INSTRUCTION, main };
if (require.main === module) main(process.argv.slice(2));
