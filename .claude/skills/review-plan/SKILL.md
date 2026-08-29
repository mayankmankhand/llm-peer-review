---
name: review-plan
description: Plan compliance review - checks if implementation matches the plan. Use for verifying feature completeness, scope drift, and quality gates against a PLAN-*.md file.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Agent
---

# Plan Compliance Review

Did we build what we said we'd build? Compares implementation against plan/spec.

**Use this when:** Checking if implementation matches a plan file in `plans/` - feature completeness, scope drift, quality gates.
**Don't use this when:** Reviewing code quality (/review-code), testing a running web app (/review-browser), reviewing command prompts (/review-commands), evaluating end-user UX (/review-ux), or doing a pre-release check (/review-full).

## Critical Rules

<rules>

1. **THE REVIEW PHASE REPORTS ONLY** - Reviewing never edits files; findings are its product. After the report, the same run continues into the auto loop (rule 2), which is what applies fixes
2. **Auto, with pages** - Plan-compliance findings do not wait for a human "fix it": after the report, survivors are auto-fixed and re-verified, and each finding exits as page, digest, or log per `.claude/skills/shared/hitl-loop.md` (pages only per M1 - a gap that traces to actual ship status or a deliberate scope call is M1/M7 territory; saying "report only" keeps a run report-first, M10)
3. **Explain simply** - Use plain English, avoid jargon

</rules>

## How to Review

<procedure>

First, find the plan file to review against. Auto-detect the most recently modified `PLAN-*.md` file in `plans/` (also check the project root for legacy plan files). If no plan file exists, pause and ask the user: "I couldn't find a plan file. Which file should I compare against, or would /review-code be more appropriate?" If multiple plan files exist and the most recent one is not clearly complete (all tasks checked off), pause and ask the user: "Which plan file should I evaluate against?"

Read the plan file, then read the implementation files. Compare them. Pick one of two modes:

**Small change** (1-2 plan tasks, few files): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ plan tasks or significant scope): when running this skill **directly** (a subagent dispatched by /review is always single-pass - subagents cannot spawn sub-agents), run four focused sub-agents in parallel using the Agent tool, then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Feature Completeness** | Every plan task implemented? Subtasks done? Placeholders remaining? |
| **Spec Compliance** | Implementation matches UI/UX Design section and critical decisions in plan? |
| **Scope Management** | Unplanned additions? Cuts justified and documented? Scope creep? |
| **Quality Gates** | Success criteria met? Tests written (when the plan warranted them)? Docs updated? |

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

For direct calls to this skill, pass `--name review-plan` to the helper and omit the `chips` array (single-specialist context).

### Staff PM Check

<guidelines>

After the standard review, step back and evaluate as a staff PM focused on scope and delivery:
- **Scope discipline** - Did we build exactly what was planned, or did scope creep in?
- **Acceptance completeness** - Would a stakeholder accept this as "done" based on the plan?
- **Traceability** - Can you trace each plan task to its implementation?
- **Delivery risk** - What's most likely to cause a "wait, this isn't what I asked for" moment?

</guidelines>

<rules>

## REMEMBER: The review phase reports and never edits files; after the report, the auto loop applies fixes, governed by `.claude/skills/shared/hitl-loop.md`.

</rules>
