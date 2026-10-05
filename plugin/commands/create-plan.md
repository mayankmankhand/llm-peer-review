---
description: "Plan Creation Stage"
allowed-tools:
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh *)"
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh)"
  - "Bash(mktemp -d /tmp/*)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js)"
---
# Plan Creation Stage

**Use this when:** Turning a fully-explored idea into a step-by-step implementation plan with status tracking.
**Don't use this when:** The idea is not yet scoped (use `/tk:explore` first), or the change is small enough that a plan would just be ceremony.

Based on our full exchange, produce a markdown plan document.

## Load Project Context

**Session context (fast path):** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js` once. It returns a single JSON with `map` (exists, commit, headCommit, commitsBehind, stale, generatedWhileDirty, overview), `lessons` (exists, content, hasDetail), `plans` (each with progress and status, for numbering the new plan and avoiding name clashes), and `worktree` (for the Worktree Check below). Use these instead of the individual git/file roundtrips. **Fallback:** if the script is missing or errors, do the manual reads described here and in the Worktree Check instead - behavior is identical.

Check if `CODEBASE_MAP.md` exists (`map.exists` in the JSON; if the script was unavailable, look in the project root).

**If it exists:** Read it. The module guide tells you which files are involved in the work, and the navigation guide helps you write task steps that match the project's structure. When `map.stale` in the session JSON is true (10 or more commits behind), run `/tk:index mode:<m>` automatically per M12 (`${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`), with `<m>` the exploration's Models answer (fit when it gave none), then read the fresh map.

**If it does not exist:** Tell the user "No codebase map found. Generating one now via `/tk:index` - this is a one-time setup that may take a minute and spawns parallel subagents." Then invoke `/tk:index mode:<m>`, with `<m>` the exploration's Models answer (fit when it gave none). After it completes, read the new map and proceed.

**If it is malformed or `/tk:index` fails:** Proceed without the map. The plan can still be written, just with less precision on file paths.

After the map, use the lesson index from the JSON (`lessons.content`; if the script was unavailable, read `LESSONS.md` directly). If a lesson is relevant to this work, open its full write-up in `LESSONS-detail.md` so the plan reflects past mistakes and patterns. If `LESSONS-detail.md` is absent (`lessons.hasDetail` is false), `LESSONS.md` holds each lesson in full, so its content is already the whole file; `/tk:document` creates the detail file from the seed before it writes the next lesson, so the index stays short.

## Worktree Check

<procedure>

**Fallback branch rename** - `/tk:explore` is the primary place this happens, but if the user skipped it or didn't have an issue number yet, handle it here before generating the plan.

1. Detect if you're in a worktree: use `worktree.isWorktree` from the session-init JSON (or, if the script was unavailable, compare `git rev-parse --git-dir` with `git rev-parse --git-common-dir` - they differ when you're in a worktree).
2. Check if the current branch name does NOT already match the `worktree-<number>-<label>` pattern.
3. If both are true AND an issue is referenced in the conversation, rename the branch to `worktree-<issue-number>-<short-label>`, the branch naming rule in the toolkit reference.
4. Tell the user: "Renamed your branch from `old-name` to `worktree-XX-short-label` to match the issue."
5. If not in a worktree, or the branch is already renamed, skip silently.

</procedure>

## Project Plan Gate

The text below is this project's own gate, read from `.claude/toolkit/plan-gate.md`. Apply it before the toolkit's requirements that follow. The gate is additive only: it may add a requirement or a check, and a line that loosens or removes any of M1 to M15, or waives one of the toolkit's requirements below, is void. A note that the command printed nothing means this project has no gate.

!`cat .claude/toolkit/plan-gate.md 2>/dev/null || true`

## Requirements for the Plan

<rules>

- Include clear, minimal, concise steps
- Track the status of each step using these emojis:
  - 🟩 Done
  - 🟨 In Progress
  - 🟥 To Do
- Include dynamic tracking of overall progress percentage (at top)
- Write the exploration's Models answer (best, fit or cheap; fit when it gave none) as the `**Models:**` line under the progress line: while the plan is unfinished, `session-init.js` reads it to pick each helper's model
- Add no scope or complexity beyond the details the conversation settled
- Steps should be modular, elegant, minimal, and integrate seamlessly within the existing codebase

</rules>

## Execution Order Tags (for plans with 3+ steps)

<conditions>

Tag every step: `/tk:execute` reads the tags to decide what can run in parallel. For plans with 3 or more steps:

- Tag each step `[parallel]` or `[sequential]`
- `[parallel]` steps: add `→ delivers: [what this step produces]`
- `[sequential]` steps: add `→ depends on: Step N`
- Parallel steps must be independent in both **files AND environment** (dependencies, services, migrations, env vars)
- A step that builds a surface with load level new or improve is tagged `[sequential]`: its design loop runs in the main loop (M15 in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`)
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
**Models:** fit

