#!/usr/bin/env node
'use strict';
// test-build-plugin.js - assertions for scripts/build-plugin.js (issue #167, Step 4;
// site overrides #176, quoted inline cats #172, seeds #173).
//
// Same shape as the other suites (test-render-html.js, test-pre-push-check.js):
// dependency-free, prints one line per check, exits non-zero on any failure.
// The rewrite rules are exercised against a small FIXTURE source tree built here;
// section 5 builds the live .claude/ into a temp dir (never into plugin/), and
// section 7 builds temp COPIES of the live source with planted breakage.
//
//   node scripts/test-build-plugin.js
//
// Exit codes: 0 every check passed, 1 at least one check failed.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BUILD = path.resolve(__dirname, 'build-plugin.js');
const REPO = path.resolve(__dirname, '..');
const lib = require(BUILD);

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { passed++; console.log('  ok  ' + name); }
  else { failures.push(name + (detail ? ' - ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' - ' + detail : '')); }
}
function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
function read(root, rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function exists(root, rel) { return fs.existsSync(path.join(root, rel)); }

// Site overrides are keyed by EMITTED file; the fixture plants each phrase in the
// matching source file so the fixture build has no unresolved override.
function sourceRelOf(emitted) { return emitted === 'seed/rules-toolkit.md' ? 'rules/toolkit.md' : emitted; }
function plantedLines(emitted) { return (lib.SITE_OVERRIDES[emitted] || []).map(s => s.phrase + '\n').join(''); }
// Emitted text with every kept override phrase of that file removed: what is left
// must carry no project path.
function withoutKeptPhrases(emitted, text) {
  for (const s of lib.SITE_OVERRIDES[emitted] || []) if (s.keep) text = text.split(s.phrase).join('');
  return text;
}
// The seed files that come straight from seed/ (every seed but the rules file).
const RAW_SEEDS = ['CLAUDE.md', 'LESSONS.md', 'LESSONS-detail.md', 'DESIGN-PROFILE.md', 'env.local.example', 'gitattributes', 'gitignore', 'artifacts-README.md', 'retired-permission-rows.txt', 'settings.local.json'];
const UNQUOTED_CAT = /!`cat \$\{CLAUDE_PLUGIN_ROOT\}/;
const QUOTED_CAT = /!`cat "\$\{CLAUDE_PLUGIN_ROOT\}\/[^`"\s]+"`/g;
const BARE_FAMILY = /(^|[^\w./:\-])\/(review|ask)-\*/;

// --- Fixture: a miniature toolkit source with every rewrite case planted ----
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-plugin-'));
  const src = path.join(root, '.claude');
  fs.writeFileSync(path.join(root, 'VERSION'), '9.9.9\n');
  write(src, 'commands/review.md', [
    '# Unified Review',
    '',
    'Use `/review` or `/review-code`; the family is `/review-*`. Then chain into `/document` through the Skill tool.',
    'Debates are the `/ask-*` family; an already scoped `/tk:review-*` stays single. Scratch pages are `/tmp/playground-*.html`, and skill files match `.claude/skills/review-*/SKILL.md`.',
    'Spawn a subagent with `subagent_type=review-finder` and a fallback `subagent_type=general-purpose`.',
    'Read `.claude/skills/project-context/SKILL.md` and `.claude/rules/toolkit.md`; settings live in `.claude/settings.local.json`.',
    'The old rules file was `.claude/rules/html-outputs.md`.',
    'Artifacts go to artifacts/html/review.html and reports/review-orchestrator-x.md.',
    '',
    '!`cat .claude/skills/shared/hitl-loop.md`',
    '',
    'Skill(review-code) is allowed.',
    '',
  ].join('\n'));
  write(src, 'commands/create-issue.md', '# Create Issue\n\nRun `gh issue create`.\n');
  write(src, 'commands/ask-gpt.md', '# Ask GPT\n\nA debate.\n');
  write(src, 'commands/document.md', '# Document\n\nRun `node .claude/scripts/correction-ledger.js --rollup` and open `bash .claude/scripts/open-artifact.sh x`.\n');
  write(src, 'agents/review-finder.md', '---\nname: review-finder\ndescription: finder for /review\ntools: Read\n---\n\nSee `.claude/skills/shared/model-routing.md`.\n');
  write(src, 'skills/review-code/SKILL.md', '---\nname: review-code\ndescription: code review\nallowed-tools:\n  - Read\n  - Bash\n---\n\n# Code Review\n\n!`cat .claude/skills/shared/html-render-review.md`\n');
  write(src, 'skills/review-browser/SKILL.md', '---\nname: review-browser\ndescription: browser qa\nallowed-tools: Read Bash\n---\n\nDrive `node .claude/scripts/browse.js` per `.claude/skills/shared/browse-api.md`.\n');
  write(src, 'skills/shared/hitl-loop.md', 'M11: run `node .claude/scripts/pre-push-check.js` before a push.\n\n!`cat .claude/rules/html-outputs.md`\n');
  write(src, 'skills/shared/html-render-review.md', 'Run `node .claude/scripts/render-html.js --shell review`.\n');
  write(src, 'skills/shared/html-outputs.md', 'Relocated HTML rules. Open with `bash .claude/scripts/open-artifact.sh`.\n');
  write(src, 'skills/shared/model-routing.md', 'roster\n');
  write(src, 'skills/shared/browse-api.md', 'api\n');
  write(src, 'skills/shared/shells/review-shell.html', '<!-- rendered by .claude/scripts/render-html.js -->\n<html></html>\n');
  write(src, 'skills/shared/shells/tokens.css', ':root{}\n');
  write(src, 'scripts/render-html.js', '// shells at path.join(__dirname, "..", "skills", "shared", "shells")\nconsole.log("render");\n');
  write(src, 'scripts/open-artifact.sh', '#!/usr/bin/env bash\necho open\n');
  write(src, 'scripts/session-start.js', '// the SessionStart hook\n');
  write(src, 'scripts/package.json', '{ "name": "fixture", "dependencies": {} }\n');
  write(src, 'scripts/package-lock.json', '{ "lockfileVersion": 3 }\n');
  write(src, 'scripts/node_modules/left-pad/index.js', 'module.exports = 1;\n');
  write(src, 'settings.local.json', '{ "permissions": { "allow": ["Bash(rm -rf /)"] } }\n');
  write(src, 'settings.json', '{}\n');
  write(src, 'worktrees/worktree-1/.claude/commands/review.md', '# stale copy\n');
  write(src, 'skills/shared/conventions.md', '# Conventions\n\n### C-1: By name\n- **Since:** 7.0.0\n- **Looks behind:** `\\.claude/skills/shared/`\n- **Fix:** name it\n');
  write(src, 'rules/toolkit.md', '<!-- Toolkit version: 9.9.9 | seed -->\n\nUse the Skill tool for /review, /review-code and /review-*; your permissions live in `.claude/settings.local.json`.\n');
  write(src, 'skills/shared/design-profile-template.md', '# Design profile\n');
  // The repository root's own files are the MAINTAINER's and must never be seeded;
  // the seed comes from seed/ (issue #173).
  write(root, 'CLAUDE.md', '# Maintainer instructions, never seeded\n');
  write(root, '.gitignore', 'node_modules/\nplugin-scratch/\n');
  write(root, 'seed/CLAUDE.md', '# Project Instructions\n\nUse /tk:explore.\n');
  write(root, 'seed/LESSONS.md', '# Lessons\n');
  write(root, 'seed/LESSONS-detail.md', '# Lessons detail\n');
  write(root, 'seed/DESIGN-PROFILE.md', '# Design profile (seed)\n');
  write(root, 'seed/env.local.example', 'OPENAI_API_KEY=\n');
  write(root, 'seed/gitattributes', '*.sh text eol=lf\n');
  write(root, 'seed/gitignore', 'node_modules/\nplans/PLAN-*.md\n.claude/worktrees/\n.toolkit-backup-*/\n');
  write(root, 'seed/artifacts-README.md', '# artifacts\n');
  write(root, 'seed/retired-permission-rows.txt', '# retired rows\nBash(node .claude/scripts/browse.js *)\nBash(bash -n scripts/setup/setup.sh)\nSkill(review)\n');
  write(root, 'seed/settings.local.json', '{ "permissions": { "allow": ["Bash(git add *)", "Skill(tk:review)"] } }\n');
  write(root, 'scripts/historical-managed-paths.txt', '# a comment line is ignored\n\n.claude/commands/review-code.md\n.claude/skills/shared/output-template.md\n');
  for (const emitted of Object.keys(lib.SITE_OVERRIDES)) {
    const abs = path.join(src, sourceRelOf(emitted));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.appendFileSync(abs, plantedLines(emitted));
  }
  return { root, src };
}

// A temp copy of the live source: .claude/ (without dependencies and worktrees),
// seed/, VERSION, and the historical list, so a planted break never touches the repo.
function copyLiveSource() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-plugin-copy-'));
  const skip = (p) => /(^|[\\/])(node_modules|worktrees)([\\/]|$)/.test(path.relative(REPO, p));
  fs.cpSync(path.join(REPO, '.claude'), path.join(root, '.claude'), { recursive: true, filter: (p) => !skip(p) });
  fs.cpSync(path.join(REPO, 'seed'), path.join(root, 'seed'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'VERSION'), path.join(root, 'VERSION'));
  write(root, 'scripts/historical-managed-paths.txt', read(REPO, 'scripts/historical-managed-paths.txt'));
  return { root, src: path.join(root, '.claude') };
}

