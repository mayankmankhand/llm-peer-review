---
name: review-copy
description: Copy clarity and reader orientation review - checks whether content orients a fresh reader. Use for reviewing web pages, blog posts, landing pages, guides, prototypes, and any reader-facing deliverable.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Agent
  - WebSearch
---

# Copy Review

Be thorough but concise.

**Use this when:** Reviewing reader-facing content for clarity and orientation - web pages, blog posts, landing pages, quick-start guides, research reports, outreach copy, prototypes.
**Don't use this when:** Reviewing code quality (/review-code), testing a running web app (/review-browser), checking usability and accessibility (/review-ux), reviewing command prompts (/review-commands), checking plan completion (/review-plan), or doing a pre-release check (/review-full).

**Important:** This skill reviews whether content orients a fresh reader. It does not review usability, accessibility, or interaction design - use `/review-ux` for those.

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

## Critical Rules

<rules>

1. **REPORT ONLY** - Do NOT make any changes or edits to files
2. **Wait for approval** - Only fix things after I say "fix it"
3. **Explain simply** - Use plain English, avoid jargon
4. **Structural fix directions** - Give fix directions in structural terms ("explain the artifact before the first CTA", "define the audience earlier", "add a clearer next step after the overview"). Do not rewrite copy or suggest specific wording.

</rules>

## How to Review

<procedure>

Read the content files (pages, markdown, HTML, templates, copy). Then pick one of two modes:

**Small change** (1-2 files, minor copy update): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or new reader-facing content): Run three focused sub-agents in parallel using the Agent tool, then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Orientation** | Does the reader immediately know what this is and why they should care? Is there context before the first interaction or CTA? Does the title/headline do its job? |
| **Flow** | Do the headings tell a logical story? Is information sequenced well (what is this -> why it matters -> what to do)? Are next steps clear? |
| **Clarity** | Is the language plain and jargon-free for the intended audience? Are sentences and paragraphs easy to scan? Is cognitive load reasonable? |

Each sub-agent should use the severity scale and Finding ID format below. If a sub-agent has no findings, it should report "No issues found" so the user knows it ran.

</procedure>

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Output Format

!`cat .claude/skills/shared/output-template.md`

### Staff Editor Check

<guidelines>

After the standard review, step back and evaluate as a staff editor:
- **Clear to a newcomer?** - Would someone with zero context understand what this is and what to do?
- **Oriented before interaction?** - Does the content explain itself before asking the reader to act?
- **Plain language?** - Is every heading, label, and description understandable without domain knowledge (or, if domain-specific, without project-specific knowledge)?
- **What would you send back for revision?** - What would a senior editor flag before publishing?

</guidelines>

<rules>

## REMEMBER: Report issues only. Do NOT edit any files until I approve.

</rules>
