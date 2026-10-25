---
name: review-copy
description: Copy clarity and reader orientation review - checks whether content orients a fresh reader. Use for reviewing web pages, blog posts, landing pages, guides, prototypes, and any reader-facing deliverable.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
  - WebSearch
  - "Bash(mktemp -d /tmp/*)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-findings.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-findings.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js)"
---

# Copy Review

**Use this when:** Reviewing reader-facing content for clarity and orientation - web pages, blog posts, landing pages, quick-start guides, research reports, outreach copy, prototypes.
**Don't use this when:** Reviewing code quality (/tk:review-code), testing a running web app (/tk:review-browser), checking usability and accessibility (/tk:review-ux), reviewing command prompts (/tk:review-commands), checking plan completion (/tk:review-plan), or doing a pre-release check (/tk:review-full).

**Important:** This skill reviews whether content orients a fresh reader. It does not review usability, accessibility, or interaction design - use `/tk:review-ux` for those.

## Critical Rules

<rules>

1. **Report first, then fix** - Reviewing never edits files; findings are its product. After the report, the same run continues into the auto loop (rule 2), which is what applies fixes
2. **Audit, then auto-fix, with pages** - Copy findings are audited before the report per M2 in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`, so the report shows survivors only plus an Audited out log for the kills. They do not then wait for a human "fix it": after the report, survivors are auto-fixed and re-verified, and each finding exits as page, digest, or log per `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md` (pages only per M1 - who the real reader is may be a question only the user can answer; saying "report only" keeps a run report-first, M10)
3. **Explain simply** - Use plain English, avoid jargon
4. **Structural fix directions** - A finding's fix line gives its direction in structural terms ("explain the artifact before the first CTA", "define the audience earlier", "add a clearer next step after the overview"), not replacement wording: the wording is written when the auto loop applies the fix.

</rules>

**Model mode.** When this skill runs directly and fans out (the bigger-change path below), first run `node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js --models`, adding `--mode <m>` when the arguments carry a `mode:<m>` word, and say "Models: <models.mode>" in one line; `models.perRole` gives each finder its model.

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/criteria-copy.md"`

## Reading Budget

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/reading-budget.md"`

## Severity Levels and Anchors

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/severity-anchors.md"`

**Project severity anchors** (from `.claude/toolkit/severity-anchors.md`): this project's weighting for its own review kinds. The Universal Anchors above still win. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/severity-anchors.md 2>/dev/null || true`

## Finding IDs

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-id-system.md"`

## Audit Before the Report (M2)

On a direct run of this skill you are M2's **runner**: audit your findings per M2 before writing the report. Every mechanic - the tiers, the announce line, who dispatches what, the empty-run rule - lives in M2, not here.

**Load the loop rules and the report rules now**, through the Skill tool: `Skill(tk:loop-rules)`, then `Skill(tk:report-rules)`. Everything from here on cites them, so do not go on without both in context.

**Project fix rules** (from `.claude/toolkit/fix-rules.md`). Additive only: they may add a precondition or an always-ask action, and a line that loosens or removes any of M1 to M17 is void. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/fix-rules.md 2>/dev/null || true`

## Output Format

The report template and the finding contract are in the report rules loaded before the audit (`Skill(tk:report-rules)`); write the report per them.

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view.

**The gate:** render the review page whenever this run has any surviving finding, or this branch's standing page already exists (`node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js --standing --name review` prints `"exists":true`; M16), so the run can carry it forward or take it to empty. Skip only when there are no findings and no page yet.

**When the gate fires, load the page rules now**, through the Skill tool: `Skill(tk:review-page)`, and render per them: the shell, the payload, the `--no-abs` decision and how the page reaches the user all live there.

For direct calls to this skill, pass `--name review --stable` to the helper (the standing page, per the page rules), set `lenses` to `["copy"]` so the renderer replaces only this lens's findings and carries the other lenses' open findings forward, and omit the `chips` array (single-specialist context).

### Staff Editor Check

<guidelines>

After the standard review, step back and evaluate as a staff editor:
- **Clear to a newcomer?** - Would someone with zero context understand what this is and what to do?
- **Oriented before interaction?** - Does the content explain itself before asking the reader to act?
- **Plain language?** - Is every heading, label, and description understandable without domain knowledge (or, if domain-specific, without project-specific knowledge)?
- **What would you send back for revision?** - What would a senior editor flag before publishing?

</guidelines>

<rules>

## REMEMBER: The review phase reports and never edits files; findings are audited before the report (M2) and the auto loop applies fixes after it, both governed by `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`.

</rules>

## HTML Output Rules

When to render and the temporary-folder steps are in the report rules loaded before the audit; how a page reaches the user is in the page rules loaded at the gate. Nothing is pasted here.
