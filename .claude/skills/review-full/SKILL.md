---
name: review-full
description: Pre-release cross-domain review with go/no-go recommendation. Use for release gates, major milestones, or when multiple domains changed and you need a single assessment.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Agent
---

# Full Review - Pre-Release Check

Mile wide, inch deep. Cross-domain release readiness, not a deep specialist review.

**Use this when:** Pre-release gate, major milestone check, or when multiple domains changed significantly and you need a single go/no-go assessment.
**Don't use this when:** You need deep review of one area - use /review-code, /review-commands, /review-plan, /review-ux, or /review-browser instead. This command will recommend which specialist review to run if it finds areas needing deeper attention.

## Critical Rules

<rules>

1. **REPORT ONLY** - Do NOT make any changes or edits to files
2. **Wait for approval** - Only fix things after I say "fix it"
3. **Explain simply** - Use plain English, avoid jargon
4. **Don't duplicate specialist reviews** - Prioritize cross-domain issues, release blockers, and interactions between code, UX, scope, and operations. If something needs deeper investigation, recommend which specialist command to run next.

</rules>

## How to Review

<procedure>

Read the changed files and any relevant plan file. Auto-detect the most recently modified `PLAN-*.md` in `plans/` (also check the project root for legacy plan files). If no plan file exists, skip plan comparison and note it in the summary. If multiple plan files exist and the most recent one is not clearly complete (all tasks checked off), pause and ask the user which plan to evaluate against.

Then pick one of two modes:

**Small change** (1-2 files, minor update): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or significant feature): Run four focused sub-agents in parallel using the Agent tool, then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Code & Architecture** | Security red flags, architectural soundness, obvious logic issues, performance risks |
| **Design & Completeness** | Plan alignment, feature gaps, scope drift, test coverage, docs updated |
| **UX & Accessibility** | Usability quick-check, WCAG AA basics, error states, key user flows |
| **Operations** | Secrets in code, logging/monitoring, deployment readiness, rollback plan |

Each sub-agent should stay broad. If a sub-agent finds something that needs deep investigation, flag it and recommend the appropriate specialist review command.

Each sub-agent should use the severity scale and Finding ID format below. If a sub-agent has no findings, it should report "No issues found" so the user knows it ran.

</procedure>

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Output Format

!`cat .claude/skills/shared/output-template.md`

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

## REMEMBER: Report issues only. Do NOT edit any files until I approve.

</rules>
