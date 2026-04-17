# AI Agent Setup Instructions (v4.2)

This file is written for AI agents with shell access (like Cursor or Claude Code). If a user asks you to set up this workflow toolkit in their project, follow the steps below exactly.

<rules>

**Do NOT modify this repository.** Do not commit changes, open PRs, or edit files in this repo. This repo is the source toolkit. Your job is to copy the right files into the user's project.

</rules>

---

## What This Toolkit Is

<reference>

A set of slash commands, skills, and scripts that give AI agents a structured workflow: explore, plan, build, review, get a second opinion, document. Commands live in `.claude/commands/`, skills live in `.claude/skills/`, and both work in Cursor and Claude Code.

</reference>

---

## Environment

<reference>

Assume shell access on the user machine. Use bash on macOS/Linux/WSL, or PowerShell on native Windows for setup. Note: the debate commands (`/ask-gpt`, `/ask-gemini`) require bash/WSL - they don't work in native PowerShell.

</reference>

---

## Setup Steps

<procedure>

### Prerequisites

The user's machine needs:
- `git` (to clone this repo temporarily)
- `bash` (to run the setup script - compatible with Bash 3.2+ on macOS/Linux/WSL) or PowerShell 5.1+ (native Windows)
- `node` and `npm` (only if they want the `/ask-gpt` and `/ask-gemini` commands)

### Windows note

If the user is on Windows, choose one:
- **WSL/bash path** (Linux style): convert `C:\Users\YourName\Projects\my-app` to `"/mnt/c/Users/YourName/Projects/my-app"`
- **PowerShell/native path** (Windows style): keep `C:\Users\YourName\Projects\my-app`

### Step 1: Copy the toolkit into the user's project

Use one of these commands. Replace `TARGET_PROJECT_PATH` with the absolute path to the user's project.

**Bash (macOS/Linux/WSL):**
```bash
bash -c 'TEMP_DIR=$(mktemp -d) && git clone --depth 1 https://github.com/mayankmankhand/llm-peer-review.git "$TEMP_DIR" && bash "$TEMP_DIR/scripts/setup/setup.sh" "TARGET_PROJECT_PATH" && rm -rf "$TEMP_DIR"'
```

