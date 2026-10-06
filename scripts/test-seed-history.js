#!/usr/bin/env node
'use strict';
// Tests for scripts/seed-history.js and the seeded-block and lessons readers it
// shares with .claude/scripts/upgrade-audit.js (C-15 and C-16): the block
// kinds (section comments, the opening comment, fenced paragraphs), the
// normalization (Windows line endings, trailing spaces, a byte order mark), the
// lessons bullet reader (comments skipped, continuation lines joined, the
// one-sentence rule), the script on a scratch repository with two tags (first
// release attribution, the --from floor, --check, determinism), and the shape
// of the two shipped history seeds.
// Run: node scripts/test-seed-history.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const sb = require(path.join(REPO, '.claude', 'scripts', 'upgrade-audit.js'));
const SCRIPT = path.join(REPO, 'scripts', 'seed-history.js');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (detail ? ' - ' + String(detail).slice(0, 400) : '')); }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-history-test-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ } });
// This machine's git config stays out of the scratch repository.
Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
const git = (dir, args) => spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false'].concat(args), { cwd: dir, encoding: 'utf8' });
const write = (root, rel, content) => { const a = path.join(root, rel); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, content); };
const read = (abs) => fs.readFileSync(abs, 'utf8');
const run = (args) => spawnSync('node', [SCRIPT].concat(args), { encoding: 'utf8' });
const seed = (name) => read(path.join(REPO, 'seed', name));

console.log('\n1. the block readers');
let blocks = sb.blocksOf('comments', sb.normalizeLines(seed('CLAUDE.md')));
check('seed/CLAUDE.md has five one-line section comments, each a block of its own', blocks.length === 5 && blocks.every(b => b.start === b.end && /^<!--.*-->$/.test(b.lines[0])), JSON.stringify(blocks.map(b => b.start)));
blocks = sb.blocksOf('opening-comment', sb.normalizeLines(seed('LESSONS.md')));
check('seed/LESSONS.md has one opening comment, lines 3 to 12, and nothing else is a block', blocks.length === 1 && blocks[0].start === 3 && blocks[0].end === 12 && blocks[0].lines[0].startsWith('<!--') && blocks[0].lines[9].endsWith('-->'), JSON.stringify(blocks.map(b => [b.start, b.end])));
blocks = sb.blocksOf('opening-comment', sb.normalizeLines(seed('DESIGN-PROFILE.md')));
check('seed/DESIGN-PROFILE.md opens with its comment at line 1', blocks.length === 1 && blocks[0].start === 1 && blocks[0].lines[blocks[0].lines.length - 1].trim() === '-->', JSON.stringify(blocks.map(b => [b.start, b.end])));
const readme = sb.normalizeLines(seed('toolkit-README.md'));
blocks = sb.blocksOf('paragraphs', readme);
const fenced = blocks.filter(b => b.lines[0].startsWith('```'));
check('seed/toolkit-README.md splits into paragraphs, its fenced agent example (a blank line inside) one block, none starting or ending blank', blocks.length > 10 && fenced.length === 2 && fenced.some(b => b.lines.includes('') && b.lines[b.lines.length - 1] === '```') && blocks.every(b => b.lines[0].trim() !== '' && b.lines[b.lines.length - 1].trim() !== ''), JSON.stringify(blocks.map(b => [b.start, b.end])));
check('its headline table is one paragraph and the heading above it another', blocks.some(b => b.lines.length === 1 && b.lines[0] === '## The six files') && blocks.some(b => b.lines[0].startsWith('| File | Read by |') && b.lines.length === 8), JSON.stringify(blocks.filter(b => b.lines[0].startsWith('|')).map(b => b.lines.length)));
const crlf = '﻿' + seed('CLAUDE.md').replace(/\n/g, '  \r\n');
check('Windows line endings, trailing spaces and a byte order mark hash the same as the seed; a hash is 16 hex characters; trailing blank lines do not count', sb.fileHash(sb.normalizeLines(crlf)) === sb.fileHash(sb.normalizeLines(seed('CLAUDE.md'))) && /^[0-9a-f]{16}$/.test(sb.hashLines(['a'])) && sb.fileHash(['a', '', '']) === sb.fileHash(['a']));
check('similarity: a heading that changed one word is near, unrelated text is not, an empty block is nothing like anything', sb.similarity(['## The five files'], ['## The six files']) > 0.5 && sb.similarity(['## The five files'], ['Write each one the way you would brief a colleague.']) < 0.3 && sb.similarity(['x'], []) === 0);
check('an unknown block kind is refused', (() => { try { sb.blocksOf('lines', ['a']); return false; } catch (e) { return /unknown block kind/.test(e.message); } })());

