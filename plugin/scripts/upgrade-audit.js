#!/usr/bin/env node
'use strict';
// upgrade-audit.js - the deterministic half of /tk:upgrade (issue #167, Step 6;
// repairs and safe receipts, issues #172 and #174).
//
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade-audit.js [--project <dir>]
//        [--plugin-root <dir>] [--conventions <file>] [--from <version>] [--stamp]
//
// Reads the conventions document (the plugin's skills/shared/conventions.md by
// default), selects every convention whose `Since` version lies in the range
// (installed, current], plus every convention marked `Runs: every upgrade`,
// inventories the files the PROJECT owns (everything under .claude/commands,
// agents, skills and rules, plus CLAUDE.md - the plugin's own files never sit
// in the project), runs each convention's detector over its scope, and prints
// one candidate finding per line as JSONL on stdout. Each finding carries a
// runnable receipt, so the /tk:upgrade skill can hand them straight to the M2
// audit. A one-line summary goes to stderr.
//
// The range starts at the last version whose conventions this project has been
// audited against, read from .claude/.toolkit-state.json: `auditedVersion` when
// a previous /tk:upgrade stamped it, else `previousVersion` (a copy-install
// migration records the version it came from there, so the first upgrade after
// a migration audits everything since that copy-install rather than nothing),
// else `version`. The first of those keys that names a value decides, and the
// value is validated with the version helpers session-start.js uses: a value of
// any other shape is no usable start, so every convention up to the plugin
// version applies, and it is never echoed. --from overrides all three; with no
// state file at all every convention applies. `--stamp` is the end of a clean
// /tk:upgrade run: it sets `version` and `auditedVersion` to the plugin version
// and exits, and it refuses (one line, exit 0, nothing written) when the state
// already records a newer version than the plugin, so a stamp never lowers it.
//
// Convention format (one section each, parsed here and written by hand there):
//
//   ### C-12: Criteria reach a worker by preload, not by paste
//   - **Since:** 7.0.0
//   - **Runs:** every upgrade            (optional: skip the range filter)
//   - **Scope:** prompt-files            (prompt-files | prompt-files+claude-md | claude-md | agents | settings-local | seed-stamp | seed-lines | local-edits)
//   - **Detector:** regex                (regex | seed-stamp | dead-permissions | permission-rows | seed-lines | unscoped-names | local-edits | agent-tools | manual)
//   - **Looks behind:** `PASTE THE SKILL'S REVIEW CRITERIA`
//   - **Looks behind:** `subagent_type=(tk:)?review-finder`
//   - **Fix:** dispatch the typed finder for the kind; move any pasted criteria into a skill it preloads
//
// `Looks behind` may repeat; each backticked value is a JavaScript regular
// expression applied per line. The non-regex detectors need no pattern:
// seed-stamp compares the seeded rules file's version stamp with the plugin
// version, dead-permissions lists settings.local.json entries that point at
// removed scripts, permission-rows compares settings.local.json with the
// plugin's shipped seed (rows it lacks, retired rows it still has, and a
// `defaultMode` of acceptEdits as a question for the user) and with the
// migration's backup of it (rows of the project's own a 7.0.x migration
// removed although their script stayed), seed-lines finds lines an older seed
// wrote into .gitattributes, .gitignore and artifacts/README.md, plus lines of
// the project's own a 7.0.x migration dropped from a file it replaced (still in
// the backup folder) and a migration record git still tracks (it asks git and
// reads only row counts from the record), unscoped-names finds toolkit command,
// skill and agent names used without the tk: scope, local-edits reads
// .claude/.toolkit-migration.json, and agent-tools reads every project-owned
// agent whose name or description says it is a finder, reviewer, critic,
// skeptic, verifier, judge, or auditor and flags one with no `tools:` line or
// with Edit, Write, or NotebookEdit in it. `manual` is not run here at all: the
// /tk:upgrade skill judges those by hand (a judgment no grep expresses) and
// emits findings in the same shape.
//
// Receipts run through bash in the project root, so every value a receipt
// names (a pattern, a file, a permission row) is single-quoted by shq(): a
// pattern with a backtick, `$` or `"` in it would otherwise break the command
// and kill a true finding as RECEIPT FAILED.
//
// Exit codes: 0 (findings are data, zero is a valid count; a refused stamp is
// also 0), 1 on error.
// Dependency-free, like every script under .claude/scripts/.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_PROMPT_DIRS = ['.claude/commands', '.claude/agents', '.claude/skills', '.claude/rules'];
const SEED_RULES = '.claude/rules/toolkit.md';
const STATE_REL = '.claude/.toolkit-state.json';
const MIGRATION_REL = '.claude/.toolkit-migration.json';
const MANIFEST_REL = '.claude/.toolkit-manifest.json';
const LOCAL_SETTINGS = '.claude/settings.local.json';
// The toolkit repository: a migrated file's base is its tagged copy there.
const TOOLKIT_REPO_URL = 'https://github.com/mayankmankhand/llm-peer-review';
// Same rule as setup-project.js: a legacy toolkit row shape, or a row naming a
// script under .claude/scripts/ that the project does not have. A custom
// script's row is live (review of the v7.0.0 release, R2). The script name
// stops before a colon that ends it: Claude Code writes "don't ask again" rows
// as `Bash(node .claude/scripts/our-report.js:*)`, and reading that name as
// `our-report.js:` made a kept script's row look dead.
const LEGACY_DEAD_PERMISSION = [
  /^Bash\((echo|cat) \* \| node \/[^)]*\/(\.claude\/)?scripts\/browse\.js \*\)$/,
  /^Skill\(review-commands(:\*)?\)$/,
];
function deadPermission(row, exists) {
  if (LEGACY_DEAD_PERMISSION.some(re => re.test(row))) return true;
  const m = /(?:^|[\s(])\.claude\/scripts\/([^\s)'"*]+?):?(?=[\s)'"*]|$)/.exec(row);
  return m !== null && !exists('.claude/scripts/' + m[1]);
}
// The project script a permission row runs, as a plain project-relative path
// under .claude/scripts/, or null. The relative form is the extraction
// deadPermission uses (the same regex, copied from setup-project.js;
// scripts/test-upgrade-audit.js fails when the copies drift), and the absolute
// form ends the name the same way. An absolute path
// counts only when it resolves inside this project root, judged on the path as
// written and on the real paths (a symlinked temp or home folder), so a row
// naming a script in some other checkout never qualifies.
const ROW_SCRIPT_REL = /(?:^|[\s(])\.claude\/scripts\/([^\s)'"*]+?):?(?=[\s)'"*]|$)/;
const ROW_SCRIPT_ABS = /(?:^|[\s(])(\/[^\s)'"*]*\/\.claude\/scripts\/[^\s)'"*]+?):?(?=[\s)'"*]|$)/;
function rowScriptRel(row, project) {
  const m = ROW_SCRIPT_REL.exec(row);
  if (m) { const rel = '.claude/scripts/' + m[1]; return safeRel(rel) ? rel : null; }
  const a = ROW_SCRIPT_ABS.exec(row);
  if (!a) return null;
  const real = (p) => { try { return fs.realpathSync(p); } catch (e) { return null; } };
  const written = path.resolve(a[1]);
  for (const [root, abs] of [[project, written], [real(project), written], [real(project), real(written)]]) {
    if (!root || !abs) continue;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (rel.startsWith('.claude/scripts/') && safeRel(rel)) return rel;
  }
  return null;
}
// Does a permission row name an absolute path? A token that starts at the
// filesystem root (`/home/...`, or Claude Code's `//home/...` rule form) or at a
// Windows drive (`C:\`, `C:/`). Used only to count such rows, never to echo one.
const ABSOLUTE_IN_ROW = /(?:^|[\s(='"])(?:\/+[^\s)'"*]|[A-Za-z]:[\\/])/;
function isFile(abs) { try { return fs.statSync(abs).isFile(); } catch (e) { return false; } }
// Single-quote a string for a POSIX shell, so a receipt can name rows verbatim.
function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
// A project-relative path from a record the project controls (the migration
// file): plain path characters only, no absolute path, no `..` segment. Anything
// else is skipped rather than echoed into a finding.
function safeRel(p) {
  return typeof p === 'string' && p.length <= 400 && /^[A-Za-z0-9._@+-]+(\/[A-Za-z0-9._@+-]+)*$/.test(p) && !p.split('/').includes('..');
}
// The same path with Windows separators turned into forward slashes, when the
// result is safe: setup-project.js records paths with path.relative, which
// writes backslashes on native Windows. Normalizing first keeps the checks
// that matter (a leading slash, a drive letter's colon, a `..` segment all still
// fail safeRel). Null for anything unsafe.
function safeRelPath(p) {
  if (typeof p !== 'string') return null;
  const n = p.replace(/\\/g, '/');
  return safeRel(n) ? n : null;
}

// The version helpers, copied function for function from the block in
// session-start.js (issue #174) so this script runs on its own;
// scripts/test-upgrade-audit.js fails when these copies drift from that block.
// A version read from the project is only ever used in one fixed, harmless
// shape, and a value of any other shape is never compared and never echoed.
const VERSION_SHAPE = /^\d+(\.\d+){0,3}(-[0-9A-Za-z.]+)?$/;
const VERSION_MAX_LENGTH = 32;
// The version as a safe string (surrounding whitespace dropped), or null.
function validVersion(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length <= VERSION_MAX_LENGTH && VERSION_SHAPE.test(t) ? t : null;
}
// Dotted numeric parts, any -suffix ignored: 7.0.1 < 7.1.0 < 7.10.0. Null for
// anything validVersion refuses, so a malformed value never produces a verdict.
function parseVersion(v) {
  const t = validVersion(v);
  return t === null ? null : t.split('-')[0].split('.').map(Number);
}
// -1, 0 or 1 as a is older than, equal to, or newer than b; null when either is unusable.
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null || pb === null) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
// The version a project is recorded at: auditedVersion (a /tk:upgrade stamped
// it, or a fresh setup wrote it), else previousVersion (a migration's old
// copy-install version), else version. The first key that names a version
// decides, validated: null when none names one or that value is unusable (no
// fall-through to a later key, so a malformed stamp cannot pick the reference).
function referenceVersion(state) {
  if (!state || typeof state !== 'object') return null;
  for (const key of ['auditedVersion', 'previousVersion', 'version']) {
    if (typeof state[key] === 'string' && state[key].trim() !== '') return validVersion(state[key]);
  }
  return null;
}

const USAGE = 'usage: node upgrade-audit.js [--project <dir>] [--plugin-root <dir>] [--conventions <file>] [--from <version>] [--stamp]';

function parseArgs(argv) {
  const o = { project: '', pluginRoot: '', conventions: '', from: '', stamp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') o.project = argv[++i];
    else if (a === '--plugin-root') o.pluginRoot = argv[++i];
    else if (a === '--conventions') o.conventions = argv[++i];
    else if (a === '--from') o.from = argv[++i];
    else if (a === '--stamp') o.stamp = true;
    else if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    else { console.error('upgrade-audit: unknown argument ' + a + '\n' + USAGE); process.exit(1); }
  }
  return o;
}
function git(args, cwd) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return null; }
}
function readJson(abs, fallback) { try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { return fallback; } }
function readLines(abs) { try { return fs.readFileSync(abs, 'utf8').split(/\r?\n/); } catch (e) { return null; } }

function parseConventions(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const h = /^###\s+(C-\d+):\s*(.+?)\s*$/.exec(raw);
    if (h) { cur = { id: h[1], title: h[2], since: '0.0.0', always: false, scope: 'prompt-files', detector: 'regex', patterns: [], fix: '' }; out.push(cur); continue; }
    if (!cur) continue;
    const b = /^-\s+\*\*([A-Za-z ]+):\*\*\s*(.*)$/.exec(raw);
    if (!b) continue;
    const key = b[1].toLowerCase().trim(); const val = b[2].trim();
    if (key === 'since') cur.since = val;
    // `Runs: every upgrade` exempts a convention from the range filter: a check
    // that must hold after every update, whatever version the project came from.
    else if (key === 'runs') cur.always = /^every upgrade\b/i.test(val);
    else if (key === 'scope') cur.scope = val;
    else if (key === 'detector') cur.detector = val;
    else if (key === 'looks behind') { const m = /`(.+)`/.exec(val); if (m) cur.patterns.push(m[1]); }
    else if (key === 'fix') cur.fix = val;
  }
  return out;
}

// Does a folder hold any file, node_modules folders aside?
function hasFilesUnder(dir) {
  let names; try { names = fs.readdirSync(dir); } catch (e) { return false; }
  return names.some(name => {
    if (name === 'node_modules') return false;
    const abs = path.join(dir, name);
    let st; try { st = fs.statSync(abs); } catch (e) { return false; }
    return st.isDirectory() ? hasFilesUnder(abs) : true;
  });
}

function walkFiles(dir, rel, out) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const r = rel + '/' + name;
    if (name === 'node_modules' || name.startsWith('.toolkit-')) continue;
    if (fs.statSync(abs).isDirectory()) walkFiles(abs, r, out); else out.push(r);
  }
  return out;
}

// The command, skill and agent names under a root laid out like the plugin
// (commands/*.md, skills/<name>/SKILL.md, agents/*.md): each file or folder
// name, plus a frontmatter `name:` when it differs. Used on the plugin root for
// the names a project must scope with tk:, and on the project's .claude/ for
// the names the project owns itself (never flagged: they are its own pieces).
function frontmatterName(abs) {
  let text; try { text = fs.readFileSync(abs, 'utf8'); } catch (e) { return null; }
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const m = fm && /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(fm[1]);
  return m ? m[1] : null;
}
function piecesUnder(root) {
  const names = new Set();
  const list = (dir) => { try { return fs.readdirSync(dir).sort(); } catch (e) { return []; } };
  for (const n of list(path.join(root, 'commands'))) if (n.endsWith('.md')) names.add(n.slice(0, -3));
  for (const n of list(path.join(root, 'agents'))) if (n.endsWith('.md')) { names.add(n.slice(0, -3)); names.add(frontmatterName(path.join(root, 'agents', n))); }
  for (const d of list(path.join(root, 'skills'))) {
    const skill = path.join(root, 'skills', d, 'SKILL.md');
    if (d !== 'shared' && fs.existsSync(skill)) { names.add(d); names.add(frontmatterName(skill)); }
  }
  return [...names].filter(n => typeof n === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(n));
}

// Unscoped toolkit names on one line (C-11). URLs are blanked first, so a path
// segment of a link is never a mention. A slash mention needs a boundary before
// the slash (not a word character, dot, slash, colon, tilde, dash, backslash,
// @, $, brace, closing bracket or paren, %, #, =, &, ?, +, * or <, so file
// paths, globs, variables, closing tags such as </document> and `and/or` prose
// stay out) and after the name (not a word character, dash or slash, and not a
// dot that starts a file extension). A scoped `/tk:review` never matches: the
// name there follows a colon.
const URL_RE = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>"'`]*|\bwww\.[^\s<>"'`]*/g;
// The text just before a slash that makes `/<name>` a root-relative path, not
// a mention: a markdown link target `](` or reference definition `[x]: `, an
// attribute value (`href="`, `src='`, `to=`), a CSS `url(`, an HTTP route
// after its method (`GET /index`), or a directory after a shell command that
// takes one (`cd /worktree`). A mention in prose, a code span or parentheses
// such as "(run /review)" keeps its match.
const PATH_BEFORE_SLASH = /(?:\]\(\s*<?|^\s*\[[^\]]+\]:\s*<?|=\s*["']?|\burl\(\s*["']?|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+|(?:^|[\s;&|`(])(?:cd|pushd|ls|cat|mkdir|rm|rmdir|cp|mv|touch)(?:\s+-[A-Za-z-]+)*\s+)$/;
function unscopedMatchers(names) {
  const alt = names.slice().sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return [
    { re: new RegExp('\\bSkill\\(\\s*["\'`]?(' + alt + ')(?![\\w-])', 'g'), grep: (m) => m[0], show: (m) => 'Skill(' + m[1] + ')' },
    { re: new RegExp('\\bsubagent_type\\s*[=:]\\s*["\'`]?(' + alt + ')(?![\\w-])', 'g'), grep: (m) => m[0], show: (m) => 'subagent_type=' + m[1] },
    { re: new RegExp('(^|[^\\w./:~\\\\@$})\\]%#=&?+*<-])\\/(' + alt + ')(?![\\w/-]|\\.\\w)', 'g'), grep: (m) => '/' + m[2], show: (m) => '/' + m[2],
      path: (text, m) => PATH_BEFORE_SLASH.test(text.slice(0, m.index + m[1].length)) },
  ];
}
// Each hit as { grep, show }: the exact text on the line (the receipt's fixed
// string) and the name as a reader would write it.
function unscopedTokens(line, matchers) {
  const text = line.replace(URL_RE, (u) => ' '.repeat(u.length));
  const tokens = [];
  for (const { re, grep, show, path: isPath } of matchers) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (isPath && isPath(text, m)) continue;
      const t = { grep: grep(m), show: show(m) };
      if (!tokens.some(x => x.grep === t.grep)) tokens.push(t);
    }
  }
  return tokens;
}

