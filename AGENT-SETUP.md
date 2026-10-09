# AI Agent Setup Instructions (v7.6.2)

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

This copies:
- `.claude/commands/` (all slash command definitions)
- `.claude/skills/` (all skill definitions - review specialists, learning-opportunity, project-context - plus the shared reference files and the prebuilt HTML shells in `shared/shells/`)
- `.claude/agents/` (every worker definition - the review finders, the judges and critics that audit their work, the index mapper, and the correction extractor - carrying their model, effort, and tool settings - always updated)
- `.claude/rules/toolkit.md` (the short toolkit rules seed, version-stamped - always updated; the long manual is `.claude/skills/shared/toolkit-reference.md` and the HTML output rules are `.claude/skills/shared/html-outputs.md`, both copied with the shared files and stamped)
- `.claude/settings.local.json` (permission config - preserved if it already exists; new toolkit permissions are merged in on re-run)
- `.claude/scripts/generate-index.js` (codebase scanner used by `/index` to build `CODEBASE_MAP.md` - always updated)
- `.claude/scripts/session-init.js` (aggregates command-startup reads - map freshness, lessons index, plan statuses, worktree state - into one JSON; always updated)
- `.claude/scripts/pre-push-check.js` (the pre-push tripwire that scans every outgoing commit for secrets, never-push files, and shared-settings changes - always updated)
- `.claude/scripts/correction-ledger.js` (correction ledger capture and rollup helper behind `/document` and `/error-analysis` - always updated)
- `.claude/scripts/gen-media.js` (the design workflow's seed and media helper: seeds, images, video, matting behind the user's own keys - always updated)
- `.claude/scripts/render-html.js` and `.claude/scripts/open-artifact.sh` (HTML renderer + cross-platform artifact opener - always updated)
- `.claude/scripts/merge-findings.js` (the review's merge, sort and number pass: every runner writes the findings it collected to a file and runs it - always updated)
- `.claude/scripts/` (ask-gpt.js, env-local.js, ask-gemini.js, browse.js, and a quarantined `package.json` + `package-lock.json` - runtime scripts and their deps live here so the project's root `package.json` stays untouched)
- `artifacts/README.md` (scaffold for the gitignored `artifacts/html/` output directory)
- `CLAUDE.md` (project instructions template - skipped if it already exists)
- `LESSONS.md` (learning log index - skipped if it already exists; read at session start so past lessons feed back into new work)
- `LESSONS-detail.md` (full lesson write-ups behind the index - seeded only on a fresh install, preserved on upgrade)
- `DESIGN-PROFILE.md` (the repo's design answers - seeded once from `.claude/skills/shared/design-profile-template.md`, skipped if it already exists)
- `.env.local.example` (API key template)
- `.gitignore` (merged with existing - new toolkit entries added, custom entries preserved)
- `.gitattributes` (enforces LF line endings for shell scripts)
- `VERSION` (toolkit version number)

Setup also writes `.claude/.toolkit-manifest.json` at the end of every real run: the hash of every managed file it just wrote. That is setup's own bookkeeping, not a user file. Do not edit it, do not tell the user to, and do not delete it - it is what lets the next run tell a toolkit update apart from the user's own edit.

Note: Setup scripts (setup.sh, setup.ps1, install-alias.*) stay in the toolkit repo and are not copied to target projects.

### Updating an Existing Project

**On the plugin:** run `claude plugin marketplace update llm-peer-review`, then `claude plugin update tk@llm-peer-review` as a separate command (add `--scope project` to the second for a plugin installed for one project only; `claude plugin update` alone does not fetch the marketplace, so it would not see a new release), restart or `/reload-plugins` (until a session starts on the new release, the stable `current` link under `~/.claude/plugins/data/tk-llm-peer-review/` still points at the previous one; the session-start hook moves it, and only a session start fires it, which a restart does and a reload in a running session does not), then invoke the `tk:upgrade` skill in every project on the plugin (the session notice asks for it in each project that is behind; a project with nothing behind is told so in one line). It audits the project's own `.claude/` files and `CLAUDE.md`, plus `.claude/settings.local.json`, `.gitignore`, `.gitattributes`, `artifacts/README.md`, and a migration record git still tracks, against the conventions that changed since the project's last audited version (`docs/CONVENTIONS.md`); the rules-file check (C-7), the permission-row, seeded-line and `tk:` name checks (C-9 to C-11), the review-kind row check (C-12), the helper-model check (C-14), the seeded-block check (C-15) and the lessons-index check (C-16) run on every upgrade; C-15 and C-16 edit files the toolkit seeded once, so their fixes wait for the batch page's tick. Findings go through the normal M2 audit and auto-fix loop, and it stops once to ask before editing any prompt file. The update itself never touches the project.

**Going back to an earlier release:** follow "Going back to an earlier release" in docs/INSTALL.md step by step: in each project, while the newer release is still installed, run `node ~/.claude/plugins/data/tk-llm-peer-review/current/scripts/upgrade-audit.js --rollback-to <version>` and commit `.claude/.toolkit-state.json`; then uninstall with `--keep-data`, remove the marketplace, add it pinned to the release tag (`mayankmankhand/llm-peer-review@v<version>`), and install again. Run the uninstall, marketplace and install commands from the user's home folder, not from the project: run inside a project, they also delete the toolkit's marketplace and plugin entries from that project's `.claude/settings.json` (for a project-scope install, run them in the project and then restore that file with `git checkout -- .claude/settings.json`). Relay each command's output to the user.

**A project cloned from a teammate:** a clone does not carry the plugin or the local permissions. Run `claude plugin marketplace add mayankmankhand/llm-peer-review`, then `claude plugin install tk@llm-peer-review`, restart, and run `tk:setup` in the project (Step 1b).

**Migrating a copy-install to the plugin:** install the plugin (Step 1), then run `tk:setup` in the project (Step 1b). It classifies every managed file against the installer's manifest, stops to ask about locally modified ones, backs up and removes the toolkit's files, keeps every custom file, seeds, merges settings (backing up both settings files first), records the migration, and hands off to `tk:upgrade`. An install with no manifest is recognized too (`VERSION` beside `.claude/commands/review.md`, or an early toolkit stamp in `.claude/rules/toolkit.md`); its files are of unknown provenance, so the run exits 3 until the user approves a rerun with `--force`. Helper scripts an early installer copied into the project's root `scripts/` folder are removed too (backed up first; every other file there is left alone), and a `VERSION` file that is the project's own is kept. The undo is the one `Undo:` line setup prints at the end of its report, built from what that run did; relay it to the user word for word. Followed left to right it checks out the tracked files it names, then deletes the files the run created (and its new folders, if empty), then copies the listed files back from the backup folder it names (or says which to restore by hand), then removes that folder. Do not substitute a generic `git checkout` of `.claude`: that leaves the created files in place and skips what only the backup holds. Setup never reads or moves the project's `.env.local`, and it does not need to: the plugin's scripts still read it (see Step 3 for the lookup order), so a project that kept its keys there keeps working.

**On a copy-install (other editors):** **run the same Step 1c command again**. It's safe to rerun.

**What gets updated** (always overwritten - manifest-tracked, and backed up first when the copy on disk differs):
- `.claude/commands/` - all slash command definitions
- `.claude/agents/` - every worker definition (review finders, judges and critics, index mapper, correction extractor)
- `.claude/skills/` - all skill definitions (review specialists, learning-opportunity, project-context, shared references, and the prebuilt HTML shells in `shared/shells/`)
- `.claude/rules/toolkit.md`, `.claude/skills/shared/toolkit-reference.md`, and `.claude/skills/shared/html-outputs.md` - the three version-stamped files
- `.claude/scripts/generate-index.js` - codebase scanner used by `/index`
- `.claude/scripts/session-init.js` - command-startup aggregator (map freshness, lessons, plan statuses, worktree state) for `/explore`, `/create-plan`, `/pair-debug`, `/execute`
- `.claude/scripts/render-html.js` and `.claude/scripts/open-artifact.sh` - HTML renderer + artifact opener
- `.claude/scripts/pre-push-check.js`, `.claude/scripts/correction-ledger.js`, `.claude/scripts/gen-media.js`, and `.claude/scripts/merge-findings.js` - the pre-push tripwire, the correction ledger helper, the design workflow's media helper, and the review's merge helper
- `.claude/scripts/ask-gpt.js`, `.claude/scripts/env-local.js`, `.claude/scripts/ask-gemini.js`, `.claude/scripts/browse.js`, and `.claude/scripts/package.json` + `package-lock.json` - runtime scripts and their quarantined deps
- `artifacts/README.md`, `.env.local.example`, `.gitattributes`, `VERSION` - a project that keeps its own root `VERSION` file or its own `.gitattributes` gets it replaced (backed up first), so say so if you see one
- `.claude/.toolkit-manifest.json` - regenerated by setup on every real run; not a user file

**Merged in place** (never overwritten):
- `.gitignore` - missing toolkit lines appended, comments skipped, no duplicates
- `.claude/settings.local.json` - only the permissions list is merged (missing template entries added, known-stale entries removed); every other top-level setting in that file is left alone. A project-level `.claude/settings.json` is never touched.

**What's preserved** (skipped if it already exists):
- `CLAUDE.md` - the user's project-specific instructions
- `LESSONS.md` - the user's learning log (index)
- `LESSONS-detail.md` - the full lesson write-ups behind the index (present once the index/detail split exists)
- `DESIGN-PROFILE.md` - the repo's design answers (seeded once from the installed template)
- `.claude/settings.local.json` - the user's permission config (preserved, with new toolkit permissions merged in on re-run)

**Migrations that run when needed** (each backed up first): legacy command files that became skills (v3.5), `.claude/plans/` to `plans/` (v4.0), the old top-level `scripts/` location to `.claude/scripts/` plus toolkit deps stripped from the root `package.json`, and the legacy `INDEX.md` removed (replaced by `CODEBASE_MAP.md`, which `/index` generates).

**The gate on locally modified files.** Installs made with v5.5.0 or later carry `.claude/.toolkit-manifest.json`, and setup compares every managed file against it. A managed file the user edited stops the run: an interactive terminal prompts, a non-interactive run (you, most likely) exits 1 listing the files. Do not add the force flag on your own. Show the user that list, get a yes, then re-run the Step 1c command with the force flag inside its quotes, right after the target path: `bash "$TEMP_DIR/scripts/setup/setup.sh" "TARGET_PROJECT_PATH" --force` in bash, or `-Force` right after `` -Target `"TARGET_PROJECT_PATH`" `` in PowerShell. A flag added after the one-liner's closing quote goes to `bash -c`, not to setup. Every replaced file is backed up first. A file the user created themselves at a path the toolkit now ships under the same name counts as locally modified too, so it gates the run instead of being silently replaced.

**Pre-manifest installs (before v5.5.0).** No manifest means no gate: differing managed files show as `[differs, provenance unknown]` in the pre-flight report and are replaced, with a backup, without a prompt. So for these, run the dry run first - `--dry-run` after the target path in bash, `-DryRun` in PowerShell, placed the same way as the force flag - show the user the "provenance unknown" list, and after the real run copy anything they had customized out of the backup folder.

**The backup folder, and how to undo.** `.toolkit-backup-<YYYYMMDD-HHMMSS>-<pid>` at the project root, created only when something is replaced or deleted (an identical re-run creates none). It holds every replaced managed file at its original relative path, files a migration removed, the root `package.json` when it was cleaned, and the previous `.claude/.toolkit-manifest.json` plus the pre-merge `.gitignore` and `.claude/settings.local.json`. To undo an upgrade, copy files back from the folder to the same relative paths, including the manifest. Files the upgrade added are not recorded anywhere, so to remove those, compare `.claude/` against the restored manifest. Setup can be re-run later. A second identical run writes nothing new, adds no duplicate lines, and creates no backup folder.

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

**What's new in v7.6.2:** A patch on top of v7.6.1 (#219, #220). The loop runs as before. The standing review page resolves an old finding only when the run reviewed its file: `tk:review` sends `reviewedFiles` from its saved scope, and a finding on a file the run did not review is carried forward, marked `carried`. The seeded must-check findings count as the `plan` lens, so they can resolve. The correction ledger's pre-filter captures the message typed after an interrupt instead of the interrupt marker, across a session boundary within ten minutes, and `tk:document` says one line when an interrupt had no follow-up it could read. `--no-abs` also strips a nested worktree's root. To update: `claude plugin marketplace update llm-peer-review`, then `claude plugin update tk@llm-peer-review`, restart Claude Code, then `tk:upgrade` in each project; no new permission rows. A project's own command that renders the standing review page with `lenses` should also pass `reviewedFiles`; without it the page behaves as before and prints a note on stderr.

**What was new in v7.6.1:** A patch on top of v7.6.0 (#215, #216, #217). The loop runs as before. Three fixes from one downstream upgrade run. `tk:upgrade`'s missing-ask-row finding (C-9) now names the harm the missing rows carry: a force push or another push that deletes or rewrites remote history when a push-family row is missing, and a conditional sentence otherwise, so the audit's skeptic no longer refutes a true finding on its wording. The merge sentence at nine prompt sites says "on that file", and `merge-findings.js` handed the folder reads the `findings.jsonl` inside it. The seeded `.claude/toolkit/README.md` defines "seed" and "preload" where they first appear and says that a project's `severity-anchors.md` cannot lower the toolkit's own floors. To update: `claude plugin marketplace update llm-peer-review`, then `claude plugin update tk@llm-peer-review`, restart Claude Code, then `tk:upgrade` in each project; no new permission rows; C-15 offers the three changed README paragraphs, each applied only on the user's tick.

**What was new in v7.6.0:** A minor release on top of v7.5.1. The loop runs as before. `tk:upgrade` has two new checks that run on every upgrade. C-15 reads the files setup seeded once (`CLAUDE.md`, `LESSONS.md`, `DESIGN-PROFILE.md`, `.claude/toolkit/README.md`) and reports a block that is still an older seed's text, with the current seed's text as the fix, plus a `${CLAUDE_PLUGIN_ROOT}` in a file of the project's own (the fix is the stable `~/.claude/plugins/data/tk-llm-peer-review/current` path). C-16 reads `LESSONS.md` and reports an index bullet beyond one sentence while `LESSONS-detail.md` is absent, and a lesson inherited from the toolkit's own log. Both edit files the toolkit seeded once, so every one of their fixes waits for the user's tick on the batch page. A sixth optional seam, `.claude/toolkit/do-not-report.md`, lists security finding categories that are noise in the project. A dispatched finder may return `NOT CHECKED: <one sentence>` beside its findings; `tk:review` copies it under "What I could not check" and never treats it as a finding or a parse failure. `tk:review` dispatches Browser QA when a server answers or the project has a `dev` or `start` script the finder can start, and `browse.js --actions '<json>'` takes the actions as one argument, with no apostrophe inside. The bundled prompt audit behind this release's text pass raised four follow-up issues, and they ship here too, as six changes: `generate-index.js --finalize` applies the map's size cap itself (tree to depth 3, then 2, then Gotchas, Conventions and the Navigation Guide, never the Module Guide) and reports what it trimmed; `merge-findings.js` merges, sorts and numbers the findings every review runner collects, called on a file the runner wrote; `tk:upgrade` records the findings its audit refuted in the project's git directory and skips them on later upgrades while their lines are unchanged; `tk:document` routes an upgrade's record to `CHANGELOG.md` when the project has one and nowhere otherwise, never `CLAUDE.md`; the seed's ask list carries `Bash(npm install *)` again; and 44 wording sites were tidied. To update: `claude plugin marketplace update llm-peer-review`, then `claude plugin update tk@llm-peer-review`, restart Claude Code, then `tk:upgrade` in each project; five new permission rows (four allow rows for `merge-findings.js`, at the plugin cache path and the stable `current` path, each with and without arguments, and the ask row `Bash(npm install *)`), which `tk:upgrade` reports when missing and a rerun of `tk:setup` merges.

**Older releases:** v7.5.1 (an upgrade check that a project's own agents and the toolkit helpers its commands call run on the right model), v7.5.0 (commands load about 11% fewer words, and each cycle picks how its helpers run), v7.4.3 (the loop's judges return gaps, not grades, and a blind side-by-side judge decides each design round), v7.4.2 (setup and upgrade name the plugin update steps when the installed plugin is behind and a run changes nothing), v7.4.1 (a review that could not finish stops and pages you, pushes that delete always ask, the push check reports more of what it cannot read), v7.4.0 (project extension seams: five optional files in `.claude/toolkit/`), v7.3.1 (follow-ups: permission rows for every plugin script, force pushes always ask), v7.3.0 (a regression audit of everything from v6.3.3 to v7.2.0), v7.2.0 (the chained review sees committed work again, settings backups, repair checks on every upgrade, rollback steps), v7.1.0 (safe distribution: tag-pinned installs, the release gate, and version notices), v7.0.1 (the tripwire and a mail client's mangled links), v7.0.0 (the toolkit as a Claude Code plugin, typed finder agents, and the upgrade audit), v6.3.3 (six credential formats for the pre-push tripwire), v6.3.2 (the standing cycle page), v6.3.1 (the receipt files and the standing review page after the fix loop), v6.3.0 (what a review finding says, and the standing review page), v6.2.0 (the design workflow), v6.1.1 (a plan-shell fix), v6.1.0 (the correction ledger, the hosted page as the primary viewport, installer parity) and v6.0.0 (the auto loop itself) are described in [CHANGELOG.md](CHANGELOG.md). If the user is upgrading from v5.x or earlier, read the v6.0.0 section there first: it is the release that changed behavior.

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

The user types `/explore` (on the Claude Code plugin every command above takes the `tk:` prefix, so `/tk:explore`) and approves the plan; the rest chain automatically (rule M14 in the toolkit's `hitl-loop` fragment). Saying "no chaining" on any run stops after that stage. The AI debates are never chained into - the user starts one deliberately.

On any install or update, `/audit-html` (`/tk:audit-html` on the plugin) can scan the user's own markdown for files that would benefit from an HTML view (report-only). Toolkit outputs already render HTML automatically.

</reference>

---

## Troubleshooting

<reference>

- **"setup.sh: command not found"** - Make sure to run the full `bash -c '...'` command from Step 1c, not just `setup.sh` on its own
- **"target directory does not exist"** - Create the project folder first: `mkdir -p /path/to/project`
- **"Unknown command" for `/tk:...` right after a plugin install or update, or an agent type such as `tk:review-code-finder` not found** - Run `/reload-plugins` or restart Claude Code
- **`tk:setup` exits 3** - It needs a decision (dirty tree, a migration outside a git repository, locally modified toolkit files, unknown provenance, a settings file it cannot read) and touched nothing; show the user its list and rerun with `--force` only when they say yes
- **A toolkit command asks for approval before one of its own scripts, in default permission mode** - A command's own grant for its scripts ends at the user's next message, and a stage the loop starts on its own gets none, so `tk:setup` writes a permission row for every plugin script into `.claude/settings.local.json`. A prompt for a toolkit script means those rows are missing: run `tk:setup` again in the project and relay its report (it adds the missing rows, or names the ones it holds back because the user deleted them before). Saving a review receipt's output to a file still asks; tell the user to approve it.
- **Commands don't show up in Cursor** - Make sure `.claude/commands/` exists in the project root with `.md` files inside (copy-install only)
- **`/ask-gpt` or `/ask-gemini` fails** - On the plugin, a key is read from the environment, then the project's `.env.local` (from the working folder up to the git root), then `~/.claude/plugins/.env.local`, and only the toolkit's own key and model variables are read from those files, so check that one of the three holds a valid key under its exact name; on a copy-install, check that `npm install` was run and `.env.local` has valid API keys
- **"Permission denied"** - Ensure you have write access to the target project directory
- **Commands exist but don't appear in the editor** - Make sure the editor workspace root is the project folder that contains `.claude/`, not a parent directory
- **Script errors with `/bin/bash^M` or "bad interpreter"** - Line-ending issue. Delete the folder and clone fresh, or run `git add --renormalize . && git checkout -- .`
- **Setup command fails partway through** - Safe to rerun. Leftover `/tmp/tmp.*` folders are harmless
- **Commands seem outdated or missing sections** - Delete any toolkit command files from `~/.claude/commands/`. Global copies override project commands and cause stale behavior
- **Setup exits 1 with a list of "locally modified" files** - That is the manifest gate (see "Updating an Existing Project"). Show the user the list; re-run with the force flag only after they say yes

</reference>
