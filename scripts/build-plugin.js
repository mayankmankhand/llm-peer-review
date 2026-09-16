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
// What it changes on the way through (issue #167, Step 4; #172, #173, #176):
//   * Paths. A plugin lives at ${CLAUDE_PLUGIN_ROOT}, which Claude Code
//     substitutes anywhere in a plugin's markdown (verified: inline-cat lines,
//     frontmatter allowed-tools, hook commands). Every `.claude/<dir>/...`
//     reference for the four emitted dirs becomes `${CLAUDE_PLUGIN_ROOT}/<dir>/...`.
//     `.claude/rules/html-outputs.md` maps to its relocated shared fragment;
//     `.claude/rules/toolkit.md` is the project SEED and stays a project path;
//     its own text gets command names scoped, nothing else.
//   * Site overrides (#176). Some `.claude/<dir>/` mentions mean the PROJECT's
//     own files (a project's commands, an old copy-install), not the toolkit's.
//     This repository runs its own .claude/ prompts, so the source carries no
//     markers; SITE_OVERRIDES names each such phrase per emitted file, to keep
//     as written or to replace, and a phrase the source no longer contains is
//     reported as unresolved so an edit cannot silently drop an override.
//   * Inline cats (#172). Every `${CLAUDE_PLUGIN_ROOT}/...` path token in an
//     inline `` !`cat ...` `` is emitted in double quotes, whatever the spacing
//     and whatever other arguments sit beside it (`2>/dev/null`, a second path):
//     under a plugin root whose path holds a space the unquoted form inlines
//     nothing (verified on Claude Code 2.1.270). As a guard, an emitted markdown
//     file that still holds an unquoted ${CLAUDE_PLUGIN_ROOT} inside ANY inline
//     command is reported as unresolved, so a new inline form cannot ship broken.
//     `node|bash ${CLAUDE_PLUGIN_ROOT}/scripts/...` calls in prose stay unquoted,
//     because the allowed-tools rules generated for them match that exact text.
//   * Names. A plugin's commands, skills, and agents resolve only under the
//     scoped form `<plugin>:<name>` (Step 1, spike 5: bare names hit project
//     files only, and the Skill tool says "invoke it by that full name"). So
//     `/review` becomes `/tk:review`, `Skill(review)` becomes `Skill(tk:review)`,
//     and `subagent_type=review-finder` becomes `subagent_type=tk:review-finder`.
//     Family mentions follow: `/review-*` becomes `/tk:review-*` and `/ask-*`
//     becomes `/tk:ask-*` (any `/<prefix>-*` whose prefix starts a real name).
//     Only names that exist in the source are rewritten; built-ins such as
//     `general-purpose` are untouched. A `skills:` list inside an agent stays
//     bare: preload resolves bare skill names within the plugin (spike 5).
//   * Permissions. A plugin cannot ship permission entries, but a command's
//     `allowed-tools` frontmatter pre-approves the scripts it runs while it is
//     active (spike 1). Each emitted command and skill gains one rule per
//     toolkit script it invokes, `Bash(mktemp -d /tmp/*)` when it creates a
//     per-run temp folder, an exact rule per install into the plugin root it
//     shows (PLUGIN_ROOT_INSTALLS, #180), plus the host rows in HOST_ROWS.
//   * Packages. package.json and package-lock.json move from scripts/ to the
//     plugin root, where Claude Code installs them on plugin install and update.
//   * Allowlist. Only the four dirs above are read. node_modules, worktrees,
//     and every settings*.json are never emitted (61 MB, 65 MB, and a
//     never-push file respectively, measured 2026-09-12).
//   * Hooks. One SessionStart hook runs `node "${CLAUDE_PLUGIN_ROOT}/scripts/
//     session-start.js"`, which links ${CLAUDE_PLUGIN_DATA}/current to the
//     plugin root (one path for downstream prose and permissions that survives
//     version bumps, spike 4) and runs the version guard (#174). A node call
//     parses in every shell the hook may run under, PowerShell included, where
//     the old `mkdir -p ... && ln -sfn ...` did not; the script always exits 0.
//   * managed-paths.json. The repo-relative paths a copy-install manages, so
//     the plugin's setup script can migrate an install that predates the
//     manifest (issue #138 shipped the manifest in v5.5.0), and the content
//     hashes of every root helper script copy the toolkit shipped (#180), so
//     that migration sweeps only the toolkit's own copies.
//   * Seeds (#173). The project seed comes from the repository's seed/ folder
//     (plus the rewritten .claude/rules/toolkit.md), and every emitted seed file
//     is checked for old-layout text before it can ship.
//   * Stamps (#183). The three files carrying a `<!-- Toolkit version: X |`
//     stamp are emitted stamped with the build's version, so a scratch build
//     made with --version carries that version everywhere plugin.json does.
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
// Host-CLI rows for the commands that run one of the two create rows in
// host-cli.md, both hosts' form of each (#181): "Create issue" (/create-issue,
// and the cycle issue /upgrade opens) and "Create PR / MR" (/document's
// worktree PR). The seed merges the same gh and glab rows into
// settings.local.json; carried here as well, the create call runs without an
// approval stop in a project whose settings lack the row.
const HOST_ROWS = {
  'create-issue': ['Bash(gh issue create *)', 'Bash(glab issue create *)'],
  'document': ['Bash(gh pr create *)', 'Bash(glab mr create *)'],
  'upgrade': ['Bash(gh issue create *)', 'Bash(glab issue create *)'],
};
// Installs into the plugin root (#180). The Browser QA skill has Claude install
// the plugin's own packages and Chromium with `--prefix "${CLAUDE_PLUGIN_ROOT}"`,
// a machine path no seed row can name, so a file whose text shows one of these
// commands whole gets a rule for exactly that command, quotes included. Never a
// wildcard: one would pre-approve installing any package into the plugin, and
// installing any other package asks once (owner decision, #180).
const PLUGIN_ROOT_INSTALLS = [
  'npm install --prefix "${CLAUDE_PLUGIN_ROOT}"',
  'npx --prefix "${CLAUDE_PLUGIN_ROOT}" playwright-core install chromium',
];
// The rule for a per-run temp folder. The same row is in seed/settings.local.json;
// a command or skill whose text or inlined chain runs `mktemp -d /tmp/...` also
// carries it, so the call works in a project that never ran /tk:setup.
const MKTEMP_RULE = 'Bash(mktemp -d /tmp/*)';
// Project-side paths that must NOT be rewritten: the seed writes them into the
// project, settings never ship in a plugin, and a project's own
// .claude/CLAUDE.md (project instructions Claude Code also reads from there,
// which /tk:upgrade's C-11 audits, #179) has no plugin copy to point at.
const KEEP_PROJECT_PATHS = [
  '.claude/rules', '.claude/settings.json', '.claude/settings.local.json',
  '.claude/.toolkit-manifest.json', '.claude/.toolkit-state.json', '.claude/.toolkit-migration.json',
  '.claude/worktrees', '.claude/.no-correction-log', '.claude/CLAUDE.md',
];
// The session hook's script. The build reports it as unresolved when the source
// has no such script, so the hook can never point at a missing file.
const SESSION_START_SCRIPT = 'session-start.js';
// The stamped files (#183), by emitted path: the three files
// scripts/setup/bump-version.sh stamps in the source. Each emitted copy gets the
// build's version in its stamp, by the replacement bump-version.sh makes (the
// first `<!-- Toolkit version: X |`), so a build made with --version 7.2.0 from
// a 7.1.0 source is stamped 7.2.0, and a build at the VERSION file's version
// changes nothing, since a release bump stamps the source alike. A stamped file
// the build does not emit, or one with no stamp, is reported unresolved.
const STAMPED_FILES = ['seed/rules-toolkit.md', 'skills/shared/html-outputs.md', 'skills/shared/toolkit-reference.md'];
const TOOLKIT_STAMP = /<!-- Toolkit version: [^|]+\|/;
// What --version accepts: the version shape the scripts' version helpers accept
// (dotted numbers, an optional -suffix), so a typo such as v7.2.0 cannot become
// a plugin.json version the version guard ignores or a stamp it cannot read.
const VERSION_ARG = /^\d+(\.\d+){0,3}(-[0-9A-Za-z.]+)?$/;
// The committed list of root helper script hashes (#180): every copy of each
// root helper script (the scripts/ paths in historical-managed-paths.txt) that
// the toolkit ever shipped, as `<path> <sha256>` lines, each sha256 taken over
// the file with every carriage return removed, the way setup-project.js hashes
// the project's copy. The build emits it as managed-paths.json's
// historicalHelperHashes, and a manifest-less migration sweeps a root helper
// only when its content matches one. It is data, not a git history read at
// build time, so --check gives the same answer in a shallow clone and in the
// commit tree the pre-push check exports; scripts/test-build-plugin.js
// recomputes it from the history when the history is there.
const HELPER_HASHES_FILE = 'historical-helper-hashes.txt';
const ROOT_HELPER = /^scripts\/[^/]+$/;

