#!/usr/bin/env node
'use strict';
// build-plugin.js - emit the Claude Code plugin layout from the toolkit source.
//
//   node scripts/build-plugin.js [--source <dir>] [--out <dir>] [--version <v>]
//                                [--check] [--quiet]
//
// The toolkit's one source is .claude/ (commands, agents, skills, scripts).
// A Claude Code plugin is the same content in a different shape, fetched from
// this repository's marketplace instead of copied into a project, so this
// script is a maintainer-only generator (it lives beside bump-version.sh and
// never ships to a project). Its output, plugin/, is committed and never
// hand-edited; --check fails when plugin/ no longer matches the source.
//
// What it changes on the way through (issue #167, Step 4):
//   * Paths. A plugin lives at ${CLAUDE_PLUGIN_ROOT}, which Claude Code
//     substitutes anywhere in a plugin's markdown (verified: inline-cat lines,
//     frontmatter allowed-tools, hook commands). Every `.claude/<dir>/...`
//     reference for the four emitted dirs becomes `${CLAUDE_PLUGIN_ROOT}/<dir>/...`.
//     `.claude/rules/html-outputs.md` maps to its relocated shared fragment;
//     `.claude/rules/toolkit.md` is the project SEED and stays a project path.
//   * Names. A plugin's commands, skills, and agents resolve only under the
//     scoped form `<plugin>:<name>` (Step 1, spike 5: bare names hit project
//     files only, and the Skill tool says "invoke it by that full name"). So
//     `/review` becomes `/tk:review`, `Skill(review)` becomes `Skill(tk:review)`,
//     and `subagent_type=review-finder` becomes `subagent_type=tk:review-finder`.
//     Only names that exist in the source are rewritten; built-ins such as
//     `general-purpose` are untouched. A `skills:` list inside an agent stays
//     bare: preload resolves bare skill names within the plugin (spike 5).
//   * Permissions. A plugin cannot ship permission entries, but a command's
//     `allowed-tools` frontmatter pre-approves the scripts it runs while it is
//     active (spike 1). Each emitted command and skill gains one rule per
//     toolkit script it invokes, plus the host rows in HOST_ROWS.
//   * Packages. package.json and package-lock.json move from scripts/ to the
//     plugin root, where Claude Code installs them on plugin install and update.
//   * Allowlist. Only the four dirs above are read. node_modules, worktrees,
//     and every settings*.json are never emitted (61 MB, 65 MB, and a
//     never-push file respectively, measured 2026-09-12).
//   * Hooks. One SessionStart hook links ${CLAUDE_PLUGIN_DATA}/current to the
//     plugin root, giving downstream prose and permissions one path that
//     survives version bumps (spike 4).
//   * managed-paths.json. The repo-relative paths a copy-install manages, so
//     the plugin's setup script can migrate an install that predates the
//     manifest (issue #138 shipped the manifest in v5.5.0).
//
// Dependency-free by design, like every script under scripts/ and .claude/scripts/.

const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_NAME = 'tk';
const EMIT_DIRS = ['commands', 'agents', 'skills', 'scripts'];
const RUNTIME_SCRIPT_EXT = new Set(['.js', '.sh']);
const PACKAGE_FILES = ['package.json', 'package-lock.json'];
const NEVER_EMIT = /(^|\/)(node_modules|worktrees|settings(\.local)?\.json|\.toolkit-[^/]*)(\/|$)/;
// Host-CLI rows a command needs beyond its scripts (the seed still merges the
// git/gh/glab baseline into settings.local.json; these are the two commands
// whose first outward action is an issue create).
const HOST_ROWS = {
  'create-issue': ['Bash(gh issue create *)', 'Bash(glab issue create *)'],
  'upgrade': ['Bash(gh issue create *)', 'Bash(glab issue create *)'],
};
// Project-side paths that must NOT be rewritten: the seed writes them into the
// project, and settings never ship in a plugin.
const KEEP_PROJECT_PATHS = [
  '.claude/rules', '.claude/settings.json', '.claude/settings.local.json',
  '.claude/.toolkit-manifest.json', '.claude/.toolkit-state.json', '.claude/worktrees',
  '.claude/.no-correction-log',
];

function parseArgs(argv) {
  const o = { source: '', out: '', version: '', check: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') o.source = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--version') o.version = argv[++i];
    else if (a === '--check') o.check = true;
    else if (a === '--quiet') o.quiet = true;
    else { console.error('build-plugin: unknown argument ' + a); process.exit(2); }
  }
  return o;
}

