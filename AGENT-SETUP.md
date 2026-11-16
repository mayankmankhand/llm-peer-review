# AI Agent Setup Instructions (v8.0.23)

This file is written for AI agents with shell access (like Cursor or Claude Code). If a user asks you to set up this workflow toolkit in their project, follow the steps below exactly.

<rules>

**Do NOT modify this repository.** Do not commit changes, open PRs, or edit files in this repo. This repo is the source toolkit and the plugin marketplace. Your job is to install the plugin and seed the user's project (Claude Code), or to copy the right files into it (other editors).

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
- `node` (required - it runs the toolkit's dependency-free helper scripts: HTML rendering via `render-html.js`, the `/index` codebase scanner, the review's merge helper, and the session-startup aggregator)
- `npm` (only needed for the optional `/ask-gpt`, `/ask-gemini`, and `/review-browser` dependencies in Step 2)

### Windows note

If the user is on Windows, choose one:
- **WSL/bash path** (Linux style): convert `C:\Users\YourName\Projects\my-app` to `"/mnt/c/Users/YourName/Projects/my-app"`
- **PowerShell/native path** (Windows style): keep `C:\Users\YourName\Projects\my-app`

### Step 1: Install the plugin (Claude Code)

Since v7.0.0 the toolkit is a Claude Code plugin. Nothing is copied into the project except a short rules file and a few seed files. From any terminal on the user's machine:

```bash
claude plugin marketplace add mayankmankhand/llm-peer-review
claude plugin install tk@llm-peer-review -s user
```

Inside Claude Code the same two steps are `/plugin marketplace add mayankmankhand/llm-peer-review` and `/plugin install tk@llm-peer-review`. A restart, or `/reload-plugins`, registers the commands; they carry the plugin's prefix (`/tk:explore`, `/tk:review`). The plugin installs its own runtime packages from its lockfile, so `npm install` is not needed for the debate or browser commands, only the Chromium binary (Step 2).

### Step 1b: Seed the project

If you are Claude Code, invoke the `tk:setup` skill from the project root: it runs the seed script, relays its report, and stops to ask the user (exit code 3) when a decision is needed. From any other shell, run the same script directly:

```bash
node ~/.claude/plugins/data/tk-llm-peer-review/current/scripts/setup-project.js
```

(That `current` link is created when a Claude Code session starts; before the first session, use the versioned cache path `~/.claude/plugins/cache/llm-peer-review/tk/<version>/scripts/setup-project.js`.) Exit code 0 is done; 3 means it stopped before touching anything and printed what needs a human decision (a dirty git tree, a migration outside a git repository, locally modified toolkit files, a copy-install of unknown provenance, or a settings file it cannot read); rerun with `--force` only after the user decides. `--force` never replaces a settings file setup cannot read: it leaves that file as it is and sets up the rest.

On a fresh project it writes, when absent: `.claude/rules/toolkit.md` (the short, version-stamped rules seed), `CLAUDE.md`, `LESSONS.md`, `LESSONS-detail.md`, `DESIGN-PROFILE.md`, `.env.local.example`, `.gitattributes`, `artifacts/README.md`, `.claude/toolkit/README.md`, `plans/`, and `artifacts/`; it line-merges `.gitignore`, key-merges the marketplace pointer into `.claude/settings.json` and the permission baseline into `.claude/settings.local.json` (backing up both settings files before changing either, naming every row it adds or removes, and never adding back a row it already offered in this working copy), and writes `.claude/.toolkit-state.json`. On a project that carried the copy-installed toolkit it migrates: see "Updating an Existing Project".

### Step 1c: Copy-install for other editors (Cursor, Codex, any editor without Claude Code plugins)

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

