---
name: review-plan
description: Plan compliance review - checks if implementation matches the plan. Use for verifying feature completeness, scope drift, and quality gates against a PLAN-*.md file.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh *)"
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh)"
  - "Bash(mktemp -d /tmp/*)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js)"
---

# Plan Compliance Review

Did we build what we said we'd build? Compares implementation against plan/spec.

**Use this when:** Checking if implementation matches a plan file in `plans/` - feature completeness, scope drift, quality gates.
**Don't use this when:** Reviewing code quality (/tk:review-code), testing a running web app (/tk:review-browser), reviewing command prompts (/tk:review-commands), evaluating end-user UX (/tk:review-ux), or doing a pre-release check (/tk:review-full).

## Critical Rules

<rules>

1. **THE REVIEW PHASE REPORTS ONLY** - Reviewing never edits files; findings are its product. After the report, the same run continues into the auto loop (rule 2), which is what applies fixes
2. **Audit, then auto-fix, with pages** - Plan-compliance findings are audited before the report per M2 in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`, so the report shows survivors only plus an Audited out log for the kills. They do not then wait for a human "fix it": after the report, survivors are auto-fixed and re-verified, and each finding exits as page, digest, or log per `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md` (pages only per M1 - a gap that traces to actual ship status or a deliberate scope call is M1/M7 territory; saying "report only" keeps a run report-first, M10)
3. **Explain simply** - Use plain English, avoid jargon

</rules>

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/criteria-plan.md"`

## Reading Budget

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/reading-budget.md"`

## Severity Levels and Anchors

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/severity-anchors.md"`

## Finding IDs

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-id-system.md"`

## Audit Before the Report (M2)

On a direct run of this skill you are M2's **runner**: audit your findings per M2 below before writing the report. Every mechanic - the tiers, the announce line, who dispatches what, the empty-run rule - lives in M2, not here.

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md"`

## Output Format

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/report-format.md"`

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-contract.md"`

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template:

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/html-render-review.md"`

For direct calls to this skill, pass `--name review --stable` to the helper (the standing page, per the fragment above), set `lenses` to `["plan"]` so the renderer replaces only this lens's findings and carries the other lenses' open findings forward, and omit the `chips` array (single-specialist context).

### Staff PM Check

<guidelines>

After the standard review, step back and evaluate as a staff PM focused on scope and delivery:
- **Scope discipline** - Did we build exactly what was planned, or did scope creep in?
- **Acceptance completeness** - Would a stakeholder accept this as "done" based on the plan?
- **Traceability** - Can you trace each plan task to its implementation?
- **Delivery risk** - What's most likely to cause a "wait, this isn't what I asked for" moment?

</guidelines>

<rules>

## REMEMBER: The review phase reports and never edits files; findings are audited before the report (M2) and the auto loop applies fixes after it, both governed by `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`.

</rules>

## HTML Output Rules

Every HTML decision above (whether to render, `--no-abs`, publish or open locally, record the publish) is governed by the shared rules fragment, inlined here so it is in context when the render runs. It was an always-on rules file until v7.0.0 (issue #167); now it loads with the commands that need it.

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md"`