// One .gitignore line as a rule: whether it is a negation (`!`), and its
// matcher for one path level. Null for a comment or a blank. The pattern rule
// is the one gitignoreLineMatches in scripts/build-plugin.js uses on the seed:
// a trailing slash matches directories only; a pattern with an inner slash is
// anchored to the root, any other pattern matches a name at any depth; `**`,
// `*`, `?` glob.
function gitignoreRule(line) {
  let p = line.replace(/\s+$/, '');
  if (!p || p.startsWith('#')) return null;
  const negate = p.startsWith('!');
  if (negate) p = p.slice(1);
  if (!p) return null;
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
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const whole = new RegExp('^' + re + '$');
  // Level i is the path's first i segments; every level but the last is a directory.
  const matchesAt = (parts, i) => {
    if (dirOnly && i >= parts.length) return false;
    return whole.test(anchored ? parts.slice(0, i).join('/') : parts[i - 1]);
  };
  return { negate, matchesAt };
}
// The first level of `rel` a rule matches: 'dir' for a parent directory (so
// the whole folder is ignored), 'file' for the file itself, null for neither.
function gitignoreLevel(rule, rel) {
  const parts = rel.split('/');
  for (let i = 1; i <= parts.length; i++) if (rule.matchesAt(parts, i)) return i < parts.length ? 'dir' : 'file';
  return null;
}
// Does the whole .gitignore ignore `rel`, as git decides it? Directories are
// checked from the top: at each level the last matching line wins, a negation
// included, and once a parent directory is ignored nothing inside it can be
// re-included. So `.claude/.toolkit-*.json` followed by
// `!.claude/.toolkit-state.json` leaves the state file tracked, while
// `.claude/` followed by the same negation does not.
function gitignoreIgnores(lines, rel) {
  const rules = lines.map(gitignoreRule);
  const parts = rel.split('/');
  for (let i = 1; i <= parts.length; i++) {
    let last = null;
    for (const rule of rules) if (rule !== null && rule.matchesAt(parts, i)) last = rule;
    if (last !== null && !last.negate) return true;
  }
  return false;
}

