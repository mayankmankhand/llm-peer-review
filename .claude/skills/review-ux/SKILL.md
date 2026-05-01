---
name: review-ux
description: UX quality review - usability, accessibility, user flows, and how the UI feels. Use for evaluating user experience from code, markup, specs, and screenshots.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Agent
  - WebSearch
---

# UX Review

Be thorough but concise.

**Use this when:** Evaluating user experience quality - usability, accessibility, user flows, and how the UI feels to use.
**Don't use this when:** Testing a running web application in a browser (/review-browser). Reviewing code quality (/review-code), reviewing command prompts (/review-commands), checking plan completion (/review-plan), or doing a pre-release check (/review-full).

**Important:** This command reviews artifacts - code, markup, specs, and screenshots. It does not evaluate a running application. When live interaction would be needed for a complete assessment, state that as a limitation in the summary.

## Critical Rules

<rules>

1. **REPORT ONLY** - Do NOT make any changes or edits to files
2. **Wait for approval** - Only fix things after I say "fix it"
3. **Explain simply** - Use plain English, avoid jargon

</rules>

## How to Review

<procedure>

Read the UI-related files (components, templates, styles, markup). Then pick one of two modes:

**Small change** (1-2 files, minor UI tweak): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or new user-facing feature): Run four focused sub-agents in parallel using the Agent tool, then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Usability** | Nielsen's heuristics - feedback, user control, error prevention, consistent language |
| **Accessibility** | WCAG AA - keyboard navigation, contrast, focus indicators, semantic HTML, screen-reader support |
| **User Flows** | Happy path completeness, error states, destructive action confirmations, empty states |
| **Research** | Web search for how leading products handle similar UX patterns (max 2 searches, focus on established design systems like Material, Apple HIG, GOV.UK) |

The Research sub-agent should keep findings lightweight and evidence-linked. Clearly separate research-backed findings from heuristic findings. If search results are weak, move on - research should not block the review.

Each sub-agent should use the severity scale and Finding ID format below. If a sub-agent has no findings, it should report "No issues found" so the user knows it ran.

</procedure>

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Output Format

!`cat .claude/skills/shared/output-template.md`

### Staff Designer Check

<guidelines>

After the standard review, step back and evaluate as a staff designer:
- **Coherent experience?** - Does the UI tell a clear story, or does it feel like disconnected pieces?
- **User confidence** - Will the user feel in control, or will they hesitate before acting?
- **Edge cases handled?** - Empty states, loading, errors, first-time use - are they covered?
- **What would you push back on?** - What would a senior designer flag before shipping?

</guidelines>

<rules>

## REMEMBER: Report issues only. Do NOT edit any files until I approve.

</rules>