console.log('\n2. the lessons readers');
const L = sb.normalizeLines(['# Lessons', '', '<!-- One line per lesson. An index line looks like', '       - **The takeaway, in one bold sentence.** -->', '', '## What I Learned', '', '- **Read the map first.**', '- **Keep the port.** The dev server moves when two', '  projects run at once. Pin it in .env.', '* **Name the port (see #12).**', '', '## Mistakes', '- plain bullet with no lead', ''].join('\n'));
const bullets = sb.lessonBullets(L);
check('bullets are read outside comments, continuation lines joined, the bold lead taken', bullets.length === 4 && bullets[0].lead === 'Read the map first.' && bullets[1].start === 9 && bullets[1].end === 10 && bullets[1].text === '**Keep the port.** The dev server moves when two projects run at once. Pin it in .env.' && bullets[2].lead === 'Name the port (see #12).' && bullets[3].lead === null, JSON.stringify(bullets));
check('leadKey sets case, spacing and a closing period aside', sb.leadKey('  Hybrid  approach beats all-or-nothing. ') === 'hybrid approach beats all-or-nothing' && sb.leadKey('Use `git rev-parse` v2.0.') === 'use `git rev-parse` v2.0');
check('one bold sentence, with a version number or a parenthesis in it, is not long', !sb.isLongBullet('**Read the map first.**') && !sb.isLongBullet('**Use `git rev-parse` v2.0.**') && !sb.isLongBullet('**Name the port (see #12).**') && !sb.isLongBullet('**' + 'x'.repeat(295) + '.**'));
check('a second sentence, or 300 characters, makes a bullet long', sb.isLongBullet('**Keep the port.** The dev server moves.') && sb.isLongBullet('**Cache it.** Why? It is slow.') && sb.isLongBullet('**' + 'x'.repeat(300) + '**'));
check('parseHistory skips comments and odd lines and keeps the first line for a hash', (() => { const h = sb.parseHistory('# c\n\naaaa block CLAUDE.md v7.1.0\naaaa block CLAUDE.md v7.2.0\nbbbb file LESSONS.md v6.0.0\nbad line\n'); return h.get('CLAUDE.md').get('aaaa').release === 'v7.1.0' && h.get('LESSONS.md').get('bbbb').kind === 'file' && h.size === 2; })());