What it copies, keeps and merges is listed under "What setup does" in [docs/INSTALL.md](docs/INSTALL.md#manual-setup-run-the-script-yourself), and what each copied file does is in the file table in [docs/EXTENDING.md](docs/EXTENDING.md#how-it-works-file-architecture). The setup scripts themselves stay in this repo.

Setup also writes `.claude/.toolkit-manifest.json` at the end of every real run: the hash of every managed file it just wrote. That is setup's own bookkeeping, not a user file. Do not edit it, do not tell the user to, and do not delete it - it is what lets the next run tell a toolkit update apart from the user's own edit.

### Updating an Existing Project

**On the plugin:** run `claude plugin marketplace update llm-peer-review`, then `claude plugin update tk@llm-peer-review` as a separate command (add `--scope project` to the second for a plugin installed for one project only; `claude plugin update` alone does not fetch the marketplace, so it would not see a new release), restart or `/reload-plugins` (until a session starts on the new release, the stable `current` link under `~/.claude/plugins/data/tk-llm-peer-review/` still points at the previous one; the session-start hook moves it, and only a session start fires it, which a restart does and a reload in a running session does not), then invoke the `tk:upgrade` skill in every project on the plugin (the session notice asks for it in each project that is behind; a project with nothing behind is told so in one line). It audits the project's own `.claude/` files and `CLAUDE.md`, plus `.claude/settings.local.json`, `.gitignore`, `.gitattributes`, `artifacts/README.md`, and a migration record git still tracks, against the conventions that changed since the project's last audited version (`docs/CONVENTIONS.md`); eleven of its checks run on every upgrade whatever version the project came from, and `docs/CONVENTIONS.md` lists them; C-15 and C-16 edit files the toolkit seeded once, so their fixes wait for the batch page's tick. Findings go through the normal M2 audit and auto-fix loop, and it stops once to ask before editing any prompt file. The update itself never touches the project.

**Going back to an earlier release:** follow "Going back to an earlier release" in docs/INSTALL.md step by step: in each project, while the newer release is still installed, run `node ~/.claude/plugins/data/tk-llm-peer-review/current/scripts/upgrade-audit.js --rollback-to <version>` and commit `.claude/.toolkit-state.json`; then uninstall with `--keep-data`, remove the marketplace, add it pinned to the release tag (`mayankmankhand/llm-peer-review@v<version>`), and install again. Run the uninstall, marketplace and install commands from the user's home folder, not from the project: run inside a project, they also delete the toolkit's marketplace and plugin entries from that project's `.claude/settings.json` (for a project-scope install, run them in the project and then restore that file with `git checkout -- .claude/settings.json`). Relay each command's output to the user.

**A project cloned from a teammate:** a clone does not carry the plugin or the local permissions. Run `claude plugin marketplace add mayankmankhand/llm-peer-review`, then `claude plugin install tk@llm-peer-review`, restart, and run `tk:setup` in the project (Step 1b).

**Migrating a copy-install to the plugin:** install the plugin (Step 1), then run `tk:setup` in the project (Step 1b). It classifies every managed file against the installer's manifest, stops to ask about locally modified ones, backs up and removes the toolkit's files, keeps every custom file, seeds, merges settings (backing up both settings files first), records the migration, and hands off to `tk:upgrade`. An install with no manifest is recognized too (`VERSION` beside `.claude/commands/review.md`, or an early toolkit stamp in `.claude/rules/toolkit.md`); its files are of unknown provenance, so the run exits 3 until the user approves a rerun with `--force`. Helper scripts an early installer copied into the project's root `scripts/` folder are removed too (backed up first; every other file there is left alone), and a `VERSION` file that is the project's own is kept. The undo is the one `Undo:` line setup prints at the end of its report, built from what that run did; relay it to the user word for word. Followed left to right it checks out the tracked files it names, then deletes the files the run created (and its new folders, if empty), then copies the listed files back from the backup folder it names (or says which to restore by hand), then removes that folder. Do not substitute a generic `git checkout` of `.claude`: that leaves the created files in place and skips what only the backup holds. Setup never reads or moves the project's `.env.local`, and it does not need to: the plugin's scripts still read it (see Step 3 for the lookup order), so a project that kept its keys there keeps working.

**On a copy-install (other editors):** **run the same Step 1c command again**. It's safe to rerun.

**What a re-run touches** (overwritten, merged in place, preserved, migrated) is listed under "Copy-install updates" in [docs/INSTALL.md](docs/INSTALL.md#copy-install-updates-other-editors). A project that keeps its own root `VERSION` file or its own `.gitattributes` gets it replaced (backed up first), so say so if you see one.

**The gate on locally modified files.** Installs made with v5.5.0 or later carry `.claude/.toolkit-manifest.json`, and setup compares every managed file against it. A managed file the user edited stops the run: an interactive terminal prompts, a non-interactive run (you, most likely) exits 1 listing the files. Do not add the force flag on your own. Show the user that list, get a yes, then re-run the Step 1c command with the force flag inside its quotes, right after the target path: `bash "$TEMP_DIR/scripts/setup/setup.sh" "TARGET_PROJECT_PATH" --force` in bash, or `-Force` right after `` -Target `"TARGET_PROJECT_PATH`" `` in PowerShell. A flag added after the one-liner's closing quote goes to `bash -c`, not to setup. Every replaced file is backed up first. A file the user created themselves at a path the toolkit now ships under the same name counts as locally modified too, so it gates the run instead of being silently replaced.

**Pre-manifest installs (before v5.5.0).** No manifest means no gate: differing managed files show as `[differs, provenance unknown]` in the pre-flight report and are replaced, with a backup, without a prompt. So for these, run the dry run first - `--dry-run` after the target path in bash, `-DryRun` in PowerShell, placed the same way as the force flag - show the user the "provenance unknown" list, and after the real run copy anything they had customized out of the backup folder.

**The backup folder, and how to undo.** Setup copies everything it replaces or deletes into `.toolkit-backup-<YYYYMMDD-HHMMSS>-<pid>` at the project root, and only when something changed. What the folder holds and how to roll back are under "If you need to undo it" in [docs/INSTALL.md](docs/INSTALL.md#copy-install-updates-other-editors).

**After an upgrade, check five things:**
1. Run `npm install --prefix .claude/scripts` after any upgrade whose pre-flight listed `.claude/scripts/package.json` or `package-lock.json` as changed, and whenever `.claude/scripts/node_modules` is missing (needed for `/ask-gpt`, `/ask-gemini`, `/review-browser`).
2. If setup cleaned toolkit dependencies out of the root `package.json` (an install from the v4.2 era, before they moved into `.claude/scripts/`), run `npm install` at the project root as well. Setup does not touch `package-lock.json`, so the lock file keeps listing those dependencies until a reinstall rewrites it. The pre-clean `package.json` is in the backup folder.
3. Run `/index` if `CODEBASE_MAP.md` is missing or the upgrade just removed `INDEX.md`.
4. If the user's `CLAUDE.md` still says "report first" or carries a "CRITICAL RULES" block from an older version, tell them to retire that wording: the loop is auto by default from 6.0.0, and "report only" is a per-run phrase now.
5. Permission entries in a project-level `.claude/settings.json` are the user's to clean; setup never touches that file.

**Migrating from the old CLAUDE.md (pre-split):** If the user's `CLAUDE.md` contains toolkit rules (workflow, slash commands table, permissions table, git workflow, subagent strategy), those rules now live in `.claude/rules/toolkit.md` and are auto-loaded. The user should:
1. Get the new `toolkit.md`: on the plugin, run `tk:setup` (Step 1b), which writes it when it is missing; on a copy-install, re-run the Step 1c command
2. Edit their `CLAUDE.md` to keep only project-specific info (About This Project, Who I Am, My Preferences)
3. Remove the toolkit sections from their `CLAUDE.md` - they're now managed automatically

If the user wants a completely fresh `CLAUDE.md` template, they can delete theirs and rerun setup.

**What's new in v8.0.23:** A patch on top of v8.0.22 (#293, #300, #309, #310, #311, #312). A new plugin hook, the apostrophe check, blocks a Bash command whose single-quoted text an apostrophe cuts and names the spot, and Claude rewrites the command to pass the text in a file; text in double quotes, comments and here-documents is left alone, and if the check crashes or hangs the command runs. When `tk:create-plan` checks a new plan, it warns about a test line whose stated failure leaves out the test tool's failure word (`FAIL`, `FAILED`, `not ok` or a cross mark) or expects the case's name straight after that word; the safe shape is `(?:FAIL|not ok)[^\n]*<name>`, and a warning never stops a step. The plan check's output gains a third list, `warnings`, beside the unchanged `problems` and `missingPaths`. The push guard reads a folder in single quotes, or in double quotes with no `$`, backtick or backslash inside, so a project whose folder path holds a space can push. A reviewer's prose line beside its findings is set aside instead of stopping the review's merge step, and a line naming something the reviewer could not check goes under "What I could not check". A must-check finding on the review page closes only on a review of the plan it came from. TROUBLESHOOTING.md covers a stage garbled by a compression. To update: `claude plugin marketplace update llm-peer-review`, then `claude plugin update tk@llm-peer-review`, restart Claude Code; no setup step, no new permission rows and no new upgrade checks. To switch the apostrophe check off, run `export TK_QUOTE_GUARD=off` and start Claude Code from that terminal. Other editors: re-run `setup.sh` or `setup.ps1`, which brings the changed commands, loop rules and scripts; the apostrophe check is a Claude Code hook, so a copy-install has none. Details in CHANGELOG.md.

**What was new in v8.0.22:** A patch on top of v8.0.21 (#306, #307). The folder guard stops a `cd` out of the project at the command that makes it: it reads every `cd` in a Bash command, wherever one starts a command, and stops a move to any folder other than the project folder or the top folder of a git working copy such as a worktree, naming the folder and telling Claude to use it in the command's own paths instead, so Claude's shell never leaves. A `cd` to the project folder, to a worktree's top folder, or through `$CLAUDE_PROJECT_DIR` still runs, and a helper agent's `cd` is left alone. To update: `claude plugin marketplace update llm-peer-review`, then `claude plugin update tk@llm-peer-review`, restart Claude Code; no setup step, no new permission rows and no new upgrade checks. Other editors: the folder guard is a Claude Code hook, so a copy-install has none. Details in CHANGELOG.md.

**What was new in v8.0.21:** A patch on top of v8.0.20 (#303, #304, #305). `tk:document` no longer refreshes the codebase map. `tk:merge` asks once at its close whether to refresh it, when something landed, the project folder is on main, local main holds what landed, and the map is missing or 10 or more commits behind; `tk:explore`, `tk:create-plan` and `tk:pair-debug` still refresh it at their start, and `tk:upgrade` at its close. The upgrade's check that a project's own reviewer and judge agents carry no file-editing tools (C-5) runs on every upgrade, and two checks now run once per project: whether each of the project's own agents says what shape its answer takes (C-4), and the suggestion that git keep both sides when two branches each add a lesson (C-18). A project that began on 7.0.0 or later gets C-4 on its next upgrade, and one that began on 8.0.0 or later also gets C-18. To update: `claude plugin marketplace update llm-peer-review`, then `claude plugin update tk@llm-peer-review`, restart Claude Code, then `tk:upgrade` in each project's main copy; no setup step and no new permission rows. Other editors: re-run `setup.sh` or `setup.ps1`, which brings the changed commands and loop rules. Details in CHANGELOG.md.

**Older releases**, back to v6.0.0, are described in [CHANGELOG.md](CHANGELOG.md). If the user is upgrading from v5.x or earlier, read the v6.0.0 section there first: it is the release that changed behavior.

---

### Step 2: Install dependencies (optional)

**On the plugin** the runtime packages are installed with the plugin; the only thing left is the Chromium binary for `/tk:review-browser`: `npx --prefix ~/.claude/plugins/data/tk-llm-peer-review/current playwright-core install chromium` (plus `sudo npx playwright-core install-deps chromium` on Linux and WSL). Skip the rest of this step.

**On a copy-install** all toolkit runtime packages live inside `.claude/scripts/` so they don't pollute the user's root `package.json`. One install covers both feature groups:

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

**On either install** the scripts look up each key in this order, first value wins: a real environment variable, then the project's own `.env.local` (searched from the working folder up to the git root), then `~/.claude/plugins/.env.local` (one file for every project on the machine). Only the toolkit's own key and model variables are read from these files; any other line is ignored. Tell the user to put their keys in either file (the project `.env.local` can be created from the template below) or to export them; `API-KEYS.md` has the details. Do NOT fill in keys yourself.

**On a copy-install,** only needed if the user installed dependencies in Step 2:

```bash
cp "TARGET_PROJECT_PATH/.env.local.example" "TARGET_PROJECT_PATH/.env.local"
```

Tell the user to open `.env.local` and paste their API keys:
- **OPENAI_API_KEY** - from https://platform.openai.com/api-keys
- **GEMINI_API_KEY** - from https://aistudio.google.com/apikey
- **FAL_KEY** (optional) - from https://fal.ai/dashboard/keys, only for video generation and matting in the design workflow; without it the workflow hands the user a prompt to run elsewhere

Do NOT fill in API keys yourself. The user must do this manually.

### Step 4: Customize CLAUDE.md

If `CLAUDE.md` was newly created (not skipped), tell the user they should edit it to describe their project. The sections to update:

- **"About This Project"** - describe their project, tech stack, what it does
- **"Who I Am"** - describe themselves or their team
- **"My Preferences"** - add project-specific rules or coding conventions

The short toolkit rules are in `.claude/rules/toolkit.md` (auto-loaded, seeded by the toolkit - no need to edit); the full manual is the plugin's `toolkit-reference` fragment.

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

The user types `/explore` (on the Claude Code plugin every command above takes the `tk:` prefix, so `/tk:explore`) and approves the plan; the rest chain automatically (rule M14 in the toolkit's `hitl-stages` fragment). Saying "no chaining" on any run stops after that stage. The AI debates are never chained into - the user starts one deliberately.

On any install or update, `/audit-html` (`/tk:audit-html` on the plugin) can scan the user's own markdown for files that would benefit from an HTML view (report-only). Toolkit outputs already render HTML automatically.

</reference>

---

## Troubleshooting

<reference>

Every install and update failure and its fix is in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md): a command not found after an install, `tk:setup` exiting 3, the locally modified file gate, a `bad interpreter` error, a debate key not found, and the rest. Two more that only an agent install runs into:

- **"Permission denied"** - Ensure you have write access to the target project directory
- **Commands exist but don't appear in the editor** - Make sure the editor workspace root is the project folder that contains `.claude/`, not a parent directory

</reference>
