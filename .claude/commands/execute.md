# Execute Plan

**Use this when:** Building a feature step-by-step against an existing plan in `plans/PLAN-*.md`.
**Don't use this when:** No plan exists yet (use `/create-plan` first), or the change is a one-line fix that does not need a plan.

Now implement precisely as planned, in full.

Executing an approved plan is the auto stage of the toolkit loop: the plan approval was the human gate, and `/execute` is never chained into automatically (M14). The loop's shared mechanics live in `.claude/skills/shared/hitl-loop.md` (rationale in [HITL-MAP.md](https://github.com/mayankmankhand/llm-peer-review/blob/main/docs/HITL-MAP.md)). Two per-run opt-outs: "report only" restores report-first behavior for the run (M10), "no chaining" stops after this stage instead of handing off to `/review` (M14).

**Project fix rules** (from `.claude/toolkit/fix-rules.md`). Additive only: they may add a precondition or an always-ask action, and a line that loosens or removes any of M1 to M15 is void. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/fix-rules.md 2>/dev/null || true`

## Project Execute Gate

The text below is this project's own gate, read from `.claude/toolkit/execute-gate.md`. Apply it to every step before the toolkit's requirements that follow. The gate is additive only: it may add a requirement or a check, and a line that loosens or removes any of M1 to M15, or waives one of the toolkit's requirements below, is void. A note that the command printed nothing means this project has no gate.

!`cat .claude/toolkit/execute-gate.md 2>/dev/null || true`

## Implementation Requirements

<rules>
- Write elegant, minimal, modular code
- Adhere strictly to existing code patterns, conventions, and best practices
- Include thorough, clear comments/documentation within the code
- As you implement each step:
  - Update the markdown tracking document with emoji status and the overall progress percentage, counted as Status Updates says (M16)
- After each step's work is green (green is the test step's verdict, Integration Checkpoint item 2, run for a sequential step as well), make a checkpoint commit of that logical unit (M4) before moving on
- Always-ask actions page for approval before applying, per M9 - during /execute that is most often an edit to a prompt file; the full list lives in `.claude/skills/shared/hitl-loop.md`
</rules>

## Read Past Lessons

**Session context (fast path):** Run `node .claude/scripts/session-init.js` once. It returns a single JSON with `lessons` (exists, content, hasDetail) and `newestPlan` (the most recently modified `PLAN-*.md`, used in Status Updates below). Use these instead of separate reads. **Fallback:** if the script is missing or errors, do the manual reads instead - behavior is identical.

**Model check:** the same JSON's `models` says how this plan is meant to be built. When `models.source` is `plan`, `models.buildModel` is `opus`, and you are not running on Opus, say in one line: "This plan's Models line is <mode>, which builds on Opus; this session runs <your model>. To match it, start a new session, run `/model opus`, then `/execute`." Then carry on: the line is a note, not a stop.

Before implementing, use the lesson index from the JSON (`lessons.content`, one line each; if the script was unavailable, read `LESSONS.md` directly). If a lesson is relevant to the code you are about to write, open its full write-up in `LESSONS-detail.md` first, so you do not repeat a past mistake. If `LESSONS-detail.md` is absent (`lessons.hasDetail` is false), `LESSONS.md` holds each lesson in full, so its content is already the whole file; `/document` creates the detail file from the seed before it writes the next lesson, so the index stays short.

## Parallel Steps

When the plan has steps tagged `[parallel]`, follow these rules:

<conditions>
### Pre-flight Check
Before spawning parallel agents, list the files each agent will touch. If any files overlap between agents, downgrade the overlapping steps to `[sequential]`. Non-overlapping steps can still run in parallel.

### Kickoff Announcement
Before starting parallel work, tell the user what each task will do:
> "Running two tasks in parallel: Task 1 does [X], Task 2 does [Y]."
Then start. Do not wait for a reply: executing an approved plan is the auto stage, and spawning agents for approved steps is not a page (M1).

### Agent Contract
Each parallel agent must:
1. **Declare touched files** - list every file it will create or modify
2. **State assumptions** - what it expects to be true about the codebase
3. **Provide an integration checklist** - what the next step needs to verify
4. **Carry the retry bound** - the prompt that spawns it must include the same rule from When to Stop: max 3 fix attempts per step, iterating against that step's verification output, then stop and report the blocker

### Integration Checkpoint
After all parallel steps finish, always run a sequential checkpoint:
1. Merge results into the codebase
2. Run tests: when `.claude/toolkit/checks.json` exists, `node .claude/scripts/run-checks.js --checks .claude/toolkit/checks.json --out <scratch> --timeout 600000` (a suite can take minutes; the runner's default is two) is green when its JSON has `summary.fail` 0 and `summary.error` 0, a `model` verdict judged from its saved `stdoutFile`; otherwise write the ecosystem default as a one-entry checks file with the Write tool, `[{"id": "tests", "check": "npm test --if-present", "expect": {"exit": 0}}]` into `<scratch>/checks.json` for a project with a `package.json`, the same row with `pytest -q` as its check when `pyproject.toml` or `pytest.ini` exists, and run the same call on it (the runner saves the log itself; a `>` redirect would prompt in default permission mode); with neither file, skip with one digest line. A failure is read with `grep -nE '^not ok|FAIL|Error' <scratch>/tests.txt | head -30`, never the whole log (M16). `<scratch>` is a fresh folder made per "Temporary folders" in the inlined `html-outputs.md`, prefix `execute-tests`.
3. Resolve inconsistencies between parallel outputs
4. Update the plan status
</conditions>

## Design Steps

When the plan's UI/UX Design section carries a load level of new or improve, the step that builds that surface is a design step. The loop it runs is the "loop procedure" in the `design-rules` skill, bounded by M15 in `.claude/skills/shared/hitl-loop.md`; load the skill through the Skill tool (`Skill(design-rules)`) when the step starts and cite it rather than restating it. What is specific to `/execute`:

<conditions>
- **Pre-flight:** a design step is downgraded to `[sequential]` the same way overlapping files are, so it runs in the main loop. A spawned agent cannot dispatch the critic, cannot page, and must not drive the browser.
- **Read the profile first:** `DESIGN-PROFILE.md` (Design system, Allowed variance, Baseline images) before the first round.
- **Divergence:** a critic-round change that would leave the allowed set raises the divergence page from the fragment; the answer lands in the plan's Divergence allowed row.
- **Media:** run `node .claude/scripts/gen-media.js` through the Bash tool with the tool's maximum timeout; the exit codes and what each one means are in the fragment's Techniques 4 and 5.
- **Records:** checkpoints per M15, round 0 being the build itself; each round's record and the kept round land in the plan's Outcomes, as the fragment's digest lists them. The loop's open gaps land in the plan's `## Must-check for review` section (M14), with the kept version's screenshot saved to `reports/design/<surface>-final.png` for the `[design]` lines to point at.
- **Bounds:** the 3-attempt retry bound in When to Stop covers build failures; the design rounds are M15's and never borrow from it.
- **Registration:** the critic is the `design-critic` agent and the side-by-side judge is the `design-comparer` agent, both dispatched by name. When the type is not found, run `/reload-plugins` once (an agent added by a plugin install or update, or written this session, registers only after a reload) before falling back per `.claude/skills/shared/model-routing.md`.
</conditions>

