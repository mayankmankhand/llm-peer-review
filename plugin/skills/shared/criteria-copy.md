## Audience Rule

Default to a newcomer lens - assume the reader is encountering this content for the first time with no prior context about this specific project or product. If the content clearly targets a specific audience (e.g., a developer quick-start, a technical reference), evaluate whether *that intended reader* can orient quickly - not whether the content is universally accessible.

## Boundary with /tk:review-ux

<reference>

This skill and `/tk:review-ux` can both apply to the same artifact. Here is how to tell them apart:

**This skill (/tk:review-copy) covers:**
- Unclear headline or title that doesn't tell the reader what this is
- Missing context before a call-to-action
- Jargon-heavy section intro that a newcomer can't parse
- Weak or missing next-step explanation
- Information presented out of logical order

**Use /tk:review-ux instead for:**
- Poor contrast or color accessibility
- Inaccessible form errors or missing labels
- Confusing interaction behavior (hover states, modals, navigation)
- Layout problems or weak visual affordances

**Tie-break rule:** If the issue is primarily about *meaning and orientation*, it belongs here. If it is primarily about *interaction and accessibility*, it belongs in `/tk:review-ux`.

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

**Bigger change** (3+ files or new reader-facing content): when running this skill **directly** (a subagent dispatched by /tk:review is always single-pass - subagents cannot spawn sub-agents), run three focused sub-agents in parallel using the Agent tool (`subagent_type=tk:review-copy-finder`, this kind's finder per the roster in `${CLAUDE_PLUGIN_ROOT}/skills/shared/model-routing.md`, which preloads these criteria and the dispatch contract in `${CLAUDE_PLUGIN_ROOT}/skills/dispatch-contract/SKILL.md`; fallback per that rule: `general-purpose` carrying what its roster row declares, with this file's criteria and that contract pasted into the prompt), then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Orientation** | Does the reader immediately know what this is and why they should care? Is there context before the first interaction or CTA? Does the title/headline do its job? |
| **Flow** | Do the headings tell a logical story? Is information sequenced well (what is this -> why it matters -> what to do)? Are next steps clear? |
| **Clarity** | Is the language plain and jargon-free for the intended audience? Are sentences and paragraphs easy to scan? Is cognitive load reasonable? |

Each sub-agent should use the severity scale and Finding ID format below. If a sub-agent has no findings, it should report "No issues found" so the user knows it ran.

</procedure>
