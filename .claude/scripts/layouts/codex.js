'use strict';
//
// layouts/codex.js - the OpenAI Codex CLI layout (issue #144), one of the
// per-tool emitters build-layouts.js loads. It receives the shared model and
// returns only the files Codex alone reads. The shared .agents/skills/<name>/
// SKILL.md files and AGENTS.md come from the core, not from here.
//
// What it emits, and the page each shape was checked against (2026-09-07):
//
//   .agents/skills/<name>/agents/openai.yaml   beside ask-gpt, ask-gemini and
//       peer-review: policy.allow_implicit_invocation: false. Codex honors only
//       name and description from SKILL.md frontmatter and ignores
//       disable-model-invocation, so this file is what keeps a human-only stage
//       (M14) from firing on a description match.
//       https://learn.chatgpt.com/docs/build-skills
//   .codex/agents/<name>.toml   one per .claude/agents/*.md: name, description,
//       sandbox_mode = "read-only", developer_instructions (the body as a TOML
//       literal multi-line string). No model key: the roster's pins are Claude
//       aliases, and every role ships as inherit until an A/B receipt.
//       https://learn.chatgpt.com/docs/agent-configuration/subagents
//   .codex/config.toml   sandbox_mode, approval_policy and the subagent thread
//       cap, nothing else.
//       https://learn.chatgpt.com/docs/config-file/config-reference
//   .codex/rules/toolkit.rules   Starlark, one prefix_rule(pattern=[...],
//       decision="allow") per prefix in .claude/toolkit-permissions.json, so the
//       loop's commands run outside the sandbox without a prompt.
//       https://learn.chatgpt.com/docs/agent-configuration/rules
//   .codex/hooks.json   one Stop hook running chain-hook.js --tool codex, merged
//       by key into any hooks.json the user already has.
//       https://learn.chatgpt.com/docs/hooks
//
// Deterministic: no timestamps and a fixed key order, so a rebuild never changes
// the hook's bytes and never re-flags it for trust. Zero dependencies.

const THREAD_CAP = 4; // finders plus up to three M2 skeptics, bounded for a Plus quota
const HOOK_COMMAND = 'node .claude/scripts/chain-hook.js --tool codex';

function die(msg) { console.error('build-layouts.js: layouts/codex.js: ' + msg); process.exit(1); }

// Starlark string literals take the same escapes JSON emits (\" \\ \n \t \uXXXX).
function starlarkString(s) { return JSON.stringify(String(s)); }