// Stale seeded lines (C-10): the project file, the shipped seed it came from,
// and which of its lines an older seed wrote that the current one does not.
// A migration keeps a project's own scripts in .claude/scripts/ (C-8 treats
// their rows as live), and the .gitattributes rule for that folder keeps their
// line endings right, so the rule is stale only once the folder holds no files.
const STALE_SEED_FILES = [
  { rel: '.gitattributes', seed: 'gitattributes', stale: (l, ctx) => l.includes('.claude/scripts/') && !ctx.keepsScripts() },
  { rel: '.gitignore', seed: 'gitignore', stale: (l) => l.includes('.claude/.toolkit-manifest.json') || l.includes('Toolkit install manifest (auto-generated by setup') || l.includes('preserved by setup.sh'), harmful: stateFileIgnorers },
  { rel: 'artifacts/README.md', seed: 'artifacts-README.md', stale: (l) => l.includes('.claude/scripts/render-html.js') },
];
// The .gitignore lines that keep the state file out of git, by index, each with
// the level it matches ('dir' when it ignores the .claude folder itself, 'file'
// when it ignores the state file). None when the file as a whole leaves the
// state file tracked, for example through a later negation line.
function stateFileIgnorers(lines) {
  const out = new Map();
  if (!gitignoreIgnores(lines, STATE_REL)) return out;
  lines.forEach((line, i) => {
    const rule = gitignoreRule(line);
    const level = rule === null || rule.negate ? null : gitignoreLevel(rule, STATE_REL);
    if (level !== null) out.set(i, level);
  });
  return out;
}
// The shipped seed's line that replaces a stale one: the seed line opening with
// the same three words. None means the current seed dropped the line.
function seedReplacement(line, seedLines) {
  const head = (s) => s.trim().split(/\s+/).slice(0, 3).join(' ');
  const h = head(line);
  return (seedLines || []).find(s => s.trim() !== '' && head(s) === h && s.trim() !== line.trim()) || null;
}

// Lost project lines (C-10): files a 7.0.x migration replaced whole (it removed
// the file, then reseeded it), so a line of the project's own survives only in
// the backup folder. 7.1.0's setup line-merges these files instead
// (KEEP_ON_MIGRATION in setup-project.js), so only a 7.0.x record names one.
// Each entry names the shipped seed and every rule line an earlier toolkit
// release put in that file; a backup line in neither, and not in the live file,
// is the project's own. Adding another replaced file is one more entry.
//
// Every rule line the installers copied as a project's .gitattributes, from
// git history: the toolkit repository's own .gitattributes at v4.5.1, v4.6.0,
// v5.0.0, v5.2.0, v5.5.0, v6.0.0, v6.1.0, v6.1.1, v6.2.0, v6.3.0, v6.3.1,
// v6.3.2 and v6.3.3 (scripts/setup/setup.sh and setup.ps1 copy
// $TOOLKIT_ROOT/.gitattributes), and plugin/seed/gitattributes at v7.0.0 and
// v7.0.1. v0-web-app and v1.0.0 shipped none. Comments and blanks are skipped
// anyway, so only rules are listed.
const SHIPPED_GITATTRIBUTES = ['* text=auto', '*.sh text eol=lf', 'scripts/** text eol=lf', '.claude/scripts/** text eol=lf'];
const REPLACED_ON_MIGRATION = [
  { rel: '.gitattributes', seed: 'gitattributes', shipped: SHIPPED_GITATTRIBUTES },
];
// A line as git reads an attributes rule: CR, a leading UTF-8 byte order mark
// (git ignores one at the start of .gitattributes), surrounding blanks and
// repeated blanks do not matter. The receipt normalizes the same way (tr -d '\r',
// then awk drops a leading mark and '$1=$1' collapses spaces and tabs), so the
// two always agree.
function lineKey(l) { return String(l).replace(/\r/g, '').replace(/^\uFEFF/, '').replace(/^[ \t]+|[ \t]+$/g, '').replace(/[ \t]+/g, ' '); }
// The backup copy of a replaced file, as a project-relative path, when the
// record names the file (under `modified` with its backup path, or under
// `removed` as a bare path whose copy sits at the same path in the backup
// folder) and that copy exists; null otherwise. C-10 reads it for lost lines,
// and C-6 words its advice by whether it exists, so the two never disagree.
function replacedBackup(P, migration, rel) {
  if (!migration) return null;
  const backupDir = safeRelPath(migration.backupDir);
  const backups = [];
  for (const m of Array.isArray(migration.modified) ? migration.modified : []) {
    if (!m || safeRelPath(m.rel) !== rel) continue;
    const b = safeRelPath(m.backup);
    if (b) backups.push(b); else if (backupDir) backups.push(backupDir + '/' + rel);
  }
  for (const r of Array.isArray(migration.removed) ? migration.removed : []) {
    if (safeRelPath(r) === rel && backupDir) backups.push(backupDir + '/' + rel);
  }
  return backups.find(b => isFile(P(b))) || null;
}
// For each replaced file whose backup copy exists: the backup's lines of the
// project's own that the live file lacks, as { rel, backup, lost }.
function lostProjectLines(P, migration, pluginRoot) {
  const out = [];
  if (!migration) return out;
  for (const file of REPLACED_ON_MIGRATION) {
    const backup = replacedBackup(P, migration, file.rel);
    if (!backup) continue;
    const known = new Set([...(readLines(path.join(pluginRoot, 'seed', file.seed)) || []), ...file.shipped, ...(readLines(P(file.rel)) || [])].map(lineKey));
    const lost = [];
    for (const line of readLines(P(backup)) || []) {
      const key = lineKey(line);
      if (key === '' || key.startsWith('#') || known.has(key) || lost.includes(key)) continue;
      lost.push(key);
    }
    if (lost.length) out.push({ rel: file.rel, backup, lost });
  }
  return out;
}

