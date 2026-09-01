# AI Agent Setup Instructions (v6.0.0)

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
- `node` (required - it runs the toolkit's dependency-free helper scripts: HTML rendering via `render-html.js`, the `/index` codebase scanner, and the session-startup aggregator)
- `npm` (only needed for the optional `/ask-gpt`, `/ask-gemini`, and `/review-browser` dependencies in Step 2)

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
- `.claude/skills/` (all skill definitions - review specialists, learning-opportunity, project-context - plus the shared reference files and the prebuilt HTML shells in `shared/shells/`)
- `.claude/rules/toolkit.md` (toolkit workflow rules - always updated)
- `.claude/rules/html-outputs.md` (HTML output rules - always updated)
- `.claude/settings.local.json` (permission config - preserved if it already exists; new toolkit permissions are merged in on re-run)
- `.claude/scripts/generate-index.js` (codebase scanner used by `/index` to build `CODEBASE_MAP.md` - always updated)
- `.claude/scripts/session-init.js` (aggregates command-startup reads - map freshness, lessons index, plan statuses, worktree state - into one JSON; always updated)
- `.claude/scripts/render-html.js` and `.claude/scripts/open-artifact.sh` (HTML renderer + cross-platform artifact opener - always updated)
- `.claude/scripts/` (ask-gpt.js, ask-gemini.js, browse.js, and a quarantined `package.json` + `package-lock.json` - runtime scripts and their deps live here so the project's root `package.json` stays untouched, issue #91)
- `artifacts/README.md` (scaffold for the gitignored `artifacts/html/` output directory)
- `CLAUDE.md` (project instructions template - skipped if it already exists)
- `LESSONS.md` (learning log index - skipped if it already exists; read at session start so past lessons feed back into new work)
- `LESSONS-detail.md` (full lesson write-ups behind the index - seeded only on a fresh install, preserved on upgrade)
- `.env.local.example` (API key template)
- `.gitignore` (merged with existing - new toolkit entries added, custom entries preserved)
- `.gitattributes` (enforces LF line endings for shell scripts)
- `VERSION` (toolkit version number)

Note: Setup scripts (setup.sh, setup.ps1, install-alias.*) stay in the toolkit repo and are not copied to target projects.

### Updating an Existing Project

If the toolkit is already set up in the user's project, **run the same Step 1 command again**. It's safe to rerun.

**What gets updated** (always overwritten):
- `.claude/commands/` - all slash command definitions
- `.claude/skills/` - all skill definitions (review specialists, learning-opportunity, project-context, shared references, and the prebuilt HTML shells in `shared/shells/`)
- `.claude/rules/toolkit.md` and `.claude/rules/html-outputs.md` - the managed rules files
- `.claude/scripts/generate-index.js` - codebase scanner used by `/index`
- `.claude/scripts/session-init.js` - command-startup aggregator (map freshness, lessons, plan statuses, worktree state) for `/explore`, `/create-plan`, `/pair-debug`, `/execute`
- `.claude/scripts/render-html.js` and `.claude/scripts/open-artifact.sh` - HTML renderer + artifact opener
- `.claude/scripts/ask-gpt.js`, `.claude/scripts/ask-gemini.js`, `.claude/scripts/browse.js`, and `.claude/scripts/package.json` + `package-lock.json` - runtime scripts and their quarantined deps
- `artifacts/README.md`, `.env.local.example`, `.gitignore` (merged, not overwritten), `.gitattributes`, `VERSION`

**What's preserved** (skipped if it already exists):
- `CLAUDE.md` - the user's project-specific instructions
- `LESSONS.md` - the user's learning log (index)
- `LESSONS-detail.md` - the full lesson write-ups behind the index (present once the index/detail split exists)
- `.claude/settings.local.json` - the user's permission config (preserved, with new toolkit permissions merged in on re-run)

**Migrating from the old CLAUDE.md (pre-split):** If the user's `CLAUDE.md` contains toolkit rules (workflow, slash commands table, permissions table, git workflow, subagent strategy), those rules now live in `.claude/rules/toolkit.md` and are auto-loaded. The user should:
1. Re-run setup (Step 1 above) to get the new `toolkit.md`
2. Edit their `CLAUDE.md` to keep only project-specific info (About This Project, Who I Am, My Preferences)
3. Remove the toolkit sections from their `CLAUDE.md` - they're now managed automatically

If the user wants a completely fresh `CLAUDE.md` template, they can delete theirs and rerun setup.

**What's new (unreleased, ships in the next version):** The correction ledger (#157). After re-running setup:
- `/document` now has a capture stage. At the end of a cycle it finds the moments the user stepped in, has a fresh subagent read those exchanges cold, and asks the user to confirm or rewrite a short note about each one before anything is recorded. Nothing is written without their say-so. It explains itself the first time it runs in a project, so you do not need to introduce it.
- A new `/error-analysis` command groups those notes into categories and ranks them by count. It is user-triggered and never chained into. It refuses to rank on fewer than ten rows.
- Data lives at `~/.claude/`, per machine, append-only, outside every repo. Tell the user plainly: the mechanism ships to every install, the data never leaves their machine, it is never published, and it is never sent to another model. They can turn it off for a repo with `touch .claude/.no-correction-log`.
- **If the user kept a customized `.claude/commands/document.md`:** the capture stage is a new Section 6 in that file, and Sections 6 through 8 were renumbered to 7 through 9. Declining setup's overwrite prompt aborts the whole run, so if they take the update, point them at the backup setup made and tell them the capture stage is what to merge their edits around.
- **If a global `~/.claude/commands/document.md` exists**, it shadows the project copy and capture silently never runs. Setup already warns about the name conflict; tell the user what is lost, not just that a conflict exists.

**What's new in v6.0.0:** Auto by default - a breaking behavior change (#143, #145 through #152, #154). After re-running setup:
- The loop no longer stops at a report. A review now fixes the findings that survived its own audit, re-verifies each fix with something other than whatever made it, and hands off to the next stage. Tell the user this plainly: it is the reason for the major version. Two per-run phrases take it back, and they do different things - "report only" stops the changing, "no chaining" stops the handoff.
- Findings must prove themselves first. Each carries a receipt (a read-only command plus what its output must show), the run executes it, and survivors face a skeptic; a Block-severity finding faces three. Reports are shorter, and what was thrown out is listed rather than hidden.
- A pre-push tripwire (`.claude/scripts/pre-push-check.js`) reads every outgoing commit for secrets, never-push files, and shared-settings changes before any push the loop makes. It fails closed. Note it is a rule the toolkit follows, not a git hook, so a `git push` typed by hand is unscanned.
- Five kinds of action still always ask: releases and version bumps, prompt-file edits, deleting user data, sending anything off the machine, and force pushes.
- The toolkit now works on GitLab as well as GitHub, detected from the git remote at the moment it is needed. The `glab` path has since been executed end to end against a live repo and its three defects are fixed, so do not warn the user it is untested. One caveat remains: `--output json` has moved between glab versions, and older builds want `-F json`.
- HTML artifacts still open locally and are now also published to a private Claude-hosted page when the session can. Published pages carry no machine-identifying paths: the render passes `--no-abs`, which strips the editor links and rewrites the repo root and home directory out of the text.

**What was new in v5.5.0:** Installer guardrails + model refresh (#134, #138, #139, #140). After re-running setup:
- Setup detects local edits inside toolkit-managed files via a hash manifest (`.claude/.toolkit-manifest.json`). Locally modified files gate the run: an interactive terminal prompts, a non-interactive run (you, most likely) exits 1 listing the files. If that happens, show the list to the user and confirm before re-running Step 1 with the force flag added INSIDE the quoted one-liner, right after the target path: change `bash "$TEMP_DIR/scripts/setup/setup.sh" "TARGET_PROJECT_PATH"` to `bash "$TEMP_DIR/scripts/setup/setup.sh" "TARGET_PROJECT_PATH" --force` (PowerShell: add `-Force` after `` -Target `"TARGET_PROJECT_PATH`" `` in the Step 1 command). Appending `--force` after the one-liner's closing quote does nothing - `bash -c` swallows it. Every replaced file is backed up first and listed after setup.
- `/ask-gpt` defaults to `gpt-5.6-sol` and `/ask-gemini` to `gemini-3.6-flash`; an old pinned model in `.env.local` auto-overrides with a stderr notice.
- HTML artifacts on WSL open PowerShell-first (wslview dropped); a genuinely headless failure prints the Windows-side UNC path that can be pasted into a Windows browser.
- `/worktree` copies `CODEBASE_MAP.md` into new worktrees (like `.env.local`), so worktree sessions no longer regenerate the map.

**What was new in v5.4.0:** Bounded, verifier-gated loops (#137). After re-running setup:
- After you approve review fixes ("fix it" on `/review` findings, or Yes/Partial on debate Recommended Actions), the fixes are re-verified instead of assumed done: mechanical checks re-run inline; judgment findings get one fresh subagent per round returning countable verdicts ("R3: FIXED" / "R3: NOT FIXED" plus a receipt). Max 2 rounds; anything new found mid-verification is report-only.
- `/execute` caps small-failure retries at 3 attempts per step, iterating against real test/build output; a plan's Verify step shares the same budget (no fresh allowance), and parallel step agents carry the bound in their prompts.
- `/ask-gpt` and `/ask-gemini` debates run up to 3 rounds: a countable convergence gate ends the debate after round 2 when the reviewer's "Still Discussing" and "New Observations" sections are both settled. The maximum never extends.
- `/index` retries a failed chunk once silently before asking you; oversized chunks skip the doomed retry; if every chunk fails, it stops and leaves the existing map untouched.

See [CHANGELOG.md](CHANGELOG.md) for older release notes (v5.3.0 and earlier).

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
/explore  →  /create-plan  →  [user approves]  →  /execute  →  /review  →  /document
                                                                   ↓ (optional, user-triggered)
                                                       /ask-gpt or /ask-gemini
```

The user types `/explore` and approves the plan; the rest chain automatically (rule M14 in `.claude/skills/shared/hitl-loop.md`). Saying "no chaining" on any run stops after that stage. The AI debates are never chained into - the user starts one deliberately.

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