console.log('\n3. seed-history.js on a scratch repository with two tags');
const R = path.join(TMP, 'repo');
fs.mkdirSync(R, { recursive: true });
git(R, ['init', '-q']);
const V1_COMMENT = '<!-- This file is YOURS. -->';
const V2_COMMENT = '<!-- This file is YOURS. The toolkit never overwrites it. -->';
const KEPT_COMMENT = '<!-- Describe your project -->';
write(R, 'seed/CLAUDE.md', '# Project\n\n' + V1_COMMENT + '\n\n## About\n' + KEPT_COMMENT + '\n');
write(R, 'LESSONS.md', '# Lessons\n\n<!-- One line per lesson. -->\n\n- **Alpha lead.**\n- **Beta lead.** Two sentences. Here.\n');
git(R, ['add', '-A']); git(R, ['commit', '-q', '-m', 'v0.9']); git(R, ['tag', 'v0.9.0']);
// A tag below --from: its blocks are not history, its leads are.
write(R, 'LESSONS.md', read(path.join(R, 'LESSONS.md')) + '- **Gamma lead.**\n');
git(R, ['add', '-A']); git(R, ['commit', '-q', '-m', 'v1.0']); git(R, ['tag', 'v1.0.0']); git(R, ['tag', 'v0-web-app']);
write(R, 'seed/CLAUDE.md', '# Project\n\n' + V2_COMMENT + '\n\n## About\n' + KEPT_COMMENT + '\n');
write(R, 'seed/toolkit-README.md', '# Extensions\n\nParagraph one.\n\n```\ncode\n\nmore code\n```\n');
write(R, 'LESSONS.md', read(path.join(R, 'LESSONS.md')) + '- **alpha lead**\n- **Delta lead.**\n');
git(R, ['add', '-A']); git(R, ['commit', '-q', '-m', 'v1.1']); git(R, ['tag', 'v1.1.0']);
// The working tree carries one more lead than any tag.
write(R, 'LESSONS.md', read(path.join(R, 'LESSONS.md')) + '- **Epsilon lead.**\n');
const BLOCKS = path.join(TMP, 'blocks.txt');
const LEADS = path.join(TMP, 'leads.txt');
let r = run(['--repo', R, '--from', 'v1.0.0', '--blocks', BLOCKS, '--leads', LEADS]);
check('the script writes both files and reports three release tags (the web-app tag is none)', r.status === 0 && fs.existsSync(BLOCKS) && fs.existsSync(LEADS) && /wrote .*blocks\.txt/.test(r.stderr) && /wrote .*leads\.txt/.test(r.stderr) && /3 release tag\(s\)/.test(r.stderr), r.stderr);
const history = sb.parseHistory(read(BLOCKS));
const claude = history.get('CLAUDE.md') || new Map();
const h = (text) => sb.hashLines([text]);
check('the comment both tags shipped is one entry, attributed to the first tag in range', !!claude.get(h(KEPT_COMMENT)) && claude.get(h(KEPT_COMMENT)).release === 'v1.0.0' && claude.get(h(KEPT_COMMENT)).kind === 'block', read(BLOCKS));
check('the comment v1.0.0 shipped and the one v1.1.0 replaced it with are entries of their own tags', !!claude.get(h(V1_COMMENT)) && claude.get(h(V1_COMMENT)).release === 'v1.0.0' && !!claude.get(h(V2_COMMENT)) && claude.get(h(V2_COMMENT)).release === 'v1.1.0', read(BLOCKS));
check('each tag\'s whole seed file is a file entry', [...claude.values()].filter(x => x.kind === 'file').length === 2);
const readmeH = history.get('.claude/toolkit/README.md') || new Map();
check('a seed that first appears at v1.1.0 is attributed there: its heading, its paragraph and its fenced block (a blank line inside) three blocks, plus the file', readmeH.size === 4 && [...readmeH.values()].every(x => x.release === 'v1.1.0') && [...readmeH.values()].filter(x => x.kind === 'file').length === 1 && readmeH.has(sb.hashLines(['```', 'code', '', 'more code', '```'])) && readmeH.has(h('Paragraph one.')) && readmeH.has(h('# Extensions')), read(BLOCKS));
check('nothing below --from is history, and the header names the range', !read(BLOCKS).includes('v0.9.0') && /tags v1\.0\.0 to v1\.1\.0/.test(read(BLOCKS)), read(BLOCKS).split('\n')[2]);
const leads = read(LEADS).split('\n').filter(l => l && !l.startsWith('#'));
check('the leads are the union over every tag and the working tree, deduped by leadKey, sorted', JSON.stringify(leads) === JSON.stringify(['Alpha lead.', 'Beta lead.', 'Delta lead.', 'Epsilon lead.', 'Gamma lead.']), JSON.stringify(leads));
const first = read(BLOCKS) + read(LEADS);
r = run(['--repo', R, '--from', 'v1.0.0', '--blocks', BLOCKS, '--leads', LEADS, '--check']);
check('--check passes on current files and writes nothing', r.status === 0 && /is current/.test(r.stderr) && read(BLOCKS) + read(LEADS) === first, r.stderr);
fs.appendFileSync(LEADS, 'Zeta lead.\n');
r = run(['--repo', R, '--from', 'v1.0.0', '--blocks', BLOCKS, '--leads', LEADS, '--check']);
check('--check exits 1 on a file that differs and leaves it as it is', r.status === 1 && /leads\.txt differs/.test(r.stderr) && read(LEADS).includes('Zeta lead.'), r.stderr);
r = run(['--repo', R, '--from', 'v1.0.0', '--blocks', BLOCKS, '--leads', LEADS]);
check('a rerun rewrites the files to the same bytes', r.status === 0 && read(BLOCKS) + read(LEADS) === first);
r = run(['--repo', R, '--from', 'v9.9.9', '--blocks', BLOCKS, '--leads', LEADS]);
check('a --from tag the repository does not have is an error', r.status === 1 && /no tag v9\.9\.9/.test(r.stderr), r.stderr);
r = run(['--from', 'nope']);
check('a --from that is not a version tag is refused', r.status === 2 && /takes a tag/.test(r.stderr), r.stderr);
r = run(['--repo', path.join(TMP, 'not-a-repo'), '--blocks', BLOCKS, '--leads', LEADS]);
check('a folder that is not a git repository is an error', r.status === 1 && /not a git repository/.test(r.stderr), r.stderr);

