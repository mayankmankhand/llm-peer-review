# AI Agent Setup Instructions (v4.4.0)

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

**What's new in v4.4.0:** Codebase Map replaces flat-tree `INDEX.md` (issue #97). After re-running setup:
- Old `INDEX.md` is detected and removed (the original is preserved in `.toolkit-backup-*/` per issue #79). It is replaced by `CODEBASE_MAP.md`, a semantic map: module purposes, entry points, conventions, gotchas, navigation guide.
- `CODEBASE_MAP.md` is generated by `/index`, which orchestrates parallel Claude subagents (one per ~250k-token chunk, max 5). One-time generation cost amortized across many later sessions.
- The first `/explore` after upgrade auto-invokes `/index` to generate the map. No manual step needed; lazy generation handles it.
- `/create-plan`, `/pair-debug`, and `/document` now also consume `CODEBASE_MAP.md`. `/explore` performs a staleness check (compares HEAD with map commit) and warns if drift is detected.
- No new permissions needed - the existing `Bash(node .claude/scripts/generate-index.js *)` permission still covers the refactored scanner.
- The v3.4 lesson ("LLMs cost more than they save") was correct about mid-session scanning, but over-applied to cancel one-time upfront generation. See LESSONS.md for the nuanced re-read.

**What was new in v4.3.3:** Default GPT model bumped from `gpt-5.4` to `gpt-5.5` (issue #95). No setup-script or workflow changes - re-running setup just refreshes commands, scripts, and the version stamp.
- `/ask-gpt` now defaults to `gpt-5.5` (released 2026-04-23). Users on `gpt-5.4` or other slugs are unaffected - the `GPT_MODEL` env var override still works the same way.
- Gemini default unchanged. Verified: `gemini-3.1-pro-preview` is still the only Gemini 3.1 Pro slug Google offers, no GA replacement exists yet.

**What was new in v4.3.2:** Gemini SDK migration (issue #92). No user-facing behavior change.
- `/ask-gemini` migrated from `@google/generative-ai` (deprecated 2025-08-31, no further bug fixes or security patches) to the actively-maintained `@google/genai`. Same prompts, same outputs, same `GEMINI_MODEL` / `GEMINI_USE_CONCAT_PROMPT` env knobs.
- Setup-script cleanup arrays list both old and new dep names so users upgrading from a v4.2.x install still get the dead `@google/generative-ai` stripped from their root `package.json`.
- Smoke-tested all three commands (`review`, `respond`, `summary`) plus the `GEMINI_USE_CONCAT_PROMPT=1` fallback against the live Gemini API.

**What was new in v4.3.1:** Periodic-audit cleanup release. No setup-script or workflow changes - re-running setup just refreshes commands, skills, and the version stamp.
- `/ask-gpt` and `/ask-gemini` debate flow rewritten so each round's `respond` call sees the full prior transcript. Pre-fix, the cumulative debate file was only assembled at the end, so rounds 1-3 ran without context. The initial review is now also preserved in the saved transcript (issue #93 R1, R2).
- `/worktree` now installs both host project and toolkit deps in new worktrees. Pre-fix, fresh worktrees silently lacked `.claude/scripts/node_modules` after the v4.3.0 quarantine, so `/review-browser`, `/ask-gpt`, and `/ask-gemini` failed in them (issue #93 R3).
- `.gitattributes` now covers `.claude/scripts/**` for LF line endings, matching the existing `scripts/**` rule (issue #93 D1).
- "Use this when / Don't use this when" markers added to nine commands and skills that lacked them: `/explore`, `/create-plan`, `/execute`, `/document`, `/ask-gpt`, `/ask-gemini`, `/create-issue`, `/package-review`, and the `learning-opportunity` skill (issue #93 R4).
- See `reports/review-commands-2026-05-03.md` for the full audit report that drove this release.

**What was new in v4.3.0:** Toolkit runtime deps are now quarantined under `.claude/scripts/`. Re-running setup auto-migrates v4.2-and-earlier installs.
- Runtime scripts moved from `scripts/ask-gpt.js` etc. to `.claude/scripts/ask-gpt.js`. The toolkit's four runtime deps (`openai`, `@google/generative-ai`, `playwright-core`, `@axe-core/playwright`) now live in `.claude/scripts/package.json` so end users of downstream projects no longer inherit them when they `npm install` at project root (issue #91).
- Install command changed: `npm install --prefix .claude/scripts` instead of `npm install @google/generative-ai openai ...` at project root. Setup script output, README.md, SETUP.md, AGENT-SETUP.md, and the `/review-browser` skill have been updated.
- Auto-migration: re-running setup detects old `scripts/<name>.js` files, backs them up to `.toolkit-backup-*/`, removes them, strips the four toolkit deps and matching `ask-gpt`/`ask-gemini` convenience scripts from the project's root `package.json`, and refreshes `.claude/settings.local.json` permissions to the new paths. The migration runs only when there's something to clean - clean installs see no migration noise.
- CI/automation note: any downstream pipeline calling `node scripts/ask-gpt.js`, `node scripts/ask-gemini.js`, or `node scripts/browse.js` directly will need to update the path. Slash commands (`/ask-gpt`, `/ask-gemini`, `/review-browser`) are unchanged.
- Also fixed in this release: env parser tolerates `export` prefix (issue #85), unknown CLI flags fail fast in ask-gpt/ask-gemini (issue #83). See CHANGELOG for details.

**What was new in v4.2.2:** This release was documentation-only - no code, workflow, or setup-script changes.
- Audited README.md and API-KEYS.md for drift against the current toolkit (issue #90). Fixed stale command counts, an outdated list of review skills (6 -> 8), an incomplete description of what `setup.sh` copies, and a missing `.claude/skills/` row in the "How It Works" architecture table.
- README.md and API-KEYS.md are NOT copied to downstream projects by `setup.sh`, so re-running setup will not propagate these fixes to target projects. The version stamp and CHANGELOG entry are the only downstream-visible changes.

**What was new in v4.2.1:** After re-running setup:
- Renamed toolkit files (e.g. `dev-lead-gpt.md` -> `ask-gpt.md`, `dev-lead-gemini.js` -> `ask-gemini.js`) are now cleaned up from target projects. Setup backs up the old file to `.toolkit-backup-*/` and removes it before copying the new one, so stale slash commands don't sit alongside their renamed versions. Each removal is logged.

**What was new in v4.2:** After re-running setup:
- Setup now preserves any file it would overwrite or delete by copying the original to `.toolkit-backup-<timestamp>/` at the project root, with mirrored paths. Upgrades never destroy user customizations - if something gets replaced, the original is one directory away. Byte-identical files are skipped entirely (no copy, no backup), so clean installs produce no backup directory. The `.toolkit-backup-*/` pattern is added to `.gitignore` automatically on the next install.

**What was new in v4.1:** After re-running setup:
- New `/review-copy` skill for copy clarity and reader orientation review. Works standalone (`/review-copy`) or via the unified dispatcher (`/review copy`).
- Shared reference files updated: `severity-anchors.md` has Copy Review severity anchors, `output-template.md` has a Copy row in the specialist table.
- No new permissions needed - all tools used by `/review-copy` (Read, Glob, Grep, Agent, WebSearch) are already in `settings.local.json`.

**What was new in v4.0:** After re-running setup:
- Plans moved from `.claude/plans/` to `plans/` (top-level). The `.claude/` directory is protected by Claude Code, which caused permission prompts on every plan read/write. Setup automatically migrates existing plan files and removes the old directory.
- Version bump to 4.0 reflects a workflow-affecting change (plan location)

**What was new in v3.5:** After re-running setup:
- Skills layer: 6 review commands migrated to `.claude/skills/` for agent discovery (`review-code`, `review-ux`, `review-plan`, `review-commands`, `review-browser`, `review-full`). `learning-opportunity` also moved to a skill.
- Unified `/review` command dispatches specialist review skills and combines findings into one report
- New skills: `review-deps` (dependency and supply chain security), `project-context` (agent-only - provides context to subagents)
- New commands: `/review`, `/codebase-to-course`
- `browse.js` improvements: server auto-start (opt-in), accessibility scanning via `@axe-core/playwright`, responsive screenshots
- New dependency: `@axe-core/playwright` for accessibility testing in browser QA
- Legacy cleanup: setup automatically removes old review command files from `.claude/commands/` that were migrated to skills
- New permissions needed: `npm audit`, `npm outdated` - if the user has an existing `.claude/settings.local.json`, add `"Bash(npm audit *)"` and `"Bash(npm outdated *)"` to the `permissions.allow` array so `/review-deps` can run without prompting

**What was new in v3.4:** After re-running setup:
- `/index` command and `INDEX.md` auto-generation - a Node script generates a file tree of all git-tracked files. Setup generates it on first run, `/document` regenerates it after changes, `/explore` reads it during Phase 2
- New file: `.claude/scripts/generate-index.js` (toolkit-managed, always updated)
- New gitignore entry: `INDEX.md` (local-only, machine-generated)
- New permission: `node .claude/scripts/generate-index.js` - if the user has an existing `.claude/settings.local.json`, add `"Bash(node .claude/scripts/generate-index.js *)"` to the `permissions.allow` array so `/index` and `/document` can run the script without prompting

**What was new in v3.3:** After re-running setup:
- Self-Service section in toolkit rules - Claude now has explicit guidance to run dev servers, tests, builds, and dependency installs itself instead of asking the user

**What was new in v3.2:** After re-running setup:
- Procedure block fix in debate commands - Steps 6 and 7 were outside the `<procedure>` block in both `ask-gpt.md` and `ask-gemini.md`
- Write tool guard - added Read-before-Write pattern at all file creation points in debate commands so they work as background subagents
- Demo script (`DEMO-SCRIPT.md`) - 5-minute presenter's script for live-demoing the full workflow

**What was new in v3:** After re-running setup:
- `/peer-review` rewritten with severity-based evaluation framework and structured output template
- `/pair-debug` now includes an approval step before fixing (consistent with other review commands)
- `/execute` defines "critical blocker" with concrete examples
- `/review-full` clarifies specialist review guidance
- `/create-plan` adds parallel vs sequential step examples
- `browse.js` keeps more error context (3 lines instead of 1)
- Various doc fixes (README link, SETUP step ordering, CHANGELOG cleanup)

**What was new in v2:** `/review` renamed to `/review-code`, 5 new review commands added (`/review-commands`, `/review-plan`, `/review-ux`, `/review-browser`, `/review-full`), `/explore` gained vision mode and ASCII diagrams, UI/UX preferences moved into `/explore` and `/create-plan`.

Tell the user about these changes if they were on an older version. See `CHANGELOG.md` for full details.

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
