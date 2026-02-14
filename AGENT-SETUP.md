# AI Agent Setup Instructions

This file is written for AI agents with shell access (like Cursor or Claude Code). If a user asks you to set up this workflow toolkit in their project, follow the steps below exactly.

**Do NOT modify this repository.** Do not commit changes, open PRs, or edit files in this repo. This repo is the source toolkit. Your job is to copy the right files into the user's project.

---

## What This Toolkit Is

A set of slash commands and scripts that give AI agents a structured workflow: explore, plan, build, review, get a second opinion, document. The commands live in `.claude/commands/` and work in Cursor and Claude Code.

---

## Environment

Assume shell access on the user machine. Use bash on macOS/Linux/WSL, or PowerShell on native Windows. Pick commands that match their shell.

---

## Setup Steps

### Prerequisites

The user's machine needs:
- `git` (to clone this repo temporarily)
- `bash` (to run the setup script — compatible with Bash 3.2+ on macOS/Linux/WSL) or PowerShell 5.1+ (native Windows)
- `node` and `npm` (only if they want the `/dev-lead-gpt` and `/dev-lead-gemini` commands)

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
- `.claude/settings.local.json` (permission config — skipped if it already exists)
- `scripts/` (only dev-lead-gpt.js and dev-lead-gemini.js — runtime scripts needed for peer review)
- `CLAUDE.md` (project instructions — skipped if it already exists)
- `.env.local.example` (API key template)
- `.gitignore` (ignores plan files, env files, node_modules, etc.)
- `.gitattributes` (enforces LF line endings for shell scripts)

Note: Setup scripts (setup.sh, setup.ps1, install-alias.*) stay in the toolkit repo and are not copied to target projects.

### Step 2: Install dependencies (optional)

Only needed if the user wants `/dev-lead-gpt` or `/dev-lead-gemini`:

```bash
npm install --prefix "TARGET_PROJECT_PATH" @google/generative-ai openai
```

If the project doesn't have a `package.json` yet, run `npm init -y` in the project directory first so dependencies are recorded. If the user doesn't need these two commands, skip this step entirely.

### Step 3: Set up API keys (optional, requires user input)

Only needed if the user installed dependencies in Step 2:

```bash
cp "TARGET_PROJECT_PATH/.env.local.example" "TARGET_PROJECT_PATH/.env.local"
```

Tell the user to open `.env.local` and paste their API keys:
- **OPENAI_API_KEY** — from https://platform.openai.com/api-keys
- **GEMINI_API_KEY** — from https://aistudio.google.com/apikey

Do NOT fill in API keys yourself. The user must do this manually.

### Step 4: Customize CLAUDE.md

If `CLAUDE.md` was newly created (not skipped), tell the user they should edit it to describe their project instead of the toolkit. The sections to update:

- **"About This Project"** — change to describe their project
- **"Who I Am"** — change to describe themselves or their team
- **"Remember"** — adjust to their preferences

The rest of CLAUDE.md (workflow, commands, git guidance) works as-is.

---

## After Setup

The user can now open their project in Cursor or Claude Code and type `/` to see the available commands. The recommended workflow order is:

```
/explore  →  /create-plan  →  /execute  →  /review  →  /peer-review  →  /document
```

---

## Troubleshooting

- **"setup.sh: command not found"** — Make sure to run the full `bash -c '...'` command from Step 1, not just `setup.sh` on its own
- **"target directory does not exist"** — Create the project folder first: `mkdir -p /path/to/project`
- **Commands don't show up in Cursor** — Make sure `.claude/commands/` exists in the project root with `.md` files inside
- **`/dev-lead-gpt` or `/dev-lead-gemini` fails** — Check that `npm install` was run and `.env.local` has valid API keys
- **"Permission denied"** — Ensure you have write access to the target project directory
- **Commands exist but don't appear in the editor** — Make sure the editor workspace root is the project folder that contains `.claude/`, not a parent directory
- **Script errors with `/bin/bash^M` or "bad interpreter"** — Line-ending issue. Delete the folder and clone fresh, or run `git add --renormalize . && git checkout -- .`
- **Setup command fails partway through** — Safe to rerun. Leftover `/tmp/tmp.*` folders are harmless
