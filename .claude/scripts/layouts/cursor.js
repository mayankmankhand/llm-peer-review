'use strict';
//
// cursor.js - the Cursor layout emitter for build-layouts.js (issue #144).
//
// Loaded by .claude/scripts/build-layouts.js, which passes the shared `model`
// (commands, skills, agents, host notes, the permission list, and the shared
// helpers) and expects emit(model) to return [{ path, content, merge? }] with
// paths relative to the project root. Output is deterministic: no timestamps,
// no environment lookups, the same input gives byte-identical files.
//
// What Cursor reads natively, and therefore what is NOT emitted here:
//   .agents/skills/<name>/SKILL.md   the shared skills the core already emits
//                                    (Cursor lists .agents/skills/, .cursor/skills/,
//                                    and, as legacy roots, .claude/skills/ and
//                                    .codex/skills/; https://cursor.com/docs/context/skills)
//   AGENTS.md                        the shared digest the core already emits
//
// What this emitter adds (all under .cursor/):
//   skills/tk-review/SKILL.md          alias of the `review` command, because Cursor
//   skills/tk-review-security/SKILL.md ships built-in skills named `review` and
//                                      `review-security` and documents no precedence
//                                      rule between a built-in and a project skill.
//                                      Nothing else is copied here on purpose: the
//                                      duplicates Cursor shows for every other skill
//                                      are a named loss, not a build target.
//   agents/<name>.md                   one per .claude/agents/*.md with readonly: true
//                                      (https://cursor.com/docs/agent/subagents: name,
//                                      description, model default inherit, readonly,
//                                      is_background). No model line: every pin ships
//                                      inherit in v7.0.0.
//   agents/review-finder-shell.md      review-finder again WITHOUT readonly, for the
//                                      two lenses that must run shell commands: the
//                                      shipped Cursor runtime denies shell, write,
//                                      delete, and MCP under readonly: true.
//   hooks.json                         version 1; `stop` runs chain-hook.js, which
//                                      prints Cursor's { followup_message } JSON;
//                                      `beforeShellExecution` runs the same script
//                                      with --guard-shell, which reads Cursor's
//                                      { command, cwd } on stdin and answers
//                                      { permission: "deny" } for a force push
//                                      (https://cursor.com/docs/agent/hooks).
//                                      Merged by key into a pre-existing file.
//   rules/toolkit.mdc                  alwaysApply rule pointing at AGENTS.md and
//                                      carrying the one instruction that makes the
//                                      raw .claude/skills/ copies usable: read the
//                                      path an injection-token line names
//                                      (https://cursor.com/docs/context/rules).
//   permissions.toolkit.json           the permission list in the editor's
//                                      permissions.json grammar: `terminalAllowlist`
//                                      as plain command-prefix strings
//                                      (https://cursor.com/docs/reference/permissions).
//                                      Setup merges it into ~/.cursor/permissions.json
//                                      per machine; Cursor does not read the project
//                                      copy for allowlists. The editor loader reads
//                                      only mcpAllowlist, terminalAllowlist, and
//                                      autoRun from that file, so no run-mode key is
//                                      written: `approvalMode` belongs to the CLI's
//                                      cli-config.json (a strict schema) and the
//                                      editor's mode is a Settings choice. Merging a
//                                      non-empty terminalAllowlist is what puts the
//                                      editor in Allowlist mode.
//
// chain-hook.js is written by another step; it is referenced by name only.

const CHAIN_HOOK = 'node .claude/scripts/chain-hook.js';

const ALIASES = [
  { kind: 'command', from: 'review', name: 'tk-review' },
  { kind: 'skill', from: 'review-security', name: 'tk-review-security' },
];

const SHELL_VARIANT = 'review-finder';
const SHELL_VARIANT_NAME = 'review-finder-shell';
const SHELL_PREAMBLE = [
  'This file exists only for the Dependency Security and Browser QA lenses, which must run',
  '`npm audit`, `npm outdated`, `gh api`, and `node .claude/scripts/browse.js`. Cursor\'s',
  '`readonly: true` flag blocks shell commands as well as file edits (the runtime denies',
  '"shell, write, delete, and MCP operations" under it), so the readonly `review-finder`',
  'cannot run those lenses. Every other lens dispatches `review-finder`. Without the flag',
  'nothing in the harness stops an edit here, so the no-edit rule below is the guarantee,',
  'and the orchestrator wraps this dispatch in `node .claude/scripts/write-guard.js begin`',
  'and `end`, redispatching once on an `INVALID` result.',
].join(' ');

