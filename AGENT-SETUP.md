# AI Agent Setup Instructions (v8.0.12)

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

**On the plugin:** run `claude plugin marketplace update llm-peer-review`, then `claude plugin update tk@llm-peer-review` as a separate command (add `--scope project` to the second for a plugin installed for one project only; `claude plugin update` alone does not fetch the marketplace, so it would not see a new release), restart or `/reload-plugins` (until a session starts on the new release, the stable `current` link under `~/.claude/plugins/data/tk-llm-peer-review/` still points at the previous one; the session-start hook moves it, and only a session start fires it, which a restart does and a reload in a running session does not), then invoke the `tk:upgrade` skill in every project on the plugin (the session notice asks for it in each project that is behind; a project with nothing behind is told so in one line). It audits the project's own `.claude/` files and `CLAUDE.md`, plus `.claude/settings.local.json`, `.gitignore`, `.gitattributes`, `artifacts/README.md`, and a migration record git still tracks, against the conventions that changed since the project's last audited version (`docs/CONVENTIONS.md`); ten of its checks run on every upgrade whatever version the project came from, and `docs/CONVENTIONS.md` lists them; C-15 and C-16 edit files the toolkit seeded once, so their fixes wait for the batch page's tick. Findings go through the normal M2 audit and auto-fix loop, and it stops once to ask before editing any prompt file. The update itself never touches the project.

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

**What's new in v8.0.12:** A patch on top of v8.0.11 (#271). Anything the toolkit writes for you that names a rule or finding by code (M3, C-21, R5) now says in plain words what the code is and what it means for you the first time it appears, with the code kept in brackets for lookup; file names, hashes and code terms stay in the receipt rows. The same sentence sits in the always-on rules file, the manual and the review skills, so the copies do not drift; a page that interrupts you decodes every code it names, and a review's digest line carries the plain words after its verdict, with the handoff to `tk:document` refusing a line that lacks them or carries a code term. The wider problem, explanations written in the toolkit's own vocabulary, is #276 and follows separately. To update: `claude plugin marketplace update llm-peer-review`, then `claude plugin update tk@llm-peer-review`, restart Claude Code, then `tk:upgrade` in each project (the rules seed changed, so it offers the merge); no new permission rows. Other editors: re-run `setup.sh` or `setup.ps1`. Details in CHANGELOG.md.

