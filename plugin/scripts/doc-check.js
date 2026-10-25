#!/usr/bin/env node
'use strict';
// doc-check.js - the places a script can be sure the docs and the code disagree
// (issue #262). Two checks, both narrow on purpose:
//
//   links      every relative link and heading anchor in the docs that no
//              longer resolves. Runs over every doc on every run.
//   oldNames   with --window, every doc that still names a file or command the
//              window deleted or renamed. Only exact names count: a backtick
//              word or a link target equal to the old path, a bare file name
//              only when no file in the window's end still has that name, and
//              /name or /tk:name only when no command or skill of that name is
//              left.
//
// Why narrow: a probe that scoped #262 checked every backticked file name and
// slash command in one repo's docs. 87 of 553 names and 13 of 428 commands did
// not exist, and none of them was drift: they named files in other people's
// projects, retired files listed on purpose, placeholders, package names and
// Claude Code's own commands. Naming something that does not exist is usually
// right, so the script reports only what a change of this window took away,
// and everything else stays with the reader's judgment.
//
// Which docs: README and the other root guides, and everything under docs/.
// CHANGELOG is history (its old names are right for their time), and the rest
// are the owner's working files, read by Claude rather than by visitors.
// Fenced blocks and HTML comments are never read, so an example is never
// mistaken for a claim.
//
//   node .claude/scripts/doc-check.js [--window <base>..<head>]
//
// Prints one JSON line, whatever it finds:
//   {"docs":N,"window":"<base>..<head>"|null,
//    "links":[{"doc","line","target","problem"}],
//    "oldNames":[{"doc","line","name","was"}],
//    "summary":"N docs: X broken links, Y old names"}
// "was" is "deleted" or "renamed to <path>". A link whose target is an old name
// is reported once, under oldNames, because that entry says where it went.
// Exits 0 on any finding; 2 on a bad argument or a window git cannot read,
// with the reason on stderr. Run from the project root (it reads the
// repository the working folder is in). Dependency-free; git runs through
// execFileSync with an argument list, never a shell.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const NOT_DOCS = new Set(['CHANGELOG.md', 'CLAUDE.md', 'CODEBASE_MAP.md', 'DESIGN-PROFILE.md', 'LESSONS.md', 'LESSONS-detail.md']);

// The docs under a root, repo-relative with forward slashes, sorted.
function docFiles(root) {
  const files = fs.readdirSync(root).filter(n => n.endsWith('.md') && !NOT_DOCS.has(n));
  const walk = rel => {
    for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = rel + '/' + ent.name;
      if (ent.isDirectory()) walk(child);
      else if (ent.name.endsWith('.md')) files.push(child);
    }
  };
  if (fs.existsSync(path.join(root, 'docs'))) walk('docs');
  return files.sort();
}

// Blank out every fenced block, keeping one empty line per line so line
// numbers still point at the doc.
function blankFences(text) {
  const out = [];
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) { if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null; out.push(''); continue; }
    if (m) { fence = m[1]; out.push(''); continue; }
    out.push(line);
  }
  return out.join('\n');
}

// An HTML comment becomes its own newlines, so the lines below keep their numbers.
function blankComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ''));
}

