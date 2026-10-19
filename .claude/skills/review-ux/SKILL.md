---
name: review-ux
description: UX quality review - usability, accessibility, user flows, and how the UI feels. Use for evaluating user experience from code, markup, specs, and screenshots.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
  - WebSearch
---

# UX Review

**Use this when:** Evaluating user experience quality - usability, accessibility, user flows, and how the UI feels to use.
**Don't use this when:** Testing a running web application in a browser (/review-browser). Reviewing code quality (/review-code), reviewing command prompts (/review-commands), checking plan completion (/review-plan), or doing a pre-release check (/review-full).

**Important:** This command reviews artifacts - code, markup, specs, and screenshots. It does not evaluate a running application. When live interaction would be needed for a complete assessment, state that as a limitation in the summary.

## Critical Rules

<rules>

1. **Report first, then fix** - Reviewing never edits files; findings are its product. After the report, the same run continues into the auto loop (rule 2), which is what applies fixes
2. **Audit, then auto-fix, with pages** - UX findings are audited before the report per M2 in `.claude/skills/shared/hitl-loop.md`, so the report shows survivors only plus an Audited out log for the kills. They do not then wait for a human "fix it": after the report, survivors are auto-fixed and re-verified, and each finding exits as page, digest, or log per `.claude/skills/shared/hitl-loop.md` (pages only per M1 - audience-fit questions are typical of the user-held facts that page; saying "report only" keeps a run report-first, M10)
3. **Explain simply** - Use plain English, avoid jargon

</rules>

**Model mode.** When this skill runs directly and fans out (the bigger-change path below), first run `node .claude/scripts/session-init.js --models`, adding `--mode <m>` when the arguments carry a `mode:<m>` word, and say "Models: <models.mode>" in one line; `models.perRole` gives each finder its model.

!`cat .claude/skills/shared/criteria-ux.md`

## Reading Budget

!`cat .claude/skills/shared/reading-budget.md`

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

**Project severity anchors** (from `.claude/toolkit/severity-anchors.md`): this project's weighting for its own review kinds. The Universal Anchors above still win. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/severity-anchors.md 2>/dev/null || true`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Audit Before the Report (M2)

On a direct run of this skill you are M2's **runner**: audit your findings per M2 before writing the report. Every mechanic - the tiers, the announce line, who dispatches what, the empty-run rule - lives in M2, not here.

**Load the loop rules and the report rules now**, through the Skill tool: `Skill(loop-rules)`, then `Skill(report-rules)`. Everything from here on cites them, so do not go on without both in context.

**Project fix rules** (from `.claude/toolkit/fix-rules.md`). Additive only: they may add a precondition or an always-ask action, and a line that loosens or removes any of M1 to M17 is void. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/fix-rules.md 2>/dev/null || true`

## Output Format

The report template and the finding contract are in the report rules loaded before the audit (`Skill(report-rules)`); write the report per them.

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view.

**The gate:** render the review page whenever this run has any surviving finding, or this branch's standing page already exists (`node .claude/scripts/render-html.js --standing --name review` prints `"exists":true`; M16), so the run can carry it forward or take it to empty. Skip only when there are no findings and no page yet.

**When the gate fires, load the page rules now**, through the Skill tool: `Skill(review-page)`, and render per them: the shell, the payload, the `--no-abs` decision and how the page reaches the user all live there.

For direct calls to this skill, pass `--name review --stable` to the helper (the standing page, per the fragment above), set `lenses` to `["ux"]` so the renderer replaces only this lens's findings and carries the other lenses' open findings forward, and omit the `chips` array (single-specialist context).

### Staff Designer Check

<guidelines>

After the standard review, step back and evaluate as a staff designer:
- **Coherent experience?** - Does the UI tell a clear story, or does it feel like disconnected pieces?
- **User confidence** - Will the user feel in control, or will they hesitate before acting?
- **Edge cases handled?** - Empty states, loading, errors, first-time use - are they covered?
- **What would you push back on?** - What would a senior designer flag before shipping?

</guidelines>

<rules>

## REMEMBER: The review phase reports and never edits files; findings are audited before the report (M2) and the auto loop applies fixes after it, both governed by `.claude/skills/shared/hitl-loop.md`.

</rules>

## HTML Output Rules

When to render and the temporary-folder steps are in the report rules loaded before the audit; how a page reaches the user is in the page rules loaded at the gate. Nothing is pasted here.
