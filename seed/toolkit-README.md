# Project extensions for the toolkit

This folder is yours. The LLM Peer Review plugin reads the files below when they exist and changes nothing when they do not, so an empty folder is a normal state. Setup wrote this README once. After that the toolkit writes one file here itself, `adoption.md` (below), and edits nothing else in the folder; a plugin update never overwrites anything here. `/tk:upgrade` may offer the current starter copy's text (the plugin's shipped copy of a project file, which setup writes in when the file is absent) for a paragraph of this README that still matches an older starter copy, and applies nothing without your approval.

Use it when your project needs the toolkit to follow a rule of its own: a review type the toolkit does not ship, a check every plan must pass, a stricter condition before a fix is applied. The plugin's own files are read-only in your project, so this folder is where that text lives.

## The nine files

Each file has a fixed name. Create only the ones you need.

| File | Read by | What to put in it |
|---|---|---|
| `review-kinds.md` | `/tk:review`, when it picks specialists | Your own review types, as table rows (format below) |
| `plan-gate.md` | `/tk:create-plan`, before it writes the plan | A check every plan in this project must pass, in plain instructions |
| `execute-gate.md` | `/tk:execute`, before it implements a step | A check every implementation step must pass |
| `fix-rules.md` | every stage that runs the auto-fix loop | Extra conditions before a fix is applied, or extra actions that must always ask you first |
| `severity-anchors.md` | every reviewer | How severe your own review types' findings are (what is a Block here, what is only a Suggest) |
| `do-not-report.md` | the security reviewers (`/tk:review-security`, `/tk:security-audit`, and the security reviewer `/tk:review` sends out), right after the toolkit's own list | Finding categories that are noise in this project, one bullet each (format below) |
| `checks.json` | `/tk:execute`, at its test step, through the toolkit's checks runner | Your project's checks: a JSON array of `{ "id", "check", "expect" }`, for example `[{"id": "tests", "check": "npm test", "expect": {"exit": 0}}]`; what an `id` and a `check` may contain is spelled out below the table |
| `generated.json` | `/tk:merge`, when it checks and lands a PR | The files your project rebuilds rather than merges, and the command that rebuilds them (format below) |
| `issue-labels.md` | `/tk:create-issue`, before it asks its questions | Your questions, and every label their answers can map to (format below) |

Write each one the way you would brief a colleague: short, direct, in your project's words. The plan check (`plan-gate.md`) and the step check (`execute-gate.md`) are read before the toolkit's own requirements for that stage; your fix rules, severity anchors and do-not-report entries are read right after the toolkit's. `issue-labels.md` is the one prose file that replaces the toolkit's lists rather than adding to them: when it lists questions or labels, `/tk:create-issue` uses those instead of its own.

`adoption.md` is the one file here you never write. `/tk:upgrade` adds a section to it at every upgrade: one row for each release-note entry in the range, saying whether the entry touched this project's own files and, when it did, what you decided. The upgrade's stamp reads it and does not finish until every entry has a row; no stage reads it as instructions. Keep it in git.

`checks.json` is the one file that is not prose: a JSON array, each entry a check the runner executes from your project root. `id` names the file the check's output is saved as, so it is letters, digits, dot, underscore and hyphen only, starts with a letter or digit, is at most 81 characters long and is unique in the file; the runner reads the whole file before it runs anything, so one id that breaks a rule (a space, a slash, a duplicate) stops every check in the file. `expect` is an object with exactly one of `exit` (the exit code the check must return), `match` (a regex the saved output must contain), `noMatch` (a regex it must not contain) or `lines` (`{"min": 1, "max": 3}`, bounds on the non-empty lines of output); regexes are tested with the multiline flag against the saved output. A prose string in place of the object is refused, like any malformed `expect`: the check still runs and saves its output, but it proves nothing and turns the test step red. When this file exists it is the whole test step: the stage runs these checks instead of the project's default `npm test` or `pytest`, so list your test command as one of the entries or it never runs. A check that fails, or one the runner refuses, turns the test step red; the reason is on the runner's output, and each check's saved output sits in the folder the stage names.

`check` must start with a word the runner allows, and so must each command after a `|`, `;`, `&&` or `||`; the runner is a guard, not a shell, and it decides before anything runs. The test entry points: `npm test` and `npm run test`, `lint`, `typecheck` or `check` (also `test:<word>` and `check:<word>`); `npx jest`, `vitest`, `mocha`, `ava`, `tap`, `playwright`, `tsc` or `eslint`; `pytest` and `python -m pytest` (or `python3`); `go test` and `go vet`; `cargo test`, `check` or `clippy`; `make test`, `check` or `lint`; `yarn test`, `pnpm test`, `bun test`, `uv run pytest`, `poetry run pytest`, `bundle exec rspec` and `dotnet test`. The readers: `grep`, `sed -n`, `cat`, `head`, `tail`, `wc`, `test`, `diff`, `jq`, `ls`, `find` and a few more plain filters (`rg`, `sort`, `cut`, `uniq`, `stat`, `echo` and the like), each with its writing flags refused (`sed -i`, `find -exec`, `sort -o`, the flags that follow symbolic links while walking: `grep -R`, `rg --follow`, `find -L`, `diff -r`, and the readers that open every file a folder or a list names: `diff` on a folder, `--files0-from`); the read-only `git` subcommands (`log`, `show`, `diff`, `status`, `blame`, `ls-files` and the other readers, `branch` only as a listing); and `node` only for the toolkit's own `session-init.js`, `merge-findings.js`, `pre-push-check.js` and `upgrade-audit.js`. Anything else, and any redirect, command substitution, subshell, variable expansion, unquoted wildcard (quote a pattern; the runner expands nothing) or path outside the project, is refused and the check reads as a refused check, which turns the test step red. Write a yarn, pnpm or bun project's test command exactly as listed; a tool that is not on the list goes behind a `check:<word>` script in your `package.json` or a `make check` target, which the runner allows because that code is yours.

