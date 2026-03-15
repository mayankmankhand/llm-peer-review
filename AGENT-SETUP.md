# AI Agent Setup Instructions (v2)

This file is written for AI agents with shell access (like Cursor or Claude Code). If a user asks you to set up this workflow toolkit in their project, follow the steps below exactly.

<rules>

**Do NOT modify this repository.** Do not commit changes, open PRs, or edit files in this repo. This repo is the source toolkit. Your job is to copy the right files into the user's project.

</rules>

---

## What This Toolkit Is

<reference>

A set of slash commands and scripts that give AI agents a structured workflow: explore, plan, build, review, get a second opinion, document. The commands live in `.claude/commands/` and work in Cursor and Claude Code.

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
- `.claude/rules/toolkit.md` (toolkit workflow rules - always updated)
- `.claude/settings.local.json` (permission config - skipped if it already exists)
- `scripts/` (ask-gpt.js, ask-gemini.js, and browse.js - runtime scripts for peer review and browser QA)
- `CLAUDE.md` (project instructions template - skipped if it already exists)
- `LESSONS.md` (learning log template - skipped if it already exists)
- `.env.local.example` (API key template)
- `.gitignore` (ignores plan files, env files, node_modules, etc.)
- `.gitattributes` (enforces LF line endings for shell scripts)

Note: Setup scripts (setup.sh, setup.ps1, install-alias.*) stay in the toolkit repo and are not copied to target projects.

### Updating an Existing Project

If the toolkit is already set up in the user's project, **run the same Step 1 command again**. It's safe to rerun.

**What gets updated** (always overwritten):
- `.claude/commands/` - all slash command definitions
- `.claude/rules/toolkit.md` - toolkit workflow rules
- `scripts/ask-gpt.js` and `scripts/ask-gemini.js` - runtime scripts
- `.env.local.example`, `.gitignore`, `.gitattributes`

**What's preserved** (skipped if it already exists):
- `CLAUDE.md` - the user's project-specific instructions
- `LESSONS.md` - the user's learning log
- `.claude/settings.local.json` - the user's permission config

**Migrating from the old CLAUDE.md (pre-split):** If the user's `CLAUDE.md` contains toolkit rules (workflow, slash commands table, permissions table, git workflow, subagent strategy), those rules now live in `.claude/rules/toolkit.md` and are auto-loaded. The user should:
1. Re-run setup (Step 1 above) to get the new `toolkit.md`
2. Edit their `CLAUDE.md` to keep only project-specific info (About This Project, Who I Am, My Preferences)
3. Remove the toolkit sections from their `CLAUDE.md` - they're now managed automatically

If the user wants a completely fresh `CLAUDE.md` template, they can delete theirs and rerun setup.

**What's new in v2:** After re-running setup:
- `/review` renamed to `/review-code` (same functionality plus a 4th sub-agent)
- 5 new review commands: `/review-commands`, `/review-plan`, `/review-ux`, `/review-browser`, `/review-full`
- `/review-browser` drives a headless browser to QA running web apps (requires playwright-core + chromium)
- All review commands share severity anchors and "Use this when" guidance
- `/explore` now has two gears: scoping mode (default) for concrete features, vision mode for strategy and ideation
- `/explore` Phase 2 includes optional ASCII diagrams for features with flows or multi-step processes
- UI/UX preferences now handled directly in `/explore` and `/create-plan` (old UI spec command removed)

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
npm install --prefix "TARGET_PROJECT_PATH" playwright-core
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
/explore  →  /create-plan  →  /execute  →  /review-code  →  /ask-gpt or /ask-gemini  →  /document
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
