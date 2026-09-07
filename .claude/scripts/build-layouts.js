#!/usr/bin/env node
'use strict';
//
// build-layouts.js - emit each AI tool's native layout from the one source of
// truth under .claude/ (issue #144: the toolkit outside Claude Code).
//
// Why this exists:
//   Cursor, OpenAI Codex CLI, and Antigravity CLI each read their own
//   directories and formats, and none of them reads .claude/ as written. Rather
//   than keep four hand-maintained copies of every prompt, this script treats
//   .claude/ as canonical and DERIVES every other layout from it, the way
//   render-html.js derives a page from a payload. Generated files are committed
//   so a clone works in any tool, and they are never hand-edited: the record of
//   output hashes below is how a hand edit is caught and refused.
//
// What it emits (the SHARED part lives here; per-tool parts live in
// .claude/scripts/layouts/<tool>.js, each exporting emit(model)):
//   .agents/skills/<name>/SKILL.md   one skill per command and per user-facing
//                                    skill. Codex, Cursor, and Antigravity all
//                                    read this directory, so it is shared.
//   AGENTS.md                        a digest of the toolkit rules between
//                                    <!-- toolkit:start --> / <!-- toolkit:end -->
//                                    markers, merged into any existing file.
//   .claude/.toolkit-generated.json  the record: one sha256 per generated file,
//                                    committed beside the files.
//
// Inlining:
//   Claude Code expands a line of the form !`cat <path>` at load time. No target
//   tool does. Two fragments are loop-critical and are inlined verbatim
//   (hitl-loop.md, severity-anchors.md); every other token becomes a one-line
//   pointer telling the model to read the file now. Full inlining was measured
//   at 68 to 84 KB per review skill, which Codex reads whole on every
//   activation, so the pointer form is deliberate.
//
// Usage:
//   node .claude/scripts/build-layouts.js [--tools codex,cursor,antigravity]
//                                        [--check] [--clean <tool>] [--force]
//                                        [--claude-settings] [--root <dir>]
//
//   (no mode)          build every layout for the selected tools
//   --tools <list>     which tools; default is .claude/.toolkit-tools.json,
//                      written by setup (this repo commits it naming all three)
//   --check            build in memory and compare with disk: exit 1 naming any
//                      generated file that is missing, stale (the source changed
//                      since the last build), or hand-edited (the file changed
//                      since the last build). Warns when AGENTS.md exceeds the
//                      32 KiB Codex reads.
//   --clean <tool>     delete that tool's generated files and drop them from the
//                      record; shared files go when no tool remains
//   --force            overwrite a hand-edited or unrecorded file after backing
//                      it up to .toolkit-backup-<stamp>/; never the default
//   --claude-settings  translate .claude/toolkit-permissions.json into Claude
//                      Code's grammar and merge it into .claude/settings.local.json
//                      (existing entries are kept). Setup calls this; it is the
//                      replacement for the tracked seed copy that used to ship.
//                      With --print, write nothing and print the translation
//                      alone as JSON on stdout (the installers feed it to their
//                      own merge, which also retires stale absolute-path entries).
//   --root <dir>       project root; default is the current directory
//
// Output is deterministic: identical inputs give byte-identical files, so a
// rebuild never re-flags a hook for trust and the record never churns. Nothing
// here carries a timestamp. Zero external dependencies.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

function die(msg) { console.error('build-layouts.js: ' + msg); process.exit(1); }
function warn(msg) { console.error('build-layouts.js: warning: ' + msg); }

// --- parse args ---
const argv = process.argv.slice(2);
const opts = { tools: null, check: false, clean: null, force: false, claudeSettings: false, print: false, root: process.cwd(), verbose: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--tools') opts.tools = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
  else if (a === '--check') opts.check = true;
  else if (a === '--clean') opts.clean = String(argv[++i] || '').trim();
  else if (a === '--force') opts.force = true;
  else if (a === '--claude-settings') opts.claudeSettings = true;
  else if (a === '--print') opts.print = true;
  else if (a === '--root') opts.root = path.resolve(String(argv[++i] || '.'));
  else if (a === '--verbose') opts.verbose = true;
  else die('unknown argument: ' + a);
}

