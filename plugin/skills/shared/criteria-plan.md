## How to Review

<procedure>

First, find the plan file to review against. Auto-detect the most recently modified `PLAN-*.md` file in `plans/` (also check the project root for legacy plan files). If no plan file exists, pause and ask the user: "I couldn't find a plan file. Which file should I compare against, or would /tk:review-code be more appropriate?" If multiple plan files exist and the most recent one is not clearly complete (all tasks checked off), pause and ask the user: "Which plan file should I evaluate against?"

Read the plan file, then read the implementation files. Compare them. Pick one of two modes:

**Small change** (1-2 plan tasks, few files): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ plan tasks or significant scope): when running this skill **directly** (a subagent dispatched by /tk:review is always single-pass - subagents cannot spawn sub-agents), run four focused sub-agents in parallel using the Agent tool (`subagent_type=tk:review-plan-finder`, this kind's finder per the roster in `${CLAUDE_PLUGIN_ROOT}/skills/shared/model-routing.md`, which preloads these criteria and the dispatch contract in `${CLAUDE_PLUGIN_ROOT}/skills/dispatch-contract/SKILL.md`; fallback per that rule: `general-purpose` carrying what its roster row declares, with this file's criteria and that contract pasted into the prompt), then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Feature Completeness** | Every plan task implemented? Subtasks done? Placeholders remaining? |
| **Spec Compliance** | Implementation matches UI/UX Design section and critical decisions in plan? |
| **Scope Management** | Unplanned additions? Cuts justified and documented? Scope creep? |
| **Quality Gates** | Success criteria met? Tests written (when the plan warranted them)? Docs updated? |

Each sub-agent should use the severity scale and Finding ID format below. If a sub-agent has no findings, it should report "No issues found" so the user knows it ran.

</procedure>
