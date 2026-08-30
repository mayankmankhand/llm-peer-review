---
name: review-commands
description: Slash command prompt review - prompt quality, workflow completeness, cross-command consistency. Use for reviewing .claude/commands/*.md or .claude/skills/*/SKILL.md files.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
---

# Slash Command Review

Be thorough but concise.

**Use this when:** Reviewing slash command prompts (.claude/commands/*.md) - prompt quality, workflow completeness, cross-command consistency.
**Don't use this when:** Reviewing application code (/review-code), testing a running web app (/review-browser), checking plan completion (/review-plan), evaluating end-user UX (/review-ux), or doing a pre-release check (/review-full).

## Critical Rules

<rules>

1. **THE REVIEW PHASE REPORTS ONLY** - Reviewing never edits files; findings are its product. After the report, the same run continues into the auto loop (rule 2), which is what applies fixes
2. **Audit, then auto-fix, with pages** - Command-prompt findings are audited before the report per M2 in `.claude/skills/shared/hitl-loop.md`, so the report shows survivors only plus an Audited out log for the kills. They then enter the auto loop like any other (survivors auto-fixed, re-verified, then page/digest/log), with one built-in brake: fixing them means editing prompt files, which is an always-ask action (M9), so those fixes page for approval instead of auto-applying. Saying "report only" keeps a run report-first (M10)
3. **Explain simply** - Use plain English, avoid jargon

</rules>

## How to Review

<procedure>

Read the command files being reviewed. Then pick one of two modes:

**Small change** (1-2 files, minor wording tweaks): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or new/rewritten commands): when running this skill **directly** (a subagent dispatched by /review is always single-pass - subagents cannot spawn sub-agents), run four focused sub-agents in parallel using the Agent tool (`subagent_type=review-finder`, the finder agent per the roster in `.claude/skills/shared/model-routing.md`; fallback per that rule: `general-purpose` carrying what its roster row declares), then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Prompt Engineering** | Clarity of instructions, ambiguities, conflicting directives, missing examples |
| **Cross-command Consistency** | Terminology alignment, structure, formatting, prerequisite references across commands |
| **Workflow Completeness** | Missing steps, dead ends, assumption gaps, output usability, failure modes |
| **Workflow Ergonomics** | Cognitive load, progress visibility, mistake recovery, workflow clarity for users without specialized knowledge |

Each sub-agent should use the severity scale and Finding ID format below. If a sub-agent has no findings, it should report "No issues found" so the user knows it ran.

</procedure>

## Reading Budget

!`cat .claude/skills/shared/reading-budget.md`

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Audit Before the Report (M2)

On a direct run of this skill you are M2's **runner**: audit your findings per M2 below before writing the report. Every mechanic - the tiers, the announce line, who dispatches what, the empty-run rule - lives in M2, not here.

!`cat .claude/skills/shared/hitl-loop.md`

## Output Format

!`cat .claude/skills/shared/output-template.md`

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template:

!`cat .claude/skills/shared/html-render-review.md`

For direct calls to this skill, pass `--name review-commands` to the helper and omit the `chips` array (single-specialist context).

### Staff PM Check

<guidelines>

After the standard review, step back and evaluate as a staff PM focused on operational clarity:
- **Can any user follow this?** - Is the workflow clear without specialized knowledge?
- **Workflow reliability** - Are there points where the user could get stuck or confused?
- **Handoff quality** - Does each command's output feed cleanly into the next step?
- **What would you push back on?** - What would an experienced PM flag before shipping these commands?

</guidelines>

<rules>

## REMEMBER: The review phase reports and never edits files; findings are audited before the report (M2) and the auto loop applies fixes after it, both governed by `.claude/skills/shared/hitl-loop.md` (prompt-file fixes always ask, M9).

</rules>
