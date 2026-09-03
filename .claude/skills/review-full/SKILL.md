---
name: review-full
description: Pre-release cross-domain review with go/no-go recommendation. Use for release gates, major milestones, or when multiple domains changed and you need a single assessment.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
---

# Full Review - Pre-Release Check

Mile wide, inch deep. Cross-domain release readiness, not a deep specialist review.

**Use this when:** Pre-release gate, major milestone check, or when multiple domains changed significantly and you need a single go/no-go assessment.
**Don't use this when:** You need deep review of one area - use /review-code, /review-commands, /review-plan, /review-ux, or /review-browser instead. This command will recommend which specialist review to run if it finds areas needing deeper attention.

## Critical Rules

<rules>

1. **THE REVIEW PHASE REPORTS ONLY** - Reviewing never edits files; findings and a go/no-go recommendation are its product. After the report, the same run continues into the auto loop (rule 2), which is what applies fixes
2. **Audit, then auto-fix, with pages** - Release-readiness findings are audited before the report per M2 in `.claude/skills/shared/hitl-loop.md`, so the report shows survivors only plus an Audited out log for the kills. They do not then wait for a human "fix it": after the report, survivors are auto-fixed and re-verified, and each finding exits as page, digest, or log per `.claude/skills/shared/hitl-loop.md` (pages only per M1). The release decision itself stays with the user: releases and version bumps are always-ask (M9). Saying "report only" keeps a run report-first (M10)
3. **Explain simply** - Use plain English, avoid jargon
4. **Don't duplicate specialist reviews** - Prioritize cross-domain issues, release blockers, and interactions between code, UX, scope, and operations. If something needs deeper investigation, recommend which specialist command to run next.

</rules>

## How to Review

<procedure>

Read the changed files and any relevant plan file. Auto-detect the most recently modified `PLAN-*.md` in `plans/` (also check the project root for legacy plan files). If no plan file exists, skip plan comparison and note it in the summary. If multiple plan files exist and the most recent one is not clearly complete (all tasks checked off), pause and ask the user which plan to evaluate against.

Then pick one of two modes:

**Small change** (1-2 files, minor update): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or significant feature): when running this skill **directly** (a subagent dispatched by /review is always single-pass - subagents cannot spawn sub-agents), run four focused sub-agents in parallel using the Agent tool (`subagent_type=review-finder`, the finder agent per the roster in `.claude/skills/shared/model-routing.md`; fallback per that rule: `general-purpose` carrying what its roster row declares), then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Code & Architecture** | Security red flags, architectural soundness, obvious logic issues, performance risks |
| **Design & Completeness** | Plan alignment, feature gaps, scope drift, test coverage, docs updated |
| **UX & Accessibility** | Usability quick-check, WCAG AA basics, error states, key user flows |
| **Operations** | Secrets in code, logging/monitoring, deployment readiness, rollback plan |

Each sub-agent should stay broad. If a sub-agent finds something that needs deep investigation, flag it and recommend the appropriate specialist review command.

Each sub-agent should use the severity scale and Finding ID format below. If a sub-agent has no findings, it should report "No issues found" so the user knows it ran.

</procedure>

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

!`cat .claude/skills/shared/output-template.md`

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template:

!`cat .claude/skills/shared/html-render-review.md`

For direct calls to this skill, pass `--name review --stable` to the helper (the standing page, per the fragment above) and omit `lenses`: a full check replaces the whole page. Include the `chips` array with the four sub-domains this skill covers (Code & Architecture, Design & Completeness, UX & Accessibility, Operations) so the reader sees at a glance which domains were checked. Treat `/review-full` as a multi-specialist run for chip purposes.

### Staff Architect Check

<guidelines>

After the standard review, step back and evaluate as a staff architect:
- **Cross-domain conflicts?** - Do code, UX, plan, and operations all tell the same story?
- **Release risk** - What's most likely to go wrong in production?
- **What's missing?** - Monitoring, rollback, documentation, user communication?
- **Deeper reviews needed?** - Recommend specific /review-* commands for areas that need more attention

</guidelines>

### Release Recommendation

State one of:
- **Ready** - No blockers, ship it
- **Ready with conditions** - Ship after addressing [specific items]
- **Not ready** - Must fix [specific blockers] before release

<rules>

## REMEMBER: The review phase reports and never edits files; findings are audited before the report (M2) and the auto loop applies fixes after it, both governed by `.claude/skills/shared/hitl-loop.md` (the release itself always asks, M9).

</rules>
