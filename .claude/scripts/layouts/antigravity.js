'use strict';
//
// layouts/antigravity.js - the Antigravity CLI layout (issue #144), one of the
// per-tool emitters build-layouts.js loads. It receives the shared model and
// returns the files only Antigravity reads; the shared .agents/skills/ tree and
// AGENTS.md are emitted by the core, not here.
//
// What it emits (paths relative to the project root):
//   .agents/agents/<name>.md      one per .claude/agents/<name>.md: YAML
//                                 frontmatter in Antigravity's grammar, the
//                                 Claude Code tool names mapped, never a write
//                                 tool, and a skills: list that omits the three
//                                 never-chained debate stages (M14)
//   .agents/hooks.json            one Stop hook running chain-hook.js, merged
//                                 by key into any hooks.json already there
//   .agents/rules/toolkit.md      an always-on rule pointing at AGENTS.md
//   .agents/settings.toolkit.json the permission list in command(prefix)
//                                 grammar plus one write_file rule, for setup
//                                 to merge into the per-machine settings file
//
// Shapes confirmed against the docs on 2026-09-07:
//   agents    https://antigravity.google/docs/subagents/ (location, fields
//             name/description/tools/model inherit|flash|pro/subagent/mainAgent/
//             skills as "skills/<name>" paths; example tools view_file,
//             grep_search, run_command). No find or glob tool is documented,
//             so Claude Code's Glob is dropped and the agent body says so.
//   hooks     https://antigravity.google/docs/hooks/ (top-level object keyed by
//             a hook-group name, then event name, then [{ matcher?, hooks: [{
//             type: "command", command, timeout? }] }]; Stop stdout is
//             { "decision": "continue", "reason" }; default timeout 30 s)
//   rules     https://antigravity.google/docs/rules-workflows/ (.agents/rules,
//             12,000 characters each; trigger: always_on)
//   settings  https://antigravity.google/docs/cli/permissions/ (permissions
//             .allow entries "command(<prefix>)" and "write_file(<path>)";
//             the file is ~/.gemini/antigravity-cli/settings.json, per machine)
//
// Deterministic: no timestamps, sorted lists, byte-identical output for the
// same input. Zero dependencies.

const TOOL_MAP = { Read: 'view_file', Grep: 'grep_search', Bash: 'run_command' };
// A finder that could write would apply changes before the M2 audit judged
// them, so these names are refused even if a source agent ever listed one.
const WRITE_TOOLS = ['write_to_file', 'replace_file_content', 'multi_replace_file_content'];
const RULE_CAP = 12000;
const WORKSPACE_PLACEHOLDER = '__WORKSPACE__';
const SETTINGS_FILE = '~/.gemini/antigravity-cli/settings.json';

function mapTools(claudeTools) {
  const tools = [], dropped = [];
  for (const t of claudeTools) {
    if (/^(Edit|Write|NotebookEdit)$/.test(t)) throw new Error('layouts/antigravity.js: a source agent lists the write tool ' + t + '; agents never get one');
    const m = TOOL_MAP[t];
    if (m) { if (!tools.includes(m)) tools.push(m); } else dropped.push(t);
  }
  for (const w of WRITE_TOOLS) if (tools.includes(w)) throw new Error('layouts/antigravity.js: refusing to grant ' + w);
  return { tools, dropped };
}

// Every generated skill a subagent may call: the commands and the user-facing
// skills, minus the debate stages a human must type (M14).
function callableSkills(model) {
  return model.commands.concat(model.skills)
    .map(i => i.name)
    .filter(n => !model.neverChained.includes(n))
    .sort();
}

function toolNote(tools, dropped) {
  const parts = ['Tool names here: this agent was written for Claude Code, so where the text below says Read, Grep, or Bash, use view_file, grep_search, or run_command.'];
  if (dropped.length) {
    parts.push(dropped.join(', ') + ' ' + (dropped.length > 1 ? 'have' : 'has') + ' no documented Antigravity equivalent and ' + (dropped.length > 1 ? 'are' : 'is') + ' not granted; find files with grep_search' + (tools.includes('run_command') ? ', or with run_command and `find`' : '') + '.');
  }
  parts.push('No write or replace tool is ever granted to this agent.');
  return parts.join(' ');
}

function emitAgent(model, agent, skills) {
  const { tools, dropped } = mapTools(agent.tools);
  const fm = [
    '---',
    'name: ' + agent.name,
    'description: ' + model.yamlQuote(agent.fm.description || ''),
    'model: inherit',
    'subagent: true',
    'mainAgent: false',
    'tools:',
  ];
  for (const t of tools) fm.push('  - ' + t);
  fm.push('skills:');
  for (const s of skills) fm.push('  - skills/' + s);
  fm.push('---');
  const content = [fm.join('\n'), model.mdHeader(agent.source), '', toolNote(tools, dropped), '', agent.body.trim(), ''].join('\n');
  return { path: '.agents/agents/' + agent.name + '.md', content };
}

function emitHooks(model) {
  const hooks = {
    // No _generated key here: Antigravity keys this file by hook-group name at
    // the top level, so an unknown string key could make it unparseable. The
    // record in .claude/.toolkit-generated.json is what marks it as generated.
    'toolkit-chain': {
      Stop: [
        { hooks: [{ type: 'command', command: 'node .claude/scripts/chain-hook.js --tool antigravity' }] },
      ],
    },
  };
  return { path: '.agents/hooks.json', content: JSON.stringify(hooks, null, 2) + '\n', merge: 'json' };
}

function emitRule(model) {
  const content = [
    '---',
    'trigger: always_on',
    '---',
    model.mdHeader('AGENTS.md'),
    '',
    'Read `AGENTS.md` at the workspace root before doing anything else. It is the digest of the llm-peer-review toolkit\'s rules (the auto loop, the command table, what each stage does); follow it, and open `.claude/rules/toolkit.md` for anything it does not answer.',
    '',
    'Everything under `.agents/` (the skills, the agents, this rule, `hooks.json`, `settings.toolkit.json`) is generated by `' + model.buildCmd + '` from the source under `.claude/` and is never edited by hand or by an auto-fix. Change the source and rebuild.',
    '',
  ].join('\n');
  if (content.length >= RULE_CAP) throw new Error('layouts/antigravity.js: .agents/rules/toolkit.md is ' + content.length + ' characters, at or over Antigravity\'s ' + RULE_CAP + ' cap');
  return { path: '.agents/rules/toolkit.md', content };
}

function emitSettings(model) {
  const allow = model.permissionPrefixes('antigravity').map(p => 'command(' + p + ')');
  allow.push('write_file(' + WORKSPACE_PLACEHOLDER + '/)');
  const settings = {
    _generated: model.header('.claude/toolkit-permissions.json'),
    _note: 'Antigravity does not read this file where it sits. Setup merges permissions.allow into ' + SETTINGS_FILE + ', the per-machine file that applies to every project on the machine, replacing ' + WORKSPACE_PLACEHOLDER + ' with this workspace\'s absolute path (no trailing slash) so the loop\'s file edits do not pause for a diff review. A committed file must never carry that path, which is why the placeholder exists; the documented relative form (write_file(src/)) does not say what it resolves against, so it is not used. toolPermission is left at its default, request-review.',
    permissions: { allow },
  };
  return { path: '.agents/settings.toolkit.json', content: JSON.stringify(settings, null, 2) + '\n' };
}

function emit(model) {
  const skills = callableSkills(model);
  const out = model.agents.map(a => emitAgent(model, a, skills));
  out.push(emitHooks(model), emitRule(model), emitSettings(model));
  return out;
}

module.exports = { emit };
