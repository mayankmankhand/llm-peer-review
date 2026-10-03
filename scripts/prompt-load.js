#!/usr/bin/env node
'use strict';
// prompt-load.js - how many words each toolkit command, skill and agent puts into
// the context when it runs, and which ones grew since the recorded baseline
// (issue #206). Maintainer-only; nothing here ships in plugin/.
//
//   node scripts/prompt-load.js [--repo <dir>] [--baseline <file>]
//                               [--write-baseline] [--warnings-only]
//                               [--print <file>] [--json]
//
// What "loads" means, matching how Claude Code expands a prompt file:
//   - The body after the frontmatter, with every first-level inline replaced by
//     that file's text: !`cat <path>`, and the optional form
//     !`cat <path> 2>/dev/null || true`. An inlined file's own inlines stay as
//     literal text, because Claude Code does not re-scan an inline's output.
//   - For an agent, also every skill its frontmatter preloads (`skills:`), each
//     resolved the same way, because a preload loads the whole skill on every
//     dispatch.
//   - A missing file inlines nothing. A plain (not optional) inline of a missing
//     file is also reported as a note, because the prompt is broken there.
//
// Rows: commands/<name>.md, skills/<name>/SKILL.md and agents/<name>.md, each
// with what it loads, plus `session`: the always-on rules files and every
// command, skill and agent description, which every session carries whether or
// not anything runs. A skill moved out of a command to load on demand is its own
// row, so the words it holds stay visible instead of looking saved.
//
// The report warns and never fails: the owner chose warn over fail for #206.
// Against a baseline it prints one line per row that grew, appeared or
// disappeared, and still exits 0. test-prompt-load.js guards the counting itself.
//
//   --baseline <file>   compare with this baseline (default
//                       scripts/prompt-load-baseline.json); a missing file is a note
//   --write-baseline    record the current rows as the baseline instead
//   --warnings-only     print the comparison and notes, not the tables (npm test)
//   --print <file>      print one prompt file's resolved text (repo-relative path);
//                       the receipts that check a split use it
//   --json              print the whole report as JSON
//
// Exit codes: 0, or 2 on a usage error (an unknown flag, a missing value, a
// --print target that does not exist).

const fs = require('fs');
const path = require('path');

