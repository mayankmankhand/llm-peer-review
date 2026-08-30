# HTML Output Rules

<!-- Toolkit version: 5.5.0 | Managed by LLM Peer Review. Do not edit - changes will be overwritten on update. -->

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
- `/audit-html`: 5+ candidates listed in the report
- `/learning-opportunity` (planned - not yet wired): 3+ depth levels with concrete examples at each, OR the concept is interactive (state machines, hashing, retries, etc.)
- `/pair-debug` (planned - not yet wired): 3+ hypotheses tracked

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
| `artifacts/html/` | Cycle-bound artifacts (review reports, document summaries, debate views, explore option comparisons, audit reports) - timestamped. Also: `/audit-html` static views (via `--stable`, not timestamped). Gitignored. |
| `artifacts/html/index.jsonl` | One appended JSON line per published artifact (type, name, local path, URL, timestamp). Written and read by `render-html.js`, never edited by hand. Gitignored with the rest of `artifacts/html/`. |

The `artifacts/html/` directory lives at the project root. It parallels `plans/` and `reports/` (both gitignored user-facing working dirs).

### Generation mechanism (render-html.js)

The seven helper-rendered output types (review, document, explore, debate, audit, plan, docview) are NOT hand-written. Each command produces a compact JSON payload and runs the shared helper, which injects that JSON plus the shared `tokens.css` into a prebuilt shell and writes the file:

```
node .claude/scripts/render-html.js --shell <review|debate|document|explore|audit|plan|docview> --name <basename> --data <json-file> [--out-dir <dir>] [--stable]
```

