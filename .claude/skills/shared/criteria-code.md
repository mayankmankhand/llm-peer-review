## How to Review

<procedure>

Read the changed files. Then pick one of two modes:

**Small change** (1-2 files): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or significant logic): when running this skill **directly** (a subagent dispatched by /review is always single-pass - subagents cannot spawn sub-agents), run four focused sub-agents in parallel using the Agent tool (`subagent_type=review-code-finder` with `model` set to its `models.perRole` value, where `session`, or a model above your own, means your own model family's alias; this kind's finder per the roster in `.claude/skills/shared/model-routing.md`, which preloads these criteria and the dispatch contract in `.claude/skills/dispatch-contract/SKILL.md`; fallback per that rule: `general-purpose` carrying the same `model`, with this file's criteria, the severity anchors, the finding contract and that contract pasted into the prompt), then combine their results (a `NOT CHECKED:` line a sub-agent returned is kept for the report's "What I could not check"):

| Sub-agent | What it checks |
|-----------|----------------|
| **Security** | Auth checks, input validation, secrets exposure, injection risks |
| **Code Quality** | Naming, duplication, complexity, pattern consistency |
| **Logic** | Edge cases, off-by-ones, missing error handling, wrong assumptions |
| **Performance & Maintainability** | O(n) issues, memory usage, tech debt, maintainability concerns |

Each sub-agent returns JSONL per the dispatch contract, or the literal `NO FINDINGS`, so you can see it ran. Write every finding line this run collected, the workers' lines and any the runner authored itself, into `findings.jsonl` in a fresh folder from `mktemp -d /tmp/review-merge.XXXXXX` with the Write tool, then run `node .claude/scripts/merge-findings.js` on that file, typed as literal words: its stdout is the deduplicated, sorted, numbered set (R1 onward, no gaps) and its stderr line carries the raw and merged counts. Two findings that describe one defect under different keys are the one judgment this pass leaves to you: before running the helper, give the later one the earlier one's `key` and record the merge in the report's dedup notes.

**Rebuilt render paths** (the Logic pass owns it in a fan-out). When the diff adds or changes code that empties and rebuilds part of the page (an `innerHTML` reassignment, a children replace, a list re-rendered from scratch, a render scheduled on every animation frame, timer, or state change), work it as a count, not an impression:

1. Find each rebuild and the subtree it empties: `git diff <base>..<end> | awk '/^\+.*(\.innerHTML[ \t]*=|replaceChildren\(|requestAnimationFrame\(|setInterval\()/{n++; print} END{print "rebuild sites: " n+0}'` prints the candidate lines and a `rebuild sites: N` total (M16), or the Grep tool with the same pattern over the changed files when you have no Bash; which hits empty a subtree, and what state it holds, stays your judgment.
2. List every piece of state held on an element inside that subtree: a typed draft in a field, focus or a text selection, the armed first step of a two-step control, an open or collapsed panel, a scroll position.
3. Each one is a finding unless the code keeps that state outside the DOM and restores it after the rebuild, or skips the rebuild while that state exists.

A rebuild that runs on a timer or every frame when nothing it displays has changed is a finding too, for the work it throws away. None of this shows in a screenshot, so a design critic cannot catch it; this pass is where it gets caught.

</procedure>
