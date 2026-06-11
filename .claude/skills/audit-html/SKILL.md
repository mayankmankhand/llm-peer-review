---
name: audit-html
description: Scan a project's own markdown for files that would benefit from an HTML view. Report-only by default; opt-in static view generation. Treats HTML as additive (markdown stays canonical) and detects projects that already generate HTML.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Bash
---

# Audit HTML

**Use this when:** You want to know which of *your own* long human-read markdown files (status trackers, dashboards, decision logs, runbooks) would benefit from an HTML view alongside the markdown source.

**Don't use this when:** You want to render an existing toolkit output (`/create-plan`, `/document`, `/review-*` already produce HTML themselves), generate an interactive playground (`/playground`), or convert your markdown into HTML and throw away the source (this skill is additive and never converts).

## Critical Rules

<rules>

1. **REPORT ONLY by default.** Do NOT generate any HTML view, edit the source markdown, or modify any file unless the user explicitly asks for it after seeing the report.
2. **HTML is additive, never a migration.** The source markdown stays canonical. Any view generated reads from the markdown; it does not replace it.
3. **Every project qualifies; not every project has a high-value candidate.** "Nothing here benefits from an HTML view" is a valid result. Do not invent candidates to fill the report.
4. **Never rebuild what exists.** If the project already has HTML-generation infrastructure (a `package.json` dashboard script, a `.js` that reads markdown and emits/serves HTML), do not propose building a new view. Offer to align the existing output with toolkit visual tokens instead.

</rules>

## Principle and Signals (single source of truth)

The two-layer principle, signals, and hard vetoes this skill applies are documented in the project's HTML output rules. Inline them so the skill, its docs, and the rules file never drift:

!`cat .claude/rules/html-outputs.md`

The "Your Own Files (downstream projects)" section above defines:
- the two layers (toolkit outputs already HTML-render; your own markdown can get optional additive views)
- the signals (read-every-session tracker, walls of text, hunt-not-read, existing hand-built view)
- the hard vetoes (Claude-read, canonical/data-source, GitHub-native, lives in `.claude/`)

When in doubt during the audit, defer to those definitions rather than guessing.

## Procedure

<procedure>

### 1. Gather the project's markdown

Use `Glob` to enumerate all `.md` files in the project, excluding common build/output directories: `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`, `vendor`, `target`, `__pycache__`. Also exclude `.claude/` (prompt files, vetoed anyway), `plans/PLAN-*.md` (Claude-read), and `artifacts/` (already HTML territory). If the project's `.gitignore` lists additional output directories, exclude those too - Glob does not auto-respect `.gitignore`.

If the project has a `CODEBASE_MAP.md`, read it once for context on which files are "trackers" vs "docs" vs "self-description data" - that map already labels file purposes and saves re-deriving them.

### 2. Detect existing HTML-generation infrastructure

Before evaluating individual files, scan for projects that already render markdown to HTML:

- `package.json` scripts containing `dashboard`, `render`, `html`, `docs:build`, `pages`
- `.js` / `.ts` files that `readFileSync` a `.md` and call `.write` or `res.send` with HTML
- A `public/` or `dist/` folder with `.html` files whose names mirror `.md` files in the repo

If any of these exist, **stop the audit short**. Report the existing setup, do not propose building a new view, and offer two options:
- Align the existing output with the toolkit visual tokens in `.claude/skills/shared/html-look.md` (typography, color palette, severity badge colors)
- Register the existing script as the project's "view-generator of record" by noting it in `CLAUDE.md` so future sessions know not to suggest rebuilding it

### 3. Score each markdown file against signals and vetoes

For every file not excluded by a hard veto, evaluate the signals from `html-outputs.md`:

- **Read-every-session tracker:** look for files in the project root or `docs/` whose contents are dense status tables, progress markers (`✅`, `🟥`, `🟨`, `🟩`, `- [x]`), or repeated section headers indicating tracked items.
- **Markdown degrading into walls of text:** file is over ~200 lines, contains 3+ nested tables, or has long sections (>50 lines) without subheadings.
- **File so long the human hunts instead of reads:** size over ~500 lines, OR the file has 10+ `##`/`###` sections (the human would Ctrl+F rather than scroll).
- **Existing hand-built view:** if a `.html` file mirrors the markdown name, treat it as a strong signal that someone already values the view.

Apply hard vetoes from `html-outputs.md` mercilessly. A vetoed file does not appear in the report, even if it would otherwise score high.

### 4. Write the report

Use the format below. For each candidate, state which signals fired and one short sentence of "why this file specifically." Do not include vetoed files. If no file scores, say so plainly.

### 5. Offer (do not auto-run) the top-candidate view

**If step 4 reported zero candidates, skip this step.** Close with one line like "No candidates this pass; rerun /audit-html after adding new long-form docs." Do not ask about generating a view there is no source for.

