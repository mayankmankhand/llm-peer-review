# Project Instructions for Claude

## About This Project

**LLM Peer Review** - A portable set of commands for "PM learning to code" workflows.

**Who I Am**: I'm a PM learning to code using AI tools. Explain things simply.

---

## How We Work Together

### CRITICAL RULES

1. **Never auto-fix** - Report issues first, wait for my approval before editing files
2. **Ask questions** - If something is unclear, ask before assuming
3. **Explain simply** - Use plain English, avoid jargon
4. **Show your work** - Tell me what you're doing and why

### Our Workflow

We follow this flow for features:
1. `/explore` - Understand the problem, ask clarifying questions
2. `/create-plan` - Create a step-by-step plan with status tracking
3. `/execute` - Build it, updating the plan as we go
4. `/review` - Review code (report only, don't fix)
5. `/peer-review` - Evaluate feedback from other AI models
6. `/document` - Update documentation

---

## Slash Commands

| Command | Purpose |
|---------|---------|
| `/explore` | Understand the problem, ask clarifying questions before implementation |
| `/create-plan` | Create a step-by-step implementation plan with status tracking |
| `/execute` | Build the feature, updating the plan as you go |
| `/review` | Review code - report issues only, don't fix |
| `/peer-review` | Evaluate feedback from other AI models |
| `/document` | Update documentation after changes |
| `/create-issue` | Create GitHub issues (ask questions first, keep short) |
| `/ask-gpt` | AI peer review with ChatGPT debate (3 rounds) |
| `/ask-gemini` | AI peer review with Gemini debate (3 rounds) |
| `/package-review` | Review a package/codebase |
| `/learning-opportunity` | Pause to learn a concept at 3 levels of depth |

### Command-Specific Rules

**When Running /review:**
- Output a written report using the format in `.claude/commands/review.md`
- Do NOT modify any files
- Wait for me to say "fix it" before making changes

**When Running /create-issue:**
- Ask 2-3 clarifying questions first
- Keep issues short (10-15 lines max)
- No implementation details - that's for /explore and /create-plan

---

## Git Workflow

### When to Branch
- New features that might break things
- Experimental changes you're not sure about
- When collaborating with others

### When to Work on Main
- Documentation updates
- Small fixes
- Cleanup work

### When to Commit
- After completing a logical unit of work
- Before switching to a different task
- When you want a checkpoint you can return to

### When to Push
- After commits you want to keep (backup)
- When you're done for the day
- Before asking for feedback

### Commit Messages
- Start with a verb: "Add", "Fix", "Update", "Remove", "Refactor"
- Keep the first line under 50 characters
- Describe what changed, not how

**Examples:**
- `Add git workflow guidance to CLAUDE.md`
- `Remove Next.js web app (out of scope for v1)`
- `Fix broken reference in ask-gpt command`

**Simple rule:** For solo learning projects, working on main is fine. Branch when you want to experiment safely.

---

## Permissions

These are defined in `.claude/settings.local.json`. Each one exists for a reason:

| Permission | Why it's here |
|---|---|
| `git commit` | `/execute` and `/document` need to commit after work |
| `gh repo create` | `/create-issue` scaffolding |
| `gh issue create` | `/create-issue` command |
| `gh api` | GitHub API calls from commands |
| `npm install` | Setting up dependencies in new projects |
| `node` | Running the ask-gpt and ask-gemini scripts |
| `npm uninstall` | Removing packages when needed |
| `ls` | Reading directory contents |
| `diff` | Comparing files during review |
| `git config` | Git setup (e.g. safe.directory) |
| `cd` | **Not included by default.** If your workflow needs it, add `"Bash(cd:*)"` to your project's `.claude/settings.local.json`. Be aware: this allows directory changes anywhere on your machine, which broadens what subsequent commands can access. |

---

## Remember

- I'm learning - explain what you do
- Report first, fix later
- Ask if unsure
