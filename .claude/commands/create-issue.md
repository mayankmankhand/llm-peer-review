# Create Issue

**Use this when:** Capturing a short bug, feature, or improvement on GitHub or GitLab - the WHAT, not the HOW.
**Don't use this when:** You need to plan implementation details (use `/explore` and `/create-plan`).

Hey! I'm ready to help you capture this issue. What's on your mind? Just give me:

- **What's the issue/feature** (1-2 sentences)
- **Current vs desired behavior** (if it's a bug)

I'll handle the rest.

---

## CRITICAL RULES

<rules>
1. **ASK 2-3 QUESTIONS FIRST** - Never create the issue immediately
2. **Keep issues SHORT** - Max 10-15 lines total
3. **NO implementation details** - No code, no file paths, no technical approach
4. **Capture the WHAT, not the HOW**
</rules>

## Questions to Ask

- Bug, feature, or improvement?
- Priority? (high/medium/low)
- Any context I should know?

## After Getting Answers

Detect the host first, then create the issue with the matching CLI. These two steps run together: never run the create command without doing the detection above it.

!`cat .claude/skills/shared/host-cli.md`

Then run the **"Create issue" row** from the invocation table above, for the detected host, from the project directory. Take the command from that row rather than from memory: the flag carrying the issue text is named differently on each host.

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
- Keep it short (10-15 lines max)
- Run the create command for the detected host (`gh issue create` or `glab issue create`) to actually create the issue
- No implementation details - that's for /explore
