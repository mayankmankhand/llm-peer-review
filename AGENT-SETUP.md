# AI Agent Setup Instructions (v6.2.0)

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

**What's new in v6.2.0:** The design workflow (#160), additive on top of v6.1.1. After re-running setup:
- When a feature has a look (a page, a screen, a component), `/explore` runs a named "Design exploration" step. It detects whether the repo already has a design system, asks the user once, and records the answer in a new user-owned `DESIGN-PROFILE.md` at the project root, which setup seeds once from `.claude/skills/shared/design-profile-template.md` and never overwrites. Tell the user that file is theirs, like `CLAUDE.md` and `LESSONS.md`.
- A repo that already has a design system keeps it: inside one, only layout, composition, motion, and copy vary, and anything further asks the user first. New surfaces get an idea list to react to, three seeded working prototypes to pick from in the playground, and then, during `/execute`, a fresh-context `design-critic` agent (`.claude/agents/design-critic.md`, Read only, no model pin) that scores each round under the new loop rule M15 (up to 5 rounds for new work, 2 for improving an existing surface; the best-scoring round is kept). Every mechanic lives in `.claude/skills/shared/design-rules.md`.
- A new dependency-free script, `.claude/scripts/gen-media.js` (Node 18+), prints the seed strings and can generate images, video, and matted video behind the user's own keys in `.env.local`: images reuse `OPENAI_API_KEY` or `GEMINI_API_KEY`, video and matting take an optional `FAL_KEY` from https://fal.ai/dashboard/keys. With no key it hands the user a ready-to-paste prompt and the workflow continues; nothing about it is required. Tell the user to use a separate fal.ai key with a tight spend limit if they add one.
- **Permission to check:** the seed call is `node .claude/scripts/gen-media.js --kind seed`. If the first design run prompts for permission on it, add `Bash(node .claude/scripts/gen-media.js *)` to the project's `.claude/settings.local.json` beside the other `node .claude/scripts/` entries; setup's merge only ships entries present in the toolkit's own template.
- Nothing else changed: `/review-ux` is untouched, the toolkit's own HTML look is untouched, and the pre-push tripwire now also recognises the fal.ai key shape.

