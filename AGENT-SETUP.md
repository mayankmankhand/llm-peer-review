# AI Agent Setup Instructions (v5.4.0)

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

**What's new in v5.4.0:** Bounded, verifier-gated loops (#137). After re-running setup:
- After you approve review fixes ("fix it" on `/review` findings, or Yes/Partial on debate Recommended Actions), the fixes are re-verified instead of assumed done: mechanical checks re-run inline; judgment findings get one fresh subagent per round returning countable verdicts ("R3: FIXED" / "R3: NOT FIXED" plus a receipt). Max 2 rounds; anything new found mid-verification is report-only.
- `/execute` caps small-failure retries at 3 attempts per step, iterating against real test/build output; a plan's Verify step shares the same budget (no fresh allowance), and parallel step agents carry the bound in their prompts.
- `/ask-gpt` and `/ask-gemini` debates run up to 3 rounds: a countable convergence gate ends the debate after round 2 when the reviewer's "Still Discussing" and "New Observations" sections are both settled. The maximum never extends.
- `/index` retries a failed chunk once silently before asking you; oversized chunks skip the doomed retry; if every chunk fails, it stops and leaves the existing map untouched.

**What was new in v5.3.0:** Security review domain + sharper reviewers (#136). After re-running setup:
- `/review` runs a dedicated application-security pass (`review-security`) on every code change: it hunts the diff-catchable vulnerability classes (secrets, injection, XSS, path traversal, SSRF, weak crypto) through an adversarial lens, requires a source-to-sink exploit sentence per finding, and stays silent via a danger-spot gate when nothing security-sensitive changed.
- New standalone `/security-audit` for a deep, on-demand whole-repo pass (entry points, per-route authorization, crypto inventory, recommended `gitleaks` history scan). Both defer dependency CVEs to `/review-deps`.
- Reviewers are sharper: each expert persona is now passed to the dispatched subagent (design verdict before nits), every finding must carry a `file:line` receipt or it is dropped, and a new near-empty shared `do-not-report.md` suppresses known-noise classes once you add them.
- Review reports open with an Overall Verdict line and apply a readability backstop (lead with the top 5, collapse the rest, past 7 findings).

**What was new in v5.2.0:** Installer guarantees + token economy (#121, #125, #129, #130, #131, #133). After re-running setup:
- Both installers print a read-only pre-flight report BEFORE any file changes: version gap, migrations that will run, managed files with local edits (diff summary), custom files (explicitly never touched), and the backup location. `--dry-run` (bash) / `-DryRun` (PowerShell) prints the report and exits with zero changes. The custom-file guarantee is enforced by scratch-project test suites in the toolkit repo.
- New `.claude/scripts/session-init.js`: `/explore`, `/create-plan`, `/pair-debug`, and `/execute` make one startup call instead of 4-5 sequential reads. The installer merges the matching permission into `settings.local.json` automatically.
- `LESSONS.md` is now an always-read index with full write-ups in `LESSONS-detail.md` (seeded on fresh installs, preserved on upgrades; a pre-split flat `LESSONS.md` still works).
- `/review` dispatches leaner (structured JSONL findings, a diff-size gate that reviews small changes inline, reading budgets); `/index` pins its chunk analysis to Sonnet; `/create-plan` renders plan HTML via the shared helper (about 2x faster).
- Plans add a conditional Verify test step when the work changes verifiable logic, and skip it for docs/config-only work.
- Windows parity fixes: `setup.ps1` now copies `VERSION` (version-gap reporting works), runs the v3.5 legacy command cleanup, and works from UNC paths like `\\wsl.localhost\...`.

**What was new in v5.1.0:** HTML render pipeline (#120, #122, #127). After re-running setup:
- HTML reports (review, document, explore, debate, audit) now open faster: commands emit a small JSON payload that a new helper (`.claude/scripts/render-html.js`) injects into a prebuilt shell, instead of hand-writing the whole file.
- HTML filenames in `artifacts/html/` are now timestamped, so same-day re-runs never collide and there is no stale-file overwrite cycle.
- An accessibility pass: a darker AA-compliant warn color, a `<noscript>` fallback, `<main>` landmarks, heading-navigable findings, and chart/verdict cues that no longer rely on color alone.
- New `.claude/skills/shared/shells/` folder (the prebuilt shells plus `tokens.css`); both installers copy it and the new script, and merge in a `render-html.js` permission.

**What was new in v5.0.1:** Fresh-install reliability fixes (#119, #126). After re-running setup:
- HTML artifacts now open reliably on WSL. The opener moved from prose Claude ran by hand into a deterministic script (`.claude/scripts/open-artifact.sh`) with real fallback, so it no longer silently fails when no browser launcher is on PATH.
- The Windows installer (`setup.ps1`) now copies `generate-index.js`, so `/index` and `/document`'s map refresh work out of the box on fresh Windows installs (closing a v5.0.0 follow-up). Windows users who installed before this version should re-run `setup.ps1` to pick up the fix.

See [CHANGELOG.md](CHANGELOG.md) for older release notes (v5.0.0 and earlier).

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