// Per-site overrides for `.claude/<dir>/` mentions that mean a PROJECT path
// (issue #176). Keyed by EMITTED file (`commands/review.md`, `seed/rules-toolkit.md`).
// Each entry holds an exact phrase as it appears in the source, and either
// `keep: true` (the phrase is protected from the path rewrite and ships as
// written; command names inside it are still scoped) or `replace` (the phrase is
// swapped for that text before any rewrite). A phrase missing from its file is
// pushed to `unresolved`, so a later source edit that drops or rewords a site
// fails --check instead of silently shipping a wrong path. Every phrase is
// matched everywhere it occurs in that file, so each one carries enough context
// to name only its site.
const SITE_OVERRIDES = {
  'commands/review.md': [
    // Routing row: a project's own commands and skills changed, so /tk:review dispatches the commands finder for them.
    { phrase: '`.claude/commands/` or `.claude/skills/` files changed', keep: true },
  ],
  'commands/index.md': [
    // Example navigation bullet for the mapped project's own extension point.
    { phrase: 'To add a new slash command: edit .claude/commands/<name>.md', keep: true },
  ],
  'commands/worktree.md': [
    // Copy-install detection: the file sits inside the new worktree, not in the plugin.
    { phrase: '(a `.claude/scripts/package.json` exists in the worktree)', keep: true },
    // The same detection, in the summary line's skip reason.
    { phrase: 'skipped - no .claude/scripts/package.json)', keep: true },
  ],
  'skills/project-context/SKILL.md': [
    // An example of the reviewed project's file structure conventions.
    { phrase: 'commands in `.claude/commands/`, skills in `.claude/skills/`', keep: true },
  ],
  'skills/review-commands/SKILL.md': [
    // What the commands review covers: the project's own prompt files (skill description).
    { phrase: 'Use for reviewing .claude/commands/*.md or .claude/skills/*/SKILL.md files.', keep: true },
    // The same scope in the "Use this when" line.
    { phrase: 'Reviewing slash command prompts (.claude/commands/*.md)', keep: true },
  ],
  'skills/shared/html-outputs.md': [
    // Prompt files that stay markdown: a project's own commands and skills.
    { phrase: '- `.claude/commands/*.md`, `.claude/skills/*/SKILL.md` (prompt files)', keep: true },
  ],
  'skills/shared/model-routing.md': [
    // Line "The pin lives in agent frontmatter under .claude/agents/" means the shipped agents and is rewritten.
    // A file written mid-session is a project's own agent file; the plugin's agents are never written mid-session.
    { phrase: 'a file written to `.claude/agents/` mid-session', keep: true },
    // An older copy-install's own agents folder.
    { phrase: 'an older copy-install that predates `.claude/agents/`', keep: true },
  ],
  'skills/shared/finding-contract.md': [
    // An example finding location: a reviewed project's own command file, not a plugin file.
    { phrase: '`.claude/commands/explore.md:55` - Should fix.', keep: true },
  ],
  'skills/shared/toolkit-reference.md': [
    // The permissions intro: the script rows an old copy-install carried in the project's settings.local.json.
    { phrase: 'the `node .claude/scripts/...` rows a copy-install needed', keep: true },
  ],
  'skills/shared/criteria-deps.md': [
    // Plugin package files sit at the plugin root, not in scripts/ (npm audit there fails with ENOLOCK).
    { phrase: '`--prefix .claude/scripts`', replace: '`--prefix "${CLAUDE_PLUGIN_ROOT}"`' },
  ],
  'commands/explore.md': [
    // The profile template: on the plugin, the file setup seeds a project with, with the /tk: names (#183).
    { phrase: '`.claude/skills/shared/design-profile-template.md` (the template a copy-install ships)', replace: '`${CLAUDE_PLUGIN_ROOT}/seed/DESIGN-PROFILE.md` (the same file setup writes into a project)' },
  ],
  'skills/setup/SKILL.md': [
    // How setup recognizes a copy-install with no manifest: the project's old review.md beside VERSION (#180).
    { phrase: '`VERSION` beside `.claude/commands/review.md`', keep: true },
    // The same project file, as one way a VERSION is the copy-install's own.
    { phrase: '`.claude/commands/review.md` sits beside it', keep: true },
  ],
  'skills/review-browser/SKILL.md': [
    // The plugin's package.json is at the plugin root; quoted for a root path with a space.
    { phrase: 'npm install --prefix .claude/scripts', replace: 'npm install --prefix "${CLAUDE_PLUGIN_ROOT}"' },
    // Same root for the Chromium install through the plugin's playwright-core.
    { phrase: 'npx --prefix .claude/scripts playwright-core', replace: 'npx --prefix "${CLAUDE_PLUGIN_ROOT}" playwright-core' },
  ],
  'seed/rules-toolkit.md': [
    // Setup removes a project's rows naming its old copy-install scripts; the seeded rules file never carries ${CLAUDE_PLUGIN_ROOT}.
    { phrase: 'rows that point at a `.claude/scripts/` file the project no longer has', keep: true },
    // The seed names the copy-install's manual location (#184 R6); a project path, kept as written.
    { phrase: "the project's own copy under `.claude/skills/shared/`", keep: true },
  ],
};

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
  // A --version given with no value, or with a value of another shape, stops the
  // build (#183): the version lands in plugin.json and in every stamp.
  if (o.version !== '' && !(typeof o.version === 'string' && VERSION_ARG.test(o.version))) {
    console.error('build-plugin: --version needs a version such as 7.2.0, got ' + (o.version === undefined ? 'nothing' : JSON.stringify(o.version)));
    process.exit(2);
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

// Inline commands (issue #172). Claude Code runs the text of `` !`...` `` and
// inlines its output; one line, no backtick inside.
const ROOT_TOKEN = '${CLAUDE_PLUGIN_ROOT}';
const INLINE_COMMAND = /!`([^`\n]*)`/g;
const INLINE_CAT = /^\s*cat\s/;

// Offsets in one shell command where ${CLAUDE_PLUGIN_ROOT} sits outside every
// quote. Single and double quotes both count (the root is substituted as text
// before the shell sees it); a backslash escapes the next character.
function unquotedRootOffsets(cmd) {
  const hits = [];
  let quote = '';
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === '\\' && quote !== "'") { i++; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (cmd.startsWith(ROOT_TOKEN, i)) hits.push(i);
  }
  return hits;
}

// Quote every unquoted plugin root path token in each inline cat. A token runs
// to whitespace, a quote, or a shell operator, except that a `<name>`
// placeholder is part of the path (as in the path rewrite above); a glob tail
// stays outside the quotes so it still expands
// (`"${CLAUDE_PLUGIN_ROOT}/skills/shared/"*.md`).
const ROOT_PATH_TOKEN = /^\$\{CLAUDE_PLUGIN_ROOT\}(?:[^\s"'`;|&<>()]|<[\w-]+>)*/;
// Offset of the first shell operator outside every quote, or the command's
// length when there is none. Only the leading cat's own arguments sit before
// it: a root after `;`, `|` or `&&` belongs to another command (for example a
// `node ${CLAUDE_PLUGIN_ROOT}/scripts/x.js` whose allowed-tools rule matches the
// unquoted text), so it is left for the guard to report rather than quoted.
function catArgsEnd(cmd) {
  let quote = '';
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === '\\' && quote !== "'") { i++; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (';|&<>()'.includes(c)) return i;
  }
  return cmd.length;
}
function quoteInlineCats(text) {
  return text.replace(INLINE_COMMAND, (whole, cmd) => {
    if (!INLINE_CAT.test(cmd)) return whole;
    const argsEnd = catArgsEnd(cmd);
    const hits = unquotedRootOffsets(cmd).filter(at => at < argsEnd);
    if (!hits.length) return whole;
    let quoted = '';
    let last = 0;
    for (const at of hits) {
      // A second root inside the token just quoted (`a.md,${CLAUDE_PLUGIN_ROOT}/b.md`)
      // is already covered; quoting it again would write the tail out twice.
      if (at < last) continue;
      const token = ROOT_PATH_TOKEN.exec(cmd.slice(at))[0];
      const end = at + token.length;
      const glob = token.slice(ROOT_TOKEN.length).search(/[*?[]/);
      const head = glob === -1 ? token : token.slice(0, ROOT_TOKEN.length + glob);
      quoted += cmd.slice(last, at) + '"' + head + '"' + token.slice(head.length);
      last = end;
    }
    return '!`' + quoted + cmd.slice(last) + '`';
  });
}

// The build guard: every inline command in `text` that still holds an unquoted
// ${CLAUDE_PLUGIN_ROOT}, as written between the backticks.
function unquotedInlineRoots(text) {
  const found = [];
  for (const m of text.matchAll(INLINE_COMMAND)) if (unquotedRootOffsets(m[1]).length) found.push(m[1]);
  return found;
}

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

function slashNamesOf(inv) {
  return [...new Set([...inv.commands.map(c => c.name), ...inv.skillNames])].sort((a, b) => b.length - a.length);
}

function rewriteText(text, inv, src, unresolved, fileRel) {
  const longestFirst = (a, b) => b.length - a.length;
  const agentNames = inv.agents.map(a => a.name).sort(longestFirst);
  const slashNames = slashNamesOf(inv);

  // 0. Site overrides for this file (issue #176): replacements are substituted
  //    now, kept phrases are parked behind placeholders the path rewrite cannot
  //    match (U+0001, always written as a backslash-u escape so no editor or
  //    diff can strip it; a control character is never part of a path token) and restored
  //    right after it. A phrase that is not in the text is reported.
  const kept = [];
  for (const site of SITE_OVERRIDES[fileRel] || []) {
    if (!text.includes(site.phrase)) {
      unresolved.push(fileRel + ': site override phrase not found: ' + site.phrase);
      continue;
    }
    if (site.keep) {
      const holder = '\u0001' + kept.length + '\u0001';
      kept.push(site.phrase);
      text = text.split(site.phrase).join(holder);
    } else {
      text = text.split(site.phrase).join(site.replace);
    }
  }
  // 1. Every `.claude/...` path token. A token runs until whitespace, a quote,
  //    a backtick, a closing paren/bracket, or a trailing sentence dot. A token
  //    that is the tail of a longer path (`~/.claude/plugins/...`,
  //    `/home/x/.claude/...`) is a home-directory path, not a project path, and
  //    is left alone: the lookbehind refuses a `~/` or `<word>/` prefix.
  text = text.replace(/(?<![~\w]\/)\.claude\/[A-Za-z0-9_./*<>-]*[A-Za-z0-9_*>-]/g, (tok) => {
    const mapped = mapPath(tok, src);
    if (mapped === null) { unresolved.push(fileRel + ': ' + tok); return tok; }
    return mapped;
  });
  kept.forEach((phrase, i) => { text = text.split('\u0001' + i + '\u0001').join(phrase); });
  // 1b. Inline cats get each plugin root path in double quotes (issue #172):
  //     unquoted, a plugin root whose path holds a space inlines nothing.
  text = quoteInlineCats(text);
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
    //    followed by a name character, a hyphen, or a dot starting a file
    //    extension (so file paths survive, `<folder>/playground.html` stays a
    //    file name, a longer name is never cut short, and /review-* is left to
    //    step 5).
    const re2 = new RegExp('(^|[^\\w./:\\-])/(' + slashNames.map(escapeRe).join('|') + ')(?![\\w-]|\\.\\w)', 'g');
    text = text.replace(re2, (m0, pre, name) => pre + '/' + PLUGIN_NAME + ':' + name);
    // 5. Family mentions: `/review-*`, `/ask-*`. Same path guard as step 4, and
    //    only a prefix that starts a real name (so `/tmp/playground-*` and any
    //    other wildcard path stay as written).
    text = text.replace(/(^|[^\w./:\-])\/([a-z0-9]+(?:-[a-z0-9]+)*)-\*/g, (m0, pre, prefix) =>
      slashNames.some(n => n.startsWith(prefix + '-')) ? pre + '/' + PLUGIN_NAME + ':' + prefix + '-*' : m0);
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
    // Per-run temp folders (render payloads, the gh body file): Claude Code asks
    // before an unlisted mktemp (measured), so a project that never ran
    // /tk:setup would stop on every render without this rule.
    if (/\bmktemp -d \/tmp\//.test(t)) rules.add(MKTEMP_RULE);
    // An install into the plugin root, as a whole command: after a line start,
    // a space or a backtick, and up to a line end or a backtick, so a longer
    // command (another package, another npx call) gets no rule.
    for (const cmd of PLUGIN_ROOT_INSTALLS) {
      if (new RegExp('(?:^|[\\s`])' + escapeRe(cmd) + '(?=[`\\r]|$)', 'm').test(t)) rules.add('Bash(' + cmd + ')');
    }
    for (const m of t.matchAll(/\b(node|bash) \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/([a-z0-9-]+\.(?:js|sh))/g)) {
      const call = m[1] + ' ${CLAUDE_PLUGIN_ROOT}/scripts/' + m[2];
      rules.add('Bash(' + call + ' *)');
      rules.add('Bash(' + call + ')');
      if (m[2] === 'browse.js') { rules.add('Bash(echo * | ' + call + ' *)'); rules.add('Bash(cat * | ' + call + ' *)'); }
    }
    // Every plugin root path in an inline cat is followed. The emitted form is
    // quoted (`` !`cat "${CLAUDE_PLUGIN_ROOT}/x.md"` ``); the unquoted form, extra
    // arguments, and extra spaces are followed too, so a caller passing text that
    // has not been through the quoting step gets the same rules.
    for (const m of t.matchAll(INLINE_COMMAND)) {
      if (!INLINE_CAT.test(m[1])) continue;
      for (const p of m[1].matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) {
        const rel = p[1];
        if (seen.has(rel)) continue;
        seen.add(rel);
        const abs = path.join(src, rel);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) scan(rewriteText(fs.readFileSync(abs, 'utf8'), inv, src, [], rel));
      }
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

// The seed check (issue #173): a seed file lands in a PROJECT under the plugin
// layout, where old copy-install text is wrong. Returns one problem string per
// finding. Phrases kept by SITE_OVERRIDES for the file are deliberate project
// paths and are removed before scanning. The retired-rows list is exempt: it is
// the old copy-install rows by definition, read by the upgrade audit and never
// written into a project as text.
const SEED_CHECK_EXEMPT = new Set(['seed/retired-permission-rows.txt']);
const STATE_FILE = '.claude/.toolkit-state.json';

function seedProblems(rel, text, inv) {
  if (SEED_CHECK_EXEMPT.has(rel)) return [];
  for (const site of SITE_OVERRIDES[rel] || []) if (site.keep) text = text.split(site.phrase).join('');
  const problems = [];
  for (const bad of ['.claude/scripts/', 'setup.sh', '${CLAUDE_PLUGIN_ROOT}']) {
    if (text.includes(bad)) problems.push('seed carries old-layout text ' + JSON.stringify(bad));
  }
  const names = slashNamesOf(inv);
  if (names.length) {
    // The step-4 path guard from rewriteText: `/name` not inside a path and not
    // already scoped (in `/tk:name` the name follows a colon, never a slash).
    const re = new RegExp('(^|[^\\w./:\\-])/(' + names.map(escapeRe).join('|') + ')(?![\\w-])', 'g');
    for (const m of text.matchAll(re)) problems.push('seed names a toolkit command without tk: /' + m[2]);
    for (const m of text.matchAll(/(^|[^\w./:\-])\/([a-z0-9]+(?:-[a-z0-9]+)*)-\*/g)) {
      if (names.some(n => n.startsWith(m[2] + '-'))) problems.push('seed names a toolkit command family without tk: /' + m[2] + '-*');
    }
  }
  if (rel === 'seed/gitignore') {
    for (const line of text.split(/\r?\n/)) {
      if (gitignoreLineMatches(line, STATE_FILE)) problems.push('seed gitignore line ignores ' + STATE_FILE + ': ' + line.trim());
    }
  }
  return problems;
}

// Does one .gitignore line ignore the file at `rel`? Enough of git's rules for a
// seed check: comments, blanks and negations never ignore; a trailing slash
// matches directories only; a pattern with an inner slash is anchored to the
// root, any other pattern matches a name at any depth; `**`, `*`, `?` glob. A
// pattern that matches a parent directory ignores everything inside it.
function gitignoreLineMatches(line, rel) {
  let p = line.replace(/\s+$/, '');
  if (!p || p.startsWith('#') || p.startsWith('!')) return false;
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.replace(/\/+$/, '');
  const anchored = p.includes('/');
  p = p.replace(/^\//, '');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += escapeRe(c);
  }
  const whole = new RegExp('^' + re + '$');
  const parts = rel.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const isDir = i < parts.length;
    if (dirOnly && !isDir) continue;
    const subject = anchored ? parts.slice(0, i).join('/') : parts[i - 1];
    if (whole.test(subject)) return true;
  }
  return false;
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
    if (f.rel === 'shared/conventions.md') {
      // Data, not prose: upgrade-audit.js parses its `Looks behind` regexes,
      // several of which match `.claude/...` paths in DOWNSTREAM files. Rewriting
      // those to the plugin root would break every one of them, so the file is
      // copied byte for byte.
      put('skills/' + f.rel, fs.readFileSync(f.abs));
    } else if (f.rel.endsWith('.md')) {
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
  if (!inv.scripts.some(s => s.rel === SESSION_START_SCRIPT)) {
    unresolved.push('hooks/hooks.json: missing source scripts/' + SESSION_START_SCRIPT);
  }
  put('hooks/hooks.json', JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [{
        type: 'command',
        // One node call parses in bash and PowerShell alike. The script makes the
        // link portably and always exits 0, so a hook never blocks a session.
        command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/' + SESSION_START_SCRIPT + '"',
      }] }],
    },
  }, null, 2) + '\n');
  // Paths a copy-install manages (for migrating a manifest-less install): today's
  // inventory, plus every path an earlier release shipped from main that the
  // source has since dropped (scripts/historical-managed-paths.txt, a committed
  // list so --check stays deterministic without tags or history). Without it a
  // pre-v5.5.0 install's old toolkit files were reported as the user's own
  // (review of the v7.0.0 release, R15).
  const historyFile = path.join(path.dirname(src), 'scripts', 'historical-managed-paths.txt');
  const historical = fs.existsSync(historyFile)
    ? fs.readFileSync(historyFile, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    : [];
  const managed = [...new Set([
    ...inv.commands.map(c => '.claude/commands/' + c.rel),
    ...inv.agents.map(a => '.claude/agents/' + a.rel),
    ...inv.skillFiles.map(f => '.claude/skills/' + f.rel),
    ...inv.scripts.map(s => '.claude/scripts/' + s.rel),
    '.claude/rules/toolkit.md', '.claude/rules/html-outputs.md',
    '.env.local.example', '.gitattributes', 'VERSION', 'artifacts/README.md',
    ...historical,
  ])].sort();
  // The hashes of every shipped copy of each root helper script (#180), read from
  // the committed list: `#` comments and blank lines skipped, every other line
  // `<path> <64 lowercase hex>`. Each root helper in the managed list needs at
  // least one hash and each line must name one, or the build reports it: a helper
  // with no hash is never swept, and a line for any other path is never read.
  const rootHelpers = managed.filter(rel => ROOT_HELPER.test(rel));
  const helperFile = path.join(path.dirname(src), 'scripts', HELPER_HASHES_FILE);
  const helperHashes = new Map();
  if (fs.existsSync(helperFile)) {
    fs.readFileSync(helperFile, 'utf8').split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const m = /^(\S+) ([0-9a-f]{64})$/.exec(line);
      const where = 'scripts/' + HELPER_HASHES_FILE + ' line ' + (i + 1);
      if (!m) { unresolved.push(where + ': not "<path> <sha256 in lowercase hex>": ' + line.slice(0, 120)); return; }
      if (!rootHelpers.includes(m[1])) { unresolved.push(where + ': ' + m[1] + ' is not a root helper script in managed-paths.json'); return; }
      if (!helperHashes.has(m[1])) helperHashes.set(m[1], new Set());
      helperHashes.get(m[1]).add(m[2]);
    });
  }
  for (const rel of rootHelpers) {
    if (!helperHashes.has(rel)) unresolved.push('managed-paths.json: no historical hash for the root helper script ' + rel + ' in scripts/' + HELPER_HASHES_FILE);
  }
  const historicalHelperHashes = {};
  for (const rel of [...helperHashes.keys()].sort()) historicalHelperHashes[rel] = [...helperHashes.get(rel)].sort();
  put('managed-paths.json', JSON.stringify({ version, paths: managed, historicalHelperHashes }, null, 2) + '\n');
  // The project seed: what /tk:setup writes into a project (write-when-absent
  // files, the gitignore lines and the permission baseline it merges, and the
  // retired permission rows the upgrade audit removes). Sourced from the
  // repository's seed/ folder (issue #173), which holds the DOWNSTREAM versions:
  // this repository's own CLAUDE.md, .gitignore and settings are maintainer
  // files and are never seeded. The one exception is the rules file, sourced
  // from .claude/rules/toolkit.md because this repository runs it too.
  const repo = path.dirname(src);
  const seedDir = path.join(repo, 'seed');
  const seedSources = {
    'seed/CLAUDE.md': path.join(seedDir, 'CLAUDE.md'),
    'seed/LESSONS.md': path.join(seedDir, 'LESSONS.md'),
    'seed/LESSONS-detail.md': path.join(seedDir, 'LESSONS-detail.md'),
    'seed/DESIGN-PROFILE.md': path.join(seedDir, 'DESIGN-PROFILE.md'),
    'seed/env.local.example': path.join(seedDir, 'env.local.example'),
    'seed/gitattributes': path.join(seedDir, 'gitattributes'),
    'seed/gitignore': path.join(seedDir, 'gitignore'),
    'seed/artifacts-README.md': path.join(seedDir, 'artifacts-README.md'),
    'seed/retired-permission-rows.txt': path.join(seedDir, 'retired-permission-rows.txt'),
    'seed/rules-toolkit.md': path.join(src, 'rules', 'toolkit.md'),
    'seed/settings.local.json': path.join(seedDir, 'settings.local.json'),
  };
  for (const [rel, abs] of Object.entries(seedSources)) {
    if (!fs.existsSync(abs)) { unresolved.push('seed: missing source ' + path.relative(repo, abs)); continue; }
    const raw = fs.readFileSync(abs);
    // The seed rules file is written into PROJECTS, where the toolkit's commands
    // answer only to their scoped names (/tk:explore), so its command mentions
    // are rewritten exactly like a command file's. By convention it carries no
    // toolkit paths (it refers to fragments by name), so nothing else changes;
    // a path that slips in is reported as unresolved like anywhere else.
    const content = rel === 'seed/rules-toolkit.md' ? Buffer.from(rewriteText(raw.toString('utf8'), inv, src, unresolved, rel), 'utf8') : raw;
    for (const problem of seedProblems(rel, content.toString('utf8'), inv)) unresolved.push(rel + ': ' + problem);
    put(rel, content);
  }
  // The stamps follow the build's version (#183). The replacement is a function,
  // so no `$` in a version is read as a replacement pattern.
  for (const rel of STAMPED_FILES) {
    if (!files.has(rel)) { unresolved.push(rel + ': stamped file not emitted, so its toolkit version stamp cannot follow ' + version); continue; }
    const content = files.get(rel);
    const text = content.toString('utf8');
    if (!TOOLKIT_STAMP.test(text)) { unresolved.push(rel + ': no "<!-- Toolkit version: X |" stamp to set to ' + version); continue; }
    const stamped = text.replace(TOOLKIT_STAMP, () => '<!-- Toolkit version: ' + version + ' |');
    put(rel, Buffer.isBuffer(content) ? Buffer.from(stamped, 'utf8') : stamped);
  }
  // An override keyed to a file the build never emits could never report a
  // missing phrase, so the key itself is checked.
  for (const key of Object.keys(SITE_OVERRIDES)) {
    if (!files.has(key)) unresolved.push(key + ': site override names a file the build does not emit');
  }
  // The inline command guard (issue #172): the cat rewrite quotes what it knows,
  // and anything it does not know (another command, a form added later) is
  // reported here instead of shipping a path that breaks under a space.
  for (const [rel, content] of files) {
    if (!rel.endsWith('.md')) continue;
    for (const cmd of unquotedInlineRoots(content.toString('utf8'))) {
      unresolved.push(rel + ': unquoted ' + ROOT_TOKEN + ' in inline command !`' + cmd + '`');
    }
  }
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

// The output tree is walked WITHOUT the source allowlist filter: the seed
// legitimately carries a settings.local.json copy, and a stale file of any
// name in plugin/ must be reported, not skipped.
function walkAll(dir, rel, out) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const r = rel ? rel + '/' + name : name;
    if (fs.statSync(abs).isDirectory()) walkAll(abs, r, out); else out.push({ rel: r, abs });
  }
  return out;
}

function diffTree(outDir, files) {
  const diffs = [];
  const onDisk = new Map(walkAll(outDir, '', []).map(f => [f.rel, f.abs]));
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
module.exports = { build, rewriteText, injectAllowedTools, scriptRules, mapPath, inventory, seedProblems, gitignoreLineMatches, quoteInlineCats, unquotedInlineRoots, SITE_OVERRIDES, PLUGIN_NAME, HOST_ROWS, PLUGIN_ROOT_INSTALLS, STAMPED_FILES, HELPER_HASHES_FILE };
