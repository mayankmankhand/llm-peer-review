# HTML Output Rules

<!-- Toolkit version: 7.5.1 | Managed by LLM Peer Review. Do not edit - changes will be overwritten on update. -->

## Purpose

Documents when toolkit commands produce HTML output, why, and how that HTML must behave. Exists so HTML treatment stays consistent across `/create-plan`, `/review-*`, `/document`, `/explore`, `/ask-*`, `/codebase-to-course`, and the `/playground` skill, without each command's prompt restating the rules.

## Reader/Claude Principle (core rule)

Three categories govern format:

| What | Format | Why |
|---|---|---|
| Outputs Claude reads later (`CODEBASE_MAP.md`, `PLAN-*.md`, shared templates, command/skill prompts, rules) | Markdown, always | Claude parses markdown reliably; HTML is wasted tokens for re-ingestion |
| Outputs the user reads (review reports, plan progress, debate summaries, cycle summaries, explainers) | Markdown by default. HTML when (a) the command is on the default-on list, OR (b) Claude judges HTML adds value | Most outputs stay markdown for speed; HTML is reserved for moments where scan-ability or comparison genuinely changes the experience |
| Outputs the user *does something with* (compare options, drag/order, tune values, click through) | HTML playground (interactive) | Static markdown cannot support the loop |

When Claude generates HTML in the judgement category, it announces upfront:

> "Generating an HTML view because [reason]. Say 'skip HTML' if you want markdown only."

## Default-on Commands

HTML is always generated for these. No judgement call.

| Command | Reason |
|---|---|
| `/codebase-to-course` | Already HTML today |
| `/create-plan` | Plans are always long. Dual-track (markdown canonical + HTML view) is always worth it |
| `/document` (cycle summary) | The standing page telling what changed this cycle and why, refreshed every time `/document` runs |
| `/explore` design step, load level new | The three-prototype playground always fires (`.claude/skills/shared/design-rules.md`): picking between rendered designs is a user-doing-something loop, not a judgement call |

Markdown remains canonical even when HTML is also generated. Claude reads the markdown; HTML is the rendered view for the user.

## Claude's Judgement (everything else)

For all other commands, Claude decides per-output whether HTML adds value. Default is markdown; generate HTML when:

- `/review` family: whenever the run has any surviving finding, or the standing page `artifacts/html/review.html` already exists (so a clean run can take it to empty)
- `/explore` vision-mode summary: 2+ options being compared
- `/ask-gpt` / `/ask-gemini`: 3+ Recommended Actions in the final summary
- `/audit-html`: 5+ candidates listed in the report

**When in doubt, skip HTML.** Markdown is the default; HTML is additive. Generating HTML for borderline cases creates inconsistent UX from session to session.

## Artifact Locations

| Where HTML lands | When |
|---|---|
| `/tmp/playground.*/` | Playground throwaways (interactive, disposable), one fresh folder per page |
| `plans/PLAN-*.html` | Plan renders, alongside `PLAN-*.md`. Gitignored. |
| `artifacts/html/` | Cycle-bound artifacts (debate views, explore option comparisons, audit reports) - timestamped. Also the three `--stable` views, not timestamped: the standing review page `review.html`, the standing cycle summary `cycle.html`, and `/audit-html` static views. Gitignored. |
| `artifacts/html/index.jsonl` | One appended JSON line per published artifact (type, name, local path, URL, timestamp). Written and read by `render-html.js`, never edited by hand. It is the record; each published local file also carries its URL on line 1 as `<!-- hosted: <url> -->`, a derived copy that `--index-sync` regenerates from the newest record per file. Gitignored with the rest of `artifacts/html/`. |

The `artifacts/html/` directory lives at the project root. It parallels `plans/` and `reports/` (both gitignored user-facing working dirs).

### Generation mechanism (render-html.js)

The seven helper-rendered output types (review, document, explore, debate, audit, plan, docview) are NOT hand-written. Each command produces a compact JSON payload and runs the shared helper, which injects that JSON plus the shared `tokens.css` into a prebuilt shell and writes the file:

```
node .claude/scripts/render-html.js --shell <review|debate|document|explore|audit|plan|docview> --name <basename> --data <json-file> [--out-dir <dir>] [--stable] [--no-abs]
```

By default the helper computes a unique timestamped name `<basename>-YYYY-MM-DD-HHMMSS.html` (with a `-N` guard for same-second runs), creates `artifacts/html/`, needs no read-before-write step, and prints the output path to stdout. This is what keeps the open fast and collision-free: the command emits only the small JSON, never the boilerplate, and there is never a read-then-overwrite cycle. The prebuilt shells live in `.claude/skills/shared/shells/`; each documents its own JSON schema in a header comment.

The four identity-keyed types use `--stable`, which writes exactly `<basename>.html` (no timestamp, no `-N` guard) and replaces the file on re-run - the right behavior for a view whose identity outlives any one run: plan HTML (`--shell plan --out-dir plans --stable` -> `plans/PLAN-<basename>.html`, replaced on re-plan), the standing review page (`--shell review --stable` -> `artifacts/html/review.html`, replaced on every review run), the standing cycle summary (`--shell document --name cycle --stable` -> `artifacts/html/cycle.html`, replaced on every `/document` run - note the shell and the name differ here, and the name is the index key), and the `/audit-html` opt-in static view (`--shell docview --stable` -> `artifacts/html/<source-basename>.html`, replaced when regenerated).

**Exceptions.** Two pages are written by hand rather than rendered through the helper: `/playground` throwaways (`/tmp/`, interactive) and the `/codebase-to-course` course, which opens locally and is not published.

## Temporary folders

Every toolkit step that needs a scratch file (a render payload, a browser action list, an issue or PR body, a media prompt, a playground page) makes a fresh folder for it the same way, in three separate moves, so a session in default permission mode never stops to ask. Call sites name only their folder prefix and point here.

1. **Make the folder with a call of its own.** Run `mktemp -d /tmp/<prefix>.XXXXXX` as one Bash call: never inside `$(...)`, never joined to another command with `&&`, `;` or `|`. It prints the path of a new, empty folder that no other run shares, so two projects or sessions working at once never overwrite each other's files. The prefix says what the folder is for (`plan-render`, `review-render`, `host-text`).
2. **Write files with the file-writing tool.** Put each file into that folder with the Write tool, never `echo`, a heredoc, or a `>` redirect: default permission mode asks before any command that redirects output, even into `/tmp`.
3. **Pass the printed path as literal words.** Type the folder path `mktemp` printed into each later command in full (`--data /tmp/plan-render.Ab12Cd/data.json`). A shell variable does not survive from one Bash call to the next, and a command substitution asks for approval even when the command inside it is allowed.

## Showing the Page

How a rendered page reaches the user (the `--no-abs` render, the private hosted page and its record, and the local open) is in `.claude/skills/shared/html-viewing.md`.
