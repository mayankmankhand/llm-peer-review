## How to Review

<procedure>

Read the changed files. Then pick one of two modes:

**Small change** (1-2 files): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or significant logic): when running this skill **directly** (a subagent dispatched by /tk:review is always single-pass - subagents cannot spawn sub-agents), run four focused sub-agents in parallel using the Agent tool (`subagent_type=tk:review-code-finder`, this kind's finder per the roster in `${CLAUDE_PLUGIN_ROOT}/skills/shared/model-routing.md`, which preloads these criteria and the dispatch contract in `${CLAUDE_PLUGIN_ROOT}/skills/dispatch-contract/SKILL.md`; fallback per that rule: `general-purpose` carrying what its roster row declares, with this file's criteria and that contract pasted into the prompt), then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Security** | Auth checks, input validation, secrets exposure, injection risks |
| **Code Quality** | Naming, duplication, complexity, pattern consistency |
| **Logic** | Edge cases, off-by-ones, missing error handling, wrong assumptions |
| **Performance & Maintainability** | O(n) issues, memory usage, tech debt, maintainability concerns |

Each sub-agent should use the severity scale and Finding ID format below. If a sub-agent has no findings, it should report "No issues found" so the user knows it ran.

</procedure>