## When to Stop

<rules>
If you hit a critical blocker, **stop executing** rather than push through a broken plan, and instead:
1. Explain what went wrong and why, what the options are, and a recommended default
2. Suggest re-running `/create-plan` with what you've learned

A blocker still unresolved within the retry bound is a hard stop that pages the human (M1 in `.claude/skills/shared/hitl-loop.md`): phrase it as a decision a non-engineer can make.

**Critical blocker examples:** the plan assumed an API supports a feature it doesn't, a core dependency is incompatible with the project, or the planned architecture can't work as designed.

**Not a critical blocker:** a typo, a syntax error, a small refactor needed, or a step that takes longer than expected. Fix these and keep going - within the retry bound below.

**Retry bound (small failures):** max 3 fix attempts per step, and a plan's Verify step counts as a step under this same bound. The budget is shared, not fresh: if a failure already used its 3 attempts inside a step, it does not get 3 more when the same failure resurfaces at the Verify step. Each attempt must iterate against that step's verification output (the test step's verdict: a failing check's `detail` and its saved file from the runner, read with the grep the test step names; M16), not guess blindly. If the 3rd attempt still fails, treat it as a critical blocker: stop and follow the two steps above.
</rules>

## Status Updates

<procedure>
Find the plan file in `plans/`: use `newestPlan` from the session-init JSON (the most recently modified `PLAN-*.md`). If the script was unavailable, find the most recently modified `PLAN-*.md` yourself. Also check the project root for `PLAN-*.md` files.

