---
name: review-deps
description: Dependency and supply chain security review. Checks for known CVEs, outdated packages, single-maintainer risks, and license issues.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - Agent
---

# Dependency Review

Be thorough but concise.

**Use this when:** Auditing project dependencies for security vulnerabilities, outdated packages, supply chain risks, or license compliance.
**Don't use this when:** Reviewing code logic (/review-code), testing a running app (/review-browser), or doing a pre-release check (/review-full).

## Critical Rules

<rules>

1. **THE REVIEW PHASE REPORTS ONLY** - Reviewing never edits files or touches `package.json`; findings are its product. After the report, the same run continues into the auto loop (rule 2), which is what may apply a dependency fix
2. **Audit, then auto-fix, with pages** - Dependency findings are audited before the report per M2 in `.claude/skills/shared/hitl-loop.md`, so the report shows survivors only plus an Audited out log for the kills. They do not then wait for a human "fix it": after the report, survivors are auto-fixed (e.g. a version bump re-checked with `npm audit`) and re-verified, and each finding exits as page, digest, or log per `.claude/skills/shared/hitl-loop.md` (pages only per M1; saying "report only" keeps a run report-first, M10)
3. **Explain simply** - Use plain English, avoid jargon

</rules>

!`cat .claude/skills/shared/criteria-deps.md`

## Reading Budget

!`cat .claude/skills/shared/reading-budget.md`

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Audit Before the Report (M2)

On a direct run of this skill you are M2's **runner**: audit your findings per M2 below before writing the report. Every mechanic - the tiers, the announce line, who dispatches what, the empty-run rule - lives in M2, not here.

!`cat .claude/skills/shared/hitl-loop.md`

## Output Format

!`cat .claude/skills/shared/report-format.md`

!`cat .claude/skills/shared/finding-contract.md`

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template:

!`cat .claude/skills/shared/html-render-review.md`

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

## REMEMBER: The review phase reports and never edits files; findings are audited before the report (M2) and the auto loop applies fixes after it, both governed by `.claude/skills/shared/hitl-loop.md`.

</rules>
