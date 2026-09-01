#!/usr/bin/env node
'use strict';
//
// test-render-html.js - assertions for the payload transforms, the
// repository-keyed artifact index, and the hosted stamp / --index-sync modes
// in .claude/scripts/render-html.js.
// (issues #155 items 2, 3, 5; holistic pass, plan Step 3)
//
// Maintainer-only: lives under scripts/, which the installers never propagate, so
// downstream projects do not inherit it.
//
// Follows the repo's existing dependency-free test convention (see
// scripts/test-correction-ledger.js): assert, print, exit non-zero on any
// failure. No test framework, nothing added to .claude/scripts/package.json.
//
// Every test renders into a throwaway temp directory, and the index and stamp
// tests build their own git repos, so a run never touches the real
// artifacts/html/ or stamps a real mirror.
//
// Usage: node scripts/test-render-html.js

const { execFileSync, spawnSync } = require('child_process');
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
  const FAKE_ABS_PATH = '/home/someone/private-dir/src/a.js';
  const payload = {
    title: 'AbsPath',
    findings: [{
      id: 'R1', severity: 'blocks', what: 'top level',
      file: { relPath: 'src/a.js', absPath: FAKE_ABS_PATH, line: 7 },
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
  check('--no-abs removes the top-level absPath', stripped.indexOf(FAKE_ABS_PATH) === -1);
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
  // Assert the real shape POSITIVELY. The previous form here tested two regexes
  // that matched no shell at all, so `!a || !b` was always true and the check
  // could not fail - it reported PASS for the exact regression it named
  // (issue #155 review, R9). Every vscode://file/ concatenation must reference
  // file.absPath and nothing else.
  ['review', 'document', 'explore', 'debate', 'audit'].forEach(function (shell) {
    const src = fs.readFileSync(
      path.join(REPO, '.claude/skills/shared/shells', shell + '-shell.html'), 'utf-8');
    check(shell + '-shell renders plain text when absPath is absent',
          /if \(!file\.absPath\)/.test(src));

    // Find every place the shell BUILDS the scheme (concatenation, not prose).
    const builds = src.match(/["']vscode:\/\/file\/["']\s*\+\s*[A-Za-z_$][\w.$]*/g) || [];
    check(shell + '-shell builds at least one editor link (control)', builds.length > 0,
          'found ' + builds.length);
    check(shell + '-shell builds every editor link from file.absPath only',
          builds.every(function (b) { return /\+\s*file\.absPath$/.test(b); }),
          builds.join(' | '));
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

  // --no-abs must scrub absolute paths out of ORDINARY TEXT too, not just the
  // absPath key - the --no-abs rule in html-outputs.md promises the page
  // carries no machine-identifying paths, and a key-name denylist cannot
  // deliver that (issue #155 review, R6).
  const HOME = require('os').homedir();
  const prose = {
    title: 'Prose',
    findings: [{
      id: 'R1', severity: 'warns', what: 'see ' + path.join(REPO, 'src/x.js'),
      fields: [
        { label: 'Receipt', value: 'grep -n q ' + path.join(REPO, 'src/x.js') },
        { label: 'Elsewhere', value: 'also ' + path.join(HOME, 'Desktop/notes.txt') }
      ]
    }]
  };
  const scrubbed = dataIsland(render(dir, 'prose', prose, ['--no-abs']).html);
  check('--no-abs scrubs the repo root out of prose text',
        scrubbed.indexOf(REPO) === -1);
  check('--no-abs scrubs the repo root out of a receipt command',
        scrubbed.indexOf('grep -n q src/x.js') !== -1, scrubbed.slice(0, 200));
  check('--no-abs elides the home directory to ~',
        scrubbed.indexOf(HOME) === -1 && scrubbed.indexOf('~/Desktop/notes.txt') !== -1);

  const unscrubbed = dataIsland(render(dir, 'prose-ctl', prose).html);
  check('control: prose paths survive WITHOUT --no-abs',
        unscrubbed.indexOf(REPO) !== -1);

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

  // Markup shapes that previously fell through the regex with no data URI, no
  // note, and no stderr line (issue #155 review, R20). Also asserts the swap is
  // anchored to src: a duplicate path in alt must not absorb the data URI.
  const shapes = render(dir, 'shapes', {
    title: 'Shapes',
    findings: [{ id: 'R1', severity: 'warns', what: 'x', fields: [
      { label: 'GtInAlt',  value: '<img alt="cart > checkout" src="' + small + '">' },
      { label: 'Unquoted', value: '<img src=' + small + '>' },
      { label: 'DupInAlt', value: '<img alt="' + small + '" src="' + small + '">' }
    ] }]
  });
  const uriCount = (shapes.html.match(/data:image\/png;base64,/g) || []).length;
  check('a ">" inside an attribute no longer breaks the match', uriCount >= 1);
  check('all three img shapes embed (quoted-with-gt, unquoted, duplicated)',
        uriCount === 3, 'embedded ' + uriCount + ' of 3');
  // The payload lives in a JSON island, so its quotes arrive backslash-escaped:
  // src="  is written as  src=\".  Match either form rather than assuming.
  check('the data URI lands in src, not in a duplicate alt',
        /src=\\?["']data:image\/png;base64,/.test(shapes.html));
  check('a duplicated path in alt is NOT the one that got the data URI',
        !/alt=\\?["']data:image/.test(shapes.html));

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
      { cwd: main, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    check('main copy writes into its own repo root',
          mainOut === path.join(main, 'artifacts/html/index.jsonl'), mainOut);

    // A worktree of that same repo must share the index.
    const wt = path.join(root, 'wt');
    git(main, ['worktree', 'add', '-q', '--detach', wt, 'HEAD']);

    const wtOut = execFileSync('node',
      [SCRIPT, '--index-add', '--type', 'plan', '--name', 'probe2',
       '--local', 'q.html', '--url', 'https://example.com/probe2'],
      { cwd: wt, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    check('a worktree writes into the MAIN repo index, not its own',
          wtOut === path.join(main, 'artifacts/html/index.jsonl'), wtOut);

    const lookup = execFileSync('node', [SCRIPT, '--index-url', '--name', 'probe'],
      { cwd: wt, encoding: 'utf-8' }).trim();
    check('a worktree finds a record written from the main copy',
          lookup === 'https://example.com/probe', lookup || '(empty)');
    check('the worktree did NOT create its own index',
          !fs.existsSync(path.join(wt, 'artifacts/html/index.jsonl')));

    // A worktree's own artifact lives under the WORKTREE, not the main copy,
    // and the render prints that absolute path. Refusing it as "outside the
    // repo" was the first design flaw the holistic-pass review caught: the
    // row landed in the shared index and the mirror stayed unstamped.
    const wtFile = path.join(wt, 'plans', 'PLAN-wt.html');
    fs.mkdirSync(path.dirname(wtFile), { recursive: true });
    fs.writeFileSync(wtFile, '<!doctype html>\n<title>wt</title>\n');
    const wtStamp = spawnSync('node',
      [SCRIPT, '--index-add', '--type', 'plan', '--name', 'PLAN-wt',
       '--local', wtFile, '--url', 'https://example.com/wt'],
      { cwd: wt, encoding: 'utf-8' });
    check('a worktree can stamp its own artifact by absolute path',
          wtStamp.status === 0 && fs.readFileSync(wtFile, 'utf-8').split('\n')[0] === '<!-- hosted: https://example.com/wt -->',
          (wtStamp.stderr || '').trim() || fs.readFileSync(wtFile, 'utf-8').split('\n')[0]);
    const wtRel = spawnSync('node',
      [SCRIPT, '--index-add', '--type', 'plan', '--name', 'PLAN-wt',
       '--local', 'plans/PLAN-wt.html', '--url', 'https://example.com/wt2'],
      { cwd: wt, encoding: 'utf-8' });
    check('a relative --local from a worktree resolves to the worktree file',
          wtRel.status === 0 && fs.readFileSync(wtFile, 'utf-8').split('\n')[0] === '<!-- hosted: https://example.com/wt2 -->',
          (wtRel.stderr || '').trim());
    const wtSync = spawnSync('node', [SCRIPT, '--index-sync'], { cwd: wt, encoding: 'utf-8' });
    check('--index-sync from a worktree keeps the worktree stamp',
          wtSync.status === 0 && fs.readFileSync(wtFile, 'utf-8').split('\n')[0] === '<!-- hosted: https://example.com/wt2 -->',
          (wtSync.stdout || '').trim() + ' ' + (wtSync.stderr || '').trim());
    const outside = spawnSync('node',
      [SCRIPT, '--index-add', '--type', 'plan', '--name', 'PLAN-out',
       '--local', path.join(root, 'elsewhere.html'), '--url', 'https://example.com/out'],
      { cwd: wt, encoding: 'utf-8' });
    check('a path outside both roots is still refused from a worktree',
          outside.status !== 0 && /inside the repository/.test(outside.stderr || ''), (outside.stderr || '').trim());

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
      { cwd: bare, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, { GIT_CEILING_DIRECTORIES: root }) }).trim();
    // No `|| out.length > 0` escape hatch: --index-add always prints a non-empty
    // path on success, so that disjunct was unconditionally true and the named
    // behavior was never asserted (issue #155 review, R22).
    check('outside a repo it falls back to the working directory rather than failing',
          out === path.join(bare, 'artifacts/html/index.jsonl'), out);
  } catch (e) {
    check('outside a repo it does not throw', false, e.message);
  }

  fs.rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Hosted stamp and --index-sync (holistic pass, plan Step 3)
//
// Every case runs inside its own temp git repo: --local is resolved against
// the repo root the index is keyed to, and the stamp is WRITTEN to that file,
// so a case that ran from this repo would rewrite a real mirror.
// ---------------------------------------------------------------------------
const STAMP_LINE = /^<!-- hosted: .* -->$/;

function stampTests() {
  console.log('\nhosted stamp and --index-sync (holistic pass, Step 3)');
  const root = tmpdir('stamp');
  const main = path.join(root, 'main');
  fs.mkdirSync(main);
  const INDEX = path.join(main, 'artifacts/html/index.jsonl');

  function git(args) {
    return execFileSync('git', args, { cwd: main, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  }
  // Status, stdout and stderr together: the warnings under test go to stderr
  // on a SUCCESSFUL run, which execFileSync does not hand back.
  function run(args) {
    const r = spawnSync('node', [SCRIPT].concat(args), { cwd: main, encoding: 'utf-8' });
    return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
  }
  function lines(file) { return fs.readFileSync(file, 'utf-8').split('\n'); }
  function stampCount(file) { return lines(file).filter(function (l) { return STAMP_LINE.test(l); }).length; }
  function rowCount() {
    return fs.existsSync(INDEX) ? fs.readFileSync(INDEX, 'utf-8').split('\n').filter(Boolean).length : 0;
  }
  function addArgs(name, local, url) {
    const a = ['--index-add', '--type', 'plan', '--name', name, '--url', url];
    return local ? a.concat(['--local', local]) : a;
  }

  try {
    git(['init', '-q']);
    git(['config', 'user.email', 't@example.com']);
    git(['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(main, 'README.md'), 'x\n');
    git(['add', '.']);
    git(['commit', '-qm', 'init']);

    // No index yet: sync has nothing to do and must say so rather than fail.
    const s0 = run(['--index-sync']);
    check('--index-sync with no index exits 0 and reports zero counts',
          s0.status === 0 && s0.out.trim() === 'index-sync: 0 stamped, 0 missing', s0.out.trim() || s0.err.trim());

    // A real plan render, so the stamp lands on a real mirror and the <title>
    // check below measures the real shell, not a stub.
    const dataPath = path.join(root, 'plan.json');
    fs.writeFileSync(dataPath, JSON.stringify({
      title: 'Stamp Plan', tldr: 'x', steps: [{ name: 's1', subtasks: ['a'] }]
    }), 'utf-8');
    const planPath = execFileSync('node',
      [SCRIPT, '--shell', 'plan', '--name', 'PLAN-stamp', '--out-dir', 'plans', '--stable', '--data', dataPath],
      { cwd: main, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const original = fs.readFileSync(planPath, 'utf-8');
    check('control: the rendered plan starts with the doctype and carries no stamp',
          original.split('\n')[0] === '<!doctype html>' && stampCount(planPath) === 0);

    // (a) first publish: one stamp on line 1, doctype on line 2.
    const a = run(addArgs('PLAN-stamp', 'plans/PLAN-stamp.html', 'https://example.com/one'));
    check('--index-add exits 0 with an existing --local', a.status === 0, a.err.trim());
    const la = lines(planPath);
    check('--index-add puts the stamp on line 1',
          la[0] === '<!-- hosted: https://example.com/one -->', la[0]);
    check('--index-add keeps the doctype on line 2', la[1] === '<!doctype html>', la[1]);
    check('--index-add writes exactly one stamp line', stampCount(planPath) === 1, 'found ' + stampCount(planPath));

    // (b) re-publish under a new URL: the stamp is REPLACED, never doubled.
    const b = run(addArgs('PLAN-stamp', 'plans/PLAN-stamp.html', 'https://example.com/two'));
    check('re-publish exits 0', b.status === 0, b.err.trim());
    const lb = lines(planPath);
    check('re-publish replaces the stamp instead of adding a second',
          stampCount(planPath) === 1, 'found ' + stampCount(planPath));
    check('re-publish carries the NEW url', lb[0] === '<!-- hosted: https://example.com/two -->', lb[0]);
    check('re-publish leaves everything after line 1 byte-identical to the render',
          fs.readFileSync(planPath, 'utf-8').slice(lb[0].length + 1) === original);

    // (c) the hosted publisher reads only the first 8KB for the <title>.
    const html = fs.readFileSync(planPath, 'utf-8');
    const titleEnd = html.indexOf('</title>') + '</title>'.length;
    check('the <title> tag is still within the first 8192 bytes after stamping',
          titleEnd > 8 && Buffer.byteLength(html.slice(0, titleEnd), 'utf-8') <= 8192,
          'title ends at byte ' + Buffer.byteLength(html.slice(0, titleEnd), 'utf-8'));
    check('the title inside that window is the payload title',
          /<title>Stamp Plan<\/title>/.test(html.slice(0, 8192)));

    // (d) a --local that names no file: warn, still record, still exit 0.
    const before = rowCount();
    const d = run(addArgs('gone', 'artifacts/html/gone.html', 'https://example.com/gone'));
    check('a missing --local still exits 0', d.status === 0, d.err.trim());
    check('a missing --local still appends the row', rowCount() === before + 1);
    check('a missing --local warns on stderr',
          d.err.indexOf('index-add: local file not found, row recorded without a stamp: ') !== -1 &&
          d.err.indexOf('gone.html') !== -1, d.err.trim() || '(no stderr)');
    check('a missing --local keeps stdout as the index path', d.out.trim() === INDEX, d.out.trim());

    // (e) a --local that escapes the repo root: refuse, and write nothing.
    const before2 = rowCount();
    const e = run(addArgs('esc', '../escape.html', 'https://example.com/esc'));
    check('a relative --local outside the repo root is rejected', e.status !== 0);
    check('the rejection says why', e.err.indexOf('inside the repository') !== -1, e.err.trim());
    check('a rejected --local appends nothing', rowCount() === before2, 'rows ' + rowCount() + ' vs ' + before2);
    const e2 = run(addArgs('esc', path.join(root, 'escape.html'), 'https://example.com/esc'));
    check('an absolute --local outside the repo root is rejected too', e2.status !== 0 && rowCount() === before2);
    const e3 = run(addArgs('nolocal', '', 'https://example.com/nolocal'));
    check('--local stays optional', e3.status === 0 && rowCount() === before2 + 1, e3.err.trim());

    // (f) two rows share a name; the lookup must return the later one.
    const f = run(['--index-url', '--name', 'PLAN-stamp']);
    check('--index-url returns the newest of two rows sharing a name',
          f.out.trim() === 'https://example.com/two', f.out.trim() || '(empty)');

    // Two TIMESTAMPED runs under one shared name, each with its own mirror and
    // its own page - the shape every review and document row has. Sync must
    // give each mirror its own URL; "newest per name" would hand the older
    // mirror the newer run's page.
    const reviewData = path.join(root, 'review.json');
    fs.writeFileSync(reviewData, JSON.stringify({ title: 'Review', findings: [] }), 'utf-8');
    function renderReview() {
      return execFileSync('node', [SCRIPT, '--shell', 'review', '--name', 'review-orchestrator', '--data', reviewData],
        { cwd: main, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    }
    const rev1 = renderReview();
    const rev2 = renderReview(); // same second: the -2 guard names it, so the two never collide
    check('control: two timestamped renders under one name are two files', rev1 !== rev2, rev1 + ' vs ' + rev2);
    run(['--index-add', '--type', 'review', '--name', 'review-orchestrator', '--local', rev1, '--url', 'https://example.com/rev1']);
    run(['--index-add', '--type', 'review', '--name', 'review-orchestrator', '--local', rev2, '--url', 'https://example.com/rev2']);
    check('control: --index-add gave each timestamped mirror its own url',
          lines(rev1)[0] === '<!-- hosted: https://example.com/rev1 -->' && lines(rev2)[0] === '<!-- hosted: https://example.com/rev2 -->');

    // (g) sync: a stamp that was stripped (a re-render, or a hand edit) comes
    // back from the index, and the missing mirror is counted, not fatal.
    fs.writeFileSync(planPath, original, 'utf-8');
    fs.writeFileSync(rev1, lines(rev1).slice(1).join('\n'), 'utf-8');
    check('control: the stamps were removed before sync', stampCount(planPath) === 0 && stampCount(rev1) === 0);
    const g = run(['--index-sync']);
    check('--index-sync exits 0 with a missing mirror in the index', g.status === 0, g.err.trim());
    check('--index-sync re-stamps the file from the index',
          lines(planPath)[0] === '<!-- hosted: https://example.com/two -->', lines(planPath)[0]);
    check('--index-sync writes exactly one stamp line', stampCount(planPath) === 1);
    check('--index-sync gives each timestamped mirror ITS OWN url, not the newest under that name',
          lines(rev1)[0] === '<!-- hosted: https://example.com/rev1 -->' && lines(rev2)[0] === '<!-- hosted: https://example.com/rev2 -->',
          lines(rev1)[0] + ' | ' + lines(rev2)[0]);
    check('--index-sync reports the counts', g.out.trim() === 'index-sync: 3 stamped, 1 missing', g.out.trim());
    check('--index-sync lists the missing path on stderr',
          g.err.indexOf('index-sync: local file not found: ') !== -1 && g.err.indexOf('gone.html') !== -1,
          g.err.trim() || '(no stderr)');
    const snap = fs.readFileSync(planPath, 'utf-8');
    const g2 = run(['--index-sync']);
    check('--index-sync is idempotent',
          fs.readFileSync(planPath, 'utf-8') === snap && g2.out.trim() === 'index-sync: 3 stamped, 1 missing');

    // (h) the index modes take no render arguments, and only one runs at a time.
    const h = run(['--index-sync', '--stable']);
    check('--index-sync rejects a render flag', h.status !== 0);
    check('--index-sync rejection names the flag', h.err.indexOf('--stable') !== -1, h.err.trim());
    const hx = run(['--index-sync', '--index-add', '--name', 'x', '--url', 'https://example.com/x']);
    check('--index-sync and --index-add are mutually exclusive',
          hx.status !== 0 && hx.err.indexOf('mutually exclusive') !== -1, hx.err.trim());
  } catch (err) {
    check('stamp test set up a git repo and rendered a plan', false, err.message);
  }

  fs.rmSync(root, { recursive: true, force: true });
}

noAbsTests();
imageTests();
indexTests();
stampTests();

console.log('');
if (failures.length === 0) {
  console.log(passed + ' checks passed.\n');
  process.exit(0);
}
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach(function (f) { console.log('  - ' + f); });
console.log('');
process.exit(1);
