# Plan Creation Stage

**Use this when:** Turning a fully-explored idea into a step-by-step implementation plan with status tracking.
**Don't use this when:** The idea is not yet scoped (use `/explore` first), or the change is small enough that a plan would just be ceremony.

Based on our full exchange, produce a markdown plan document.

## Load Project Context

**Session context (fast path):** Run `node .claude/scripts/session-init.js` once. It returns a single JSON with `map` (exists, commit, headCommit, commitsBehind, stale, generatedWhileDirty, malformed, overview), `lessons` (exists, content, hasDetail), `plans` (newest first: the newest 10 with progress and status, the next 40 by name only, and `plansOmitted` counting any older ones; for numbering the new plan and avoiding name clashes, and when `plansOmitted` is set, `ls plans/PLAN-<name>.md` prints `No such file or directory` when the new name is free and the path when it is taken), and `worktree` (for the Worktree Check below). Use these instead of the individual git/file roundtrips. **Fallback:** if the script is missing or errors, do the manual reads described here and in the Worktree Check instead - behavior is identical.

Check if `CODEBASE_MAP.md` exists (`map.exists` in the JSON; if the script was unavailable, look in the project root).

**If it exists:** Read it. The module guide tells you which files are involved in the work, and the navigation guide helps you write task steps that match the project's structure. When `map.stale` in the session JSON is true (10 or more commits behind), run `/index mode:<m>` automatically per M12 (`.claude/skills/shared/hitl-stages.md`), with `<m>` the exploration's Models answer (fit when it gave none), then read the fresh map.

**If it does not exist:** Tell the user "No codebase map found. Generating one now via `/index` - this is a one-time setup that may take a minute and spawns parallel subagents." Then invoke `/index mode:<m>`, with `<m>` the exploration's Models answer (fit when it gave none). After it completes, read the new map and proceed.

**If it is malformed or `/index` fails:** `map.malformed` in the session JSON is the malformed verdict (false passes; M16), and only if the script was unavailable run the byte tests yourself: `wc -c CODEBASE_MAP.md; head -1 CODEBASE_MAP.md; grep -c '^# Codebase Map' CODEBASE_MAP.md` (a byte count above 200, a first line starting `<!-- Generated:` and a count of `1` mean the map is sound; anything else is malformed). Proceed without the map. The plan can still be written, just with less precision on file paths.

After the map, use the lesson index from the JSON (`lessons.content`; if the script was unavailable, or `content` is absent because the index is over 8 KB, read `LESSONS.md` directly). If a lesson is relevant to this work, open its full write-up in `LESSONS-detail.md` so the plan reflects past mistakes and patterns. If `LESSONS-detail.md` is absent (`lessons.hasDetail` is false), `LESSONS.md` holds each lesson in full, so its content is already the whole file; `/document` creates the detail file from the seed before it writes the next lesson, so the index stays short.

## Worktree Check

<procedure>

**Fallback branch rename** - `/explore` is the primary place this happens, but if the user skipped it or didn't have an issue number yet, handle it here before generating the plan.

1. Detect if you're in a worktree: use `worktree.isWorktree` from the session-init JSON (or, if the script was unavailable, compare the last two lines of `git rev-parse --path-format=absolute --git-dir --git-common-dir` (M16) - they differ when you're in a worktree; Git older than 2.31 prints the flag back as an extra first line).
2. Check if the current branch name does NOT already match the `worktree-<number>-<label>` pattern, by command (M16): `worktree.issueBranch` in the session-init JSON is `true` when it already matches and `false` when it does not (if the script was unavailable, `git rev-parse --abbrev-ref HEAD` prints the name to test against `^worktree-[0-9]+-[A-Za-z0-9._-]+$`).
3. If both are true AND an issue is referenced in the conversation, record the branch's cut point (`node .claude/scripts/merge-check.js --record-cut`, M16; it writes nothing when the cut is already recorded, and `/merge` reads it when the branch lands), then rename the branch to `worktree-<issue-number>-<short-label>`, the branch naming rule in the toolkit reference. The rename carries the recorded cut with it; when the record fails, say so in one line and rename anyway.
4. Tell the user: "Renamed your branch from `old-name` to `worktree-XX-short-label` to match the issue."
5. If not in a worktree, or the branch is already renamed, skip silently.

