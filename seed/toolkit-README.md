# Project extensions for the toolkit

This folder is yours. The LLM Peer Review plugin reads the files below when they exist and changes nothing when they do not, so an empty folder is a normal state. Setup wrote this README once and never touches the folder again; a plugin update never overwrites anything here.

Use it when your project needs the toolkit to follow a rule of its own: a kind of review the toolkit does not ship, a check every plan must pass, a stricter condition before a fix is applied. The plugin's own files are read-only in your project, so this folder is where that text lives.

## The five files

Each file has a fixed name. Create only the ones you need.

| File | Read by | What to put in it |
|---|---|---|
| `review-kinds.md` | `/tk:review`, when it picks specialists | Your own review kinds, as table rows (format below) |
| `plan-gate.md` | `/tk:create-plan`, before it writes the plan | A gate every plan in this project must pass, in plain instructions |
| `execute-gate.md` | `/tk:execute`, before it implements a step | A gate every implementation step must pass |
| `fix-rules.md` | every stage that runs the auto-fix loop | Extra conditions before a fix is applied, or extra actions that must always ask you first |
| `severity-anchors.md` | every reviewer | How severe your own kinds' findings are (what is a Block here, what is only a Suggest) |

Write each one the way you would brief a colleague: short, direct, in your project's words. The two gates are read before the toolkit's own requirements for that stage; your fix rules and severity anchors are read right after the toolkit's.

## review-kinds.md

One table, in the same three columns `/tk:review` uses for its own kinds:

```
| What changed | Specialist | Finder agent |
|---|---|---|
| files under `designs/` or any `.fig.json` | Design Fidelity | `subagent_type=design-fidelity-finder` |
```

- **What changed** says which files select the kind.
- **Specialist** is the name the review report shows.
- **Finder agent** names an agent of your own under `.claude/agents/`, without the `tk:` prefix. The toolkit's kinds are already in the table, so a `tk:` name here is a mistake.

The agent is dispatched with the same per-run prompt a toolkit finder gets, and its findings go through the same audit. It needs two things. It must say what it returns (an output contract), because the audit parses its findings. And it must declare a `tools:` line without Edit, Write or NotebookEdit: an agent with no tools line gets every tool, and a finder that can edit could change files before anyone has judged its findings. `/tk:upgrade` tells you when a row names an agent that does not exist, or one that can edit. It does not check the output contract on every upgrade, so that part is yours to get right.

A minimal agent, saved as `.claude/agents/design-fidelity-finder.md`:

```
---
name: design-fidelity-finder
description: Checks design files against the brand sheet. Returns findings as JSONL.
tools: Read, Grep, Glob
skills:
  - tk:dispatch-contract
---

You check files under designs/ against the brand sheet in docs/brand.md.
Report each mismatch as a finding in the dispatch contract's format,
or reply with the literal NO FINDINGS.
```

Your agent can reuse the toolkit's review machinery instead of copying it. List plugin skills in its `skills:` frontmatter by their scoped names, for example `tk:dispatch-contract` (the output format the audit parses) and `tk:review-code-criteria` (the code review criteria), and then add what is specific to your project in the agent's body.

A project kind runs when `/tk:review` detects changes on its own. A focus, such as `/tk:review code`, names toolkit kinds only: your own kind cannot be run by name, and a focused run skips it.

## fix-rules.md is additive only

Your rules can add a precondition or an always-ask action. They cannot remove or loosen one of the toolkit's own loop rules: a line that tries to is ignored.

## Your own lines in the rules file

`.claude/rules/toolkit.md` ends with a marker line that starts `<!-- Project section:`. A rules file seeded before this feature has no such line, and nothing adds it for you: copy the line from the plugin's seed (`~/.claude/plugins/data/tk-llm-peer-review/current/seed/rules-toolkit.md`) to the end of yours. Everything under that line is yours: `/tk:upgrade` never compares it and nothing rewrites it. Keep your own rules for Claude there rather than mixing them into the seeded text above, where a difference is reported on every upgrade.
