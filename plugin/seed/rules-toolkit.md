# Toolkit Rules

<!-- Toolkit version: 8.0.13 | Managed by LLM Peer Review. On the plugin, setup seeds this file once and a plugin update never overwrites it; a copy-install update replaces it. -->

This project runs the LLM Peer Review toolkit as the `tk` plugin, so its commands are typed with the `tk:` prefix (`/tk:explore`). This file is the short, always-on part. The full manual (workflow, command table, permissions, git and worktree conventions) is the toolkit's `toolkit-reference` fragment, at `~/.claude/plugins/data/tk-llm-peer-review/current/skills/shared/toolkit-reference.md`. Open it there when a question is not answered here.

## How We Work Together

### Rules

<rules>

1. **Auto by default** - The loop runs automatically per the toolkit's `hitl-loop` and `hitl-stages` fragments (rules M1 to M17), which each loop stage either inlines or cites by path; a human is paged only per M1, stages hand off to each other automatically (M14), and two per-run opt-outs restore manual behavior: "report only" for auto-fixing (M10), "no chaining" for the stage handoff (M14)
2. **Ask questions** - If something is unclear, ask before assuming
3. **Explain simply** - Use plain English, avoid jargon. A rule or finding code (M3, C-21, R5) in anything written for me says in plain words what it is and what it means for me on its first mention, looked up in its own file rather than recalled; that sentence carries no file name, hash or code term, which belong in the receipt row or the step's file list
4. **Show your work** - Tell me what you're doing and why. Before anything expected to take over a minute, say in one line what is coming, and answer every question I ask before moving on
5. **Use the Skill tool for /tk:create-plan, /tk:review, and /tk:review-*** - Never manually replicate these commands or skills. If the user says "create plan" or "review", invoke the appropriate command or skill via the Skill tool so the template is followed.
6. **No em dashes or en dashes** - Never use em dashes or en dashes in any output (conversation, file writes, file edits). Use regular hyphens or rewrite the sentence.
7. **Teach the why** - When explaining, focus on *why* things work so the user can solve similar problems independently next time.

</rules>

### The Workflow

You type `/tk:explore`, approve the plan, and the rest chains (M14): `/tk:explore` -> `/tk:create-plan` -> `/tk:execute` -> `/tk:review` -> `/tk:document`. `/tk:worktree` first when you want an isolated parallel session. `/tk:ask-gpt`, `/tk:ask-gemini`, and `/tk:peer-review` are human-triggered and never chained into.

## Git

- Commit after each green logical unit (M4). Messages start with a verb and keep the first line under 50 characters.
- Every push Claude makes runs the pre-push tripwire first, for that push's destination (M11); a hit blocks the push and pages you. A push you type into a terminal yourself is not checked.
- Releases, version bumps, prompt-file edits, deletions of user data, outward sends, and force pushes always ask (M9).

## Self-Service

If Claude can run it (tests, builds, dev servers, installs, status checks), Claude runs it and reports. A claim with a checkable source (a link, a file, a command, a version, earlier work) is checked there before it is stated; one that cannot be checked says it comes from memory. The user is asked only for screenshots Claude cannot take itself, judgment calls, and destructive actions.

## Your Files

`CLAUDE.md`, `LESSONS.md`, `LESSONS-detail.md`, `DESIGN-PROFILE.md`, `plans/`, and `.claude/settings.local.json` are yours: the toolkit seeds them once and never overwrites them; `/tk:upgrade` may offer the current seed's text for a block of one that is still an older seed's, and applies nothing without your approval. The one exception is the permissions list in `settings.local.json`. Setup backs the file up before any change, adds the toolkit rows it has not offered in this working copy before (so a row you delete stays deleted), and removes rows that point at a `.claude/scripts/` file the project no longer has, plus a few old toolkit rows; `/tk:upgrade` removes the retired toolkit rows the plugin lists, through its audit. Your own commands, skills, agents, and rules under `.claude/` are yours too; `/tk:upgrade` audits them against the toolkit's conventions and fixes what drifted. Toolkit scripts are upstream-only: file an issue rather than patching a copy.

<!-- Project section: the toolkit's seed ends here. Everything below this line is yours: /tk:upgrade never compares it and nothing rewrites it. -->

## Project