// The line of a "defaultMode" key in settings JSON, by where it sits: `top` for
// the root object, `permissions` for the permissions object, so a file carrying
// both points each finding at its own line. A small scan that tracks the key
// each open object sits under; the last key of a spelling wins, as in JSON.parse.
function defaultModeLines(text) {
  const out = {};
  const stack = [];
  const colon = /\s*:/y;
  let key = null;
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') line++;
    else if (ch === '"') {
      let j = i + 1;
      let s = '';
      while (j < text.length && text[j] !== '"') { if (text[j] === '\\') j++; s += text[j]; j++; }
      i = j;
      colon.lastIndex = j + 1;
      if (!colon.test(text)) continue;
      key = s;
      if (s !== 'defaultMode') continue;
      if (stack.length === 1) out.top = line;
      else if (stack.length === 2 && stack[1] === 'permissions') out.permissions = line;
    } else if (ch === '{') { stack.push(key); key = null; }
    else if (ch === '[') { stack.push('['); key = null; }
    else if (ch === '}' || ch === ']') { stack.pop(); key = null; }
    else if (ch === ',') key = null;
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pluginRoot = path.resolve(opts.pluginRoot || path.join(__dirname, '..'));
  const conventionsPath = opts.conventions || path.join(pluginRoot, 'skills', 'shared', 'conventions.md');
  const cwd = opts.project ? path.resolve(opts.project) : process.cwd();
  const project = git(['rev-parse', '--show-toplevel'], cwd) || cwd;
  const P = (rel) => path.join(project, rel);
  const toVersion = validVersion(readJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), {}).version);
  if (toVersion === null) { console.error('upgrade-audit: no usable version in ' + path.join(pluginRoot, '.claude-plugin', 'plugin.json')); process.exit(1); }
  const state = readJson(P(STATE_REL), null);
  if (opts.stamp) {
    // A stamp never lowers the record: a project audited (or set up) on a
    // newer plugin than this one keeps what it has. Only validated versions are
    // compared or printed.
    const recorded = state && typeof state === 'object' ? [validVersion(state.auditedVersion), validVersion(state.version)].filter(v => v !== null && compareVersions(v, toVersion) === 1) : [];
    if (recorded.length) {
      console.error('upgrade-audit: not stamping: ' + STATE_REL + ' already records ' + recorded[0] + ', newer than this plugin (' + toVersion + ')');
      return;
    }
    // The end of a clean /tk:upgrade: this project is now audited up to the
    // plugin version, so the next run's range starts here.
    const next = Object.assign({}, state || {}, { version: toVersion, auditedVersion: toVersion, auditedAt: new Date().toISOString() });
    fs.mkdirSync(path.dirname(P(STATE_REL)), { recursive: true });
    fs.writeFileSync(P(STATE_REL), JSON.stringify(next, null, 2) + '\n');
    console.error('upgrade-audit: stamped ' + STATE_REL + ' as audited up to ' + toVersion);
    return;
  }
  if (!fs.existsSync(conventionsPath)) { console.error('upgrade-audit: conventions file not found: ' + conventionsPath); process.exit(1); }
  if (opts.from && validVersion(opts.from) === null) { console.error('upgrade-audit: --from takes a version such as 7.0.0'); process.exit(1); }
  // A recorded value of the wrong shape is no usable start: every convention up
  // to the plugin version applies, as with no state file, and the value is
  // never printed.
  const recordedFrom = referenceVersion(state);
  const unusableRecord = !opts.from && recordedFrom === null && state !== null && ['auditedVersion', 'previousVersion', 'version'].some(k => typeof state[k] === 'string' && state[k].trim() !== '');
  const fromVersion = opts.from ? validVersion(opts.from) : recordedFrom;

  const all = parseConventions(fs.readFileSync(conventionsPath, 'utf8'));
  for (const c of all) if (validVersion(c.since) === null) { console.error('upgrade-audit: bad Since in ' + c.id); process.exit(1); }
  const afterFrom = (c) => fromVersion === null || compareVersions(c.since, fromVersion) > 0;
  const inRange = all.filter(c => (c.always || afterFrom(c)) && compareVersions(c.since, toVersion) <= 0);

  // Inventory: everything the project owns in the toolkit folders, plus CLAUDE.md.
  const promptFiles = [];
  for (const dir of PROJECT_PROMPT_DIRS) for (const rel of walkFiles(P(dir), dir, [])) if (rel !== SEED_RULES && /\.md$/.test(rel)) promptFiles.push(rel);
  const claudeMd = fs.existsSync(P('CLAUDE.md')) ? ['CLAUDE.md'] : [];
  const scopeFiles = { 'prompt-files': promptFiles, 'claude-md': claudeMd, 'prompt-files+claude-md': [...promptFiles, ...claudeMd] };
  const notes = [];
  // The shipped seed's retired permission rows (issue #173): `#` lines are comments.
  const retiredLines = readLines(path.join(pluginRoot, 'seed', 'retired-permission-rows.txt'));
  const retired = retiredLines === null ? null : new Set(retiredLines.filter(l => l !== '' && !l.startsWith('#')));
  const localExists = fs.existsSync(P(LOCAL_SETTINGS));
  const local = readJson(P(LOCAL_SETTINGS), null);
  const localAllow = (local && local.permissions && Array.isArray(local.permissions.allow) ? local.permissions.allow : []).filter(p => typeof p === 'string');
  // The copy-install migration's record, when it is a readable JSON object.
  // Missing or malformed, it is no record: nothing that reads it reports.
  const migRead = readJson(P(MIGRATION_REL), null);
  const migration = migRead && typeof migRead === 'object' && !Array.isArray(migRead) ? migRead : null;
  const migrationName = () => { const to = migration ? validVersion(migration.to) : null; return to ? 'the ' + to + ' migration' : 'the migration from the copy-install'; };

  const findings = [];
  const emit = (f) => findings.push(f);
  for (const c of inRange) {
    if (c.detector === 'regex') {
      const files = scopeFiles[c.scope] || [];
      for (const rel of files) {
        const lines = fs.readFileSync(P(rel), 'utf8').split(/\r?\n/);
        for (const pat of c.patterns) {
          let re; try { re = new RegExp(pat); } catch (e) { console.error('upgrade-audit: bad pattern in ' + c.id + ': ' + pat); process.exit(1); }
          lines.forEach((line, i) => {
            if (!re.test(line)) return;
            emit({ id: c.id, severity: 'warn', convention: c.title, file: { relPath: rel, line: i + 1 },
              what: 'Should fix. ' + rel + ' line ' + (i + 1) + ' is behind convention ' + c.id + ' (' + c.title + ').',
              fix: c.fix, since: c.since,
              receipt: { check: 'grep -n -E -e ' + shq(pat) + ' -- ' + shq(rel), expect: 'line ' + (i + 1) + ' matches: ' + line.trim().slice(0, 120) } });
          });
        }
      }
    } else if (c.detector === 'seed-stamp') {
      if (fs.existsSync(P(SEED_RULES))) {
        const m = /<!-- Toolkit version: ([^ |]+)/.exec(fs.readFileSync(P(SEED_RULES), 'utf8'));
        const stamped = m ? validVersion(m[1]) : null;
        if (stamped === null || compareVersions(stamped, toVersion) < 0) emit({ id: c.id, severity: 'warn', convention: c.title, file: { relPath: SEED_RULES, line: 3 },
          what: 'Should fix. The seeded rules file is stamped ' + (stamped || 'with no usable version') + ' while the plugin is ' + toVersion + '.',
          fix: c.fix || 'delete the rules file and run /tk:setup for a fresh seed, or merge the new seed text by hand and update the stamp', since: c.since,
          receipt: { check: 'grep -n -F -e ' + shq('Toolkit version') + ' -- ' + shq(SEED_RULES), expect: 'the stamp reads a version below ' + toVersion + ' (or no version)' } });
      }
    } else if (c.detector === 'dead-permissions') {
      const dead = localAllow.filter(p => deadPermission(p, (rel) => fs.existsSync(P(rel))));
      if (dead.length) emit({ id: c.id, severity: 'suggest', convention: c.title, file: { relPath: LOCAL_SETTINGS },
        what: 'Optional. ' + dead.length + ' permission entr' + (dead.length === 1 ? 'y points' : 'ies point') + ' at scripts the plugin no longer places in the project.',
        fix: c.fix || 'remove them; the plugin commands carry their own allowed-tools', since: c.since,
        fields: [{ label: 'Entries', value: dead.join(' ; ') }],
        receipt: { check: 'grep -n -F ' + dead.map(p => '-e ' + shq(JSON.stringify(p))).join(' ') + ' -- ' + LOCAL_SETTINGS, expect: dead.length + ' matching line(s), one per dead entry' } });
    } else if (c.detector === 'permission-rows') {
      if (localExists && local === null) { notes.push(c.id + ' skipped: ' + LOCAL_SETTINGS + ' is not readable JSON'); continue; }
      // (a) Toolkit rows the project lacks, filtered exactly as setup filters
      //     the seed before its merge, so re-running /tk:setup adds each one.
      const seed = readJson(path.join(pluginRoot, 'seed', 'settings.local.json'), null);
      if (seed === null) notes.push(c.id + ': no shipped seed settings under the plugin root, missing rows not checked');
      else {
        const seedAllow = (seed.permissions && Array.isArray(seed.permissions.allow) ? seed.permissions.allow : [])
          .filter(p => typeof p === 'string' && !deadPermission(p, (rel) => fs.existsSync(P(rel))));
        const missing = seedAllow.filter(p => !localAllow.includes(p));
        if (!localExists) emit({ id: c.id, severity: 'suggest', convention: c.title, file: { relPath: LOCAL_SETTINGS },
          what: 'Optional. The project has no ' + LOCAL_SETTINGS + ', so none of the toolkit\'s ' + seedAllow.length + ' permission rows are granted.',
          fix: 're-run /tk:setup, which writes the file from the shipped seed', since: c.since,
          receipt: { check: 'test -f ' + LOCAL_SETTINGS + ' && echo present || echo ' + shq('absent: ' + LOCAL_SETTINGS), expect: 'absent: ' + LOCAL_SETTINGS } });
        else if (missing.length) emit({ id: c.id, severity: 'suggest', convention: c.title, file: { relPath: LOCAL_SETTINGS },
          what: 'Optional. ' + LOCAL_SETTINGS + ' lacks ' + missing.length + ' permission row' + (missing.length === 1 ? '' : 's') + ' the shipped toolkit seed carries, so those steps ask for permission.',
          fix: 're-run /tk:setup, which merges the missing toolkit rows into ' + LOCAL_SETTINGS + ' and keeps every row of yours', since: c.since,
          fields: [{ label: 'Missing rows', value: missing.join(' ; ') }],
          receipt: { check: 'for r in ' + missing.map(p => shq(JSON.stringify(p))).join(' ') + '; do grep -q -F -e "$r" -- ' + LOCAL_SETTINGS + " || printf 'missing: %s\\n' \"$r\"; done",
            expect: missing.length + ' line(s) reading missing: <row>, one per toolkit row the file lacks' } });
      }
      // (b) Rows the shipped retired list names: maintainer-only grants, old
      //     copy-install script rows and unscoped Skill rows an older seed wrote.
      if (retired === null) notes.push(c.id + ': no retired-permission-rows.txt under the plugin root, retired rows not checked');
      else {
        // A retired Skill row naming a command, skill or agent the project owns
        // is the project's own grant (the same exemption C-11 makes), so it stays.
        const owned = new Set(piecesUnder(P('.claude')));
        const ownRow = (p) => { const m = /^Skill\(([a-z0-9-]+)(:\*)?\)$/.exec(p); return m !== null && owned.has(m[1]); };
        const still = localAllow.filter(p => retired.has(p) && !ownRow(p));
        if (still.length) emit({ id: c.id, severity: 'warn', convention: c.title, file: { relPath: LOCAL_SETTINGS },
          what: 'Should fix. ' + LOCAL_SETTINGS + ' still carries ' + still.length + ' permission row' + (still.length === 1 ? '' : 's') + ' the toolkit seed retired: grants for the toolkit\'s own repository or rows that no longer match anything.',
          fix: 'remove the listed rows from ' + LOCAL_SETTINGS + '; the current seed does not carry them and the plugin commands carry their own permissions', since: c.since,
          fields: [{ label: 'Retired rows', value: still.join(' ; ') }],
          receipt: { check: 'grep -n -F ' + still.map(p => '-e ' + shq(JSON.stringify(p))).join(' ') + ' -- ' + LOCAL_SETTINGS, expect: still.length + ' matching line(s), one per retired row' } });
      }
      // (c) acceptEdits: a question, never an auto-fix, worded for where the key
      //     sits. The 7.0.x seed wrote it at the top level, where Claude Code
      //     does not document it (defaultMode belongs under permissions), so it
      //     may never have taken effect; under permissions it auto-accepts every
      //     file edit, which a user may have chosen.
      const modeAt = [];
      if (local && local.defaultMode === 'acceptEdits') modeAt.push({ key: 'top',
        what: 'Optional. ' + LOCAL_SETTINGS + ' has a top-level "defaultMode": "acceptEdits", a leftover key an older toolkit seed wrote. Claude Code documents defaultMode under "permissions", so where it sits it may have no effect.',
        fix: 'a question for the user, never an auto-fix: ask whether to delete the leftover key, or move it under "permissions" if they want file edits auto-accepted; change nothing without their answer' });
      if (local && local.permissions && local.permissions.defaultMode === 'acceptEdits') modeAt.push({ key: 'permissions',
        what: 'Optional. ' + LOCAL_SETTINGS + ' sets "defaultMode": "acceptEdits" under "permissions", which auto-accepts every file edit without a prompt.',
        fix: 'a question for the user, never an auto-fix: ask whether auto-accepting file edits is wanted; remove the key only on their answer' });
      if (modeAt.length) {
        const lineOf = defaultModeLines(fs.readFileSync(P(LOCAL_SETTINGS), 'utf8'));
        for (const { key, what, fix } of modeAt) {
          const at = lineOf[key];
          emit({ id: c.id, severity: 'suggest', convention: c.title, file: Object.assign({ relPath: LOCAL_SETTINGS }, at ? { line: at } : {}),
            what, fix, since: c.since,
            receipt: { check: 'grep -n -E -e ' + shq('"defaultMode"[[:space:]]*:[[:space:]]*"acceptEdits"') + ' -- ' + LOCAL_SETTINGS, expect: 'the defaultMode line' + (at ? ' (line ' + at + ')' : '') } });
        }
      }
      // (d) Rows of the project's own a migration removed although their script
      //     stayed: 7.0.0 treated every .claude/scripts/ row as dead (7.0.1
      //     dropped one only when its script was gone), so a kept custom
      //     script lost its grant. The candidates are the rows
      //     in the migration's backup of settings.local.json (its backupDir,
      //     inside the project) and the record's deadPermissions list (7.0.x
      //     records carry the rows; a later one keeps only a count, so the
      //     backup is the source there). Nothing else is a source. A candidate
      //     is reported only when the live file has it in no permissions list
      //     (a row the user moved to deny or ask stays where they put it), it
      //     names a file under this project's .claude/scripts/ that exists now,
      //     the retired list does not name it, and setup would not remove it
      //     again as dead. The rows may carry this machine's absolute paths, so
      //     they appear only inside this project's own finding, never in a note.
      if (migration) {
        if (retired === null) notes.push(c.id + ': no retired-permission-rows.txt under the plugin root, rows a migration removed not checked');
        else {
          const backupDir = safeRelPath(migration.backupDir);
          const backupLocal = backupDir ? readJson(P(backupDir + '/' + LOCAL_SETTINGS), null) : null;
          const backupAllow = backupLocal && backupLocal.permissions && Array.isArray(backupLocal.permissions.allow) ? backupLocal.permissions.allow : [];
          const recorded = Array.isArray(migration.deadPermissions) ? migration.deadPermissions : [];
          const inLive = new Set(['allow', 'deny', 'ask'].flatMap(k => (local && local.permissions && Array.isArray(local.permissions[k]) ? local.permissions[k] : [])));
          const exists = (rel) => fs.existsSync(P(rel));
          const lostRows = [];
          for (const row of new Set(backupAllow.concat(recorded).filter(p => typeof p === 'string'))) {
            const rel = rowScriptRel(row, project);
            if (rel === null || inLive.has(row) || !isFile(P(rel)) || retired.has(row) || deadPermission(row, exists)) continue;
            lostRows.push({ row, rel });
          }
          const n = lostRows.length;
          // Where the rows can still be read, named only for the source that
          // holds them: the backup copy only for rows it has (it may be gone,
          // or lack a row the record lists), the record for the rest.
          const inBackup = new Set(backupAllow);
          const fromBackup = lostRows.filter(x => inBackup.has(x.row)).length;
          const recordOnly = n - fromBackup;
          const them = (k) => (k === 1 ? 'it' : 'them');
          const source = !recordOnly ? 'the migration\'s backup copy of ' + LOCAL_SETTINGS + ' still has ' + them(n)
            : !fromBackup ? 'the migration record ' + MIGRATION_REL + ' lists ' + them(n)
              : 'the migration\'s backup copy of ' + LOCAL_SETTINGS + ' still has ' + fromBackup + ' of them, and the migration record ' + MIGRATION_REL + ' lists the other ' + recordOnly;
          if (n) emit({ id: c.id, severity: 'warn', convention: c.title, file: { relPath: LOCAL_SETTINGS },
            what: 'Should fix. ' + LOCAL_SETTINGS + ' lost ' + (n === 1 ? 'a permission row' : n + ' permission rows') + ' of the project\'s own: ' + migrationName() + ' removed '
              + (n === 1 ? 'it although the script it runs is' : 'them although the script each one runs is') + ' still in the project, so running ' + (n === 1 ? 'that script asks' : 'those scripts ask') + ' for permission again.',
            fix: 'add each listed row back to "permissions.allow" in ' + LOCAL_SETTINGS + ', exactly as listed (' + source + '); leave every other row as it is', since: c.since,
            fields: [{ label: 'Lost rows', value: lostRows.map(x => x.row).join(' ; ') }],
            receipt: { check: lostRows.map(x => 'if test -f ' + shq(x.rel) + ' && ! grep -q -F -e ' + shq(JSON.stringify(x.row)) + ' -- ' + LOCAL_SETTINGS + " 2>/dev/null; then printf 'restorable: %s\\n' " + shq(x.row) + '; fi').join(' ; '),
              expect: n + ' line(s) reading restorable: <row>, one per lost row whose script file exists and which ' + LOCAL_SETTINGS + ' lacks' } });
        }
      }
    } else if (c.detector === 'seed-lines') {
      let keeps = null;
      const ctx = { keepsScripts: () => (keeps === null ? (keeps = hasFilesUnder(P('.claude/scripts'))) : keeps) };
      for (const sf of STALE_SEED_FILES) {
        const lines = readLines(P(sf.rel));
        if (lines === null) continue;
        const seedLines = readLines(path.join(pluginRoot, 'seed', sf.seed));
        const harmful = sf.harmful ? sf.harmful(lines) : new Map();
        const lastFileLevel = [...harmful].filter(([, level]) => level === 'file').map(([i]) => i).pop();
        const NEGATION = '!' + STATE_REL;
        lines.forEach((line, i) => {
          if (line.trim() === '' || !(sf.stale(line, ctx) || harmful.has(i))) return;
          const receipt = { check: 'grep -n -F -e ' + shq(line.trim()) + ' -- ' + shq(sf.rel), expect: 'line ' + (i + 1) + ' matches: ' + line.trim().slice(0, 120) };
          if (harmful.has(i)) {
            // A line that ignores the state file may be the user's own broad
            // pattern (.claude/, *.json), so it is never deleted: deleting it
            // would un-ignore everything else it covers. A pattern that
            // matches the file is kept with a negation after it; one that
            // matches the .claude folder cannot be negated (git never
            // re-includes a file inside an ignored folder), so it is a question.
            const dir = harmful.get(i) === 'dir';
            emit({ id: c.id, severity: 'warn', convention: c.title, file: { relPath: sf.rel, line: i + 1 },
              what: 'Should fix. ' + sf.rel + ' line ' + (i + 1) + ' ignores ' + (dir ? 'the whole .claude folder, and with it ' : '') + STATE_REL + ', the state file the version guard and /tk:upgrade read, so it never reaches collaborators.',
              fix: dir
                ? 'a question for the user, never an auto-fix: git cannot re-include a file inside an ignored folder, so ask how they want the line narrowed (for `.claude/`, `.claude/*` keeps everything inside ignored) with `' + NEGATION + '` on a line after it; never delete the line'
                : 'keep the line and add `' + NEGATION + '` on a line after ' + (i === lastFileLevel ? 'it' : 'line ' + (lastFileLevel + 1) + ', the last line that ignores the state file') + ', which re-includes only the state file; never delete the line, which would un-ignore everything else it covers',
              since: c.since, fields: [{ label: 'Negation line', value: NEGATION }], receipt });
            return;
          }
          const replacement = seedReplacement(line, seedLines);
          emit({ id: c.id, severity: 'suggest', convention: c.title, file: { relPath: sf.rel, line: i + 1 },
            what: 'Optional. ' + sf.rel + ' line ' + (i + 1) + ' is a line an older toolkit seed wrote that names the copy-install layout.',
            fix: replacement ? 'replace the line with the shipped seed\'s line (Seed line below)' : 'delete the line: the shipped seed has no line in its place', since: c.since,
            fields: replacement ? [{ label: 'Seed line', value: replacement.trim() }] : undefined,
            receipt });
        });
      }
      // Lines of the project's own a 7.0.x migration dropped from a file it
      // replaced (a Git LFS rule in .gitattributes, say), still in the backup.
      // The receipt prints one `lost:` line per listed line that the backup
      // copy has and the live file lacks, both read as lineKey reads them (CR
      // dropped, a leading byte order mark dropped, blanks collapsed); a
      // missing live file lacks every line. stderr is redirected before the
      // input, so a missing file prints no shell error.
      for (const { rel, backup, lost } of lostProjectLines(P, migration, pluginRoot)) {
        const n = lost.length;
        const norm = (file) => "tr -d '\\r' 2>/dev/null < " + shq(file) + " | awk -v b=\"$b\" 'index($0, b) == 1 { $0 = substr($0, length(b) + 1) } { $1 = $1; print }' | grep -q -x -F -e \"$l\"";
        emit({ id: c.id, severity: 'warn', convention: c.title, file: { relPath: rel },
          what: 'Should fix. ' + rel + ' lost ' + (n === 1 ? 'a line' : n + ' lines') + ' of the project\'s own: ' + migrationName() + ' replaced the file with the toolkit seed and dropped '
            + (n === 1 ? 'it' : 'them') + '; the backup copy ' + backup + ' still has ' + (n === 1 ? 'it' : 'them') + '.',
          fix: 'append the listed line' + (n === 1 ? '' : 's') + ' back to ' + rel + ', exactly as listed; keep every line the file has now', since: c.since,
          fields: [{ label: 'Lost lines', value: lost.join(' ; ') }, { label: 'Backup copy', value: backup }],
          receipt: { check: "b=$(printf '\\357\\273\\277'); for l in " + lost.map(shq).join(' ') + '; do if ' + norm(backup) + ' && ! { ' + norm(rel) + '; }; then printf \'lost: %s\\n\' "$l"; fi; done',
            expect: n + ' line(s) reading lost: <line>, one per listed line the backup copy has and ' + rel + ' lacks' } });
      }
      // A migration record git still tracks. A 7.0.x migration wrote the record
      // and projects committed it; 7.0.0 and 7.0.1 records list the permission
      // rows the migration removed, some with this machine's absolute paths, so
      // every later commit of the file carries them. 7.1.0's seed gitignores the
      // record, but ignoring a file never untracks one git already has. Git
      // itself decides (not a git repository, or no git at all: git() returns
      // null and nothing is reported), and the finding names only counts from
      // the record, never a row. The lost-row and lost-line checks read the
      // record from disk, so untracking it changes neither.
      const tracked = git(['ls-files', '--error-unmatch', '--', MIGRATION_REL], project);
      if (tracked !== null && tracked.split(/\r?\n/).includes(MIGRATION_REL)) {
        const rows = migration && Array.isArray(migration.deadPermissions) ? migration.deadPermissions.filter(p => typeof p === 'string') : null;
        const absolute = rows ? rows.filter(p => ABSOLUTE_IN_ROW.test(p)).length : 0;
        // Split the way the other C-10 findings split: a copy that spreads this
        // machine's paths through every commit does harm (warn); a copy in the
        // count format, or with no absolute path, is only clutter (suggest).
        const warn = absolute > 0;
        // check-ignore --no-index judges the ignore rules even for a tracked
        // file, so the fix never asks for a line the project already carries.
        // Only a .gitignore reaches collaborators: .git/info/exclude and a
        // global excludes file (core.excludesFile) stay on this machine, so a
        // match counts only when its source is a .gitignore in the record's
        // own folder or one above it inside the work tree. Verbose output is
        // `source:line:pattern<TAB>path`, the source relative to the top level
        // (an absolute or ../ path for a file outside the work tree), and it
        // also prints a winning `!` negation, which does not ignore the file.
        const why = git(['check-ignore', '-v', '--no-index', '--', MIGRATION_REL], project);
        const m = why === null ? null : /^(.*?):(\d+):(.*)\t/.exec(why.split(/\r?\n/)[0]);
        const full = (git(['rev-parse', '--show-prefix'], project) || '') + MIGRATION_REL;
        const byGitignore = !!m && !m[3].startsWith('!') && (m[1] === '.gitignore'
          || (m[1].endsWith('/.gitignore') && full.startsWith(m[1].slice(0, -'.gitignore'.length))));
        const ignoredElsewhere = !!m && !m[3].startsWith('!') && !byGitignore;
        // (A source git quotes, for unusual characters, never matches: the fix
        // then asks for the seed line, which is harmless when already present.)
        const holds = rows === null
          ? (migration ? ' This copy holds no permission rows.' : '')
          : ' This copy lists ' + (rows.length === 1 ? '1 permission row' : rows.length + ' permission rows') + ', '
            + (absolute === 0 ? 'none with an absolute path' : absolute + (rows.length === 1 ? '' : ' of them') + ' with an absolute path on this machine') + '.';
        emit({ id: c.id, severity: warn ? 'warn' : 'suggest', convention: c.title, file: { relPath: MIGRATION_REL },
          what: (warn ? 'Should fix. ' : 'Optional. ') + 'The migration record ' + MIGRATION_REL + ' is committed to git. It only matters on this machine (it pairs with the migration\'s backup folder, which git ignores), and older versions of it list this machine\'s permission rows, which every commit of the file would share.' + holds,
          fix: 'stop tracking the record and keep the file: run `git rm --cached ' + MIGRATION_REL + '` from the project root (the file stays on disk); '
            + (byGitignore
              ? m[1] + ' line ' + m[2] + ' already ignores the file, so it stays out of later commits'
              : 'add the seed\'s line `' + MIGRATION_REL + '` to .gitignore (re-running /tk:setup merges it) so it stays out of later commits'
                + (ignoredElsewhere ? ' for every collaborator (git ignores it here only through this machine\'s own settings, .git/info/exclude or a global excludes file, which collaborators never get)' : ''))
            + '. Earlier commits keep their copy of the file; rewriting git history to remove it is a separate step the owner decides, never part of this fix.',
          since: c.since, fields: [{ label: 'Command', value: 'git rm --cached ' + MIGRATION_REL }],
          receipt: { check: 'git ls-files --error-unmatch -- ' + shq(MIGRATION_REL), expect: 'one line, ' + MIGRATION_REL + ', which git prints only because it tracks the file' } });
      }
    } else if (c.detector === 'unscoped-names') {
      const owned = new Set(piecesUnder(P('.claude')));
      const names = piecesUnder(pluginRoot).filter(n => !owned.has(n));
      if (!names.length) { notes.push(c.id + ': no command, skill or agent names under the plugin root'); continue; }
      const matchers = unscopedMatchers(names);
      for (const rel of scopeFiles['prompt-files+claude-md']) {
        const lines = fs.readFileSync(P(rel), 'utf8').split(/\r?\n/);
        lines.forEach((line, i) => {
          const tokens = unscopedTokens(line, matchers);
          if (!tokens.length) return;
          emit({ id: c.id, severity: 'warn', convention: c.title, file: { relPath: rel, line: i + 1 },
            what: 'Should fix. ' + rel + ' line ' + (i + 1) + ' names a toolkit piece without the tk: scope (' + tokens.map(t => t.show).join(', ') + '), which does not resolve under the plugin.',
            fix: c.fix || 'scope the name with tk:', since: c.since,
            receipt: { check: 'grep -n -F ' + tokens.map(t => '-e ' + shq(t.grep)).join(' ') + ' -- ' + shq(rel), expect: 'line ' + (i + 1) + ' matches: ' + line.trim().slice(0, 120) } });
        });
      }
      // Bare Skill rows in the permissions list never match a tk: skill. A row
      // the retired list names is left to the permission-rows convention, whose
      // fix removes it.
      const nameSet = new Set(names);
      const bare = localAllow.filter(p => { const m = /^Skill\(([a-z0-9-]+)(:\*)?\)$/.exec(p); return m !== null && nameSet.has(m[1]) && !(retired && retired.has(p)); });
      if (bare.length) emit({ id: c.id, severity: 'warn', convention: c.title, file: { relPath: LOCAL_SETTINGS },
        what: 'Should fix. ' + LOCAL_SETTINGS + ' carries ' + bare.length + ' Skill permission row' + (bare.length === 1 ? '' : 's') + ' without the tk: scope, which never match a plugin skill.',
        fix: 'scope each row with tk: (Skill(tk:<name>)), or drop it when the tk: row is already in the list', since: c.since,
        fields: [{ label: 'Rows', value: bare.join(' ; ') }],
        receipt: { check: 'grep -n -F ' + bare.map(p => '-e ' + shq(JSON.stringify(p))).join(' ') + ' -- ' + LOCAL_SETTINGS, expect: bare.length + ' matching line(s), one per unscoped row' } });
    } else if (c.detector === 'agent-tools') {
      const ROLE = /finder|review|critic|skeptic|verif|judge|audit/i;
      for (const rel of promptFiles.filter(r => r.startsWith('.claude/agents/'))) {
        const text = fs.readFileSync(P(rel), 'utf8');
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
        const head = fm ? fm[1].split(/\r?\n/) : [];
        const field = (k) => { const m = head.find(l => new RegExp('^' + k + ':').test(l)); return m ? m.replace(new RegExp('^' + k + ':'), '').trim() : ''; };
        const role = (field('name') || path.basename(rel, '.md')) + ' ' + field('description');
        if (!ROLE.test(role)) continue;
        const toolsIdx = head.findIndex(l => /^tools:/.test(l));
        let tools = '';
        if (toolsIdx >= 0) { tools = head[toolsIdx].replace(/^tools:/, '').trim(); for (let i = toolsIdx + 1; i < head.length && /^\s+-\s/.test(head[i]); i++) tools += ' ' + head[i].replace(/^\s+-\s*/, ''); }
        const edits = tools.split(/[\s,]+/).filter(t => /^(Edit|Write|NotebookEdit)$/.test(t));
        if (toolsIdx >= 0 && !edits.length) continue;
        // The receipt accepts the shapes the detector does: any indent before a
        // list item, trailing blanks, and CRLF line endings ([[:space:]] takes the CR).
        emit({ id: c.id, severity: 'warn', convention: c.title, file: { relPath: rel, line: toolsIdx >= 0 ? toolsIdx + 2 : 1 },
          what: 'Should fix. ' + rel + (toolsIdx >= 0 ? ' grants ' + edits.join(', ') + ' to a finder or judge role, so it can change files before any audit judges its output.' : ' declares no tools list, so its finder or judge role gets every tool, Edit included.'),
          fix: c.fix || 'declare tools: Read, Grep, Glob (Bash only for read-only checks); a finder or judge never edits', since: c.since,
          receipt: toolsIdx >= 0
            ? { check: 'grep -n -E -e ' + shq('^tools:|^[[:space:]]+-[[:space:]]+(Edit|Write|NotebookEdit)[[:space:]]*$') + ' -- ' + shq(rel), expect: 'an edit tool appears in the tools list' }
            : { check: 'awk ' + shq('NR==1 && !/^---/ {exit} NR>1 && /^---/ {exit} {print NR": "$0}') + ' ' + shq(rel), expect: 'the frontmatter lines, none of them a tools: line' } });
      }
    } else if (c.detector === 'local-edits') {
      // The evidence of a local edit is the copy-install's own record: the
      // migration file lists the path, and the manifest the old installer wrote
      // (kept in the backup folder) holds the hash it installed, which the
      // backup copy no longer matches. The current plugin copy is never the
      // base: it also carries every toolkit change since that install.
      const mig = migration;
      const from = validVersion(mig && mig.from) || validVersion(state && state.previousVersion);
      const backupDir = mig ? safeRelPath(mig.backupDir) : null;
      const manifestBackup = backupDir ? backupDir + '/' + MANIFEST_REL : null;
      let skipped = 0;
      for (const m of (mig && Array.isArray(mig.modified) ? mig.modified : [])) {
        const rel = m ? safeRelPath(m.rel) : null;
        if (rel === null) { skipped++; continue; }
        const backup = safeRelPath(m.backup);
        const tagged = from ? TOOLKIT_REPO_URL + '/blob/v' + from + '/' + rel : null;
        // The record and the manifest hold the path as it was written, so the
        // greps look for that spelling as it sits in a JSON file (a Windows
        // backslash doubled); the backup file itself is opened by its
        // normalized path, which bash takes on every platform.
        const recorded = JSON.stringify(m.rel).slice(1, -1);
        const checks = ['grep -n -F -e ' + shq(recorded) + ' -- ' + MIGRATION_REL];
        const hashes = backup && manifestBackup && fs.existsSync(P(backup)) && fs.existsSync(P(manifestBackup));
        if (hashes) {
          checks.push('grep -n -F -e ' + shq('"' + recorded + '": "') + ' -- ' + shq(manifestBackup));
          checks.push("tr -d '\\r' < " + shq(backup) + ' | { sha256sum 2>/dev/null || shasum -a 256; }');
        }
        // The convention's fix and the tagged base are two sentences.
        const baseFix = c.fix || 'compare your backup with the toolkit file at the tag it came from, never with the current plugin copy';
        const where = from ? 'the ' + from + ' copy-install' : 'a copy-install';
        // A file C-10 checks for lost lines (REPLACED_ON_MIGRATION, today only
        // .gitattributes) is not a toolkit script: the plugin ships no copy of
        // it (setup records its pluginCopy as null), it belongs to the project,
        // and a 7.0.x migration replaced it with the toolkit seed. "File it
        // upstream or carry it as a project-owned script" is wrong advice there,
        // so its fix says whose file it is and claims only what was checked.
        // With the backup copy, C-10 compared it line by line: the fix names how
        // many lines C-10 lists to put back, or says it found none and what it
        // does not count. Without the backup copy nothing was compared, so the
        // fix says the toolkit cannot tell and asks the user to check. The
        // finding is reworded rather than suppressed in favour of C-10, which
        // lists only lines still missing, so the record's evidence stays in the
        // audit either way. Every other entry (artifacts/README.md, VERSION,
        // anything under .claude/) has no line-level check behind it, so it
        // keeps the convention's advice and its tagged base unchanged.
        const replaced = REPLACED_ON_MIGRATION.find(x => x.rel === rel);
        const replacedCopy = replaced ? replacedBackup(P, migration, rel) : null;
        let ownFix = null;
        if (replaced) {
          const head = rel + ' belongs to the project, not the toolkit, so nothing goes upstream and nothing is carried as a script: the migration replaced it with the toolkit seed';
          const found = replacedCopy ? lostProjectLines(P, migration, pluginRoot).find(x => x.rel === rel) : null;
          const k = found ? found.lost.length : 0;
          ownFix = !replacedCopy
            ? head + ', and its backup copy is gone, so the toolkit cannot tell which lines were the project\'s. Ask the user to check whether a rule of theirs (a Git LFS line, for example) is missing from ' + rel + ', and add back any they name.'
            : k
              ? head + ' and dropped ' + (k === 1 ? 'a line' : k + ' lines') + ' of yours that the backup copy ' + replacedCopy + ' still has. Append back the ' + (k === 1 ? 'line' : k + ' lines') + ' the C-10 finding for ' + rel + ' lists.'
              : head + '. C-10 compared the backup copy ' + replacedCopy + ' with the live file and lists no line to put back: every line of the backup copy is blank, a comment, or already in the live file, the shipped seed, or a copy of the file an earlier toolkit release shipped.';
        }
        emit({ id: c.id, severity: 'warn', convention: c.title, file: { relPath: rel },
          what: 'Should fix. ' + rel + (replaced ? ', a file of the project\'s own, carried a local edit the toolkit seed replaced during the migration from ' : ' carried a local edit the plugin copy replaced during the migration from ') + where + '.',
          fix: replaced ? ownFix : tagged ? baseFix.replace(/[.\s]+$/, '') + '. Base for your backup: ' + tagged : baseFix, since: c.since,
          fields: [{ label: 'Your copy', value: backup || '(no backup recorded)' },
            { label: 'Toolkit copy it came from', value: tagged || '(no usable copy-install version recorded)' }],
          receipt: { check: checks.join(' ; '),
            expect: hashes ? 'the migration record lists the file; the manifest line holds the hash the copy-install wrote, and the hash of your backup copy printed after it differs, which is the local edit'
              : 'the migration record lists the file as locally modified' } });
      }
      if (skipped) notes.push(c.id + ': skipped ' + skipped + ' migration record(s) whose path is not a plain project path');
    }
  }
  for (const f of findings) process.stdout.write(JSON.stringify(f) + '\n');
  const start = fromVersion || (unusableRecord ? 'start (the recorded version is unusable)' : 'start');
  for (const n of notes) console.error('upgrade-audit: ' + n);
  console.error('upgrade-audit: ' + findings.length + ' candidate finding(s); ' + inRange.length + ' of ' + all.length + ' convention(s) in range ' + start + ' -> ' + toVersion + (inRange.length ? ' [' + inRange.map(c => c.id).join(', ') + ']' : '') + '; ' + promptFiles.length + ' project-owned prompt file(s)');
}

main();
