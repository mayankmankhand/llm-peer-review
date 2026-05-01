---
name: review-commands
description: Slash command prompt review - prompt quality, workflow completeness, cross-command consistency. Use for reviewing .claude/commands/*.md or .claude/skills/*/SKILL.md files.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Agent
---

# Slash Command Review

Be thorough but concise.

**Use this when:** Reviewing slash command prompts (.claude/commands/*.md) - prompt quality, workflow completeness, cross-command consistency.
**Don't use this when:** Reviewing application code (/review-code), testing a running web app (/review-browser), checking plan completion (/review-plan), evaluating end-user UX (/review-ux), or doing a pre-release check (/review-full).

## Critical Rules

<rules>

1. **REPORT ONLY** - Do NOT make any changes or edits to files
2. **Wait for approval** - Only fix things after I say "fix it"
3. **Explain simply** - Use plain English, avoid jargon

</rules>

## How to Review

<procedure>

Read the command files being reviewed. Then pick one of two modes:

**Small change** (1-2 files, minor wording tweaks): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or new/rewritten commands): Run four focused sub-agents in parallel using the Agent tool, then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Prompt Engineering** | Clarity of instructions, ambiguities, conflicting directives, missing examples |
| **Cross-command Consistency** | Terminology alignment, structure, formatting, prerequisite references across commands |
| **Workflow Completeness** | Missing steps, dead ends, assumption gaps, output usability, failure modes |
| **Workflow Ergonomics** | Cognitive load, progress visibility, mistake recovery, workflow clarity for users without specialized knowledge |

Each sub-agent should use the severity scale and Finding ID format below. If a sub-agent has no findings, it should report "No issues found" so the user knows it ran.

</procedure>

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Output Format

!`cat .claude/skills/shared/output-template.md`

### Staff PM Check

<guidelines>

After the standard review, step back and evaluate as a staff PM focused on operational clarity:
- **Can any user follow this?** - Is the workflow clear without specialized knowledge?
- **Workflow reliability** - Are there points where the user could get stuck or confused?
- **Handoff quality** - Does each command's output feed cleanly into the next step?
- **What would you push back on?** - What would an experienced PM flag before shipping these commands?

</guidelines>

<rules>

## REMEMBER: Report issues only. Do NOT edit any files until I approve.

</rules>
