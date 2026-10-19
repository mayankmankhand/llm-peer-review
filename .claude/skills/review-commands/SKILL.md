---
name: review-commands
description: Slash command prompt review - prompt quality, workflow completeness, cross-command consistency. Use for reviewing .claude/commands/*.md or .claude/skills/*/SKILL.md files.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
---

# Slash Command Review

**Use this when:** Reviewing slash command prompts (.claude/commands/*.md or .claude/skills/*/SKILL.md) - prompt quality, workflow completeness, cross-command consistency.
**Don't use this when:** Reviewing application code (/review-code), testing a running web app (/review-browser), checking plan completion (/review-plan), evaluating end-user UX (/review-ux), or doing a pre-release check (/review-full).

## Critical Rules

<rules>

1. **Report first, then fix** - Reviewing never edits files; findings are its product. After the report, the same run continues into the auto loop (rule 2), which is what applies fixes
2. **Audit, then auto-fix, with pages** - Command-prompt findings are audited before the report per M2 in `.claude/skills/shared/hitl-loop.md`, so the report shows survivors only plus an Audited out log for the kills. They then enter the auto loop like any other (survivors auto-fixed, re-verified, then page/digest/log), with one built-in brake: fixing them means editing prompt files, which is an always-ask action (M9), so those fixes page for approval instead of auto-applying. Saying "report only" keeps a run report-first (M10)
3. **Explain simply** - Use plain English, avoid jargon

</rules>

**Model mode.** When this skill runs directly and fans out (the bigger-change path below), first run `node .claude/scripts/session-init.js --models`, adding `--mode <m>` when the arguments carry a `mode:<m>` word, and say "Models: <models.mode>" in one line; `models.perRole` gives each finder its model.

!`cat .claude/skills/shared/criteria-commands.md`

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

For direct calls to this skill, pass `--name review --stable` to the helper (the standing page, per the fragment above), set `lenses` to `["commands"]` so the renderer replaces only this lens's findings and carries the other lenses' open findings forward, and omit the `chips` array (single-specialist context).

### Staff PM Check

<guidelines>

After the standard review, step back and evaluate as a staff PM focused on operational clarity:
- **Can any user follow this?** - Is the workflow clear without specialized knowledge?
- **Workflow reliability** - Are there points where the user could get stuck or confused?
- **Handoff quality** - Does each command's output feed cleanly into the next step?
- **What would you push back on?** - What would an experienced PM flag before shipping these commands?

</guidelines>

<rules>

## REMEMBER: The review phase reports and never edits files; findings are audited before the report (M2) and the auto loop applies fixes after it, both governed by `.claude/skills/shared/hitl-loop.md` and `.claude/skills/shared/hitl-stages.md` (prompt-file fixes always ask, M9).

</rules>

## HTML Output Rules

When to render and the temporary-folder steps are in the report rules loaded before the audit; how a page reaches the user is in the page rules loaded at the gate. Nothing is pasted here.
