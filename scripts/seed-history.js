#!/usr/bin/env node
'use strict';
// seed-history.js - write the two seed history files the upgrade audit reads
// (C-15 and C-16) from the seed files at every release tag:
//
//   seed/historical-seed-blocks.txt   one line per seeded block, and per whole
//       seed file, a release from --from on shipped: its hash, its kind, the
//       project file it is written into, and the first release that shipped it.
//       The audit reports a block of a project's file that equals one of these
//       and not the current seed's, with the current text as the fix. A block
//       equal to no seed version is the owner's own text and is never reported.
//   seed/toolkit-lesson-leads.txt     every bold lead the toolkit's own
//       LESSONS.md has carried, at every tag and in the working tree. The
//       copy-installers (setup.sh, setup.ps1) copy that file into a fresh
//       project, and the v7.0.x plugin seed carried the same lessons, so a
//       project bullet with one of these leads is the toolkit's lesson, not the
//       project's, and the audit reports it.
//
// Run it in the release order (CONTRIBUTING.md), before the release commit, so
// both files ship with the release. It reads the git tags of the form
// v<x>.<y>.<z>; what each tag shipped is read from git, never from the working
// tree, except the working tree's own LESSONS.md for the leads.
//
//   node scripts/seed-history.js [--repo <dir>] [--from <tag>] [--check]
//                                [--blocks <file>] [--leads <file>]
//
// --check writes nothing and exits 1 when either file on disk differs from what
// the tags give, which is how a test confirms the files are current.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
// The block and lesson readers are the audit's own (one definition, one hash):
// upgrade-audit.js exports them and runs its audit only when invoked directly.
const sb = require('../.claude/scripts/upgrade-audit.js');

const DEFAULT_FROM = 'v6.0.0';
const VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const USAGE = 'usage: node scripts/seed-history.js [--repo <dir>] [--from <tag>] [--check] [--blocks <file>] [--leads <file>]';

function parseArgs(argv) {
  const o = { repo: path.resolve(__dirname, '..'), from: DEFAULT_FROM, check: false, blocks: null, leads: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') o.repo = path.resolve(argv[++i] || '');
    else if (a === '--from') o.from = argv[++i] || '';
    else if (a === '--check') o.check = true;
    else if (a === '--blocks') o.blocks = path.resolve(argv[++i] || '');
    else if (a === '--leads') o.leads = path.resolve(argv[++i] || '');
    else if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    else { console.error('seed-history: unknown argument ' + a + '\n' + USAGE); process.exit(2); }
  }
  if (!VERSION_TAG.test(o.from)) { console.error('seed-history: --from takes a tag such as v6.0.0, got ' + JSON.stringify(o.from)); process.exit(2); }
  if (o.blocks === null) o.blocks = path.join(o.repo, 'seed', 'historical-seed-blocks.txt');
  if (o.leads === null) o.leads = path.join(o.repo, 'seed', 'toolkit-lesson-leads.txt');
  return o;
}