Otherwise, after the report, ask: "Want me to generate a static HTML view of the top candidate? It writes to `artifacts/html/`, opens in your browser, and leaves the markdown untouched. Otherwise this is report-only."

Only generate when the user explicitly says yes.

</procedure>

## Output Format

```markdown
# /audit-html report

**Scanned:** N markdown files
**Vetoed:** M files (Claude-read / canonical / GitHub-native / .claude/)
**Existing HTML-generation setup:** yes / no (path if yes)

## Candidates

### 1. `path/to/file.md` (top candidate)
- **Signals:** read-every-session tracker, file so long the human hunts (812 lines, 14 sections)
- **Why this file:** Lists every roadmap item with status; you open it weekly to find one specific row.
- **Source stays markdown.** A view here would surface the table as a sortable, filterable grid alongside the source.

### 2. `docs/runbook.md`
- **Signals:** walls of text (no subheadings between L120-L240)
- **Why this file:** Incident steps are buried in a single 120-line section; on-call scrolls past it under stress.

(...up to 5 candidates...)

## No-action files (vetoed or too short)

A one-line summary of why nothing else scored. List vetoes by category, not by file.
```

If the scan finds an existing HTML-generation setup, the report instead leads with that finding and skips candidate listing:

```markdown
# /audit-html report

**Existing HTML-generation setup detected.** `package.json` script `dashboard` reads `STATUS.md` and emits `public/dashboard.html`.

Two options:
1. Align the existing output with the toolkit's visual tokens (`.claude/skills/shared/html-look.md`) - typography, colors, severity badges. Want me to draft the changes?
2. Register this as the project's view-generator in `CLAUDE.md` so future sessions know not to suggest rebuilding it.

No new view will be built.
```

## HTML Report Judgement

The audit report is itself a human-read multi-item report. Per `html-outputs.md`, render an HTML view of the audit report when 5 or more candidates are listed (the same "3+ findings" gate for `/review-*`, raised to 5 here because audit candidates are softer than review findings).

Do NOT hand-write the HTML. Produce a JSON payload matching the schema documented at the top of `.claude/skills/shared/shells/audit-shell.html` (read its header comment for the exact fields - each candidate has `file`, `verdict`, `signals`, `vetoes`, `reason`). Write the JSON to a temp file, then run the helper from the project root (it computes the timestamped name, creates `artifacts/html/`, overwrites freely, and prints the output path):

`node .claude/scripts/render-html.js --shell audit --name audit-html --data /tmp/audit-data.json`

Open the printed path in the user's browser per the opening rules in `html-outputs.md`: `bash .claude/scripts/open-artifact.sh "<printed-path>"`.

## Static View Generation (opt-in, on request only)

When the user says "yes, generate the view" after seeing the report:

1. Read the source markdown for the top candidate.
2. Do NOT hand-write the HTML. Convert the markdown's structure into a JSON payload matching the schema documented in the header of `.claude/skills/shared/shells/docview-shell.html` (sections with heading/level/blocks; block types: prose, list, table, code). The shell builds the viewing behaviors in once: tables are sortable, long sections collapse automatically (explicit `collapsed: true/false` overrides). Write the payload to a temp file (e.g. `/tmp/docview-data.json`).
3. Run the helper from the project root:
   `node .claude/scripts/render-html.js --shell docview --name <source-basename> --stable --data /tmp/docview-data.json`
   `--stable` writes exactly `artifacts/html/<source-basename>.html` (the default out dir). Do not modify the source markdown. A same-basename re-run overwrites the prior view (latest wins) - unlike the helper-rendered audit report (which is timestamped), this static view is intentionally not timestamped, because it is keyed to the source file's identity. Malformed JSON dies before any file write.
4. Open the printed path in the user's browser: `bash .claude/scripts/open-artifact.sh "<printed-path>"` (per the opening rules in `html-outputs.md`).
5. Confirm in chat: "Opened the view in your browser: `artifacts/html/<basename>.html`. The source markdown is unchanged."

The view is read-only and disposable. It can be regenerated any time the markdown changes; do not build any sync mechanism between them in v1.

## Verify

After implementing or invoking the skill, sanity-check it against this very repo:

- It should flag long human-read files like `LESSONS.md`, `CHANGELOG.md` against signals but then **veto them both** (LESSONS is Claude-read; CHANGELOG is GitHub-native).
- It should veto `CLAUDE.md`, `CODEBASE_MAP.md`, anything in `.claude/`, `PLAN-*.md`.
- For a downstream project, it should flag a status-board file in the project root and pass it through if no veto applies.

If the audit's behavior on this repo does not match the above, the signals or vetoes are misaligned with `html-outputs.md` - fix that file (the single source of truth), not the skill.

<rules>

## REMEMBER: Report only. Generate views only on explicit request. Never modify the source markdown.

</rules>
