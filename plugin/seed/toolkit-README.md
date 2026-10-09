# Project extensions for the toolkit

This folder is yours. The LLM Peer Review plugin reads the files below when they exist and changes nothing when they do not, so an empty folder is a normal state. Setup wrote this README once and never touches the folder again; a plugin update never overwrites anything here. `/tk:upgrade` may offer the current seed's text (a seed is the plugin's shipped copy of a project file, the text setup writes in when the file is absent) for a paragraph of this README that is still an older seed's, and applies nothing without your approval.

Use it when your project needs the toolkit to follow a rule of its own: a kind of review the toolkit does not ship, a check every plan must pass, a stricter condition before a fix is applied. The plugin's own files are read-only in your project, so this folder is where that text lives.

## The seven files

Each file has a fixed name. Create only the ones you need.

| File | Read by | What to put in it |
|---|---|---|
| `review-kinds.md` | `/tk:review`, when it picks specialists | Your own review kinds, as table rows (format below) |
| `plan-gate.md` | `/tk:create-plan`, before it writes the plan | A gate every plan in this project must pass, in plain instructions |
| `execute-gate.md` | `/tk:execute`, before it implements a step | A gate every implementation step must pass |
| `fix-rules.md` | every stage that runs the auto-fix loop | Extra conditions before a fix is applied, or extra actions that must always ask you first |
| `severity-anchors.md` | every reviewer | How severe your own kinds' findings are (what is a Block here, what is only a Suggest) |
| `do-not-report.md` | the security reviewers (`/tk:review-security`, `/tk:security-audit`, and the security finder `/tk:review` dispatches), right after the toolkit's own list | Finding categories that are noise in this project, one bullet each (format below) |
| `checks.json` | `/tk:execute`, at its test step, through the toolkit's checks runner | Your project's checks: a JSON array of `{ "id", "check", "expect" }`, for example `[{"id": "tests", "check": "npm test", "expect": {"exit": 0}}]` |

Write each one the way you would brief a colleague: short, direct, in your project's words. The two gates are read before the toolkit's own requirements for that stage; your fix rules, severity anchors and do-not-report entries are read right after the toolkit's.

`checks.json` is the one file that is not prose: a JSON array, each entry a check the runner executes from your project root. `expect` is an object with exactly one of `exit` (the exit code the check must return), `match` (a regex the saved output must contain), `noMatch` (a regex it must not contain) or `lines` (`{"min": 1, "max": 3}`, bounds on the non-empty lines of output); regexes are tested with the multiline flag against the saved output. A prose string in place of the object means the stage reads the saved output and judges it against your sentence. `check` must be a read-only command the runner allows (`npm test`, `pytest`, `grep`, `git log` and the like); one that writes, redirects or substitutes is refused and never run. When this file exists it is the whole test step: the stage runs these checks instead of the project's default `npm test` or `pytest`, so list your test command as one of the entries or it never runs. A check that fails, or one the runner refuses, turns the test step red; the reason is on the runner's output, and each check's saved output sits in the folder the stage names.

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

The agent is dispatched with the same per-run prompt a toolkit finder gets, and its findings go through the same audit. It needs three things. It must say what it returns (an output contract), because the audit parses its findings. It must declare a `tools:` line without Edit, Write or NotebookEdit: an agent with no tools line gets every tool, and a finder that can edit could change files before anyone has judged its findings. And it must carry a `model:` line, `model: inherit` unless you want a particular model: `/tk:review` dispatches your kind with no model, and an agent with no model line follows `CLAUDE_CODE_SUBAGENT_MODEL` whenever a user sets it. `/tk:upgrade` tells you when a row names an agent that does not exist, one that can edit, or one with no model line. It does not check the output contract on every upgrade, so that part is yours to get right.

A preload is a skill named in the agent's `skills:` list, loaded into it before it starts. A minimal agent, saved as `.claude/agents/design-fidelity-finder.md` (its second preload carries the finding contract and the severity anchors the first one refers to; pick the toolkit kind nearest your own):

```
---
name: design-fidelity-finder
description: Checks design files against the brand sheet. Returns findings as JSONL.
tools: Read, Grep, Glob
model: inherit
skills:
  - tk:dispatch-contract
  - tk:review-code-criteria
---

You check files under designs/ against the brand sheet in docs/brand.md.
Report each mismatch as a finding in the dispatch contract's format,
or reply with the literal NO FINDINGS.
```

Your agent can reuse the toolkit's review machinery instead of copying it. List plugin skills in its `skills:` frontmatter by their scoped names, for example `tk:dispatch-contract` (the output format the audit parses) and `tk:review-code-criteria` (the code review criteria), and then add what is specific to your project in the agent's body.

A project kind runs when `/tk:review` detects changes on its own. A focus, such as `/tk:review code`, names toolkit kinds only: your own kind cannot be run by name, and a focused run skips it.

## do-not-report.md

One bullet per category: `- <category> - <why it is noise here>`. Keep entries specific: a vague entry ("style stuff") suppresses real findings, a specific one ("trailing-whitespace-only changes in generated files") does not. An entry only suppresses noise and never lowers a real severity: the toolkit's Universal Anchors (an exposed secret, injection, insecure auth, data loss, an accessibility blocker) win over any match.

## fix-rules.md and the two gates are additive only

Your rules and gates can add a precondition, a requirement or an always-ask action. They cannot remove or loosen one of the toolkit's own loop rules, or waive one of its requirements for that stage: a line that tries to is ignored. `severity-anchors.md` is additive the same way: it sets how severe your own kinds' findings are and cannot lower the toolkit's own floors, because every reviewer that reads it applies the toolkit's Universal Anchors first ("The Universal Anchors above still win").

## Your own lines in the rules file

`.claude/rules/toolkit.md` ends with a marker line that starts `<!-- Project section:`. A rules file seeded before this feature has no such line, and nothing adds it for you: copy the line from the plugin's seed (`~/.claude/plugins/data/tk-llm-peer-review/current/seed/rules-toolkit.md`) to the end of yours. Everything under that line is yours: `/tk:upgrade` never compares it and nothing rewrites it. Keep your own rules for Claude there rather than mixing them into the seeded text above, where a difference is reported on every upgrade.
