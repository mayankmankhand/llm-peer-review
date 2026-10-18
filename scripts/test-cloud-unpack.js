#!/usr/bin/env node
'use strict';
// Tests for .claude/skills/cloud/unpack.js (issue #263): the script /cloud runs
// on a saved cloud page to take out the report and every run file without the
// page passing through the chat. Each case builds a page in a throwaway folder
// outside any git work tree and runs the script on it as a child process.
// Run: node scripts/test-cloud-unpack.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO, '.claude/skills/cloud/unpack.js');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (detail ? ' - ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : '')); }
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cloud-unpack-'));
let n = 0;
// Writes a page into a fresh case folder and runs the script on it.
function run(html, extra = []) {
  const dir = path.join(ROOT, 'case-' + (++n));
  fs.mkdirSync(dir);
  const page = path.join(dir, 'index.html');
  if (html !== null) fs.writeFileSync(page, html);
  const out = path.join(dir, 'out');
  const r = spawnSync(process.execPath, [SCRIPT, '--page', page, '--out', out, ...extra], { encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { /* left null: the case reports it */ }
  return { dir, out, status: r.status, json, stderr: r.stderr };
}
const block = (attrs, text) => '<script ' + attrs + '>\n' + text + '\n</script>\n';
const REPORT = [
  '# Cloud research: 2026-10-18-example',
  '',
  '## Summary',
  '',
  '- One.',
  '- Two.',
  '',
  'Uncertain: little.',
  '',
  'Next: try it.',
  '',
  '## Findings',
  '',
  '- A claim [primary]',
  '',
  'Checker: 3 claims checked, 1 fixed, 0 dropped',
  '',
  'git status --porcelain: empty',
].join('\n');
const page = (...blocks) => '<!doctype html><html><body><h1>Example</h1>\n' + blocks.join('') + '</body></html>\n';

if (!fs.existsSync(SCRIPT)) {
  check('the script exists at .claude/skills/cloud/unpack.js', false, SCRIPT);
} else {
  // 1. The everyday page: a report and two run files.
  {
    const r = run(page(
      block('type="text/markdown" id="report-markdown"', REPORT),
      block('type="text/plain" class="run-file" data-name="reader-1.md"', 'reader one\nline two'),
      block('type="text/plain" class="run-file" data-name="checker.md"', 'held, held, wrong'),
    ), ['--link', 'https://claude.ai/artifact/EXAMPLE']);
    const saved = (rel) => fs.readFileSync(path.join(r.out, rel), 'utf8');
    check('a page with a report and two run files unpacks with exit 0', r.status === 0 && r.json && r.json.ok === true, r.status + ' ' + r.stderr);
    check('report.md holds the page link, a blank line, then the report word for word', r.status === 0 && saved('report.md') === 'https://claude.ai/artifact/EXAMPLE\n\n' + REPORT);
    check('each run file lands under files/ with its text unchanged', r.status === 0 && saved('files/reader-1.md') === 'reader one\nline two' && saved('files/checker.md') === 'held, held, wrong');
    check('the JSON lists the files saved, in page order, with their sizes', r.json && JSON.stringify(r.json.files) === JSON.stringify([{ name: 'reader-1.md', bytes: 19 }, { name: 'checker.md', bytes: 17 }]), JSON.stringify(r.json && r.json.files));
    check('the JSON carries the Summary section, heading included, and nothing after it', r.json && r.json.summary === '## Summary\n\n- One.\n- Two.\n\nUncertain: little.\n\nNext: try it.', JSON.stringify(r.json && r.json.summary));
    check('the JSON carries the checker and git status lines', r.json && r.json.checker === '3 claims checked, 1 fixed, 0 dropped' && r.json.gitStatus === 'empty', JSON.stringify(r.json));
  }
  // 2. The escape the brief asks for inside a block reads back as written.
  {
    const r = run(page(
      block('type="text/markdown" id="report-markdown"', REPORT + '\nA quoted tag: <\\/script> ends here.'),
    ));
    const text = r.status === 0 ? fs.readFileSync(path.join(r.out, 'report.md'), 'utf8') : '';
    check('a <\\/script> inside a block reads back as </script>, and no link line is added without --link', text === REPORT + '\nA quoted tag: </script> ends here.', JSON.stringify(text.slice(-60)));
  }
  // 3. File names are another session's data: none may leave files/.
  {
    const r = run(page(
      block('type="text/markdown" id="report-markdown"', REPORT),
      block('type="text/plain" class="run-file" data-name="../../evil.sh"', 'x'),
      block('type="text/plain" class="run-file" data-name=".bashrc"', 'x'),
      block('type="text/plain" class="run-file" data-name=""', 'x'),
      block('type="text/plain" class="run-file" data-name="notes.md"', 'first'),
      block('type="text/plain" class="run-file" data-name="notes.md"', 'second'),
      block('data-name="order.md" class="run-file" type="text/plain"', 'attributes in another order'),
    ));
    const names = r.json && r.json.files ? r.json.files.map((f) => f.name) : [];
    check('a hostile, hidden or empty name is cut to a plain name inside files/', JSON.stringify(names.slice(0, 3)) === JSON.stringify(['file-..-..-evil.sh', 'file-.bashrc', 'file-']), JSON.stringify(names));
    check('nothing is written outside the out folder', !fs.existsSync(path.join(r.dir, 'evil.sh')) && !fs.existsSync(path.join(ROOT, 'evil.sh')) && !fs.existsSync(path.join(r.out, 'evil.sh')));
    check('a repeated name gets a number before its extension, so neither file is lost', names[3] === 'notes.md' && names[4] === 'notes-2.md' && fs.readFileSync(path.join(r.out, 'files', 'notes-2.md'), 'utf8') === 'second', JSON.stringify(names));
    check('a run-file block is found whatever the attribute order', names[5] === 'order.md', JSON.stringify(names));
  }
  // 4. No report block: say so and write nothing.
  {
    const r = run(page(block('type="text/plain" class="run-file" data-name="reader-1.md"', 'x')));
    check('a page with no report block exits 1 with ok false and writes nothing', r.status === 1 && r.json && r.json.ok === false && !fs.existsSync(r.out), r.status + ' ' + JSON.stringify(r.json));
  }
  // 5. Usage and unreadable input are exit 2, never a half-written folder.
  {
    const usage = spawnSync(process.execPath, [SCRIPT, '--page', path.join(ROOT, 'x.html')], { encoding: 'utf8' });
    check('a missing --out is a usage error, exit 2', usage.status === 2 && /usage:/.test(usage.stderr), usage.status + ' ' + usage.stderr);
    const r = run(null);
    check('an unreadable page is exit 2 and writes nothing', r.status === 2 && !fs.existsSync(r.out), r.status + ' ' + r.stderr);
  }
  // 6. Mac and Windows disks treat Notes.md and notes.md as one file, so a
  // name that differs from another only by letter case gets a number too.
  {
    const r = run(page(
      block('type="text/markdown" id="report-markdown"', REPORT),
      block('type="text/plain" class="run-file" data-name="Notes.md"', 'upper'),
      block('type="text/plain" class="run-file" data-name="notes.md"', 'lower'),
    ));
    const names = r.json && r.json.files ? r.json.files.map((f) => f.name) : [];
    check('a name that differs from another only by letter case gets a number, so neither file is lost on a case-blind disk', JSON.stringify(names) === JSON.stringify(['Notes.md', 'notes-2.md']), JSON.stringify(names));
  }
  // 7. The same run unpacked twice (or two runs with one name on one day)
  // must not overwrite the first: the second lands in a numbered folder.
  {
    const dir = path.join(ROOT, 'case-' + (++n));
    fs.mkdirSync(dir);
    const pageFile = path.join(dir, 'index.html');
    fs.writeFileSync(pageFile, page(block('type="text/markdown" id="report-markdown"', REPORT)));
    const out = path.join(dir, 'out');
    const once = spawnSync(process.execPath, [SCRIPT, '--page', pageFile, '--out', out, '--link', 'FIRST'], { encoding: 'utf8' });
    const twice = spawnSync(process.execPath, [SCRIPT, '--page', pageFile, '--out', out + path.sep, '--link', 'SECOND'], { encoding: 'utf8' });
    let second = null;
    try { second = JSON.parse(twice.stdout); } catch (e) { /* left null: the case reports it */ }
    check('a second unpack into a folder that already holds a report goes to a numbered folder beside it and leaves the first untouched',
      once.status === 0 && twice.status === 0 && second !== null && second.report === path.join(out + '-2', 'report.md')
        && fs.readFileSync(path.join(out, 'report.md'), 'utf8').startsWith('FIRST\n'),
      twice.status + ' ' + JSON.stringify(second));
  }
}

fs.rmSync(ROOT, { recursive: true, force: true });
console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) { console.log('Failed: ' + failures.join(' | ')); process.exit(1); }
