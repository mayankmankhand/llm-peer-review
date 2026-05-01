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

1. **REPORT ONLY** - Do NOT make any changes or edits to files
2. **Wait for approval** - Only fix things after I say "fix it"
3. **Explain simply** - Use plain English, avoid jargon

</rules>

## How to Review

<procedure>

Read the changed files. Then pick one of two modes:

**Small change** (1-2 files): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or significant logic): Run four focused sub-agents in parallel using the Agent tool, then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Security** | Auth checks, input validation, secrets exposure, injection risks |
| **Code Quality** | Naming, duplication, complexity, pattern consistency |
| **Logic** | Edge cases, off-by-ones, missing error handling, wrong assumptions |
| **Performance & Maintainability** | O(n) issues, memory usage, tech debt, maintainability concerns |

Each sub-agent should use the severity scale and Finding ID format below. If a sub-agent has no findings, it should report "No issues found" so the user knows it ran.

</procedure>

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Output Format

!`cat .claude/skills/shared/output-template.md`

### Staff Engineer Check

<guidelines>

After the standard review, step back and evaluate as a staff engineer:
- **Right approach?** - Is the overall design sound, not just the code?
- **Shortcuts to clean up?** - Anything that works now but needs fixing before production?
- **What would you push back on?** - What would a senior engineer flag before merging?

</guidelines>

<rules>

## REMEMBER: Report issues only. Do NOT edit any files until I approve.

</rules>
