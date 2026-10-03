---
name: review-copy
description: Copy clarity and reader orientation review - checks whether content orients a fresh reader. Use for reviewing web pages, blog posts, landing pages, guides, prototypes, and any reader-facing deliverable.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
  - WebSearch
---

# Copy Review

**Use this when:** Reviewing reader-facing content for clarity and orientation - web pages, blog posts, landing pages, quick-start guides, research reports, outreach copy, prototypes.
**Don't use this when:** Reviewing code quality (/review-code), testing a running web app (/review-browser), checking usability and accessibility (/review-ux), reviewing command prompts (/review-commands), checking plan completion (/review-plan), or doing a pre-release check (/review-full).

**Important:** This skill reviews whether content orients a fresh reader. It does not review usability, accessibility, or interaction design - use `/review-ux` for those.

## Critical Rules

<rules>

1. **Report first, then fix** - Reviewing never edits files; findings are its product. After the report, the same run continues into the auto loop (rule 2), which is what applies fixes
2. **Audit, then auto-fix, with pages** - Copy findings are audited before the report per M2 in `.claude/skills/shared/hitl-loop.md`, so the report shows survivors only plus an Audited out log for the kills. They do not then wait for a human "fix it": after the report, survivors are auto-fixed and re-verified, and each finding exits as page, digest, or log per `.claude/skills/shared/hitl-loop.md` (pages only per M1 - who the real reader is may be a question only the user can answer; saying "report only" keeps a run report-first, M10)
3. **Explain simply** - Use plain English, avoid jargon
4. **Structural fix directions** - A finding's fix line gives its direction in structural terms ("explain the artifact before the first CTA", "define the audience earlier", "add a clearer next step after the overview"), not replacement wording: the wording is written when the auto loop applies the fix.

</rules>

**Model mode.** When this skill runs directly and fans out (the bigger-change path below), first run `node .claude/scripts/session-init.js --models`, adding `--mode <m>` when the arguments carry a `mode:<m>` word, and say "Models: <models.mode>" in one line; `models.perRole` gives each finder its model.

!`cat .claude/skills/shared/criteria-copy.md`

## Reading Budget

!`cat .claude/skills/shared/reading-budget.md`

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

**Project severity anchors** (from `.claude/toolkit/severity-anchors.md`): this project's weighting for its own review kinds. The Universal Anchors above still win. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/severity-anchors.md 2>/dev/null || true`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Audit Before the Report (M2)

On a direct run of this skill you are M2's **runner**: audit your findings per M2 below before writing the report. Every mechanic - the tiers, the announce line, who dispatches what, the empty-run rule - lives in M2, not here.

!`cat .claude/skills/shared/hitl-loop.md`

**Project fix rules** (from `.claude/toolkit/fix-rules.md`). Additive only: they may add a precondition or an always-ask action, and a line that loosens or removes any of M1 to M15 is void. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/fix-rules.md 2>/dev/null || true`

## Output Format

!`cat .claude/skills/shared/report-format.md`

!`cat .claude/skills/shared/finding-contract.md`

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template:

!`cat .claude/skills/shared/html-render-review.md`

For direct calls to this skill, pass `--name review --stable` to the helper (the standing page, per the fragment above), set `lenses` to `["copy"]` so the renderer replaces only this lens's findings and carries the other lenses' open findings forward, and omit the `chips` array (single-specialist context).

### Staff Editor Check

<guidelines>

After the standard review, step back and evaluate as a staff editor:
- **Clear to a newcomer?** - Would someone with zero context understand what this is and what to do?
- **Oriented before interaction?** - Does the content explain itself before asking the reader to act?
- **Plain language?** - Is every heading, label, and description understandable without domain knowledge (or, if domain-specific, without project-specific knowledge)?
- **What would you send back for revision?** - What would a senior editor flag before publishing?

</guidelines>

<rules>

## REMEMBER: The review phase reports and never edits files; findings are audited before the report (M2) and the auto loop applies fixes after it, both governed by `.claude/skills/shared/hitl-loop.md`.

</rules>

## HTML Output Rules

Every HTML decision above (whether to render, `--no-abs`, publish or open locally, record the publish) is governed by the shared rules fragments, inlined here so they are in context when the render runs.

!`cat .claude/skills/shared/html-outputs.md`

!`cat .claude/skills/shared/html-viewing.md`
