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
// `defaultMode` of acceptEdits as a question for the user), seed-lines finds
// lines an older seed wrote into .gitattributes, .gitignore and
// artifacts/README.md, unscoped-names finds toolkit command, skill and agent
// names used without the tk: scope, local-edits reads
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
// script's row is live (review of the v7.0.0 release, R2).
const LEGACY_DEAD_PERMISSION = [
  /^Bash\((echo|cat) \* \| node \/[^)]*\/(\.claude\/)?scripts\/browse\.js \*\)$/,
  /^Skill\(review-commands(:\*)?\)$/,
];
function deadPermission(row, exists) {
  if (LEGACY_DEAD_PERMISSION.some(re => re.test(row))) return true;
  const m = /(?:^|[\s(])\.claude\/scripts\/([^\s)'"*]+)/.exec(row);
  return m !== null && !exists('.claude/scripts/' + m[1]);
}
// Single-quote a string for a POSIX shell, so a receipt can name rows verbatim.
function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
// A project-relative path from a record the project controls (the migration
// file): plain path characters only, no absolute path, no `..` segment. Anything
// else is skipped rather than echoed into a finding.
function safeRel(p) {
  return typeof p === 'string' && p.length <= 400 && /^[A-Za-z0-9._@+-]+(\/[A-Za-z0-9._@+-]+)*$/.test(p) && !p.split('/').includes('..');
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
const STALE_SEED_FILES = [
  { rel: '.gitattributes', seed: 'gitattributes', stale: (l) => l.includes('.claude/scripts/') },
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
        const still = localAllow.filter(p => retired.has(p));
        if (still.length) emit({ id: c.id, severity: 'warn', convention: c.title, file: { relPath: LOCAL_SETTINGS },
          what: 'Should fix. ' + LOCAL_SETTINGS + ' still carries ' + still.length + ' permission row' + (still.length === 1 ? '' : 's') + ' the toolkit seed retired: grants for the toolkit\'s own repository or rows that no longer match anything.',
          fix: 'remove the listed rows from ' + LOCAL_SETTINGS + '; the current seed does not carry them and the plugin commands carry their own permissions', since: c.since,
          fields: [{ label: 'Retired rows', value: still.join(' ; ') }],
          receipt: { check: 'grep -n -F ' + still.map(p => '-e ' + shq(JSON.stringify(p))).join(' ') + ' -- ' + LOCAL_SETTINGS, expect: still.length + ' matching line(s), one per retired row' } });
      }
      // (c) acceptEdits: the 7.0.x seed set it, but a user may have chosen it,
      //     so it is a question, never an auto-fix.
      if (local && (local.defaultMode === 'acceptEdits' || (local.permissions && local.permissions.defaultMode === 'acceptEdits'))) {
        const lines = readLines(P(LOCAL_SETTINGS)) || [];
        const at = lines.findIndex(l => /"defaultMode"\s*:\s*"acceptEdits"/.test(l));
        emit({ id: c.id, severity: 'suggest', convention: c.title, file: Object.assign({ relPath: LOCAL_SETTINGS }, at >= 0 ? { line: at + 1 } : {}),
          what: 'Optional. ' + LOCAL_SETTINGS + ' sets "defaultMode": "acceptEdits", which the 7.0.x seed wrote and the current seed does not: every file edit is accepted without a prompt.',
          fix: 'a question for the user, never an auto-fix: ask whether they chose acceptEdits themselves; remove the key only on their answer', since: c.since,
          receipt: { check: 'grep -n -E -e ' + shq('"defaultMode"[[:space:]]*:[[:space:]]*"acceptEdits"') + ' -- ' + LOCAL_SETTINGS, expect: 'the defaultMode line' + (at >= 0 ? ' (line ' + (at + 1) + ')' : '') } });
      }
    } else if (c.detector === 'seed-lines') {
      for (const sf of STALE_SEED_FILES) {
        const lines = readLines(P(sf.rel));
        if (lines === null) continue;
        const seedLines = readLines(path.join(pluginRoot, 'seed', sf.seed));
        const harmful = sf.harmful ? sf.harmful(lines) : new Map();
        const lastFileLevel = [...harmful].filter(([, level]) => level === 'file').map(([i]) => i).pop();
        const NEGATION = '!' + STATE_REL;
        lines.forEach((line, i) => {
          if (line.trim() === '' || !(sf.stale(line) || harmful.has(i))) return;
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
      const mig = readJson(P(MIGRATION_REL), null);
      const from = validVersion(mig && mig.from) || validVersion(state && state.previousVersion);
      const backupDir = mig && safeRel(mig.backupDir) ? mig.backupDir : null;
      const manifestBackup = backupDir ? backupDir + '/' + MANIFEST_REL : null;
      let skipped = 0;
      for (const m of (mig && Array.isArray(mig.modified) ? mig.modified : [])) {
        if (!m || !safeRel(m.rel)) { skipped++; continue; }
        const backup = safeRel(m.backup) ? m.backup : null;
        const tagged = from ? TOOLKIT_REPO_URL + '/blob/v' + from + '/' + m.rel : null;
        const checks = ['grep -n -F -e ' + shq(m.rel) + ' -- ' + MIGRATION_REL];
        const hashes = backup && manifestBackup && fs.existsSync(P(backup)) && fs.existsSync(P(manifestBackup));
        if (hashes) {
          checks.push('grep -n -F -e ' + shq('"' + m.rel + '": "') + ' -- ' + shq(manifestBackup));
          checks.push("tr -d '\\r' < " + shq(backup) + ' | { sha256sum 2>/dev/null || shasum -a 256; }');
        }
        emit({ id: c.id, severity: 'warn', convention: c.title, file: { relPath: m.rel },
          what: 'Should fix. ' + m.rel + ' carried a local edit the plugin copy replaced during the migration from ' + (from ? 'the ' + from + ' copy-install' : 'a copy-install') + '.',
          fix: (c.fix || 'compare your backup with the toolkit file at the tag it came from, never with the current plugin copy') + (tagged ? ' Base for your backup: ' + tagged : ''), since: c.since,
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
