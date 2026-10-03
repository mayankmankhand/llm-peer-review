#!/usr/bin/env node
'use strict';
//
// test-prompt-load.js - assertions for scripts/prompt-load.js, the warn-only
// report of how many words each command, skill and agent loads (issue #206).
//
// Maintainer-only: lives under scripts/, which never ships downstream.
//
// Follows the repo's dependency-free test convention (see test-correction-ledger.js):
// check(name, condition, detail), print, exit non-zero on any failure. Each section
// runs inside a guard, so a section that throws is one failed check and the rest
// still run. That is how every case here was shown to fail before the script existed.
//
// The fixture is a throwaway tree under the OS temp folder, built so each count
// names the rule it checks:
//   alpha (command)  3 own words + frag.md (5 words: its own inline of inner.md stays
//                    literal text, 2 words) + an optional inline of a missing file = 8
//   delta (command)  1 own word + an optional inline of a missing file = 1; it has no
//                    frontmatter, so its description is its first line ("solo")
//   beta (skill)     4 words
//   gamma (agent)    2 own words + the beta skill its frontmatter preloads = 6
//   session          the rules file (2) + the four descriptions (2 + 1 + 2 + 2) = 9
//
// Usage: node scripts/test-prompt-load.js

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, 'prompt-load.js');

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' :: ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' :: ' + String(detail).slice(0, 600) : '')); }
}

function section(name, fn) {
  try { fn(); } catch (e) { check(name + ' (section threw)', false, e && e.message); }
}

