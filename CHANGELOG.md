# Changelog

## v4.4.1 - Richer Review Explanations

### Changed
- **All review findings now follow a rigid 4-field structure** (#98) - `What / Why it matters / Example / Suggested fix`. The previous format was `Description / Why / Fix direction`. The new structure adds a real-world Example field (user or system consequence, not abstract risk) so each finding feels justified at any severity, even Suggest. Updated in `.claude/skills/shared/output-template.md`; all 8 review skills inherit automatically via `!cat` injection.
- **Skip rule added to `.claude/skills/shared/severity-anchors.md`.** Purely cosmetic findings (typos in non-user-facing comments, trailing whitespace, missing periods, single-char vars in short scopes, mixed quote-style preferences) with no functional/security/a11y/maintainability impact are dropped entirely instead of being bulked up to fit the 4-field structure. The existing Universal Anchors floors (secrets, data loss, a11y, requirements) still override the skip rule when relevant.
- **Suggest-severity illustrative example with boundary annotation** added to `output-template.md`. The example carries a meta-note ("would be skipped if X, is a Suggest because Y") that teaches the model the threshold between Skip and Suggest, not just the format. The current 3 examples were all Block or Warn - the model had no template for borderline cases.
- **`/review` orchestrator DRYed up.** The previously hardcoded duplicate Output Format block now inlines the shared template via `!cat`, wrapped in `<shared_template>` XML tags to isolate heading hierarchy. The orchestrator supplement now covers only what is orchestrator-specific: `[specialist]` tags, code+browser merge field order, and the suppress-inlined-Summary instruction.

### Fixed (found during /ask-gemini peer review)
- **Code+browser merged findings now preserve browser evidence.** When both specialists flag the same issue, the merged finding keeps Screenshot, Evidence, Expected, Actual fields in addition to the 4 base fields. Previously these would be silently dropped on dedup. Explicit merge field order: What -> Why -> Example -> Screenshot -> Evidence -> Expected -> Actual -> Suggested fix.
- **Duplicate Summary block in `/review` output.** The DRY refactor inlined the shared template's own Summary block under the orchestrator's own Summary block, producing two Summary blocks per report. Fixed by adding an explicit "do NOT render the inlined Summary" instruction in the orchestrator supplement.

### Notes
- **No new permissions, no setup-script changes.** All 8 review skills inherit the new structure automatically via existing `!cat` references. Downstream projects re-running setup just refresh the three modified shared/orchestrator files.
- **Issue 98's original framing ("model forced to manufacture issues" via biased phrasing) was reframed during `/explore`.** The actual problem turned out to be thin explanations + low severity bar, not invented findings. The "all clean" outcome question is deferred to a future issue.
- **`/ask-gemini` peer review caught two real bugs in the DRY refactor** (duplicate Summary, lost browser fields) that the initial `/review-*` skills did not. Confirms the value of running peer review after `/execute` even on small structural changes.
- **`/ask-gpt` did not run** for this release - OpenAI returned 429 quota exceeded on the initial review call. Gemini's 3-round debate was the only second opinion.

---

## v4.4.0 - Codebase Map Replaces INDEX.md

### Changed
- **`/index` is now a Codebase Map generator** (#97) - Issue #97 audited v3.4's flat-tree `INDEX.md` and found it did not save tokens (Claude still had to grep/read files to learn what they did). v4.4.0 replaces the flat tree with `CODEBASE_MAP.md`, a semantic map containing module purposes, entry points, dependencies, conventions, gotchas, and a navigation guide. `/index` now orchestrates parallel Claude subagents (one per ~250k-token chunk, max 5 chunks) to analyze the codebase, then synthesizes their findings into a ~10k-token map.
- **Consumer commands read `CODEBASE_MAP.md`** - `/explore` Phase 2, `/create-plan`, and `/pair-debug` all read the map at session start to inform their work. `/explore` performs a staleness check (compares HEAD with the map's commit) and warns if drift is detected. If the map is missing on first `/explore`, `/explore` auto-runs `/index` (lazy generation).
- **`/document` regenerates the map via `/index`** instead of calling the scanner directly. The map represents "the codebase at the last `/document` checkpoint."
- **`.claude/scripts/generate-index.js` repurposed.** The script no longer writes `INDEX.md` directly; it now emits a JSON manifest (per-file token estimates, chunk assignments, directory tree, current commit) consumed by `/index`. Same filename, completely new behavior - minimizes upgrade surprises.

### Removed
- **`INDEX.md` retired.** Setup detects and removes old `INDEX.md` files during upgrade (the original is preserved in `.toolkit-backup-*/` per issue #79). Downstream projects upgrading from v4.3.x have their old `INDEX.md` cleaned up automatically.

### Fixed (found during review of this release)
- **`GPT_MAX_TOKENS` env var now actually takes effect in `/ask-gpt`.** Surfaced while running the /ask-gpt review of issue #97 itself - the script's `maxTokens` was hardcoded to 4096 despite docs referencing the env var. One-line wire-up so the override works as advertised.

### Notes
- **Inspiration credit:** the semantic-map approach is inspired by [Cartographer](https://github.com/kingbootoshi/cartographer), a Claude Code plugin with the same goal. Rather than depending on an external plugin (which carries lifecycle risk - one variant `pect0ral/claude-cartographer` is already 404), v4.4.0 builds a native equivalent that integrates with this toolkit's existing slash command surface.
- **Cost model (unmeasured estimate):** generating the map costs a few dollars in API credits per project for small/medium codebases; more for very large ones (the cost-confirm prompt fires above 500k tokens or on per-chunk overflow). Note that `/document` triggers a regeneration via `/index`, so heavy `/document` usage compounds the cost over time. Each subsequent session reads ~3k tokens of map and saves an estimated 10-40k tokens of file reads. These numbers are projections, not measurements - empirical validation is filed as a follow-up.
- **No new permissions needed.** The existing `Bash(node .claude/scripts/generate-index.js *)` permission covers the refactored scanner. Agent tool calls (subagent spawning) are built-in to Claude Code and not gated by allowlist.
- **The v3.4 lesson stands, with nuance.** The "LLMs cost more than they save" lesson was correct about mid-session scanning. It was over-applied during v3.4 to cancel one-time upfront generation, which left an empty file tree behind. See LESSONS.md for the full re-read.

---

## v4.3.3 - GPT-5.5 Default

### Changed
- **`/ask-gpt` default model bumped from `gpt-5.4` to `gpt-5.5`** (#95) - OpenAI released GPT-5.5 on 2026-04-23. Updated default in `.claude/scripts/ask-gpt.js`, `.env.local.example`, and `API-KEYS.md`. Users on a different slug are unaffected: `GPT_MODEL` env var override still works the same way.
- **`/ask-gemini` default unchanged.** Verified during issue #95 research that `gemini-3.1-pro-preview` is still the only Gemini 3.1 Pro slug Google offers - no GA replacement exists yet.
- **Version stamps reconciled.** v4.3.2 shipped without `bump-version.sh` running, so `package.json`, `.claude/rules/toolkit.md`, and the `AGENT-SETUP.md` title all still claimed `4.3.1`. Bumping to `4.3.3` restamps all three. AGENT-SETUP also gains a backfilled "What was new in v4.3.2" block to close the gap in its release-notes section.

### Notes
- No setup-script, workflow, or behavior changes beyond the model default. Re-running setup refreshes the model default, version stamp, and `AGENT-SETUP.md` release-notes section.

---

## v4.3.2 - Gemini SDK Migration

### Fixed
- **`/ask-gemini` migrated from `@google/generative-ai` (EOL) to `@google/genai`** (#92) - Google deprecated the old SDK on 2025-08-31; no further bug fixes or security patches will land. Swapped `.claude/scripts/ask-gemini.js` to the actively-maintained `@google/genai` package. The three commands (`review`, `respond`, `summary`) behave identically: same prompts, same outputs, same `GEMINI_MODEL` / `GEMINI_USE_CONCAT_PROMPT` env knobs. Internally, the old `getModel()` helper was replaced by `buildRequest()` since the new SDK has no separate model object - model name and config now travel with each `client.models.generateContent({ model, contents, config })` call.
- **Setup-script cleanup recognizes both old and new dep names** - `scripts/setup/setup.sh` now lists both `@google/generative-ai` and `@google/genai` in its `TOOLKIT_DEPS` arrays, so users upgrading from a v4.2.x install still get the dead `@google/generative-ai` stripped from their root `package.json` even after this migration ships.

### Changed
- **`.claude/scripts/package.json`** now pins `"@google/genai": "^1.51.0"` instead of `"@google/generative-ai": "^0.24.1"`.
- **`AGENT-SETUP.md`** install description updated to reference the new SDK. Historical "What was new in v4.3.0" entries left intact - they accurately describe the v4.3 state when the dep was `@google/generative-ai`.

### Notes
- No user-facing behavior change. Existing `.env.local` `GEMINI_API_KEY` works as-is.
- Verified by running all three commands (`review`, `respond`, `summary`) plus the `GEMINI_USE_CONCAT_PROMPT=1` fallback path against the live API on the new SDK.
- Surfaced during `/review-deps` for issue #91 but left out of that PR's scope (issue #91 was about quarantining deps, not changing which deps are used).

---

## v4.3.1 - Periodic Audit Cleanup

### Fixed
- **`/ask-gpt` and `/ask-gemini` debate file flow** (#93 R1, R2) - The cumulative debate file passed to the script's `respond` mode was only being assembled in Step 5 (after all three rounds completed), so each `respond` call in rounds 1-3 ran without prior context (or failed on a missing file). Rewrote Steps 3-5 in both commands to build the debate file incrementally: each script call and each Claude turn appends to `/tmp/ask-gpt-debate.md` (or the Gemini equivalent) before the next step runs. The initial review is now seeded into the file in Step 3 so round 1's `respond` has full context.
- **`/worktree` now installs toolkit deps in new worktrees** (#93 R3) - After the v4.3.0 quarantine, fresh worktrees lacked `.claude/scripts/node_modules`, so `/review-browser`, `/ask-gpt`, and `/ask-gemini` silently failed in newly created worktrees until the user installed toolkit deps separately. Step 5 now installs both host project deps and toolkit deps as two separate `npm install --prefix` calls. Step 7's printed summary shows both install statuses.
- **LF line endings enforced for `.claude/scripts/`** (#93 D1) - Added `.claude/scripts/** text eol=lf` to `.gitattributes` (matching the existing `scripts/**` rule). Prevents Windows CRLF from breaking Node shebangs in toolkit runtime scripts.

### Changed
- **"Use this when / Don't use this when" markers added to nine commands and skills** (#93 R4) - The toolkit.md convention says every command should open with this guidance so users can pick the right one at a glance. Added markers to: `/explore`, `/create-plan`, `/execute`, `/document`, `/ask-gpt`, `/ask-gemini`, `/create-issue`, `/package-review`, and the `learning-opportunity` skill. Each block names a sibling command for the "Don't use" cross-reference.
- **`README.md` worktree section** clarified to mention that `/worktree` installs both host project and toolkit deps.

### Notes
- Driven by the periodic `/review-commands` audit run on 2026-05-03 (issue #93). The full audit report is committed at `reports/review-commands-2026-05-03.md`.
- The audit also surfaced six Suggest-level polish items (R5-R10) which are tracked in the report but not addressed in this release.
- Stale path reference in `LESSONS.md` corrected (#93 D2): browse.js path updated from the pre-v4.3 `scripts/browse.js` to `.claude/scripts/browse.js`. User-owned file, no functional impact.

---

## v4.3.0 - Quarantined Toolkit Deps

### Fixed
- **Toolkit runtime deps no longer pollute downstream `package.json`** (issue #91) - The four toolkit runtime deps (`openai`, `@google/generative-ai`, `playwright-core`, `@axe-core/playwright`) and the three runtime scripts (`ask-gpt.js`, `ask-gemini.js`, `browse.js`) now live in a quarantined `.claude/scripts/` folder with its own `package.json`. End users who clone a downstream project no longer inherit toolkit-only deps when they run `npm install` at the project root.
- **Env parser tolerates `export` prefix** (issue #85) - The `.env.local` parser in `ask-gpt.js` and `ask-gemini.js` now strips an optional leading `export ` from each line. Users who copy from shell-style examples (`export OPENAI_API_KEY=...`) get the key picked up instead of the misleading "OPENAI_API_KEY not found" error. `.env.local.example` also gains a one-line note steering users to the right format.
- **Unknown CLI flags fail fast in ask-gpt/ask-gemini** (issue #83) - `parseArgs` previously had no `default` case, so a typo like `--debate-files` was silently dropped and resurfaced later as a confusing "Missing required argument: --debate-file". Unknown flags now exit with a clear message pointing at `--help`.

### Changed
- **Install command for runtime deps is now `npm install --prefix .claude/scripts`** instead of `npm install @google/generative-ai openai ...` at project root. README.md, SETUP.md, AGENT-SETUP.md, and the setup-script "What to do next" output have all been updated.
- **Runtime scripts moved from `scripts/` to `.claude/scripts/`** in both the toolkit repo and downstream installs. Permissions, slash commands (`/ask-gpt`, `/ask-gemini`), and the shared `browse-api.md` reference have been updated to the new path.

### Migration
- **Auto-migrate on next setup run.** Re-running `setup.sh` or `setup.ps1` detects v4.2-and-earlier installs and:
  - Backs up `scripts/ask-gpt.js`, `ask-gemini.js`, `browse.js` to `.toolkit-backup-*/` and removes them.
  - Removes the four toolkit deps from the project's root `package.json` (preserves all other deps).
  - Removes `ask-gpt` / `ask-gemini` entries from the project's root `package.json` `scripts` block, but only when their command body still points at the old `scripts/<name>.js` path - protects user customizations.
  - Cleans stale `Bash(node scripts/...)` permissions from `.claude/settings.local.json` and adds the new `.claude/scripts/` equivalents.
- **CI/automation note**: any downstream pipeline calling `node scripts/ask-gpt.js`, `node scripts/ask-gemini.js`, or `node scripts/browse.js` directly will need to update the path to `node .claude/scripts/...`. Slash commands (`/ask-gpt`, `/ask-gemini`, `/review-browser`) need no change.
- After the migration, run `npm install --prefix .claude/scripts` to install the deps in the new quarantined location. Your old root `node_modules/` may still contain the toolkit packages - run `npm install` (or `npm prune`) at the project root to reconcile if needed.
- **Edge cases the migration does NOT cover automatically.** Clean these up manually if they apply:
  - Toolkit deps moved into `devDependencies` instead of `dependencies` (the migration only touches `dependencies` to avoid surprising changes).
  - Custom `ask-gpt` / `ask-gemini` npm scripts that no longer point at the literal `node scripts/<name>.js` path - the migration leaves these alone to protect user customizations.
  - Project-local Playwright/axe/openai installs you've added for your own code - not touched by the migration since they aren't toolkit-attributable.

---

## v4.2.2 - Documentation Audit

### Fixed
- **Documentation drift across user-facing docs** (issue #90) - Audited README.md and API-KEYS.md against the current toolkit state and fixed counts/lists that had drifted as features shipped.
  - `README.md` "Quick Setup" - replaced a single dense paragraph with a Copies / Preserves / Always-updates / Stays-in-toolkit-repo bullet list. Corrected the file list to include `.claude/skills/` and `browse.js`.
  - `README.md` "Full Setup" - removed the stale "the other 14 commands" count and named the two dependency groups inline so readers see they are independently optional.
  - `README.md` "How It Works: File Architecture" - added a `.claude/skills/<name>/SKILL.md` row, noting `project-context` is agent-only.
  - `README.md` "Customization" - updated the review-skill list from 6 to 8 (adds `review-deps`, `review-copy`) and corrected the path to point at `.claude/skills/<name>/SKILL.md`.
  - `API-KEYS.md` - replaced the stale "16 commands" count and clarified that `/review-browser` has its own optional Playwright install (no API key required).

### Notes
- No code, workflow, or downstream-propagated changes. README.md and API-KEYS.md are not copied to downstream projects by `setup.sh`. Re-running setup picks up the new VERSION and toolkit.md stamp; the doc fixes are visible only to people viewing the toolkit repo on GitHub or before they install.
- Brittle counts that drift each release were replaced with phrasing that ages well rather than re-citing a number that will need updating again.

---

## v4.2.1 - Rename-Aware Cleanup

### Fixed
- **Stale files after upstream renames** (issue #80) - `setup.sh` and `setup.ps1` now maintain a rename map (old name -> new name) alongside the existing legacy-command list. On install, old-named files in `.claude/commands/` and `scripts/` are backed up to `.toolkit-backup-*/` and removed, so renamed slash commands no longer pile up alongside their replacements. Covers the `dev-lead-gpt` / `dev-lead-gemini` -> `ask-gpt` / `ask-gemini` renames for both commands and runtime scripts.

### Notes
- Each removal is logged individually during setup so the user sees exactly what was cleaned up.
- Backup behavior from v4.2 is unchanged - any customizations you made to the old-named file survive in the timestamped backup directory.

---

## v4.2 - Safe Upgrades

### Added
- **Automatic backup before overwrite** (issue #79) - `setup.sh` and `setup.ps1` now preserve any file they would overwrite or delete by copying it to `.toolkit-backup-<YYYYMMDD-HHMMSS>/` at the target project root, with mirrored paths. Upgrades no longer destroy user customizations.
- **Byte-identical skip** - Files that match the incoming version byte-for-byte are left alone: no copy, no backup, no mtime change. Clean installs produce no backup directory.

### Changed
- **`.gitignore` propagation** - Added `.toolkit-backup-*/` to the toolkit's `.gitignore`. The existing `.gitignore` merge logic propagates this entry to target projects on the next install, so backup directories stay out of version control automatically.

### Notes
- Safe by default - no prompts, no flags. Backward compatible.

---

## v4.1 - Copy Review Skill

### Added
- **`/review-copy` skill** - Copy clarity and reader orientation review. Checks whether content orients a fresh reader. Use for web pages, blog posts, landing pages, guides, prototypes, and any reader-facing deliverable.
- **`/review` dispatcher integration** - Added `copy` to the `/review` command's focus arguments and dispatch table, so `/review copy` works and unified review can auto-dispatch copy reviews.
- **Shared reference updates** - Added Copy Review severity section to `severity-anchors.md` and Copy row to `output-template.md` specialist table.
- **Toolkit rules** - Added `/review-copy` row to the command reference table in `toolkit.md`.

### Notes
- No new permissions needed - `/review-copy` uses Read, Glob, Grep, Agent, and WebSearch, all already in `settings.local.json`.

---

## v4.0.1 - Setup Fixes

### Fixed
- **VERSION file now copied to target** (issue #73) - setup.sh checked for VERSION in preflight but never copied it. Now copies it alongside other upstream-owned files.
- **browse.js pipe permissions** (issue #75) - Added `echo`/`cat` pipe permission entries for browse.js. setup.sh now also injects absolute-path variants dynamically per project, so Claude won't prompt for permission when using the full filesystem path.

### Improved
- **Permission merge block hardened** - Paths passed via environment variables instead of string interpolation, fixing a latent quoting bug on paths with special characters. Stale absolute-path permissions from old project locations are cleaned up automatically on re-run.

---

## v4.0 - Plans Unlocked

### Changed
- **Plan location** - Plans moved from `.claude/plans/` to `plans/` at the project root. The `.claude/` directory is a protected path in Claude Code - only `commands`, `agents`, and `skills` subdirectories are excepted. Plans in `.claude/plans/` triggered permission prompts on every read/write, even in "Edit automatically" mode. Moving to `plans/` eliminates this friction.
- **setup.sh migration** - Setup now automatically detects and moves existing plan files from `.claude/plans/` to `plans/` when updating downstream projects. The old `.claude/plans/` directory is removed if empty.
- **Documentation** - All references to `.claude/plans/` updated across commands, skills, rules, README, and .gitignore.

---

## v3.5 - Skills Layer

### Added
- **Skills architecture** - Review commands migrated to `.claude/skills/` for agent discoverability
- **`/review` command** - Unified orchestrator that auto-detects changes, dispatches specialist skills in parallel, and combines findings into one report
- **`/review-deps` skill** - Dependency and supply chain security review (npm audit, outdated packages, maintainer risks, licenses)
- **`/codebase-to-course` command** - Turn any codebase into an interactive HTML learning guide
- **`project-context` skill** - Agent-only skill that provides project context to subagents
- **browse.js improvements** - Server auto-start (opt-in), accessibility scanning via axe-core, responsive viewport screenshots
- **Shared reference files** - `.claude/skills/shared/` eliminates duplicated content across review skills

### Changed
- Review commands (review-code, review-ux, review-plan, review-commands, review-browser, review-full) are now skills with SKILL.md format
- `/learning-opportunity` migrated to skill format (Claude can now offer it proactively)
- setup.sh copies `.claude/skills/` directories and handles legacy cleanup
- Browser QA now requires `@axe-core/playwright` for accessibility testing (optional)
- settings.local.json adds `npm audit` and `npm outdated` permissions

### Migration
- Re-run setup.sh to upgrade: old review command files are automatically deleted
- Add `@axe-core/playwright` to browser QA dependencies: `npm install @axe-core/playwright`
- Add `"Bash(npm audit *)"` and `"Bash(npm outdated *)"` to settings.local.json permissions if you have a custom config

---

## 3.4

- **Auto-generated project index** (issue #70) - New `/index` command and `INDEX.md` file. A deterministic Node script (`.claude/scripts/generate-index.js`) generates a file tree of all git-tracked files as indented markdown lists. Helps Claude understand project structure without burning tokens on blind exploration.
  - `setup.sh` generates `INDEX.md` on first run and copies the generator script
  - `/document` regenerates `INDEX.md` after each session
  - `/index` rebuilds `INDEX.md` on demand
  - `/explore` reads `INDEX.md` at the start of Phase 2 (falls back to manual discovery if missing)
  - `INDEX.md` is gitignored (local-only, machine-generated)
  - New permission: `node .claude/scripts/generate-index.js`

---

## 3.3

- **Self-Service guidance** (issue #69) - New "Self-Service" section in `toolkit.md` tells Claude to run commands itself instead of asking the user. Covers dev servers, tests, builds, dependency installs, service status checks, and linting. Explicit carve-outs for screenshots, judgment calls, and destructive actions.

---

## 3.2

- **Demo script** (issue #66) - Added `DEMO-SCRIPT.md`, a 5-minute presenter's script for live-demoing the full toolkit workflow. Covers explore, plan, execute, review, and AI peer review using a sample task. Includes timing markers, narration cues, fallback tips, and a pre-demo checklist.
- **Fix procedure block in debate commands** (issue #61) - Steps 6 (Present Results) and 7 (Await Approval) were outside the `<procedure>` block in both `ask-gpt.md` and `ask-gemini.md`. Moved the closing tag to after Step 7.
- **Fix Write tool guard in subagents** (issue #67) - When `/ask-gpt` or `/ask-gemini` runs as a background subagent, the Write tool rejects new file creation without a prior Read. Added Read-before-Write pattern at all 4 file creation points in both commands. Also replaced shell `cat` concatenation in Step 5 with Read/Write instructions.

---

## 3.0

- **Review findings cleanup** - Fixed broken internal link in README.md, SETUP.md step ordering (npm install before clone), and CHANGELOG strikethrough dead weight from v1.4.
- **`/peer-review` rewrite** - Was 23 lines of unstructured prose. Now has a severity-based evaluation framework, verdict summary table, and structured output template matching other review commands.
- **`/pair-debug` approval step** - Added Step 5 ("Wait for Approval") so the command doesn't dead-end after presenting a fix report.
- **`/execute` blocker examples** - "Critical blocker" is now defined with concrete examples (API incompatibility, bad architecture) vs. non-blockers (typos, syntax errors).
- **`/review-full` wording** - Clarified "don't reproduce specialist reviews" to mean "don't duplicate effort, but do recommend which specialist command to run next."
- **`/create-plan` parallel examples** - Added a concrete example of parallel vs sequential steps.
- **`browse.js` error messages** - Error messages now keep the first 3 lines instead of truncating to just the first, preserving debugging info from Playwright errors.
- **AGENT-SETUP.md fix** - "What gets updated" section now lists browse.js alongside ask-gpt.js and ask-gemini.js.

---

## 2.4

- **`/explore` vision mode** (issue #65) - The `/explore` command now has two gears. **Scoping mode** (default, existing behavior) for concrete features. **Vision mode** for strategy, ideation, and "I'm not sure what to build yet" thinking. Claude auto-detects which mode based on your input and announces the pick. Say "switch to vision mode" or "switch to scoping mode" at any time to override.
  - Vision mode questions: 10-star thinking, premise challenges, temporal questions, permission to scrap and rethink
  - Scope Dial: after exploring, pick Expand / Hold / Reduce to transition from big-picture to concrete direction
  - Phase 2 (codebase analysis) is optional in vision mode - skip straight to `/create-plan` if there's no code to analyze yet
  - Mixed-signal tiebreaker: defaults to scoping mode when input is ambiguous
- **`/explore` optional ASCII diagrams** - Phase 2 now includes lightweight ASCII diagrams when the feature involves flows, data paths, or multi-step processes. Claude auto-includes, asks, or skips based on the feature. Diagrams use indented arrows to surface hidden assumptions - each arrow is a place where things can break. Inspired by gstack's approach (issue #64).
- **Setup scripts now copy `browse.js`** - Previously, setup.sh and setup.ps1 only copied ask-gpt.js and ask-gemini.js. Now browse.js is included in both preflight checks and the copy step, so `/review-browser` works in new projects.
- **Playwright/chromium install guidance** - AGENT-SETUP.md, README.md, SETUP.md, and the setup script output now include optional steps for installing playwright-core and chromium. Dependency verification commands added ("Check what's already installed").
- **README "Full Setup (All Features)" section** - One-stop sequence for users who want every optional dependency installed, with verification commands.
- **`/review-browser` prompt improvements** - Self-healing server check (no forced question), auth wall guidance, confirmation step after initial screenshot, session cap (3-5, max 8), failure recovery guidance, `Why` field in finding template, network failure example in docs.
- **`/explore` prompt improvements** - UI/UX Preferences scope fixed (works after vision mode Hold/Reduce), Scope Dial Expand termination (caps at 3), mixed-signal tiebreaker asks user instead of silently defaulting, phase markers for transitions, vision-mode closing summary maps to `/create-plan` fields and includes diagrams.

---

## 2.3

- **`/review-browser` command** (issue #63) - QA a running web app using a headless browser. Claude navigates pages, clicks buttons, fills forms, takes screenshots, and reports findings with visual evidence. Uses a single-session JSON-in/JSON-out model with passive diagnostics (console errors, page errors, failed network requests).
- **`scripts/browse.js`** - Standalone headless browser script powered by Playwright. Accepts a JSON action sequence via stdin, runs all actions in one browser session, and returns structured JSON results. Supports `goto`, `click`, `fill`, `screenshot`, `text`, and `wait` actions with selector prefixes (`css:`, `text:`, `role:`).
- **`playwright-core` dependency** - Library-only install (no auto-download). Browser binary installed separately via `npx playwright-core install chromium`.
- **`/review-ux` cross-reference** - Updated to point users to `/review-browser` for testing running applications.

---

## 2.2

- **`/worktree` command** - Create an isolated parallel session from inside Cursor with one command. Creates a worktree, installs npm dependencies, copies `.env.local`, and prints the path to open in a new window. Pairs with `/document` for end-of-session cleanup (PR creation and worktree deletion).
- **`cp` permission added** - `Bash(cp *)` added to `settings.local.json` for copying `.env.local` into worktrees.

---

## 2.1.1

- **API-KEYS.md guide** - New beginner-friendly guide for setting up API keys using environment variables (recommended) or `.env.local` (fallback). Covers OpenAI and Gemini setup for bash/zsh and PowerShell.
- **Plan folder convention** - Plans now live in `.claude/plans/PLAN-issue-XX.md` (matching PLM project pattern). `/create-plan`, `/review-plan`, and `/review-full` updated. Legacy root-level plans still detected.
- **Version numbers aligned** - `package.json` (2.1.0), `VERSION` (2.1), and `CHANGELOG` now agree.
- **PowerShell .gitignore merge** - `setup.ps1` now merges `.gitignore` entries instead of overwriting (matching `setup.sh` behavior).
- **Script improvements** - File size guard (500KB limit), progress feedback during API calls, Gemini client initialized once, tighter transient error detection.
- **README setup restructured** - Two-path decision (Quick Setup vs Reusable Command) replaces four equal-weight options. Advanced options in collapsible section.
- **Debate file safety** - `/ask-gpt` and `/ask-gemini` now write each round to separate files and concatenate at summary, preventing data loss from mid-write errors.
- **Command prompt fixes** - Clearer wording in debate commands, explicit file overlap guidance in `/execute`, commit convention reference in `/document`, error handling notes, routing header on `/pair-debug`, `<rules>` tags on `pair-debug` and `create-issue`.
- **Explore Phase 2 structured** - Codebase analysis phase now has clear guidance on what to look at, when to stop, and what to present.
- **Missing permissions added** - `git worktree` and `git rev-parse` in `settings.local.json`.

---

## 2.1

- **Worktree support for multi-session workflows** - Running multiple Claude Code sessions no longer causes branch conflicts. The toolkit now detects worktree sessions and manages them automatically.
  - `/explore` and `/create-plan` auto-rename the worktree branch to `worktree-<issue-number>-<short-label>` when an issue is referenced
  - `/document` creates a PR from the worktree branch and offers to delete the worktree folder when you're done
  - New "Worktree Workflow" section in toolkit rules with setup guidance and conventions
  - `git worktree` added to the permissions table

---

## 2.0

- **`/review` renamed to `/review-code`** - The old `/review` command is now `/review-code`. Same functionality, plus a 4th sub-agent (Performance & Maintainability) and severity anchors.
- **4 new review commands** - Specialized reviews for different types of work:
  - `/review-commands` - Review slash command prompts for quality, workflow completeness, and cross-command consistency. Staff PM check.
  - `/review-plan` - Check if implementation matches a plan file. Auto-detects the most recent plan in `.claude/plans/`. Staff PM check.
  - `/review-ux` - UX review from code/markup - usability, accessibility, user flows, plus competitive research via web search. Staff Designer check.
  - `/review-full` - Pre-release cross-domain check. Mile wide, inch deep. Ends with Ready / Ready with conditions / Not ready recommendation. Staff Architect check.
- **Severity anchors** - All review commands share minimum severity floors: security exposure, data loss, accessibility blockers, and unmet requirements are never downgraded below Warn.
- **"Use this when" guidance** - Every review command now has clear guidance at the top for when to use it and when not to.
- **Removed `/ui-spec` command** - The `/ui-spec` command, `.claude/ui-reference/` folder, and all references have been removed. UI/UX preferences are now handled directly in `/explore` and `/create-plan`.
- **UI/UX preferences in `/explore` and `/create-plan`** - `/explore` now proactively asks about look and behavior for UI features. `/create-plan` includes an optional UI/UX Design section in the plan template.

---

## 1.4.4

- **Full default permissions** - `settings.local.json` now ships with 51 permissions covering all toolkit workflows (git, gh, npm, debate scripts, file tools, web tools, utilities). New projects no longer need to approve actions one by one. (Issue #53)
- **Permission syntax fix** - Migrated from deprecated `:*` syntax to space-asterisk (`Bash(git commit *)`) across both settings files.
- **Command templates use Write tool** - `/ask-gpt` and `/ask-gemini` now use Claude's Write tool instead of `cat` heredocs for creating context and debate files. Avoids permission prompts and follows Claude Code best practices.
- **`defaultMode: acceptEdits`** - New projects default to auto-approving file edits after a command is given. Plans and reports still show before execution.
- **Cleaned up settings.json** - Removed 3 redundant permission entries that are now covered by `settings.local.json`.

---

## 1.4.3

- **Fix: stale global commands** - Setup scripts (`setup.sh`, `setup.ps1`) now detect when `~/.claude/commands/` has files that share names with toolkit commands and warn you. Global copies override project-level commands, which causes outdated behavior even after updating the toolkit. Fix: delete the global copies. (Issue #52)
- **Troubleshooting docs** - Added "Commands seem outdated" entry to AGENT-SETUP.md, SETUP.md, and README.md.

---

## 1.4.2

- **Version discoverability** - Setup now stamps the installed version into `.claude/rules/toolkit.md` so users can check what version they're running. README has a new "Checking Your Version" section explaining where to look and how to update.
- **README: "How It Works" section** - New section explaining the file architecture: which files are yours (CLAUDE.md, LESSONS.md) vs. managed by the toolkit (toolkit.md, commands). Answers "why is CLAUDE.md empty?" and "how does Claude find toolkit.md?"
- ~~**README: "UI Spec & Design" section** - New section explaining what `.claude/ui-reference/` contains, that reference files are read-only libraries, and the `/ui-spec` -> `UI-SPEC-*.md` -> `/execute` flow.~~ (Removed in v2)
- **CLAUDE.md guiding comments** - Added HTML comments explaining this file is yours and pointing to toolkit.md and README for context.

---

## 1.4.1

- **XML structural tags** - Added XML tags (`<rules>`, `<procedure>`, `<template>`, `<output_format>`, `<conditions>`, `<guidelines>`, `<reference>`, `<phase>`, `<examples>`) to 9 AI-parsed files. Helps AI models distinguish content types (rules vs templates vs examples). Markdown headers stay for readability; XML wraps content blocks for parsing. No behavior change for users.

---

## 1.4

- *Note: This version introduced `/ui-spec` and related UI features, which were removed in v2.0.*
- **Model updates** - `/ask-gpt` now defaults to GPT-5.4 (was 5.2). `/ask-gemini` now defaults to Gemini 3.1 Pro Preview (was 3 Flash Preview).

---

## 1.2

- **`/review` refined** - Cleaned up the two-mode review introduced in v1.1 (removed "What Claude Missed" self-check, simplified sub-agent coordination).
- **Toolkit versioning** - Setup scripts now display version number in banner. VERSION file at repo root.

---

## 1.1

### Ruflo Patterns

Adopted 5 patterns from AI research to improve the core commands.

**`/review` - Simplified Two-Mode Review:**
- Small changes (1-2 files): single-pass review, no sub-agents
- Bigger changes (3+ files): three focused sub-agents in parallel - Security, Code Quality, Logic
- Severity: 🚫 Block / ⚠️ Warn / 💡 Suggest
- Finding IDs (R1, R2...) - say "fix R2 and R5" to approve specific fixes
- Staff Engineer Check for big-picture evaluation

**`/pair-debug` - New Command:**
- Focused debugging partner (not a teacher - that's `/learning-opportunity`)
- Logs-first habit: always starts with "check the logs"
- Repro contract: gathers expected vs actual, error text, environment
- Hypothesis + check IDs (H1/H2, C1/C2) - user picks which check to run

**`/create-plan` - Parallelization Tags:**
- Steps tagged `[parallel]` or `[sequential]` with deliverables and dependencies
- Optional Goal State section for features with 3+ steps

**`/execute` - Parallel Execution:**
- Pre-flight check: lists files per agent, downgrades to sequential if overlap
- User confirmation before spawning parallel work
- Integration checkpoint after parallel steps complete

**Compaction:**
- `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` set to 65% in `.claude/settings.json`

---

### Breaking: CLAUDE.md Split

Toolkit instructions have moved out of `CLAUDE.md` into `.claude/rules/toolkit.md`.

**What changed:**
- `CLAUDE.md` is now a short, project-specific template (your project info, preferences)
- `.claude/rules/toolkit.md` contains all toolkit rules (workflow, commands, git guidance, permissions)
- `toolkit.md` is auto-loaded by Claude Code and always updated when you re-run setup
- `CLAUDE.md` is never overwritten - it's yours to customize

**What existing users need to do:**
1. Re-run setup (`setup-claude-toolkit .` or `bash /path/to/setup.sh`)
2. Move any project-specific info from your old `CLAUDE.md` into the new `CLAUDE.md` template
3. Delete your old `CLAUDE.md` and re-run setup if you want a fresh template

**Why:** Previously, toolkit updates couldn't reach existing users because `CLAUDE.md` was skipped if it existed. Now, toolkit rules update automatically via `toolkit.md`, and your project info stays safe in `CLAUDE.md`.

### New Features

- **LESSONS.md** - Track what you learn across sessions. Created on first setup, never overwritten.
- **Staff Engineer Check** in `/review` - Big-picture evaluation: right approach, shortcuts to clean up, what to push back on
- **Outcomes section** in `/create-plan` - Record what actually happened vs. what was planned
- **"When to Stop"** in `/execute` - Stop and re-plan on critical blockers instead of pushing through
- **Subagent Strategy** - Guidance for Claude to use subagents for research and parallelize independent work

### Fixes

- **`/document` command** - Now aware of LESSONS.md and CHANGELOG.md. Includes file ownership guidance (won't edit `toolkit.md`). Clarifies what goes where: README for features, CLAUDE.md for project info, CHANGELOG for user-facing changes, LESSONS for learnings.
