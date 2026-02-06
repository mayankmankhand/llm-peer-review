# AI Agent Setup Instructions

This file is written for AI agents with shell access (like Cursor or Claude Code). If a user asks you to set up this workflow toolkit in their project, follow the steps below exactly.

**Do NOT modify this repository.** Do not commit changes, open PRs, or edit files in this repo. This repo is the source toolkit. Your job is to copy the right files into the user's project.

---

## What This Toolkit Is

A set of slash commands and scripts that give AI agents a structured workflow: explore, plan, build, review, get a second opinion, document. The commands live in `.claude/commands/` and work in Cursor and Claude Code.

---

## Setup Steps

### Prerequisites

The user's machine needs:
- `git` (to clone this repo temporarily)
- `bash` (to run the setup script)
- `node` and `npm` (only if they want the `/dev-lead-gpt` and `/dev-lead-gemini` commands)

### Step 1: Copy the toolkit into the user's project

This single command clones the toolkit to a temporary folder, copies the right files into the user's project, and cleans up. Replace `TARGET_PROJECT_PATH` with the absolute path to the user's project. Keep the quotes around the path.

```bash
TEMP_DIR=$(mktemp -d) && \
git clone --depth 1 https://github.com/mayankmankhand/llm-peer-review.git "$TEMP_DIR" && \
bash "$TEMP_DIR/scripts/setup.sh" "TARGET_PROJECT_PATH" && \
rm -rf "$TEMP_DIR"
```

If the command fails partway through, the temporary directory may remain in `/tmp` — it is safe to delete.

This copies:
- `.claude/commands/` (all slash command definitions)
- `.claude/settings.local.json` (permission config — skipped if it already exists)
- `scripts/` (dev-lead-gpt.js, dev-lead-gemini.js, setup.sh)
- `CLAUDE.md` (project instructions — skipped if it already exists)
- `.env.local.example` (API key template)

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

- **"setup.sh: command not found"** — Make sure to run the full chained command from Step 1, not just `setup.sh` on its own
- **"target directory does not exist"** — Create the project folder first: `mkdir -p /path/to/project`
- **Commands don't show up in Cursor** — Make sure `.claude/commands/` exists in the project root with `.md` files inside
- **`/dev-lead-gpt` or `/dev-lead-gemini` fails** — Check that `npm install` was run and `.env.local` has valid API keys
- **"Permission denied"** — Ensure you have write access to the target project directory
- **Commands exist but don't appear in the editor** — Make sure the editor workspace root is the project folder that contains `.claude/`, not a parent directory
