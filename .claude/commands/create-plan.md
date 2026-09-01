# Plan Creation Stage

**Use this when:** Turning a fully-explored idea into a step-by-step implementation plan with status tracking.
**Don't use this when:** The idea is not yet scoped (use `/explore` first), or the change is small enough that a plan would just be ceremony.

Based on our full exchange, produce a markdown plan document.

## Load Project Context

**Session context (fast path):** Run `node .claude/scripts/session-init.js` once. It returns a single JSON with `map` (exists, commit, headCommit, commitsBehind, stale, generatedWhileDirty, overview), `lessons` (exists, content, hasDetail), `plans` (each with progress and status, for numbering the new plan and avoiding name clashes), and `worktree` (for the Worktree Check below). Use these instead of the individual git/file roundtrips. **Fallback:** if the script is missing or errors (older installs), do the manual reads described here and in the Worktree Check instead - behavior is identical.

Check if `CODEBASE_MAP.md` exists (`map.exists` in the JSON; if the script was unavailable, look in the project root).

**If it exists:** Read it. The module guide tells you which files are involved in the work, and the navigation guide helps you write task steps that match the project's structure. When `map.stale` in the session JSON is true (10 or more commits behind), run `/index` automatically per M12 (`.claude/skills/shared/hitl-loop.md`), then read the fresh map.

**If it does not exist (first run after upgrade or fresh setup):** Tell the user "No codebase map found. Generating one now via `/index` - this is a one-time setup that may take a minute and spawns parallel subagents." Then invoke `/index`. After it completes, read the new map and proceed.

**If it is malformed or `/index` fails:** Proceed without the map. The plan can still be written, just with less precision on file paths.

After the map, use the lesson index from the JSON (`lessons.content`; if the script was unavailable, read `LESSONS.md` directly). If a lesson is relevant to this work, open its full write-up in `LESSONS-detail.md` so the plan reflects past mistakes and patterns. If `LESSONS-detail.md` is absent (`lessons.hasDetail` is false), `LESSONS.md` is the older flat format - its content is already the whole file.

## Worktree Check

<procedure>

**Fallback branch rename** - `/explore` is the primary place this happens, but if the user skipped it or didn't have an issue number yet, handle it here before generating the plan.

1. Detect if you're in a worktree: use `worktree.isWorktree` from the session-init JSON (or, if the script was unavailable, compare `git rev-parse --git-dir` with `git rev-parse --git-common-dir` - they differ when you're in a worktree).
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

## Test Steps (conditional)

<conditions>

Decide whether this plan needs a dedicated test step. This is dynamic, not blanket - a plan that changes real logic usually gets one; a plan that does not should not get one. **When in doubt, skip it** - a missing test step is cheaper than a plan cluttered with tests nobody needed.

**Add a "Verify" test step when the plan changes verifiable logic:**
- New business logic with defined inputs and outputs (e.g., a pricing calculator): WRITE new tests that assert the correct outputs.
- A refactor of code that already has test coverage (e.g., a parser): RUN the existing tests to confirm behavior is unchanged.
- Anything with a checkable result: pure functions, parsers, calculations, data transforms, business rules.

**Skip the test step when there is nothing to verify:**
- Config, docs, comments, copy, or styling only.
- Exploratory or research work (investigating a bug, reading code) with no code change yet.

**How to decide (no heavy scanning):** infer from the task descriptions you just wrote, plus `CODEBASE_MAP.md` signals - is there a `tests/` directory? a test framework in the project's dependencies? Do NOT scan the codebase for per-function coverage.

**Where it goes:** one dedicated step named "Verify" near the end of the Tasks list. It runs existing tests and/or adds new ones, whichever fits. It `depends on` the code steps it verifies (never on the optional setup step below), so the plan stays valid even if that optional step is deleted. Because it is a step, it counts toward the 3-or-more-step threshold for Execution Order Tags above; tag it `[sequential]` when that threshold applies.

**Explain why, in one line.** Directly under the Verify step (and under the optional setup step, if present), add a short plain-English note so a non-technical reader knows why it appeared and whether it is safe to drop. Format it as an italic sub-line, e.g. `_Why this step: this plan changes pricing math, so we confirm the numbers come out right._`

**When the project has no way to run tests yet** (no test framework in dependencies, no `tests/` directory) AND a test step is warranted:
- Add a flagged, optional setup step before the code steps, named like "Set up <framework> (optional - recommended)".
- Auto-detect the idiomatic framework from the project: Vitest or Jest for JavaScript/TypeScript (`package.json`), pytest for Python (`pyproject.toml` or `requirements.txt`), and so on. If the ecosystem is unclear, use generic wording: "Set up a test framework (optional - recommended)".
- Give it a why-note that says it is safe to delete, e.g. `_Why this step: optional. Delete it if you do not want to add a test tool now; the Verify step still works, it just runs manually._`
- Because the Verify step depends on the code steps and not on this setup step, deleting the optional step never leaves a dangling reference. Never force a framework install onto a small change.

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