function runBuild(args, cwd) {
  const r = spawnSync('node', [BUILD, ...args], { cwd: cwd || REPO, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// --- 1. Rewrites -------------------------------------------------------------
console.log('\n1. path and name rewrites');
const fx = makeFixture();
const out = path.join(fx.root, 'plugin');
const b = runBuild(['--source', fx.src, '--out', out, '--quiet']);
check('build exits 0', b.status === 0, b.stderr);
const review = read(out, 'commands/review.md');
check('slash command becomes scoped', review.includes('`/tk:review`') && review.includes('`/tk:review-code`'), review);
check('the /review-* family is scoped', review.includes('the family is `/tk:review-*`') && !BARE_FAMILY.test(review), review);
check('the /ask-* family is scoped', review.includes('`/tk:ask-*`'));
check('an already scoped family is not scoped twice', review.includes('an already scoped `/tk:review-*` stays') && !review.includes('tk:tk:'));
check('a wildcard path is not mistaken for a family', review.includes('`/tmp/playground-*.html`') && review.includes('`${CLAUDE_PLUGIN_ROOT}/skills/review-*/SKILL.md`'));
check('chained stage is scoped', review.includes('`/tk:document`'));
check('subagent_type of a toolkit agent is scoped', review.includes('subagent_type=tk:review-finder'));
check('built-in agent is untouched', review.includes('subagent_type=general-purpose'));
check('Skill() reference is scoped', review.includes('Skill(tk:review-code)'));
check('skill path is rewritten to the plugin root', review.includes('${CLAUDE_PLUGIN_ROOT}/skills/project-context/SKILL.md'));
check('seed rules path stays a project path', review.includes('`.claude/rules/toolkit.md`'));
check('settings path stays a project path', review.includes('`.claude/settings.local.json`'));
check('relocated html rules map to the shared fragment', review.includes('${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md'));
check('inline-cat is rewritten with the path quoted', review.includes('!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md"`'));
const fixtureCats = walkFiles(out).filter(f => f.endsWith('.md')).map(f => fs.readFileSync(f, 'utf8'));
check('no emitted fixture markdown keeps an unquoted inline cat', !fixtureCats.some(t => UNQUOTED_CAT.test(t)));
check('the relocated html rules inline cat is quoted too', read(out, 'skills/shared/hitl-loop.md').includes('!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md"`'));
check('artifact file paths are not mistaken for commands', review.includes('artifacts/html/review.html') && review.includes('reports/review-orchestrator-x.md'));
const agent = read(out, 'agents/review-finder.md');
check('agent prose path is rewritten', agent.includes('${CLAUDE_PLUGIN_ROOT}/skills/shared/model-routing.md'));
check('agent description slash name is scoped', agent.includes('/tk:review'));

// --- 2. Permissions ----------------------------------------------------------
console.log('\n2. allowed-tools injection');
const fm = (t) => (/^---\n([\s\S]*?)\n---/.exec(t) || [, ''])[1];
check('command frontmatter is created with a description', fm(review).includes('description: "Unified Review"'));
check('a script called only inside an inlined fragment still gets its rule', fm(review).includes('Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js *)'));
check('a relocated fragment reached through inline-cat is followed', fm(review).includes('Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh *)'));
const ci = read(out, 'commands/create-issue.md');
check('host rows are added for create-issue', fm(ci).includes('Bash(gh issue create *)') && fm(ci).includes('Bash(glab issue create *)'));
const doc = read(out, 'commands/document.md');
check('direct script calls get exact and wildcard rules', fm(doc).includes('Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/correction-ledger.js *)') && fm(doc).includes('Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/correction-ledger.js)'));
check('a command with no script calls gets no allowed-tools key', !fm(read(out, 'commands/create-issue.md')).includes('allowed-tools') || fm(ci).includes('gh issue create'));
const rc = read(out, 'skills/review-code/SKILL.md');
check('skill list-form allowed-tools keeps existing items', fm(rc).includes('  - Read') && fm(rc).includes('  - Bash'));
check('skill gains the render rule through its inlined fragment', fm(rc).includes('Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js *)'));
const rb = read(out, 'skills/review-browser/SKILL.md');
check('skill scalar-form allowed-tools is converted and extended', fm(rb).includes('  - "Read"') || fm(rb).includes('  - Read'));
check('browse.js gets its piped forms', fm(rb).includes('Bash(echo * | node ${CLAUDE_PLUGIN_ROOT}/scripts/browse.js *)'));
const fxInv = lib.inventory(fx.src);
const viaQuoted = lib.scriptRules('!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md"`\n', fxInv, fx.src);
check('scriptRules follows a quoted inline-cat chain', viaQuoted.includes('Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js *)') && viaQuoted.includes('Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh *)'), viaQuoted.join(', '));
const viaBare = lib.scriptRules('!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`\n', fxInv, fx.src);
check('scriptRules still follows the unquoted form', JSON.stringify(viaBare) === JSON.stringify(viaQuoted), viaBare.join(', '));

// --- 3. Layout and allowlist -------------------------------------------------
console.log('\n3. emitted layout');
check('package files move to the plugin root', exists(out, 'package.json') && exists(out, 'package-lock.json') && !exists(out, 'scripts/package.json'));
check('runtime scripts are emitted', exists(out, 'scripts/render-html.js') && exists(out, 'scripts/open-artifact.sh'));
check('shells and tokens are emitted verbatim', exists(out, 'skills/shared/shells/review-shell.html') && exists(out, 'skills/shared/shells/tokens.css'));
check('node_modules is never emitted', !exists(out, 'scripts/node_modules') && !exists(out, 'node_modules'));
check('worktrees are never emitted', !exists(out, 'worktrees') && !exists(out, 'commands/worktree-1'));
check('settings files are never emitted', !exists(out, 'settings.local.json') && !exists(out, 'settings.json'));
check('rules are never emitted (they are the seed)', !exists(out, 'rules'));
const manifest = JSON.parse(read(out, '.claude-plugin/plugin.json'));
check('plugin.json carries the name and the VERSION file version', manifest.name === 'tk' && manifest.version === '9.9.9');
const hooks = JSON.parse(read(out, 'hooks/hooks.json'));
const hookCommands = (hooks.hooks.SessionStart || []).flatMap(h => h.hooks || []).map(h => h.command);
check('SessionStart hook runs session-start.js through node with the path quoted', hookCommands.length === 1 && hookCommands[0] === 'node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.js"', JSON.stringify(hookCommands));
check('the hook carries no shell-only syntax', !/mkdir|ln -s|\|\||&&/.test(JSON.stringify(hooks)));
const managed = JSON.parse(read(out, 'managed-paths.json'));
check('managed-paths lists copy-install paths', managed.paths.includes('.claude/commands/review.md') && managed.paths.includes('.claude/rules/toolkit.md') && managed.paths.includes('.env.local.example') && managed.paths.includes('.claude/scripts/package.json'));
check('managed-paths adds every historical path and skips comments and blanks', managed.paths.includes('.claude/commands/review-code.md') && managed.paths.includes('.claude/skills/shared/output-template.md') && !managed.paths.some(p => p === '' || p.startsWith('#')));
check('managed-paths lists each path once', new Set(managed.paths).size === managed.paths.length);
check('managed-paths never lists node_modules or settings', !managed.paths.some(p => /node_modules|settings/.test(p)));
check('the seed carries every project file the installer seeds', [...RAW_SEEDS, 'rules-toolkit.md'].every(r => exists(out, 'seed/' + r)));
check('every raw seed equals its seed/ source byte for byte', RAW_SEEDS.every(r => fs.readFileSync(path.join(out, 'seed', r)).equals(fs.readFileSync(path.join(fx.root, 'seed', r)))), RAW_SEEDS.filter(r => !fs.readFileSync(path.join(out, 'seed', r)).equals(fs.readFileSync(path.join(fx.root, 'seed', r)))).join(', '));
check('the maintainer root files are never seeded', read(out, 'seed/CLAUDE.md') !== read(fx.root, 'CLAUDE.md') && read(out, 'seed/gitignore') !== read(fx.root, '.gitignore'));
check('the conventions file is copied raw, its .claude/ regexes untouched', read(out, 'skills/shared/conventions.md') === read(fx.src, 'skills/shared/conventions.md') && read(out, 'skills/shared/conventions.md').includes('`\\.claude/skills/shared/`'));
check('the seed rules file is the source with command names scoped and its override kept', read(out, 'seed/rules-toolkit.md') === '<!-- Toolkit version: 9.9.9 | seed -->\n\nUse the Skill tool for /tk:review, /tk:review-code and /tk:review-*; your permissions live in `.claude/settings.local.json`.\n' + plantedLines('seed/rules-toolkit.md'), read(out, 'seed/rules-toolkit.md'));
check('the seed rules file carries no plugin root token', !read(out, 'seed/rules-toolkit.md').includes('${CLAUDE_PLUGIN_ROOT}'));
const stray = [];
for (const f of walkFiles(out)) {
  if (!/\.md$/.test(f)) continue;
  const rel = path.relative(out, f).split(path.sep).join('/');
  if (rel === 'skills/shared/conventions.md') continue; // data: its regexes name downstream paths on purpose
  const t = withoutKeptPhrases(rel, fs.readFileSync(f, 'utf8'));
  for (const m of t.matchAll(/\.claude\/(commands|agents|skills|scripts)\//g)) stray.push(rel + ': ' + m[0]);
}
check('no emitted markdown keeps a .claude/{commands,agents,skills,scripts}/ path outside an override site', stray.length === 0, stray.join(', '));
const overrideMisses = [];
for (const [emitted, sites] of Object.entries(lib.SITE_OVERRIDES)) {
  const t = read(out, emitted);
  for (const s of sites) {
    if (s.keep && !t.includes(s.phrase)) overrideMisses.push(emitted + ' lost kept phrase: ' + s.phrase);
    if (!s.keep && (!t.includes(s.replace) || t.includes(s.phrase))) overrideMisses.push(emitted + ' replacement did not land: ' + s.replace);
  }
}
check('fixture: every kept override phrase survives and every replacement lands', overrideMisses.length === 0, overrideMisses.join('; '));
const fxUnresolved = lib.build(fx.src, '9.9.9').unresolved;
check('fixture build reports no unresolved reference', fxUnresolved.length === 0, fxUnresolved.join('; '));
// The override placeholder must be written as an escape: a raw control byte is
// invisible in editors and diffs, and once stripped the placeholder is a bare
// digit that the restore step would swap for a kept phrase all over the file.
check('build-plugin.js holds no raw control character (placeholders use the \\u0001 escape)', !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(fs.readFileSync(BUILD, 'utf8')));

// --- 4. --check --------------------------------------------------------------
console.log('\n4. --check');
const c1 = runBuild(['--source', fx.src, '--out', out, '--check', '--quiet']);
check('--check is clean right after a build', c1.status === 0, c1.stderr);
fs.appendFileSync(path.join(fx.src, 'commands', 'review.md'), '\nA new line.\n');
const c2 = runBuild(['--source', fx.src, '--out', out, '--check', '--quiet']);
check('--check fails when the source moved on', c2.status === 1 && /differs: commands\/review\.md/.test(c2.stderr), c2.stderr);
write(fx.src, 'commands/dangling.md', '# Dangling\n\nRead `.claude/rules/nope.md` and `.claude/skills/shared/html-outputs.md`.\n');
fs.rmSync(path.join(fx.src, 'skills', 'shared', 'html-outputs.md'));
write(fx.src, 'commands/dangling2.md', '# Dangling two\n\nRead `.claude/rules/html-outputs.md`.\n');
write(fx.src, 'commands/homepath.md', '# Home\n\nKeys live in `~/.claude/plugins/.env.local`; the ledger is `~/.claude/correction-ledger.jsonl`; the stable path is `~/.claude/plugins/data/tk-x/current/skills/shared/toolkit-reference.md`.\n');
runBuild(['--source', fx.src, '--out', out, '--quiet']);
const c3 = runBuild(['--source', fx.src, '--out', out, '--check', '--quiet']);
check('--check fails on an unresolvable html-outputs reference when the fragment is absent', c3.status === 1 && /unresolved reference .*html-outputs\.md/.test(c3.stderr), c3.stderr);
check('a project rules path other than html-outputs is kept, not reported', !/nope\.md/.test(c3.stderr), c3.stderr);
check('a home-directory path (~/.claude/...) is neither rewritten nor reported', !/homepath/.test(c3.stderr) && read(out, 'commands/homepath.md').includes('`~/.claude/plugins/.env.local`') && read(out, 'commands/homepath.md').includes('~/.claude/plugins/data/tk-x/current/skills/shared/toolkit-reference.md'), c3.stderr);

// --- 5. The real source ------------------------------------------------------
console.log('\n5. the live source builds');
const live = fs.mkdtempSync(path.join(os.tmpdir(), 'build-plugin-live-'));
const l = runBuild(['--out', live, '--quiet']);
check('live .claude/ builds without error', l.status === 0, l.stderr);
check('live build reports no unresolved reference', !/unresolved/.test(l.stderr), l.stderr);
check('live build emits every command', fs.readdirSync(path.join(REPO, '.claude', 'commands')).every(f => exists(live, 'commands/' + f)));
check('live build emits every agent', fs.readdirSync(path.join(REPO, '.claude', 'agents')).every(f => exists(live, 'agents/' + f)));
check('live build emits all seven shells', fs.readdirSync(path.join(live, 'skills', 'shared', 'shells')).filter(f => f.endsWith('-shell.html')).length === 7);
const render = spawnSync('node', [path.join(live, 'scripts', 'render-html.js'), '--shell', 'review', '--name', 'probe', '--out-dir', path.join(live, 'artifacts'), '--stable', '--no-abs', '--data', writeTmp('{"title":"probe","findings":[]}')], { cwd: live, encoding: 'utf8' });
check('render-html.js finds its shells from the emitted layout', render.status === 0 && exists(live, 'artifacts/probe.html'), render.stderr);
const liveMissed = [];
for (const [emitted, sites] of Object.entries(lib.SITE_OVERRIDES)) {
  if (!exists(live, emitted)) { liveMissed.push(emitted + ' not emitted'); continue; }
  const t = read(live, emitted);
  for (const s of sites) {
    if (s.keep && !t.includes(s.phrase)) liveMissed.push(emitted + ' lost kept phrase: ' + s.phrase);
    if (!s.keep && (!t.includes(s.replace) || t.includes(s.phrase))) liveMissed.push(emitted + ' replacement did not land: ' + s.replace);
  }
}
check('live: every kept override phrase survives and every replacement lands', liveMissed.length === 0, liveMissed.join('; '));
check('live: the deps criteria audit the plugin root, not scripts/', read(live, 'skills/shared/criteria-deps.md').includes('--prefix "${CLAUDE_PLUGIN_ROOT}"') && !read(live, 'skills/shared/criteria-deps.md').includes('${CLAUDE_PLUGIN_ROOT}/scripts`'));
const liveMd = walkFiles(live).filter(f => f.endsWith('.md') && !f.endsWith(path.join('shared', 'conventions.md')));
const liveUnquoted = liveMd.filter(f => UNQUOTED_CAT.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(live, f));
const liveQuoted = liveMd.reduce((n, f) => n + (fs.readFileSync(f, 'utf8').match(QUOTED_CAT) || []).length, 0);
check('live: every emitted inline cat is quoted', liveUnquoted.length === 0 && liveQuoted > 100, 'unquoted in ' + liveUnquoted.join(', ') + '; quoted ' + liveQuoted);
const liveBareFamily = liveMd.filter(f => BARE_FAMILY.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(live, f));
check('live: no emitted markdown names a bare /review-* or /ask-* family', liveBareFamily.length === 0, liveBareFamily.join(', '));
const liveHook = JSON.parse(read(live, 'hooks/hooks.json')).hooks.SessionStart[0].hooks[0].command;
check('live: the hook runs node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.js"', liveHook === 'node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.js"', liveHook);
check('live: scripts/session-start.js and scripts/env-local.js are emitted', exists(live, 'scripts/session-start.js') && exists(live, 'scripts/env-local.js'));
const liveSeedDiffs = RAW_SEEDS.filter(r => !exists(REPO, 'seed/' + r) || !fs.readFileSync(path.join(live, 'seed', r)).equals(fs.readFileSync(path.join(REPO, 'seed', r))));
check('live: every raw seed equals its seed/ source', liveSeedDiffs.length === 0, liveSeedDiffs.join(', '));
const liveSeedTokens = walkFiles(path.join(live, 'seed')).filter(f => fs.readFileSync(f, 'utf8').includes('${CLAUDE_PLUGIN_ROOT}')).map(f => path.relative(live, f));
check('live: no seed file carries ${CLAUDE_PLUGIN_ROOT}', liveSeedTokens.length === 0, liveSeedTokens.join(', '));
// The Permissions table in the built toolkit-reference.md names exactly the allow rows
// the built seed writes (issue #173): a seed row the table lacks, or a table row setup
// never writes, is drift a reader would copy into their settings.
const seedAllowRows = JSON.parse(read(live, 'seed/settings.local.json')).permissions.allow;
const refRel = 'skills/shared/toolkit-reference.md';
const tableRows = permissionTableRows(read(live, refRel));
const drift = rowDrift(tableRows, seedAllowRows);
check('live: the toolkit-reference Permissions table names exactly the seed allow rows', tableRows !== null && drift.missing.length === 0 && drift.extra.length === 0,
  tableRows === null ? 'no Permissions table found' : 'in the seed but not the table: ' + drift.missing.join(', ') + '; in the table but not the seed: ' + drift.extra.join(', '));
// Mutation: a temp copy of the reference with one row dropped from the table must fail.
const refText = read(live, refRel);
const droppedRow = tableRows && tableRows.length ? tableRows[0] : '';
const firstDataLine = refText.split('\n').find(l => l.startsWith('|') && l.includes('`' + droppedRow + '`')) || '';
const mutatedLine = firstDataLine.replace('`' + droppedRow + '`, ', '').replace('`' + droppedRow + '`', '');
write(live, 'toolkit-reference.mutated.md', refText.replace(firstDataLine, mutatedLine));
const mutatedDrift = rowDrift(permissionTableRows(read(live, 'toolkit-reference.mutated.md')), seedAllowRows);
check('mutation: dropping one table row trips the drift assertion', droppedRow !== '' && mutatedLine !== firstDataLine && mutatedDrift.missing.length === 1 && mutatedDrift.missing[0] === droppedRow && mutatedDrift.extra.length === 0, JSON.stringify({ droppedRow, mutatedDrift }));

// --- 6. The key lookup from a plugin cache layout (issue #177) ------------------
console.log('\n6. key lookup from the plugin cache');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'build-plugin-home-'));
const cacheRoot = path.join(home, '.claude', 'plugins', 'cache', 'llm-peer-review', 'tk', '9.9.9');
const cacheScripts = path.join(cacheRoot, 'scripts');
fs.mkdirSync(cacheScripts, { recursive: true });
// ask-gpt.js requires env-local.js from its own folder, so the cache holds both, as a
// real plugin install does.
for (const f of ['ask-gpt.js', 'env-local.js']) fs.copyFileSync(path.join(REPO, '.claude', 'scripts', f), path.join(cacheScripts, f));
fs.mkdirSync(path.join(cacheRoot, 'skills', 'shared'), { recursive: true });
for (const f of ['finding-contract.md', 'report-format.md']) fs.copyFileSync(path.join(REPO, '.claude', 'skills', 'shared', f), path.join(cacheRoot, 'skills', 'shared', f));
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'build-plugin-proj-'));
// A .git marks the project root, so the project lookup never climbs into the OS temp dir.
fs.mkdirSync(path.join(proj, '.git'));
fs.writeFileSync(path.join(proj, 'in.md'), 'x\n');
const machineEnv = path.join(home, '.claude', 'plugins', '.env.local');
const projectEnv = path.join(proj, '.env.local');
// Made-up keys, assembled here so no real-shaped key sits in the source. The fixture
// lines below join name and value at runtime so the pre-push tripwire's
// secret-assignment pattern never sees them as one quoted assignment.
const machineKey = 'sk-' + 'test-machine-level';
const projectKey = 'sk-' + 'test-project-level';
// A preload replaces fetch inside the child: it prints the bearer token it was handed
// and answers 401, so nothing leaves the machine and a check can see WHICH key won.
const probe = path.join(home, 'probe-fetch.js');
fs.writeFileSync(probe, [
  "'use strict';",
  'globalThis.fetch = async function (url, init) {',
  "  const auth = new Headers((init && init.headers) || {}).get('authorization') || '';",
  "  process.stderr.write('PROBE-AUTH ' + auth + '\\n');",
  "  return new Response('{\"error\":{\"message\":\"probe\"}}', { status: 401, headers: { 'content-type': 'application/json' } });",
  '};',
  '',
].join('\n'));
const nodePath = path.join(REPO, '.claude', 'scripts', 'node_modules');
function askGpt(env) {
  return spawnSync('node', ['--require', probe, path.join(cacheScripts, 'ask-gpt.js'), 'review', '--context-file', path.join(proj, 'in.md')], { cwd: proj, encoding: 'utf8', env: Object.assign({}, process.env, { HOME: home, USERPROFILE: home, NODE_PATH: nodePath }, env || {}), timeout: 20000 });
}
if (fs.existsSync(nodePath)) {
  delete process.env.OPENAI_API_KEY;
  let r = askGpt({ OPENAI_API_KEY: '' });
  let out = r.stdout + r.stderr;
  check('with no key anywhere the script reports the missing key', /OPENAI_API_KEY not found/.test(out), out.slice(0, 300));
  check('the missing-key message names all three places a key can live', out.includes('the environment') && out.includes("the project's .env.local") && out.includes('~/.claude/plugins/.env.local'), out.slice(0, 300));
  fs.writeFileSync(machineEnv, ['OPENAI_API_KEY', machineKey].join('=') + '\n');
  r = askGpt({ OPENAI_API_KEY: '' });
  out = r.stdout + r.stderr;
  check('a key at ~/.claude/plugins/.env.local is found from the cache', !/OPENAI_API_KEY not found/.test(out) && out.includes('PROBE-AUTH Bearer ' + machineKey + '\n'), out.slice(0, 300));
  fs.writeFileSync(projectEnv, ['OPENAI_API_KEY', projectKey].join('=') + '\n');
  r = askGpt({ OPENAI_API_KEY: '' });
  out = r.stdout + r.stderr;
  check("a project .env.local in the working directory is found from the cache and wins over the machine file", out.includes('PROBE-AUTH Bearer ' + projectKey + '\n') && !out.includes(machineKey), out.slice(0, 300));
  fs.rmSync(projectEnv);
  fs.rmSync(machineEnv);
} else {
  console.log('  skip key-walk checks: .claude/scripts/node_modules not installed');
}

// --- 7. Planted breakage in a copy of the live source ---------------------------
console.log('\n7. override and seed checks trip on a copy of the live source');
const cp = copyLiveSource();
const unresolvedOf = () => lib.build(cp.src, '9.9.9').unresolved;
check('the untouched copy builds with no unresolved reference', unresolvedOf().length === 0, unresolvedOf().join('; '));
// Swap one file's content for a while, then put it back, so each plant is judged alone.
function withPlant(rel, edit, fn) {
  const abs = path.join(cp.root, rel);
  const original = fs.readFileSync(abs, 'utf8');
  fs.writeFileSync(abs, edit(original));
  try { fn(); } finally { fs.writeFileSync(abs, original); }
}
const reviewSite = lib.SITE_OVERRIDES['commands/review.md'][0].phrase;
withPlant('.claude/commands/review.md', t => t.split(reviewSite).join('`.claude/prompts/` files changed'), () => {
  const u = unresolvedOf();
  check('a kept override phrase missing from its file is reported unresolved', u.some(x => x === 'commands/review.md: site override phrase not found: ' + reviewSite), u.join('; '));
  const r = runBuild(['--source', cp.src, '--out', path.join(cp.root, 'plugin-out')]);
  check('the CLI build prints the missing override as unresolved', /unresolved reference left as is: commands\/review\.md: site override phrase not found/.test(r.stderr), r.stderr);
  const c = runBuild(['--source', cp.src, '--out', path.join(cp.root, 'plugin-out'), '--check']);
  check('--check fails on the missing override phrase', c.status === 1 && /site override phrase not found/.test(c.stderr), c.stderr);
});
const depsSite = lib.SITE_OVERRIDES['skills/shared/criteria-deps.md'][0].phrase;
withPlant('.claude/skills/shared/criteria-deps.md', t => t.split(depsSite).join('`--prefix somewhere-else`'), () => {
  const u = unresolvedOf();
  check('a replace override phrase missing from its file is reported unresolved', u.some(x => x === 'skills/shared/criteria-deps.md: site override phrase not found: ' + depsSite), u.join('; '));
});
const indexAbs = path.join(cp.src, 'commands', 'index.md');
const indexText = fs.readFileSync(indexAbs, 'utf8');
fs.rmSync(indexAbs);
const uGone = unresolvedOf();
fs.writeFileSync(indexAbs, indexText);
check('an override keyed to a file the build no longer emits is reported', uGone.some(x => x === 'commands/index.md: site override names a file the build does not emit'), uGone.join('; '));
withPlant('seed/CLAUDE.md', t => t + '\nRun node .claude/scripts/render-html.js to render.\n', () => {
  const u = unresolvedOf();
  check('the seed check trips on a planted .claude/scripts/ line', u.some(x => x.startsWith('seed/CLAUDE.md: seed carries old-layout text ".claude/scripts/"')), u.join('; '));
});
withPlant('seed/gitignore', t => t + '\n# Toolkit state\n.claude/.toolkit-state.json\n', () => {
  const u = unresolvedOf();
  check('the seed check trips on a planted .claude/.toolkit-state.json ignore line', u.some(x => x === 'seed/gitignore: seed gitignore line ignores .claude/.toolkit-state.json: .claude/.toolkit-state.json'), u.join('; '));
});
withPlant('.claude/rules/toolkit.md', t => t + '\nRun `node .claude/scripts/render-html.js` for a page.\n', () => {
  const u = unresolvedOf();
  check('the seed check trips when the rules seed gains a rewritten plugin root path', u.some(x => x === 'seed/rules-toolkit.md: seed carries old-layout text "${CLAUDE_PLUGIN_ROOT}"'), u.join('; '));
});
check('the retired rows seed is exempt from the old-layout check', !unresolvedOf().some(x => x.startsWith('seed/retired-permission-rows.txt')) && read(REPO, 'seed/retired-permission-rows.txt').includes('.claude/scripts/'));
const cpInv = lib.inventory(cp.src);
const seedHits = (text, rel) => lib.seedProblems(rel || 'seed/CLAUDE.md', text, cpInv);
check('seedProblems: setup.sh is flagged', seedHits('Run setup.sh again.\n').some(p => p.includes('"setup.sh"')));
check('seedProblems: a bare command name is flagged, a scoped one and a path are not', seedHits('Use /review now.\n').some(p => p.endsWith('/review')) && seedHits('Use /tk:review, see skills/review-code/SKILL.md and html/index.jsonl.\n').length === 0, JSON.stringify(seedHits('Use /tk:review, see skills/review-code/SKILL.md and html/index.jsonl.\n')));
check('seedProblems: a bare family is flagged', seedHits('Try /review-* next.\n').some(p => p.endsWith('/review-*')));
check('seedProblems: a kept override phrase in the rules seed is not flagged', seedHits(lib.SITE_OVERRIDES['seed/rules-toolkit.md'][0].phrase + '\n', 'seed/rules-toolkit.md').length === 0);
const ign = (line) => lib.gitignoreLineMatches(line, '.claude/.toolkit-state.json');
check('gitignore matcher: lines that ignore the state file', ['.claude/.toolkit-state.json', '/.claude/.toolkit-state.json', '.toolkit-state.json', '.claude/', '.claude', '.claude/*', '.claude/.toolkit-*', '**/.toolkit-state.json', '*.json'].every(ign), ['.claude/.toolkit-state.json', '/.claude/.toolkit-state.json', '.toolkit-state.json', '.claude/', '.claude', '.claude/*', '.claude/.toolkit-*', '**/.toolkit-state.json', '*.json'].filter(l => !ign(l)).join(', '));
check('gitignore matcher: lines that do not', !['', '# .claude/.toolkit-state.json', '!.claude/.toolkit-state.json', '.claude/worktrees/', '.claude/settings.local.json', '.toolkit-backup-*/', '.toolkit-state.json/', 'src/.claude/', 'node_modules/'].some(ign), ['', '# .claude/.toolkit-state.json', '!.claude/.toolkit-state.json', '.claude/worktrees/', '.claude/settings.local.json', '.toolkit-backup-*/', '.toolkit-state.json/', 'src/.claude/', 'node_modules/'].filter(ign).join(', '));

// --- helpers -----------------------------------------------------------------
function walkFiles(dir, acc) {
  acc = acc || [];
  for (const n of fs.readdirSync(dir)) {
    const a = path.join(dir, n);
    if (fs.statSync(a).isDirectory()) walkFiles(a, acc); else acc.push(a);
  }
  return acc;
}
// The permission rows named in the first cell of each row of the Permissions table:
// every backticked span there, `\|` unescaped. Null when the section or table is absent.
function permissionTableRows(text) {
  const start = text.indexOf('\n## Permissions\n');
  if (start === -1) return null;
  const next = text.indexOf('\n## ', start + 1);
  const lines = text.slice(start, next === -1 ? text.length : next).split('\n');
  const head = lines.findIndex(l => /^\|\s*Permission\s*\|/.test(l));
  if (head === -1) return null;
  const rows = [];
  for (let i = head + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const cell = lines[i].split(/(?<!\\)\|/)[1] || '';
    for (const m of cell.matchAll(/`([^`]+)`/g)) rows.push(m[1].replace(/\\\|/g, '|'));
  }
  return rows;
}
// Rows each side has that the other lacks, counting duplicates (null table = all missing).
function rowDrift(tableRows, seedRows) {
  const left = [...(tableRows || [])];
  const missing = [];
  for (const r of seedRows) {
    const i = left.indexOf(r);
    if (i === -1) missing.push(r); else left.splice(i, 1);
  }
  return { missing, extra: left };
}
function writeTmp(content) {
  const f = path.join(os.tmpdir(), 'build-plugin-data-' + process.pid + '.json');
  fs.writeFileSync(f, content);
  return f;
}

for (const d of [fx.root, live, home, proj, cp.root]) fs.rmSync(d, { recursive: true, force: true });
console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach(f => console.log('  - ' + f));
console.log('');
process.exit(1);
