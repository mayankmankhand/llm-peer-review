## How to Review

<procedure>

Read the UI-related files (components, templates, styles, markup). Then pick one of two modes:

**Small change** (1-2 files, minor UI tweak): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or new user-facing feature): when running this skill **directly** (a subagent dispatched by /tk:review is always single-pass - subagents cannot spawn sub-agents), run four focused sub-agents in parallel using the Agent tool (`subagent_type=tk:review-ux-finder`, this kind's finder per the roster in `${CLAUDE_PLUGIN_ROOT}/skills/shared/model-routing.md`, which preloads these criteria and the dispatch contract in `${CLAUDE_PLUGIN_ROOT}/skills/dispatch-contract/SKILL.md`; fallback per that rule: `general-purpose` carrying what its roster row declares, with this file's criteria and that contract pasted into the prompt), then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Usability** | Nielsen's heuristics - feedback, user control, error prevention, consistent language |
| **Accessibility** | WCAG AA - keyboard navigation, contrast, focus indicators, semantic HTML, screen-reader support |
| **User Flows** | Happy path completeness, error states, destructive action confirmations, empty states |
| **Research** | How leading products handle similar UX patterns, against established design systems like Material, Apple HIG, GOV.UK |

**Run the Research searches yourself, before dispatching, and paste the results into that sub-agent's prompt.** This skill grants `WebSearch`; the `review-ux-finder` agent the sub-agents run as does not (`Read, Grep, Glob`), so a Research sub-agent asked to search cannot do the one thing it was dispatched for - it would return heuristics dressed as research, with nothing to signal the difference. Do at most 2 searches, and dispatch the sub-agent with the findings already in hand so its job is applying them, not fetching them.

Do not "fix" this by granting `WebSearch` to `review-ux-finder`. That agent runs every UX dispatch, including the ones `/tk:review` makes, so widening its tool list to serve one row of one skill widens the tool surface of every UX review. Narrowing or widening an agent's tools is a behavior change, not an annotation.

The Research sub-agent should keep findings lightweight and evidence-linked. Clearly separate research-backed findings from heuristic findings. If the searches came back weak, say so and move on - research should not block the review.

Each sub-agent should use the severity scale and Finding ID format below. If a sub-agent has no findings, it should report "No issues found" so the user knows it ran.

</procedure>
