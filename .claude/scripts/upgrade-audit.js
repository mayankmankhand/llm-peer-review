#!/usr/bin/env node
'use strict';
// upgrade-audit.js - the deterministic half of /tk:upgrade (issue #167, Step 6).
//
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade-audit.js [--project <dir>]
//        [--plugin-root <dir>] [--conventions <file>] [--from <version>]
//
// Reads the conventions document (the plugin's skills/shared/conventions.md by
// default), selects every convention whose `Since` version lies in the range
// (installed, current], inventories the files the PROJECT owns (everything
// under .claude/commands, agents, skills and rules, plus CLAUDE.md - the
// plugin's own files never sit in the project), runs each convention's
// detector over its scope, and prints one candidate finding per line as JSONL
// on stdout. Each finding carries a runnable receipt, so the /tk:upgrade skill
// can hand them straight to the M2 audit. A one-line summary goes to stderr.
//
// The installed version comes from .claude/.toolkit-state.json (written by
// setup-project.js on both install paths and advanced by /tk:upgrade on a clean
// finish); --from overrides it; with neither, every convention applies.
//
// Convention format (one section each, parsed here and written by hand there):
//
//   ### C-12: Criteria reach a worker by preload, not by paste
//   - **Since:** 7.0.0
//   - **Scope:** prompt-files            (prompt-files | claude-md | settings-local | seed-stamp | local-edits)
//   - **Detector:** regex                (regex | seed-stamp | dead-permissions | local-edits)
//   - **Looks behind:** `PASTE THE SKILL'S REVIEW CRITERIA`
//   - **Looks behind:** `subagent_type=(tk:)?review-finder`
//   - **Fix:** dispatch the typed finder for the kind; move any pasted criteria into a skill it preloads
//
// `Looks behind` may repeat; each backticked value is a JavaScript regular
// expression applied per line. The three non-regex detectors need no pattern:
// seed-stamp compares the seeded rules file's version stamp with the plugin
// version, dead-permissions lists settings.local.json entries that point at
// removed scripts, local-edits reads .claude/.toolkit-migration.json.
//
// Exit codes: 0 (findings are data, zero is a valid count), 1 on error.
// Dependency-free, like every script under .claude/scripts/.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_PROMPT_DIRS = ['.claude/commands', '.claude/agents', '.claude/skills', '.claude/rules'];
const SEED_RULES = '.claude/rules/toolkit.md';
const STATE_REL = '.claude/.toolkit-state.json';
const MIGRATION_REL = '.claude/.toolkit-migration.json';
const DEAD_PERMISSION = [
  /\.claude\/scripts\//,
  /^Bash\((echo|cat) \* \| node \/[^)]*\/(\.claude\/)?scripts\/browse\.js \*\)$/,
  /^Skill\(review-commands(:\*)?\)$/,
];

function parseArgs(argv) {
  const o = { project: '', pluginRoot: '', conventions: '', from: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') o.project = argv[++i];
    else if (a === '--plugin-root') o.pluginRoot = argv[++i];
    else if (a === '--conventions') o.conventions = argv[++i];
    else if (a === '--from') o.from = argv[++i];
    else { console.error('upgrade-audit: unknown argument ' + a); process.exit(1); }
  }
  return o;
}
function git(args, cwd) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return null; }
}
function readJson(abs, fallback) { try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { return fallback; } }
function semver(v) { return String(v || '0.0.0').split('.').map(n => parseInt(n, 10) || 0); }
function cmp(a, b) { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1; } return 0; }

