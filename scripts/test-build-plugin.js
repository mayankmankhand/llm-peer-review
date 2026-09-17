#!/usr/bin/env node
'use strict';
// test-build-plugin.js - assertions for scripts/build-plugin.js (issue #167, Step 4;
// site overrides #176, quoted inline cats and the inline command guard #172,
// seeds #173, narrowed seed rows #180; the setup skill's project paths, the
// plugin-root install rules and the root helper hashes #180, the /document
// create rows #181, the review scope row #182, stamps that follow --version #183).
//
// Same shape as the other suites (test-render-html.js, test-pre-push-check.js):
// dependency-free, prints one line per check, exits non-zero on any failure.
// The rewrite rules are exercised against a small FIXTURE source tree built here;
// section 5 builds the live .claude/ into a temp dir (never into plugin/), and
// section 7 builds temp COPIES of the live source with planted breakage. A copy
// never carries a never-push file (settings*.json, .env*), and every temp path is
// removed on exit, a crash included.
//
//   node scripts/test-build-plugin.js
//
// Exit codes: 0 every check passed, 1 at least one check failed.

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BUILD = path.resolve(__dirname, 'build-plugin.js');
const REPO = path.resolve(__dirname, '..');
const lib = require(BUILD);

// Every temp path this suite creates, removed when the process exits for any
// reason (a failed check, a thrown error, Ctrl+C), so no copy is left behind.
const tempPaths = [];
function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempPaths.push(d);
  return d;
}
process.on('exit', () => {
  for (const p of tempPaths) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
});
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

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
// The emitted files that carry a toolkit version stamp (#183), written out here
// rather than read from the build script, so the checks judge the script.
const STAMPED = ['seed/rules-toolkit.md', 'skills/shared/html-outputs.md', 'skills/shared/toolkit-reference.md'];
const stampOf = (text) => (/<!-- Toolkit version: ([^ |]+) \|/.exec(text) || [])[1];
// The exact install rules the Browser QA skill needs in the plugin (#180).
const NPM_INSTALL_RULE = 'Bash(npm install --prefix "${CLAUDE_PLUGIN_ROOT}")';
const NPX_CHROMIUM_RULE = 'Bash(npx --prefix "${CLAUDE_PLUGIN_ROOT}" playwright-core install chromium)';
// The two create rows in host-cli.md, as a command's text names them, and the rows
// each needs on both hosts (#181).
const CREATE_ROWS = {
  '"Create issue" row': ['Bash(gh issue create *)', 'Bash(glab issue create *)'],
  '"Create PR / MR" row': ['Bash(gh pr create *)', 'Bash(glab mr create *)'],
};
// The root helper hash list (#180) and the sha256 setup-project.js compares with
// it: over the file with every carriage return removed.
const HASHES_REL = 'scripts/historical-helper-hashes.txt';
const shaNoCR = (buf) => crypto.createHash('sha256').update(Buffer.from(Buffer.from(buf).toString('latin1').replace(/\r/g, ''), 'latin1')).digest('hex');
const FIXTURE_HASH_A = shaNoCR('// an early copy of ask-gpt.js\n');
const FIXTURE_HASH_B = shaNoCR('// a later copy of ask-gpt.js\n');

// --- Fixture: a miniature toolkit source with every rewrite case planted ----
function makeFixture() {
  const root = tmpDir('build-plugin-');
  const src = path.join(root, '.claude');
  fs.writeFileSync(path.join(root, 'VERSION'), '9.9.9\n');
  write(src, 'commands/review.md', [
    '# Unified Review',
    '',
    'Use `/review` or `/review-code`; the family is `/review-*`. Then chain into `/document` through the Skill tool.',
    'Debates are the `/ask-*` family; an already scoped `/tk:review-*` stays single. Scratch pages are `/tmp/playground-*.html`, and skill files match `.claude/skills/review-*/SKILL.md`.',
    'Spawn a subagent with `subagent_type=review-finder` and a fallback `subagent_type=general-purpose`.',
    'Read `.claude/skills/project-context/SKILL.md` and `.claude/rules/toolkit.md`; settings live in `.claude/settings.local.json`.',
    'A project may keep its own instructions in `.claude/CLAUDE.md`.',
    'The old rules file was `.claude/rules/html-outputs.md`.',
    'Artifacts go to artifacts/html/review.html and reports/review-orchestrator-x.md.',
    '',
    '!`cat .claude/skills/shared/hitl-loop.md`',
    '',
    'Skill(review-code) is allowed.',
    '',
  ].join('\n'));
  write(src, 'commands/create-issue.md', '# Create Issue\n\nRun `gh issue create`.\n');
  write(src, 'commands/ask-gpt.md', '# Ask GPT\n\nA debate.\n\n!`cat .claude/skills/shared/temp-folder.md`\n');
  write(src, 'commands/document.md', '# Document\n\nRun `node .claude/scripts/correction-ledger.js --rollup` and open `bash .claude/scripts/open-artifact.sh x`.\n');
  write(src, 'agents/review-finder.md', '---\nname: review-finder\ndescription: finder for /review\ntools: Read\n---\n\nSee `.claude/skills/shared/model-routing.md`.\n');
  write(src, 'skills/review-code/SKILL.md', '---\nname: review-code\ndescription: code review\nallowed-tools:\n  - Read\n  - Bash\n---\n\n# Code Review\n\n!`cat .claude/skills/shared/html-render-review.md`\n');
  write(src, 'skills/review-browser/SKILL.md', '---\nname: review-browser\ndescription: browser qa\nallowed-tools: Read Bash\n---\n\nDrive `node .claude/scripts/browse.js` per `.claude/skills/shared/browse-api.md`.\n\n```bash\nnpm install --prefix .claude/scripts\nnpx --prefix .claude/scripts playwright-core install chromium\n```\n');
  write(src, 'skills/shared/hitl-loop.md', 'M11: run `node .claude/scripts/pre-push-check.js` before a push.\n\n!`cat .claude/rules/html-outputs.md`\n');
  write(src, 'skills/shared/html-render-review.md', 'Run `node .claude/scripts/render-html.js --shell review`.\n');
  write(src, 'skills/shared/html-outputs.md', '# HTML outputs\n\n<!-- Toolkit version: 9.9.9 | Managed by LLM Peer Review. -->\n\nRelocated HTML rules. Open with `bash .claude/scripts/open-artifact.sh`.\n');
  write(src, 'skills/shared/toolkit-reference.md', '# Toolkit reference\n\n<!-- Toolkit version: 9.9.9 | Managed by LLM Peer Review. -->\n\n');
  write(src, 'skills/shared/model-routing.md', 'roster\n');
  write(src, 'skills/shared/browse-api.md', 'api\n');
  write(src, 'skills/shared/temp-folder.md', 'Run `mktemp -d /tmp/fixture-render.XXXXXX` and write `data.json` inside it.\n');
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
  write(root, 'scripts/historical-managed-paths.txt', '# a comment line is ignored\n\n.claude/commands/review-code.md\n.claude/skills/shared/output-template.md\nscripts/ask-gpt.js\n');
  // Out of order, one hash twice, a comment and a blank line: the build emits each
  // root helper's hashes sorted, each once.
  write(root, HASHES_REL, '# copies of the root helper\n\nscripts/ask-gpt.js ' + FIXTURE_HASH_B + '\nscripts/ask-gpt.js ' + FIXTURE_HASH_A + '\nscripts/ask-gpt.js ' + FIXTURE_HASH_B + '\n');
  for (const emitted of Object.keys(lib.SITE_OVERRIDES)) {
    const abs = path.join(src, sourceRelOf(emitted));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.appendFileSync(abs, plantedLines(emitted));
  }
  return { root, src };
}

