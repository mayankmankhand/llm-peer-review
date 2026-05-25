# AI Agent Setup Instructions (v4.6.0)

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
- `.claude/scripts/generate-index.js` (codebase scanner used by `/index` to build `CODEBASE_MAP.md` - always updated)
- `.claude/scripts/` (ask-gpt.js, ask-gemini.js, browse.js, and a quarantined `package.json` - runtime scripts and their deps live here so the project's root `package.json` stays untouched, issue #91)
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
- `.claude/scripts/generate-index.js` - codebase scanner used by `/index`
- `.claude/scripts/ask-gpt.js`, `.claude/scripts/ask-gemini.js`, `.claude/scripts/browse.js`, and `.claude/scripts/package.json` - runtime scripts and their quarantined deps
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

**What's new in v4.6.0:** Debate hardening (#101 + #103/#104). After re-running setup:
- `/ask-gpt` and `/ask-gemini` now actively detect silent empty bodies. If the token cap is exhausted by reasoning/thinking, a refusal is returned, or a safety filter triggers, the script throws a descriptive error naming the cause AND the fix (e.g. "Raise GPT_MAX_TOKENS or shorten the input"). Empty exit-code-0 returns are no longer possible.
- Default token cap raised from 4096 to 32000 in both scripts. Above OpenAI's 25K reasoning reserve and Gemini's 8192 SDK default, so reasoning has room to think before visible output is generated. Lower it with `GPT_MAX_TOKENS` / `GEMINI_MAX_TOKENS` to cap cost.
- Each `/ask-gpt` and `/ask-gemini` invocation now gets a session ID (`$(date +%s)-$RANDOM`) embedded in every `/tmp/ask-*-{context,debate}-<session-id>.md` path. Two parallel Cursor or Claude Code tabs running the same command no longer clobber each other's transcripts. The debate file's first line is `<!-- Session: <id> -->` so the ID stays recoverable if context compression drops it; recovery instructions explicitly warn against blindly picking the most recent file under concurrency.
- `/ask-gpt` and `/ask-gemini` final summaries now use the canonical 4-field finding structure from `/review` (What / Why it matters / Example / Suggested fix), sliced from `.claude/skills/shared/output-template.md` via a new `loadOutputTemplate()` helper. Mid-debate severity vocabulary unified from `[CRITICAL/MAJOR/MINOR]` to 🚫/⚠️/💡 + R-IDs. Disagreed Points use 🤔 to avoid colliding with Warn severity.
- `.claude/settings.local.json` adds Skill permissions for `/explore`, `/create-plan`, `/execute`, `/review` so subagents do not prompt mid-flow.

**What was new in v4.5.1:** Documentation audit (issue #99). After re-running setup:
- README.md repositioned for non-AI-fluent newcomers: new headline ("AI peer review for your work."), debate-output screenshot moved to the top, "How key commands work" section with callouts for the six commands carrying the workflow, "slash command" / Cursor / Claude Code defined inline.
- AGENT-SETUP graveyard trimmed: only the last three release-notes blocks remain inline; older entries point at CHANGELOG.md.
- Cost claims removed from CHANGELOG.md and AGENT-SETUP.md per issue 99 review-comment. Replaced unmeasured projections with "See `/index` output for actual cost."
- API-KEYS.md gained a "deprecated model warning" subsection explaining v4.5.0's auto-override in plain language.
- Broken internal anchors fixed (README -> SETUP heading rename; API-KEYS -> removed README section).
- No new permissions, no behavior changes, no setup-script changes. Slash command and skill files were intentionally not modified during this audit. Downstream projects re-running setup refresh the doc files copied to them; `CLAUDE.md`, `LESSONS.md`, and `settings.local.json` remain preserved.

**What was new in v4.5.0:** Model default safety net (issue #100). After re-running setup:
- `/ask-gpt` and `/ask-gemini` now hold a `KNOWN_STALE_*_MODELS` list. If `GPT_MODEL` or `GEMINI_MODEL` in `.env.local` matches a previous default (e.g. `gpt-5.2`, `gpt-5.4`, `gemini-3-flash-preview`, matched case-insensitively), the script ignores the env value, uses the current default, and prints a one-line stderr warning. Custom values not on the stale list are still respected silently. Result: latest toolkit = latest models, no manual `.env.local` edits required.
- Each script prints `Using <provider> model: X` on stderr at the start of every run so users can confirm which model actually fired. stderr (not stdout) so the diagnostic stays out of the captured `/tmp/ask-*-debate.md` transcript that downstream rounds re-read.
- `setup.sh` now prints the current model defaults at the end of a run (greps the JS files for `const DEFAULT_X_MODEL = '...'`). A one-liner explicitly notes that the toolkit never reads or writes `.env.local`.
- `bump-version.sh` got an ordered checklist reminder for future model bumps: append the OLD `DEFAULT_*_MODEL` value to `KNOWN_STALE_*_MODELS` FIRST, then update `DEFAULT_*_MODEL`. Catches the obvious paste-the-new-value mistake.
- No new permissions needed. `.env.local` is never read or written by any of the new code - all override logic lives in the Node scripts where the env value is already in memory.

See [CHANGELOG.md](CHANGELOG.md) for older release notes (v4.4.1 and earlier).

---

### Step 2: Install dependencies (optional)

All toolkit runtime packages live inside `.claude/scripts/` so they don't pollute the user's root `package.json`. One install covers both feature groups:

```bash
npm install --prefix "TARGET_PROJECT_PATH/.claude/scripts"
```

That installs:
- `openai` and `@google/genai` (used by `/ask-gpt` and `/ask-gemini`)
- `playwright-core` and `@axe-core/playwright` (used by `/review-browser`)

All four packages land inside `.claude/scripts/node_modules/`.

**For `/review-browser` (headless browser QA), also install Chromium:**
```bash
npx --prefix "TARGET_PROJECT_PATH/.claude/scripts" playwright-core install chromium
```
On Linux/WSL, install the system libraries Chromium depends on. This step uses apt at the OS level (not npm), so it does NOT take `--prefix`:
```bash
sudo npx playwright-core install-deps chromium
```

The user's project does NOT need a root `package.json` for the toolkit to work. Skip the install entirely if the user doesn't need `/ask-gpt`, `/ask-gemini`, or `/review-browser` - the rest of the toolkit (`/explore`, `/create-plan`, `/execute`, `/review-code`, etc.) works without any npm dependencies.

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

On any install or update, `/audit-html` can scan the user's own markdown for files that would benefit from an HTML view (report-only). Toolkit outputs already render HTML automatically.

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
