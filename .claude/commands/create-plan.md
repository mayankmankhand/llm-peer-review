# Plan Creation Stage

Based on our full exchange, produce a markdown plan document.

## Worktree Check

<procedure>

**Fallback branch rename** - `/explore` is the primary place this happens, but if the user skipped it or didn't have an issue number yet, handle it here before generating the plan.

1. Detect if you're in a worktree: compare `git rev-parse --git-dir` with `git rev-parse --git-common-dir`. If they differ, you're in a worktree.
2. Check if the current branch name does NOT already match the `worktree-<number>-<label>` pattern.
3. If both are true AND an issue is referenced in the conversation, rename the branch following the worktree naming convention in toolkit.md.
4. Tell the user: "Renamed your branch from `old-name` to `worktree-XX-short-label` to match the issue."
5. If not in a worktree, or the branch is already renamed, skip silently.

</procedure>

## Requirements for the Plan

<rules>

- Include clear, minimal, concise steps
- Track the status of each step using these emojis:
  - 🟩 Done
  - 🟨 In Progress
  - 🟥 To Do
- Include dynamic tracking of overall progress percentage (at top)
- Do NOT add extra scope or unnecessary complexity beyond explicitly clarified details
- Steps should be modular, elegant, minimal, and integrate seamlessly within the existing codebase

</rules>

## Execution Order Tags (for plans with 3+ steps)

<conditions>

**Do not skip this.** For plans with 3 or more steps:

- Tag each step `[parallel]` or `[sequential]`
- `[parallel]` steps: add `→ delivers: [what this step produces]`
- `[sequential]` steps: add `→ depends on: Step N`
- Parallel steps must be independent in both **files AND environment** (dependencies, services, migrations, env vars)
- Example: "Add button component" + "Write API endpoint" = parallel (different files, no dependency). "Write API endpoint" then "Connect button to API" = sequential (second depends on first).
- If all steps are sequential, still tag them - the tags confirm you thought about execution order

For plans with fewer than 3 steps, skip the tags.

</conditions>

## Markdown Template

<template>

```
# Feature Implementation Plan

**Overall Progress:** `0%`

## TLDR
Short summary of what we're building and why.

## Goal State (optional - include for features with 3+ steps)
**Current State:** Where things are now.
**Goal State:** Where we want to end up.

## UI/UX Design (optional - only when the feature involves UI)
<!-- Include this section when the feature has a user interface. Document what was decided during /explore. -->
- **Source:** User-provided / AI-proposed, user-approved
- **Look:** [Layout, style, colors, visual direction - whatever was decided]
- **Behavior:** [Interactions, flows, states - whatever was decided]

## Critical Decisions
Key architectural/implementation choices made during exploration:
- Decision 1: [choice] - [brief rationale]
- Decision 2: [choice] - [brief rationale]

## Tasks
<!-- For 3+ steps: tag each step [parallel] or [sequential]. See "Execution Order Tags" above. -->

- [ ] 🟥 **Step 1: [Name]** `[parallel]` → delivers: [what this step produces]
  - [ ] 🟥 Subtask 1
  - [ ] 🟥 Subtask 2

- [ ] 🟥 **Step 2: [Name]** `[parallel]` → delivers: [what this step produces]
  - [ ] 🟥 Subtask 1
  - [ ] 🟥 Subtask 2

- [ ] 🟥 **Step 3: [Name]** `[sequential]` → depends on: Steps 1, 2
  - [ ] 🟥 Subtask 1
  - [ ] 🟥 Subtask 2

## Outcomes
<!-- Fill in after execution: decision-relevant deltas only. What changed vs. planned? Key decisions made? Assumptions invalidated? -->
```

</template>

<rules>

Save the plan to `.claude/plans/` using this naming convention:
- If an issue is referenced: `PLAN-issue-<number>.md` (e.g., `.claude/plans/PLAN-issue-42.md`)
- If no issue: `PLAN-<short-name>.md` (e.g., `.claude/plans/PLAN-auth-flow.md`)

Create the `.claude/plans/` directory if it doesn't exist.

Again, it's still not time to build yet. Just write the clear plan document. No extra complexity or extra scope beyond what we discussed.

</rules>
