# AI Agent Setup Instructions (v7.0.1)

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
- `node` (required - it runs the toolkit's dependency-free helper scripts: HTML rendering via `render-html.js`, the `/index` codebase scanner, and the session-startup aggregator)
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

(That `current` link is created when a Claude Code session starts; before the first session, use the versioned cache path `~/.claude/plugins/cache/llm-peer-review/tk/<version>/scripts/setup-project.js`.) Exit code 0 is done; 3 means it stopped before touching anything and printed what needs a human decision (a dirty git tree, locally modified toolkit files, or a copy-install of unknown provenance); rerun with `--force` only after the user decides.

On a fresh project it writes, when absent: `.claude/rules/toolkit.md` (the short, version-stamped rules seed), `CLAUDE.md`, `LESSONS.md`, `LESSONS-detail.md`, `DESIGN-PROFILE.md`, `.env.local.example`, `.gitattributes`, `artifacts/README.md`, `plans/`, and `artifacts/`; it line-merges `.gitignore`, key-merges the marketplace pointer into `.claude/settings.json` and the permission baseline into `.claude/settings.local.json`, and writes `.claude/.toolkit-state.json`. On a project that carried the copy-installed toolkit it migrates: see "Updating an Existing Project".

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
- `.claude/agents/` (all worker definitions - the review finder, index mapper, correction extractor, and design critic, carrying their model, effort, and tool settings - always updated)
- `.claude/rules/toolkit.md` (the short toolkit rules seed, version-stamped - always updated; the long manual is `.claude/skills/shared/toolkit-reference.md` and the HTML output rules are `.claude/skills/shared/html-outputs.md`, both copied with the shared files and stamped)
- `.claude/settings.local.json` (permission config - preserved if it already exists; new toolkit permissions are merged in on re-run)
- `.claude/scripts/generate-index.js` (codebase scanner used by `/index` to build `CODEBASE_MAP.md` - always updated)
- `.claude/scripts/session-init.js` (aggregates command-startup reads - map freshness, lessons index, plan statuses, worktree state - into one JSON; always updated)
- `.claude/scripts/pre-push-check.js` (the pre-push tripwire that scans every outgoing commit for secrets, never-push files, and shared-settings changes - always updated)
- `.claude/scripts/correction-ledger.js` (correction ledger capture and rollup helper behind `/document` and `/error-analysis` - always updated)
- `.claude/scripts/gen-media.js` (the design workflow's seed and media helper: seeds, images, video, matting behind the user's own keys - always updated)
- `.claude/scripts/render-html.js` and `.claude/scripts/open-artifact.sh` (HTML renderer + cross-platform artifact opener - always updated)
- `.claude/scripts/` (ask-gpt.js, ask-gemini.js, browse.js, and a quarantined `package.json` + `package-lock.json` - runtime scripts and their deps live here so the project's root `package.json` stays untouched, issue #91)
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

**On the plugin:** `claude plugin marketplace update llm-peer-review && claude plugin update tk@llm-peer-review`, restart or `/reload-plugins`, then invoke the `tk:upgrade` skill in each project that has files of its own under `.claude/` or a `CLAUDE.md` that mentions toolkit pieces. It audits those files against the conventions that changed since the project's last audited version (`docs/CONVENTIONS.md`), through the normal M2 audit and auto-fix loop, and stops once to ask before editing any prompt file. The update itself never touches the project.

**Migrating a copy-install to the plugin:** install the plugin (Step 1), then run `tk:setup` in the project (Step 1b). It classifies every managed file against the installer's manifest, stops to ask about locally modified ones, backs up and removes the toolkit's files, keeps every custom file, seeds, merges settings, records the migration, and hands off to `tk:upgrade`. The undo is `git checkout -- .claude VERSION .gitattributes` plus the backup folder it names. Setup never reads or moves the project's `.env.local`, and it does not need to: the plugin's scripts still read it (see Step 3 for the lookup order), so a project that kept its keys there keeps working.

**On a copy-install (other editors):** **run the same Step 1c command again**. It's safe to rerun.

**What gets updated** (always overwritten - manifest-tracked, and backed up first when the copy on disk differs):
- `.claude/commands/` - all slash command definitions
- `.claude/agents/` - all worker definitions (review finder, index mapper, correction extractor, design critic)
- `.claude/skills/` - all skill definitions (review specialists, learning-opportunity, project-context, shared references, and the prebuilt HTML shells in `shared/shells/`)
- `.claude/rules/toolkit.md`, `.claude/skills/shared/toolkit-reference.md`, and `.claude/skills/shared/html-outputs.md` - the three version-stamped files
- `.claude/scripts/generate-index.js` - codebase scanner used by `/index`
- `.claude/scripts/session-init.js` - command-startup aggregator (map freshness, lessons, plan statuses, worktree state) for `/explore`, `/create-plan`, `/pair-debug`, `/execute`
- `.claude/scripts/render-html.js` and `.claude/scripts/open-artifact.sh` - HTML renderer + artifact opener
- `.claude/scripts/pre-push-check.js`, `.claude/scripts/correction-ledger.js`, and `.claude/scripts/gen-media.js` - the pre-push tripwire, the correction ledger helper, and the design workflow's media helper
- `.claude/scripts/ask-gpt.js`, `.claude/scripts/ask-gemini.js`, `.claude/scripts/browse.js`, and `.claude/scripts/package.json` + `package-lock.json` - runtime scripts and their quarantined deps
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

**Migrations that run when needed** (each backed up first): legacy command files that became skills (v3.5), `.claude/plans/` to `plans/` (v4.0), the old top-level `scripts/` location to `.claude/scripts/` plus toolkit deps stripped from the root `package.json` (#91), and the legacy `INDEX.md` removed (replaced by `CODEBASE_MAP.md`, which `/index` generates).

**The gate on locally modified files.** Installs made with v5.5.0 or later carry `.claude/.toolkit-manifest.json`, and setup compares every managed file against it. A managed file the user edited stops the run: an interactive terminal prompts, a non-interactive run (you, most likely) exits 1 listing the files. Do not add the force flag on your own. Show the user that list, get a yes, then re-run with `--force` (bash) or `-Force` (PowerShell) placed exactly as the v5.5.0 block below describes; every replaced file is backed up first. A file the user created themselves at a path the toolkit now ships under the same name counts as locally modified too, so it gates the run instead of being silently replaced.

**Pre-manifest installs (before v5.5.0).** No manifest means no gate: differing managed files show as `[differs, provenance unknown]` in the pre-flight report and are replaced, with a backup, without a prompt. So for these, run the dry run first - `--dry-run` after the target path in bash, `-DryRun` in PowerShell, placed the same way as the force flag - show the user the "provenance unknown" list, and after the real run copy anything they had customized out of the backup folder.

**The backup folder, and how to undo.** `.toolkit-backup-<YYYYMMDD-HHMMSS>-<pid>` at the project root, created only when something is replaced or deleted (an identical re-run creates none). It holds every replaced managed file at its original relative path, files a migration removed, the root `package.json` when it was cleaned, and the previous `.claude/.toolkit-manifest.json` plus the pre-merge `.gitignore` and `.claude/settings.local.json`. To undo an upgrade, copy files back from the folder to the same relative paths, including the manifest. Files the upgrade added are not recorded anywhere, so to remove those, compare `.claude/` against the restored manifest. Setup can be re-run later. A second identical run writes nothing new, adds no duplicate lines, and creates no backup folder.

**After an upgrade, check five things:**
1. Run `npm install --prefix .claude/scripts` after any upgrade whose pre-flight listed `.claude/scripts/package.json` or `package-lock.json` as changed, and whenever `.claude/scripts/node_modules` is missing (needed for `/ask-gpt`, `/ask-gemini`, `/review-browser`).
2. If setup cleaned toolkit dependencies out of the root `package.json` (an install from the v4.2 era, before #91 moved them into `.claude/scripts/`), run `npm install` at the project root as well. Setup does not touch `package-lock.json`, so the lock file keeps listing those dependencies until a reinstall rewrites it. The pre-clean `package.json` is in the backup folder.
3. Run `/index` if `CODEBASE_MAP.md` is missing or the upgrade just removed `INDEX.md`.
4. If the user's `CLAUDE.md` still says "report first" or carries a "CRITICAL RULES" block from an older version, tell them to retire that wording: the loop is auto by default from 6.0.0, and "report only" is a per-run phrase now.
5. Permission entries in a project-level `.claude/settings.json` are the user's to clean; setup never touches that file.

**Migrating from the old CLAUDE.md (pre-split):** If the user's `CLAUDE.md` contains toolkit rules (workflow, slash commands table, permissions table, git workflow, subagent strategy), those rules now live in `.claude/rules/toolkit.md` and are auto-loaded. The user should:
1. Get the new `toolkit.md`: on the plugin, run `tk:setup` (Step 1b), which writes it when it is missing; on a copy-install, re-run the Step 1c command
2. Edit their `CLAUDE.md` to keep only project-specific info (About This Project, Who I Am, My Preferences)
3. Remove the toolkit sections from their `CLAUDE.md` - they're now managed automatically

If the user wants a completely fresh `CLAUDE.md` template, they can delete theirs and rerun setup.

**What's new in v7.0.1:** A patch on v7.0.0 (#168). The pre-push tripwire no longer blocks a push over a mail client's mangled `https://mailto:` or `tel:` link, while a real credential, including a username that only starts with those words, still blocks. The fixes made on `main` after the v7.0.0 tag reach existing plugin installs with this version. Nothing about setup changes: update the plugin, or re-run the copy-install setup to replace the script.

**What was new in v7.0.0:** The toolkit is a Claude Code plugin (#167). Install once per machine, seed each project with `tk:setup`, update with `claude plugin update` and then `tk:upgrade`, which audits the project's own commands, skills, agents, rules, and `CLAUDE.md` against the conventions that changed (`docs/CONVENTIONS.md`, C-1 to C-8) and fixes what drifted through the loop. Every review dispatch goes to a typed `review-<kind>-finder` agent that preloads its criteria, so nothing is pasted per dispatch; the M2 skeptics and M3 verifiers are typed `audit-skeptic` and `fix-verifier` agents with no edit tools; `/create-plan` scores each plan with a fresh-context `plan-critic`. The always-on rules file is a short seed; the manual and the HTML output rules moved into the plugin as shared fragments. The copy-install scripts keep working for other editors.

**What was new in v6.3.3:** A patch on v6.3.2 (#164). The M11 pre-push tripwire learns six credential formats it could not see: GitLab's `glpat-` personal access token and its five sibling token prefixes, npm access tokens, PyPI publish tokens, JSON Web Tokens, and a `.netrc` credential record; `.netrc` and `_netrc` join the never-push files. The tripwire also gains `scripts/test-pre-push-check.js`, 31 checks, having been the only runtime script with no test file. Nothing about setup changes; re-running it replaces the script.

**What was new in v6.3.2:** A patch on v6.3.1 (#163). The cycle summary `/document` renders is now one standing page per repository at `artifacts/html/cycle.html`, replaced each run and carrying a running log of earlier cycles; it leads with what changed and why rather than a file inventory, and may carry a diagram when the cycle has a flow worth drawing. The wrap guard five shells were missing now lives once in the shared tokens. Nothing about setup changes; re-running it picks up the renderer, the shells, the tokens, and the prompt files. Existing `document-*.html` files are inert and safe to delete.

**Older releases:** v6.3.1 (the receipt files and the standing review page after the fix loop), v6.3.0 (what a review finding says, and the standing review page), v6.2.0 (the design workflow), v6.1.1 (a plan-shell fix), v6.1.0 (the correction ledger, the hosted page as the primary viewport, installer parity) and v6.0.0 (the auto loop itself) are described in [CHANGELOG.md](CHANGELOG.md). If the user is upgrading from v5.x or earlier, read the v6.0.0 section there first: it is the release that changed behavior.

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

**On the plugin** the scripts look up each key in this order, first value wins: a real environment variable, then the project's own `.env.local` (searched from the working folder up to the git root), then `~/.claude/plugins/.env.local` (one file for every project on the machine). Only the toolkit's own key and model variables are read from these files; any other line is ignored. Tell the user to put their keys in either file (the project `.env.local` can be created from the template below) or to export them; `API-KEYS.md` has the details. Do NOT fill in keys yourself.

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

The user types `/explore` and approves the plan; the rest chain automatically (rule M14 in `.claude/skills/shared/hitl-loop.md`). Saying "no chaining" on any run stops after that stage. The AI debates are never chained into - the user starts one deliberately.

On any install or update, `/audit-html` can scan the user's own markdown for files that would benefit from an HTML view (report-only). Toolkit outputs already render HTML automatically.

</reference>

---

## Troubleshooting

<reference>

- **"setup.sh: command not found"** - Make sure to run the full `bash -c '...'` command from Step 1, not just `setup.sh` on its own
- **"target directory does not exist"** - Create the project folder first: `mkdir -p /path/to/project`
- **"Unknown command" for `/tk:...` right after a plugin install or update, or an agent type such as `tk:review-code-finder` not found** - Run `/reload-plugins` or restart Claude Code
- **`tk:setup` exits 3** - It needs a decision (dirty tree, locally modified toolkit files, unknown provenance) and touched nothing; show the user its list and rerun with `--force` only when they say yes
- **Commands don't show up in Cursor** - Make sure `.claude/commands/` exists in the project root with `.md` files inside (copy-install only)
- **`/ask-gpt` or `/ask-gemini` fails** - On the plugin, a key is read from the environment, then the project's `.env.local` (from the working folder up to the git root), then `~/.claude/plugins/.env.local`, and only the toolkit's own key and model variables are read from those files, so check that one of the three holds a valid key under its exact name; on a copy-install, check that `npm install` was run and `.env.local` has valid API keys
- **"Permission denied"** - Ensure you have write access to the target project directory
- **Commands exist but don't appear in the editor** - Make sure the editor workspace root is the project folder that contains `.claude/`, not a parent directory
- **Script errors with `/bin/bash^M` or "bad interpreter"** - Line-ending issue. Delete the folder and clone fresh, or run `git add --renormalize . && git checkout -- .`
- **Setup command fails partway through** - Safe to rerun. Leftover `/tmp/tmp.*` folders are harmless
- **Commands seem outdated or missing sections** - Delete any toolkit command files from `~/.claude/commands/`. Global copies override project commands and cause stale behavior
- **Setup exits 1 with a list of "locally modified" files** - That is the manifest gate (see "Updating an Existing Project"). Show the user the list; re-run with the force flag only after they say yes

</reference>