function git(repo, args) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}
function parseVersion(tag) { const m = VERSION_TAG.exec(tag); return [Number(m[1]), Number(m[2]), Number(m[3])]; }
function compareTags(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
// Every v<x>.<y>.<z> tag, oldest first; any other tag is not a release.
function versionTags(repo) {
  const out = git(repo, ['tag', '--list']);
  if (out === null) { console.error('seed-history: not a git repository: ' + repo); process.exit(1); }
  return out.split(/\r?\n/).filter(t => VERSION_TAG.test(t)).sort(compareTags);
}
// The file at a tag, or null when that tag has no such file.
function fileAt(repo, tag, rel) { return git(repo, ['show', tag + ':' + rel]); }

function collect(repo, from) {
  const tags = versionTags(repo);
  if (!tags.includes(from)) { console.error('seed-history: no tag ' + from + ' in ' + repo); process.exit(1); }
  // blocks: project file -> hash -> { kind, release }. The first tag that
  // shipped a block wins, so the tags are walked oldest first.
  const blocks = new Map();
  const record = (rel, hash, kind, release) => {
    if (!blocks.has(rel)) blocks.set(rel, new Map());
    const m = blocks.get(rel);
    if (!m.has(hash)) m.set(hash, { kind, release });
  };
  // leads: key -> the first spelling seen.
  const leads = new Map();
  const addLeads = (text) => {
    for (const b of sb.lessonBullets(sb.normalizeLines(text))) {
      if (!b.lead) continue;
      const k = sb.leadKey(b.lead);
      if (k && !leads.has(k)) leads.set(k, b.lead);
    }
  };
  for (const tag of tags) {
    if (compareTags(tag, from) >= 0) {
      for (const sf of sb.SEED_FILES) {
        for (const rel of sf.history) {
          const text = fileAt(repo, tag, rel);
          if (text === null) continue;
          const lines = sb.normalizeLines(text);
          record(sf.rel, sb.fileHash(lines), 'file', tag);
          for (const b of sb.blocksOf(sf.kind, lines)) record(sf.rel, sb.hashLines(b.lines), 'block', tag);
        }
      }
    }
    for (const rel of sb.LESSON_SOURCES) { const text = fileAt(repo, tag, rel); if (text !== null) addLeads(text); }
  }
  // The working tree's own lessons file: a copy-install made from main between
  // two releases carries it too.
  const own = path.join(repo, 'LESSONS.md');
  if (fs.existsSync(own)) addLeads(fs.readFileSync(own, 'utf8'));
  return { tags, blocks, leads };
}

function blocksText(blocks, from, tags) {
  const order = sb.SEED_FILES.map(s => s.rel);
  const rows = [];
  for (const [rel, m] of blocks) for (const [hash, { kind, release }] of m) rows.push({ rel, hash, kind, release });
  const str = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  rows.sort((a, b) => (order.indexOf(a.rel) - order.indexOf(b.rel)) || str(a.kind, b.kind) || compareTags(a.release, b.release) || str(a.hash, b.hash));
  const lines = [
    '# Seeded blocks older releases shipped, for the upgrade audit (C-15).',
    '# <hash> <block|file> <project file> <first release that shipped it>',
    '# Written by scripts/seed-history.js from the release tags ' + from + ' to ' + tags[tags.length - 1] + '; regenerate it in the release order, never edit it by hand.',
  ];
  for (const r of rows) lines.push(r.hash + ' ' + r.kind + ' ' + r.rel + ' ' + r.release);
  return lines.join('\n') + '\n';
}
function leadsText(leads) {
  const lines = [
    '# Bold leads the toolkit\'s own LESSONS.md has carried, for the upgrade audit (C-16).',
    '# The copy-installers copy that file into a fresh project and the v7.0.x plugin seed carried the same',
    '# lessons, so a project bullet with one of these leads is the toolkit\'s lesson. One lead per line.',
    '# Written by scripts/seed-history.js from the release tags and the working tree; never edit it by hand.',
  ];
  const sorted = [...leads.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return lines.concat(sorted).join('\n') + '\n';
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const { tags, blocks, leads } = collect(o.repo, o.from);
  const want = [[o.blocks, blocksText(blocks, o.from, tags)], [o.leads, leadsText(leads)]];
  let stale = 0;
  for (const [file, text] of want) {
    const shown = path.relative(o.repo, file) || file;
    const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (have === text) { console.error('seed-history: ' + shown + ' is current'); continue; }
    if (o.check) {
      stale++;
      console.error('seed-history: ' + shown + (have === null ? ' is missing' : ' differs from what the tags give') + '; run node scripts/seed-history.js');
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.error('seed-history: wrote ' + shown);
  }
  const entries = [...blocks.values()].reduce((n, m) => n + m.size, 0);
  console.error('seed-history: ' + tags.length + ' release tag(s), ' + entries + ' block and file entries from ' + o.from + ' on, ' + leads.size + ' lesson leads');
  if (stale) process.exit(1);
}

main();