By default the helper computes a unique timestamped name `<basename>-YYYY-MM-DD-HHMMSS.html` (with a `-N` guard for same-second runs), creates `artifacts/html/`, overwrites freely, and prints the output path to stdout. This is what keeps the open fast and collision-free (issues #120, #127): the command emits only the small JSON, never the boilerplate, and there is never a read-then-overwrite cycle. The prebuilt shells live in `.claude/skills/shared/shells/`; each documents its own JSON schema in a header comment.

The two identity-keyed types use `--stable`, which writes exactly `<basename>.html` (no timestamp, no `-N` guard) and replaces the file on re-run - the right behavior for views that pair with a markdown file (issue #129): plan HTML (`--shell plan --out-dir plans --stable` -> `plans/PLAN-<basename>.html`, replaced on re-plan) and the `/audit-html` opt-in static view (`--shell docview --stable` -> `artifacts/html/<source-basename>.html`, replaced when regenerated).

**Exception** (still hand-rendered, NOT via the helper): `/playground` throwaways (`/tmp/`, interactive).

## Opening the Artifact

HTML artifacts are meant to be *viewed rendered in a browser*, not read as source. After an HTML file is written by `render-html.js` (all seven artifact types - the helper prints the path), open it in the user's default browser. Do not just hand the user a file link and stop: in an editor like Cursor or VS Code, clicking a file link opens the HTML source code, which is exactly the friction this rule removes.

Open it with the toolkit's opener script, which tries each platform launcher in
order with real fallback and only fails when the environment is genuinely headless:

```bash
bash .claude/scripts/open-artifact.sh "<file>"
```

Pass the absolute path `render-html.js` printed (the script resolves either an absolute or a project-relative path). It handles macOS (`open`), WSL (PowerShell `Start-Process`, located on PATH or by full path, then `explorer.exe`), and Linux (`xdg-open`). It exits `0` when a launcher succeeded, `1` when every launcher failed or the path did not resolve; on WSL the headless message also prints the Windows-side (UNC) path so it can be pasted into a Windows browser.

- **On exit 0:** tell the user it opened, with the path, e.g. "Opened the review in your browser: `artifacts/html/review-orchestrator-2026-05-24.html`".
- **On exit 1:** do not retry in a loop. The script already prints the "open this in your browser (not the editor)" guidance with the path, so relay that rather than restating it. If the path may be wrong, re-check it resolves from the project root before assuming the environment is headless.

The `/playground` skill does NOT auto-open (its output is throwaway `/tmp/` HTML the user pastes back, per the Playground Export-Loop Rule); it emits a clickable `file://` link in chat instead (see `.claude/skills/playground/SKILL.md`).

## Publishing the Artifact (second viewport)

Opening the file locally, above, always happens. This section adds a *second* place the same artifact can be viewed: a private Claude-hosted page. It is additive and never a replacement. If anything here is skipped or fails, the user still has the local file and the local open already succeeded.

**The gate is countable.** Publish only when a tool for publishing a file to a hosted artifact page is present in this session's tool list. When it is not (Cursor, or the feature is off for that user), skip this section silently. Do not mention it, do not apologise, do not suggest switching editors. They already have the artifact.

**Consent, once per session.** Publishing sends the rendered file to a Claude-hosted URL. Before the FIRST publish of a session, ask once. A yes covers every artifact type for the rest of that session, including review reports carrying security findings. A no holds for the session too: skip silently thereafter. The answer lives in conversation context, not on disk, so a context compaction can lose it and the next publish asks again. That is expected, not a bug.

**Naming is already handled.** `render-html.js` writes the payload's title into the page's `<title>`, and that tag is what names the published page. A title passed alongside the file is ignored when the file carries its own tag.

**Two publish modes, matching how the file is named.**

| Types | File naming | Publish behavior |
|---|---|---|
| review, document, explore, debate, audit | timestamped, one file per run | publish a new page each run |
| plan, docview | `--stable`, one file per identity | update the one page for that identity |

For a stable type, look up its recorded page first:

```bash
node .claude/scripts/render-html.js --index-url --name <name>
```

It prints a URL when one has been recorded, nothing when it has not. When a URL comes back, update that page instead of publishing a new one: a plan link that changes on every re-plan is worse than no link. When nothing comes back, publish a new page.

**Record every publish.** Immediately after a successful publish:

```bash
node .claude/scripts/render-html.js --index-add --type <shell> --name <name> \
     --local <path> --url <url>
```

`<name>` must be the exact `--name` value used for the render, because that is the key `--index-url` looks up. The helper creates `artifacts/html/` if needed, timestamps the record itself, and appends one JSON line. It is never read-then-rewritten, so concurrent sessions cannot clobber each other.

**Failure is not an error.** If a publish does not go through, say so in at most one line and move on. Do not retry in a loop. Nothing is lost.

**What to tell the user.** One line with the link, alongside the local path you already reported: "Also published it: <url>".

## Visual Look

Typography, color tokens, severity badge colors, and the copy-button pattern live in `.claude/skills/shared/html-look.md`. For the seven helper-rendered artifact types (review, document, explore, debate, audit, plan, docview), those tokens are embodied in `.claude/skills/shared/shells/tokens.css`, which `render-html.js` inlines into every shell at render time - the commands no longer inline `html-look.md` themselves. `tokens.css` mirrors `html-look.md`; update both together when the look changes.

The remaining hand-rendered HTML (`/playground` only) still inlines or reads `html-look.md` directly, since it does not go through a shell.

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

- **Claude-read files** - `CODEBASE_MAP.md`, `PLAN-*.md`, `CLAUDE.md`, `LESSONS.md`, `LESSONS-detail.md` (the index is parsed every session, the detail on demand), anything else Claude parses every session. HTML wastes tokens on re-ingestion.
- **Canonical / data-source / self-description** - if the file *is* the source of truth that other tools or scripts parse, markdown is the contract.
- **Host-native** - `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, anything GitHub or GitLab already renders for you.
- **Lives in `.claude/`** - prompt files, skill files, rules. These are Claude's instructions, not human-read pages.

### The skill that applies this section

`/audit-html` scans the project, applies the signals and vetoes above, and reports which files would benefit from an HTML view. It is report-only by default and never converts the source markdown. On request, it can generate a static view of the top candidate into `artifacts/html/`. It also detects projects that already have an HTML-generation setup (a `package.json` dashboard script, a `.js` that reads markdown and serves/emits HTML) and offers to align that output with the toolkit's visual tokens rather than building something new.

## What HTML Does NOT Cover

These stay markdown regardless of length or complexity:

- `CODEBASE_MAP.md` (Claude reads it, not the user)
- `README.md`, `SETUP.md`, `API-KEYS.md`, `AGENT-SETUP.md`, `CONTRIBUTING.md`, `DEMO-SCRIPT.md` (GitHub and GitLab render these natively)
- `CLAUDE.md`, `LESSONS.md` (index, read every session), `LESSONS-detail.md` (read on demand), `.claude/rules/*.md` (read by Claude every session)
- `.claude/commands/*.md`, `.claude/skills/*/SKILL.md` (prompt files)
- `CHANGELOG.md` (per-release notes, host-native)
- `/create-issue` output (issues are markdown on GitHub and GitLab alike)

In one line: **markdown for Claude, HTML for the human, playground for the user-doing-something.**