// A temp copy of the live source: .claude/ (without dependencies and worktrees),
// seed/, VERSION, and the historical list, so a planted break never touches the repo.
// Never-push files stay behind: .claude/settings*.json (the owner's permissions)
// and any .env* file. seed/settings.local.json is the committed seed template and
// is copied, since the build needs it.
function neverCopy(abs) {
  const rel = path.relative(REPO, abs).split(path.sep).join('/');
  return /(^|\/)(node_modules|worktrees)(\/|$)/.test(rel)
    || /(^|\/)\.env[^/]*$/.test(rel)
    || /^\.claude\/(.*\/)?settings[^/]*\.json$/.test(rel);
}
function copyLiveSource() {
  const root = tmpDir('build-plugin-copy-');
  fs.cpSync(path.join(REPO, '.claude'), path.join(root, '.claude'), { recursive: true, filter: (p) => !neverCopy(p) });
  fs.cpSync(path.join(REPO, 'seed'), path.join(root, 'seed'), { recursive: true, filter: (p) => !neverCopy(p) });
  fs.copyFileSync(path.join(REPO, 'VERSION'), path.join(root, 'VERSION'));
  write(root, 'scripts/historical-managed-paths.txt', read(REPO, 'scripts/historical-managed-paths.txt'));
  if (exists(REPO, HASHES_REL)) write(root, HASHES_REL, read(REPO, HASHES_REL));
  return { root, src: path.join(root, '.claude') };
}