function walk(dir, rel, out) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const r = rel ? rel + '/' + name : name;
    if (NEVER_EMIT.test(r)) continue;
    const st = fs.statSync(abs);
    if (st.isDirectory()) walk(abs, r, out);
    else out.push({ rel: r, abs });
  }
  return out;
}

function frontmatterName(text, fallback) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (m) { const n = /^name:\s*(.+)$/m.exec(m[1]); if (n) return n[1].trim(); }
  return fallback;
}

// Build the rewrite context from the source tree: which names are ours.
function inventory(src) {
  const commands = walk(path.join(src, 'commands'), '', []).filter(f => f.rel.endsWith('.md'))
    .map(f => ({ ...f, name: path.basename(f.rel, '.md') }));
  const agents = walk(path.join(src, 'agents'), '', []).filter(f => f.rel.endsWith('.md'))
    .map(f => ({ ...f, name: frontmatterName(fs.readFileSync(f.abs, 'utf8'), path.basename(f.rel, '.md')) }));
  const skillFiles = walk(path.join(src, 'skills'), '', []);
  const skillNames = new Set();
  for (const f of skillFiles) {
    const top = f.rel.split('/')[0];
    if (top !== 'shared' && f.rel === top + '/SKILL.md') {
      skillNames.add(frontmatterName(fs.readFileSync(f.abs, 'utf8'), top));
    }
  }
  const scripts = walk(path.join(src, 'scripts'), '', []).filter(f =>
    !f.rel.includes('/') && (RUNTIME_SCRIPT_EXT.has(path.extname(f.rel)) || PACKAGE_FILES.includes(f.rel)));
  return { commands, agents, skillFiles, skillNames: [...skillNames], scripts };
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// The path map: `.claude/<x>` -> `${CLAUDE_PLUGIN_ROOT}/<x>` for emitted dirs,
// with the one relocation the generator knows about. Returns null when the
// reference cannot be resolved inside the plugin (reported, not invented).
function mapPath(ref, src) {
  if (ref === '.claude/rules/html-outputs.md') {
    return fs.existsSync(path.join(src, 'skills', 'shared', 'html-outputs.md'))
      ? '${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md' : null;
  }
  // Project-side paths: the seed writes .claude/rules/toolkit.md and a project
  // may keep its own rules there; settings and state never ship in a plugin.
  for (const keep of KEEP_PROJECT_PATHS) if (ref === keep || ref.startsWith(keep + '/')) return ref;
  const m = /^\.claude\/(commands|agents|skills|scripts)(\/.*)?$/.exec(ref);
  if (m) return '${CLAUDE_PLUGIN_ROOT}/' + m[1] + (m[2] || '');
  return null;
}

function rewriteText(text, inv, src, unresolved, fileRel) {
  const longestFirst = (a, b) => b.length - a.length;
  const agentNames = inv.agents.map(a => a.name).sort(longestFirst);
  const slashNames = [...new Set([...inv.commands.map(c => c.name), ...inv.skillNames])].sort(longestFirst);

  // 1. Every `.claude/...` path token. A token runs until whitespace, a quote,
  //    a backtick, a closing paren/bracket, or a trailing sentence dot.
  text = text.replace(/\.claude\/[A-Za-z0-9_./*<>-]*[A-Za-z0-9_*>-]/g, (tok) => {
    const mapped = mapPath(tok, src);
    if (mapped === null) { unresolved.push(fileRel + ': ' + tok); return tok; }
    return mapped;
  });
  // 2. Dispatch names: subagent_type=name, subagent_type: name, quoted forms.
  if (agentNames.length) {
    const re = new RegExp('(subagent_type\\s*[=:]\\s*["\'`]?)(' + agentNames.map(escapeRe).join('|') + ')(?![\\w-])', 'g');
    text = text.replace(re, (m0, pre, name) => pre + PLUGIN_NAME + ':' + name);
  }
  // 3. Skill tool references: Skill(name) and Skill(name:...).
  if (slashNames.length) {
    const re = new RegExp('Skill\\((' + slashNames.map(escapeRe).join('|') + ')(?=[):])', 'g');
    text = text.replace(re, (m0, name) => 'Skill(' + PLUGIN_NAME + ':' + name);
    // 4. Slash references: /name not preceded by a path character and not
    //    followed by a name character (so /review-* and file paths survive).
    const re2 = new RegExp('(^|[^\\w./:\\-])/(' + slashNames.map(escapeRe).join('|') + ')(?![\\w-])', 'g');
    text = text.replace(re2, (m0, pre, name) => pre + '/' + PLUGIN_NAME + ':' + name);
  }
  return text;
}

// Permission rules a command or skill needs for the scripts it invokes. The
// calls mostly live in the shared fragments a file inlines (html-render-review.md
// carries the render call, hitl-loop.md the tripwire call), and an inlined
// fragment runs while the command is active, so the scan follows every
// inline-cat chain through the rewritten source before collecting rules.
function scriptRules(text, inv, src) {
  const seen = new Set();
  const rules = new Set();
  const scan = (t) => {
    for (const m of t.matchAll(/\b(node|bash) \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/([a-z0-9-]+\.(?:js|sh))/g)) {
      const call = m[1] + ' ${CLAUDE_PLUGIN_ROOT}/scripts/' + m[2];
      rules.add('Bash(' + call + ' *)');
      rules.add('Bash(' + call + ')');
      if (m[2] === 'browse.js') { rules.add('Bash(echo * | ' + call + ' *)'); rules.add('Bash(cat * | ' + call + ' *)'); }
    }
    for (const m of t.matchAll(/!`cat \$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)`/g)) {
      const rel = m[1];
      if (seen.has(rel)) continue;
      seen.add(rel);
      const abs = path.join(src, rel);
      if (fs.existsSync(abs)) scan(rewriteText(fs.readFileSync(abs, 'utf8'), inv, src, [], rel));
    }
  };
  scan(text);
  return [...rules].sort();
}

// Add rules to a markdown file's frontmatter, creating the block when absent.
function injectAllowedTools(text, rules, description) {
  if (!rules.length && !description) return text;
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const listLines = rules.map(r => '  - ' + JSON.stringify(r));
  if (!m) {
    const fm = ['---', 'description: ' + JSON.stringify(description || '')];
    if (rules.length) fm.push('allowed-tools:', ...listLines);
    fm.push('---', '');
    return fm.join('\n') + text;
  }
  if (!rules.length) return text;
  let block = m[1];
  const key = /^allowed-tools:(.*)$/m.exec(block);
  if (!key) {
    block = block + '\nallowed-tools:\n' + listLines.join('\n');
  } else if (key[1].trim() !== '') {
    // Inline scalar form: keep it and add the rules as a list on new lines.
    const inline = key[1].trim().split(/\s+/).filter(Boolean).map(s => '  - ' + JSON.stringify(s));
    block = block.replace(/^allowed-tools:.*$/m, 'allowed-tools:\n' + [...inline, ...listLines].join('\n'));
  } else {
    // List form: append after the last existing item.
    const lines = block.split('\n');
    const start = lines.findIndex(l => /^allowed-tools:\s*$/.test(l));
    let end = start + 1;
    while (end < lines.length && /^\s+-\s/.test(lines[end])) end++;
    lines.splice(end, 0, ...listLines);
    block = lines.join('\n');
  }
  return '---\n' + block + '\n---\n' + text.slice(m[0].length);
}

function firstHeading(text) {
  const m = /^#\s+(.+)$/m.exec(text);
  return m ? m[1].trim() : '';
}

function build(src, version) {
  const inv = inventory(src);
  const files = new Map(); // rel -> string | Buffer
  const unresolved = [];
  const put = (rel, content) => files.set(rel, content);

  for (const c of inv.commands) {
    let text = rewriteText(fs.readFileSync(c.abs, 'utf8'), inv, src, unresolved, 'commands/' + c.rel);
    const rules = [...new Set([...scriptRules(text, inv, src), ...(HOST_ROWS[c.name] || [])])].sort();
    text = injectAllowedTools(text, rules, firstHeading(text) || c.name);
    put('commands/' + c.rel, text);
  }
  for (const a of inv.agents) {
    put('agents/' + a.rel, rewriteText(fs.readFileSync(a.abs, 'utf8'), inv, src, unresolved, 'agents/' + a.rel));
  }
  for (const f of inv.skillFiles) {
    if (f.rel.endsWith('.md')) {
      let text = rewriteText(fs.readFileSync(f.abs, 'utf8'), inv, src, unresolved, 'skills/' + f.rel);
      if (/^[^/]+\/SKILL\.md$/.test(f.rel) && !f.rel.startsWith('shared/')) {
        const name = f.rel.split('/')[0];
        const rules = [...new Set([...scriptRules(text, inv, src), ...(HOST_ROWS[name] || [])])].sort();
        if (rules.length) text = injectAllowedTools(text, rules, '');
      }
      put('skills/' + f.rel, text);
    } else {
      put('skills/' + f.rel, fs.readFileSync(f.abs));
    }
  }
  for (const s of inv.scripts) {
    if (PACKAGE_FILES.includes(s.rel)) put(s.rel, fs.readFileSync(s.abs));
    else put('scripts/' + s.rel, fs.readFileSync(s.abs));
  }
  put('.claude-plugin/plugin.json', JSON.stringify({
    name: PLUGIN_NAME,
    description: 'LLM Peer Review toolkit: explore, plan, execute, review, document, with the review skills and their finder agents. Generated from the toolkit repository by scripts/build-plugin.js; never edit these files by hand.',
    version,
    author: { name: 'Mayank Mankhand' },
  }, null, 2) + '\n');
  put('hooks/hooks.json', JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [{
        type: 'command',
        // A failing link never blocks a session (Windows without symlink rights).
        command: 'mkdir -p "${CLAUDE_PLUGIN_DATA}" && ln -sfn "${CLAUDE_PLUGIN_ROOT}" "${CLAUDE_PLUGIN_DATA}/current" || true',
      }] }],
    },
  }, null, 2) + '\n');
  // Paths a copy-install manages (for migrating a manifest-less install).
  const managed = [
    ...inv.commands.map(c => '.claude/commands/' + c.rel),
    ...inv.agents.map(a => '.claude/agents/' + a.rel),
    ...inv.skillFiles.map(f => '.claude/skills/' + f.rel),
    ...inv.scripts.map(s => '.claude/scripts/' + s.rel),
    '.claude/rules/toolkit.md', '.claude/rules/html-outputs.md',
    '.env.local.example', '.gitattributes', 'VERSION', 'artifacts/README.md',
  ].sort();
  put('managed-paths.json', JSON.stringify({ version, paths: managed }, null, 2) + '\n');
  put('README.md', [
    '# tk (generated)',
    '',
    'This folder is the Claude Code plugin layout of the LLM Peer Review toolkit, emitted by',
    '`scripts/build-plugin.js` from the repository\'s `.claude/` source at version ' + version + '.',
    'Do not edit it by hand: change the source and rebuild. `node scripts/build-plugin.js --check`',
    'fails when this folder is stale.',
    '',
  ].join('\n'));
  return { files, unresolved };
}

function writeTree(outDir, files) {
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const [rel, content] of files) {
    const abs = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

function diffTree(outDir, files) {
  const diffs = [];
  const onDisk = new Map(walk(outDir, '', []).map(f => [f.rel, f.abs]));
  for (const [rel, content] of files) {
    const abs = onDisk.get(rel);
    if (!abs) { diffs.push('missing: ' + rel); continue; }
    const want = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    if (!fs.readFileSync(abs).equals(want)) diffs.push('differs: ' + rel);
    onDisk.delete(rel);
  }
  for (const rel of onDisk.keys()) diffs.push('stale: ' + rel);
  return diffs;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repo = path.resolve(__dirname, '..');
  const src = path.resolve(opts.source || path.join(repo, '.claude'));
  const out = path.resolve(opts.out || path.join(repo, 'plugin'));
  const versionFile = path.join(path.dirname(src), 'VERSION');
  const version = opts.version || (fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : '0.0.0');
  const { files, unresolved } = build(src, version);
  const log = (m) => { if (!opts.quiet) console.error(m); };

  if (opts.check) {
    const diffs = diffTree(out, files);
    for (const u of unresolved) console.error('build-plugin --check: unresolved reference ' + u);
    for (const d of diffs) console.error('build-plugin --check: ' + d);
    if (unresolved.length || diffs.length) {
      console.error('build-plugin --check: plugin/ is stale or has unresolved references (' + diffs.length + ' file diffs, ' + unresolved.length + ' references). Run: node scripts/build-plugin.js');
      process.exit(1);
    }
    log('build-plugin --check: ' + files.size + ' files match, version ' + version);
    return;
  }
  writeTree(out, files);
  for (const u of unresolved) log('build-plugin: unresolved reference left as is: ' + u);
  log('build-plugin: wrote ' + files.size + ' files to ' + path.relative(repo, out) + ' (version ' + version + ', ' + unresolved.length + ' unresolved)');
  console.log(out);
}

if (require.main === module) main();
module.exports = { build, rewriteText, injectAllowedTools, scriptRules, mapPath, inventory, PLUGIN_NAME };
