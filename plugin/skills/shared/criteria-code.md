## How to Review

<procedure>

Read the changed files. Then pick one of two modes:

**Small change** (1-2 files): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or significant logic): when running this skill **directly** (a subagent dispatched by /tk:review is always single-pass - subagents cannot spawn sub-agents), run four focused sub-agents in parallel using the Agent tool (`subagent_type=tk:review-code-finder` with `model` set to its `models.perRole` value, where `session`, or a model above your own, means your own model family's alias; this kind's finder per the roster in `${CLAUDE_PLUGIN_ROOT}/skills/shared/model-routing.md`, which preloads these criteria and the dispatch contract in `${CLAUDE_PLUGIN_ROOT}/skills/dispatch-contract/SKILL.md`; fallback per that rule: `general-purpose` carrying the same `model`, with this file's criteria and that contract pasted into the prompt), then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Security** | Auth checks, input validation, secrets exposure, injection risks |
| **Code Quality** | Naming, duplication, complexity, pattern consistency |
| **Logic** | Edge cases, off-by-ones, missing error handling, wrong assumptions |
| **Performance & Maintainability** | O(n) issues, memory usage, tech debt, maintainability concerns |

Each sub-agent returns JSONL per the dispatch contract, or the literal `NO FINDINGS`, so you can see it ran. Assign R-IDs yourself after combining and deduping, per the Finding ID format below.

**Rebuilt render paths** (the Logic pass owns it in a fan-out). When the diff adds or changes code that empties and rebuilds part of the page (an `innerHTML` reassignment, a children replace, a list re-rendered from scratch, a render scheduled on every animation frame, timer, or state change), work it as a count, not an impression:

1. Find each rebuild and the subtree it empties.
2. List every piece of state held on an element inside that subtree: a typed draft in a field, focus or a text selection, the armed first step of a two-step control, an open or collapsed panel, a scroll position.
3. Each one is a finding unless the code keeps that state outside the DOM and restores it after the rebuild, or skips the rebuild while that state exists.

A rebuild that runs on a timer or every frame when nothing it displays has changed is a finding too, for the work it throws away. None of this shows in a screenshot, so a design critic cannot catch it; this pass is where it gets caught.

</procedure>