// git in this repository, arguments as an array; stdout (text, or a Buffer when
// `raw`), or null when git fails.
function repoGit(args, raw) {
  const r = spawnSync('git', args, { cwd: REPO, encoding: raw ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}
// Whether this checkout carries its full git history (a shallow clone or an
// exported tree does not), which the recomputation of the helper hashes needs.
function fullHistory() {
  const shallow = repoGit(['rev-parse', '--is-shallow-repository']);
  return shallow !== null && shallow.trim() === 'false';
}
// Every copy of each root helper script in HEAD's history, as CR-stripped
// sha256 values, sorted and each once: the list scripts/historical-helper-hashes.txt
// must hold. --full-history keeps a copy that only a merged side branch carried.
// A commit that deleted the file holds no copy and is skipped.
function helperHashesFromHistory(rootHelpers) {
  const out = {};
  for (const rel of rootHelpers) {
    const log = repoGit(['log', '--full-history', '--format=%H', 'HEAD', '--', rel]);
    if (log === null) return null;
    const hashes = new Set();
    for (const commit of log.split('\n').filter(Boolean)) {
      const blob = repoGit(['cat-file', 'blob', commit + ':' + rel], true);
      if (blob !== null) hashes.add(shaNoCR(blob));
    }
    out[rel] = [...hashes].sort();
  }
  return out;
}
// The newest copy of `rel` in HEAD's history, as a Buffer, or null.
function newestHistoricalCopy(rel) {
  const log = repoGit(['log', '--full-history', '--format=%H', 'HEAD', '--', rel]);
  for (const commit of (log || '').split('\n').filter(Boolean)) {
    const blob = repoGit(['cat-file', 'blob', commit + ':' + rel], true);
    if (blob !== null) return blob;
  }
  return null;
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
check('no emitted fixture markdown keeps an unquoted inline cat', !fixtureCats.some(t => UNQUOTED_CAT.test(t) || lib.unquotedInlineRoots(t).length));
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
const MKTEMP_RULE = 'Bash(mktemp -d /tmp/*)';
const askGptFm = fm(read(out, 'commands/ask-gpt.md'));
check('a command inlining a fragment that runs mktemp -d /tmp/ gets the mktemp rule', askGptFm.includes('  - ' + JSON.stringify(MKTEMP_RULE)), askGptFm);
check('a command with no mktemp call anywhere in its chain gets no mktemp rule', !fm(review).includes(MKTEMP_RULE) && !fm(doc).includes(MKTEMP_RULE) && !fm(ci).includes(MKTEMP_RULE), fm(review) + fm(doc) + fm(ci));
check('scriptRules adds the mktemp rule for a direct call and not for other temp paths', lib.scriptRules('Run `mktemp -d /tmp/x.XXXXXX`.\n', fxInv, fx.src).includes(MKTEMP_RULE) && !lib.scriptRules('Write to `/tmp/x.json`; see `mktemp -d "$TMPDIR/x"`.\n', fxInv, fx.src).includes(MKTEMP_RULE));
// /document creates the worktree PR through host-cli.md's "Create PR / MR" row (#181).
check('host rows are added for document: the PR create row on GitHub and the MR create row on GitLab', fm(doc).includes('  - "Bash(gh pr create *)"') && fm(doc).includes('  - "Bash(glab mr create *)"'), fm(doc));
// Installs into the plugin root (#180): exact rules, quotes included, never a wildcard.
check('the Browser QA skill gets an exact rule for each install into the plugin root it shows', fm(rb).includes('  - ' + JSON.stringify(NPM_INSTALL_RULE)) && fm(rb).includes('  - ' + JSON.stringify(NPX_CHROMIUM_RULE)), fm(rb));
const installRules = (text) => lib.scriptRules(text, fxInv, fx.src).filter(x => x.includes('--prefix'));
let installGot = installRules('```bash\nnpm install --prefix "${CLAUDE_PLUGIN_ROOT}"\nnpx --prefix "${CLAUDE_PLUGIN_ROOT}" playwright-core install chromium\n```\n');
check('scriptRules: each whole install command in a code block gets its exact rule', JSON.stringify(installGot) === JSON.stringify([NPM_INSTALL_RULE, NPX_CHROMIUM_RULE].sort()), JSON.stringify(installGot));
installGot = installRules('Run `npm install --prefix "${CLAUDE_PLUGIN_ROOT}"` once.\n');
check('scriptRules: an install command in a backtick span gets its exact rule', JSON.stringify(installGot) === JSON.stringify([NPM_INSTALL_RULE]), JSON.stringify(installGot));
installGot = installRules('npm install --prefix "${CLAUDE_PLUGIN_ROOT}" left-pad\nnpx --prefix "${CLAUDE_PLUGIN_ROOT}" playwright-core install chromium --force\nnpx --prefix "${CLAUDE_PLUGIN_ROOT}" playwright-core\n');
check('scriptRules: a longer or shorter command (another package, another npx call) gets no install rule', installGot.length === 0, JSON.stringify(installGot));

// --- 2b. Inline commands: quoting and the guard (issue #172) ------------------
console.log('\n2b. inline command quoting and the unquoted-root guard');
const rw = (line) => lib.rewriteText(line + '\n', fxInv, fx.src, [], 'commands/probe.md');
const HITL = '${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md';
// A file named like a command (review of the v7.2.0 release, R2): `<folder>/review.html` is a file,
// while `/review.` ending a sentence is still the command.

const fileLike = rw('link `file://<folder>/review.html`, then run /review.');
check('a file named like a command keeps its name, and a command ending a sentence is still scoped', fileLike === 'link `file://<folder>/review.html`, then run /tk:review.\n', fileLike);
let got = rw('!`cat .claude/skills/shared/hitl-loop.md 2>/dev/null`');
check('an inline cat with an extra argument gets its path quoted', got === '!`cat "' + HITL + '" 2>/dev/null`\n', got);
got = rw('!`cat  .claude/skills/shared/hitl-loop.md`');
check('an inline cat with two spaces gets its path quoted', got === '!`cat  "' + HITL + '"`\n', got);
got = rw('!`cat .claude/skills/shared/hitl-loop.md .claude/skills/shared/browse-api.md`');
check('every plugin root path in one inline cat is quoted', got === '!`cat "' + HITL + '" "${CLAUDE_PLUGIN_ROOT}/skills/shared/browse-api.md"`\n', got);
got = rw('!`cat ".claude/skills/shared/hitl-loop.md"`');
check('an inline cat already quoted in the source is not quoted twice', got === '!`cat "' + HITL + '"`\n', got);
got = rw('!`cat .claude/skills/shared/*.md`');
check('a glob tail stays outside the quotes so it still expands', got === '!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/"*.md`\n', got);
got = rw('!`node .claude/scripts/render-html.js`');
check('an inline command other than cat is not quoted (the guard reports it instead)', got === '!`node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js`\n', got);
const ROOT = '${CLAUDE_PLUGIN_ROOT}';
got = lib.quoteInlineCats('!`cat ' + ROOT + '/a.md,' + ROOT + '/b.md`');
check('two roots in one token are quoted once, not written out twice', got === '!`cat "' + ROOT + '/a.md,' + ROOT + '/b.md"`' && !lib.unquotedInlineRoots(got).length, got);
got = lib.quoteInlineCats('!`cat {' + ROOT + '/a.md,' + ROOT + '/b.md}`');
check('two roots in one brace token are quoted once, not written out twice', got === '!`cat {"' + ROOT + '/a.md,' + ROOT + '/b.md}"`' && !lib.unquotedInlineRoots(got).length, got);
got = lib.quoteInlineCats('!`cat ' + ROOT + '/a.md; node ' + ROOT + '/scripts/x.js --help`');
check('a root after a shell operator is not quoted (it belongs to another command) and the guard reports it', got === '!`cat "' + ROOT + '/a.md"; node ' + ROOT + '/scripts/x.js --help`' && lib.unquotedInlineRoots(got).length === 1, got);
got = lib.quoteInlineCats('!`cat ' + ROOT + '/a.md 2>/dev/null`');
check('a cat argument before a redirect is still quoted', got === '!`cat "' + ROOT + '/a.md" 2>/dev/null`' && !lib.unquotedInlineRoots(got).length, got);
got = lib.quoteInlineCats('!`cat ' + ROOT + '/a*.md,' + ROOT + '/b.md`');
check('a root left bare after a glob in the same token is caught by the guard, not shipped silently', lib.unquotedInlineRoots(got).length === 1 && got.split(ROOT).length === 3, got);
const guardHits = lib.unquotedInlineRoots([
  '!`node ${CLAUDE_PLUGIN_ROOT}/scripts/x.js`',
  '!`cat  ${CLAUDE_PLUGIN_ROOT}/a.md 2>/dev/null`',
  '!`cat "${CLAUDE_PLUGIN_ROOT}/b.md" 2>/dev/null`',
  "!`cat '${CLAUDE_PLUGIN_ROOT}/c.md'`",
  'Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/x.js` by hand.',
  '',
].join('\n'));
check('the guard names each inline command with an unquoted root, and nothing quoted or outside an inline command', JSON.stringify(guardHits) === JSON.stringify(['node ${CLAUDE_PLUGIN_ROOT}/scripts/x.js', 'cat  ${CLAUDE_PLUGIN_ROOT}/a.md 2>/dev/null']), JSON.stringify(guardHits));
const viaArg = lib.scriptRules('!`cat "' + HITL + '" 2>/dev/null`\n', fxInv, fx.src);
const viaSpaces = lib.scriptRules('!`cat  ' + HITL + '`\n', fxInv, fx.src);
check('scriptRules follows an inline cat with an extra argument or two spaces', JSON.stringify(viaArg) === JSON.stringify(viaQuoted) && JSON.stringify(viaSpaces) === JSON.stringify(viaQuoted), viaArg.join(', ') + ' | ' + viaSpaces.join(', '));

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
check('managed-paths carries historicalHelperHashes beside version and paths: each root helper\'s hashes from the committed list, sorted, each once (#180)',
  JSON.stringify(Object.keys(managed)) === JSON.stringify(['version', 'paths', 'historicalHelperHashes'])
  && JSON.stringify(managed.historicalHelperHashes) === JSON.stringify({ 'scripts/ask-gpt.js': [FIXTURE_HASH_A, FIXTURE_HASH_B].sort() }), JSON.stringify(managed.historicalHelperHashes));
check('a project\'s own .claude/CLAUDE.md stays a project path: kept as written, never mapped to the plugin root (#179)', lib.mapPath('.claude/CLAUDE.md', fx.src) === '.claude/CLAUDE.md'
  && review.includes('instructions in `.claude/CLAUDE.md`.') && !review.includes('${CLAUDE_PLUGIN_ROOT}/CLAUDE.md'), String(lib.mapPath('.claude/CLAUDE.md', fx.src)));
// Stamps (#183): the build's version lands in every stamped file of the output and
// nowhere in the source.
check('a build at the VERSION file\'s version keeps each stamp at that version', STAMPED.every(rel => stampOf(read(out, rel)) === '9.9.9'), STAMPED.map(rel => rel + ': ' + stampOf(read(out, rel))).join(', '));
const fxStamped = path.join(fx.root, 'plugin-stamped');
const fxStampedRun = runBuild(['--source', fx.src, '--out', fxStamped, '--version', '1.2.3', '--quiet']);
check('--version 1.2.3 stamps all three stamped files 1.2.3, as plugin.json says, with the rest of each file unchanged', fxStampedRun.status === 0
  && JSON.parse(read(fxStamped, '.claude-plugin/plugin.json')).version === '1.2.3'
  && STAMPED.every(rel => exists(fxStamped, rel) && stampOf(read(fxStamped, rel)) === '1.2.3' && read(fxStamped, rel) === read(out, rel).replace('<!-- Toolkit version: 9.9.9 |', '<!-- Toolkit version: 1.2.3 |')),
  fxStampedRun.stderr + STAMPED.map(rel => rel + ': ' + (exists(fxStamped, rel) ? stampOf(read(fxStamped, rel)) : 'missing')).join(', '));
check('--version leaves the source stamps alone', stampOf(read(fx.src, 'rules/toolkit.md')) === '9.9.9' && stampOf(read(fx.src, 'skills/shared/html-outputs.md')) === '9.9.9' && stampOf(read(fx.src, 'skills/shared/toolkit-reference.md')) === '9.9.9');
for (const [label, args] of [['a v-prefixed version', ['--version', 'v7.2.0']], ['a version with a stamp separator', ['--version', '7.2.0 | x']], ['no version after the flag', ['--version']]]) {
  const badOut = path.join(fx.root, 'plugin-bad-version');
  const r = runBuild(['--source', fx.src, '--out', badOut, ...args]);
  check('--version with ' + label + ' exits 2, names the problem, and writes nothing', r.status === 2 && /--version needs a version such as 7\.2\.0/.test(r.stderr) && !exists(badOut, '.'), 'exit ' + r.status + ' ' + r.stderr);
}
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
const live = tmpDir('build-plugin-live-');
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
const liveGuard = walkFiles(live).filter(f => f.endsWith('.md')).flatMap(f => lib.unquotedInlineRoots(fs.readFileSync(f, 'utf8')).map(c => path.relative(live, f) + ': ' + c));
check('live: no emitted markdown holds an unquoted plugin root in any inline command', liveGuard.length === 0, liveGuard.join('; '));
const liveBareFamily = liveMd.filter(f => BARE_FAMILY.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(live, f));
check('live: no emitted markdown names a bare /review-* or /ask-* family', liveBareFamily.length === 0, liveBareFamily.join(', '));
// Issues #185 and #188: a command's allowed-tools grant ends at the user's next
// message and a stage started through the Skill tool gets none, so the seed
// carries every script rule the emitted commands and skills grant, in the two
// spellings a session types: the versioned cache path ${CLAUDE_PLUGIN_ROOT}
// expands to (any home, any version) and the stable data path.
const liveSeedAllow = new Set(JSON.parse(read(live, 'seed/settings.local.json')).permissions.allow);
const liveScriptRules = [...new Set(walkFiles(live).filter(f => f.endsWith('.md'))
  .flatMap(f => fs.readFileSync(f, 'utf8').match(/"Bash\((?:(?:echo|cat) \* \| )?(?:node|bash) \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/[a-z0-9-]+\.(?:js|sh)(?: \*)?\)"/g) || [])
  .map(x => JSON.parse(x)))];
const liveSeedGaps = liveScriptRules.flatMap(r => ['<tk-plugin-cache>/*', '~/.claude/plugins/data/tk-llm-peer-review/current']
  .map(root => r.split('${CLAUDE_PLUGIN_ROOT}').join(root)).filter(row => !liveSeedAllow.has(row)));
check('live: the seed allows every script rule a command or skill grants, in the cache-placeholder and the stable path spelling (#185, #188)', liveScriptRules.length >= 20 && liveSeedGaps.length === 0, liveSeedGaps.join('; '));
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
// The seed rows grant only what the toolkit runs (issue #180): `git config` is
// the host-detection read alone, `npm install` is the plain install alone (a
// worktree row with a wildcard would also allow added package names), the /index grep rows are gone, and every gh or glab host
// command host-cli.md tells Claude to run has its row, on both hosts.
const liveRetired = read(live, 'seed/retired-permission-rows.txt').split(/\r?\n/).filter(l => l && !l.startsWith('#'));
const NARROWED_ROWS = ['Bash(git config --get remote.origin.url)', 'Bash(npm install)'];
const DROPPED_ROWS = ['Bash(git config *)', 'Bash(grep -q "^# Codebase Map$" CODEBASE_MAP.md.tmp)', 'Bash(grep -q "^## Module Guide$" CODEBASE_MAP.md.tmp)'];
check('live: the seed carries the narrowed git config and npm install rows', NARROWED_ROWS.every(x => seedAllowRows.includes(x)), NARROWED_ROWS.filter(x => !seedAllowRows.includes(x)).join(', '));
const broadSeedRows = seedAllowRows.filter(x => /^Bash\(git config(:\*| \*)\)$/.test(x) || /^Bash\(npm (install|i|ci)(:\*| \*)\)$/.test(x) || x.includes('CODEBASE_MAP.md.tmp'));
check('live: the seed carries no broad git config or npm install row and no /index grep row', broadSeedRows.length === 0, broadSeedRows.join(', '));
check('live: every row the seed dropped is on the retired list, and no seed row is', DROPPED_ROWS.every(x => liveRetired.includes(x)) && !seedAllowRows.some(x => liveRetired.includes(x)),
  DROPPED_ROWS.filter(x => !liveRetired.includes(x)).concat(seedAllowRows.filter(x => liveRetired.includes(x))).join(', '));
check('live: Bash(npm install *) is not on the retired list, so upgrade never removes it from a project that adds packages (issue #198)', !liveRetired.includes('Bash(npm install *)'));
const hostCommands = [...new Set([...read(REPO, '.claude/skills/shared/host-cli.md').matchAll(/`((?:gh|glab) (?:issue|pr|mr) [a-z]+)[^`]*`/g)].map(m => m[1]))];
check('live: every gh and glab issue, PR and MR command in host-cli.md has its seed row', hostCommands.includes('glab mr list') && hostCommands.includes('gh issue create') && hostCommands.every(c => seedAllowRows.includes('Bash(' + c + ' *)')),
  hostCommands.filter(c => !seedAllowRows.includes('Bash(' + c + ' *)')).join(', ') + ' of ' + hostCommands.join(', '));
// Claude Code matches `Bash(x:*)` exactly as `Bash(x *)`, so two such rows are one rule written twice.
const spellingKey = (row) => row.replace(/^(Bash|PowerShell)\(([\s\S]*):\*\)$/, '$1($2 *)');
check('live: no two seed rows are the same rule in two spellings', new Set(seedAllowRows.map(spellingKey)).size === seedAllowRows.length);
const permissionsSection = refText.slice(refText.indexOf('\n## Permissions\n'), refText.indexOf('\n## ', refText.indexOf('\n## Permissions\n') + 1));
check('live: the Permissions section no longer claims a safe.directory use or a broad git config row', refText.includes('\n## Permissions\n') && !permissionsSection.includes('safe.directory') && !permissionsSection.includes('`Bash(git config *)`'), permissionsSection.slice(0, 200));

// Every live command whose emitted text or inlined chain runs `mktemp -d /tmp/` carries
// the rule (host-cli.md reaches create-issue through its inline cat), and the rule is
// never added to a command whose chain has no such call.
const liveMktemp = { with: [], without: [] };
const liveInv = lib.inventory(path.join(REPO, '.claude'));
for (const f of fs.readdirSync(path.join(live, 'commands')).filter(n => n.endsWith('.md'))) {
  const t = read(live, 'commands/' + f);
  // The body only: the frontmatter already names the rule and would match itself.
  const body = t.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const calls = lib.scriptRules(body, liveInv, path.join(REPO, '.claude')).includes('Bash(mktemp -d /tmp/*)');
  const has = fm(t).includes('Bash(mktemp -d /tmp/*)');
  (has ? liveMktemp.with : liveMktemp.without).push(f);
  if (calls !== has) liveMktemp.mismatch = (liveMktemp.mismatch || []).concat(f);
}
check('live: create-issue and document carry the mktemp rule', liveMktemp.with.includes('create-issue.md') && liveMktemp.with.includes('document.md'), JSON.stringify(liveMktemp));
check('live: the mktemp rule matches each command\'s own chain, and some commands go without it', !liveMktemp.mismatch && liveMktemp.without.length > 0, JSON.stringify(liveMktemp));

// The setup skill names the PROJECT's old copy-install file .claude/commands/review.md
// twice (#180): both mentions ship as written, and the plugin's own review.md is never named.
const liveSetup = read(live, 'skills/setup/SKILL.md');
check('live: the setup skill still says `.claude/commands/review.md` at both places, and never names the plugin\'s review.md',
  liveSetup.includes('`VERSION` beside `.claude/commands/review.md`') && liveSetup.includes('`.claude/commands/review.md` sits beside it')
  && !liveSetup.includes('${CLAUDE_PLUGIN_ROOT}/commands/review.md'), (liveSetup.match(/.{40}commands\/review\.md.{20}/g) || []).join(' | '));
// The Browser QA install (#180): an exact rule for each install line the skill shows,
// each rule's command as written in the skill, and no wildcard install into the plugin anywhere.
const liveBrowser = read(live, 'skills/review-browser/SKILL.md');
const liveBrowserBody = liveBrowser.replace(/^---\n[\s\S]*?\n---\n?/, '');
check('live: the Browser QA skill allows exactly its two installs into the plugin root, each rule the command its text shows',
  [NPM_INSTALL_RULE, NPX_CHROMIUM_RULE].every(rule => fm(liveBrowser).includes('  - ' + JSON.stringify(rule)) && liveBrowserBody.includes('\n' + rule.slice('Bash('.length, -1) + '\n')), fm(liveBrowser));
const wildInstalls = walkFiles(live).filter(f => f.endsWith('.md')).flatMap(f => (fm(fs.readFileSync(f, 'utf8')).match(/^ {2}- "Bash\((?:npm|npx) [^\n]*\*[^\n]*\)"$/gm) || []).map(l => path.relative(live, f) + ': ' + l.trim()));
check('live: no emitted command or skill pre-approves an npm or npx command with a wildcard', wildInstalls.length === 0, wildInstalls.join('; '));
// Host create rows (#181): each command or skill whose text runs a host-cli.md create
// row carries both hosts' rows for it, and no other command carries host rows.
const hostRowProblems = [];
const liveEntries = fs.readdirSync(path.join(live, 'commands')).filter(n => n.endsWith('.md')).map(n => ['commands/' + n, path.basename(n, '.md')])
  .concat(fs.readdirSync(path.join(live, 'skills')).filter(d => d !== 'shared' && exists(live, 'skills/' + d + '/SKILL.md')).map(d => ['skills/' + d + '/SKILL.md', d]));
for (const [rel, name] of liveEntries) {
  const t = read(live, rel);
  const body = t.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const wanted = Object.keys(CREATE_ROWS).filter(k => body.includes(k)).flatMap(k => CREATE_ROWS[k]);
  const lacking = wanted.filter(row => !fm(t).includes('  - ' + JSON.stringify(row)));
  if (lacking.length) hostRowProblems.push(rel + ' runs a create row but lacks ' + lacking.join(', '));
  if ((lib.HOST_ROWS || {})[name] && !wanted.length) hostRowProblems.push(rel + ' has host rows but runs no create row');
}
const liveDocFm = fm(read(live, 'commands/document.md'));
check('live: /document carries the PR and MR create rows', liveDocFm.includes('  - "Bash(gh pr create *)"') && liveDocFm.includes('  - "Bash(glab mr create *)"'), liveDocFm);
check('live: every command or skill that runs a host-cli.md create row carries both hosts\' rows for it, and no other carries host rows', hostRowProblems.length === 0 && liveEntries.length > 20, hostRowProblems.join('; '));
check('live: every host row is a seed row too, so the seed and the commands grant the same create calls', Object.keys(lib.HOST_ROWS || {}).length > 0 && Object.values(lib.HOST_ROWS).flat().every(row => seedAllowRows.includes(row)), JSON.stringify(lib.HOST_ROWS));
// The review scope (#182): review.md runs `session-init.js --scope`, so it must allow the call.
check('live: commands/review.md allows node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js *', fm(read(live, 'commands/review.md')).includes('  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js *)"'), fm(read(live, 'commands/review.md')));
// The update steps (#183): the shipped index.md and toolkit-reference.md name every
// command of the update message the built scripts print, so the prose and the notice agree.
const liveSteps = require(path.join(live, 'scripts', 'session-start.js')).PLUGIN_UPDATE_STEPS;
// index.md's edge case names the user-scope pair; the reference also names the project-scope form.
const stepCommands = [...String(liveSteps).matchAll(/`(claude [^`]+)`/g)].map(m => m[1]);
for (const [rel, wanted] of [['commands/index.md', stepCommands.filter(c => !c.includes('--scope'))], ['skills/shared/toolkit-reference.md', stepCommands]]) {
  const missingSteps = wanted.filter(c => !read(live, rel).includes(c));
  check('live: ' + rel + ' carries the update commands the scripts print', stepCommands.length === 3 && wanted.length > 1 && missingSteps.length === 0, stepCommands.length + ' commands; missing: ' + missingSteps.join('; '));
}
// Default-mode grants (#181): the debate commands allow their session call, and /index allows --finalize.
for (const [rel, script] of [['commands/ask-gpt.md', 'ask-gpt.js'], ['commands/ask-gemini.md', 'ask-gemini.js'], ['commands/index.md', 'generate-index.js']]) {
  const row = '  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/' + script + ' *)"';
  const call = 'scripts/' + script + (rel === 'commands/index.md' ? ' --finalize' : ' session');
  check('live: ' + rel + ' runs ' + call + ' and allows it', fm(read(live, rel)).includes(row) && read(live, rel).includes(call), fm(read(live, rel)));
}
// Stamps (#183): a scratch build made with --version is stamped with it in exactly the
// three stamped files, and no emitted file keeps a stamp naming another version.
const liveStamped = tmpDir('build-plugin-stamped-');
const liveStampedRun = runBuild(['--out', liveStamped, '--version', '9.9.9', '--quiet']);
const stampCarriers = walkFiles(liveStamped).filter(f => fs.readFileSync(f, 'utf8').includes('Toolkit version: 9.9.9')).map(f => path.relative(liveStamped, f).split(path.sep).join('/')).sort();
const otherStamps = walkFiles(liveStamped).flatMap(f => [...fs.readFileSync(f, 'utf8').matchAll(/<!-- Toolkit version: (\d[^ |]*) \|/g)].filter(m => m[1] !== '9.9.9').map(m => path.relative(liveStamped, f) + ': ' + m[1]));
check('live: --version 9.9.9 stamps exactly the three stamped files, and plugin.json agrees', liveStampedRun.status === 0 && JSON.stringify(stampCarriers) === JSON.stringify(STAMPED)
  && JSON.parse(read(liveStamped, '.claude-plugin/plugin.json')).version === '9.9.9', stampCarriers.join(', ') + ' ' + liveStampedRun.stderr);
check('live: no file in that build keeps a stamp naming another version', liveStampedRun.status === 0 && otherStamps.length === 0, otherStamps.join('; '));

// Root helper hashes (#180): the emitted field lists every root helper script of the
// managed list, each with sorted lowercase sha256 values held once.
const liveManaged = JSON.parse(read(live, 'managed-paths.json'));
const liveRootHelpers = liveManaged.paths.filter(rel => /^scripts\/[^/]+$/.test(rel));
const liveHelperHashes = liveManaged.historicalHelperHashes || null;
check('live: managed-paths.json carries historicalHelperHashes for exactly its root helper scripts, each list sorted, lowercase sha256, once each',
  liveHelperHashes !== null && liveRootHelpers.length === 5 && JSON.stringify(Object.keys(liveHelperHashes).sort()) === JSON.stringify(liveRootHelpers.slice().sort())
  && Object.values(liveHelperHashes).every(list => Array.isArray(list) && list.length > 0 && list.every(h => /^[0-9a-f]{64}$/.test(h)) && JSON.stringify(list) === JSON.stringify([...new Set(list)].sort())),
  JSON.stringify(liveHelperHashes));
if (fullHistory()) {
  const fromHistory = helperHashesFromHistory(liveRootHelpers);
  const expectedLines = fromHistory === null ? '' : Object.keys(fromHistory).sort().flatMap(rel => fromHistory[rel].map(h => rel + ' ' + h)).join('\n');
  check('live: the emitted hashes are exactly the copies recomputed from git history (the committed list is current)',
    fromHistory !== null && liveHelperHashes !== null && JSON.stringify(fromHistory) === JSON.stringify(Object.fromEntries(Object.keys(liveHelperHashes).sort().map(rel => [rel, liveHelperHashes[rel]]))),
    'expected ' + HASHES_REL + ' data lines:\n' + expectedLines);
  const browseCopy = newestHistoricalCopy('scripts/browse.js');
  const crlfCopy = browseCopy === null ? null : Buffer.from(browseCopy.toString('latin1').replace(/\r?\n/g, '\r\n'), 'latin1');
  check('live: a real historical copy of scripts/browse.js, and its CRLF form, hash to a listed value', browseCopy !== null && liveHelperHashes !== null
    && (liveHelperHashes['scripts/browse.js'] || []).includes(shaNoCR(browseCopy)) && (liveHelperHashes['scripts/browse.js'] || []).includes(shaNoCR(crlfCopy)) && !crlfCopy.equals(browseCopy),
    browseCopy === null ? 'no copy in history' : shaNoCR(browseCopy));
  // End to end: the built setup script reads the built list. A copy-install with no
  // manifest (VERSION beside .claude/commands/review.md) whose root scripts/ holds that
  // historical browse.js in CRLF form and an ask-gpt.js of its own: a dry run lists the
  // first for removal and keeps the second, writing nothing.
  const proj = tmpDir('build-plugin-migrate-');
  spawnSync('git', ['init', '-q'], { cwd: proj });
  write(proj, '.claude/commands/review.md', '# review\n');
  write(proj, 'VERSION', '4.2.0\n');
  if (crlfCopy !== null) write(proj, 'scripts/browse.js', crlfCopy);
  write(proj, 'scripts/ask-gpt.js', '// our own ask-gpt helper\n');
  const dry = spawnSync('node', [path.join(live, 'scripts', 'setup-project.js'), '--project', proj, '--dry-run'], { encoding: 'utf8' });
  const dryOut = (dry.stdout || '') + (dry.stderr || '');
  check('live: the built setup script sweeps the historical browse.js and keeps the project\'s own ask-gpt.js (dry run, nothing written)',
    /Among them, helper scripts an early installer copied to the root scripts\/ folder, each matching a copy the toolkit shipped \(every other file there is yours, untouched\): scripts\/browse\.js\n/.test(dryOut)
    && /Kept as your own: scripts\/ask-gpt\.js in the root scripts\/ folder carries the name of a helper script/.test(dryOut)
    && exists(proj, 'scripts/browse.js') && read(proj, 'scripts/ask-gpt.js') === '// our own ask-gpt helper\n' && !exists(proj, '.claude/.toolkit-state.json'), dryOut);
} else {
  console.log('  skip history checks for the helper hashes: this checkout has no full git history');
}

// --- 6. The key lookup from a plugin cache layout (issue #177) ------------------
console.log('\n6. key lookup from the plugin cache');
const home = tmpDir('build-plugin-home-');
const cacheRoot = path.join(home, '.claude', 'plugins', 'cache', 'llm-peer-review', 'tk', '9.9.9');
const cacheScripts = path.join(cacheRoot, 'scripts');
fs.mkdirSync(cacheScripts, { recursive: true });
// ask-gpt.js requires env-local.js from its own folder, so the cache holds both, as a
// real plugin install does.
for (const f of ['ask-gpt.js', 'env-local.js']) fs.copyFileSync(path.join(REPO, '.claude', 'scripts', f), path.join(cacheScripts, f));
fs.mkdirSync(path.join(cacheRoot, 'skills', 'shared'), { recursive: true });
for (const f of ['finding-contract.md', 'report-format.md']) fs.copyFileSync(path.join(REPO, '.claude', 'skills', 'shared', f), path.join(cacheRoot, 'skills', 'shared', f));
const proj = tmpDir('build-plugin-proj-');
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
const copiedNeverPush = walkFiles(cp.root).map(f => path.relative(cp.root, f).split(path.sep).join('/'))
  .filter(r => /^\.claude\/(.*\/)?settings[^/]*\.json$/.test(r) || /(^|\/)\.env[^/]*$/.test(r) || /(^|\/)(node_modules|worktrees)\//.test(r));
check('the copy carries no .claude settings*.json, .env* file, node_modules or worktrees', copiedNeverPush.length === 0 && exists(cp.root, 'seed/settings.local.json'), copiedNeverPush.join(', '));
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
// Inline command quoting on the live copy (issue #172): the forms the old
// single-space rewrite missed ship quoted, and the guard catches what no rewrite
// quotes.
withPlant('.claude/commands/review.md', t => t + '\n!`cat .claude/skills/shared/hitl-loop.md 2>/dev/null`\n\n!`cat  .claude/skills/shared/host-cli.md`\n', () => {
  const built = lib.build(cp.src, '9.9.9');
  const text = String(built.files.get('commands/review.md'));
  check('live copy: a planted inline cat with an extra argument ships with its path quoted', text.includes('!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md" 2>/dev/null`'), text.slice(-300));
  check('live copy: a planted inline cat with two spaces ships with its path quoted', text.includes('!`cat  "${CLAUDE_PLUGIN_ROOT}/skills/shared/host-cli.md"`'), text.slice(-300));
  check('live copy: the planted cat forms leave no unresolved reference', built.unresolved.length === 0, built.unresolved.join('; '));
});
withPlant('.claude/commands/review.md', t => t + '\n!`head -n 5 .claude/skills/shared/hitl-loop.md`\n', () => {
  const u = unresolvedOf();
  check('the guard reports an unquoted plugin root left in a planted inline command', u.includes('commands/review.md: unquoted ${CLAUDE_PLUGIN_ROOT} in inline command !`head -n 5 ${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`'), u.join('; '));
  const c = runBuild(['--source', cp.src, '--out', path.join(cp.root, 'plugin-out'), '--check']);
  check('--check fails on the planted unquoted inline command', c.status === 1 && /unresolved reference commands\/review\.md: unquoted \$\{CLAUDE_PLUGIN_ROOT\} in inline command/.test(c.stderr), c.stderr);
});
// conventions.md is copied byte for byte, so no rewrite can quote a cat planted there.
withPlant('.claude/skills/shared/conventions.md', t => t + '\n!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`\n', () => {
  const u = unresolvedOf();
  check('the guard reports a planted unquoted inline cat in a file the build copies raw', u.includes('skills/shared/conventions.md: unquoted ${CLAUDE_PLUGIN_ROOT} in inline command !`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`'), u.join('; '));
});
// The root helper hash list (#180): a helper left with no hash, a line naming a path
// that is no root helper, and a line of the wrong shape are each reported.
check('the copy carries the committed root helper hash list', exists(cp.root, HASHES_REL));
if (exists(cp.root, HASHES_REL)) {
  withPlant(HASHES_REL, t => t.split('\n').filter(l => !l.startsWith('scripts/browse.js ')).join('\n'), () => {
    const u = unresolvedOf();
    check('a root helper script with no hash left in the list is reported unresolved', u.includes('managed-paths.json: no historical hash for the root helper script scripts/browse.js in scripts/historical-helper-hashes.txt'), u.join('; '));
  });
  withPlant(HASHES_REL, t => t + 'scripts/our-tool.js ' + 'a'.repeat(64) + '\n', () => {
    const u = unresolvedOf();
    check('a hash line naming a path that is no root helper script is reported unresolved', u.some(x => /^scripts\/historical-helper-hashes\.txt line \d+: scripts\/our-tool\.js is not a root helper script in managed-paths\.json$/.test(x)), u.join('; '));
  });
  withPlant(HASHES_REL, t => t + 'scripts/browse.js ' + 'A'.repeat(64) + '\n', () => {
    const u = unresolvedOf();
    check('a hash line that is not a path and a lowercase sha256 is reported unresolved', u.some(x => /^scripts\/historical-helper-hashes\.txt line \d+: not "<path> <sha256 in lowercase hex>"/.test(x)), u.join('; '));
  });
}
// Stamps (#183): a stamped file that lost its stamp cannot follow the version, so it is reported.
withPlant('.claude/skills/shared/html-outputs.md', t => t.replace(/<!-- Toolkit version: [^|]+\|[^\n]*\n/, ''), () => {
  const u = unresolvedOf();
  check('a stamped file with no toolkit version stamp is reported unresolved', u.includes('skills/shared/html-outputs.md: no "<!-- Toolkit version: X |" stamp to set to 9.9.9'), u.join('; '));
});
// The setup skill's kept phrases (#180) are watched like every override: a reworded one is reported.
withPlant('.claude/skills/setup/SKILL.md', t => t.split('`.claude/commands/review.md` sits beside it').join('`.claude/commands/review.md` is next to it'), () => {
  const u = unresolvedOf();
  check('a reworded setup skill phrase the build keeps is reported unresolved', u.includes('skills/setup/SKILL.md: site override phrase not found: `.claude/commands/review.md` sits beside it'), u.join('; '));
});
// The hook guard: a source without the hook's script is reported, never shipped.
const hookAbs = path.join(cp.src, 'scripts', 'session-start.js');
const hookText = fs.readFileSync(hookAbs);
fs.rmSync(hookAbs);
let uHook;
try { uHook = unresolvedOf(); } finally { fs.writeFileSync(hookAbs, hookText); }
check('a source without scripts/session-start.js is reported unresolved for the hook', uHook.includes('hooks/hooks.json: missing source scripts/session-start.js'), uHook.join('; '));
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
  const f = path.join(tmpDir('build-plugin-data-'), 'data.json');
  fs.writeFileSync(f, content);
  return f;
}

// Temp paths are removed by the exit handler registered at the top.
console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach(f => console.log('  - ' + f));
console.log('');
process.exit(1);
