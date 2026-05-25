# HTML Output Rules

<!-- Toolkit version: 4.6.0 | Managed by LLM Peer Review. Do not edit - changes will be overwritten on update. -->

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
| `/document` (cycle summary) | One-page "what shipped this cycle" runs every time `/document` does |

Markdown remains canonical even when HTML is also generated. Claude reads the markdown; HTML is the rendered view for the user.

## Claude's Judgement (everything else)

For all other commands, Claude decides per-output whether HTML adds value. Default is markdown; generate HTML when:

- `/review` family: 3+ findings, OR visual evidence (browser screenshots), OR severity mix spans 2+ levels (e.g., both Blocks and Warns present)
- `/explore` vision-mode summary: 2+ options being compared
- `/ask-gpt` / `/ask-gemini`: 3+ Recommended Actions in the final summary
- `/peer-review`: paired with an `/ask-*` debate that already produced HTML (mirror the upstream decision)
- `/learning-opportunity`: 3+ depth levels with concrete examples at each, OR the concept is interactive (state machines, hashing, retries, etc.)
- `/pair-debug`: 3+ hypotheses tracked

**When in doubt, skip HTML.** Markdown is the default; HTML is additive. Generating HTML for borderline cases creates inconsistent UX from session to session.

## Playground Export-Loop Rule

The `/playground` skill produces throwaway interactive HTML at `/tmp/playground-{timestamp}.html`. Hard rules:

1. **HTML never reads back into the toolkit.** Output is text the user pastes manually into chat. No file modifications to any prompt file, skill file, or rules file.
2. Every playground HTML ends with a **"copy as markdown"** or **"copy as prompt"** button that emits text the user can paste back as a new chat message.
3. Self-contained: one HTML file, inline CSS/JS, no CDN. Works offline.
4. Disposable: lands in `/tmp/`, never in the repo.

## Artifact Locations

| Where HTML lands | When |
|---|---|
| `/tmp/playground-*.html` | Playground throwaways (interactive, disposable) |
| `plans/PLAN-*.html` | Plan renders, alongside `PLAN-*.md`. Gitignored. |
| `artifacts/html/` | Cycle-bound artifacts (document summaries, debate views, explore option comparisons, review reports). Gitignored. |

The `artifacts/html/` directory lives at the project root. It parallels `plans/` and `reports/` (both gitignored user-facing working dirs).

## Opening the Artifact

HTML artifacts are meant to be *viewed rendered in a browser*, not read as source. After writing any HTML file, open it in the user's default browser. Do not just hand the user a file link and stop: in an editor like Cursor or VS Code, clicking a file link opens the HTML source code, which is exactly the friction this rule removes.

Detect the platform and use the first opener that works:

| Platform | Command |
|---|---|
| macOS | `open "<file>"` |
| WSL | `wslview "<file>"`, falling back to `explorer.exe "$(wslpath -w "<file>")"` |
| Linux (no WSL) | `xdg-open "<file>"` |

Then tell the user it opened, with the path, e.g. "Opened the review in your browser: `artifacts/html/review-orchestrator-2026-05-24.html`".

If every opener fails (headless environment, opener not installed), do not retry in a loop. Tell the user the path and that they should open it in a browser, not the editor: "Open this in your browser (not the editor): `<path>`."

The `/playground` skill opens its `/tmp/` file the same way.

## Visual Look

Typography, color tokens, severity badge colors, and the copy-button pattern live in `.claude/skills/shared/html-look.md`. Commands and skills generating HTML inline that file via `` !`cat .claude/skills/shared/html-look.md` ``.

## Your Own Files (downstream projects)

> **Source of truth:** `/audit-html` inlines this section verbatim as its operational rule set. Edits here change skill behavior. Update both together if you ever split them.

Everything above governs the *toolkit's* command outputs. This section covers the project's own markdown files: notes, dashboards, trackers, runbooks, anything in the repo that a human reads.

The principle is the same and has two layers:

1. **Toolkit command outputs already render HTML for you.** `/create-plan`, `/document`, and the `/review-*` family produce HTML views per the rules above. You do not need to do anything for those.
2. **Your project's own long human-read markdown can get an optional HTML view.** Source stays markdown. The HTML view is additive, rendered from the markdown, and never replaces it.

This is *additive and shape-aware*, never a migration. Every project qualifies for the audit; not every project will have a high-value candidate. A philosophy/decide-once project may legitimately yield "nothing here benefits from an HTML view," and that is a valid result.

### Signals (which of your files might want an HTML view)

- **Read-every-session tracker** - a file you (or your team) open repeatedly to find one thing in many. Status boards, progress logs, decision registers.
- **Markdown degrading into walls of text** - long mixed-format pages where scanning fails: dense tables, nested lists, multi-section docs where the eye loses its place.
- **File so long the human hunts instead of reads** - if your default mental move is Ctrl+F, the page is past the point where flat markdown is helping.
- **Existing hand-built HTML view** - the strongest signal. If someone already wrote a small dashboard or script that turns this markdown into HTML, that proves the value and tells the audit not to suggest building a new one.

### Vetoes (these stay markdown no matter how long)

- **Claude-read files** - `CODEBASE_MAP.md`, `PLAN-*.md`, `CLAUDE.md`, `LESSONS.md`, anything Claude parses every session. HTML wastes tokens on re-ingestion.
- **Canonical / data-source / self-description** - if the file *is* the source of truth that other tools or scripts parse, markdown is the contract.
- **GitHub-native** - `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, anything GitHub already renders for you.
- **Lives in `.claude/`** - prompt files, skill files, rules. These are Claude's instructions, not human-read pages.

### The skill that applies this section

`/audit-html` scans the project, applies the signals and vetoes above, and reports which files would benefit from an HTML view. It is report-only by default and never converts the source markdown. On request, it can generate a static view of the top candidate into `artifacts/html/`. It also detects projects that already have an HTML-generation setup (a `package.json` dashboard script, a `.js` that reads markdown and serves/emits HTML) and offers to align that output with the toolkit's visual tokens rather than building something new.

## What HTML Does NOT Cover

These stay markdown regardless of length or complexity:

- `CODEBASE_MAP.md` (Claude reads it, not the user)
- `README.md`, `SETUP.md`, `API-KEYS.md`, `AGENT-SETUP.md`, `CONTRIBUTING.md`, `DEMO-SCRIPT.md` (GitHub renders these natively)
- `CLAUDE.md`, `LESSONS.md`, `.claude/rules/*.md` (read by Claude every session)
- `.claude/commands/*.md`, `.claude/skills/*/SKILL.md` (prompt files)
- `CHANGELOG.md` (per-release notes, GitHub-native)
- `/create-issue` output (issues are markdown on GitHub)

In one line: **markdown for Claude, HTML for the human, playground for the user-doing-something.**
