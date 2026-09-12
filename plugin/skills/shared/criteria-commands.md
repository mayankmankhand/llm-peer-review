## How to Review

<procedure>

Read the command files being reviewed. Then pick one of two modes:

**Small change** (1-2 files, minor wording tweaks): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or new/rewritten commands): when running this skill **directly** (a subagent dispatched by /tk:review is always single-pass - subagents cannot spawn sub-agents), run four focused sub-agents in parallel using the Agent tool (`subagent_type=tk:review-commands-finder`, this kind's finder per the roster in `${CLAUDE_PLUGIN_ROOT}/skills/shared/model-routing.md`, which preloads these criteria and the dispatch contract in `${CLAUDE_PLUGIN_ROOT}/skills/dispatch-contract/SKILL.md`; fallback per that rule: `general-purpose` carrying what its roster row declares, with this file's criteria and that contract pasted into the prompt), then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Prompt Engineering** | Clarity of instructions, ambiguities, conflicting directives, missing examples |
| **Cross-command Consistency** | Terminology alignment, structure, formatting, prerequisite references across commands |
| **Workflow Completeness** | Missing steps, dead ends, assumption gaps, output usability, failure modes |
| **Workflow Ergonomics** | Cognitive load, progress visibility, mistake recovery, workflow clarity for users without specialized knowledge |

Each sub-agent should use the severity scale and Finding ID format below. If a sub-agent has no findings, it should report "No issues found" so the user knows it ran.

</procedure>
