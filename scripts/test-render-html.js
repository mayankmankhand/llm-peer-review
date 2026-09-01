#!/usr/bin/env node
'use strict';
//
// test-render-html.js - assertions for the payload transforms, the
// repository-keyed artifact index, and the hosted stamp / --index-sync modes
// in .claude/scripts/render-html.js.
// (issues #155 items 2, 3, 5; holistic pass, plan Step 3; holistic review
// R1, R14, R27)
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
// `env` is merged over the real environment, the way the hardening cases do
// it: the home-directory image case (holistic review, R1) points HOME at a
// fixture so nothing is ever written under the real home directory.
function render(dir, name, data, extraArgs, cwd, env) {
  const dataPath = path.join(dir, name + '.json');
  fs.writeFileSync(dataPath, JSON.stringify(data), 'utf-8');
  const args = [SCRIPT, '--shell', 'review', '--name', name,
                '--out-dir', dir, '--stable', '--data', dataPath].concat(extraArgs || []);
  const out = execFileSync('node', args,
    { encoding: 'utf-8', cwd: cwd || REPO, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, env || {}) }).trim();
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

  // The home prefix pair is HOME + path.sep, so a BARE home path with nothing
  // after it (a shell prompt, "HOME=/home/user", "$HOME is /home/user")
  // survived the scrub and leaked the account name (holistic review, R14).
  // The bare form is replaced only as a whole token: a sibling directory that
  // merely starts with the same characters is a different path and stays, and
  // /tmp and /usr are never touched.
  const bare = {
    title: 'BareHome',
    findings: [{
      id: 'R1', severity: 'warns', what: 'home is ' + HOME,
      fields: [
        { label: 'Prompt',  value: 'user@host:' + HOME + '$ ls' },
        { label: 'Env',     value: 'HOME=' + HOME },
        { label: 'Sibling', value: 'sibling ' + HOME + '2/x.txt' },
        { label: 'Dotted',  value: 'dotted ' + HOME + '.bak/y.txt' },
        { label: 'Period',  value: 'it lives in ' + HOME + '.' },
        { label: 'Tmp',     value: 'tmp /tmp/render-x/shot.png and /usr/bin/node' }
      ]
    }]
  };
  const bareOut = dataIsland(render(dir, 'bare', bare, ['--no-abs']).html);
  check('--no-abs elides a bare home directory to ~ (R14)',
        bareOut.indexOf('home is ~') !== -1 && bareOut.indexOf('home is ' + HOME) === -1,
        bareOut.slice(0, 200));
  check('--no-abs elides the home directory inside a shell prompt (R14)',
        bareOut.indexOf('user@host:~$ ls') !== -1);
  check('--no-abs elides the home directory in an env assignment (R14)',
        bareOut.indexOf('HOME=~') !== -1);
  check('a sibling path that merely starts with the home directory is left alone',
        bareOut.indexOf(HOME + '2/x.txt') !== -1 && bareOut.indexOf(HOME + '.bak/y.txt') !== -1);
  check('a sentence-ending period after the bare home directory does not block the elision',
        bareOut.indexOf('it lives in ~.') !== -1 && bareOut.indexOf('it lives in ' + HOME) === -1);
  check('paths under /tmp and /usr are still left alone',
        bareOut.indexOf('/tmp/render-x/shot.png') !== -1 && bareOut.indexOf('/usr/bin/node') !== -1);

  // A file object that carried only absPath (no relPath) was reduced to {line}
  // by the strip, and every shell's `relPath || absPath` guard then hid the
  // reference entirely (holistic review, R27). The strip now derives relPath
  // from absPath before deleting it: repo-relative when the path is under the
  // main copy or the working copy, the literal "external file" when it is
  // under neither. The worktree half of that rule is exercised in
  // relPathWorktreeTest below.
  const onlyAbs = {
    title: 'OnlyAbs',
    findings: [{
      id: 'R1', severity: 'warns', what: 'only abs, under the repo',
      file: { absPath: path.join(REPO, 'src', 'only-abs.js'), line: 3 }
    }, {
      id: 'R2', severity: 'warns', what: 'only abs, external',
      file: { absPath: '/usr/lib/node_modules/x/index.js' }
    }, {
      id: 'R3', severity: 'warns', what: 'relPath already given wins',
      file: { relPath: 'src/given.js', absPath: path.join(REPO, 'src', 'other.js') }
    }]
  };
  const onlyOut = dataIsland(render(dir, 'only-abs', onlyAbs, ['--no-abs']).html);
  check('--no-abs derives a repo-relative relPath from a lone absPath (R27)',
        onlyOut.indexOf('"relPath":"src/only-abs.js"') !== -1, onlyOut.slice(0, 300));
  check('the derived reference keeps its line number', onlyOut.indexOf('"line":3') !== -1);
  check('a lone absPath outside every repo root becomes "external file", not nothing (R27)',
        onlyOut.indexOf('"relPath":"external file"') !== -1, onlyOut.slice(0, 300));
  check('a relPath the payload already carried is not overwritten',
        onlyOut.indexOf('"relPath":"src/given.js"') !== -1 && onlyOut.indexOf('src/other.js') === -1);
  check('the lone absPath itself is still gone from the page',
        onlyOut.indexOf('absPath') === -1 && onlyOut.indexOf(REPO) === -1);

  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// R27 from a worktree: the derived relPath must strip the WORKING copy's root,
