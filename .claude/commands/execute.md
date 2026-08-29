# Execute Plan

**Use this when:** Building a feature step-by-step against an existing plan in `plans/PLAN-*.md`.
**Don't use this when:** No plan exists yet (use `/create-plan` first), or the change is a one-line fix that does not need a plan.

Now implement precisely as planned, in full.

Executing an approved plan is the auto stage of the toolkit loop: the plan approval was the human gate, and `/execute` is never chained into automatically (M14). The loop's shared mechanics live in `.claude/skills/shared/hitl-loop.md` (rationale in `docs/HITL-MAP.md`). Two per-run opt-outs: "report only" restores report-first behavior for the run (M10), "no chaining" stops after this stage instead of handing off to `/review` (M14).

## Implementation Requirements

<rules>
- Write elegant, minimal, modular code
- Adhere strictly to existing code patterns, conventions, and best practices
- Include thorough, clear comments/documentation within the code
- As you implement each step:
  - Update the markdown tracking document with emoji status and overall progress percentage dynamically
- After each step's work is green, make a checkpoint commit of that logical unit (M4) before moving on
- Always-ask actions page for approval before applying, per M9 - during /execute that is most often an edit to a prompt file; the full list lives in `.claude/skills/shared/hitl-loop.md`
</rules>

## Read Past Lessons

**Session context (fast path):** Run `node .claude/scripts/session-init.js` once. It returns a single JSON with `lessons` (exists, content, hasDetail) and `newestPlan` (the most recently modified `PLAN-*.md`, used in Status Updates below). Use these instead of separate reads. **Fallback:** if the script is missing or errors (older installs), do the manual reads instead - behavior is identical.

Before implementing, use the lesson index from the JSON (`lessons.content`, one line each; if the script was unavailable, read `LESSONS.md` directly). If a lesson is relevant to the code you are about to write, open its full write-up in `LESSONS-detail.md` first, so you do not repeat a past mistake. If `LESSONS-detail.md` is absent (`lessons.hasDetail` is false), `LESSONS.md` is the older flat format - its content is already the whole file.

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
2. Run tests (if any exist)
3. Resolve inconsistencies between parallel outputs
4. Update the plan status
</conditions>

## When to Stop

<rules>
If you hit a critical blocker, **stop executing**. Don't push through a broken plan. A blocker unresolved within the retry bound is a hard stop that pages the human (M1 in `.claude/skills/shared/hitl-loop.md`) - phrase it as a decision a non-engineer can make. Instead:
1. Explain what went wrong and why, what the options are, and a recommended default
2. Suggest re-running `/create-plan` with what you've learned

**Critical blocker examples:** the plan assumed an API supports a feature it doesn't, a core dependency is incompatible with the project, or the planned architecture can't work as designed.

**Not a critical blocker:** a typo, a syntax error, a small refactor needed, or a step that takes longer than expected. Fix these and keep going - within the retry bound below.

**Retry bound (small failures):** max 3 fix attempts per step, and a plan's Verify step counts as a step under this same bound. The budget is shared, not fresh: if a failure already used its 3 attempts inside a step, it does not get 3 more when the same failure resurfaces at the Verify step. Each attempt must iterate against that step's verification output (the failing test or build result), not guess blindly. If the 3rd attempt still fails, treat it as a critical blocker: stop and follow the two steps above.

**When a plan's Verify step fails:** the retry bound above applies unchanged. The only Verify-specific addition is the outcome: when the bound is exhausted, stop via the critical-blocker path above and suggest re-running `/create-plan` with what you learned.
</rules>

## Status Updates

<procedure>
Find the plan file in `plans/`: use `newestPlan` from the session-init JSON (the most recently modified `PLAN-*.md`). If the script was unavailable, find the most recently modified `PLAN-*.md` yourself. Also check the project root for legacy plan files.

After completing each step, update the plan file:
- Change 🟥 to 🟨 when starting a task
- Change 🟨 to 🟩 when completing a task
- Update the overall progress percentage at the top
- After all steps are complete, fill in the plan's `## Outcomes` section with what changed, deviations, and key decisions made during execution
</procedure>

---

## Chain Into /review (M14)

On a clean finish - every step green, the plan at 100%, each logical unit checkpoint-committed (M4) - announce the handoff in one line ("Execution complete - chaining into `/review` per M14. Say \"no chaining\" to stop here.") and invoke `/review` through the Skill tool.

**Do not chain** when either brake is engaged:

- The critical-blocker path above fired. A blocker is a hard stop that pages the human (M1); chaining past it would review work that was never finished.
- A step exhausted its 3-attempt retry bound. Same reasoning: the bound exists to stop the run, not to hand a broken state to the next stage.

In both cases, stop and page as described above. The chain resumes only after the human decides what to do.

Saying "no chaining" on this run stops here (M14). That is a different opt-out from "report only" (M10), which governs whether findings get auto-fixed rather than whether the next stage fires.
