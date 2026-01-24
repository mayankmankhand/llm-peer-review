# Project Scope Cleanup Plan

**Overall Progress:** `90%`

## TLDR

Redefine project scope to be a portable Cursor slash command toolkit for "PM learning to code." Delete the Next.js web app and reference projects. Update `CLAUDE.md` to be portable across projects. Add simple Git workflow guidance.

## Critical Decisions

- **V1 Product = Slash commands only** - The Next.js web app was a prototype; the real product is the 10 Cursor commands
- **CLAUDE.md is portable** - Should work across any project, contains workflow + command reference
- **Delete, don't archive** - Completed plans and reference projects go away (git tag preserves reference point)
- **Keep scripts/dev-lead.js** - Required for `/dev-lead-1` command to call OpenAI API
- **Simple Git workflow** - Add guidance for when to branch/commit/push, aimed at someone learning

## What Gets Deleted

| Path | Reason |
|------|--------|
| `app/` | Web app - out of scope |
| `lib/` | Web app - out of scope |
| `manager_package/` | Reference project - not needed |
| `toon_flow/` | Reference project - not needed |
| `PLAN.md` | Completed web app plan |
| `PLAN_V2.md` | Completed web app v2 plan |
| `PLAN_DEV_LEAD.md` | Completed dev-lead plan |
| `PEER_ANALYSIS.md` | Historical analysis |
| `PEER_REVIEW_ANALYSIS.md` | Historical analysis |
| `PEER_REVIEW_ANALYSIS_2.md` | Historical analysis |
| `ISSUE-score-critiques.md` | Web app feature idea |
| `review-package-*.md` (3 files) | Package review artifacts |
| `next.config.mjs` | Web app config |
| `postcss.config.mjs` | Web app config |
| `tailwind.config.ts` | Web app config |
| `tsconfig.json` | Web app config |
| `.eslintrc.json` | Web app config |

## What Gets Kept

| Path | Purpose |
|------|---------|
| `.claude/commands/` | The 10 slash commands (the product) |
| `scripts/dev-lead.js` | OpenAI API calls for `/dev-lead-1` |
| `package.json` | Dependencies for dev-lead script (will be trimmed) |
| `CLAUDE.md` | Portable AI assistant instructions |
| `README.md` | Project overview (will be rewritten) |
| `.gitignore` | Git ignore rules |
| `.env.local.example` | Documents required OPENAI_API_KEY |

## Tasks

- [x] 🟩 **Step 0: Create git tag for reference**
  - [x] 🟩 Tag current state as `v0-web-app` before cleanup

- [x] 🟩 **Step 1: Delete out-of-scope files**
  - [x] 🟩 Delete `app/` directory
  - [x] 🟩 Delete `lib/` directory
  - [x] 🟩 Delete `manager_package/` directory
  - [x] 🟩 Delete `toon_flow/` directory
  - [x] 🟩 Delete plan files: `PLAN.md`, `PLAN_V2.md`, `PLAN_DEV_LEAD.md`
  - [x] 🟩 Delete analysis files: `PEER_ANALYSIS.md`, `PEER_REVIEW_ANALYSIS.md`, `PEER_REVIEW_ANALYSIS_2.md`
  - [x] 🟩 Delete `ISSUE-score-critiques.md`
  - [x] 🟩 Delete `review-package-*.md` files
  - [x] 🟩 Delete web app configs: `next.config.mjs`, `postcss.config.mjs`, `tailwind.config.ts`, `tsconfig.json`, `.eslintrc.json`

- [x] 🟩 **Step 2: Trim package.json**
  - [x] 🟩 Remove Next.js/React/Tailwind dependencies
  - [x] 🟩 Keep only `openai` and `dotenv` for dev-lead script
  - [x] 🟩 Remove web app scripts (dev, build, start, lint)
  - [x] 🟩 Run `npm install` to regenerate minimal `package-lock.json`

- [x] 🟩 **Step 3: Update .env.local.example**
  - [x] 🟩 Remove ANTHROPIC_API_KEY (not needed for slash commands)
  - [x] 🟩 Keep only OPENAI_API_KEY for dev-lead script

- [x] 🟩 **Step 4: Update CLAUDE.md**
  - [x] 🟩 Rewrite "About This Project" to describe the slash command toolkit
  - [x] 🟩 Keep "How We Work Together" section (workflow, critical rules)
  - [x] 🟩 Add "Slash Commands" section with all 10 commands and their purpose
  - [x] 🟩 Add "Git Workflow" section with guidance on branches/commits/pushes
  - [x] 🟩 Add "Commit Messages" subsection with examples
  - [x] 🟩 Remove project-specific structure (no longer relevant)

- [x] 🟩 **Step 5: Update README.md**
  - [x] 🟩 Rewrite to describe the slash command toolkit
  - [x] 🟩 List all 10 commands with one-line descriptions
  - [x] 🟩 Add "Getting Started" section (how to use in Cursor)
  - [x] 🟩 Add setup instructions for `/dev-lead-1` (npm install, OPENAI_API_KEY)
  - [x] 🟩 Remove all web app content (setup, deploy, etc.)

- [x] 🟩 **Step 6: Verify consistency**
  - [x] 🟩 Check CLAUDE.md and README.md don't contradict each other
  - [x] 🟩 Verify no deleted files are referenced by kept commands
  - [x] 🟩 Fixed: Updated /package-review to be portable (removed Next.js-specific examples)
  - [x] 🟩 Fixed: Deleted scripts/package-review.js (project-specific, not needed)
  - [x] 🟩 Fixed: Updated /create-issue to not hardcode repo name

- [x] 🟩 **Step 7: Update /document command**
  - [x] 🟩 Update to reference CLAUDE.md and README.md as primary docs
  - [x] 🟩 Add instruction to keep CLAUDE.md portable across projects

- [x] 🟩 **Step 8: Clean up .gitignore**
  - [x] 🟩 Remove .next/ entry (no longer needed)
  - [x] 🟩 Keep node_modules, .env.local, .DS_Store patterns

- [ ] 🟥 **Step 9: Commit and push to GitHub**
  - [ ] 🟥 Create a single commit with all deletions and updates
  - [ ] 🟥 Push to main branch (this is a cleanup, not a feature)

---

## Git Workflow Guidance (for CLAUDE.md)

**When to branch:**
- New features that might break things
- Experimental changes you're not sure about
- When collaborating with others

**When to work on main:**
- Documentation updates
- Small fixes
- Cleanup work (like this issue)

**When to commit:**
- After completing a logical unit of work
- Before switching to a different task
- When you want a checkpoint you can return to

**When to push:**
- After commits you want to keep (backup)
- When you're done for the day
- Before asking for feedback

**Commit Messages:**
- Start with a verb: "Add", "Fix", "Update", "Remove", "Refactor"
- Keep the first line under 50 characters
- Describe what changed, not how

Examples:
- `Add git workflow guidance to CLAUDE.md`
- `Remove Next.js web app (out of scope for v1)`
- `Fix broken reference in dev-lead-1 command`

**Simple rule:** For solo learning projects, working on main is fine. Branch when you want to experiment safely.
