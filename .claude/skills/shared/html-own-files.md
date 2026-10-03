# HTML for Your Own Files

## Your Own Files (downstream projects)

> **Source of truth:** `/audit-html` inlines this file as its operational rule set, so an edit here changes what it does.

`html-outputs.md` governs the *toolkit's* command outputs. This file covers the project's own markdown files: notes, dashboards, trackers, runbooks, anything in the repo that a human reads.

The principle is the same and has two layers:

1. **Toolkit command outputs already render HTML for you.** `/create-plan`, `/document`, and the `/review-*` family produce HTML views per `html-outputs.md`. You do not need to do anything for those.
2. **Your project's own long human-read markdown can get an optional HTML view.** Source stays markdown. The HTML view is additive, rendered from the markdown, and never replaces it.

This is *additive and shape-aware*, never a migration. Every project qualifies for the audit; not every project will have a high-value candidate. A philosophy/decide-once project may legitimately yield "nothing here benefits from an HTML view," and that is a valid result.

### Signals (which of your files might want an HTML view)

- **Read-every-session tracker** - a file you (or your team) open repeatedly to find one thing in many. Status boards, progress logs, decision registers.
- **Markdown degrading into walls of text** - long mixed-format pages where scanning fails: dense tables, nested lists, multi-section docs where the eye loses its place.
- **File so long the human hunts instead of reads** - if your default mental move is Ctrl+F, the page is past the point where flat markdown is helping.
- **Existing hand-built HTML view** - the strongest signal. If someone already wrote a small dashboard or script that turns this markdown into HTML, that proves the value and tells the audit not to suggest building a new one.

### Vetoes (these stay markdown no matter how long)

- **Claude-read files** - `CODEBASE_MAP.md`, `PLAN-*.md`, `CLAUDE.md`, `LESSONS.md`, `LESSONS-detail.md` (the index is parsed every session, the detail on demand), `DESIGN-PROFILE.md` (read before any design work), anything else Claude parses every session. HTML wastes tokens on re-ingestion.
- **Canonical / data-source / self-description** - if the file *is* the source of truth that other tools or scripts parse, markdown is the contract.
- **Host-native** - `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, anything GitHub or GitLab already renders for you.
- **Lives in `.claude/`** - prompt files, skill files, rules. These are Claude's instructions, not human-read pages.

### The skill that applies this section

`/audit-html` scans the project, applies the signals and vetoes above, and reports which files would benefit from an HTML view. It is report-only by default and never converts the source markdown. On request, it can generate a static view of the top candidate into `artifacts/html/`. It also detects projects that already have an HTML-generation setup (a `package.json` dashboard script, a `.js` that reads markdown and serves/emits HTML) and offers to align that output with the toolkit's visual tokens rather than building something new.

## What HTML Does NOT Cover

These stay markdown regardless of length or complexity:

- `CODEBASE_MAP.md` (Claude reads it, not the user)
- `README.md`, `SETUP.md`, `API-KEYS.md`, `AGENT-SETUP.md`, `CONTRIBUTING.md`, `DEMO-SCRIPT.md` (GitHub and GitLab render these natively)
- `CLAUDE.md`, `LESSONS.md` (index, read every session), `LESSONS-detail.md` (read on demand), `DESIGN-PROFILE.md` (read before design work), `.claude/rules/*.md` (read by Claude every session)
- `.claude/commands/*.md`, `.claude/skills/*/SKILL.md` (prompt files)
- `CHANGELOG.md` (per-release notes, host-native)
- `/create-issue` output (issues are markdown on GitHub and GitLab alike)

In one line: **markdown for Claude, HTML for the human, playground for the user-doing-something.**