</procedure>

## Project Plan Gate

The text below is this project's own gate, read from `.claude/toolkit/plan-gate.md`. Apply it before the toolkit's requirements that follow. The gate is additive only: it may add a requirement or a check, and a line that loosens or removes any of M1 to M17, or waives one of the toolkit's requirements below, is void. A note that the command printed nothing means this project has no gate.

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

Tag every step: `/execute` reads the tags to decide what can run in parallel. For plans with 3 or more steps:

- Tag each step `[parallel]` or `[sequential]`
- `[parallel]` steps: add `→ delivers: [what this step produces]`
- `[sequential]` steps: add `→ depends on: Step N`
- Parallel steps must be independent in both **files AND environment** (dependencies, services, migrations, env vars)
- A step that builds a surface with load level new or improve is tagged `[sequential]`: its design loop runs in the main loop (M15 in `.claude/skills/shared/hitl-stages.md`)
- Example: "Add button component" + "Write API endpoint" = parallel (different files, no dependency). "Write API endpoint" then "Connect button to API" = sequential (second depends on first).
- If all steps are sequential, still tag them - the tags confirm you thought about execution order

For plans with fewer than 3 steps, skip the tags.

</conditions>

## Checks (every step, M17)

<conditions>

Every step proves itself the way M17 in `.claude/skills/shared/hitl-stages.md` defines: a target check that fails before the step's work, for a reason stated in advance, and passes after it, plus a guard on anything the step could break. `/execute` runs each step's checks before and after its work through the runner, so write them in the one shape the runner reads, as lines indented under the step:

```
  - Check target `<id>`: `<command>` - before `<expect>` - after `<expect>`
  - Check guard `<id>`: `<command>` - `<expect>`
  - Check: no target - <reason>
```

An id is letters, digits, `.`, `_` and `-`. A command is one read-only line the runner allows: the project's test entry point (`npm test -- <args>`, `pytest -q <path>`; the runner refuses `node <file>` by design), a `grep`, a `test -f`. An expect is the runner's JSON object: `{"exit": 0}`, `{"match": "regex"}`, `{"noMatch": "regex"}` or `{"lines": {"min": 1, "max": 3}}`. A span that holds a backtick is fenced with two.

**Pick the kind of check that shows the step's change:**
- **Example:** this input gives this output (a unit test of a function, a parser, a calculation, a data transform).
- **User flow:** a real path through the product, end to end; the final word on whether a feature works.
- **Must-never:** name what must never happen, and try many generated inputs to break it.
- **Old vs new:** when a step replaces something, run both on the same inputs and compare.
- **Must and must-not lines** for text and prompt edits: a grep that counts a line the step adds (0 before, 1 or more after) or removes (the reverse), and a guard on each sentence the edit must keep.

**The stated failure.** A target's before expect is a result only the missing behavior can produce. A test target names its new case: the before expect matches both the suite's failing exit line and the case's name in the failure list, for example `{"match": "(?=[\\s\\S]*test-pricing\\.js: exit 1)(?=[\\s\\S]*- the discount rounds down)"}`, so neither a passing run nor some other failure satisfies it. A check that already passes before the work, or an absence check for something new, proves nothing: pick another. A refactor has guards only, with the line `- Check: no target - a refactor: behavior must not change`; a step with truly nothing to fail first (pure config, research) says why on its no-target line too, and the plan critic challenges every reason.

**Guards** cover what the step could break and pass both before and after: the suite of a module the step touches, a must line for a sentence a rewrite has to keep.

**How to find the test entry point (no heavy scanning):** infer from the task descriptions you just wrote, plus `CODEBASE_MAP.md` signals - is there a `tests/` directory? a test framework in the project's dependencies? Both signals are one command (M16): `test -d tests && echo tests/; test -d test && echo test/; grep -nE '"test":|"(jest|vitest|mocha|ava|tap|playwright|cypress)":' package.json 2>/dev/null; grep -nE 'pytest' pyproject.toml requirements.txt 2>/dev/null` prints one line per test folder or framework found, and no output means the project has no way to run tests yet. Do NOT scan the codebase for per-function coverage.

