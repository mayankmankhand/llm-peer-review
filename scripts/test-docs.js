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

// The hash must cover the whole Mermaid config the render passes, not only the
// base settings: an edit to the color mapping or the font changes every image,
// so it has to make every image stale too.
(function hashCase() {
  const name = 'the freshness hash covers the full render config';
  if (!renderer || typeof renderer.hashInput !== 'function') { check(name, false, 'scripts/render-diagrams.js exports no hashInput'); return; }
  const palettes = renderer.readPalettes(fs.readFileSync(path.join(REPO, renderer.TOKENS_PATH), 'utf8'));
  const input = JSON.parse(renderer.hashInput('flowchart TB\n  A --- B\n', 'light', palettes.light));
  check(name, JSON.stringify(input.config) === JSON.stringify(renderer.renderConfig(palettes.light, 'light')),
    'the hash input does not carry the full render config');
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

// The walk lives in the shipped .claude/scripts/doc-check.js (issue #262), so
// the link check every project's documentation stage runs is this one: which
// docs count, how fences, comments and inline code are skipped, and how
// GitHub's heading anchors are named are all defined there, once. Loaded
// lazily, so a missing script is a failed case, not a crash.
let docCheck = null;
try { docCheck = require('../.claude/scripts/doc-check.js'); } catch (e) { docCheck = null; }
if (!docCheck) check('every relative link and anchor in the docs resolves', false, '.claude/scripts/doc-check.js could not be loaded');
else {
  const broken = docCheck.brokenLinks(REPO).map(b => b.doc + ':' + b.line + ': ' + b.target + ' (' + b.problem + ')');
  check('every relative link and anchor in the docs resolves', broken.length === 0, broken.length + ' broken: ' + broken.join('; '));
}

// ---- summary -------------------------------------------------------------------

console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach(f => console.log('  FAIL ' + f.slice(0, 400)));
process.exit(1);
