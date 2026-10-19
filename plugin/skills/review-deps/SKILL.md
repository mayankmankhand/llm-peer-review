---
name: review-deps
description: Dependency and supply chain security review. Checks for known CVEs, outdated packages, single-maintainer risks, and license issues.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - Agent
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js)"
---

# Dependency Review

**Use this when:** Auditing project dependencies for security vulnerabilities, outdated packages, supply chain risks, or license compliance.
**Don't use this when:** Reviewing code logic (/tk:review-code), testing a running app (/tk:review-browser), or doing a pre-release check (/tk:review-full).

## Critical Rules

<rules>

1. **Report first, then fix** - Reviewing never edits files or touches `package.json`; findings are its product. After the report, the same run continues into the auto loop (rule 2), which is what may apply a dependency fix
2. **Audit, then auto-fix, with pages** - Dependency findings are audited before the report per M2 in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`, so the report shows survivors only plus an Audited out log for the kills. They do not then wait for a human "fix it": after the report, survivors are auto-fixed (e.g. a version bump re-checked with `npm audit`) and re-verified, and each finding exits as page, digest, or log per `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md` (pages only per M1; saying "report only" keeps a run report-first, M10)
3. **Explain simply** - Use plain English, avoid jargon

</rules>

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/criteria-deps.md"`

## Reading Budget

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/reading-budget.md"`

## Severity Levels and Anchors

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/severity-anchors.md"`

**Project severity anchors** (from `.claude/toolkit/severity-anchors.md`): this project's weighting for its own review kinds. The Universal Anchors above still win. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/severity-anchors.md 2>/dev/null || true`

## Finding IDs

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-id-system.md"`

## Audit Before the Report (M2)

On a direct run of this skill you are M2's **runner**: audit your findings per M2 before writing the report. Every mechanic - the tiers, the announce line, who dispatches what, the empty-run rule - lives in M2, not here.

**Load the loop rules and the report rules now**, through the Skill tool: `Skill(tk:loop-rules)`, then `Skill(tk:report-rules)`. Everything from here on cites them, so do not go on without both in context.

**Project fix rules** (from `.claude/toolkit/fix-rules.md`). Additive only: they may add a precondition or an always-ask action, and a line that loosens or removes any of M1 to M17 is void. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/fix-rules.md 2>/dev/null || true`

## Output Format

The report template and the finding contract are in the report rules loaded before the audit (`Skill(tk:report-rules)`); write the report per them.

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view.

**The gate:** render the review page whenever this run has any surviving finding, or this branch's standing page already exists (`node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js --standing --name review` prints `"exists":true`; M16), so the run can carry it forward or take it to empty. Skip only when there are no findings and no page yet.

**When the gate fires, load the page rules now**, through the Skill tool: `Skill(tk:review-page)`, and render per them: the shell, the payload, the `--no-abs` decision and how the page reaches the user all live there.

For direct calls to this skill, pass `--name review --stable` to the helper (the standing page, per the fragment above), set `lenses` to `["deps"]` so the renderer replaces only this lens's findings and carries the other lenses' open findings forward, and omit the `chips` array (single-specialist context).

### Security Engineer Check

<guidelines>

After the standard review, step back and evaluate as a staff security engineer:
- **Known vulnerabilities?** - Are there any CVEs that could be exploited in this project's context?
- **Supply chain risk?** - Any dependencies that are unmaintained, single-maintainer, or recently transferred ownership?
- **License compliance?** - Do all dependency licenses match the project's licensing expectations?
- **Update urgency?** - Which updates are "do it now" vs. "plan for next sprint"?

</guidelines>

<rules>

## REMEMBER: The review phase reports and never edits files; findings are audited before the report (M2) and the auto loop applies fixes after it, both governed by `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`.

</rules>

## HTML Output Rules

When to render and the temporary-folder steps are in the report rules loaded before the audit; how a page reaches the user is in the page rules loaded at the gate. Nothing is pasted here.