// A TOML literal multi-line string: nothing inside is escaped, so the only things
// that can break it are the closing delimiter itself and control characters,
// which TOML forbids in literal strings (tab and the newline excepted).
function tomlLiteralBlock(text, what) {
  const body = String(text).replace(/\r\n/g, '\n').trim();
  if (body.includes("'''")) die(what + " contains ''' which would close the TOML literal string; rephrase it in the source");
  const bad = body.match(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
  if (bad) die(what + ' contains a control character (0x' + bad[0].charCodeAt(0).toString(16) + '), which TOML forbids inside a literal string');
  return "'''\n" + body + "\n'''";
}

// 1. openai.yaml beside each never-chained skill. Emitted only when the core
//    emits that skill's SKILL.md, so the yaml is never orphaned.
function emitOpenaiYaml(model) {
  const items = model.commands.concat(model.skills);
  const out = [];
  for (const name of model.neverChained) {
    const item = items.find(i => i.name === name);
    if (!item) continue;
    out.push({
      path: '.agents/skills/' + name + '/agents/openai.yaml',
      content: [
        model.hashHeader(item.source),
        '# Codex reads only name and description from SKILL.md and may invoke a skill',
        '# implicitly when a prompt matches its description. This stage is typed by a',
        '# human only (M14), so implicit invocation is turned off here; $' + name + ' still works.',
        'policy:',
        '  allow_implicit_invocation: false',
        '',
      ].join('\n'),
    });
  }
  return out;
}

// 2. One custom agent per .claude/agents/*.md.
function emitAgents(model) {
  return model.agents.map(a => {
    const body = model.inline(a.body);
    return {
      path: '.codex/agents/' + a.name + '.toml',
      content: [
        model.hashHeader(a.source),
        '# Codex custom agent. Dispatch it by name with fork_turns set to none. The',
        '# read-only sandbox below is not enforced under a writing parent (codex issue',
        '# 40130), so the write-guard and the M2 canary stay the real guards.',
        'name = ' + model.tomlString(a.name),
        'description = ' + model.tomlString(a.fm.description || ''),
        'sandbox_mode = "read-only"',
        'developer_instructions = ' + tomlLiteralBlock(body, a.source),
        '',
      ].join('\n'),
    };
  });
}

// 3. Project-scoped config, minimal: every key here is documented.
function emitConfig(model) {
  return {
    path: '.codex/config.toml',
    content: [
      model.hashHeader('.claude/toolkit-permissions.json and .claude/agents/'),
      '# Project-scoped Codex config. Codex reads it, with .codex/agents, .codex/rules',
      '# and .codex/hooks.json, only after the project is trusted once.',
      '',
      '# The loop edits files in the working tree and asks only when a command falls',
      '# outside .codex/rules/toolkit.rules.',
      'sandbox_mode = "workspace-write"',
      'approval_policy = "on-request"',
      '',
      '# Finders plus up to three M2 skeptics; bounded so a fan-out stays inside a',
      '# Plus quota.',
      '[agents]',
      'max_concurrent_threads_per_session = ' + THREAD_CAP,
      '',
      '# Network is off inside workspace-write by default. The rules file is the',
      '# least-privilege way around that for the loop\'s commands; if one still',
      '# prompts, the documented wider fallback is:',
      '# [sandbox_workspace_write]',
      '# network_access = true',
      '',
    ].join('\n'),
  };
}

// 4. The permission list as Starlark prefix rules, the sandbox escape hatch.
function emitRules(model) {
  const lines = [
    '# ' + model.header('.claude/toolkit-permissions.json'),
    '# Starlark. Each prefix_rule lets one toolkit command prefix run outside the',
    '# Codex sandbox without a prompt (decision "allow"), which the auto loop needs',
    '# for git, gh, npm, the toolkit scripts and codex review. Codex reads this file',
    '# only after the project is trusted once. Test a rule with:',
    '#   codex execpolicy check --pretty --rules .codex/rules/toolkit.rules -- git status',
    '# If a loop command still prompts, the documented wider fallback is',
    '# network_access = true under [sandbox_workspace_write] in .codex/config.toml.',
    '',
  ];
  const seen = new Set();
  for (const g of model.permissionGroups('codex')) {
    const fresh = g.prefixes.filter(p => !seen.has(p));
    if (!fresh.length) continue;
    lines.push('# ' + g.purpose);
    for (const p of fresh) {
      seen.add(p);
      const pattern = p.split(/\s+/).filter(Boolean).map(starlarkString).join(', ');
      lines.push('prefix_rule(pattern=[' + pattern + '], decision="allow", justification=' + starlarkString(g.purpose) + ')');
    }
    lines.push('');
  }
  return { path: '.codex/rules/toolkit.rules', content: lines.join('\n') };
}

// 5. The Stop hook. Bytes are stable across rebuilds (fixed key order, no
//    timestamp), so a rebuild never re-flags it for trust. merge: 'json' lets the
//    core fold it into a hooks.json the user already has. The GENERATED header
//    is the top-level description, the one metadata key the parser accepts.
function emitHooks(model) {
  const doc = {
    // The header rides in the documented top-level description slot: Codex parses
    // hooks.json with serde deny_unknown_fields (codex-rs/config/src/hook_config.rs,
    // HooksFile: description and hooks only), so any other key rejects the file.
    description: model.header('.claude/scripts/chain-hook.js'),
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: HOOK_COMMAND,
              timeout: 30,
              statusMessage: 'toolkit: checking for a queued next stage (M14)',
            },
          ],
        },
      ],
    },
  };
  return { path: '.codex/hooks.json', content: JSON.stringify(doc, null, 2) + '\n', merge: 'json' };
}

function emit(model) {
  return []
    .concat(emitOpenaiYaml(model))
    .concat(emitAgents(model))
    .concat([emitConfig(model), emitRules(model), emitHooks(model)]);
}

module.exports = { emit };
