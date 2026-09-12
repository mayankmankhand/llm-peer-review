# Toolkit Rules

<!-- Toolkit version: 7.0.0 | Managed by LLM Peer Review. Do not edit - changes will be overwritten on update. -->

This project runs the LLM Peer Review toolkit as a Claude Code plugin named `tk`, so its commands are typed with that prefix (`/tk:explore`). This file is the short, always-on part. The full manual (workflow, command table, permissions, git and worktree conventions) is the toolkit's `toolkit-reference` fragment: it ships inside the plugin, and its stable path on this machine is `~/.claude/plugins/data/tk-llm-peer-review/current/skills/shared/toolkit-reference.md`; open it there when a question is not answered here. In the toolkit's own repository the same commands run unprefixed.

## How We Work Together

### CRITICAL RULES

<rules>

1. **Auto by default** - The loop runs automatically per the toolkit's `hitl-loop` fragment (rules M1 to M15), which every loop stage carries in its own prompt; a human is paged only per M1, stages hand off to each other automatically (M14), and two per-run opt-outs restore manual behavior: "report only" for auto-fixing (M10), "no chaining" for the stage handoff (M14)
2. **Ask questions** - If something is unclear, ask before assuming
3. **Explain simply** - Use plain English, avoid jargon
4. **Show your work** - Tell me what you're doing and why
5. **Use the Skill tool for /tk:create-plan, /tk:review, and /review-*** - Never manually replicate these commands or skills. If the user says "create plan" or "review", invoke the appropriate command or skill via the Skill tool so the template is followed.
6. **No em dashes or en dashes** - Never use em dashes or en dashes in any output (conversation, file writes, file edits). Use regular hyphens or rewrite the sentence.
7. **Teach the why** - When explaining, focus on *why* things work so the user can solve similar problems independently next time.

</rules>

### The Workflow

You type `/tk:explore`, approve the plan, and the rest chains (M14): `/tk:explore` -> `/tk:create-plan` -> `/tk:execute` -> `/tk:review` -> `/tk:document`. `/tk:worktree` first when you want an isolated parallel session. `/tk:ask-gpt`, `/tk:ask-gemini`, and `/tk:peer-review` are human-triggered and never chained into.

## Git

- Commit after each green logical unit (M4). Messages start with a verb and keep the first line under 50 characters.
- Every push runs the pre-push tripwire first (M11); a hit blocks the push and pages you.
- Releases, version bumps, prompt-file edits, deletions of user data, outward sends, and force pushes always ask (M9).

## Self-Service

If Claude can run it (tests, builds, dev servers, installs, status checks), Claude runs it and reports. The user is asked only for screenshots, judgment calls, and destructive actions.

## Your Files

`CLAUDE.md`, `LESSONS.md`, `LESSONS-detail.md`, `DESIGN-PROFILE.md`, `plans/`, and `.claude/settings.local.json` are yours: the toolkit seeds them once and never overwrites them. Your own commands, skills, agents, and rules under `.claude/` are yours too; `/tk:upgrade` audits them against the toolkit's conventions and fixes what drifted. Toolkit scripts are upstream-only: file an issue rather than patching a copy.