console.log('\n4. the shipped history seeds');
const shipped = sb.parseHistory(read(path.join(REPO, 'seed', 'historical-seed-blocks.txt')));
check('seed/historical-seed-blocks.txt has block and file entries for all four seeded files', sb.SEED_FILES.every(sf => shipped.has(sf.rel) && [...shipped.get(sf.rel).values()].some(x => x.kind === 'block') && [...shipped.get(sf.rel).values()].some(x => x.kind === 'file')), [...shipped.keys()].join(','));
// The LESSONS.md comment the copy-installers wrote into projects up to v7.0.1.
const OLD_LESSONS_COMMENT = [
  '<!-- One line per lesson: the bold takeaway only. Full write-ups live in LESSONS-detail.md.',
  '     Commands read THIS file at session start (it is short on purpose); when a one-liner is',
  '     relevant to the task at hand, open the matching entry in LESSONS-detail.md for the detail.',
  '     To add a lesson: put the one-liner here under the right section, and the full write-up in',
  '     LESSONS-detail.md with the SAME bold lead so the two stay linked. Keep this file short -',
  '     it is the always-read surface. For deep dives into why a concept works, use /learning-opportunity. -->',
];
const oldHit = shipped.get('LESSONS.md') && shipped.get('LESSONS.md').get(sb.hashLines(OLD_LESSONS_COMMENT));
check('it knows the LESSONS.md comment the copy-installers wrote into projects, first shipped before v7.1.0', !!oldHit && oldHit.kind === 'block' && /^v[5-7]\./.test(oldHit.release) && !/^v7\.[1-9]/.test(oldHit.release), oldHit && oldHit.release);
const readmeShipped = shipped.get('.claude/toolkit/README.md') || new Map();
// A block is history once a release shipped it, and the file says which releases
// it covers in its own header ("from the release tags vA to vB"). The five-files
// heading shipped in v7.4.0 and the six-files heading in v7.6.0, so the second is
// in the file exactly when its range reaches v7.6.0: absent in the file 7.6.0
// itself shipped (generated before that tag existed), present from 7.6.1 on.
// Pinning "not yet" to a fixed heading broke the moment the next release
// regenerated the file (the 7.6.1 release gate).
const historyHeader = read(path.join(REPO, 'seed', 'historical-seed-blocks.txt')).split('\n').find(l => /release tags v\d+\.\d+\.\d+ to v\d+\.\d+\.\d+/.test(l)) || '';
const historyUpper = (historyHeader.match(/to v(\d+\.\d+\.\d+)/) || [])[1] || '0.0.0';
const versionAtLeast = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; } return true; };
const fiveShipped = readmeShipped.get(sb.hashLines(['## The five files']));
const sixShipped = readmeShipped.get(sb.hashLines(['## The six files']));
check('a block is history once a release shipped it: the five-files heading is v7.4.0\'s, and the six-files heading is v7.6.0\'s exactly when the file\'s own tag range reaches v7.6.0 (it reads to v' + historyUpper + ')', !!fiveShipped && fiveShipped.release === 'v7.4.0' && (versionAtLeast(historyUpper, '7.6.0') ? (!!sixShipped && sixShipped.release === 'v7.6.0') : !sixShipped), JSON.stringify({ upper: historyUpper, five: fiveShipped && fiveShipped.release, six: sixShipped && sixShipped.release }));
const shippedLeads = read(path.join(REPO, 'seed', 'toolkit-lesson-leads.txt')).split('\n').filter(l => l && !l.startsWith('#'));
const ownLeads = sb.lessonBullets(sb.normalizeLines(read(path.join(REPO, 'LESSONS.md')))).filter(b => b.lead);
check('seed/toolkit-lesson-leads.txt carries every lead of the toolkit\'s own index (' + shippedLeads.length + ' leads, ' + ownLeads.length + ' in the index now)', shippedLeads.length >= 140 && ownLeads.length > 0 && ownLeads.every(b => shippedLeads.some(l => sb.leadKey(l) === sb.leadKey(b.lead))), ownLeads.filter(b => !shippedLeads.some(l => sb.leadKey(l) === sb.leadKey(b.lead))).map(b => b.lead).join(' | '));
check('no shipped lead is blank once its closing period is set aside (a blank pattern would match every line)', shippedLeads.every(l => sb.leadKey(l) !== ''));

console.log('');
if (!failures.length) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach(f => console.log('  - ' + f));
process.exit(1);