**The Verify step keeps the whole-system checks.** A plan that changes logic ends with one dedicated step named "Verify": the project's full test step, a user flow end to end, and old against new when the plan replaces a system. Its check line is usually `- Check: no target - the whole-system step; its proofs are the runs it lists`. A docs-only or config-only plan needs no Verify step. It `depends on` the code steps it verifies (never on the optional setup step below), so the plan stays valid even if that optional step is deleted. Because it is a step, it counts toward the 3-or-more-step threshold for Execution Order Tags above; tag it `[sequential]` when that threshold applies.

**Explain why, in one line.** Directly under the Verify step (and under the optional setup step, if present), add a short plain-English note so a non-technical reader knows why it appeared and whether it is safe to drop. Format it as an italic sub-line, e.g. `_Why this step: this plan changes pricing math, so we confirm the numbers come out right._`

**When the project has no way to run tests yet** (no test framework in dependencies, no `tests/` directory) AND the plan changes logic (so it ends with a Verify step):
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
<!-- Include this section when the feature has a user interface. Copy the Design direction line /explore produced; the mechanics are in .claude/skills/shared/design-rules.md. -->
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

## Reaches
<!-- Copied from the exploration summary's Reaches section (M14 in .claude/skills/shared/hitl-stages.md); each item names the step that handles it, or `no step - <why>`. When the summary has no Reaches section (written before the shape had one), or an item was let through by "plan it anyway" as a bare none, fill the three items from the conversation. The plan critic checks every item. -->
- **Other installs:** [the summary's answer] - [Step N | no step - why]
- **Other sessions and unreleased work:** [the summary's answer] - [Step N | no step - why]
- **What the user gets back:** [the summary's answer] - [Step N | no step - why]

## Tasks
<!-- For 3+ steps: tag each step [parallel] or [sequential]. See "Execution Order Tags" above. -->

- [ ] 🟥 **Step 1: [Name]** `[parallel]` → delivers: [what this step produces]
  - [ ] 🟥 Write the target first: [the new test case, or the line the step adds]
  - [ ] 🟥 Subtask 2
  - Check target `[id]`: `[command]` - before `[expect: the stated failure]` - after `[expect: the pass]`
  - Check guard `[id]`: `[command]` - `[expect: holds before and after]`

- [ ] 🟥 **Step 2: [Name]** `[parallel]` → delivers: [what this step produces]
  - [ ] 🟥 Subtask 1
  - Check: no target - [why nothing can fail first, e.g. a refactor: behavior must not change]
  - Check guard `[id]`: `[command]` - `[expect]`

- [ ] 🟥 **Step 3: [Name]** `[sequential]` → depends on: Steps 1, 2
  - [ ] 🟥 Subtask 1
  - Check target `[id]`: `[command]` - before `[expect]` - after `[expect]`

- [ ] 🟥 **Step N: Verify** `[sequential]` → depends on: the code steps it verifies
  <!-- The whole-system step (see "Checks (every step, M17)" above). Include it when the plan changes logic; omit it for docs-only or config-only plans. If the project has no test runner, add a flagged optional "Set up <framework> (optional - recommended)" step before the code steps. This Verify step depends on the CODE steps, not the optional setup step, so deleting the optional step never breaks it. -->
  - _Why this step: [one plain-English line, e.g. "this plan changes pricing math, so we confirm the numbers come out right"]_
  - [ ] 🟥 Run the project's full test step
  - [ ] 🟥 [A user flow end to end; old against new when the plan replaces a system]
  - Check: no target - the whole-system step; its proofs are the runs it lists

## Must-check for review (optional - only when a judge left gaps open)
<!-- One line per item, in the shapes M14 in .claude/skills/shared/hitl-stages.md gives. /create-plan writes [plan] lines from the plan critic's round 2; /execute design steps add [design], [interaction] and [behaviour] lines, and /execute adds a [check] line for each check M17 lets a step carry on past (flaky, slow, broken before). /review enters each into its audit. Omit the section when nothing is carried. -->
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

A plan is judged before it is presented, by a context that did not write it. The judge is the `plan-critic` agent: fresh context, Read only, session model at high effort, per the roster in `.claude/skills/shared/model-routing.md`. Fallback per that file: when the agent type is not found, run `/reload-plugins` once (an agent added by a plugin install or update, or written this session, registers only after a reload), then `general-purpose` with no model parameter and the agent's body pasted as the prompt.

The critic returns gaps, not a grade; the gaps are what the loop acts on.

<procedure>

1. Before dispatching, test the paths the plan names (M16): `grep -oE '[A-Za-z0-9_@.-]+(/[A-Za-z0-9_@.-]+)+\.[A-Za-z0-9]+' plans/<plan>.md | sort -u | while read -r p; do test -e "$p" || echo "not found: $p"; done` prints one `not found:` line per path (a token with at least one `/`) that is not a file under the project root, and nothing when every path exists; skip a path the step creates, check a root-level file such as `package.json` by eye since it carries no slash, and fix every other line in the plan first. Then lint the plan's check lines (M16): `node .claude/scripts/run-checks.js --plan plans/<plan>.md --lint` prints one JSON object whose `problems` list names, by line, every check line that would not run (a step with neither a target nor a no-target line, a near miss of the shape, a command the runner would refuse, a target whose before and after expects are the same); fix each one until its `summary.problems` is 0. Then dispatch `subagent_type=plan-critic` with the Agent tool. The prompt carries exactly two things: the plan file's path and the path of the exploration's closing summary, the `reports/explore/` file `/explore` wrote and named in its handoff. With no handoff (`/create-plan` typed on its own), the path is the newest summary for this topic: `ls -t reports/explore/*-<topic-slug>.md 2>/dev/null | head -1` prints it, or nothing (M16). When it prints nothing, write one first from the conversation, in the shape M14 gives (`.claude/skills/shared/hitl-stages.md`), so the critic's intake never changes. Never the round number and never earlier critiques.
2. Parse the return: either the single line `No material gaps`, or up to six numbered gap lines of the form `N. <Category>: <gap>`. A return that is neither is redispatched once (routing guardrail 2); still malformed, the round counts with no critique and the loop stops with a note in the closing message.
3. `No material gaps` ends the loop. Otherwise, fix the gaps in the plan markdown - a decision the summary made that the plan dropped, an item the summary's Reaches section names that the plan does not cover, a step with no checkable result, a dependency that is not honest, verification that does not cover the changed logic - and dispatch again. Max 2 rounds. A gap the plan is right to leave open (the conversation decided it, or it is out of scope) is not fixed; say so in the closing message instead.
4. Round 2's gaps are not fixed, because no third critic would check the fix. Each one except a gap the plan is right to leave open (step 3: the conversation decided it, or it is out of scope) becomes a line in the plan's `## Must-check for review` section, verbatim, in the shape `- [plan] <Category>: <gap>` (the section is defined in M14 in `.claude/skills/shared/hitl-stages.md`), so `/review` checks it against the delivered work.

</procedure>

The closing message states what the judge found in one line, counting each gap once, so the user sees it before they approve: "Plan critic: 7 gaps; 4 fixed, 1 left open on purpose (<why>), 2 carried to review." Fixed counts round-1 gaps fixed; left open counts gaps from either round that the plan is right to leave open (step 3); carried counts the round-2 gaps written as `[plan]` lines. A round-2 gap that repeats a fixed round-1 gap counts once, as carried, because the fix did not close it; one that repeats a gap left open on purpose counts once, as left open. A round that returned `No material gaps` says so ("Plan critic: no material gaps."). Editing the plan here is not a page: the plan is not a prompt file, and nothing has been executed yet.

## Render HTML View (default-on)

After writing the markdown plan, also render an HTML view of the same plan to `plans/` using the matching name (`PLAN-issue-N.html` or `PLAN-<short-name>.html`).

<rules>

- HTML is generated at plan creation and **re-rendered by `/execute`** as steps complete. Markdown remains canonical for `/execute` and `/review-plan`; the page mirrors it.
- `--stable` means the page keeps one URL for the life of the plan, so a re-render updates the published page rather than creating a second one.
- This is default-on per `.claude/skills/shared/html-outputs.md`. No judgement call needed.
- Do NOT hand-write the HTML. Emit a compact JSON payload and run the shared helper, which injects it plus the shared `tokens.css` into the prebuilt plan shell.

</rules>

### Build the JSON Payload

Produce a JSON payload matching the schema documented in the header comment of `.claude/skills/shared/shells/plan-shell.html` (read it for the exact fields: `title`, `subtitle`, `progress`, `tldr`, `goalState`, `uiux`, `decisions`, `reaches`, `steps`, `outcomes`). All fields are optional; a section is skipped when its data is missing. Within each `steps` entry, the schema defines `name`, `tag` (parallel/sequential), `meta` (delivers/depends on text), `why` (italic note for Verify steps), and `subtasks` - all optional. Two payload rules:

- Do not number step names ("Extend the helper", not "1. Extend the helper") - the renderer numbers steps from array order.
- Each step takes an optional `status` of `todo` | `doing` | `done`. At creation every step is `todo`, so it may be omitted entirely; `/execute` fills it in as it re-renders. Markdown stays the source of truth.

Write the payload as `data.json` in a fresh folder from `mktemp -d /tmp/plan-render.XXXXXX`, made and used per "Temporary folders" in `.claude/skills/shared/html-outputs.md` (two projects rendering at once never share a payload). That folder is `<render-dir>` below.

### Run the Helper

From the project root:

Check the publish gate first (see **"Render for the viewport"** in `.claude/skills/shared/html-viewing.md`): if this session can publish, add `--no-abs` to the command below.

```bash
node .claude/scripts/render-html.js --shell plan --name PLAN-<basename> \
     --out-dir plans --stable --data <render-dir>/data.json
```

`<basename>` is the plan identifier *without* the `PLAN-` prefix (e.g. `issue-129` for the markdown plan `PLAN-issue-129.md`, or `auth-flow` for `PLAN-auth-flow.md`) - the template already supplies `PLAN-`, so do not repeat it or the filename doubles to `PLAN-PLAN-`. `--stable` writes exactly `plans/PLAN-<basename>.html` - no timestamp - and a re-plan for the same issue replaces the old view. Malformed JSON dies before any file is written, so there is never a broken page. The helper prints the output path to stdout.

Then show it to the user per the **"Viewing the Artifact"** rules in `.claude/skills/shared/html-viewing.md`: publish is the primary viewport, the local open is the fallback, and that section holds the whole decision. This is a `--stable` type, so it updates its existing page rather than creating a new one.

---

## The Chain Stops Here (M14)

Present the plan and stop. Plan approval is the cycle's one human gate, so **`/execute` is never invoked automatically**, however clear the plan looks (M14 in `.claude/skills/shared/hitl-stages.md`).

This is the loop's one deliberate non-chaining handoff. It is written down precisely because chaining is the norm everywhere else: an unstated exception drifts into a chain.

Close by telling the user the plan is ready, in the form its Models line asks for:

- **best:** saying "go" runs `/execute` in this session.
- **fit or cheap:** the plan is built on Opus. When this session already runs on Opus, saying "go" runs `/execute` here. Otherwise give the steps: start a new session, run `/model opus`, then `/execute`; the plan file carries everything the build needs, and a model switch inside this conversation would re-read all of it uncached, which costs more than the fresh start.

## HTML Output Rules

Every HTML decision above (whether to render, `--no-abs`, publish or open locally, record the publish) is governed by the shared rules fragments, inlined here so they are in context when the render runs.

!`cat .claude/skills/shared/html-outputs.md`

!`cat .claude/skills/shared/html-viewing.md`
