## Audience Rule

Default to a newcomer lens - assume the reader is encountering this content for the first time with no prior context about this specific project or product. If the content clearly targets a specific audience (e.g., a developer quick-start, a technical reference), evaluate whether *that intended reader* can orient quickly - not whether the content is universally accessible.

## Boundary with /review-ux

<reference>

This skill and `/review-ux` can both apply to the same artifact. Here is how to tell them apart:

**This skill (/review-copy) covers:**
- Unclear headline or title that doesn't tell the reader what this is
- Missing context before a call-to-action
- Jargon-heavy section intro that a newcomer can't parse
- Weak or missing next-step explanation
- Information presented out of logical order

**Use /review-ux instead for:**
- Poor contrast or color accessibility
- Inaccessible form errors or missing labels
- Confusing interaction behavior (hover states, modals, navigation)
- Layout problems or weak visual affordances

**Tie-break rule:** If the issue is primarily about *meaning and orientation*, it belongs here. If it is primarily about *interaction and accessibility*, it belongs in `/review-ux`.

</reference>

## Non-Goals

<reference>

This skill does NOT cover:
- **Tone optimization** - whether the voice is warm, formal, playful, etc.
- **Persuasion strategy** - whether the copy sells effectively
- **SEO** - keyword density, meta descriptions, search ranking
- **Factual review** - whether claims are accurate or evidence is sound
- **Grammar and spelling** - sentence-level proofreading

</reference>

## How to Review

<procedure>

Read the content files (pages, markdown, HTML, templates, copy). Then pick one of two modes:

**Small change** (1-2 files, minor copy update): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or new reader-facing content): when running this skill **directly** (a subagent dispatched by /review is always single-pass - subagents cannot spawn sub-agents), run three focused sub-agents in parallel using the Agent tool (`subagent_type=review-copy-finder` with `model` set to its `models.perRole` value, where `session`, or a model above your own, means your own model family's alias; this kind's finder per the roster in `.claude/skills/shared/model-routing.md`, which preloads these criteria and the dispatch contract in `.claude/skills/dispatch-contract/SKILL.md`; fallback per that rule: `general-purpose` carrying the same `model`, with this file's criteria, the severity anchors, the finding contract and that contract pasted into the prompt), then combine their results (a `NOT CHECKED:` line a sub-agent returned is kept for the report's "What I could not check"):

| Sub-agent | What it checks |
|-----------|----------------|
| **Orientation** | Does the reader immediately know what this is and why they should care? Is there context before the first interaction or CTA? Does the title/headline do its job? |
| **Flow** | Do the headings tell a logical story? Is information sequenced well (what is this -> why it matters -> what to do)? Are next steps clear? |
| **Clarity** | Is the language plain and jargon-free for the intended audience? Are sentences and paragraphs easy to scan? Is cognitive load reasonable? |

Each sub-agent returns JSONL per the dispatch contract, or the literal `NO FINDINGS`, so you can see it ran. Write every finding line this run collected, the workers' lines and any the runner authored itself, into `findings.jsonl` in a fresh folder from `mktemp -d /tmp/review-merge.XXXXXX` with the Write tool, then run `node .claude/scripts/merge-findings.js` on that file, typed as literal words: its stdout is the deduplicated, sorted, numbered set (R1 onward, no gaps) and its stderr line carries the raw and merged counts. Two findings that describe one defect under different keys are the one judgment this pass leaves to you: before running the helper, give the later one the earlier one's `key` and record the merge in the report's dedup notes.

</procedure>
