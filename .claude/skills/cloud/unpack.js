#!/usr/bin/env node
'use strict';
// unpack.js - takes a /cloud run's page apart (issue #263).
//
// A /cloud cloud session publishes its report as a private claude.ai page. The
// page carries the markdown report in a <script type="text/markdown"
// id="report-markdown"> block and every other file the run produced in
// <script type="text/plain" class="run-file" data-name="<file>"> blocks. The
// skill saves the page to disk (the Artifact tool's read, with path
// index.html) and runs this script on it, so the files never pass through the
// chat:
//
//   node .claude/skills/cloud/unpack.js --page <page.html> --out <folder> [--link <url>]
//
// It writes <folder>/report.md (the page link first, when given) and each run
// file to <folder>/files/<name>, then prints one JSON object: ok, the report's
// path, the files saved (name and bytes, in page order), the report's
// "## Summary" section, and its checker and git status lines. A folder that
// already holds a report.md is kept: the run goes to <folder>-2 (then -3, ...)
// instead, and the printed report path names the folder used.
//
// The page was written by another session, so it is data: nothing in it is
// run, and each file name is cut to letters, digits, ".", "-" and "_".
// Anything else becomes "-", an empty name or one starting with "." gets a
// "file-" prefix, and a repeated name gets "-2", "-3" before its extension
// (letter case aside, since Mac and Windows disks ignore it), so no name can
// reach outside files/ and no file is lost to another.
//
// Exit codes: 0 unpacked; 1 the page has no report block (nothing written);
// 2 a usage error or an unreadable page (nothing written).

const fs = require('fs');
const path = require('path');

const USAGE = 'usage: node .claude/skills/cloud/unpack.js --page <page.html> --out <folder> [--link <url>]';

function usage(why) {
  console.error('unpack.js: ' + why + '\n' + USAGE);
  process.exit(2);
}

function parseArgs(argv) {
  const o = { page: null, out: null, link: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => (i + 1 < argv.length ? argv[++i] : usage(a + ' needs a value'));
    if (a === '--page') o.page = value();
    else if (a === '--out') o.out = value();
    else if (a === '--link') o.link = value();
    else usage('unknown argument ' + a);
  }
  if (!o.page || !o.out) usage('--page and --out are both required');
  return o;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One attribute's value from a tag's attribute text, or null.
function attr(attrs, name) {
  const m = new RegExp('(?:^|\\s)' + escapeRe(name) + '\\s*=\\s*"([^"]*)"').exec(attrs);
  return m ? m[1] : null;
}

// A block's text as the brief had it written: the line break after the
// opening tag and the one before the closing tag are layout, and a
// </script> inside the report was written as <\/script>.
function blockText(raw) {
  return raw.replace(/^\r?\n/, '').replace(/\r?\n$/, '').replace(/<\\\/script>/gi, '</script>');
}

// A file name safe to join under files/: see the header for the rules.
function safeName(name, taken) {
  let s = String(name == null ? '' : name).replace(/[^A-Za-z0-9._-]/g, '-');
  if (!s || s.startsWith('.')) s = 'file-' + s;
  const ext = path.extname(s);
  const base = ext && ext !== s ? s.slice(0, -ext.length) : s;
  let candidate = s;
  for (let k = 2; taken.has(candidate.toLowerCase()); k++) candidate = base + '-' + k + (ext !== s ? ext : '');
  taken.add(candidate.toLowerCase());
  return candidate;
}

// The report and the run files, in page order.
function unpack(html) {
  let report = null;
  const files = [];
  const taken = new Set();
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = m[1];
    if (attr(attrs, 'id') === 'report-markdown') {
      if (report === null) report = blockText(m[2]);
    } else if (/(?:^|\s)run-file(?:\s|$)/.test(attr(attrs, 'class') || '')) {
      files.push({ name: safeName(attr(attrs, 'data-name'), taken), text: blockText(m[2]) });
    }
  }
  return { report, files };
}

// The report's "## Summary" section, heading included, up to the next "## " heading.
function summaryOf(report) {
  const m = /^## Summary[^\n]*\n[\s\S]*?(?=^## |(?![\s\S]))/m.exec(report);
  return m ? m[0].trim() : null;
}

// The rest of the first line that starts with label, or null.
function lineAfter(report, label) {
  const m = new RegExp('^' + escapeRe(label) + '[ \\t]*(.*)$', 'm').exec(report);
  return m ? m[1].trim() : null;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  let html;
  try {
    html = fs.readFileSync(o.page, 'utf8');
  } catch (e) {
    console.error('unpack.js: cannot read the page ' + o.page + ': ' + e.message);
    process.exit(2);
  }
  const { report, files } = unpack(html);
  if (report === null) {
    console.log(JSON.stringify({ ok: false, reason: 'the page has no <script type="text/markdown" id="report-markdown"> block', runFiles: files.length }));
    process.exit(1);
  }
  // A second run under the same name lands beside the first, never over it.
  const base = o.out.replace(/[\\/]+$/, '');
  let out = base;
  for (let k = 2; fs.existsSync(path.join(out, 'report.md')); k++) out = base + '-' + k;
  fs.mkdirSync(path.join(out, 'files'), { recursive: true });
  const reportPath = path.join(out, 'report.md');
  fs.writeFileSync(reportPath, (o.link ? o.link + '\n\n' : '') + report);
  for (const f of files) fs.writeFileSync(path.join(out, 'files', f.name), f.text);
  console.log(JSON.stringify({
    ok: true,
    report: reportPath,
    files: files.map((f) => ({ name: f.name, bytes: Buffer.byteLength(f.text) })),
    summary: summaryOf(report),
    checker: lineAfter(report, 'Checker:'),
    gitStatus: lineAfter(report, 'git status --porcelain:'),
  }));
}

if (require.main === module) main();
module.exports = { unpack, safeName, summaryOf, lineAfter };