**What was new in v6.1.1:** A patch on v6.1.0 (#159). The v6.1.0 plan shell carried a nested HTML comment, so every plan page `/create-plan` rendered opened with its schema documentation as visible text above the title. The shell is fixed and `render-html.js` now refuses any shell with a malformed comment. Added to the same release (#158): the review audit's three-vote tier can now downgrade an over-called Block to Warn or Suggest instead of killing it, so a real finding no longer dies for carrying the wrong severity label, and a skeptic that refutes a finding can attach a one-line `split:` note naming any true sub-claim, which lands in the digest. Nothing else changed. If the user is on v6.1.0, re-run setup so the fixed shell lands; then the v6.1.0 block below still describes everything else that is current.

**What was new in v6.1.0:** Additive on top of v6.0.0 (#155, #156, #157, plus a holistic pass over the whole range) - the correction ledger, the hosted page as the primary viewport with no consent ask, a hosted-URL stamp on every published file, Windows installer parity plus upgrade safety in both installers, and two review-loop fixes. Nothing here changes the auto-by-default behavior v6.0.0 introduced; if the user is upgrading from v5.x or earlier, walk them through the v6.0.0 block below first. After re-running setup:
- `/document` now has a capture stage. At the end of a cycle it finds the moments the user stepped in, has a fresh subagent read those exchanges cold, and asks the user to confirm or rewrite a short note about each one before anything is recorded. Nothing is written without their say-so. It explains itself the first time it runs in a project, so you do not need to introduce it.
- A new `/error-analysis` command groups those notes into categories and ranks them by count. It is user-triggered and never chained into. It refuses to rank on fewer than ten rows. A one-time backfill of older transcripts exists (`--since` on the script's `--candidates` mode), run only when the user asks and only for the repo they name.
- Data lives at `~/.claude/`, per machine, append-only, outside every repo. Tell the user plainly: the mechanism ships to every install, the data never leaves their machine, it is never published, and it is never sent to another model. Two fields hold near-verbatim fragments and are excluded from every rollup. They can turn it off for a repo with `touch .claude/.no-correction-log`. The files that ship it: `.claude/scripts/correction-ledger.js`, `.claude/agents/correction-extractor.md`, and `.claude/skills/error-analysis/SKILL.md`.
- **If the user kept a customized `.claude/commands/document.md`:** the capture stage is a new Section 6 in that file, and Sections 6 through 8 were renumbered to 7 through 9. Declining setup's overwrite prompt aborts the whole run, so if they take the update, point them at the backup setup made and tell them the capture stage is what to merge their edits around.
- **If a global `~/.claude/commands/document.md` exists**, it shadows the project copy and capture silently never runs. Setup already warns about the name conflict; tell the user what is lost, not just that a conflict exists.
- **The hosted page is now the primary viewport, and publishing no longer asks.** Plans, reviews, cycle summaries and the rest are published to a private Claude-hosted page under claude.ai when the session can, and the user gets the link; the local browser open is the fallback when it cannot (Cursor, or the feature is off). Exactly one viewport opens. No artifact type asks for consent any more, review and debate included, and the local fallback never asks either. The reason, if the user asks: the page is private by default under their own account and the toolkit never changes a page's sharing setting, so it is not an outward-facing send under the loop's M9 rule. What still asks: every other M9 action (prompt-file edits, releases and version bumps, deleting user data, force pushes), any send to a destination other than a private claude.ai page (issue and PR comments, email, a shared drive), and sharing a page. M9's two named exemptions are now the pull request `/document` opens at the end of a chained cycle and a publish to a private claude.ai page. `/error-analysis` output is never published at all, the M11 tripwire still scans every push, and published pages now carry no machine-identifying paths: publish-bound renders pass `--no-abs`, which strips the editor links and rewrites the repo root and home directory out of the text (6.0.0 pages still embedded those paths). Two trade-offs to state honestly: a review or debate page can hold findings the user has not read yet, so Claude says in one clause what such a page contains when handing over the link; and an update to a `--stable` page (plans, docview) that the user has since shared reaches whoever they shared it with.
- **Published files carry their hosted URL.** Line 1 of every published local file is now an HTML comment, `<!-- hosted: <url> -->`, so anyone opening the file can find the page. `artifacts/html/index.jsonl` remains the single record (append-only, one JSON line per publish, keyed to the repository so worktrees share it); the stamp is a derived copy. `render-html.js --index-add` writes both, and a new `--index-sync` regenerates every stamp from the newest record per file and prints `index-sync: N stamped, M missing`. Markdown twins (`PLAN-*.md`) are not stamped. If the user asks about the comment, that is what it is; do not strip it.
- **Windows installer parity.** `setup.ps1` now performs three things `setup.sh` already did: the `settings.local.json` permission merge (missing template entries added, known-stale ones removed, a project-level `.claude/settings.json` never touched), the legacy `INDEX.md` removal with `.gitignore` cleanup, and the `.claude/plans/` to `plans/` migration. Before this, Windows upgrades never received new permission entries. Tell a Windows user who upgraded before this that one more re-run of Step 1 is what gets them the `pre-push-check.js` and `correction-ledger.js` permission entries. Also fixed on Windows: a reorder-only edit to a managed file now trips the gate, and a failed `package.json` rewrite prints a warning instead of passing silently.
- **Upgrade safety in both installers.** The manifest is written atomically (temp file, then rename); the previous manifest and the pre-merge `.gitignore` and `settings.local.json` are backed up into the same backup folder as everything else; a user file sitting at a path the toolkit newly ships is treated as locally modified, so it gates the run instead of being silently replaced; the upgrade banner is version-neutral and points at `CHANGELOG.md` and this file instead of stale v5.0 text; and a failed permission merge is reported as a warning that leaves the file unchanged. The guarantee suites grew from 51 to 129 checks (bash) and 51 to 148 (PowerShell), every new check mutation-tested. "Updating an Existing Project" above covers the gate, the backup folder, and the after-upgrade checklist.
- **Review loop.** A direct `/review-*` run that fans out sub-agents now dedups with the same rule as `/review`: a merged finding keeps the highest severity of its sources. `/peer-review` is no longer listed as an HTML call site. Nothing to do beyond re-running setup.

**What was new in v6.0.0:** Auto by default - a breaking behavior change (#143, #145 through #152, #154), and still the block to read first when the user is upgrading from v5.x or earlier. After re-running setup:
- The loop no longer stops at a report. A review now fixes the findings that survived its own audit, re-verifies each fix with something other than whatever made it, and hands off to the next stage. Tell the user this plainly: it is the reason for the major version. Two per-run phrases take it back, and they do different things - "report only" stops the changing, "no chaining" stops the handoff.
- Findings must prove themselves first. Each carries a receipt (a read-only command plus what its output must show), the run executes it, and survivors face a skeptic; a Block-severity finding faces three. Reports are shorter, and what was thrown out is listed rather than hidden.
- A pre-push tripwire (`.claude/scripts/pre-push-check.js`) reads every outgoing commit for secrets, never-push files, and shared-settings changes before any push the loop makes. It fails closed. Note it is a rule the toolkit follows, not a git hook, so a `git push` typed by hand is unscanned.
- Five kinds of action still always ask: releases and version bumps, prompt-file edits, deleting user data, sending anything off the machine (two named exceptions as of 6.0.0: the pull request `/document` opens at the end of a chained cycle, plus an artifact publish the user already consented to that session; this has since changed, see the v6.1.0 block above), and force pushes.
- The toolkit now works on GitLab as well as GitHub, detected from the git remote at the moment it is needed. The `glab` path has since been executed end to end against a live repo and its three defects are fixed, so do not warn the user it is untested. One caveat remains: `--output json` has moved between glab versions, and older builds want `-F json`.
- HTML artifacts still open locally and are also published to a private Claude-hosted page when the session can, after a consent ask (this has since changed: see the v6.1.0 block above).

See [CHANGELOG.md](CHANGELOG.md) for older release notes (v5.5.0 and earlier).

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