**What was new in v8.0.11:** A patch on top of v8.0.10 (#275, with the #222 and #246 records). `tk:explore`'s closing summary names who and what else the change reaches, in three fixed items: other installs of the code, other sessions and unreleased work in the same repo, and what you get back when a step ends and after a finding. The handoff to `tk:create-plan` refuses a summary without the section and asks for an item left blank or answered with a bare "none"; the plan carries the same items, and the plan critic checks the plan against them. The Jev shadow test (#222) and the #246 lab are recorded in `model-routing.md` with their numbers, and nothing in the loop changes from them. The review of the change fixed eleven findings, the one that mattered a gloss that read the third item as the product's user instead of the person running the loop. To update: `claude plugin marketplace update llm-peer-review`, then `claude plugin update tk@llm-peer-review`, restart Claude Code; no new permission rows and no new upgrade checks. Other editors: re-run `setup.sh` or `setup.ps1`. Details in CHANGELOG.md.

**What was new in v8.0.10:** A patch on top of v8.0.9 (#272). The verify mode prints what to run next, and the M3 rule says run what it prints instead of listing the calls (the rule 814 to 432 words, the verifier agent 1,124 to 376). Each stage handoff is decided by a script that reads the files on disk, `session-init.js --chain explore|execute|review`, which refuses a missing or shapeless input instead of passing it, and `tk:explore` writes its closing summary to `reports/explore/` for the plan critic to read. The review of the change fixed eight findings, among them quoted paths in the printed commands and a stop on a failed handoff check. To update: `claude plugin marketplace update llm-peer-review`, then `claude plugin update tk@llm-peer-review`, restart Claude Code, then `tk:upgrade` in each project; no new permission rows. Other editors: re-run `setup.sh` or `setup.ps1`. Details in CHANGELOG.md.

**Older releases:** v8.0.9 (the fix loop's re-verify round runs through one script mode that records rounds, verdicts and checkpoints, and C-21 points a project's own loop command at it), v8.0.8 (your own questions and labels for `tk:create-issue`, a cycle page per branch, and a worktree's records brought home on every `tk:document` run), v8.0.7 (a hook runs the pre-push check before any push Claude makes, the review loads its rules per phase, a doc that disagrees with the code becomes a finding, a worktree's records come home, and `tk:cloud` runs a cloud session), v8.0.6 (`tk:merge` names what a landing deletes and waits for the host; `tk:upgrade` reads the release notes against your project; `tk:review` checks your seam files), v8.0.5 (`tk:index` refreshes the codebase map instead of rebuilding it), v8.0.4 (four toolkit steps no longer stop a default-mode session for approval, and the usual test time comes down only after two fast runs in a row), v8.0.3 (the cycle page shows where the time went, the full test step keeps its own cost and skips a run on unchanged code, and Claude says what is coming before a long wait), v8.0.2 (`tk:package-review` is removed, because the debates run that review), v8.0.1 (Claude checks a claim at its source before stating it, the push guard stops blocking on a settings change carried in from main, and each branch gets its own review page), v8.0.0 (two removals promised in 7.0, the generic `review-finder` agent and sentence-shaped receipt expects; `tk:merge`, check lines per plan step, and the loop rules split across `hitl-loop.md` and `hitl-stages.md`), v7.6.5 (worktree detection stops calling a subfolder of the main copy a worktree, and `tk:index` reads the oversized chunks from its scanner), v7.6.4 (the checks runner runs exactly the words its guard judged, and refuses more ways to read a file outside the project), v7.6.3 (the guarded checks runner, rule M16, and the project test step in `.claude/toolkit/checks.json`), v7.6.2 (the standing review page resolves only findings on files the run reviewed, and the correction ledger captures the message typed after an interrupt), v7.6.1 (three fixes from one downstream upgrade run: the C-9 finding names the harm a missing push row carries, the merge helper reads the folder it is handed, and the seeded extension README defines its terms), v7.6.0 (two upgrade checks on every run, C-15 for seeded blocks and C-16 for the lessons index, plus the do-not-report seam and the review merge helper), v7.5.1 (an upgrade check that a project's own agents and the toolkit helpers its commands call run on the right model), v7.5.0 (commands load about 11% fewer words, and each cycle picks how its helpers run), v7.4.3 (the loop's judges return gaps, not grades, and a blind side-by-side judge decides each design round), v7.4.2 (setup and upgrade name the plugin update steps when the installed plugin is behind and a run changes nothing), v7.4.1 (a review that could not finish stops and pages you, pushes that delete always ask, the push check reports more of what it cannot read), v7.4.0 (project extension seams: five optional files in `.claude/toolkit/`), v7.3.1 (follow-ups: permission rows for every plugin script, force pushes always ask), v7.3.0 (a regression audit of everything from v6.3.3 to v7.2.0), v7.2.0 (the chained review sees committed work again, settings backups, repair checks on every upgrade, rollback steps), v7.1.0 (safe distribution: tag-pinned installs, the release gate, and version notices), v7.0.1 (the tripwire and a mail client's mangled links), v7.0.0 (the toolkit as a Claude Code plugin, typed finder agents, and the upgrade audit), v6.3.3 (six credential formats for the pre-push tripwire), v6.3.2 (the standing cycle page), v6.3.1 (the receipt files and the standing review page after the fix loop), v6.3.0 (what a review finding says, and the standing review page), v6.2.0 (the design workflow), v6.1.1 (a plan-shell fix), v6.1.0 (the correction ledger, the hosted page as the primary viewport, installer parity) and v6.0.0 (the auto loop itself) are described in [CHANGELOG.md](CHANGELOG.md). If the user is upgrading from v5.x or earlier, read the v6.0.0 section there first: it is the release that changed behavior.

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
