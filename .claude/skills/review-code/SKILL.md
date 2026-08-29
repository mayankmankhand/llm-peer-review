---
name: review-code
description: Code quality review - security, logic, performance, maintainability. Use for reviewing code changes like bug fixes, features, refactors, scripts.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Agent
---

# Code Review

Be thorough but concise.

**Use this when:** Reviewing code changes - bug fixes, new features, refactors, scripts.
**Don't use this when:** Testing a running web app (/review-browser), reviewing slash command prompts (/review-commands), checking plan completion (/review-plan), evaluating UX (/review-ux), or doing a pre-release check (/review-full).

## Critical Rules

<rules>

1. **THE REVIEW PHASE REPORTS ONLY** - Reviewing never edits files; findings are its product. After the report, the same run continues into the auto loop (rule 2), which is what applies fixes
2. **Auto, with pages** - Code findings do not wait for a human "fix it": after the report, survivors are auto-fixed and re-verified, and each finding exits as page, digest, or log per `.claude/skills/shared/hitl-loop.md` (pages only per M1; saying "report only" keeps a run report-first, M10)
3. **Explain simply** - Use plain English, avoid jargon

</rules>

## How to Review

<procedure>

Read the changed files. Then pick one of two modes:

**Small change** (1-2 files): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or significant logic): when running this skill **directly** (a subagent dispatched by /review is always single-pass - subagents cannot spawn sub-agents), run four focused sub-agents in parallel using the Agent tool, then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Security** | Auth checks, input validation, secrets exposure, injection risks |
| **Code Quality** | Naming, duplication, complexity, pattern consistency |
| **Logic** | Edge cases, off-by-ones, missing error handling, wrong assumptions |
| **Performance & Maintainability** | O(n) issues, memory usage, tech debt, maintainability concerns |

Each sub-agent should use the severity scale and Finding ID format below. If a sub-agent has no findings, it should report "No issues found" so the user knows it ran.

</procedure>

## Reading Budget

!`cat .claude/skills/shared/reading-budget.md`

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Output Format

!`cat .claude/skills/shared/output-template.md`

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template:

!`cat .claude/skills/shared/html-render-review.md`

For direct calls to this skill, pass `--name review-code` to the helper and omit the `chips` array (single-specialist context).

### Staff Engineer Check

<guidelines>

After the standard review, step back and evaluate as a staff engineer:
- **Right approach?** - Is the overall design sound, not just the code?
- **Shortcuts to clean up?** - Anything that works now but needs fixing before production?
- **What would you push back on?** - What would a senior engineer flag before merging?

</guidelines>

<rules>

## REMEMBER: The review phase reports and never edits files; after the report, the auto loop applies fixes, governed by `.claude/skills/shared/hitl-loop.md`.

</rules>
