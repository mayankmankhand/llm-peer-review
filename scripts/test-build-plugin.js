#!/usr/bin/env node
'use strict';
// test-build-plugin.js - assertions for scripts/build-plugin.js (issue #167, Step 4).
//
// Same shape as the other suites (test-render-html.js, test-pre-push-check.js):
// dependency-free, prints one line per check, exits non-zero on any failure.
// The generator is exercised against a small FIXTURE source tree built here,
// never against the live .claude/ (whose relocations land in Step 3 and whose
// committed output is produced in Step 7), so the suite is green on its own.
//
//   node scripts/test-build-plugin.js

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

// --- Fixture: a miniature toolkit source with every rewrite case planted ----
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-plugin-'));
  const src = path.join(root, '.claude');
  fs.writeFileSync(path.join(root, 'VERSION'), '9.9.9\n');
  write(src, 'commands/review.md', [
    '# Unified Review',
    '',
    'Use `/review` or `/review-code`; the family is `/review-*`. Then chain into `/document` through the Skill tool.',
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
  write(src, 'scripts/package.json', '{ "name": "fixture", "dependencies": {} }\n');
  write(src, 'scripts/package-lock.json', '{ "lockfileVersion": 3 }\n');
  write(src, 'scripts/node_modules/left-pad/index.js', 'module.exports = 1;\n');
  write(src, 'settings.local.json', '{ "permissions": { "allow": ["Bash(rm -rf /)"] } }\n');
  write(src, 'settings.json', '{}\n');
  write(src, 'worktrees/worktree-1/.claude/commands/review.md', '# stale copy\n');
  write(src, 'rules/toolkit.md', '<!-- Toolkit version: 9.9.9 | seed -->\n');
  write(src, 'skills/shared/design-profile-template.md', '# Design profile\n');
  write(root, 'CLAUDE.md', '# Project Instructions\n');
  write(root, 'LESSONS.md', '# Lessons\n');
  write(root, 'LESSONS-detail.md', '# Lessons detail\n');
  write(root, '.env.local.example', 'OPENAI_API_KEY=\n');
  write(root, '.gitattributes', '*.sh text eol=lf\n');
  write(root, '.gitignore', 'node_modules/\nplans/PLAN-*.md\n');
  write(root, 'artifacts/README.md', '# artifacts\n');
  return { root, src };
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
check('the /review-* family is left alone', review.includes('`/review-*`'));
check('chained stage is scoped', review.includes('`/tk:document`'));
check('subagent_type of a toolkit agent is scoped', review.includes('subagent_type=tk:review-finder'));
check('built-in agent is untouched', review.includes('subagent_type=general-purpose'));
check('Skill() reference is scoped', review.includes('Skill(tk:review-code)'));
check('skill path is rewritten to the plugin root', review.includes('${CLAUDE_PLUGIN_ROOT}/skills/project-context/SKILL.md'));
check('seed rules path stays a project path', review.includes('`.claude/rules/toolkit.md`'));
check('settings path stays a project path', review.includes('`.claude/settings.local.json`'));
check('relocated html rules map to the shared fragment', review.includes('${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md'));
check('inline-cat is rewritten', review.includes('!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`'));
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
check('SessionStart hook links the data folder to the plugin root', JSON.stringify(hooks).includes('${CLAUDE_PLUGIN_DATA}/current') && JSON.stringify(hooks).includes('|| true'));
const managed = JSON.parse(read(out, 'managed-paths.json'));
check('managed-paths lists copy-install paths', managed.paths.includes('.claude/commands/review.md') && managed.paths.includes('.claude/rules/toolkit.md') && managed.paths.includes('.env.local.example') && managed.paths.includes('.claude/scripts/package.json'));
check('managed-paths never lists node_modules or settings', !managed.paths.some(p => /node_modules|settings/.test(p)));
check('the seed carries every project file the installer seeds', ['seed/CLAUDE.md', 'seed/LESSONS.md', 'seed/LESSONS-detail.md', 'seed/DESIGN-PROFILE.md', 'seed/env.local.example', 'seed/gitattributes', 'seed/gitignore', 'seed/artifacts-README.md', 'seed/rules-toolkit.md', 'seed/settings.local.json'].every(r => exists(out, r)));
check('the seed rules file is the source rules file, byte for byte', read(out, 'seed/rules-toolkit.md') === read(fx.src, 'rules/toolkit.md'));
check('the seed permission baseline is the source settings.local.json', read(out, 'seed/settings.local.json') === read(fx.src, 'settings.local.json'));
const stray = [];
for (const f of walkFiles(out)) {
  if (!/\.md$/.test(f)) continue;
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/\.claude\/(commands|agents|skills|scripts)\//g)) stray.push(path.relative(out, f) + ': ' + m[0]);
}
check('no emitted markdown keeps a .claude/{commands,agents,skills,scripts}/ path', stray.length === 0, stray.join(', '));

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
runBuild(['--source', fx.src, '--out', out, '--quiet']);
const c3 = runBuild(['--source', fx.src, '--out', out, '--check', '--quiet']);
check('--check fails on an unresolvable html-outputs reference when the fragment is absent', c3.status === 1 && /unresolved reference .*html-outputs\.md/.test(c3.stderr), c3.stderr);
check('a project rules path other than html-outputs is kept, not reported', !/nope\.md/.test(c3.stderr), c3.stderr);

// --- 5. The real source ------------------------------------------------------
console.log('\n5. the live source builds');
const live = fs.mkdtempSync(path.join(os.tmpdir(), 'build-plugin-live-'));
const l = runBuild(['--out', live, '--quiet']);
check('live .claude/ builds without error', l.status === 0, l.stderr);
check('live build emits every command', fs.readdirSync(path.join(REPO, '.claude', 'commands')).every(f => exists(live, 'commands/' + f)));
check('live build emits every agent', fs.readdirSync(path.join(REPO, '.claude', 'agents')).every(f => exists(live, 'agents/' + f)));
check('live build emits all seven shells', fs.readdirSync(path.join(live, 'skills', 'shared', 'shells')).filter(f => f.endsWith('-shell.html')).length === 7);
const render = spawnSync('node', [path.join(live, 'scripts', 'render-html.js'), '--shell', 'review', '--name', 'probe', '--out-dir', path.join(live, 'artifacts'), '--stable', '--no-abs', '--data', writeTmp('{"title":"probe","findings":[]}')], { cwd: live, encoding: 'utf8' });
check('render-html.js finds its shells from the emitted layout', render.status === 0 && exists(live, 'artifacts/probe.html'), render.stderr);

// --- 6. The key walk from a plugin cache layout ---------------------------------
console.log('\n6. key lookup from the plugin cache');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'build-plugin-home-'));
const cacheScripts = path.join(home, '.claude', 'plugins', 'cache', 'llm-peer-review', 'tk', '9.9.9', 'scripts');
fs.mkdirSync(cacheScripts, { recursive: true });
fs.copyFileSync(path.join(REPO, '.claude', 'scripts', 'ask-gpt.js'), path.join(cacheScripts, 'ask-gpt.js'));
fs.mkdirSync(path.join(home, '.claude', 'plugins', 'cache', 'llm-peer-review', 'tk', '9.9.9', 'skills', 'shared'), { recursive: true });
for (const f of ['finding-contract.md', 'report-format.md']) fs.copyFileSync(path.join(REPO, '.claude', 'skills', 'shared', f), path.join(home, '.claude', 'plugins', 'cache', 'llm-peer-review', 'tk', '9.9.9', 'skills', 'shared', f));
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'build-plugin-proj-'));
fs.writeFileSync(path.join(proj, 'in.md'), 'x\n');
const nodePath = path.join(REPO, '.claude', 'scripts', 'node_modules');
function askGpt(env) {
  return spawnSync('node', [path.join(cacheScripts, 'ask-gpt.js'), 'review', '--context-file', path.join(proj, 'in.md')], { cwd: proj, encoding: 'utf8', env: Object.assign({}, process.env, { HOME: home, NODE_PATH: nodePath }, env || {}), timeout: 20000 });
}
if (fs.existsSync(nodePath)) {
  delete process.env.OPENAI_API_KEY;
  let r = askGpt({ OPENAI_API_KEY: '' });
  check('with no key anywhere the script reports the missing key', /OPENAI_API_KEY not found/.test(r.stdout + r.stderr), (r.stdout + r.stderr).slice(0, 200));
  fs.writeFileSync(path.join(home, '.claude', 'plugins', '.env.local'), 'OPENAI_API_KEY=sk-test-plugins-level\n');
  r = askGpt({ OPENAI_API_KEY: '' });
  check('a key at ~/.claude/plugins/.env.local is found from the cache', !/OPENAI_API_KEY not found/.test(r.stdout + r.stderr), (r.stdout + r.stderr).slice(0, 200));
  fs.rmSync(path.join(home, '.claude', 'plugins', '.env.local'));
} else {
  console.log('  skip key-walk checks: .claude/scripts/node_modules not installed');
}

// --- helpers -----------------------------------------------------------------
function walkFiles(dir, acc) {
  acc = acc || [];
  for (const n of fs.readdirSync(dir)) {
    const a = path.join(dir, n);
    if (fs.statSync(a).isDirectory()) walkFiles(a, acc); else acc.push(a);
  }
  return acc;
}
function writeTmp(content) {
  const f = path.join(os.tmpdir(), 'build-plugin-data-' + process.pid + '.json');
  fs.writeFileSync(f, content);
  return f;
}

for (const d of [fx.root, live, home, proj]) fs.rmSync(d, { recursive: true, force: true });
console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach(f => console.log('  - ' + f));
console.log('');
process.exit(1);