function find(list, name, what) {
  const item = list.find(i => i.name === name);
  if (!item) throw new Error('layouts/cursor.js: ' + what + ' "' + name + '" is missing under .claude/, so its Cursor output cannot be built');
  return item;
}

function aliasPreamble(from) {
  return 'Alias of `/' + from + '` for Cursor, where a built-in skill shadows that name. Same body, same rules.';
}

// One .cursor/agents/<name>.md. `opts.readonly` false omits the line entirely
// (Cursor's default is false), it never writes `readonly: false`.
function agentDoc(model, agent, opts) {
  const name = opts.name || agent.name;
  let description = String(agent.fm.description || '');
  if (opts.descriptionPrefix) description = opts.descriptionPrefix + ' ' + description;
  const fm = ['---', 'name: ' + name, 'description: ' + model.yamlQuote(description)];
  if (opts.readonly) fm.push('readonly: true');
  fm.push('---');
  const parts = [fm.join('\n'), model.mdHeader(agent.source), ''];
  if (opts.preamble) parts.push(opts.preamble, '');
  parts.push(model.inline(agent.body).trim(), '');
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

function hooksJson(model) {
  const doc = {
    // No _generated key: Cursor documents only version and hooks here and an
    // unknown key is untested; the record in .claude/.toolkit-generated.json marks
    // this file as generated instead.
    version: 1,
    hooks: {
      stop: [
        { command: CHAIN_HOOK + ' --tool cursor' },
      ],
      beforeShellExecution: [
        { command: CHAIN_HOOK + ' --tool cursor --guard-shell' },
      ],
    },
  };
  return JSON.stringify(doc, null, 2) + '\n';
}

function rulesMdc(model) {
  return [
    '---',
    'description: "llm-peer-review toolkit rules"',
    'alwaysApply: true',
    '---',
    model.mdHeader('AGENTS.md'),
    '',
    '1. Read `AGENTS.md` at the repository root and follow it. It is the toolkit digest; the full rules it points to live under `.claude/`.',
    '2. When a skill body contains a line that begins with the injection token, an exclamation mark, a backtick, `cat`, a path, and a closing backtick, read that path before continuing. Cursor also lists the raw `.claude/skills/` copies, whose tokens Claude Code would have expanded at load time; nothing expands them here, so the read is yours to do.',
    '',
  ].join('\n');
}

function permissionsJson(model) {
  const seen = new Set();
  const allow = [];
  for (const p of model.permissionPrefixes('cursor')) {
    if (seen.has(p)) continue;
    seen.add(p);
    allow.push(p);
  }
  const doc = {
    _generated: model.header('.claude/toolkit-permissions.json'),
    terminalAllowlist: allow,
  };
  return JSON.stringify(doc, null, 2) + '\n';
}

function emit(model) {
  const notes = [{ tool: 'cursor', label: (model.labels && model.labels.cursor) || 'Cursor', text: model.hostNotes.cursor }];
  const files = [];

  for (const a of ALIASES) {
    const item = find(a.kind === 'command' ? model.commands : model.skills, a.from, a.kind);
    files.push({
      path: '.cursor/skills/' + a.name + '/SKILL.md',
      content: model.skillDoc(item, notes, { name: a.name, preamble: aliasPreamble(a.from) }),
    });
  }

  for (const agent of model.agents) {
    files.push({ path: '.cursor/agents/' + agent.name + '.md', content: agentDoc(model, agent, { readonly: true }) });
  }
  const finder = find(model.agents, SHELL_VARIANT, 'agent');
  files.push({
    path: '.cursor/agents/' + SHELL_VARIANT_NAME + '.md',
    content: agentDoc(model, finder, {
      name: SHELL_VARIANT_NAME,
      readonly: false,
      descriptionPrefix: 'Shell-capable variant of review-finder for the Dependency Security and Browser QA lenses only; every other lens uses review-finder.',
      preamble: SHELL_PREAMBLE,
    }),
  });

  files.push({ path: '.cursor/hooks.json', content: hooksJson(model), merge: 'json' });
  files.push({ path: '.cursor/rules/toolkit.mdc', content: rulesMdc(model) });
  files.push({ path: '.cursor/permissions.toolkit.json', content: permissionsJson(model) });

  return files;
}

module.exports = { emit };