const ROOT = opts.root;
const TOOL_NAMES = ['codex', 'cursor', 'antigravity'];
const RECORD_REL = '.claude/.toolkit-generated.json';
const TOOLS_REL = '.claude/.toolkit-tools.json';
const PERMISSIONS_REL = '.claude/toolkit-permissions.json';
const INLINE_FRAGMENTS = ['.claude/skills/shared/hitl-loop.md', '.claude/skills/shared/severity-anchors.md'];
const NEVER_CHAINED = ['ask-gpt', 'ask-gemini', 'peer-review'];
const AGENT_ONLY_SKILLS = ['project-context'];
const INJECT_RE = /^!`cat ([^`]+)`\s*$/;
const MARK_START = '<!-- toolkit:start -->';
const MARK_END = '<!-- toolkit:end -->';
const DIGEST_BUDGET = 12 * 1024;
const AGENTS_MD_CAP = 32 * 1024;
const BUILD_CMD = 'node .claude/scripts/build-layouts.js';

// --- small helpers ---
const abs = rel => path.join(ROOT, rel);
const exists = rel => fs.existsSync(abs(rel));
const read = rel => fs.readFileSync(abs(rel), 'utf8');
const sha256 = text => 'sha256:' + crypto.createHash('sha256').update(text, 'utf8').digest('hex');
function readJson(rel, fallback) {
  if (!exists(rel)) return fallback;
  try { return JSON.parse(read(rel)); } catch (e) { die(rel + ' is not valid JSON: ' + e.message); }
}
function listMd(dirRel) {
  if (!exists(dirRel)) return [];
  return fs.readdirSync(abs(dirRel)).filter(f => f.endsWith('.md')).sort();
}
function listDirs(dirRel) {
  if (!exists(dirRel)) return [];
  return fs.readdirSync(abs(dirRel), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
}
// A generated markdown or TOML file opens with this line; JSON carries it as a key.
function header(source) {
  return 'GENERATED by ' + BUILD_CMD + ' from ' + source + '. Do not edit: change the source under .claude/ and rebuild.';
}
const mdHeader = source => '<!-- ' + header(source) + ' -->';
const hashHeader = source => '# ' + header(source);

// YAML subset parser for the frontmatter the toolkit actually writes:
// `key: value` scalars and `key:` followed by `  - item` lists.
function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return { fm: {}, body: text, raw: '' };
  const end = text.indexOf('\n---', 4);
  if (end < 0) return { fm: {}, body: text, raw: '' };
  const raw = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n/, '');
  const fm = {};
  let key = null;
  for (const line of raw.split('\n')) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) { if (!Array.isArray(fm[key])) fm[key] = []; fm[key].push(item[1].trim()); continue; }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) { key = kv[1]; fm[key] = kv[2].trim(); }
  }
  return { fm, body, raw };
}
function yamlQuote(s) { return JSON.stringify(String(s)); } // JSON strings are valid double-quoted YAML scalars
function tomlString(s) { return JSON.stringify(String(s)); } // TOML basic strings share JSON's escapes for what we emit
function stripMd(s) { return s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim(); }

// Repo host, the same substring test host-cli.md uses: never parse the URL.
function originIsGitlab() {
  try {
    const url = cp.execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return url.includes('gitlab.com');
  } catch (e) { return false; }
}

// --- the model every emitter receives ---
function loadModel(tools) {
  const permissions = readJson(PERMISSIONS_REL, null);
  if (!permissions) die(PERMISSIONS_REL + ' is missing; it is the source of every permission file');
  const isGitlab = originIsGitlab();

  const commands = listMd('.claude/commands').map(f => {
    const name = f.replace(/\.md$/, '');
    const source = '.claude/commands/' + f;
    const body = read(source);
    const use = (body.match(/^\*\*Use this when:\*\*\s*(.+)$/m) || [])[1] || '';
    const dont = (body.match(/^\*\*Don't use this when:\*\*\s*(.+)$/m) || [])[1] || '';
    return { kind: 'command', name, source, body, useWhen: stripMd(use), dontUseWhen: stripMd(dont) };
  });
  const skills = listDirs('.claude/skills')
    .filter(d => d !== 'shared' && !AGENT_ONLY_SKILLS.includes(d) && exists('.claude/skills/' + d + '/SKILL.md'))
    .map(d => {
      const source = '.claude/skills/' + d + '/SKILL.md';
      const parsed = parseFrontmatter(read(source));
      return { kind: 'skill', name: d, source, fm: parsed.fm, body: parsed.body };
    });
  const agents = listMd('.claude/agents').map(f => {
    const source = '.claude/agents/' + f;
    const parsed = parseFrontmatter(read(source));
    const toolList = typeof parsed.fm.tools === 'string' ? parsed.fm.tools.split(',').map(s => s.trim()).filter(Boolean) : (parsed.fm.tools || []);
    return { name: f.replace(/\.md$/, ''), source, fm: parsed.fm, tools: toolList, model: parsed.fm.model || 'inherit', effort: parsed.fm.effort || '', body: parsed.body };
  });
  const hostNotes = {};
  for (const t of TOOL_NAMES) {
    const rel = '.claude/skills/shared/host-notes/' + t + '.md';
    hostNotes[t] = exists(rel) ? read(rel).trim() : '';
  }

  // Inliner: a WHOLE line that is an injection token. Two fragments inline,
  // everything else becomes a pointer. Prose that merely mentions the token is
  // left alone because the regex is anchored at both ends.
  function inline(text) {
    return text.split('\n').map(line => {
      const m = line.match(INJECT_RE);
      if (!m) return line;
      const target = m[1].trim();
      if (INLINE_FRAGMENTS.includes(target)) {
        if (!exists(target)) die('inline fragment missing: ' + target);
        return '<!-- inlined from ' + target + ' -->\n' + read(target).trim() + '\n<!-- end of ' + target + ' -->';
      }
      return '> Read `' + target + '` now, before continuing. It is part of this skill and is not inlined here.';
    }).join('\n');
  }

  function description(item) {
    if (item.kind === 'skill') {
      let d = item.fm.description || '';
      return d;
    }
    let d = item.useWhen || ('The toolkit\'s /' + item.name + ' command.');
    if (item.dontUseWhen) d += ' Not when: ' + item.dontUseWhen;
    if (NEVER_CHAINED.includes(item.name)) d += ' Typed by a human only, never invoked implicitly (M14).';
    return d;
  }

  // One SKILL.md, for any tool. `notes` is an ordered list of {tool, text}
  // sections; a shared skill carries every selected tool's notes, an alias
  // carries one tool's. Frontmatter keeps the open-spec fields only.
  function skillDoc(item, notes, extra) {
    const fm = ['---', 'name: ' + (extra && extra.name ? extra.name : item.name), 'description: ' + yamlQuote(description(item))];
    if (NEVER_CHAINED.includes(item.name)) fm.push('disable-model-invocation: true');
    if (extra && extra.frontmatter) for (const line of extra.frontmatter) fm.push(line);
    fm.push('---');
    const parts = [fm.join('\n'), mdHeader(item.source), ''];
    if (extra && extra.preamble) parts.push(extra.preamble, '');
    parts.push(inline(item.body).trim(), '');
    const live = (notes || []).filter(n => n.text);
    if (live.length) {
      parts.push('## Host notes', '');
      if (live.length > 1) parts.push('Follow the section for the tool you are running in and ignore the others.', '');
      for (const n of live) parts.push('### On ' + n.label, '', n.text, '');
    }
    return parts.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
  }

  // Permission prefixes a tool may translate: 'all' groups plus groups naming
  // the tool, with the GitLab rows only when the origin is on gitlab.com.
  function permissionGroups(tool) {
    return permissions.groups.filter(g => {
      if (g.optional === 'gitlab' && !isGitlab) return false;
      return g.tools === 'all' || (Array.isArray(g.tools) && g.tools.includes(tool));
    });
  }
  function permissionPrefixes(tool) { return permissionGroups(tool).flatMap(g => g.prefixes); }

  const labels = { codex: 'Codex', cursor: 'Cursor', antigravity: 'Antigravity' };
  return {
    root: ROOT, tools, isGitlab, commands, skills, agents, hostNotes, permissions, labels,
    rules: { toolkit: read('.claude/rules/toolkit.md'), htmlOutputs: read('.claude/rules/html-outputs.md') },
    claudeMd: exists('CLAUDE.md') ? read('CLAUDE.md') : '',
    neverChained: NEVER_CHAINED, buildCmd: BUILD_CMD,
    header, mdHeader, hashHeader, inline, description, skillDoc, yamlQuote, tomlString,
    permissionGroups, permissionPrefixes, read, exists,
  };
}

// --- shared emitters ---
function emitSharedSkills(model) {
  const notes = model.tools.map(t => ({ tool: t, label: model.labels[t], text: model.hostNotes[t] }));
  const items = model.commands.concat(model.skills);
  return items.map(item => ({
    path: '.agents/skills/' + item.name + '/SKILL.md', tool: 'shared',
    content: model.skillDoc(item, notes),
  }));
}

// The AGENTS.md digest: the parts of toolkit.md a session must hold every turn,
// the command table, CLAUDE.md, and a fixed paragraph on where the rest lives.
function section(text, heading, stopAt) {
  const lines = text.split('\n');
  const start = lines.findIndex(l => l.trim() === heading);
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (stopAt ? stopAt.some(s => l.trim() === s) : /^## /.test(l)) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').trim();
}
function emitAgentsMd(model) {
  const tk = model.rules.toolkit;
  const body = [
    MARK_START,
    mdHeader('.claude/rules/toolkit.md, .claude/rules/html-outputs.md, CLAUDE.md'),
    '',
    '# Toolkit rules (digest)',
    '',
    'This repository carries the llm-peer-review slash-command toolkit. The full rules live under `.claude/`; this digest is what every session must hold. Read `.claude/rules/toolkit.md` for anything not answered here.',
    '',
    section(tk, '## How We Work Together'),
    '',
    section(tk, '## Slash Commands', ['### Plans']).replace(/^## Slash Commands/, '## Slash Commands (the table; the rest is in toolkit.md)'),
    '',
    section(tk, '### Command-Specific Rules', ['### Subagent Strategy']),
    '',
    section(tk, '## Remember'),
    '',
    '## Where the rest lives',
    '',
    '- Loop mechanics M1 to M15: `.claude/skills/shared/hitl-loop.md`. Every review skill inlines it.',
    '- HTML outputs: `.claude/rules/html-outputs.md`. In this tool the session cannot publish to a hosted page, so every artifact is rendered with `node .claude/scripts/render-html.js` (without `--no-abs`) and opened locally with `bash .claude/scripts/open-artifact.sh <file>`. That is the complete flow here, not a degraded one.',
    '- Subagent model routing: `.claude/skills/shared/model-routing.md`. Generated subagent files carry the roster\'s pins; everything else inherits.',
    '- Generated files: everything under `.agents/`, `.codex/`, `.cursor/` and this block are written by `' + model.buildCmd + '` from `.claude/` and are never edited by hand or by an auto-fix (M9). Edit the source and rebuild.',
    '',
    model.claudeMd ? '## Project notes (CLAUDE.md)\n\n' + model.claudeMd.trim() : '',
    MARK_END,
  ].join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
  if (Buffer.byteLength(body, 'utf8') > DIGEST_BUDGET) {
    die('the AGENTS.md digest is ' + Buffer.byteLength(body, 'utf8') + ' bytes, over its ' + DIGEST_BUDGET + ' byte budget; trim toolkit.md\'s digest sections or raise DIGEST_BUDGET deliberately');
  }
  return { path: 'AGENTS.md', tool: 'shared', content: body, merge: 'markers' };
}

// --- per-tool emitters ---
function loadEmitter(tool) {
  const rel = '.claude/scripts/layouts/' + tool + '.js';
  if (!exists(rel)) { warn('no emitter for ' + tool + ' yet (' + rel + ' missing); only the shared files are built for it'); return null; }
  return require(abs(rel));
}

// --- record ---
function readRecord() { return readJson(RECORD_REL, { version: 1, tools: [], files: {} }); }
function writeRecord(rec) {
  const sorted = { version: 1, tools: rec.tools.slice().sort(), files: {} };
  for (const k of Object.keys(rec.files).sort()) sorted.files[k] = rec.files[k];
  fs.writeFileSync(abs(RECORD_REL), JSON.stringify(sorted, null, 2) + '\n');
}

// --- marker merge (AGENTS.md) ---
function mergeMarkers(existing, block) {
  if (!existing) return block;
  const s = existing.indexOf(MARK_START), e = existing.indexOf(MARK_END);
  if (s >= 0 && e > s) return existing.slice(0, s) + block.trim() + existing.slice(e + MARK_END.length);
  return existing.replace(/\s*$/, '') + '\n\n' + block;
}
function markerBlock(text) {
  const s = text.indexOf(MARK_START), e = text.indexOf(MARK_END);
  return s >= 0 && e > s ? text.slice(s, e + MARK_END.length) + '\n' : '';
}
// --- key merge (hooks.json): theirs plus ours, ours winning on scalars, arrays appended without duplicates ---
function mergeJson(theirs, ours) {
  if (Array.isArray(theirs) && Array.isArray(ours)) {
    const out = theirs.slice();
    for (const o of ours) if (!out.some(t => JSON.stringify(t) === JSON.stringify(o))) out.push(o);
    return out;
  }
  if (theirs && ours && typeof theirs === 'object' && typeof ours === 'object' && !Array.isArray(theirs) && !Array.isArray(ours)) {
    const out = Object.assign({}, theirs);
    for (const k of Object.keys(ours)) out[k] = k in theirs ? mergeJson(theirs[k], ours[k]) : ours[k];
    return out;
  }
  return ours;
}

// Remove our entries from a merged JSON document, leaving whatever the user had.
// Arrays lose the items deep-equal to ours; objects lose keys whose value is
// ours or empties out after recursion; a scalar equal to ours goes.
function unmergeJson(theirs, ours) {
  if (Array.isArray(theirs) && Array.isArray(ours)) {
    return theirs.filter(t => !ours.some(o => JSON.stringify(t) === JSON.stringify(o)));
  }
  if (theirs && ours && typeof theirs === 'object' && typeof ours === 'object' && !Array.isArray(theirs) && !Array.isArray(ours)) {
    const out = {};
    for (const k of Object.keys(theirs)) {
      if (!(k in ours)) { out[k] = theirs[k]; continue; }
      const rest = unmergeJson(theirs[k], ours[k]);
      const empty = rest === undefined || (Array.isArray(rest) && rest.length === 0) || (rest && typeof rest === 'object' && !Array.isArray(rest) && Object.keys(rest).length === 0);
      if (!empty) out[k] = rest;
    }
    return out;
  }
  return JSON.stringify(theirs) === JSON.stringify(ours) ? undefined : theirs;
}
// Merge our JSON into the text on disk; null when the disk text is not JSON.
function mergedJsonOrNull(diskText, ours) {
  let theirs; try { theirs = JSON.parse(diskText); } catch (e) { return null; }
  return JSON.stringify(mergeJson(theirs, JSON.parse(ours)), null, 2) + '\n';
}

function backup(rel) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const dir = abs('.toolkit-backup-' + stamp + '-build');
  const dest = path.join(dir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(abs(rel), dest);
  return path.relative(ROOT, dest);
}

// --- the plan of files for the selected tools ---
function buildPlan(tools) {
  const model = loadModel(tools);
  let files = emitSharedSkills(model).concat([emitAgentsMd(model)]);
  for (const t of tools) {
    const emitter = loadEmitter(t);
    if (!emitter) continue;
    const out = emitter.emit(model);
    if (!Array.isArray(out)) die('layouts/' + t + '.js emit() must return an array');
    for (const f of out) {
      if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') die('layouts/' + t + '.js emitted a malformed file entry');
      files.push({ path: f.path, content: f.content, tool: t, merge: f.merge || '' });
    }
  }
  const seen = new Map();
  for (const f of files) {
    if (seen.has(f.path)) die('two emitters produced ' + f.path + ' (' + seen.get(f.path) + ' and ' + f.tool + ')');
    seen.set(f.path, f.tool);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { model, files };
}

// What --check and build compare: for a marker-merged file only its block counts,
// so a user's own AGENTS.md text never reads as a hand edit.
function diskContentFor(f) {
  if (!exists(f.path)) return null;
  const text = read(f.path);
  return f.merge === 'markers' ? markerBlock(text) : text;
}

function selectedTools() {
  if (opts.tools) {
    for (const t of opts.tools) if (!TOOL_NAMES.includes(t)) die('unknown tool: ' + t + ' (known: ' + TOOL_NAMES.join(', ') + ')');
    return opts.tools;
  }
  const rec = readJson(TOOLS_REL, null);
  const list = rec && Array.isArray(rec.tools) ? rec.tools.filter(t => TOOL_NAMES.includes(t)) : [];
  return list;
}

// --- modes ---
function runCheck(tools) {
  const { files } = buildPlan(tools);
  const record = readRecord();
  const problems = [];
  for (const f of files) {
    const disk = diskContentFor(f);
    if (disk === null || disk === '') { problems.push('missing: ' + f.path); continue; }
    // A key-merged file (hooks.json) may carry the user's own entries beside
    // ours, so "current" means: merging ours into what is on disk changes
    // nothing. Every other file must match byte for byte.
    const expected = f.merge === 'json' ? mergedJsonOrNull(disk, f.content) : f.content;
    if (expected !== null && sha256(disk) === sha256(expected)) continue;
    const recorded = record.files[f.path] && record.files[f.path].hash;
    problems.push((recorded && sha256(disk) === recorded ? 'stale (source changed, rebuild): ' : 'hand-edited (restore it or rebuild with --force): ') + f.path);
  }
  if (exists('AGENTS.md') && Buffer.byteLength(read('AGENTS.md'), 'utf8') > AGENTS_MD_CAP) {
    warn('AGENTS.md is over ' + AGENTS_MD_CAP + ' bytes; Codex stops reading at that total, so trim the parts outside the toolkit markers');
  }
  if (problems.length) {
    console.error('build-layouts.js --check: ' + problems.length + ' problem(s):');
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
  }
  console.log('build-layouts.js --check: ' + files.length + ' generated files up to date for ' + (tools.join(', ') || 'no tools'));
}

function runBuild(tools) {
  const { files } = buildPlan(tools);
  const record = readRecord();
  const written = [], skipped = [];
  for (const f of files) {
    const rec = record.files[f.path];
    const disk = diskContentFor(f);
    let content = f.content;
    if (disk !== null) {
      const diskHash = sha256(disk);
      if (rec && diskHash !== rec.hash) {
        if (!opts.force) die('refusing to overwrite a hand-edited generated file: ' + f.path + ' (restore it, or rebuild with --force to back it up and replace it)');
        console.error('  backed up hand-edited ' + f.path + ' to ' + backup(f.path));
      } else if (f.merge === 'json' && diskHash !== sha256(content)) {
        // Merge by key into the copy on disk, whether it is the user's own file
        // (unrecorded) or our earlier merge (recorded and untouched). The merge is
        // idempotent, so a rebuild over an untouched file changes nothing.
        const merged = mergedJsonOrNull(disk, f.content);
        if (merged === null) die(f.path + ' exists and is not valid JSON; move it aside');
        if (!rec) console.error('  merged existing ' + f.path + ' by key');
        content = merged;
      } else if (!rec && diskHash !== sha256(content)) {
        if (f.merge === 'markers') {
          // an existing AGENTS.md is merged, never replaced
        } else {
          if (!opts.force) die('refusing to overwrite a file the toolkit did not generate: ' + f.path + ' (move it aside, or rebuild with --force to back it up and replace it)');
          console.error('  backed up ' + f.path + ' to ' + backup(f.path));
        }
      }
    }
    let toWrite = content;
    if (f.merge === 'markers') toWrite = mergeMarkers(exists(f.path) ? read(f.path) : '', content);
    fs.mkdirSync(path.dirname(abs(f.path)), { recursive: true });
    if (!exists(f.path) || read(f.path) !== toWrite) { fs.writeFileSync(abs(f.path), toWrite); written.push(f.path); } else skipped.push(f.path);
    const recordedContent = f.merge === 'markers' ? markerBlock(toWrite) : toWrite;
    record.files[f.path] = { tool: f.tool, hash: sha256(recordedContent) };
    if (f.merge) record.files[f.path].merge = f.merge;
    if (f.merge === 'json') record.files[f.path].ours = f.content;
  }
  // drop record entries for files this build no longer produces (a removed command, say)
  const produced = new Set(files.map(f => f.path));
  for (const k of Object.keys(record.files)) {
    const r = record.files[k];
    if (!produced.has(k) && (r.tool === 'shared' || tools.includes(r.tool))) {
      if (exists(k) && sha256(diskContentFor({ path: k, merge: r.merge || '' })) === r.hash) fs.unlinkSync(abs(k));
      delete record.files[k];
    }
  }
  record.tools = tools.slice();
  writeRecord(record);
  console.log('build-layouts.js: ' + written.length + ' written, ' + skipped.length + ' unchanged, for ' + (tools.join(', ') || 'no tools') + ' (record: ' + RECORD_REL + ')');
  if (exists('AGENTS.md') && Buffer.byteLength(read('AGENTS.md'), 'utf8') > AGENTS_MD_CAP) {
    warn('AGENTS.md is over ' + AGENTS_MD_CAP + ' bytes; Codex stops reading at that total');
  }
}

function runClean(tool) {
  if (!TOOL_NAMES.includes(tool)) die('unknown tool: ' + tool);
  const record = readRecord();
  const remaining = record.tools.filter(t => t !== tool);
  const dropShared = remaining.length === 0;
  let removed = 0;
  for (const k of Object.keys(record.files)) {
    const r = record.files[k];
    if (r.tool !== tool && !(dropShared && r.tool === 'shared')) continue;
    if (exists(k)) {
      const disk = diskContentFor({ path: k, merge: r.merge || '' });
      if (sha256(disk) !== r.hash && !opts.force) die('refusing to delete a hand-edited generated file: ' + k + ' (use --force)');
      if (r.merge === 'markers') {
        const rest = read(k).replace(markerBlock(read(k)), '').replace(/\n{3,}/g, '\n\n');
        if (rest.trim()) fs.writeFileSync(abs(k), rest.replace(/\s+$/, '') + '\n'); else fs.unlinkSync(abs(k));
      } else if (r.merge === 'json' && r.ours) {
        // Take only our entries back out; a user's own hooks stay behind.
        const theirs = JSON.parse(disk);
        let rest = unmergeJson(theirs, JSON.parse(r.ours));
        const meaningful = Object.keys(rest).filter(key => key !== 'version');
        // A schema field the user's file needs (Cursor's version) stays even when ours matched it.
        if (meaningful.length && 'version' in theirs && !('version' in rest)) rest = Object.assign({ version: theirs.version }, rest);
        if (meaningful.length) fs.writeFileSync(abs(k), JSON.stringify(rest, null, 2) + '\n'); else fs.unlinkSync(abs(k));
      } else fs.unlinkSync(abs(k));
      removed++;
      let dir = path.dirname(abs(k));
      while (dir !== ROOT && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) { fs.rmdirSync(dir); dir = path.dirname(dir); }
    }
    delete record.files[k];
  }
  record.tools = remaining;
  writeRecord(record);
  console.log('build-layouts.js --clean ' + tool + ': ' + removed + ' file(s) removed; remaining tools: ' + (remaining.join(', ') || 'none'));
}

// Claude Code's translation: Bash(prefix *) for every applicable prefix, the
// exact form as well for the scripts that run without arguments, plus the
// entries only Claude Code's grammar has. Merged, never replaced: what a
// person approved by hand on this machine stays.
function claudeAllowList(model) {
  const out = [];
  for (const g of model.permissionGroups('claude')) {
    for (const p of g.prefixes) {
      out.push('Bash(' + p + ' *)');
      if (/^(node|bash) \S+\.(js|sh)$/.test(p)) out.push('Bash(' + p + ')');
    }
  }
  return out.concat(model.permissions.claudeCode.allow || []);
}
function claudeTranslation(model) {
  const cc = model.permissions.claudeCode || {};
  const out = { permissions: { allow: claudeAllowList(model) } };
  if (cc.additionalDirectories) out.permissions.additionalDirectories = cc.additionalDirectories.slice();
  if (cc.defaultMode) out.defaultMode = cc.defaultMode;
  return out;
}
function runClaudeSettings() {
  const model = loadModel([]);
  if (opts.print) { process.stdout.write(JSON.stringify(claudeTranslation(model), null, 2) + '\n'); return; }
  const rel = '.claude/settings.local.json';
  const current = readJson(rel, {});
  current.permissions = current.permissions || {};
  const have = new Set(current.permissions.allow || []);
  const before = have.size;
  const allow = (current.permissions.allow || []).slice();
  for (const entry of claudeAllowList(model)) if (!have.has(entry)) { have.add(entry); allow.push(entry); }
  current.permissions.allow = allow;
  const dirs = new Set(current.permissions.additionalDirectories || []);
  for (const d of model.permissions.claudeCode.additionalDirectories || []) dirs.add(d);
  current.permissions.additionalDirectories = Array.from(dirs);
  if (!current.defaultMode && model.permissions.claudeCode.defaultMode) current.defaultMode = model.permissions.claudeCode.defaultMode;
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
  fs.writeFileSync(abs(rel), JSON.stringify(current, null, 2) + '\n');
  console.log('build-layouts.js --claude-settings: ' + rel + ' now holds ' + allow.length + ' allow entries (' + (allow.length - before) + ' added)');
}

// --- main ---
if (opts.claudeSettings) { runClaudeSettings(); process.exit(0); }
if (opts.clean) { runClean(opts.clean); process.exit(0); }
const tools = selectedTools();
if (!tools.length && !opts.check) die('no tools selected: pass --tools codex,cursor,antigravity or let setup write ' + TOOLS_REL);
if (opts.check) runCheck(tools); else runBuild(tools);