function parseConventions(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const h = /^###\s+(C-\d+):\s*(.+?)\s*$/.exec(raw);
    if (h) { cur = { id: h[1], title: h[2], since: '0.0.0', scope: 'prompt-files', detector: 'regex', patterns: [], fix: '' }; out.push(cur); continue; }
    if (!cur) continue;
    const b = /^-\s+\*\*([A-Za-z ]+):\*\*\s*(.*)$/.exec(raw);
    if (!b) continue;
    const key = b[1].toLowerCase().trim(); const val = b[2].trim();
    if (key === 'since') cur.since = val;
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

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pluginRoot = path.resolve(opts.pluginRoot || path.join(__dirname, '..'));
  const conventionsPath = opts.conventions || path.join(pluginRoot, 'skills', 'shared', 'conventions.md');
  const cwd = opts.project ? path.resolve(opts.project) : process.cwd();
  const project = git(['rev-parse', '--show-toplevel'], cwd) || cwd;
  const P = (rel) => path.join(project, rel);
  if (!fs.existsSync(conventionsPath)) { console.error('upgrade-audit: conventions file not found: ' + conventionsPath); process.exit(1); }
  const toVersion = readJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), {}).version || '0.0.0';
  const state = readJson(P(STATE_REL), null);
  const fromVersion = opts.from || (state && state.version) || null;

  const all = parseConventions(fs.readFileSync(conventionsPath, 'utf8'));
  const inRange = all.filter(c => (fromVersion === null || cmp(c.since, fromVersion) > 0) && cmp(c.since, toVersion) <= 0);

  // Inventory: everything the project owns in the toolkit folders, plus CLAUDE.md.
  const promptFiles = [];
  for (const dir of PROJECT_PROMPT_DIRS) for (const rel of walkFiles(P(dir), dir, [])) if (rel !== SEED_RULES && /\.md$/.test(rel)) promptFiles.push(rel);
  const claudeMd = fs.existsSync(P('CLAUDE.md')) ? ['CLAUDE.md'] : [];
  const scopeFiles = { 'prompt-files': promptFiles, 'claude-md': claudeMd };

  const findings = [];
  const emit = (f) => findings.push(f);
  for (const c of inRange) {
    if (c.detector === 'regex') {
      const files = c.scope === 'prompt-files+claude-md' ? [...promptFiles, ...claudeMd] : (scopeFiles[c.scope] || []);
      for (const rel of files) {
        const lines = fs.readFileSync(P(rel), 'utf8').split(/\r?\n/);
        for (const pat of c.patterns) {
          let re; try { re = new RegExp(pat); } catch (e) { console.error('upgrade-audit: bad pattern in ' + c.id + ': ' + pat); process.exit(1); }
          lines.forEach((line, i) => {
            if (!re.test(line)) return;
            emit({ id: c.id, severity: 'warn', convention: c.title, file: { relPath: rel, line: i + 1 },
              what: 'Should fix. ' + rel + ' line ' + (i + 1) + ' is behind convention ' + c.id + ' (' + c.title + ').',
              fix: c.fix, since: c.since,
              receipt: { check: 'grep -n -E ' + JSON.stringify(pat) + ' ' + JSON.stringify(rel), expect: 'line ' + (i + 1) + ' matches: ' + line.trim().slice(0, 120) } });
          });
        }
      }
    } else if (c.detector === 'seed-stamp') {
      if (fs.existsSync(P(SEED_RULES))) {
        const m = /<!-- Toolkit version: ([^ |]+)/.exec(fs.readFileSync(P(SEED_RULES), 'utf8'));
        const stamped = m ? m[1] : null;
        if (stamped === null || cmp(stamped, toVersion) < 0) emit({ id: c.id, severity: 'warn', convention: c.title, file: { relPath: SEED_RULES, line: 3 },
          what: 'Should fix. The seeded rules file is stamped ' + (stamped || 'with no version') + ' while the plugin is ' + toVersion + '.',
          fix: c.fix || 'let /tk:setup rewrite the seed, or update the stamp after merging the seed text', since: c.since,
          receipt: { check: 'grep -n "Toolkit version" ' + SEED_RULES, expect: 'the stamp reads a version below ' + toVersion } });
      }
    } else if (c.detector === 'dead-permissions') {
      const local = readJson(P('.claude/settings.local.json'), null);
      const allow = (local && local.permissions && local.permissions.allow) || [];
      const dead = allow.filter(p => DEAD_PERMISSION.some(re => re.test(p)));
      if (dead.length) emit({ id: c.id, severity: 'suggest', convention: c.title, file: { relPath: '.claude/settings.local.json' },
        what: 'Optional. ' + dead.length + ' permission entr' + (dead.length === 1 ? 'y points' : 'ies point') + ' at scripts the plugin no longer places in the project.',
        fix: c.fix || 'remove them; the plugin commands carry their own allowed-tools', since: c.since,
        fields: [{ label: 'Entries', value: dead.join(' ; ') }],
        receipt: { check: 'grep -n -E "\\.claude/scripts/|browse\\.js|Skill\\(review-commands" .claude/settings.local.json', expect: dead.length + ' matching line(s)' } });
    } else if (c.detector === 'local-edits') {
      const mig = readJson(P(MIGRATION_REL), null);
      for (const m of (mig && mig.modified) || []) {
        emit({ id: c.id, severity: 'warn', convention: c.title, file: { relPath: m.rel },
          what: 'Should fix. ' + m.rel + ' carried a local edit the plugin copy replaced during the migration from ' + (mig.from || '?') + '.',
          fix: c.fix || 'file the change upstream, or carry it as a project-owned script the toolkit does not ship', since: c.since,
          fields: [{ label: 'Your copy', value: m.backup || '(no backup recorded)' }, { label: 'Plugin copy', value: m.pluginCopy ? '${CLAUDE_PLUGIN_ROOT}/' + m.pluginCopy : '(none)' }],
          receipt: { check: m.backup && m.pluginCopy ? 'diff ' + JSON.stringify(m.backup) + ' "' + path.join(pluginRoot, m.pluginCopy) + '"' : 'cat ' + MIGRATION_REL, expect: 'a non-empty diff: the edited lines' } });
      }
    }
  }
  for (const f of findings) process.stdout.write(JSON.stringify(f) + '\n');
  console.error('upgrade-audit: ' + findings.length + ' candidate finding(s); ' + inRange.length + ' of ' + all.length + ' convention(s) in range ' + (fromVersion || 'start') + ' -> ' + toVersion + (inRange.length ? ' [' + inRange.map(c => c.id).join(', ') + ']' : '') + '; ' + promptFiles.length + ' project-owned prompt file(s)');
}

main();