`generated.json` is the other JSON file: an array of `{ "paths": [...], "rebuild": "<command>" }`, for example `[{ "paths": ["dist/"], "rebuild": "npm run build" }]`. A path is a repository path; a folder ends in `/`. `/tk:merge` leaves these paths out of its lost-work checks, because a landing rebuilds them rather than merging them: on a conflict it takes main's side and runs `rebuild` from your project root, as an ordinary command under your permission rules.

## review-kinds.md

One table, in the same three columns `/tk:review` uses for its own review types:

```
| What changed | Specialist | Finder agent |
|---|---|---|
| files under `designs/` or any `.fig.json` | Design Fidelity | `subagent_type=design-fidelity-finder` |
```

- **What changed** says which files select the review type.
- **Specialist** is the name the review report shows.
- **Finder agent** names an agent of your own under `.claude/agents/`, without the `tk:` prefix. The toolkit's review types are already in the table, so a `tk:` name here is a mistake.

The agent is dispatched with the same per-run prompt a toolkit reviewer gets, and its findings go through the same double-check. It needs three things. It must say what it returns (an output contract), because the double-check reads its findings. It must declare a `tools:` line without Edit, Write or NotebookEdit: an agent with no tools line gets every tool, and a reviewer that can edit could change files before anyone has judged its findings. And it must carry a `model:` line, `model: inherit` unless you want a particular model: `/tk:review` sends out your review type with no model, and an agent with no model line follows `CLAUDE_CODE_SUBAGENT_MODEL` whenever a user sets it. `/tk:upgrade` tells you when a row names an agent that does not exist, one that can edit, or one with no model line. It does not check the output contract on every upgrade, so that part is yours to get right.

A preload is a skill named in the agent's `skills:` list, loaded into it before it starts. A minimal agent, saved as `.claude/agents/design-fidelity-finder.md` (its second preload carries the finding contract and the severity anchors the first one refers to; pick the toolkit review type nearest your own):

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

Your agent can reuse the toolkit's review machinery instead of copying it. List plugin skills in its `skills:` frontmatter by their scoped names, for example `tk:dispatch-contract` (the output format the double-check reads) and `tk:review-code-criteria` (the code review criteria), and then add what is specific to your project in the agent's body.

A review type of your own runs when `/tk:review` detects changes on its own. A focus, such as `/tk:review code`, names the toolkit's review types only: yours cannot be run by name, and a focused run skips it.

## do-not-report.md

One bullet per category: `- <category> - <why it is noise here>`. Keep entries specific: a vague entry ("style stuff") suppresses real findings, a specific one ("trailing-whitespace-only changes in generated files") does not. An entry only suppresses noise and never lowers a real severity: the toolkit's Universal Anchors (an exposed secret, injection, insecure auth, data loss, an accessibility blocker) win over any match.

## issue-labels.md

Two short lists: the questions `/tk:create-issue` asks before it files an issue, and every label the answers can map to. For example:

```
Questions:
- Area: web or api?
- Kind: bug, feature or chore?
- Priority? (high/medium/low)

Labels:
- `area-web`, `area-api`
- `bug`, `feature`, `chore`
- `priority-high`, `priority-medium`, `priority-low`
```

The command applies only labels listed here, so list every label you use: a label you retire and leave off the list is never applied again. Each list replaces the toolkit's own only when it has entries. A file with questions but no labels keeps the toolkit's label set, and a file with neither (only a comment, or nothing) changes nothing. This matters most on GitLab, which creates any label an issue names: a label outside your list would come back as a new one without a word.

## fix-rules.md, plan-gate.md and execute-gate.md only add rules

These three files can add a precondition, a requirement or an always-ask action. They cannot remove or loosen one of the toolkit's own loop rules, or waive one of its requirements for that stage: a line that tries to is ignored. `severity-anchors.md` is additive the same way: it sets how severe your own review types' findings are and cannot lower the toolkit's own floors, because every reviewer that reads it applies the toolkit's Universal Anchors first ("The Universal Anchors above still win").

## Your own lines in the rules file

`.claude/rules/toolkit.md` ends with a marker line that starts `<!-- Project section:`. A rules file written before this feature has no such line, and nothing adds it for you: copy the line from the plugin's starter copy (`~/.claude/plugins/data/tk-llm-peer-review/current/seed/rules-toolkit.md`) to the end of yours. Everything under that line is yours: `/tk:upgrade` never compares it and nothing rewrites it. Keep your own rules for Claude there rather than mixing them into the starter text above, where a difference is reported on every upgrade.
