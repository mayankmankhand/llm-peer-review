## How to Review

<procedure>

First, find the plan file to review against (M16): `node .claude/scripts/session-init.js` prints `newestPlan` and a `plans` list whose matching entry carries `status` (`done` at progress 100) and `progress`, with `others` the list's length minus one, and `ls PLAN-*.md 2>/dev/null` prints any `PLAN-*.md` at the project root (a finder `/review` dispatched has no Bash and takes the plan its prompt names). If no plan file exists (`newestPlan` null and no root file), pause and ask the user: "I couldn't find a plan file. Which file should I compare against, or would /review-code be more appropriate?" If `others` is above 0 and the newest plan's `status` is not `done`, pause and ask the user: "Which plan file should I evaluate against?"

Read the plan file, then read the implementation files. Compare them. Pick one of two modes:

**Small change** (1-2 plan tasks, few files): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ plan tasks or significant scope): when running this skill **directly** (a subagent dispatched by /review is always single-pass - subagents cannot spawn sub-agents), run four focused sub-agents in parallel using the Agent tool (`subagent_type=review-plan-finder` with `model` set to its `models.perRole` value, where `session`, or a model above your own, means your own model family's alias; this kind's finder per the roster in `.claude/skills/shared/model-routing.md`, which preloads these criteria and the dispatch contract in `.claude/skills/dispatch-contract/SKILL.md`; fallback per that rule: `general-purpose` carrying the same `model`, with this file's criteria, the severity anchors, the finding contract and that contract pasted into the prompt), then combine their results (a `NOT CHECKED:` line a sub-agent returned is kept for the report's "What I could not check"):

| Sub-agent | What it checks |
|-----------|----------------|
| **Feature Completeness** | Every plan task implemented? Subtasks done? Placeholders remaining? |
| **Spec Compliance** | Implementation matches UI/UX Design section and critical decisions in plan? |
| **Scope Management** | Unplanned additions? Cuts justified and documented? Scope creep? |
| **Quality Gates** | Success criteria met? Tests written (when the plan warranted them)? Docs updated? |

Each sub-agent returns JSONL per the dispatch contract, or the literal `NO FINDINGS`, so you can see it ran. Write every finding line this run collected, the workers' lines and any the runner authored itself, into `findings.jsonl` in a fresh folder from `mktemp -d /tmp/review-merge.XXXXXX` with the Write tool, then run `node .claude/scripts/merge-findings.js` on that file, typed as literal words: its stdout is the deduplicated, sorted, numbered set (R1 onward, no gaps) and its stderr line carries the raw and merged counts. Two findings that describe one defect under different keys are the one judgment this pass leaves to you: before running the helper, give the later one the earlier one's `key` and record the merge in the report's dedup notes.

</procedure>