**PowerShell (native Windows):**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "$tmp=New-Item -ItemType Directory -Path ([System.IO.Path]::GetTempPath()) -Name ([System.Guid]::NewGuid()) ; git clone --depth 1 https://github.com/mayankmankhand/llm-peer-review.git $tmp.FullName ; powershell -ExecutionPolicy Bypass -File `"$($tmp.FullName)\scripts\setup\setup.ps1`" -Target `"TARGET_PROJECT_PATH`" ; Remove-Item -Recurse -Force $tmp.FullName"
```

If the command fails partway through, it is safe to rerun. Leftover `/tmp/tmp.*` directories are harmless and can be deleted.

This copies:
- `.claude/commands/` (all slash command definitions)
- `.claude/skills/` (all skill definitions - review specialists, learning-opportunity, project-context)
- `.claude/rules/toolkit.md` (toolkit workflow rules - always updated)
- `.claude/settings.local.json` (permission config - skipped if it already exists)
- `.claude/scripts/generate-index.js` (project index generator - always updated)
- `scripts/` (ask-gpt.js, ask-gemini.js, and browse.js - runtime scripts for peer review and browser QA)
- `CLAUDE.md` (project instructions template - skipped if it already exists)
- `LESSONS.md` (learning log template - skipped if it already exists)
- `.env.local.example` (API key template)
- `.gitignore` (merged with existing - new toolkit entries added, custom entries preserved)
- `.gitattributes` (enforces LF line endings for shell scripts)
- `VERSION` (toolkit version number)

Note: Setup scripts (setup.sh, setup.ps1, install-alias.*) stay in the toolkit repo and are not copied to target projects.

### Updating an Existing Project

If the toolkit is already set up in the user's project, **run the same Step 1 command again**. It's safe to rerun.

**What gets updated** (always overwritten):
- `.claude/commands/` - all slash command definitions
- `.claude/skills/` - all skill definitions (review specialists, learning-opportunity, project-context, shared references)
- `.claude/rules/toolkit.md` - toolkit workflow rules
- `.claude/scripts/generate-index.js` - project index generator
- `scripts/ask-gpt.js`, `scripts/ask-gemini.js`, and `scripts/browse.js` - runtime scripts
- `.env.local.example`, `.gitignore` (merged, not overwritten), `.gitattributes`, `VERSION`

**What's preserved** (skipped if it already exists):
- `CLAUDE.md` - the user's project-specific instructions
- `LESSONS.md` - the user's learning log
- `.claude/settings.local.json` - the user's permission config

**Migrating from the old CLAUDE.md (pre-split):** If the user's `CLAUDE.md` contains toolkit rules (workflow, slash commands table, permissions table, git workflow, subagent strategy), those rules now live in `.claude/rules/toolkit.md` and are auto-loaded. The user should:
1. Re-run setup (Step 1 above) to get the new `toolkit.md`
2. Edit their `CLAUDE.md` to keep only project-specific info (About This Project, Who I Am, My Preferences)
3. Remove the toolkit sections from their `CLAUDE.md` - they're now managed automatically

If the user wants a completely fresh `CLAUDE.md` template, they can delete theirs and rerun setup.

**What's new in v4.2:** After re-running setup:
- Setup now preserves any file it would overwrite or delete by copying the original to `.toolkit-backup-<timestamp>/` at the project root, with mirrored paths. Upgrades never destroy user customizations - if something gets replaced, the original is one directory away. Byte-identical files are skipped entirely (no copy, no backup), so clean installs produce no backup directory. The `.toolkit-backup-*/` pattern is added to `.gitignore` automatically on the next install.

**What was new in v4.1:** After re-running setup:
- New `/review-copy` skill for copy clarity and reader orientation review. Works standalone (`/review-copy`) or via the unified dispatcher (`/review copy`).
- Shared reference files updated: `severity-anchors.md` has Copy Review severity anchors, `output-template.md` has a Copy row in the specialist table.
- No new permissions needed - all tools used by `/review-copy` (Read, Glob, Grep, Agent, WebSearch) are already in `settings.local.json`.

**What was new in v4.0:** After re-running setup:
- Plans moved from `.claude/plans/` to `plans/` (top-level). The `.claude/` directory is protected by Claude Code, which caused permission prompts on every plan read/write. Setup automatically migrates existing plan files and removes the old directory.
- Version bump to 4.0 reflects a workflow-affecting change (plan location)

**What was new in v3.5:** After re-running setup:
- Skills layer: 6 review commands migrated to `.claude/skills/` for agent discovery (`review-code`, `review-ux`, `review-plan`, `review-commands`, `review-browser`, `review-full`). `learning-opportunity` also moved to a skill.
- Unified `/review` command dispatches specialist review skills and combines findings into one report
- New skills: `review-deps` (dependency and supply chain security), `project-context` (agent-only - provides context to subagents)
- New commands: `/review`, `/codebase-to-course`
- `browse.js` improvements: server auto-start (opt-in), accessibility scanning via `@axe-core/playwright`, responsive screenshots
- New dependency: `@axe-core/playwright` for accessibility testing in browser QA
- Legacy cleanup: setup automatically removes old review command files from `.claude/commands/` that were migrated to skills
- New permissions needed: `npm audit`, `npm outdated` - if the user has an existing `.claude/settings.local.json`, add `"Bash(npm audit *)"` and `"Bash(npm outdated *)"` to the `permissions.allow` array so `/review-deps` can run without prompting

**What was new in v3.4:** After re-running setup:
- `/index` command and `INDEX.md` auto-generation - a Node script generates a file tree of all git-tracked files. Setup generates it on first run, `/document` regenerates it after changes, `/explore` reads it during Phase 2
- New file: `.claude/scripts/generate-index.js` (toolkit-managed, always updated)
- New gitignore entry: `INDEX.md` (local-only, machine-generated)
- New permission: `node .claude/scripts/generate-index.js` - if the user has an existing `.claude/settings.local.json`, add `"Bash(node .claude/scripts/generate-index.js *)"` to the `permissions.allow` array so `/index` and `/document` can run the script without prompting

**What was new in v3.3:** After re-running setup:
- Self-Service section in toolkit rules - Claude now has explicit guidance to run dev servers, tests, builds, and dependency installs itself instead of asking the user

**What was new in v3.2:** After re-running setup:
- Procedure block fix in debate commands - Steps 6 and 7 were outside the `<procedure>` block in both `ask-gpt.md` and `ask-gemini.md`
- Write tool guard - added Read-before-Write pattern at all file creation points in debate commands so they work as background subagents
- Demo script (`DEMO-SCRIPT.md`) - 5-minute presenter's script for live-demoing the full workflow

**What was new in v3:** After re-running setup:
- `/peer-review` rewritten with severity-based evaluation framework and structured output template
- `/pair-debug` now includes an approval step before fixing (consistent with other review commands)
- `/execute` defines "critical blocker" with concrete examples
- `/review-full` clarifies specialist review guidance
- `/create-plan` adds parallel vs sequential step examples
- `browse.js` keeps more error context (3 lines instead of 1)
- Various doc fixes (README link, SETUP step ordering, CHANGELOG cleanup)

**What was new in v2:** `/review` renamed to `/review-code`, 5 new review commands added (`/review-commands`, `/review-plan`, `/review-ux`, `/review-browser`, `/review-full`), `/explore` gained vision mode and ASCII diagrams, UI/UX preferences moved into `/explore` and `/create-plan`.

Tell the user about these changes if they were on an older version. See `CHANGELOG.md` for full details.

---

### Step 2: Install dependencies (optional)

There are two optional dependency groups. Install what's needed:

**For `/ask-gpt` and `/ask-gemini` (AI debate commands):**
```bash
npm install --prefix "TARGET_PROJECT_PATH" @google/generative-ai openai
```

**For `/review-browser` (headless browser QA):**
```bash
npm install --prefix "TARGET_PROJECT_PATH" playwright-core @axe-core/playwright
npx --prefix "TARGET_PROJECT_PATH" playwright-core install chromium
```
On Linux/WSL, system libraries are also needed:
```bash
sudo npx playwright-core install-deps chromium
```

If the project doesn't have a `package.json` yet, run `npm init -y` in the project directory first so dependencies are recorded. Skip any group the user doesn't need.

### Step 3: Set up API keys (optional, requires user input)

Only needed if the user installed dependencies in Step 2:

```bash
cp "TARGET_PROJECT_PATH/.env.local.example" "TARGET_PROJECT_PATH/.env.local"
```

Tell the user to open `.env.local` and paste their API keys:
- **OPENAI_API_KEY** - from https://platform.openai.com/api-keys
- **GEMINI_API_KEY** - from https://aistudio.google.com/apikey

Do NOT fill in API keys yourself. The user must do this manually.

### Step 4: Customize CLAUDE.md

If `CLAUDE.md` was newly created (not skipped), tell the user they should edit it to describe their project. The sections to update:

- **"About This Project"** - describe their project, tech stack, what it does
- **"Who I Am"** - describe themselves or their team
- **"My Preferences"** - add project-specific rules or coding conventions

Toolkit workflow rules are in `.claude/rules/toolkit.md` (auto-loaded, managed by the toolkit - no need to edit).

</procedure>

---

## After Setup

<reference>

The user can now open their project in Cursor or Claude Code and type `/` to see the available commands. The recommended workflow order is:

```
/explore  →  /create-plan  →  /execute  →  /review  →  /ask-gpt or /ask-gemini  →  /document
```

</reference>

---

## Troubleshooting

<reference>

- **"setup.sh: command not found"** - Make sure to run the full `bash -c '...'` command from Step 1, not just `setup.sh` on its own
- **"target directory does not exist"** - Create the project folder first: `mkdir -p /path/to/project`
- **Commands don't show up in Cursor** - Make sure `.claude/commands/` exists in the project root with `.md` files inside
- **`/ask-gpt` or `/ask-gemini` fails** - Check that `npm install` was run and `.env.local` has valid API keys
- **"Permission denied"** - Ensure you have write access to the target project directory
- **Commands exist but don't appear in the editor** - Make sure the editor workspace root is the project folder that contains `.claude/`, not a parent directory
- **Script errors with `/bin/bash^M` or "bad interpreter"** - Line-ending issue. Delete the folder and clone fresh, or run `git add --renormalize . && git checkout -- .`
- **Setup command fails partway through** - Safe to rerun. Leftover `/tmp/tmp.*` folders are harmless
- **Commands seem outdated or missing sections** - Delete any toolkit command files from `~/.claude/commands/`. Global copies override project commands and cause stale behavior

</reference>
