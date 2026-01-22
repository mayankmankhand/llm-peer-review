# Project Instructions for Claude

## About This Project

**LLM Peer Review** - A tool to get multiple LLMs to critique each other's responses.

**Tech Stack**: Next.js 14, TypeScript, Tailwind CSS, Vercel

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

### When Running /review

- **Output a written report** using the format in `.claude/commands/review.md`
- **Do NOT modify any files**
- **Wait for me to say "fix it"** before making changes

### When Running /create-issue

- **Ask 2-3 clarifying questions first**
- **Keep issues short** (10-15 lines max)
- **No implementation details** - that's for /explore and /create-plan

---

## Project Structure
```
llm-peer-review/
├── .claude/commands/    # Slash command prompts
├── app/                 # Next.js app (pages, API routes)
├── lib/                 # Shared utilities
├── CLAUDE.md           # This file (project instructions)
└── README.md           # Project overview
```

---

## Remember

- I'm learning - explain what you do
- Report first, fix later
- Ask if unsure