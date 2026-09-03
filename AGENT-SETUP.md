# AI Agent Setup Instructions (v6.3.1)

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
- `.claude/agents/` (all worker definitions - the review finder, index mapper, correction extractor, and design critic, carrying their model, effort, and tool settings - always updated)
- `.claude/rules/toolkit.md` (toolkit workflow rules - always updated)
- `.claude/rules/html-outputs.md` (HTML output rules - always updated)
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

If the toolkit is already set up in the user's project, **run the same Step 1 command again**. It's safe to rerun.

**What gets updated** (always overwritten - manifest-tracked, and backed up first when the copy on disk differs):
- `.claude/commands/` - all slash command definitions
- `.claude/agents/` - all worker definitions (review finder, index mapper, correction extractor, design critic)
- `.claude/skills/` - all skill definitions (review specialists, learning-opportunity, project-context, shared references, and the prebuilt HTML shells in `shared/shells/`)
- `.claude/rules/toolkit.md` and `.claude/rules/html-outputs.md` - the managed rules files (version-stamped)
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
1. Re-run setup (Step 1 above) to get the new `toolkit.md`
2. Edit their `CLAUDE.md` to keep only project-specific info (About This Project, Who I Am, My Preferences)
3. Remove the toolkit sections from their `CLAUDE.md` - they're now managed automatically

If the user wants a completely fresh `CLAUDE.md` template, they can delete theirs and rerun setup.

**What's new in v6.3.1:** A patch on v6.3.0 (#162). The audit writes the receipt files the review page reads, the standing review page renders after the fix loop and can go empty, and a focused `/review-*` run merges into it. Nothing about setup changes; re-running it picks up the renderer, the two shells, and the prompt files.

**What was new in v6.3.0:** What a review finding says, and where the review page lives (#161). Additive on top of v6.2.0; nothing about how the loop runs changes. After re-running setup:
- **The four-field finding structure is gone.** A finding is now one sentence of 18 words or fewer opening with the severity spelled out (`Blocks.` / `Should fix.` / `Optional.`) and carrying both the defect and its consequence; an optional second sentence only when it answers who is hit, when it fires, or why now; and a fix line stating a cost, not an approach. The contract lives in `.claude/skills/shared/output-template.md`. Tell the user their reviews will be dramatically shorter: re-rendering their three largest past reports cut them 60%, 67% and 80%.
- **The skip rule is inverted.** It used to say a finding not worth four fields should not be reported, which taught the model to inflate small true things. It now says a finding must survive being compressed to one sentence with an honest harm verb in it.
- **Findings now show the machine's own output.** Every finding already carried a runnable check that the audit executed and discarded; its output is now attached to the finding verbatim. The renderer reads those bytes off disk itself, so what appears in the monospace block is not something a model retyped.
- **The review page is one standing page per repository**, at `artifacts/html/review.html`, replaced in place rather than added to. It carries only what is open, says what changed since the user last opened it, and can go empty. The full markdown report is written to `reports/review-<who>-<timestamp>.md` every run, which is new: previously the long-form report existed only in chat scrollback and was lost on a clear.
- **The plan page updates as work happens.** Steps carry a live status and `/execute` re-renders the page as it goes, so a plan page no longer shows every step as not started while its markdown records the work as done.
- Nothing else changed: `/review` still chains from `/execute` and into `/document` on its own, and "report only" and "no chaining" work exactly as before.

**What was new in v6.2.0:** The design workflow (#160), additive on top of v6.1.1. After re-running setup:
- When a feature has a look (a page, a screen, a component), `/explore` runs a named "Design exploration" step. It detects whether the repo already has a design system, asks the user once, and records the answer in a new user-owned `DESIGN-PROFILE.md` at the project root, which setup seeds once from `.claude/skills/shared/design-profile-template.md` and never overwrites. Tell the user that file is theirs, like `CLAUDE.md` and `LESSONS.md`.
- A repo that already has a design system keeps it: inside one, only layout, composition, motion, and copy vary, and anything further asks the user first. New surfaces get an idea list to react to, three seeded working prototypes to pick from in the playground, and then, during `/execute`, a fresh-context `design-critic` agent (`.claude/agents/design-critic.md`, Read only, no model pin) that scores each round under the new loop rule M15 (up to 5 rounds for new work, 2 for improving an existing surface; the best-scoring round is kept). Every mechanic lives in `.claude/skills/shared/design-rules.md`.
- A new dependency-free script, `.claude/scripts/gen-media.js` (Node 18+), prints the seed strings and can generate images, video, and matted video behind the user's own keys in `.env.local`: images reuse `OPENAI_API_KEY` or `GEMINI_API_KEY`, video and matting take an optional `FAL_KEY` from https://fal.ai/dashboard/keys. With no key it hands the user a ready-to-paste prompt and the workflow continues; nothing about it is required. Tell the user to use a separate fal.ai key with a tight spend limit if they add one.
- **Permission to check:** the seed call is `node .claude/scripts/gen-media.js --kind seed`. If the first design run prompts for permission on it, add `Bash(node .claude/scripts/gen-media.js *)` to the project's `.claude/settings.local.json` beside the other `node .claude/scripts/` entries; setup's merge only ships entries present in the toolkit's own template.
- Nothing else changed: `/review-ux` is untouched, the toolkit's own HTML look is untouched, and the pre-push tripwire now also recognises the fal.ai key shape.

**What was new in v6.1.1:** A patch on v6.1.0 (#159). The v6.1.0 plan shell carried a nested HTML comment, so every plan page `/create-plan` rendered opened with its schema documentation as visible text above the title. The shell is fixed and `render-html.js` now refuses any shell with a malformed comment. Added to the same release (#158): the review audit's three-vote tier can now downgrade an over-called Block to Warn or Suggest instead of killing it, so a real finding no longer dies for carrying the wrong severity label, and a skeptic that refutes a finding can attach a one-line `split:` note naming any true sub-claim, which lands in the digest. Nothing else changed. If the user is on v6.1.0, re-run setup so the fixed shell lands; then see the v6.1.0 section in [CHANGELOG.md](CHANGELOG.md) for everything else that is current.

**Older releases:** v6.1.0 (the correction ledger, the hosted page as the primary viewport, installer parity) and v6.0.0 (auto by default, the breaking behavior change, and still the one to read first when the user is upgrading from v5.x or earlier) are described in full in [CHANGELOG.md](CHANGELOG.md). If the user is on v5.x, read the v6.0.0 section there before walking them through anything above.

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
- **FAL_KEY** (optional) - from https://fal.ai/dashboard/keys, only for video generation and matting in the design workflow; without it the workflow hands the user a prompt to run elsewhere

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
- **Setup exits 1 with a list of "locally modified" files** - That is the manifest gate (see "Updating an Existing Project"). Show the user the list; re-run with the force flag only after they say yes

</reference>