// not only the main copy's, or a worktree render would call every one of its
// own files "external file". Own temp repo, because a worktree is needed.
// ---------------------------------------------------------------------------
function relPathWorktreeTest() {
  console.log('\nderived relPath from a worktree (holistic review, R27)');
  const root = tmpdir('relwt');
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
    const wt = path.join(root, 'wt');
    git(main, ['worktree', 'add', '-q', '--detach', wt, 'HEAD']);

    const out = dataIsland(render(root, 'wt-abs', {
      title: 'WtAbs',
      findings: [{ id: 'R1', severity: 'warns', what: 'wt',
                   file: { absPath: path.join(wt, 'src', 'wt-only.js'), line: 2 } }]
    }, ['--no-abs'], wt).html);
    check('a lone absPath under the WORKING copy derives a relPath from that root (R27)',
          out.indexOf('"relPath":"src/wt-only.js"') !== -1, out.slice(0, 300));
    check('the worktree path is gone from the page', out.indexOf(wt) === -1);

    git(main, ['worktree', 'remove', '--force', wt]);
  } catch (e) {
    check('worktree relPath test set up a git repo and worktree', false, e.message);
  }

  fs.rmSync(root, { recursive: true, force: true });
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

  // A screenshot under the HOME directory but outside the repo. Under --no-abs
  // the path scrub ran BEFORE the embedder, so the src was rewritten to ~/...
  // first and the embedder then could not read it: "image unavailable" on the
  // publish-bound render only, while the local render embedded it fine
  // (holistic review, R1). HOME is pointed at a fixture directory rather than
  // the real one - os.homedir() reads HOME on posix and USERPROFILE on win32,
  // and the script takes its home prefix from os.homedir() - so the fixture
  // lives in the temp dir and the real home directory is never written to.
  const fakeHome = path.join(dir, 'home');
  const homeShot = path.join(fakeHome, 'shots', 'page.png');
  fs.mkdirSync(path.dirname(homeShot), { recursive: true });
  fs.writeFileSync(homeShot, PNG_1X1);
  const homeEnv = { HOME: fakeHome, USERPROFILE: fakeHome };
  const homePayload = {
    title: 'HomeShot',
    findings: [{ id: 'R1', severity: 'warns', what: 'home shot',
                 fields: [{ label: 'Shot', value: '<img src="' + homeShot + '" alt="h">' }] }]
  };
  const hc = render(dir, 'home-ctl', homePayload, [], null, homeEnv);
  check('control: a home-directory image embeds WITHOUT --no-abs',
        hc.html.indexOf('data:image/png;base64,') !== -1 && hc.html.indexOf('image unavailable') === -1);
  const hs = render(dir, 'home-strip', homePayload, ['--no-abs'], null, homeEnv);
  check('a home-directory image still embeds as a data: URI under --no-abs (R1)',
        hs.html.indexOf('data:image/png;base64,') !== -1);
  check('--no-abs does not turn a readable home-directory image into "image unavailable" (R1)',
        hs.html.indexOf('image unavailable') === -1);
  check('the home-directory path is gone from the --no-abs page',
        hs.html.indexOf(fakeHome) === -1);

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
    // Strip the stamp before syncing. The previous form of this check asserted
    // a stamp the --index-add just above had already written, so a sync that
    // did nothing at all still passed it (holistic-pass review, R7). The
    // control proves the stamp is really gone; the sync must bring it back.
    fs.writeFileSync(wtFile, '<!doctype html>\n<title>wt</title>\n', 'utf-8');
    check('control: the worktree stamp was stripped before sync',
          fs.readFileSync(wtFile, 'utf-8').split('\n')[0] === '<!doctype html>');
    const wtSync = spawnSync('node', [SCRIPT, '--index-sync'], { cwd: wt, encoding: 'utf-8' });
    check('--index-sync from a worktree re-stamps the worktree file with the newest url',
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
// Tolerates a trailing CR so a count over a CRLF-saved mirror sees its stamp,
// which is what the duplicate-stamp check below needs to measure (R15).
const STAMP_LINE = /^<!-- hosted: \S+ -->\r?$/;

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

// ---------------------------------------------------------------------------
// Containment, stamp targets, and stamp parsing (holistic-pass review:
// R11, R12, R14, R15, R16, R17, R18, R19)
//
// Own temp repo once more: every case here either tries to make a stamp land
// OUTSIDE the repo or hands the stamper a file it must refuse, so a case that
// escaped from this repo would rewrite something real.
// ---------------------------------------------------------------------------
function hardeningTests() {
  console.log('\ncontainment and stamp hardening (holistic-pass review)');
  const root = tmpdir('harden');
  const main = path.join(root, 'main');
  fs.mkdirSync(path.join(main, 'plans'), { recursive: true });
  const INDEX = path.join(main, 'artifacts/html/index.jsonl');
  const DOC = '<!doctype html>\n<title>h</title>\n';

  function git(args) {
    return execFileSync('git', args, { cwd: main, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  }
  // `env` is merged over the real environment: the win32 cases below set the
  // platform hook, and every other case must see it unset.
  function run(args, env) {
    const r = spawnSync('node', [SCRIPT].concat(args),
      { cwd: main, encoding: 'utf-8', env: Object.assign({}, process.env, env || {}) });
    return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
  }
  function add(name, local, url, env) {
    return run(['--index-add', '--type', 'plan', '--name', name, '--local', local, '--url', url], env);
  }
  function lines(file) { return fs.readFileSync(file, 'utf-8').split('\n'); }
  function stampCount(file) { return lines(file).filter(function (l) { return STAMP_LINE.test(l); }).length; }
  function rowCount() {
    return fs.existsSync(INDEX) ? fs.readFileSync(INDEX, 'utf-8').split('\n').filter(Boolean).length : 0;
  }
  // A row written by hand, the way --index-sync's header says the index can
  // be appended to. Bypasses every --index-add check on purpose: sync has to
  // hold its own line against whatever the index contains.
  function appendRow(local, url) {
    fs.mkdirSync(path.dirname(INDEX), { recursive: true });
    fs.appendFileSync(INDEX, JSON.stringify({
      at: new Date().toISOString(), type: 'plan', name: 'hand', local: local, url: url
    }) + '\n', 'utf-8');
  }
  // path.join would collapse the "." and ".." segments these cases depend on,
  // so the spellings are built by plain concatenation.
  const plansDir = path.join(main, 'plans');
  const dotted = function (file) { return plansDir + path.sep + '.' + path.sep + file; };

  try {
    git(['init', '-q']);
    git(['config', 'user.email', 't@example.com']);
    git(['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(main, 'README.md'), 'x\n');
    git(['add', '.']);
    git(['commit', '-qm', 'init']);

    // (a) R11: an absolute row whose path carries ".." after the repo-root
    // prefix passed the old string-prefix test and stamped a file outside
    // the repository.
    const outside = path.join(root, 'outside.html');
    fs.writeFileSync(outside, DOC, 'utf-8');
    appendRow(plansDir + path.sep + '..' + path.sep + '..' + path.sep + 'outside.html', 'https://example.com/dotdot');
    const s1 = run(['--index-sync']);
    check('--index-sync skips an absolute row with ".." after the repo root',
          s1.status === 0 && s1.err.indexOf('resolves outside the repository') !== -1, s1.err.trim() || s1.out.trim());
    check('the file that ".." pointed at outside the repo is untouched',
          fs.readFileSync(outside, 'utf-8') === DOC, lines(outside)[0]);

    // (b) R17: a symlink inside plans/ that resolves to a file outside.
    const target = path.join(root, 'target.html');
    fs.writeFileSync(target, DOC, 'utf-8');
    const link = path.join(plansDir, 'link.html');
    let linked = false;
    try { fs.symlinkSync(target, link); linked = true; }
    catch (err) { check('symlink fixture could be created', false, err.message); }
    if (linked) {
      const beforeLink = rowCount();
      const l = add('link', 'plans/link.html', 'https://example.com/link');
      check('--index-add refuses a symlink that resolves outside the repository',
            l.status !== 0 && /inside the repository/.test(l.err), l.err.trim() || '(exit ' + l.status + ')');
      check('the refused symlink appends no row', rowCount() === beforeLink);
      check('the symlink target outside the repo is untouched by --index-add',
            fs.readFileSync(target, 'utf-8') === DOC, lines(target)[0]);
      appendRow('plans/link.html', 'https://example.com/link-hand');
      const s2 = run(['--index-sync']);
      check('--index-sync skips a symlink row that resolves outside the repository',
            s2.status === 0 && /resolves outside the repository: .*link\.html/.test(s2.err), s2.err.trim());
      check('the symlink target outside the repo is untouched by --index-sync',
            fs.readFileSync(target, 'utf-8') === DOC, lines(target)[0]);
    }

    // (c) R11: two spellings of one file must be one byFile key. The dotted
    // spelling is the OLDEST and the NEWEST row with the plain one between,
    // so two keys would stamp the newest url first and the middle one last.
    const twin = path.join(plansDir, 'twin.html');
    fs.writeFileSync(twin, DOC, 'utf-8');
    appendRow(dotted('twin.html'), 'https://example.com/twin-a');
    appendRow(twin, 'https://example.com/twin-b');
    appendRow(dotted('twin.html'), 'https://example.com/twin-c');
    const s3 = run(['--index-sync']);
    check('two spellings of one file collapse to one byFile key (newest row wins)',
          s3.status === 0 && lines(twin)[0] === '<!-- hosted: https://example.com/twin-c -->', lines(twin)[0]);
    check('--index-sync counts one file for the two spellings and reports the skips',
          s3.out.trim() === 'index-sync: 1 stamped, 0 missing, 2 skipped', s3.out.trim());

    // (d) R14 / R18: only an HTML mirror may be stamped.
    const md = path.join(plansDir, 'PLAN-x.md');
    fs.writeFileSync(md, '# Plan\n', 'utf-8');
    const beforeMd = rowCount();
    const m = add('PLAN-x', 'plans/PLAN-x.md', 'https://example.com/md');
    check('--index-add refuses a --local that is not an .html mirror',
          m.status !== 0 && m.err.indexOf('must name an .html mirror') !== -1, m.err.trim() || '(exit ' + m.status + ')');
    check('a refused .md --local appends no row', rowCount() === beforeMd);
    check('the .md file is untouched by --index-add', fs.readFileSync(md, 'utf-8') === '# Plan\n', lines(md)[0]);
    appendRow('plans/PLAN-x.md', 'https://example.com/md-hand');
    const s4 = run(['--index-sync']);
    check('--index-sync skips a hand-written row that names a non-html file',
          s4.status === 0 && /skipped, not an \.html mirror: .*PLAN-x\.md/.test(s4.err), s4.err.trim());
    check('the .md file is untouched by --index-sync', fs.readFileSync(md, 'utf-8') === '# Plan\n', lines(md)[0]);
    check('--index-sync counts the non-html row as skipped',
          s4.out.trim() === 'index-sync: 1 stamped, 0 missing, 3 skipped', s4.out.trim());
    const htm = path.join(plansDir, 'p.htm');
    fs.writeFileSync(htm, DOC, 'utf-8');
    const h = add('htm', 'plans/p.htm', 'https://example.com/htm');
    check('control: .htm is accepted as an HTML mirror', h.status === 0 && stampCount(htm) === 1, h.err.trim());

    // (e) R12: the url guard is an allowlist. "--!>" closes an HTML comment
    // just as "-->" does, and the old denylist let it through.
    ['https://example.com/x--!>', 'https://example.com/<x', 'http://example.com/x'].forEach(function (bad) {
      const beforeUrl = rowCount();
      const u = add('bad-url', 'plans/twin.html', bad);
      check('--url is refused: ' + bad, u.status !== 0 && rowCount() === beforeUrl, u.err.trim() || '(exit ' + u.status + ')');
    });
    check('a refused --url never reaches the mirror',
          lines(twin)[0] === '<!-- hosted: https://example.com/twin-c -->', lines(twin)[0]);
    appendRow(twin, 'https://example.com/x--!>');
    const s5 = run(['--index-sync']);
    check('--index-sync ignores a hand-written row whose url could close the comment',
          s5.status === 0 && lines(twin)[0] === '<!-- hosted: https://example.com/twin-c -->', lines(twin)[0]);

    // (f) R15: a mirror re-saved with CRLF ends its stamp line in "\r".
    const crlf = path.join(plansDir, 'crlf.html');
    fs.writeFileSync(crlf, '<!-- hosted: https://example.com/crlf-old -->\r\n<!doctype html>\r\n<title>c</title>\r\n', 'utf-8');
    const c = add('crlf', 'plans/crlf.html', 'https://example.com/crlf-new');
    const crlfText = fs.readFileSync(crlf, 'utf-8');
    check('a CRLF-terminated stamp is replaced, not duplicated',
          c.status === 0 && stampCount(crlf) === 1, 'found ' + stampCount(crlf));
    check('the replaced CRLF stamp carries the new url',
          /^<!-- hosted: https:\/\/example\.com\/crlf-new -->\r?\n/.test(crlfText), JSON.stringify(crlfText.split('\n')[0]));
    check('everything after the replaced CRLF stamp is byte-identical',
          crlfText.slice(crlfText.indexOf('\n')) === '\n<!doctype html>\r\n<title>c</title>\r\n', JSON.stringify(crlfText));

    // (g) R19: a UTF-8 BOM must not be pushed to line 2, in front of the doctype.
    const bom = path.join(plansDir, 'bom.html');
    fs.writeFileSync(bom, '\uFEFF<!doctype html>\n<title>b</title>\n', 'utf-8');
    const bb = add('bom', 'plans/bom.html', 'https://example.com/bom');
    const bomText = fs.readFileSync(bom, 'utf-8');
    check('a BOM file ends up with the stamp at byte 0 and no U+FEFF before the doctype',
          bb.status === 0 && bomText.indexOf('<!-- hosted: https://example.com/bom -->') === 0 &&
          bomText.slice(0, bomText.indexOf('<!doctype')).indexOf('\uFEFF') === -1,
          JSON.stringify(bomText.slice(0, 60)));
    check('the BOM is dropped, not moved', bomText.indexOf('\uFEFF') === -1 && bomText.indexOf('<!doctype html>') !== -1);

    // (h) R16: on win32 the cwd and git's canonical path can differ only in
    // case. RENDER_HTML_PLATFORM=win32 is the script's hook for exercising
    // that branch from here; the flipped path exists only case-insensitively.
    const WIN = { RENDER_HTML_PLATFORM: 'win32' };
    const flipped = main.replace(/[a-z]/i, function (ch) {
      return ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
    });
    check('control: the case-flipped root really differs from the root', flipped !== main, flipped);
    const winLocal = path.join(flipped, 'plans', 'win.html');
    if (process.platform !== 'win32') {
      const beforeWin = rowCount();
      const w0 = add('win', winLocal, 'https://example.com/win');
      check('control: a case-flipped root is outside the repo on posix',
            w0.status !== 0 && rowCount() === beforeWin, w0.err.trim());
    }
    const beforeW1 = rowCount();
    const w1 = add('win', winLocal, 'https://example.com/win', WIN);
    check('under win32 a case-flipped root still counts as inside the repo',
          w1.status === 0 && rowCount() === beforeW1 + 1, w1.err.trim() || '(exit ' + w1.status + ')');
    const winFile = path.join(plansDir, 'win.html');
    fs.writeFileSync(winFile, DOC, 'utf-8');
    appendRow(path.join(plansDir, 'WIN.html'), 'https://example.com/win-upper');
    appendRow(winFile, 'https://example.com/win-lower');
    const s6 = run(['--index-sync']);
    check('control: on posix the upper-case spelling is a second, missing file',
          / 1 missing/.test(s6.out), s6.out.trim());
    const s7 = run(['--index-sync'], WIN);
    check('under win32 the byFile key folds case, so the two spellings are one file',
          s7.status === 0 && / 0 missing/.test(s7.out), s7.out.trim());
    check('under win32 the newest row for the folded key wins',
          lines(winFile)[0] === '<!-- hosted: https://example.com/win-lower -->', lines(winFile)[0]);
  } catch (err) {
    check('hardening test set up a git repo', false, err.message);
  }

  fs.rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Color scheme, tint tokens, and measured contrast (holistic review: R28,
// R30, R31)
//
// Every case reads a RENDERED page, because tokens.css only reaches a shell
// through render-html.js. Contrast is measured with the WCAG relative-
// luminance formula against the token values the page actually carries, and
// the text/background pairing under test is read out of the shell's own rule
// rather than assumed, so a tone change that pushes a state under AA fails
// here instead of in a reader's browser. The audit veto case composites the
// card's opacity over the page ground first, the way a browser paints it:
// that is what turned a 7:1 pairing into the 4.06:1 the finding measured.
// ---------------------------------------------------------------------------
function themeContrastTests() {
  console.log('\ncolor scheme, tint tokens, and contrast (holistic review: R28, R30, R31)');
  const dir = tmpdir('theme');
  const SHELLS = ['review', 'debate', 'document', 'explore', 'audit', 'plan', 'docview'];
  const SOFT = ['--accent-soft', '--positive-soft', '--warn-soft', '--block-soft'];

  // Render one shell from the minimal payload every shell accepts.
  function renderShell(shell) {
    const dataPath = path.join(dir, shell + '.json');
    fs.writeFileSync(dataPath, JSON.stringify({ title: 'Theme ' + shell }), 'utf-8');
    const out = execFileSync('node',
      [SCRIPT, '--shell', shell, '--name', 'theme-' + shell, '--out-dir', dir, '--stable', '--data', dataPath],
      { encoding: 'utf-8', cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return fs.readFileSync(out, 'utf-8');
  }
  // Body of the first CSS rule with exactly this selector, comments stripped.
  // The selector must be followed by "{" directly, so ".chip" does not match
  // ".chip.on" or ".chips", and it must start a selector, so ":root" does not
  // match inside ":root[data-theme=...]".
  function ruleBody(css, selector) {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp('(?:^|[\\s}])' + esc + '\\{([^}]*)\\}').exec(css);
    return m ? m[1].replace(/\/\*[\s\S]*?\*\//g, '') : null;
  }
  // { '--bg': '#ffffff', ... } from a rule body.
  function tokens(body) {
    const out = {};
    (body || '').replace(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\b/g, function (_, k, v) { out[k] = v; });
    return out;
  }
  // The declared value of one property in a rule body, or null when absent.
  function prop(body, name) {
    const m = new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)').exec(body || '');
    return m ? m[1].trim() : null;
  }
  function tokenName(value) {
    const m = /var\((--[\w-]+)\)/.exec(value || '');
    return m ? m[1] : null;
  }

  // WCAG 2.x: relative luminance per sRGB channel, ratio (L1 + .05) / (L2 + .05).
  function rgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    return [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16); });
  }
  function lum(hex) {
    const c = rgb(hex).map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  // `hex` painted at `alpha` over `ground`, per channel.
  function over(hex, alpha, ground) {
    const f = rgb(hex), g = rgb(ground);
    return '#' + f.map(function (v, i) {
      return ('0' + Math.round(alpha * v + (1 - alpha) * g[i]).toString(16)).slice(-2);
    }).join('');
  }
  function palettes(page) {
    return {
      light: tokens(ruleBody(page, ':root')),
      darkMedia: tokens(ruleBody(page, ':root:not([data-theme="light"])')),
      darkAttr: tokens(ruleBody(page, ':root[data-theme="dark"]'))
    };
  }

  const pages = {};
  SHELLS.forEach(function (s) { pages[s] = renderShell(s); });
  const pal = palettes(pages.review);
  check('control: the light palette parsed out of the rendered page',
        pal.light['--bg'] === '#ffffff' && pal.light['--text-muted'] === '#52525b', JSON.stringify(pal.light));
  check('control: both dark blocks parsed out of the rendered page',
        pal.darkMedia['--bg'] === '#18181b' && pal.darkAttr['--bg'] === '#18181b');

  // R28: color-scheme, so the parts the browser draws itself (scrollbars,
  // form controls) follow the palette instead of staying light in dark mode.
  SHELLS.forEach(function (s) {
    const p = pages[s];
    check(s + '-shell declares color-scheme: light dark on bare :root (R28)',
          /color-scheme\s*:\s*light dark\s*(;|$)/.test(ruleBody(p, ':root') || ''));
    check(s + '-shell declares color-scheme: dark in both dark blocks (R28)',
          /color-scheme\s*:\s*dark\s*(;|$)/.test(ruleBody(p, ':root:not([data-theme="light"])') || '') &&
          /color-scheme\s*:\s*dark\s*(;|$)/.test(ruleBody(p, ':root[data-theme="dark"]') || ''));
    check(s + '-shell pins color-scheme: light under an explicit light choice (R28)',
          /color-scheme\s*:\s*light\s*(;|$)/.test(ruleBody(p, ':root[data-theme="light"]') || ''));
  });

  // R30: the tint tokens exist in every rendered shell, in all three blocks.
  SHELLS.forEach(function (s) {
    const q = palettes(pages[s]);
    const missing = SOFT.filter(function (t) { return !(q.light[t] && q.darkMedia[t] && q.darkAttr[t]); });
    check(s + '-shell carries every tint token in the light palette and both dark blocks (R30)',
          missing.length === 0, 'missing ' + missing.join(' '));
  });
  check('the two dark blocks agree on every tint token',
        SOFT.every(function (t) { return pal.darkMedia[t] === pal.darkAttr[t]; }));
  check('a tint is a tint: no tint token repeats --bg-muted in either palette',
        SOFT.every(function (t) {
          return pal.light[t] && pal.darkAttr[t] &&
                 pal.light[t] !== pal.light['--bg-muted'] && pal.darkAttr[t] !== pal.darkAttr['--bg-muted'];
        }));

  // The exact regression R30 named: .chip.on had become .chip plus a text color.
  const chip = ruleBody(pages.review, '.chip'), chipOn = ruleBody(pages.review, '.chip.on');
  check('control: review-shell has both the .chip and .chip.on rules', !!chip && !!chipOn);
  check('review .chip.on background differs from .chip (R30)',
        !!chip && !!chipOn && prop(chipOn, 'background') !== null &&
        prop(chip, 'background') !== prop(chipOn, 'background'),
        prop(chip, 'background') + ' vs ' + prop(chipOn, 'background'));

  // Every text-on-tint state, measured from the rule the shell ships. The
  // background must be one of the tint tokens (a state drawn on --bg-muted is
  // the flattening R30 reported, however readable) and the pairing must clear
  // AA in both palettes.
  const PAIRS = [
    ['review', '.chip.on'], ['audit', '.tag--signal'], ['audit', '.tag--veto'],
    ['document', '.tag-new'], ['document', '.tag-mod'], ['document', '.tag-del'],
    ['document', 'h1 .pill'], ['explore', '.option .pick-badge']
  ];
  PAIRS.forEach(function (pair) {
    const body = ruleBody(pages[pair[0]], pair[1]);
    const fg = tokenName(prop(body, 'color')), bg = tokenName(prop(body, 'background'));
    [['light', pal.light], ['dark', pal.darkAttr]].forEach(function (p) {
      const t = p[1];
      const ok = !!(fg && bg && SOFT.indexOf(bg) !== -1 && t[fg] && t[bg]);
      const r = ok ? contrast(t[fg], t[bg]) : 0;
      check(pair[0] + ' ' + pair[1] + ' is a tint and its text clears AA 4.5:1 in ' + p[0] + ' (R30): ' + r.toFixed(2),
            ok && r >= 4.5, fg + ' on ' + bg + (ok ? '' : ' (not a tint token, or undefined)'));
    });
  });

  // R31: the vetoed audit card. The reason text is read from its own rule and
  // the card's opacity, when it has one, is composited over --bg first.
  const veto = ruleBody(pages.audit, '.cand--veto');
  const reason = ruleBody(pages.audit, '.cand--veto .cand-reason');
  check('control: audit-shell has the .cand--veto and .cand--veto .cand-reason rules', !!veto && !!reason);
  const alpha = prop(veto, 'opacity') === null ? 1 : parseFloat(prop(veto, 'opacity'));
  const vetoBg = tokenName(prop(veto, 'background')), vetoFg = tokenName(prop(reason, 'color'));
  [['light', pal.light], ['dark', pal.darkAttr]].forEach(function (p) {
    const t = p[1];
    const ok = !!(vetoFg && vetoBg && t[vetoFg] && t[vetoBg] && t['--bg']);
    const r = ok ? contrast(over(t[vetoFg], alpha, t['--bg']), over(t[vetoBg], alpha, t['--bg'])) : 0;
    check('audit vetoed-card reason text clears AA 4.5:1 in ' + p[0] + ' as painted (R31): ' + r.toFixed(2),
          ok && r >= 4.5, vetoFg + ' on ' + vetoBg + ' at opacity ' + alpha);
  });
  check('the vetoed card no longer fades its text with opacity (R31)',
        prop(veto, 'opacity') === null, 'opacity ' + prop(veto, 'opacity'));

  fs.rmSync(dir, { recursive: true, force: true });
}

noAbsTests();
relPathWorktreeTest();
imageTests();
indexTests();
stampTests();
hardeningTests();
themeContrastTests();

console.log('');
if (failures.length === 0) {
  console.log(passed + ' checks passed.\n');
  process.exit(0);
}
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach(function (f) { console.log('  - ' + f); });
console.log('');
process.exit(1);
