## How to Review

<procedure>

Read the command files being reviewed. Then pick one of two modes:

**Small change** (1-2 files, minor wording tweaks): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or new/rewritten commands): when running this skill **directly** (a subagent dispatched by /review is always single-pass - subagents cannot spawn sub-agents), run four focused sub-agents in parallel using the Agent tool (`subagent_type=review-commands-finder` with `model` set to its `models.perRole` value, where `session`, or a model above your own, means your own model family's alias; this kind's finder per the roster in `.claude/skills/shared/model-routing.md`, which preloads these criteria and the dispatch contract in `.claude/skills/dispatch-contract/SKILL.md`; fallback per that rule: `general-purpose` carrying the same `model`, with this file's criteria, the severity anchors, the finding contract and that contract pasted into the prompt), then combine their results (a `NOT CHECKED:` line a sub-agent returned is kept for the report's "What I could not check"):

| Sub-agent | What it checks |
|-----------|----------------|
| **Prompt Engineering** | Clarity of instructions, ambiguities, conflicting directives, missing examples, and the six prompt-debt patterns below |
| **Cross-command Consistency** | Terminology alignment, structure, formatting, prerequisite references across commands |
| **Workflow Completeness** | Missing steps, dead ends, assumption gaps, output usability, failure modes |
| **Workflow Ergonomics** | Cognitive load, progress visibility, mistake recovery, workflow clarity for users without specialized knowledge |

Each sub-agent returns JSONL per the dispatch contract, or the literal `NO FINDINGS`, so you can see it ran. Write every finding line this run collected, the workers' lines and any the runner authored itself, into `findings.jsonl` in a fresh folder from `mktemp -d /tmp/review-merge.XXXXXX` with the Write tool, then run `node .claude/scripts/merge-findings.js` on that file, typed as literal words: its stdout is the deduplicated, sorted, numbered set (R1 onward, no gaps) and its stderr line carries the raw and merged counts. Two findings that describe one defect under different keys are the one judgment this pass leaves to you: before running the helper, give the later one the earlier one's `key` and record the merge in the report's dedup notes.

</procedure>

## Prompt Debt: The Six Patterns

Newer models follow a prompt more literally than the models most prompt files were first written for, so text that once made up for a weaker reader now costs tokens or steers the wrong way. Check every file under review for these six patterns; the last column says when a line is not a finding. For the first three, a stated reason is what counts: a check or a fixed order that says why it matters stays, and an emphasis line keeps its reason when it loses the shouting. A stale example, a contradiction, or a dated note is wrong in what it says, so no reason saves it.

| Pattern | A finding | Not a finding |
|---|---|---|
| Verification rituals | A check that shows diligence and decides nothing: "double-check your work", "re-read the file before answering", a confirm step whose answer changes no next step | A check whose result decides the next step: a test run, a receipt a later stage reads |
| Emphasis boosters | CRITICAL, MUST, IMPORTANT, all capitals, "Do not skip this", "Be thorough" | The same constraint stated plainly, with its reason |
| Mandatory procedures | A fixed step-by-step template for work the model can judge, with no reason the order matters | A sequence whose order matters, with the reason stated: commit before push, gate before send |
| Stale examples | An example that names a retired command, file, or flag, or that the rule beside it no longer matches | An example that still matches its rule |
| Contradictory rules | Two instructions, in one file or across the files it loads, that cannot both be followed | A general rule beside a named exception to it |
| Dated config | Issue and version numbers, dates, "used to" and "now" phrasing, the history of a past state | A version or date the reader acts on: a minimum version check, a release tag |

Severity follows Command Review in the severity anchors: a contradiction a run will hit, or a stale example that points at something gone, misleads the AI; the other four patterns are wording polish.