// Every temp dir is recorded and removed on exit, pass or fail.
const tempDirs = [];
process.on('exit', () => {
  for (const d of tempDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
});
function tmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function run(args) {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', out: (r.stdout || '') + (r.stderr || '') };
}

// The --json report, or null with the raw run kept for the failure detail.
function report(repo, extra) {
  const r = run(['--repo', repo, '--json', ...(extra || [])]);
  let j = null;
  try { j = JSON.parse(r.stdout); } catch (e) { /* j stays null */ }
  return { r, j };
}

function buildFixture() {
  const repo = tmp('prompt-load-');
  write(repo, '.claude/rules/toolkit.md', 'rule words\n');
  write(repo, '.claude/commands/alpha.md', [
    '---',
    'description: Alpha command',
    '---',
    'one two three',
    '!`cat .claude/skills/shared/frag.md`',
    '!`cat .claude/toolkit/missing.md 2>/dev/null || true`',
    '',
  ].join('\n'));
  write(repo, '.claude/commands/delta.md', 'solo\n!`cat .claude/toolkit/absent.md 2>/dev/null || true`\n');
  write(repo, '.claude/skills/shared/frag.md', 'four five six\n!`cat .claude/skills/shared/inner.md`\n');
  write(repo, '.claude/skills/shared/inner.md', 'seven eight nine ten eleven\n');
  write(repo, '.claude/skills/beta/SKILL.md', '---\nname: beta\ndescription: Beta skill\nuser-invocable: false\n---\nbeta body words here\n');
  write(repo, '.claude/agents/gamma.md', '---\nname: gamma\ndescription: Gamma agent\nskills:\n  - beta\n---\ngamma body\n');
  return repo;
}

const repo = buildFixture();
const base = path.join(tmp('prompt-load-base-'), 'baseline.json');

// --- counting ---------------------------------------------------------------------
section('counting', () => {
  const { r, j } = report(repo);
  check('the report runs and exits 0', r.status === 0 && j !== null, r.out);
  const rows = (j && j.rows) || {};
  check('an inline resolves: alpha counts its own words plus frag.md (8)', rows['commands/alpha.md'] === 8, JSON.stringify(rows));
  check('a missing optional file counts zero: delta is its one word (1)', rows['commands/delta.md'] === 1, JSON.stringify(rows));
  check('a skill counts its body without frontmatter (4)', rows['skills/beta/SKILL.md'] === 4, JSON.stringify(rows));
  check("an agent's skills: preload is counted: gamma is 2 + beta's 4 (6)", rows['agents/gamma.md'] === 6, JSON.stringify(rows));
  check('the session row is the rules file plus every description (9)', rows.session === 9, JSON.stringify(rows));
  check('the shared folder is not a skill row', j !== null && !Object.keys(rows).some(k => k.startsWith('skills/shared')), JSON.stringify(rows));
});

// --- a nested inline is not expanded --------------------------------------------------
section('nesting', () => {
  const r = run(['--repo', repo, '--print', '.claude/commands/alpha.md']);
  check('--print shows the inlined fragment text', r.status === 0 && /four five six/.test(r.stdout), r.out);
  check("--print keeps the fragment's own inline as literal text", r.stdout.includes('!`cat .claude/skills/shared/inner.md`'), r.out);
  check('a nested inline is not expanded: inner.md never appears', r.status === 0 && /four five six/.test(r.stdout) && !/seven eight/.test(r.stdout), r.out);
  check('--print drops the frontmatter', r.status === 0 && /one two three/.test(r.stdout) && !/description: Alpha command/.test(r.stdout), r.out);
  const g = run(['--repo', repo, '--print', '.claude/agents/gamma.md']);
  check("--print on an agent includes the skill it preloads", g.status === 0 && /gamma body/.test(g.stdout) && /beta body words here/.test(g.stdout), g.out);
});

// --- fragments: the ranking Step 6 reads --------------------------------------------------
section('fragments', () => {
  const { j } = report(repo);
  const frags = (j && j.fragments) || [];
  const frag = frags.find(f => f.file === '.claude/skills/shared/frag.md');
  check('an inlined fragment is listed with its words and how many files load it', !!frag && frag.words === 5 && frag.consumers === 1, JSON.stringify(frags));
  check('a fragment only another fragment names is not listed (it never loads)', frags.length > 0 && !frags.some(f => /inner\.md$/.test(f.file)), JSON.stringify(frags));
});

// --- the baseline and the warnings ------------------------------------------------------
section('baseline', () => {
  let r = run(['--repo', repo, '--baseline', base, '--write-baseline']);
  let rows = null;
  try { rows = JSON.parse(fs.readFileSync(base, 'utf8')).rows; } catch (e) { /* rows stays null */ }
  check('--write-baseline records every row and exits 0', r.status === 0 && rows && rows['commands/alpha.md'] === 8 && rows.session === 9, r.out);

  r = run(['--repo', repo, '--baseline', base, '--warnings-only']);
  check('an unchanged tree: 0 grew, 0 new, 0 removed, exit 0', r.status === 0 && /0 grew, 0 new, 0 removed/.test(r.out), r.out);
  check('--warnings-only leaves out the per-file table', r.status === 0 && /0 grew/.test(r.out) && !/words {2}file/.test(r.out), r.out);

  // Growth in a preloaded skill shows on the skill and on every agent that preloads it.
  write(repo, '.claude/skills/beta/SKILL.md', '---\nname: beta\ndescription: Beta skill\nuser-invocable: false\n---\nbeta body words here plus three more\n');
  r = run(['--repo', repo, '--baseline', base, '--warnings-only']);
  check('growth prints a warning line per grown row and still exits 0',
    r.status === 0 && /grew\s+skills\/beta\/SKILL\.md 4 -> 7 \(\+3\)/.test(r.out) && /grew\s+agents\/gamma\.md 6 -> 9 \(\+3\)/.test(r.out), r.out);

  // A row the baseline has never seen (a new skill, a split fragment's new home).
  write(repo, '.claude/commands/epsilon.md', '---\ndescription: Epsilon\n---\na b c\n');
  r = run(['--repo', repo, '--baseline', base, '--warnings-only']);
  check('a row missing from the baseline prints as new and still exits 0', r.status === 0 && /new\s+commands\/epsilon\.md 3 words/.test(r.out), r.out);

  fs.rmSync(path.join(repo, '.claude/commands/delta.md'));
  r = run(['--repo', repo, '--baseline', base, '--warnings-only']);
  check('a row gone from the tree prints as removed and still exits 0', r.status === 0 && /removed\s+commands\/delta\.md \(was 1 words\)/.test(r.out), r.out);

  r = run(['--repo', repo, '--baseline', path.join(path.dirname(base), 'none.json'), '--warnings-only']);
  check('a missing baseline is a note, never a failure', r.status === 0 && /no baseline/.test(r.out), r.out);
});

// --- a broken inline, and the inline form of skills: ----------------------------------------
section('broken inline and inline preload list', () => {
  const other = tmp('prompt-load-other-');
  write(other, '.claude/commands/broken.md', 'x\n!`cat .claude/skills/shared/gone.md`\n');
  write(other, '.claude/skills/beta/SKILL.md', '---\ndescription: Beta\n---\nb1 b2\n');
  write(other, '.claude/agents/zeta.md', '---\ndescription: Zeta\nskills: [beta]\n---\nz1\n');
  const { r, j } = report(other);
  const rows = (j && j.rows) || {};
  check('a plain inline of a missing file counts zero', r.status === 0 && rows['commands/broken.md'] === 1, r.out);
  check('a plain inline of a missing file is reported as a note', !!j && (j.notes || []).some(n => /broken\.md/.test(n) && /gone\.md/.test(n) && /does not exist/.test(n)), JSON.stringify(j && j.notes));
  check('skills: [beta] (the inline list form) is preloaded too', rows['agents/zeta.md'] === 3, JSON.stringify(rows));
});

// --- usage errors ------------------------------------------------------------------------
section('usage', () => {
  check('an unknown flag exits 2', run(['--bogus']).status === 2);
  check('a flag missing its value exits 2', run(['--repo']).status === 2);
  check('--print of a file that does not exist exits 2', run(['--repo', repo, '--print', '.claude/commands/nope.md']).status === 2);
});

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
process.exit(failures.length ? 1 : 0);