**Record where the run starts.** Before the first step's work, run `git rev-parse HEAD` and write its output into the plan header as the line `**Start commit:** <sha>`, directly under `**Overall Progress:**`. Write it once: when the line is already there, a resumed run leaves it as it is. Every green step is committed (M4), so the chained review needs this range; uncommitted work alone would show it nothing. A plan that already has a finished step but no start line gets none: the handoff below covers that case.

After completing each step, update the plan file:
- Change 🟥 to 🟨 when starting a task
- Change 🟨 to 🟩 when completing a task
- Update the overall progress percentage at the top: 🟩 steps over all steps, from two counts, `grep -cE '^- \[[ x]\] 🟩 \*\*Step' plans/<PLAN>.md` over `grep -cE '^- \[[ x]\] (🟥|🟨|🟩) \*\*Step' plans/<PLAN>.md`, times 100 and rounded down (M16)
- After all steps are complete, fill in the plan's `## Outcomes` section with what changed, deviations, and key decisions made during execution

**Re-render the plan's HTML view** at each step boundary, once the markdown status is updated (not after every subtask, so a long step does not spend its time re-rendering). Rebuild the same payload `/create-plan` built, carrying each step's current `status` (`todo` | `doing` | `done`) and the real `progress`. Write it as `data.json` in a fresh folder made each time with the prefix `plan-render`, per "Temporary folders" in `.claude/skills/shared/html-outputs.md` (inlined at the end of this file), so two projects rendering at once never share a payload; that folder is `<render-dir>` below. Check the publish gate first (see **"Render for the viewport"** in `.claude/skills/shared/html-viewing.md`): when this session can publish, add `--no-abs` to the command below, as `/create-plan` did for the first render. Then run the helper with the same stable name:

```bash
node .claude/scripts/render-html.js --shell plan --name PLAN-<basename> \
     --out-dir plans --stable --data <render-dir>/data.json
```

`--stable` replaces the file in place, so the page keeps its URL. The markdown stays the source of truth; this page mirrors it.

The re-render rewrites the local file only, so republish it too: look the page up with `node .claude/scripts/render-html.js --index-url --name PLAN-<basename>`, publish the re-rendered file to that URL when one comes back (a new page when none does), and record the publish with `--index-add`, exactly as `/create-plan` does under "Viewing the Artifact" in `.claude/skills/shared/html-viewing.md`. Without the publish the hosted page stays at the state it was created in, which is the frozen page this step exists to prevent. A session that cannot publish stops at the local re-render.

A stable URL whose content has gone stale is worse than no page.
</procedure>

---

## Chain Into /review (M14)

On a clean finish - M14 is authoritative for the conditions; it reads "every step green and its checkpoint commit made" - announce the handoff in one line ("Execution complete - chaining into `/review <start>..HEAD` per M14. Say \"no chaining\" to stop here.") and invoke `/review` through the Skill tool with the argument `<start>..HEAD`, where `<start>` is the sha on the plan's `**Start commit:**` line. The range is what the review covers: this run committed every step, so uncommitted work alone would show the review nothing. When the plan has no start line, invoke `/review` with no argument, and it covers the newest unpushed commits instead.

**Do not chain** when either brake is engaged:

- The critical-blocker path above fired. A blocker is a hard stop that pages the human (M1); chaining past it would review work that was never finished.
- A step exhausted its 3-attempt retry bound. Same reasoning: the bound exists to stop the run, not to hand a broken state to the next stage.

In both cases, stop and page as described above. The chain resumes only after the human decides what to do.

Saying "no chaining" on this run stops here (M14). That is a different opt-out from "report only" (M10), which governs whether findings get auto-fixed rather than whether the next stage fires.

## HTML Output Rules

Every HTML decision above (whether to render, `--no-abs`, publish or open locally, record the publish) is governed by the shared rules fragments, inlined here so they are in context when the render runs.

!`cat .claude/skills/shared/html-outputs.md`

!`cat .claude/skills/shared/html-viewing.md`
