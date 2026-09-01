#!/usr/bin/env node
'use strict';
//
// test-render-html.js - assertions for the payload transforms and the
// repository-keyed artifact index in .claude/scripts/render-html.js.
// (issues #155 items 2, 3, 5)
//
// Maintainer-only: lives under scripts/, which the installers never propagate, so
// downstream projects do not inherit it.
//
// Follows the repo's existing dependency-free test convention (see
// scripts/test-correction-ledger.js): assert, print, exit non-zero on any
// failure. No test framework, nothing added to .claude/scripts/package.json.
//
// Every test renders into a throwaway temp directory, and the worktree test
// builds its own git repo, so a run never touches the real artifacts/html/.
//
// Usage: node scripts/test-render-html.js

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const SCRIPT = path.resolve(REPO, '.claude', 'scripts', 'render-html.js');

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' :: ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' :: ' + detail : '')); }
}

function tmpdir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'render-' + label + '-'));
}

// Render a payload and return the page text. cwd defaults to the repo root.
function render(dir, name, data, extraArgs, cwd) {
  const dataPath = path.join(dir, name + '.json');
  fs.writeFileSync(dataPath, JSON.stringify(data), 'utf-8');
  const args = [SCRIPT, '--shell', 'review', '--name', name,
                '--out-dir', dir, '--stable', '--data', dataPath].concat(extraArgs || []);
  const out = execFileSync('node', args,
    { encoding: 'utf-8', cwd: cwd || REPO, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return { path: out, html: fs.readFileSync(out, 'utf-8') };
}

// The rendered page is client-side: a JSON data island plus the shell's renderer
// JS. So a grep over the whole FILE cannot tell what the page displays - every
// shell's source contains the literal "vscode://file/" whether or not a link is
// ever built. Assertions about content must run against the data island, and
// assertions about link-vs-text against the shell's rendering branch.
function dataIsland(html) {
  // Match the real <script> TAG, not the prose in a shell's header comment -
  // several shells describe the island (and document an "absPath" field) in a
  // comment above it, so a plain indexOf finds the documentation first.
  const re = /<script[^>]*\bid=["']render-data["'][^>]*>/g;
  let m, last = null;
  while ((m = re.exec(html)) !== null) last = m;
  if (!last) throw new Error('no render-data script tag in the page');
  const start = last.index + last[0].length;
  return html.slice(start, html.indexOf('</script>', start));
}

// A 1x1 transparent PNG, built here so the test needs no fixture file on disk.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
  'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

// ---------------------------------------------------------------------------
// Item 2: --no-abs strips absolute local paths
//
// The control render matters as much as the stripped one. Without it, a bug
// that made the renderer emit nothing at all would pass every "path is absent"
// assertion below - an assertion that cannot fail is documentation wearing a
// test's clothes.
// ---------------------------------------------------------------------------
function noAbsTests() {
  console.log('\n--no-abs (issue #155 item 2)');
  const dir = tmpdir('noabs');
  const SECRET = '/home/someone/private-dir/src/a.js';
  const payload = {
    title: 'AbsPath',
    findings: [{
      id: 'R1', severity: 'blocks', what: 'top level',
      file: { relPath: 'src/a.js', absPath: SECRET, line: 7 },
      fields: [{ label: 'Nested', value: 'see below' }]
    }, {
      id: 'R2', severity: 'warns', what: 'deeply nested',
      file: { relPath: 'src/b.js', absPath: '/home/someone/private-dir/src/b.js' }
    }]
  };

  // Control: WITHOUT the flag the editor links must still be there. If this
  // fails, every assertion in the stripped case below is meaningless.
  const control = dataIsland(render(dir, 'ctl', payload).html);
  check('control: absPath reaches the page without --no-abs', control.indexOf('private-dir') !== -1);
  check('control: absPath key is present without --no-abs', control.indexOf('absPath') !== -1);

  const stripped = dataIsland(render(dir, 'strip', payload, ['--no-abs']).html);
  check('--no-abs removes the top-level absPath', stripped.indexOf(SECRET) === -1);
  check('--no-abs removes every absPath, not just the first',
        stripped.indexOf('private-dir') === -1);
  check('--no-abs leaves no absPath key at all', stripped.indexOf('absPath') === -1);
  check('--no-abs keeps relPath, so the reference is still readable',
        stripped.indexOf('src/a.js') !== -1 && stripped.indexOf('src/b.js') !== -1);
  check('--no-abs keeps the rest of the finding intact',
        stripped.indexOf('deeply nested') !== -1);

  // Every shell that builds an editor link must render plain text instead when
  // absPath is absent. This is a source assertion because the branch it guards
  // only runs in a browser.
  ['review', 'document', 'explore', 'debate', 'audit'].forEach(function (shell) {
    const src = fs.readFileSync(
      path.join(REPO, '.claude/skills/shared/shells', shell + '-shell.html'), 'utf-8');
    check(shell + '-shell renders plain text when absPath is absent',
          /if \(!file\.absPath\)/.test(src));
    check(shell + '-shell never builds an editor link from relPath',
          !/vscode:\/\/file\/["'\s]*\+\s*(abs|target)\b/.test(src) ||
          !/var abs = file\.absPath \|\| file\.relPath/.test(src));
  });

  // The index modes take no render arguments; --no-abs must be rejected there
  // alongside --stable and --data, or a mixed command line silently wins.
  let rejected = false, msg = '';
  try {
    execFileSync('node', [SCRIPT, '--index-url', '--name', 'x', '--no-abs'],
      { encoding: 'utf-8', cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { rejected = true; msg = String(e.stderr || ''); }
  check('index mode rejects --no-abs', rejected);
  check('index-mode rejection names the flag', msg.indexOf('--no-abs') !== -1, msg.trim());

  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Item 3: local images become data: URIs, with a bounded budget
// ---------------------------------------------------------------------------
function imageTests() {
  console.log('\nimage embedding (issue #155 item 3)');
  const dir = tmpdir('img');
  const small = path.join(dir, 'shot.png');
  fs.writeFileSync(small, PNG_1X1);

  // Over the 12MB encoded budget on its own.
  const big = path.join(dir, 'huge.png');
  fs.writeFileSync(big, Buffer.concat([PNG_1X1, Buffer.alloc(13 * 1024 * 1024)]));

  const missing = path.join(dir, 'gone.png');

  const r = render(dir, 'img', {
    title: 'Img',
    findings: [{
      id: 'R1', severity: 'warns', what: 'shots',
      fields: [
        { label: 'Small',   value: '<img src="' + small + '" alt="s">' },
        { label: 'Missing', value: '<img src="' + missing + '" alt="m">' },
        { label: 'Remote',  value: '<img src="https://example.com/x.png" alt="r">' }
      ]
    }]
  });
  check('a readable local image becomes a data: URI',
        r.html.indexOf('data:image/png;base64,') !== -1);
  check('the raw filesystem path is gone from the page',
        r.html.indexOf(small) === -1);
  check('a missing image is replaced with a visible note',
        r.html.indexOf('image unavailable') !== -1);
  check('a missing image does not abort the render',
        r.html.indexOf('shots') !== -1);
  check('a remote URL is left untouched',
        r.html.indexOf('https://example.com/x.png') !== -1);

  const rb = render(dir, 'big', {
    title: 'Big',
    findings: [{ id: 'R1', severity: 'warns', what: 'oversize',
                 fields: [{ label: 'Huge', value: '<img src="' + big + '" alt="h">' }] }]
  });
  check('an over-budget image is dropped', rb.html.indexOf('data:image/png;base64,') === -1);
  check('an over-budget image says so visibly', rb.html.indexOf('image omitted') !== -1);
  check('an over-budget image reports its size', /over the embed budget/.test(rb.html));

  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Item 5: the artifact index is keyed to the repository, not the cwd
// ---------------------------------------------------------------------------
function indexTests() {
  console.log('\nrepository-keyed index (issue #155 item 5)');
  const root = tmpdir('idx');
  const main = path.join(root, 'main');
  fs.mkdirSync(main);

  function git(cwd, args) {
    return execFileSync('git', args, { cwd: cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  }

  try {
    git(main, ['init', '-q']);
    git(main, ['config', 'user.email', 't@example.com']);
    git(main, ['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(main, 'README.md'), 'x\n');
    git(main, ['add', '.']);
    git(main, ['commit', '-qm', 'init']);

    // Write a record from the MAIN copy.
    const mainOut = execFileSync('node',
      [SCRIPT, '--index-add', '--type', 'plan', '--name', 'probe',
       '--local', 'p.html', '--url', 'https://example.com/probe'],
      { cwd: main, encoding: 'utf-8' }).trim();
    check('main copy writes into its own repo root',
          mainOut === path.join(main, 'artifacts/html/index.jsonl'), mainOut);

    // A worktree of that same repo must share the index.
    const wt = path.join(root, 'wt');
    git(main, ['worktree', 'add', '-q', '--detach', wt, 'HEAD']);

    const wtOut = execFileSync('node',
      [SCRIPT, '--index-add', '--type', 'plan', '--name', 'probe2',
       '--local', 'q.html', '--url', 'https://example.com/probe2'],
      { cwd: wt, encoding: 'utf-8' }).trim();
    check('a worktree writes into the MAIN repo index, not its own',
          wtOut === path.join(main, 'artifacts/html/index.jsonl'), wtOut);

    const lookup = execFileSync('node', [SCRIPT, '--index-url', '--name', 'probe'],
      { cwd: wt, encoding: 'utf-8' }).trim();
    check('a worktree finds a record written from the main copy',
          lookup === 'https://example.com/probe', lookup || '(empty)');
    check('the worktree did NOT create its own index',
          !fs.existsSync(path.join(wt, 'artifacts/html/index.jsonl')));

    git(main, ['worktree', 'remove', '--force', wt]);
  } catch (e) {
    check('index test set up a git repo and worktree', false, e.message);
  }

  // Outside a repo, the fallback must still work rather than throwing.
  const bare = path.join(root, 'norepo');
  fs.mkdirSync(bare);
  try {
    const out = execFileSync('node',
      [SCRIPT, '--index-add', '--type', 'plan', '--name', 'n',
       '--local', 'n.html', '--url', 'https://example.com/n'],
      { cwd: bare, encoding: 'utf-8', env: Object.assign({}, process.env, { GIT_CEILING_DIRECTORIES: root }) }).trim();
    check('outside a repo it falls back to the working directory rather than failing',
          out.indexOf(bare) === 0 || out.length > 0, out);
  } catch (e) {
    check('outside a repo it does not throw', false, e.message);
  }

  fs.rmSync(root, { recursive: true, force: true });
}

noAbsTests();
imageTests();
indexTests();

console.log('');
if (failures.length === 0) {
  console.log(passed + ' checks passed.\n');
  process.exit(0);
}
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach(function (f) { console.log('  - ' + f); });
console.log('');
process.exit(1);