- [ ] 🟥 **Step N: Verify** `[sequential]` → depends on: the code steps it verifies
  <!-- Conditional step (see "Test Steps (conditional)" above). Include ONLY when the plan changes verifiable logic; omit entirely for docs/config/exploratory plans. If the project has no test runner, add a flagged optional "Set up <framework> (optional - recommended)" step before the code steps. This Verify step depends on the CODE steps, not the optional setup step, so deleting the optional step never breaks it. -->
  - _Why this step: [one plain-English line, e.g. "this plan changes pricing math, so we confirm the numbers come out right"]_
  - [ ] 🟥 Run existing tests for [module], confirm behavior unchanged
  - [ ] 🟥 Add tests for [new logic]: assert [input] produces [expected output]

## Outcomes
<!-- Fill in after execution: decision-relevant deltas only. What changed vs. planned? Key decisions made? Assumptions invalidated? -->
```

</template>

<rules>

Save the plan to `plans/` using this naming convention:
- If an issue is referenced: `PLAN-issue-<number>.md` (e.g., `plans/PLAN-issue-42.md`)
- If no issue: `PLAN-<short-name>.md` (e.g., `plans/PLAN-auth-flow.md`)

Create the `plans/` directory if it doesn't exist.

Again, it's still not time to build yet. Just write the clear plan document. No extra complexity or extra scope beyond what we discussed.

</rules>

## Render HTML View (default-on)

After writing the markdown plan, also render an HTML view of the same plan to `plans/` using the matching name (`PLAN-issue-N.html` or `PLAN-<short-name>.html`).

<rules>

- HTML is generated **only at plan creation**. `/execute` never re-renders it.
- HTML is a one-time snapshot for the human reader. Markdown remains canonical for `/execute` and `/review-plan`.
- This is default-on per `.claude/rules/html-outputs.md`. No judgement call needed.
- Do NOT hand-write the HTML. Emit a compact JSON payload and run the shared helper, which injects it plus the shared `tokens.css` into the prebuilt plan shell.

</rules>

### Build the JSON Payload

Produce a JSON payload matching the schema documented in the header comment of `.claude/skills/shared/shells/plan-shell.html` (read it for the exact fields: `title`, `subtitle`, `progress`, `tldr`, `goalState`, `uiux`, `decisions`, `steps`, `outcomes`). All fields are optional; a section is skipped when its data is missing. Within each `steps` entry, the schema defines `name`, `tag` (parallel/sequential), `meta` (delivers/depends on text), `why` (italic note for Verify steps), and `subtasks` - all optional. Two payload rules:

- Do not number step names ("Extend the helper", not "1. Extend the helper") - the renderer numbers steps from array order.
- There is no status field. Every step renders with the 🟥 To Do badge: visual scaffolding showing the structure of the work, not live status. The badges never update because the HTML never re-renders; markdown is the source of truth during `/execute`.

Write the payload to a temp file (e.g. `/tmp/plan-data.json`).

### Run the Helper

From the project root:

Check the publish gate first (see **"Render for the viewport"** in `.claude/rules/html-outputs.md`): if this session can publish, add `--no-abs` to the command below.

```bash
node .claude/scripts/render-html.js --shell plan --name PLAN-<basename> \
     --out-dir plans --stable --data /tmp/plan-data.json
```

`<basename>` is the plan identifier *without* the `PLAN-` prefix (e.g. `issue-129` for the markdown plan `PLAN-issue-129.md`, or `auth-flow` for `PLAN-auth-flow.md`) - the template already supplies `PLAN-`, so do not repeat it or the filename doubles to `PLAN-PLAN-`. `--stable` writes exactly `plans/PLAN-<basename>.html` - no timestamp - and a re-plan for the same issue replaces the old view. Malformed JSON dies before any file is written, so there is never a broken page. The helper prints the output path to stdout; open it:

Then show it to the user per the **"Viewing the Artifact"** rules in `.claude/rules/html-outputs.md`: publish is the primary viewport, the local open is the fallback, and that section holds the whole decision. Pass `--no-abs` to the render above when this session can publish. This is a `--stable` type, so it updates its existing page rather than creating a new one.

---

## The Chain Stops Here (M14)

Present the plan and stop. Plan approval is the cycle's one human gate, so **`/execute` is never invoked automatically**, however clear the plan looks (M14 in `.claude/skills/shared/hitl-loop.md`).

This is the loop's one deliberate non-chaining handoff. It is written down precisely because chaining is the norm everywhere else: an unstated exception drifts into a chain.

Close by telling the user the plan is ready, and that saying "go" runs `/execute`.
