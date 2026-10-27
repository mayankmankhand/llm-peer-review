---
name: writing
description: Clear-writing rules for anything a person will read, with a section for each kind: questions, plans and summaries for the owner, a PRD, a technical spec, a README or docs, an issue, pull request or release note, an email or chat message, web page copy or a social post. Open it before drafting one. This project's own writing rules win over it.
allowed-tools:
  - Read
---

# Writing Guide

**Use this when:** you are about to draft something a person will read: a question or summary for the owner, a plan, a PRD or a spec, a README or docs, an issue, a pull request or release notes, an email or a chat message, or web copy.
**Don't use this when:** the text is for Claude to read later (a prompt, a rules file, the codebase map), or the task is code with no prose in it.

In this guide, "the owner" is the person you are working with in this session, and "the reader" is whoever will read the text: the owner, or someone else.

## Who wins

- Where they cover the same point, this project's own writing rules win, wherever they live: `CLAUDE.md`, a rules file, a guide or skill of the project's own, or the plan being followed. This guide only fills the gaps they leave.
- When the project names its own guide or skill for a kind of writing, use that first, and this guide only where it is silent.
- Quoted, dictated or locked text is never changed, not even for a dash: quotes from a source, the owner's own words, and anything the project marks as fixed.
- Existing text changes only when the task is to edit it. A request for a summary is not permission to rewrite the source.

## Pick the kind, then read only its file

Name the kind of writing first. Then read its file, and only that one:

- Chat replies and questions to the owner: read `${CLAUDE_PLUGIN_ROOT}/skills/writing/owner-chat.md`
- Pages and files written for the owner (a plan, an exploration summary, a review summary, a cycle page): read `${CLAUDE_PLUGIN_ROOT}/skills/writing/owner-pages.md`
- A product requirements doc (PRD): read `${CLAUDE_PLUGIN_ROOT}/skills/writing/prd.md`
- A technical spec: read `${CLAUDE_PLUGIN_ROOT}/skills/writing/spec.md`
- A README or other docs: read `${CLAUDE_PLUGIN_ROOT}/skills/writing/readme-docs.md`
- An issue, a pull request or release notes: read `${CLAUDE_PLUGIN_ROOT}/skills/writing/issues-prs-releases.md`
- An email or a chat message (Slack, LinkedIn): read `${CLAUDE_PLUGIN_ROOT}/skills/writing/messages.md`
- Web page copy, or a social post: read `${CLAUDE_PLUGIN_ROOT}/skills/writing/web-copy.md`

When a piece mixes kinds, read the file for its main reader. Resumes, spoken scripts and chatbot personas have no file here: follow the project's own rules for them, and the core rules below.

## The core rules

1. **Know the reader and the one takeaway first.** Before drafting, settle who will read this, what they already know, and the one thing they should know or do when they finish. If you cannot say that in one sentence, ask before you write.
2. **Point first.** Lead with the answer, the request, the decision or the update. Background comes after it, and only as much as the reader needs to act.
3. **Use the reader's words.** Replace a term the reader may not know with everyday words, or explain it the first time it appears when the exact term matters (in a spec, for an engineer). For the owner, the toolkit's own parts have fixed everyday names (Rule 8 of the always-on rules file), and the exact term goes in the proof at the end.
4. **Be specific.** Name the thing, the number, the date, the person. A word that claims importance (critical, key, significant) needs its reason beside it, or it goes.
5. **Invent nothing.** Never add a fact, number, quote, cause, customer or experience the source does not have. Mark the gap and ask, for example "[need: the date the export shipped]". A plain true sentence beats a vivid false one.
6. **Hedge only what you cannot back.** Keep honest uncertainty ("may", "in 2 of 3 runs"). Cut a hedge that hides a claim you can support, and never make a claim stronger than its evidence.
7. **Cut what does no work, then stop.** Each sentence adds a fact, a reason, a step or a decision. No warm-up, no recap of what you just said, no send-off. End on the last useful thought.
8. **Keep the shape the destination needs.** Steps stay numbered, warnings stay visible, an email keeps its ask, a table stays a table. Do not turn a document into an essay to vary it, or a short message into a long one.

## Dashes

No em dashes or en dashes, and no spaced hyphen standing in for one: rewrite the sentence with a comma, a colon, a full stop, or two sentences. Hyphens stay inside words (check-first) and in fixed line formats that ask for them. Quoted, dictated or locked text is never changed, even for a dash.

## One review pass, then stop

Read the draft once as its reader would: a stranger for a README or a web page, a busy person for a message, the owner for a summary. Fix the weakest real problem you find, then stop. Polishing again and again makes text vaguer, not clearer.

## Credit

The core rules are adapted, in this toolkit's own words, from the clarity writing guide by Addy Osmani (github.com/addyosmani/clarity, MIT license).
