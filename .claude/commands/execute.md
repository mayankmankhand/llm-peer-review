# Execute Plan

Now implement precisely as planned, in full.

## Implementation Requirements

<rules>
- Write elegant, minimal, modular code
- Adhere strictly to existing code patterns, conventions, and best practices
- Include thorough, clear comments/documentation within the code
- As you implement each step:
  - Update the markdown tracking document with emoji status and overall progress percentage dynamically
</rules>

## Parallel Steps

When the plan has steps tagged `[parallel]`, follow these rules:

<conditions>
### Pre-flight Check
Before spawning parallel agents, list the files each agent will touch. If any files overlap between agents, downgrade the overlapping steps to `[sequential]`. Non-overlapping steps can still run in parallel.

### User Confirmation
Before starting parallel work, tell the user what each task will do:
> "Running two tasks in parallel: Task 1 does [X], Task 2 does [Y]. OK to proceed?"
Wait for approval before continuing.

### Agent Contract
Each parallel agent must:
1. **Declare touched files** - list every file it will create or modify
2. **State assumptions** - what it expects to be true about the codebase
3. **Provide an integration checklist** - what the next step needs to verify

### Integration Checkpoint
After all parallel steps finish, always run a sequential checkpoint:
1. Merge results into the codebase
2. Run tests (if any exist)
3. Resolve inconsistencies between parallel outputs
4. Update the plan status
</conditions>

## When to Stop

<rules>
If you hit a critical blocker, **stop executing**. Don't push through a broken plan. Instead:
1. Explain what went wrong and why
2. Suggest re-running `/create-plan` with what you've learned

**Critical blocker examples:** the plan assumed an API supports a feature it doesn't, a core dependency is incompatible with the project, or the planned architecture can't work as designed.

**Not a critical blocker:** a typo, a syntax error, a small refactor needed, or a step that takes longer than expected. Fix these and keep going.
</rules>

## Status Updates

<procedure>
After completing each step, update the plan file:
- Change 🟥 to 🟨 when starting a task
- Change 🟨 to 🟩 when completing a task
- Update the overall progress percentage at the top
- After all steps are complete, fill in the plan's `## Outcomes` section with what changed, deviations, and key decisions made during execution
</procedure>
