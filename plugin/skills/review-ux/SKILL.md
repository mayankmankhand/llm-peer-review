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
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh *)"
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js)"
---

# UX Review

Be thorough but concise.

**Use this when:** Evaluating user experience quality - usability, accessibility, user flows, and how the UI feels to use.
**Don't use this when:** Testing a running web application in a browser (/tk:review-browser). Reviewing code quality (/tk:review-code), reviewing command prompts (/tk:review-commands), checking plan completion (/tk:review-plan), or doing a pre-release check (/tk:review-full).

**Important:** This command reviews artifacts - code, markup, specs, and screenshots. It does not evaluate a running application. When live interaction would be needed for a complete assessment, state that as a limitation in the summary.

## Critical Rules

<rules>

1. **THE REVIEW PHASE REPORTS ONLY** - Reviewing never edits files; findings are its product. After the report, the same run continues into the auto loop (rule 2), which is what applies fixes
2. **Audit, then auto-fix, with pages** - UX findings are audited before the report per M2 in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`, so the report shows survivors only plus an Audited out log for the kills. They do not then wait for a human "fix it": after the report, survivors are auto-fixed and re-verified, and each finding exits as page, digest, or log per `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md` (pages only per M1 - audience-fit questions are typical of the user-held facts that page; saying "report only" keeps a run report-first, M10)
3. **Explain simply** - Use plain English, avoid jargon

</rules>

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/criteria-ux.md`

## Reading Budget

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/reading-budget.md`

## Severity Levels and Anchors

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/severity-anchors.md`

## Finding IDs

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-id-system.md`

## Audit Before the Report (M2)

On a direct run of this skill you are M2's **runner**: audit your findings per M2 below before writing the report. Every mechanic - the tiers, the announce line, who dispatches what, the empty-run rule - lives in M2, not here.

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`

## Output Format

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/report-format.md`

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-contract.md`

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template:

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/html-render-review.md`

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

## REMEMBER: The review phase reports and never edits files; findings are audited before the report (M2) and the auto loop applies fixes after it, both governed by `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`.

</rules>

## HTML Output Rules

Every HTML decision above (whether to render, `--no-abs`, publish or open locally, record the publish) is governed by the shared rules fragment, inlined here so it is in context when the render runs. It was an always-on rules file until v7.0.0 (issue #167); now it loads with the commands that need it.

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md`
