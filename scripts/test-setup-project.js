#!/usr/bin/env node
'use strict';
// test-setup-project.js - assertions for .claude/scripts/setup-project.js
// (issue #167, Step 5). Builds a fixture plugin root and fixture projects in
// temp dirs; never touches a real project. Dependency-free; exits non-zero on
// any failure.
//
//   node scripts/test-setup-project.js

const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '..', '.claude', 'scripts', 'setup-project.js');
let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failures.push(name + (detail ? ' - ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' - ' + String(detail).slice(0, 300) : '')); }
}
function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (root, rel) => fs.existsSync(path.join(root, rel));
const sha = (root, rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel)).toString('latin1').replace(/\r/g, ''), 'latin1').digest('hex');
function git(repo, args) { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
function initRepo(repo) {
  git(repo, ['init', '-q']); git(repo, ['config', 'user.email', 't@t']); git(repo, ['config', 'user.name', 't']); git(repo, ['config', 'commit.gpgsign', 'false']);
}
function commitAll(repo, msg) { git(repo, ['add', '-A']); git(repo, ['commit', '-qm', msg]); }
function run(project, pluginRoot, args) {
  const r = spawnSync('node', [SCRIPT, '--project', project, '--plugin-root', pluginRoot, ...(args || [])], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function treeSnapshot(root) {
  const acc = [];
  (function walk(d, rel) {
    for (const n of fs.readdirSync(d).sort()) {
      if (n === '.git') continue;
      const a = path.join(d, n); const r = rel ? rel + '/' + n : n;
      if (fs.statSync(a).isDirectory()) walk(a, r); else acc.push(r + ':' + sha(root, r));
    }
  })(root, '');
  return acc.join('\n');
}

// --- fixture plugin root ------------------------------------------------------
const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-plugin-'));
write(pluginRoot, '.claude-plugin/plugin.json', JSON.stringify({ name: 'tk', version: '7.0.0' }));
write(pluginRoot, 'seed/CLAUDE.md', '# Project Instructions for Claude\n');
write(pluginRoot, 'seed/LESSONS.md', '# Lessons (seed)\n');
write(pluginRoot, 'seed/LESSONS-detail.md', '# Lessons detail (seed)\n');
write(pluginRoot, 'seed/DESIGN-PROFILE.md', '# Design profile (seed)\n');
write(pluginRoot, 'seed/env.local.example', 'OPENAI_API_KEY=\n');
write(pluginRoot, 'seed/gitattributes', '*.sh text eol=lf\n');
write(pluginRoot, 'seed/gitignore', '# Dependencies\nnode_modules/\nplans/PLAN-*.md\nartifacts/html/\n');
write(pluginRoot, 'seed/artifacts-README.md', '# artifacts (seed)\n');
write(pluginRoot, 'seed/rules-toolkit.md', '# Toolkit Rules\n\n<!-- Toolkit version: 0.0.0 | Managed by LLM Peer Review. -->\n\nShort seed.\n');
write(pluginRoot, 'seed/settings.local.json', JSON.stringify({ permissions: { allow: ['Bash(git add *)', 'Bash(gh auth status *)', 'Bash(node .claude/scripts/render-html.js *)'], additionalDirectories: ['/tmp'] }, defaultMode: 'acceptEdits' }));
const MANAGED = ['.claude/commands/review.md', '.claude/commands/explore.md', '.claude/agents/review-finder.md', '.claude/skills/review-code/SKILL.md',
  '.claude/skills/shared/hitl-loop.md', '.claude/skills/shared/shells/review-shell.html', '.claude/scripts/render-html.js', '.claude/scripts/package.json',
  '.claude/rules/toolkit.md', '.claude/rules/html-outputs.md', '.env.local.example', '.gitattributes', 'VERSION', 'artifacts/README.md'];
write(pluginRoot, 'managed-paths.json', JSON.stringify({ version: '7.0.0', paths: MANAGED }));

// --- fixture: a copy-install with a manifest, custom files, and one local edit ---
function makeCopyInstall(withManifest) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-proj-'));
  initRepo(repo);
  for (const rel of MANAGED) write(repo, rel, 'toolkit content of ' + rel + '\n');
  write(repo, 'VERSION', '6.3.3\n');
  write(repo, '.claude/rules/toolkit.md', '# Toolkit Rules\n\n<!-- Toolkit version: 6.3.3 | Managed by LLM Peer Review. -->\n\nLong manual.\n');
  write(repo, '.claude/scripts/node_modules/openai/index.js', 'module.exports = 1;\n');
  write(repo, '.claude/commands/myteam-deploy.md', '# Deploy\n\nOurs.\n');
  write(repo, '.claude/agents/my-agent.md', '---\nname: my-agent\n---\nOurs.\n');
  write(repo, '.claude/skills/my-skill/SKILL.md', '---\nname: my-skill\n---\nOurs.\n');
  write(repo, '.claude/rules/bank-safety.md', '# Bank safety\n');
  write(repo, '.claude/scripts/my-tool.js', 'console.log("ours");\n');
  write(repo, 'LESSONS.md', '# Our lessons\n');
  write(repo, '.gitignore', 'mine/\n');
  write(repo, '.claude/settings.json', JSON.stringify({ env: { X: '1' } }, null, 2) + '\n');
  write(repo, '.claude/settings.local.json', JSON.stringify({ permissions: { allow: [
    'Bash(node .claude/scripts/ask-gpt.js *)', 'Bash(echo * | node /abs/proj/.claude/scripts/browse.js *)', 'Bash(git add *)', 'Bash(custom-thing *)', 'Skill(review-commands)'] }, defaultMode: 'acceptEdits' }, null, 2) + '\n');
  if (withManifest) {
    const files = {};
    for (const rel of MANAGED) files[rel] = sha(repo, rel);
    write(repo, '.claude/.toolkit-manifest.json', JSON.stringify({ toolkitVersion: '6.3.3', files }, null, 2) + '\n');
    // one local edit AFTER the manifest was recorded
    fs.appendFileSync(path.join(repo, '.claude/scripts/render-html.js'), '// my local fix\n');
  }
  commitAll(repo, 'copy-install state');
  return repo;
}

console.log('\n1. copy-install with a manifest');
let repo = makeCopyInstall(true);
const before = treeSnapshot(repo);
let r = run(repo, pluginRoot, ['--dry-run']);
check('dry run reports the migration and writes nothing', r.status === 3 && /migration from copy-install v6\.3\.3 \(manifest present\)/.test(r.out) && treeSnapshot(repo) === before, r.out);
r = run(repo, pluginRoot);
check('a locally modified toolkit file pages the run', r.status === 3 && /Locally modified toolkit files \(1\)/.test(r.out) && /\.claude\/scripts\/render-html\.js/.test(r.out), r.out);
check('a paged run writes nothing', treeSnapshot(repo) === before);
check('the page names the decision', /add --force/.test(r.out));
r = run(repo, pluginRoot, ['--force']);
check('--force completes the migration', r.status === 0 && /Done\./.test(r.out), r.out);
check('managed files are removed', MANAGED.every(rel => !exists(repo, rel) || ['.env.local.example', '.gitattributes', 'artifacts/README.md', '.claude/rules/toolkit.md'].includes(rel)));
check('manifest and VERSION are gone', !exists(repo, '.claude/.toolkit-manifest.json') && !exists(repo, 'VERSION'));
check('stale node_modules is gone', !exists(repo, '.claude/scripts/node_modules'));
check('custom files survive byte for byte', read(repo, '.claude/commands/myteam-deploy.md') === '# Deploy\n\nOurs.\n' && read(repo, '.claude/agents/my-agent.md').includes('Ours') && read(repo, '.claude/skills/my-skill/SKILL.md').includes('Ours') && read(repo, '.claude/rules/bank-safety.md') === '# Bank safety\n' && read(repo, '.claude/scripts/my-tool.js').includes('ours'));
check('the report lists the custom files as kept', /myteam-deploy\.md/.test(r.out) && /bank-safety\.md/.test(r.out));
check('the four root seed files are present after the sweep', exists(repo, '.env.local.example') && exists(repo, '.gitattributes') && exists(repo, 'artifacts/README.md') && exists(repo, '.claude/rules/toolkit.md'));
check('the seeded rules file is the short seed, stamped with the plugin version', read(repo, '.claude/rules/toolkit.md').includes('Short seed.') && read(repo, '.claude/rules/toolkit.md').includes('Toolkit version: 7.0.0 |'));
check('existing LESSONS.md is untouched and no detail file is seeded beside it', read(repo, 'LESSONS.md') === '# Our lessons\n' && !exists(repo, 'LESSONS-detail.md'));
check('CLAUDE.md and DESIGN-PROFILE.md are seeded when absent', read(repo, 'CLAUDE.md').includes('Project Instructions') && read(repo, 'DESIGN-PROFILE.md').includes('seed'));
const sj = JSON.parse(read(repo, '.claude/settings.json'));
check('settings.json keeps its keys and gains the marketplace and plugin', sj.env.X === '1' && sj.extraKnownMarketplaces['llm-peer-review'].source.repo === 'mayankmankhand/llm-peer-review' && sj.enabledPlugins['tk@llm-peer-review'] === true);
const sl = JSON.parse(read(repo, '.claude/settings.local.json'));
check('dead script permissions are removed', !sl.permissions.allow.some(p => /\.claude\/scripts\/|browse\.js|Skill\(review-commands/.test(p)));
check('custom and baseline permissions are kept, new baseline entries added', sl.permissions.allow.includes('Bash(custom-thing *)') && sl.permissions.allow.includes('Bash(git add *)') && sl.permissions.allow.includes('Bash(gh auth status *)') && sl.permissions.additionalDirectories.includes('/tmp'));
const gi = read(repo, '.gitignore');
check('.gitignore is line-merged', gi.startsWith('mine/') && gi.includes('node_modules/') && gi.includes('artifacts/html/') && gi.includes('.claude/settings.local.json'));
const st = JSON.parse(read(repo, '.claude/.toolkit-state.json'));
check('state file has the one schema', st.version === '7.0.0' && st.path === 'copy-migrated' && st.previousVersion === '6.3.3' && st.marketplace === 'llm-peer-review' && st.plugin === 'tk' && typeof st.at === 'string');
const mig = JSON.parse(read(repo, '.claude/.toolkit-migration.json'));
const backups = fs.readdirSync(repo).filter(n => n.startsWith('.toolkit-backup-') && n.endsWith('-plugin'));
check('one backup folder holds the removed files and the local edit', backups.length === 1 && exists(repo, backups[0] + '/.claude/scripts/render-html.js') && read(repo, backups[0] + '/.claude/scripts/render-html.js').includes('my local fix') && exists(repo, backups[0] + '/.claude/.toolkit-manifest.json') && exists(repo, backups[0] + '/.claude/settings.local.json'));
check('the migration record carries the local edit with its backup path', mig.modified.length === 1 && mig.modified[0].rel === '.claude/scripts/render-html.js' && mig.modified[0].backup === backups[0] + '/.claude/scripts/render-html.js' && mig.deadPermissions.length === 3 && mig.from === '6.3.3');
check('the report ends with the undo line and the next step', /Undo: git checkout/.test(r.out) && /Next: run \/tk:upgrade/.test(r.out) && /1 local edit/.test(r.out));
const after = treeSnapshot(repo);
r = run(repo, pluginRoot);
check('a second run is idempotent', r.status === 0 && /already on the plugin/.test(r.out) && /Nothing to migrate/.test(r.out) && treeSnapshot(repo) === after, r.out);
check('a second run makes no new backup', fs.readdirSync(repo).filter(n => n.startsWith('.toolkit-backup-')).length === 1);
fs.rmSync(repo, { recursive: true, force: true });

console.log('\n2. a dirty tree is refused');
repo = makeCopyInstall(true);
fs.appendFileSync(path.join(repo, 'LESSONS.md'), 'uncommitted\n');
r = run(repo, pluginRoot, ['--force']);
check('--force covers a dirty tree together with a local edit', r.status === 0, r.out);
fs.rmSync(repo, { recursive: true, force: true });
repo = makeCopyInstall(false);
fs.appendFileSync(path.join(repo, 'LESSONS.md'), 'uncommitted\n');
r = run(repo, pluginRoot);
check('a dirty tree pages without --force', r.status === 3 && /uncommitted changes/.test(r.out), r.out);
fs.rmSync(repo, { recursive: true, force: true });

console.log('\n3. copy-install without a manifest');
repo = makeCopyInstall(false);
r = run(repo, pluginRoot);
check('provenance unknown pages without --force', r.status === 3 && /NO manifest/.test(r.out) && /add --force to sweep/.test(r.out), r.out);
r = run(repo, pluginRoot, ['--force']);
check('--force sweeps the shipped managed paths', r.status === 0 && !exists(repo, '.claude/commands/review.md') && !exists(repo, '.claude/skills/shared/shells/review-shell.html') && exists(repo, '.claude/commands/myteam-deploy.md'), r.out);
check('state records the unknown-provenance migration with the old VERSION', JSON.parse(read(repo, '.claude/.toolkit-state.json')).previousVersion === '6.3.3');
fs.rmSync(repo, { recursive: true, force: true });

console.log('\n4. fresh project');
repo = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-fresh-'));
initRepo(repo);
write(repo, 'README.md', '# app\n');
commitAll(repo, 'init');
r = run(repo, pluginRoot);
check('a fresh install seeds and registers without a backup', r.status === 0 && /fresh install/.test(r.out) && !fs.readdirSync(repo).some(n => n.startsWith('.toolkit-backup-')), r.out);
check('the full seed lands, including the lessons detail file', ['CLAUDE.md', 'LESSONS.md', 'LESSONS-detail.md', 'DESIGN-PROFILE.md', '.env.local.example', '.gitattributes', 'artifacts/README.md', '.claude/rules/toolkit.md', '.gitignore', '.claude/settings.json', '.claude/settings.local.json', '.claude/.toolkit-state.json'].every(f => exists(repo, f)));
check('fresh state path is plugin', JSON.parse(read(repo, '.claude/.toolkit-state.json')).path === 'plugin');
check('plans and artifacts folders exist', fs.existsSync(path.join(repo, 'plans')) && fs.existsSync(path.join(repo, 'artifacts')));
check('a fresh settings.local.json carries no dead script entries', !JSON.parse(read(repo, '.claude/settings.local.json')).permissions.allow.some(p => /\.claude\/scripts\//.test(p)));
check('the report points at the first command', /Next: \/tk:explore/.test(r.out));
fs.rmSync(repo, { recursive: true, force: true });

console.log('\n5. a project that is not a git repository');
repo = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-nogit-'));
write(repo, 'README.md', '# app\n');
r = run(repo, pluginRoot);
check('a fresh non-repo project is seeded (nothing to undo)', r.status === 0 && exists(repo, '.claude/rules/toolkit.md'), r.out);
fs.rmSync(repo, { recursive: true, force: true });

fs.rmSync(pluginRoot, { recursive: true, force: true });
console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach(f => console.log('  - ' + f));
process.exit(1);
