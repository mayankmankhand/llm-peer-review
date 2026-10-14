#!/usr/bin/env node
'use strict';
// test-docs.js - assertions for the human-readable docs and the diagrams in
// them. Every diagram source in docs/diagrams/ has a light and a dark image in
// docs/images/diagrams/ rendered from its current text (the hash line
// scripts/render-diagrams.js writes on line 1), in plain SVG text (no
// foreignObject, which non-browser viewers drop) and under the size cap; every
// source names itself for screen readers (accTitle, accDescr); a changed
// source is reported stale; and every relative link and heading anchor in
// README.md, the root guides and docs/ resolves.
//
// No browser and no Mermaid: freshness recomputes the hash render-diagrams.js
// stamped, it never renders, so CI runs this with nothing installed.
// Dependency-free; exits non-zero on any failure.
//
//   node scripts/test-docs.js

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failures.push(name + (detail ? ' - ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' - ' + String(detail).slice(0, 300) : '')); }
}

// The renderer owns the hash, the palettes and the folder names; the test only
// reads them. Loaded lazily so a missing renderer is a failed case, not a crash.
let renderer = null;
try { renderer = require('./render-diagrams.js'); } catch (e) { renderer = null; }
const SOURCE_DIR = renderer ? renderer.SOURCE_DIR : 'docs/diagrams';
const IMAGE_DIR = renderer ? renderer.IMAGE_DIR : 'docs/images/diagrams';

function listSources(root) {
  const dir = path.join(root, SOURCE_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(n => n.endsWith('.mmd')).map(n => n.slice(0, -4)).sort();
}

// Every reason one diagram's images do not match its source, or [] when fresh.
function diagramProblems(root, name) {
  if (!renderer) return ['scripts/render-diagrams.js is missing'];
  const srcFile = path.join(root, SOURCE_DIR, name + '.mmd');
  if (!fs.existsSync(srcFile)) return [SOURCE_DIR + '/' + name + '.mmd is missing'];
  const source = fs.readFileSync(srcFile, 'utf8');
  const palettes = renderer.readPalettes(fs.readFileSync(path.join(root, renderer.TOKENS_PATH), 'utf8'));
  const problems = [];
  for (const theme of renderer.THEMES) {
    const rel = IMAGE_DIR + '/' + name + '-' + theme + '.svg';
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) { problems.push(rel + ' is missing'); continue; }
    const svg = fs.readFileSync(file, 'utf8');
    const stamp = renderer.parseHashLine(svg);
    const want = renderer.sourceHash(source, theme, palettes[theme]);
    if (!stamp) problems.push(rel + ' has no render line');
    else if (stamp.sha256 !== want) problems.push(rel + ' is stale: run node scripts/render-diagrams.js ' + name);
    if (/<foreignObject/.test(svg)) problems.push(rel + ' uses foreignObject labels');
    if (Buffer.byteLength(svg) > renderer.SIZE_CAP) problems.push(rel + ' is ' + Buffer.byteLength(svg) + ' bytes, over ' + renderer.SIZE_CAP);
  }
  return problems;
}

// ---- diagrams ---------------------------------------------------------------

const overview = diagramProblems(REPO, 'overview');
check('overview diagram has fresh light and dark images', overview.length === 0, overview.join('; '));

const sources = listSources(REPO);
const every = sources.flatMap(n => diagramProblems(REPO, n));
check('every diagram source has fresh light and dark images in plain SVG text under 100 KB', every.length === 0, every.join('; '));

const unnamed = sources.filter(n => {
  const text = fs.readFileSync(path.join(REPO, SOURCE_DIR, n + '.mmd'), 'utf8');
  return !/^\s*accTitle:\s*\S/m.test(text) || !/^\s*accDescr:\s*\S/m.test(text);
});
check('every diagram source has accTitle and accDescr', unnamed.length === 0, unnamed.join(', '));

// A source edited after its render must be reported stale: copy the overview,
// its images and the tokens into a temp root, confirm the copy is fresh, then
// change one line of the source.
(function staleCase() {
  const name = 'overview';
  if (!renderer || !fs.existsSync(path.join(REPO, SOURCE_DIR, name + '.mmd'))) {
    check('a changed source is reported stale', false, 'needs scripts/render-diagrams.js and ' + SOURCE_DIR + '/' + name + '.mmd');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-docs-'));
  try {
    const copy = rel => {
      const to = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (fs.existsSync(path.join(REPO, rel))) fs.copyFileSync(path.join(REPO, rel), to);
    };
    copy(renderer.TOKENS_PATH);
    copy(SOURCE_DIR + '/' + name + '.mmd');
    for (const theme of renderer.THEMES) copy(IMAGE_DIR + '/' + name + '-' + theme + '.svg');
    const before = diagramProblems(tmp, name);
    fs.appendFileSync(path.join(tmp, SOURCE_DIR, name + '.mmd'), '\n%% an edit after the render\n');
    const after = diagramProblems(tmp, name);
    check('a changed source is reported stale', before.length === 0 && after.some(p => /is stale/.test(p)),
      'fresh copy: [' + before.join('; ') + '], edited copy: [' + after.join('; ') + ']');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();

// ---- the tour ------------------------------------------------------------------

// docs/HOW-IT-WORKS.md shows every diagram in a <picture>: a dark source the
// viewer's theme picks, a light <img> with alt text for everyone else, and a
// short plain-text list under it (at least three items before the next
// heading), which is what a screen reader or a text-only viewer gets.
const TOUR = 'docs/HOW-IT-WORKS.md';
const PLANNED = ['overview', 'explore', 'create-plan', 'execute', 'review', 'document', 'merge', 'hooks', 'side-trips', 'files'];
(function tourCase() {
  const file = path.join(REPO, TOUR);
  if (!fs.existsSync(file)) { check('the tour embeds all ten diagrams with alt text and a dark source', false, TOUR + ' is missing'); return; }
  const text = fs.readFileSync(file, 'utf8');
  const embedded = new Map();
  for (const m of text.matchAll(/<picture>([\s\S]*?)<\/picture>([\s\S]*?)(?=\n#{1,6}\s|<picture>|$)/g)) {
    const dark = (m[1].match(/<source\s+media="\(prefers-color-scheme: dark\)"\s+srcset="images\/diagrams\/([a-z0-9-]+)-dark\.svg"/) || [])[1];
    const img = m[1].match(/<img\s+src="images\/diagrams\/([a-z0-9-]+)-light\.svg"\s+alt="([^"]*)"/);
    const items = (m[2].match(/^\s*(?:[-*]|\d+\.)\s+\S/gm) || []).length;
    if (img) embedded.set(img[1], { dark: dark === img[1], alt: img[2].trim().length >= 20, items });
  }
  const problems = [];
  for (const name of new Set([...PLANNED, ...listSources(REPO)])) {
    const e = embedded.get(name);
    if (!e) { problems.push(name + ' is not embedded'); continue; }
    if (!e.dark) problems.push(name + ' has no matching dark source');
    if (!e.alt) problems.push(name + ' has no real alt text');
    if (e.items < 3) problems.push(name + ' has ' + e.items + ' list items under it, not 3 or more');
  }
  check('the tour embeds all ten diagrams with alt text and a dark source', problems.length === 0, problems.join('; '));
})();

// ---- links -------------------------------------------------------------------

// The human-readable docs: README, the root guides and everything under docs/.
// CHANGELOG is history (its old links name files as they were), and the rest
// are the owner's working files, read by Claude rather than by visitors.
const NOT_DOCS = new Set(['CHANGELOG.md', 'CLAUDE.md', 'CODEBASE_MAP.md', 'DESIGN-PROFILE.md', 'LESSONS.md', 'LESSONS-detail.md']);
function docFiles() {
  const files = fs.readdirSync(REPO).filter(n => n.endsWith('.md') && !NOT_DOCS.has(n));
  const walk = rel => {
    for (const ent of fs.readdirSync(path.join(REPO, rel), { withFileTypes: true })) {
      const child = rel + '/' + ent.name;
      if (ent.isDirectory()) walk(child);
      else if (ent.name.endsWith('.md')) files.push(child);
    }
  };
  if (fs.existsSync(path.join(REPO, 'docs'))) walk('docs');
  return files.sort();
}

// The text a scanner should read: fenced blocks and HTML comments removed, so
// an example path is never mistaken for a link. Inline code goes first, before
// the comment pass, because docs quote `<!--` in code and that must not open a
// comment that swallows the headings below it. Links drop inline code; anchors
// keep its text (keepCode), as GitHub does when it names a heading.
function prose(text, keepCode) {
  const out = [];
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) { if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null; out.push(''); continue; }
    if (m) { fence = m[1]; out.push(''); continue; }
    out.push(line);
  }
  return out.join('\n')
    .replace(/``([^`\n]*)``|`([^`\n]*)`/g, (all, a, b) => keepCode ? (a != null ? a : b).replace(/<!--|-->/g, '') : '')
    .replace(/<!--[\s\S]*?-->/g, '');
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

function targets(text) {
  const body = prose(text);
  const found = [];
  for (const m of body.matchAll(/!?\[(?:[^\][]|\[[^\]]*\])*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) found.push(m[1]);
  for (const m of body.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm)) found.push(m[1]);
  for (const m of body.matchAll(/\b(?:src|href|srcset)\s*=\s*"([^"]+)"/g)) found.push(m[1].split(',')[0].trim().split(/\s+/)[0]);
  return found.filter(t => t && !/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith('//'));
}

const anchorCache = new Map();
const broken = [];
for (const rel of docFiles()) {
  const text = fs.readFileSync(path.join(REPO, rel), 'utf8');
  for (const t of targets(text)) {
    const hash = t.indexOf('#');
    const pathPart = hash === -1 ? t : t.slice(0, hash);
    const anchor = hash === -1 ? '' : t.slice(hash + 1);
    let decoded;
    try { decoded = decodeURIComponent(pathPart); } catch (e) { broken.push(rel + ': ' + t + ' (bad escape)'); continue; }
    const abs = decoded === '' ? path.join(REPO, rel)
      : decoded.startsWith('/') ? path.join(REPO, decoded) : path.resolve(REPO, path.dirname(rel), decoded);
    if (path.relative(REPO, abs).startsWith('..')) { broken.push(rel + ': ' + t + ' (outside the repository)'); continue; }
    if (!fs.existsSync(abs)) { broken.push(rel + ': ' + t + ' (no such file)'); continue; }
    if (anchor && abs.endsWith('.md')) {
      if (!anchorCache.has(abs)) anchorCache.set(abs, anchors(fs.readFileSync(abs, 'utf8')));
      if (!anchorCache.get(abs).has(decodeURIComponent(anchor).toLowerCase())) broken.push(rel + ': ' + t + ' (no such heading)');
    }
  }
}
check('every relative link and anchor in the docs resolves', broken.length === 0, broken.length + ' broken: ' + broken.join('; '));

// ---- summary -------------------------------------------------------------------

console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach(f => console.log('  FAIL ' + f.slice(0, 400)));
process.exit(1);