## TLDR
Short summary of what we're building and why.

## Goal State (optional - include for features with 3+ steps)
**Current State:** Where things are now.
**Goal State:** Where we want to end up.

## UI/UX Design (optional - only when the feature involves UI)
<!-- Include this section when the feature has a user interface. Copy the Design direction line /tk:explore produced; the mechanics are in ${CLAUDE_PLUGIN_ROOT}/skills/shared/design-rules.md. -->
- **Source:** User-provided / AI-proposed, user-approved
- **Load level:** new / improve (none means this section is omitted)
- **Surface:** [name] - source file `[path]` (one line per surface; new work names the file its build step creates)
- **Design system:** none / exists at [where] - allowed variance: [what may vary]
- **Direction:** [name] - [the brief] - seed `[the seed string]`
- **Directions tried:** [name] - seed `[seed]` - dropped at pick; [name] - seed `[seed]` - dropped at pick (new work only)
- **Divergence allowed:** stay inside / this surface only / propose a system change - [what]
- **Media:** ask at build / none
- **Critic budget:** per M15 for the load level
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

## Must-check for review (optional - only when a judge left gaps open)
<!-- One line per item, in the shapes M14 in ${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md gives. /tk:create-plan writes [plan] lines from the plan critic's round 2; /tk:execute design steps add [design], [interaction] and [behaviour] lines. /tk:review enters each into its audit. Omit the section when nothing is carried. -->
- [plan] [Category]: [the gap, verbatim]

## Outcomes
<!-- Fill in after execution: decision-relevant deltas only. What changed vs. planned? Key decisions made? Assumptions invalidated? -->
```

</template>

<rules>

Save the plan to `plans/` using this naming convention:
- If an issue is referenced: `PLAN-issue-<number>.md` (e.g., `plans/PLAN-issue-42.md`)
- If no issue: `PLAN-<short-name>.md` (e.g., `plans/PLAN-auth-flow.md`)

Create the `plans/` directory if it doesn't exist.

</rules>

## Plan Critic (before the stop)

A plan is judged before it is presented, by a context that did not write it. The judge is the `plan-critic` agent: fresh context, Read only, session model at high effort, per the roster in `${CLAUDE_PLUGIN_ROOT}/skills/shared/model-routing.md`. Fallback per that file: when the agent type is not found, run `/reload-plugins` once (an agent added by a plugin install or update, or written this session, registers only after a reload), then `general-purpose` with no model parameter and the agent's body pasted as the prompt.

The critic returns gaps, not a grade; the gaps are what the loop acts on.

<procedure>

1. Dispatch `subagent_type=tk:plan-critic` with the Agent tool. The prompt carries exactly two things: the plan file's path and the exploration's closing summary (direction, decisions, open questions), pasted verbatim. Never the round number and never earlier critiques.
2. Parse the return: either the single line `No material gaps`, or up to six numbered gap lines of the form `N. <Category>: <gap>`. A return that is neither is redispatched once (routing guardrail 2); still malformed, the round counts with no critique and the loop stops with a note in the closing message.
3. `No material gaps` ends the loop. Otherwise, fix the gaps in the plan markdown - a decision the summary made that the plan dropped, a step with no checkable result, a dependency that is not honest, verification that does not cover the changed logic - and dispatch again. Max 2 rounds. A gap the plan is right to leave open (the conversation decided it, or it is out of scope) is not fixed; say so in the closing message instead.
4. Round 2's gaps are not fixed, because no third critic would check the fix. Each one except a gap the plan is right to leave open (step 3: the conversation decided it, or it is out of scope) becomes a line in the plan's `## Must-check for review` section, verbatim, in the shape `- [plan] <Category>: <gap>` (the section is defined in M14 in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`), so `/tk:review` checks it against the delivered work.

</procedure>

The closing message states what the judge found in one line, counting each gap once, so the user sees it before they approve: "Plan critic: 7 gaps; 4 fixed, 1 left open on purpose (<why>), 2 carried to review." Fixed counts round-1 gaps fixed; left open counts gaps from either round that the plan is right to leave open (step 3); carried counts the round-2 gaps written as `[plan]` lines. A round-2 gap that repeats a fixed round-1 gap counts once, as carried, because the fix did not close it; one that repeats a gap left open on purpose counts once, as left open. A round that returned `No material gaps` says so ("Plan critic: no material gaps."). Editing the plan here is not a page: the plan is not a prompt file, and nothing has been executed yet.

## Render HTML View (default-on)

After writing the markdown plan, also render an HTML view of the same plan to `plans/` using the matching name (`PLAN-issue-N.html` or `PLAN-<short-name>.html`).

<rules>

- HTML is generated at plan creation and **re-rendered by `/tk:execute`** as steps complete. Markdown remains canonical for `/tk:execute` and `/tk:review-plan`; the page mirrors it.
- `--stable` means the page keeps one URL for the life of the plan, so a re-render updates the published page rather than creating a second one.
- This is default-on per `${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md`. No judgement call needed.
- Do NOT hand-write the HTML. Emit a compact JSON payload and run the shared helper, which injects it plus the shared `tokens.css` into the prebuilt plan shell.

</rules>

### Build the JSON Payload

Produce a JSON payload matching the schema documented in the header comment of `${CLAUDE_PLUGIN_ROOT}/skills/shared/shells/plan-shell.html` (read it for the exact fields: `title`, `subtitle`, `progress`, `tldr`, `goalState`, `uiux`, `decisions`, `steps`, `outcomes`). All fields are optional; a section is skipped when its data is missing. Within each `steps` entry, the schema defines `name`, `tag` (parallel/sequential), `meta` (delivers/depends on text), `why` (italic note for Verify steps), and `subtasks` - all optional. Two payload rules:

- Do not number step names ("Extend the helper", not "1. Extend the helper") - the renderer numbers steps from array order.
- Each step takes an optional `status` of `todo` | `doing` | `done`. At creation every step is `todo`, so it may be omitted entirely; `/tk:execute` fills it in as it re-renders. Markdown stays the source of truth.

Write the payload as `data.json` in a fresh folder from `mktemp -d /tmp/plan-render.XXXXXX`, made and used per "Temporary folders" in `${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md` (two projects rendering at once never share a payload). That folder is `<render-dir>` below.

### Run the Helper

From the project root:

Check the publish gate first (see **"Render for the viewport"** in `${CLAUDE_PLUGIN_ROOT}/skills/shared/html-viewing.md`): if this session can publish, add `--no-abs` to the command below.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js --shell plan --name PLAN-<basename> \
     --out-dir plans --stable --data <render-dir>/data.json
```

`<basename>` is the plan identifier *without* the `PLAN-` prefix (e.g. `issue-129` for the markdown plan `PLAN-issue-129.md`, or `auth-flow` for `PLAN-auth-flow.md`) - the template already supplies `PLAN-`, so do not repeat it or the filename doubles to `PLAN-PLAN-`. `--stable` writes exactly `plans/PLAN-<basename>.html` - no timestamp - and a re-plan for the same issue replaces the old view. Malformed JSON dies before any file is written, so there is never a broken page. The helper prints the output path to stdout.

Then show it to the user per the **"Viewing the Artifact"** rules in `${CLAUDE_PLUGIN_ROOT}/skills/shared/html-viewing.md`: publish is the primary viewport, the local open is the fallback, and that section holds the whole decision. Pass `--no-abs` to the render above when this session can publish. This is a `--stable` type, so it updates its existing page rather than creating a new one.

---

## The Chain Stops Here (M14)

Present the plan and stop. Plan approval is the cycle's one human gate, so **`/tk:execute` is never invoked automatically**, however clear the plan looks (M14 in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`).

This is the loop's one deliberate non-chaining handoff. It is written down precisely because chaining is the norm everywhere else: an unstated exception drifts into a chain.

Close by telling the user the plan is ready, in the form its Models line asks for:

- **best:** saying "go" runs `/tk:execute` in this session.
- **fit or cheap:** the plan is built on Opus. When this session already runs on Opus, saying "go" runs `/tk:execute` here. Otherwise give the steps: start a new session, run `/model opus`, then `/tk:execute`; the plan file carries everything the build needs, and a model switch inside this conversation would re-read all of it uncached, which costs more than the fresh start.

## HTML Output Rules

Every HTML decision above (whether to render, `--no-abs`, publish or open locally, record the publish) is governed by the shared rules fragments, inlined here so they are in context when the render runs.

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md"`

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/html-viewing.md"`