const USAGE = 'usage: node scripts/prompt-load.js [--repo <dir>] [--baseline <file>] [--write-baseline] [--warnings-only] [--print <file>] [--json]';
const DEFAULT_BASELINE = path.join('scripts', 'prompt-load-baseline.json');
// The two inline forms the toolkit uses. The path is captured without quotes,
// which is how every inline under .claude/ is written.
const INLINE = /!`cat ([^`\s]+)( 2>\/dev\/null \|\| true)?`/g;

function usage(msg) {
  console.error('prompt-load: ' + msg);
  console.error(USAGE);
  process.exit(2);
}

function parseArgs(argv) {
  const o = { repo: process.cwd(), baseline: null, write: false, warningsOnly: false, print: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) usage('missing value for ' + a);
      return v;
    };
    if (a === '--repo') o.repo = path.resolve(value());
    else if (a === '--baseline') o.baseline = value();
    else if (a === '--write-baseline') o.write = true;
    else if (a === '--warnings-only') o.warningsOnly = true;
    else if (a === '--print') o.print = value();
    else if (a === '--json') o.json = true;
    else if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    else usage('unknown argument ' + a);
  }
  return o;
}

function readText(abs) {
  try { return fs.readFileSync(abs, 'utf8'); } catch (e) { return null; }
}

function listDir(abs) {
  try { return fs.readdirSync(abs).sort(); } catch (e) { return []; }
}

function words(text) {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

// { front, body }: the YAML frontmatter between the opening and closing `---`
// lines, and everything after it. A file without frontmatter is all body.
function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? { front: m[1], body: text.slice(m[0].length) } : { front: '', body: text };
}

// The one-line value of a frontmatter key, quotes removed, or null.
function frontValue(front, key) {
  const m = new RegExp('^' + key + ':[ \\t]*(.*)$', 'm').exec(front);
  return m ? m[1].trim().replace(/^(['"])([\s\S]*)\1$/, '$2') : null;
}

// The skills an agent preloads, in either YAML form: `skills: [a, b]` or a
// block list of `  - a` lines.
function preloads(front) {
  const unquote = s => s.trim().replace(/^(['"])(.*)\1$/, '$2');
  const flow = /^skills:[ \t]*\[([^\]]*)\]/m.exec(front);
  if (flow) return flow[1].split(',').map(unquote).filter(Boolean);
  const block = /^skills:[ \t]*\r?\n((?:[ \t]+-[^\n]*(?:\r?\n|$))+)/m.exec(front);
  if (!block) return [];
  return block[1].split(/\r?\n/).map(l => unquote(l.replace(/^[ \t]+-[ \t]*/, ''))).filter(Boolean);
}

// Replace every first-level inline in `body` with the file it names. Returns the
// text and the repo-relative paths it inlined; a plain inline of a missing file
// adds a note naming `who`.
function resolveInlines(repo, body, who, notes) {
  const used = [];
  const text = body.replace(INLINE, (whole, rel, optional) => {
    const inlined = readText(path.resolve(repo, rel));
    if (inlined === null) {
      if (!optional) notes.push(who + ' inlines ' + rel + ', which does not exist');
      return '';
    }
    used.push(rel);
    return inlined;
  });
  return { text, used };
}

// Every prompt file under .claude/ that loads on its own, with its row name.
function promptFiles(repo) {
  const claude = path.join(repo, '.claude');
  const files = [];
  for (const n of listDir(path.join(claude, 'commands'))) {
    if (n.endsWith('.md')) files.push({ row: 'commands/' + n, rel: '.claude/commands/' + n, kind: 'command' });
  }
  for (const n of listDir(path.join(claude, 'skills'))) {
    const rel = '.claude/skills/' + n + '/SKILL.md';
    if (fs.existsSync(path.join(repo, rel))) files.push({ row: 'skills/' + n + '/SKILL.md', rel, kind: 'skill' });
  }
  for (const n of listDir(path.join(claude, 'agents'))) {
    if (n.endsWith('.md')) files.push({ row: 'agents/' + n, rel: '.claude/agents/' + n, kind: 'agent' });
  }
  return files;
}

// One prompt file as it loads: its resolved body (plus, for an agent, each
// preloaded skill's resolved body), the fragments that put into it, and its
// description (frontmatter, else its first line, which is what a command without
// frontmatter is listed by).
function loadFile(repo, file, notes) {
  const raw = readText(path.join(repo, file.rel));
  if (raw === null) return null;
  const { front, body } = splitFrontmatter(raw);
  const own = resolveInlines(repo, body, file.row, notes);
  let text = own.text;
  const used = own.used.slice();
  if (file.kind === 'agent') {
    for (const name of preloads(front)) {
      const skillRaw = readText(path.join(repo, '.claude', 'skills', name, 'SKILL.md'));
      if (skillRaw === null) { notes.push(file.row + ' preloads skill ' + name + ', which does not exist'); continue; }
      const skill = resolveInlines(repo, splitFrontmatter(skillRaw).body, file.row, notes);
      text += '\n' + skill.text;
      used.push(...skill.used);
    }
  }
  const firstLine = (body.split(/\r?\n/).find(l => l.trim()) || '').replace(/^#+\s*/, '');
  const description = frontValue(front, 'description') || firstLine;
  return { text, used, description };
}

function collect(repo) {
  const notes = [];
  const rows = {};
  const fragmentUse = new Map();
  let descriptionWords = 0;
  let descriptions = 0;
  for (const file of promptFiles(repo)) {
    const loaded = loadFile(repo, file, notes);
    if (!loaded) continue;
    rows[file.row] = words(loaded.text);
    descriptionWords += words(loaded.description);
    descriptions++;
    for (const rel of new Set(loaded.used)) {
      if (!fragmentUse.has(rel)) fragmentUse.set(rel, new Set());
      fragmentUse.get(rel).add(file.row);
    }
  }
  // The always-on rules files load into every session, inlines resolved.
  let rulesWords = 0;
  for (const n of listDir(path.join(repo, '.claude', 'rules'))) {
    if (!n.endsWith('.md')) continue;
    const raw = readText(path.join(repo, '.claude', 'rules', n));
    if (raw !== null) rulesWords += words(resolveInlines(repo, splitFrontmatter(raw).body, 'rules/' + n, notes).text);
  }
  rows.session = rulesWords + descriptionWords;
  // Only files a prompt file inlines first-level are fragments: a file named only
  // inside another fragment never loads.
  const fragments = [...fragmentUse.entries()]
    .map(([file, users]) => {
      const text = readText(path.resolve(repo, file)) || '';
      return { file, words: words(text), consumers: users.size };
    })
    .sort((a, b) => (b.words * b.consumers) - (a.words * a.consumers) || a.file.localeCompare(b.file));
  const total = Object.entries(rows).filter(([k]) => k !== 'session').reduce((s, [, v]) => s + v, 0);
  return { rows, session: { rulesWords, descriptionWords, descriptions }, total, fragments, notes };
}

function compare(rows, baseRows) {
  const grew = [], shrank = [], added = [], removed = [];
  for (const [row, n] of Object.entries(rows)) {
    if (!(row in baseRows)) added.push({ row, now: n });
    else if (n > baseRows[row]) grew.push({ row, was: baseRows[row], now: n });
    else if (n < baseRows[row]) shrank.push({ row, was: baseRows[row], now: n });
  }
  for (const [row, n] of Object.entries(baseRows)) if (!(row in rows)) removed.push({ row, was: n });
  return { grew, shrank, added, removed };
}

function comparisonLines(label, cmp) {
  const lines = ['baseline ' + label + ': ' + cmp.grew.length + ' grew, ' + cmp.added.length + ' new, '
    + cmp.removed.length + ' removed, ' + cmp.shrank.length + ' shrank'];
  for (const g of cmp.grew) lines.push('  grew     ' + g.row + ' ' + g.was + ' -> ' + g.now + ' (+' + (g.now - g.was) + ')');
  for (const a of cmp.added) lines.push('  new      ' + a.row + ' ' + a.now + ' words (not in the baseline)');
  for (const r of cmp.removed) lines.push('  removed  ' + r.row + ' (was ' + r.was + ' words)');
  return lines;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repo = opts.repo;

  if (opts.print !== null) {
    const rel = opts.print.replace(/\\/g, '/').replace(/^\.\//, '');
    const file = promptFiles(repo).find(f => f.rel === rel || f.row === rel);
    if (!file) usage('--print: ' + opts.print + ' is not a command, skill or agent under .claude/');
    const loaded = loadFile(repo, file, []);
    process.stdout.write(loaded.text);
    return;
  }

  const report = collect(repo);
  const baselineRel = opts.baseline || DEFAULT_BASELINE;
  const baselineAbs = path.resolve(repo, baselineRel);

  if (opts.write) {
    const sorted = {};
    for (const k of Object.keys(report.rows).sort()) sorted[k] = report.rows[k];
    const doc = {
      note: 'Words each prompt file loads, recorded by scripts/prompt-load.js --write-baseline. '
        + 'npm test warns when a row grows past this; refresh it after a deliberate change so later growth is measured from there.',
      rows: sorted,
    };
    fs.mkdirSync(path.dirname(baselineAbs), { recursive: true });
    fs.writeFileSync(baselineAbs, JSON.stringify(doc, null, 2) + '\n');
    console.log('baseline written: ' + baselineRel + ' (' + Object.keys(sorted).length + ' rows)');
    return;
  }

  let baseRows = null;
  const baseText = readText(baselineAbs);
  if (baseText !== null) {
    try { baseRows = JSON.parse(baseText).rows || null; } catch (e) { report.notes.push('baseline ' + baselineRel + ' is not valid JSON (' + e.message + ')'); }
  }
  const cmp = baseRows ? compare(report.rows, baseRows) : null;

  if (opts.json) {
    console.log(JSON.stringify(Object.assign({}, report, { baseline: baseRows ? baselineRel : null, compare: cmp }), null, 2));
    return;
  }

  const out = [];
  if (!opts.warningsOnly) {
    out.push('prompt-load: ' + repo);
    out.push('  words  file');
    for (const [row, n] of Object.entries(report.rows).filter(([k]) => k !== 'session').sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      out.push('  ' + String(n).padStart(5) + '  ' + row);
    }
    out.push('  session  ' + report.rows.session + ' words: the rules files (' + report.session.rulesWords + ') and '
      + report.session.descriptions + ' descriptions (' + report.session.descriptionWords + ') that every session carries');
    out.push('  total    ' + report.total + ' words across ' + (Object.keys(report.rows).length - 1) + ' files, each counted with what it loads');
    out.push('fragments inlined first-level, heaviest first (words x files that load it):');
    for (const f of report.fragments) out.push('  ' + f.words + ' x ' + f.consumers + ' = ' + (f.words * f.consumers) + '  ' + f.file);
  }
  if (cmp) out.push(...comparisonLines(baselineRel, cmp));
  else out.push('no baseline at ' + baselineRel + '; run with --write-baseline to record one');
  for (const n of report.notes) out.push('  note     ' + n);
  console.log(out.join('\n'));
}

main();
