# Create Issue

**Use this when:** Capturing a short bug, feature, or improvement on GitHub or GitLab - the WHAT, not the HOW.
**Don't use this when:** You need to plan implementation details (use `/explore` and `/create-plan`).

Hey! I'm ready to help you capture this issue. What's on your mind? Just give me:

- **What's the issue/feature** (1-2 sentences)
- **Current vs desired behavior** (if it's a bug)

I'll handle the rest.

---

## Rules

<rules>
1. **Ask 2-3 questions before creating the issue** - the answers set the labels and fill the body.
2. **Keep issues short** - about 10-15 lines in the body format below, so `/explore` starts from the problem rather than a solution.
3. **Capture the what, not the how** - no code, file paths, or technical approach; `/explore` and `/create-plan` decide those later with the codebase in front of them.
</rules>

## Questions to Ask

- Bug, feature, or improvement?
- Priority? (high/medium/low)
- Any context I should know?

## After Getting Answers

Detect the host first, then create the issue with the matching CLI. These two steps run together: never run the create command without doing the detection above it.

!`cat .claude/skills/shared/host-cli.md`

Then run the **"Create issue" row** for the detected host, from the project directory, following the quoting rule under the invocation table: the title and labels in single quotes (each `'` written as `'\''`), the body in a `mktemp -d` file on both hosts (inline on GitLab only through the table's `Unknown flag` fallback), and never double quotes or `$(...)`. Take the command from that row rather than from memory: the flag carrying the issue text is named differently on each host, double-quoted text has its backticks run as commands, and a command substitution stops for an approval prompt.

## Issue Body Format (Keep It Short)
```
## TL;DR
[1-2 sentences max]

## Current State
[What happens now - 1-2 sentences]

## Desired State
[What should happen - 1-2 sentences]
```

## Available Labels

- `bug`, `feature`, `improvement`
- `priority-high`, `priority-medium`, `priority-low`
- `setup`

## REMEMBER
- Ask questions first
- Keep it short
- Run the "Create issue" row for the detected host (`gh issue create` or `glab issue create`) to actually create the issue: single-quoted title, body file on both hosts, never `$(...)`
- No implementation details - that's for /explore