// The text a link scanner should read: no fences, no comments. Inline code goes
// first, before the comment pass, because docs quote `<!--` in code and that
// must not open a comment that swallows the headings below it. Links drop
// inline code; anchors keep its text (keepCode), as GitHub does when it names
// a heading.
function prose(text, keepCode) {
  return blankComments(blankFences(text)
    .replace(/``([^`\n]*)``|`([^`\n]*)`/g, (all, a, b) => keepCode ? (a != null ? a : b).replace(/<!--|-->/g, '') : ''));
}

// Every inline code span outside fences and comments, with its line. A span is
// swapped for a marker before the comment pass, for the reason prose() gives,
// and is kept only when its marker survives that pass.
function codeSpans(text) {
  const spans = [];
  const marked = blankFences(text).replace(/``([^`\n]*)``|`([^`\n]*)`/g, (all, a, b) => {
    spans.push(a != null ? a : b);
    return '\u0000' + (spans.length - 1) + '\u0000';
  });
  const body = blankComments(marked);
  const found = [];
  for (const m of body.matchAll(/\u0000(\d+)\u0000/g)) found.push({ text: spans[Number(m[1])], line: lineAt(body, m.index) });
  return found;
}

function lineAt(body, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (body.charCodeAt(i) === 10) n++;
  return n;
}

// GitHub's heading anchors: lowercase, punctuation dropped (letters, numbers,
// spaces, hyphens and underscores kept), each space a hyphen, and a repeated
// heading suffixed -1, -2 in order.
function anchors(text) {
  const seen = new Map();
  const out = new Set();
  for (const line of prose(text, true).split('\n')) {
    const h = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (h) {
      const base = h[1].replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '')
        .toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-');
      const n = seen.get(base) || 0;
      seen.set(base, n + 1);
      out.add(n ? base + '-' + n : base);
    }
    for (const a of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) out.add(a[1].toLowerCase());
  }
  return out;
}

// Every relative link target in a doc, with its line: inline links and images,
// reference definitions, and src/href/srcset attributes. URLs with a scheme and
// protocol-relative ones are not ours to check.
function linkTargets(text) {
  const body = prose(text);
  const found = [];
  const add = (target, index) => found.push({ target: target, line: lineAt(body, index) });
  for (const m of body.matchAll(/!?\[(?:[^\][]|\[[^\]]*\])*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) add(m[1], m.index + m[0].lastIndexOf(m[1]));
  for (const m of body.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm)) add(m[1], m.index);
  for (const m of body.matchAll(/\b(?:src|href|srcset)\s*=\s*"([^"]+)"/g)) add(m[1].split(',')[0].trim().split(/\s+/)[0], m.index);
  return found.filter(t => t.target && !/^[a-z][a-z0-9+.-]*:/i.test(t.target) && !t.target.startsWith('//'));
}

// Split a link target into the repo-relative path it points at and its anchor.
// null path means the target is not a path we can read (a bad escape).
function resolveTarget(root, doc, target) {
  const hash = target.indexOf('#');
  const pathPart = hash === -1 ? target : target.slice(0, hash);
  const anchor = hash === -1 ? '' : target.slice(hash + 1);
  let decoded;
  try { decoded = decodeURIComponent(pathPart); } catch (e) { return { abs: null, anchor: anchor }; }
  const abs = decoded === '' ? path.join(root, doc)
    : decoded.startsWith('/') ? path.join(root, decoded) : path.resolve(root, path.dirname(doc), decoded);
  return { abs: abs, rel: path.relative(root, abs).split(path.sep).join('/'), anchor: anchor };
}

// Every link or anchor in the docs that does not resolve.
function brokenLinks(root) {
  const anchorCache = new Map();
  const broken = [];
  for (const doc of docFiles(root)) {
    const text = fs.readFileSync(path.join(root, doc), 'utf8');
    for (const t of linkTargets(text)) {
      const r = resolveTarget(root, doc, t.target);
      const report = problem => broken.push({ doc: doc, line: t.line, target: t.target, problem: problem });
      if (r.abs === null) { report('bad escape'); continue; }
      if (r.rel.startsWith('..')) { report('outside the repository'); continue; }
      if (!fs.existsSync(r.abs)) { report('no such file'); continue; }
      if (r.anchor && r.abs.endsWith('.md')) {
        if (!anchorCache.has(r.abs)) anchorCache.set(r.abs, anchors(fs.readFileSync(r.abs, 'utf8')));
        let wanted;
        try { wanted = decodeURIComponent(r.anchor).toLowerCase(); } catch (e) { report('bad escape'); continue; }
        if (!anchorCache.get(r.abs).has(wanted)) report('no such heading');
      }
    }
  }
  return broken;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

// The command a file defines, or null: .claude/commands/<name>.md or
// .claude/skills/<name>/SKILL.md.
function commandOf(file) {
  const m = file.match(/^\.claude\/commands\/([^/]+)\.md$/) || file.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/);
  return m ? m[1] : null;
}

// What the window took away: each deleted or renamed file, each command whose
// last defining file went with it, and the file names still present at its end.
function windowChanges(root, base, head) {
  const gone = new Map(); // old path -> 'deleted' | 'renamed to <new>'
  for (const line of git(root, ['diff', '--name-status', '-M', base, head, '--']).split('\n')) {
    const parts = line.split('\t');
    if (/^D/.test(parts[0]) && parts[1]) gone.set(parts[1], 'deleted');
    else if (/^R/.test(parts[0]) && parts[2]) gone.set(parts[1], 'renamed to ' + parts[2]);
  }
  const files = git(root, ['ls-tree', '-r', '--name-only', head]).split('\n').filter(Boolean);
  const names = new Set(files.map(f => f.split('/').pop()));
  const commandsLeft = new Set(files.map(commandOf).filter(Boolean));
  const goneCommands = new Map(); // name -> 'deleted' | 'renamed to /<new>'
  for (const [file, was] of gone) {
    const name = commandOf(file);
    if (!name || commandsLeft.has(name)) continue;
    const to = was.startsWith('renamed to ') ? commandOf(was.slice('renamed to '.length)) : null;
    goneCommands.set(name, to ? 'renamed to /' + to : 'deleted');
  }
  return { gone: gone, names: names, goneCommands: goneCommands };
}

// The old name a word in a doc refers to, and what happened to it, or null.
function oldNameOf(word, changes) {
  const cmd = word.match(/^\/(?:tk:)?([A-Za-z0-9][A-Za-z0-9._-]*)$/);
  if (cmd) return changes.goneCommands.has(cmd[1]) ? changes.goneCommands.get(cmd[1]) : null;
  const clean = word.replace(/^\.\//, '').replace(/#.*$/, '').replace(/(:\d+)+$/, '').replace(/\/$/, '');
  if (changes.gone.has(clean)) return changes.gone.get(clean);
  if (clean.includes('/') || changes.names.has(clean)) return null;
  for (const [file, was] of changes.gone) if (file.split('/').pop() === clean) return was;
  return null;
}

// Every doc line that still names something the window took away.
function oldNames(root, base, head) {
  const changes = windowChanges(root, base, head);
  if (changes.gone.size === 0) return [];
  const found = [];
  for (const doc of docFiles(root)) {
    const text = fs.readFileSync(path.join(root, doc), 'utf8');
    for (const span of codeSpans(text)) {
      for (const raw of span.text.split(/\s+/)) {
        const word = raw.replace(/^["'(]+|["'),.;]+$/g, '');
        const was = word && oldNameOf(word, changes);
        if (was) found.push({ doc: doc, line: span.line, name: word, was: was });
      }
    }
    for (const t of linkTargets(text)) {
      const r = resolveTarget(root, doc, t.target);
      if (r.abs === null || r.rel.startsWith('..')) continue;
      if (changes.gone.has(r.rel)) found.push({ doc: doc, line: t.line, name: t.target, was: changes.gone.get(r.rel) });
    }
  }
  return found;
}

// A window side git may read: never one that starts with a dash, which git
// would take as an option.
function parseWindow(w) {
  const m = typeof w === 'string' ? w.match(/^([^.\s][^\s]*?)\.\.([^.\s][^\s]*)$/) : null;
  if (!m || m[1].startsWith('-') || m[2].startsWith('-')) return null;
  return { base: m[1], head: m[2] };
}

function main(argv) {
  let windowArg = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--window' && i + 1 < argv.length) windowArg = argv[++i];
    else return fail('unknown argument: ' + argv[i]);
  }
  let root = process.cwd();
  try { root = git(root, ['rev-parse', '--show-toplevel']).trim() || root; } catch (e) { /* not a repository: links still work */ }
  let win = null;
  let old = [];
  if (windowArg !== null) {
    win = parseWindow(windowArg);
    if (!win) return fail('--window takes <base>..<head>, neither side starting with a dash: ' + windowArg);
    try {
      // Resolve both sides first, so an unknown ref is a clear error rather
      // than a diff of something else.
      win.base = git(root, ['rev-parse', '--verify', '--quiet', win.base + '^{commit}']).trim();
      win.head = git(root, ['rev-parse', '--verify', '--quiet', win.head + '^{commit}']).trim();
      old = oldNames(root, win.base, win.head);
    } catch (e) {
      return fail('git could not read the window ' + windowArg + ': ' + String(e.stderr || e.message).trim().split('\n')[0]);
    }
  }
  const reported = new Set(old.map(o => o.doc + '\n' + o.line + '\n' + o.name));
  const links = brokenLinks(root).filter(l => !reported.has(l.doc + '\n' + l.line + '\n' + l.target));
  const docs = docFiles(root).length;
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  process.stdout.write(JSON.stringify({
    docs: docs,
    window: windowArg,
    links: links,
    oldNames: old,
    summary: plural(docs, 'doc') + ': ' + plural(links.length, 'broken link') + ', ' + plural(old.length, 'old name'),
  }) + '\n');
  return 0;
}

function fail(msg) {
  process.stderr.write('doc-check: ' + msg + '\nusage: node doc-check.js [--window <base>..<head>]\n');
  return 2;
}

module.exports = { NOT_DOCS, docFiles, prose, codeSpans, anchors, linkTargets, brokenLinks, oldNames };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
