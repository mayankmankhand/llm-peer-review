# Changelog

## Unreleased

### Added
- **Lessons now feed back into future runs** (#125) - `LESSONS.md` used to be written but never read, so the same mistakes could recur. It is now split into a short always-read index (`LESSONS.md`, one line per lesson) plus full write-ups in a new `LESSONS-detail.md` that load on demand. `/explore`, `/create-plan`, `/execute`, and `/pair-debug` read the index at session start (the same point they read `CODEBASE_MAP.md`; `/execute` reads lessons but not the map) and open a lesson's detail only when it is relevant, keeping the per-session cost to the ~1.3k-token index instead of the ~8k-token detail file. `/document`'s capture step now shows the current index first to avoid duplicates, writes new lessons to both files, and runs a dedupe/cleanup pass, with a tightened trigger (the same mistake twice, a review caught something Claude should have known, or you repeated a correction); capture stays user-approved. Backward compatible: a pre-split flat `LESSONS.md` is still read whole. Both installers seed `LESSONS-detail.md` only on a fresh install (an existing flat `LESSONS.md` is preserved, with a migration tip). Re-run `setup.sh` / `setup.ps1` to pick it up.
- **Conditional unit-test steps in `/create-plan`** (#121) - Plans now decide for themselves whether to include a dedicated "Verify" test step, instead of never planning tests. A new `## Test Steps (conditional)` block (modeled on the existing "Execution Order Tags" conditions) adds the step when the plan changes verifiable logic - WRITE new tests for new business logic (a pricing calculator), RUN existing tests after a refactor of covered code (a parser) - and skips it for docs/config/comment-only or exploratory/research plans ("when in doubt, skip it"). The decision reads from the task descriptions plus `CODEBASE_MAP.md` signals (a `tests/` directory, a test framework in dependencies); no extra codebase scanning. When the project has no test runner, the plan adds a flagged *optional* "Set up <framework> (optional - recommended)" step with the idiomatic tool auto-detected (Vitest/Jest for JS, pytest for Python; generic wording if unclear); the Verify step depends on the code steps and never on that optional step, so deleting it never leaves a dangling reference. Each test step carries a plain-English `_Why this step:_` note for non-technical readers.

### Changed
- **Plan creation is now roughly 2x faster** (#129) - `/create-plan` was the last default-on command that hand-wrote its entire HTML view as model output (~2,950 slow tokens per plan, roughly doubling plan-creation time). It now emits a compact JSON payload that `render-html.js` injects into a new prebuilt `plan` shell. Two new helper flags make the migration possible: `--out-dir <dir>` (plan views land in `plans/`, next to their canonical markdown) and `--stable` (writes exactly `<name>.html` with no timestamp and overwrites on re-run - the right behavior for identity-keyed views that are replaced on re-plan). The `/audit-html` opt-in static view migrated the same way onto a new generic `docview` shell (block-based JSON: prose, lists, tables, code) with sortable tables and auto-collapsing long sections built into the shell once. Default helper behavior for the five existing artifact types is unchanged. `/playground` is now the only hand-rendered HTML in the toolkit. Re-run `setup.sh` / `setup.ps1` to pick up the updated helper.
- **`/review-plan` Quality Gate softened to match** (#121) - The plan-compliance reviewer's gate changed from "Tests written?" to "Tests written (when the plan warranted them)?" so it no longer flags plans that correctly skipped tests. This closes a loop: `/review-plan` already graded test presence, but `/create-plan` never planned tests, so a plan could be dinged for something the planning step never asked for.

---

## v5.1.0 - HTML Render Pipeline (2026-06-09)

A performance, reliability, and accessibility overhaul of how toolkit commands produce HTML. Three issues. **#120:** review (and every other) HTML report now opens fast - commands stopped hand-writing the whole ~13KB file and instead emit a compact JSON payload that a new helper injects into a prebuilt shell. **#127:** HTML files are now uniquely timestamped, so a same-day re-run never collides and the old "Claude must read the stale file before overwriting it" double-cost is gone. **#122:** `/explore`'s options HTML now fires reliably (the gate is unchanged - vision mode + 2+ options - but the step is explicit and unmissable). Markdown stays canonical everywhere; this only changes how the HTML view is generated. Re-run `setup.sh` / `setup.ps1` (or follow `AGENT-SETUP.md`) to pick it up.

### Added
- **`render-html.js` data-injection pipeline** (#120, #127) - New zero-dependency `.claude/scripts/render-html.js` is the single renderer for all five cycle-bound HTML types (review, document, explore, debate, audit report). A command emits only a compact findings JSON; the helper injects it plus the shared design tokens into a prebuilt shell, computes a unique `YYYY-MM-DD-HHMMSS` filename (with a `-N` same-second guard), and writes a self-contained file (inline CSS + JSON + renderer JS, no CDN, works offline). Because a script overwriting a file has no "read-before-overwrite" constraint, the stale-file read-then-overwrite cycle that doubled cost on same-day re-runs is eliminated. The helper validates `--shell` against an allowlist (no path traversal) and escapes `<`, U+2028, and U+2029 in the JSON island so embedded markup cannot break the data block.
- **Prebuilt shells + shared `tokens.css`** - New `.claude/skills/shared/shells/` holds one `<type>-shell.html` per output (inline CSS plus a vanilla-JS renderer that builds the DOM from the injected JSON, with graceful handling of missing/empty fields) plus `tokens.css`, the machine-usable mirror of `html-look.md`. Both installers now copy the new folder and script, and a `Bash(node .claude/scripts/render-html.js *)` permission is merged into downstream `settings.local.json`.

### Changed
- **HTML generation rewired across `/review` (+ 8 specialists), `/document`, `/explore`, `/ask-gpt`/`/ask-gemini`, `/audit-html`** - These now produce JSON and call the helper instead of hand-writing HTML. The shared `html-render-review.md` / `html-render-debate.md` templates were rewritten to document the data schema and helper call, and the commands no longer inline `html-look.md` (the helper injects `tokens.css`). The gates that decide *when* to render are unchanged. Hand-rendered exceptions kept as-is: plan HTML (`/create-plan`), the `/audit-html` single-file static view, and `/playground`.
- **Timestamped artifact naming** (#127) - Files in `artifacts/html/` are now `<name>-YYYY-MM-DD-HHMMSS.html`. Plan HTML and the audit single-file view keep their stable identity-keyed names.
- **`/explore` options HTML made reliable** (#122) - The options-comparison HTML step is now an explicit "REQUIRED when 2+ options are being compared" instruction with a sharp definition of what counts (two or more distinct, named directions the user is actively deciding between, each with a tradeoff). The gate (vision mode + 2+ options) is unchanged; it was previously an easy-to-skip sub-bullet.

### Fixed (accessibility + robustness pass)
- **Warn color now meets WCAG AA** - The amber used for warn text and badges was 3.2:1 (below the 4.5:1 AA floor). A darker `--warn-strong` (`#b45309`, ~5:1) now backs text and badge surfaces, while the bright `#d97706` stays for the decorative card border only. Corrected a false "all three pass AA" claim in `html-look.md`.
- **No-JS fallback, landmarks, and headings** - Each shell now carries a `<noscript>` note (the old hand-written HTML rendered without JS; the shell+renderer approach needed a fallback), wraps its content in a `<main>` landmark, and renders card titles / group labels as real headings for screen-reader navigation. The `/document` commit chart gained a `role="img"` plus a summarizing `aria-label`, and the `/audit-html` verdict gained a non-color glyph cue (color is no longer the only signal).

Re-run `setup.sh` / `setup.ps1` (or follow `AGENT-SETUP.md`) to pick this up.

---

## v5.0.1 - WSL Opener + Windows Installer Fix (2026-06-08)

Two fresh-install reliability fixes. **#119:** HTML artifacts now open reliably on WSL - the opener moved from prose Claude ran by hand into a deterministic script (`.claude/scripts/open-artifact.sh`) with real fallback, so it no longer silently no-ops when no browser launcher is on PATH. **#126:** the Windows installer (`setup.ps1`) now copies `generate-index.js`, so `/index` and `/document` work out of the box on fresh Windows installs (closing a follow-up deferred in v5.0.0). Windows users who installed before this version should re-run `setup.ps1` to pick up the fix.

### Fixed
- **HTML opener silently failed on WSL** (#119) - The "Opening the Artifact" step in `html-outputs.md` was prose Claude ran by hand (`wslview` -> `explorer.exe` -> `xdg-open`); on a WSL distro with none of those on PATH it silently no-opped and the artifact never displayed. Replaced with `.claude/scripts/open-artifact.sh`: deterministic platform detection (macOS `open`; WSL `wslview` -> located/full-path PowerShell `Start-Process` -> `explorer.exe`; native Linux `xdg-open` gated on `DISPLAY`), real exit-code-driven fallthrough, apostrophe-safe Windows path quoting, and a genuine-headless exit-1 that prints the path. `html-outputs.md` now calls the script and branches on its exit code; a single narrow permission `Bash(bash .claude/scripts/open-artifact.sh *)` replaces the per-launcher permission surface, and the script is propagated by both installers. Also reconciled a contradiction: `html-outputs.md` had claimed `/playground` "opens the same way", but playground intentionally does not auto-open.
- **`setup.ps1` never copied `generate-index.js`** (#126) - The Windows installer omitted the index-generator script, so fresh Windows installs hit `MODULE_NOT_FOUND` when `/index` (and `/document`'s map refresh) ran; `setup.sh` already copied it. `setup.ps1` now copies `generate-index.js` (and the new `open-artifact.sh`) via a dep-free `foreach` plus a preflight check, mirroring `setup.sh`. Closes the follow-up explicitly deferred in v5.0.0. A `PARITY:` comment in both installers and a corrected `bump-version.sh` header guard against the recurring "update one installer, forget the other" drift. The sibling `VERSION`-copy gap noted in v5.0.0 was verified inert (nothing downstream reads `$TARGET/VERSION`) and deliberately left as-is.

Re-run `setup.sh` / `setup.ps1` (or follow `AGENT-SETUP.md`) to pick this up.

---

## v5.0.0 - HTML Milestone (2026-05-25)

The major version bump marks a milestone, not a breaking change - everything here is additive. v5.0.0 brings HTML output to the toolkit. Toolkit outputs a human reads (plans, reviews, debate summaries, the `/document` cycle summary, `/explore` option comparisons) can now render an HTML view alongside the canonical markdown, governed by one rule file (`.claude/rules/html-outputs.md`). The new `/playground` skill produces throwaway interactive HTML for in-the-loop decisions, and the new `/audit-html` skill helps downstream projects spot their own markdown that would read better as HTML. Markdown stays the source of truth everywhere; HTML is the rendered view for the human. Re-run `setup.sh` (or follow `AGENT-SETUP.md`) to pick it up.

### Added
- **HTML output rule and shared visual reference** (#113) - Foundation for #102. New `.claude/rules/html-outputs.md` documents when toolkit commands produce HTML: the Reader/Claude principle (markdown for Claude, HTML for the human, playground for the user-doing-something), the default-on list (`/codebase-to-course`, `/create-plan`, `/document` cycle summary), Claude's-judgement triggers per other command, and the playground export-loop rule. New `.claude/skills/shared/html-look.md` defines minimal v1 visual tokens: typography, neutral color palette, severity badge hex (Block `#dc2626`, Warn `#d97706`, Suggest `#2563eb`), and the copy-button pattern. `setup.sh` and `setup.ps1` propagate the new rule with the same version-stamp pattern as `toolkit.md`; `bump-version.sh` now stamps both rule files per release. New gitignored `artifacts/html/` for cycle-bound HTML output. Sub-issues B (playground skill), C (plans + reviews HTML), D (explore + debate + document HTML) build on top of this foundation.
- **HTML output for `/create-plan` and `/review` family** (#115) - Sub-issue C of #102. Plans get default-on HTML at creation: `/create-plan` writes `plans/PLAN-*.html` alongside `PLAN-*.md` as a one-shot snapshot (never re-rendered by `/execute`). Reviews get HTML when Claude's judgement gate fires - 3+ findings, OR visual evidence (browser screenshots), OR severity mix spans 2+ levels (e.g. Block + Warn). New shared snippet `.claude/skills/shared/html-render-review.md` inlines into all 9 review surfaces (`/review` orchestrator + 8 specialists) so rendering logic stays in one place: HTML skeleton, finding card template, severity-colored left borders, `vscode://` file:line links that resolve in Cursor/VS Code and degrade gracefully elsewhere, sticky Top Issues header, and the announce-upfront message ("Generating an HTML view because [reason]. Say 'skip HTML' if you want markdown only."). The orchestrator and `/review-full` render a Specialist Chips header showing which domains were covered; specialists called directly skip the chips. Subagents dispatched by `/review` do NOT emit their own HTML - only the orchestrator writes the combined HTML, preventing duplicate artifacts. Markdown remains canonical everywhere. New tracked `artifacts/README.md` makes the gitignored `artifacts/html/` directory discoverable in fresh clones. `.gitignore` now also covers `plans/PLAN-*.html` so plan HTML companions never enter the repo.

- **HTML output for `/explore`, debate summaries, and `/document`** (#116) - Sub-issue D of #102, completing user-facing HTML coverage. Three wirings, all reusing the #115 shared look (`html-look.md`): (1) `/explore` vision-mode option comparison writes a persisted side-by-side `artifacts/html/explore-{topic}-{date}.html` when 2+ options are compared (Claude's judgement); the existing `/playground` dispatch stays a separate interactive path (throwaway in `/tmp/`). (2) `/ask-gpt` and `/ask-gemini` Step 6 generate a debate-summary HTML (per-round Claude-vs-model two columns + synthesis) when the final summary lists 3+ Recommended Actions; a new shared template `.claude/skills/shared/html-render-debate.md` holds the gate, naming, and structure for both commands. (3) `/document` generates a default-on one-page cycle summary `artifacts/html/document-{date}.html` every run, scoped to "since the last `/document` run" via an `artifacts/html/.last-cycle` marker (commit SHA, written as the final step so an interrupted run re-summarizes rather than skips); the first run falls back to the last merged PR. `/explore` and `/document` read `html-look.md` on demand (only when generating) rather than always-inlining, since they run often but rarely produce HTML; the debate commands inline it because the template also carries gate logic. The debate HTML gate is a single countable trigger (3+ Recommended Actions) kept consistent across the template, both command headings, and `html-outputs.md`. D4 (`/learning-opportunity`) and D5 (`/pair-debug`) deferred to a follow-up. No `setup.sh`/`setup.ps1`/`bump-version.sh`/`.gitignore` changes needed: the shared-file glob and existing `artifacts/html/` ignore cover the new template and marker.

- **`/audit-html` skill and HTML-feature install/upgrade nudge** (#117) - Closes the discovery gap from #102: downstream installs and version-bump upgrades previously had no way to learn that the HTML feature existed or to apply the same "markdown is the source, HTML is the view" principle to their own project's markdown. Three pieces: (1) `.claude/rules/html-outputs.md` gains a "Your Own Files (downstream projects)" section that documents the two-layer principle (toolkit outputs already render HTML automatically; the project's own long human-read markdown can get optional additive views), the signal taxonomy (read-every-session tracker, walls of text, file-the-human-hunts, existing hand-built HTML view), and the hard vetoes (Claude-read, canonical / data-source self-description, GitHub-native, lives in `.claude/`). The section declares itself the source of truth that the new skill inlines verbatim. (2) New `.claude/skills/audit-html/SKILL.md` (`/audit-html`): scans the project's markdown via `Glob` (excluding `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`, `vendor`, `target`, `__pycache__`, `.claude/`, plans, artifacts, plus `.gitignore` output dirs), applies the signals and vetoes, reports candidates with the "why" each fired, detects existing HTML-generation infrastructure (a `package.json` dashboard script or a `.js` that reads `.md` and emits HTML) and offers to align it with `html-look.md` tokens instead of rebuilding, and renders a static view of the top candidate only on explicit request. Report-only by default; the source markdown is never touched. (3) `setup.sh` and `setup.ps1` capture an `IS_UPGRADE` flag before any `mkdir`/copy runs (presence of `.claude/rules/toolkit.md` is the upgrade signal), then print a "new this version" announcement on upgrade (independent of the legacy-migration gate, so a plain version bump no longer lands silently) and add a Step 5 in "What to do next" pointing fresh installs at `/audit-html`. New `Skill(audit-html)` and `Skill(audit-html:*)` permissions in the committed `settings.local.json` baseline; README "Update an Existing Project" and AGENT-SETUP "After Setup" each gain a one-line additive-not-migration nudge.

### Fixed
- **`setup.ps1` never copied `.claude/skills/`** (#113, discovered mid-execution) - Pre-existing gap surfaced while implementing #113: the PowerShell installer had no skills propagation logic at all, so Windows users running `setup.ps1` received no review skills, no learning-opportunity skill, and no shared reference files. Now mirrors the bash skills loop (`shared/*.md` first, then each per-skill directory) with matching try/catch error handling. Two related setup.ps1 gaps remain as potential follow-ups (no `VERSION` copy, no `generate-index.js` copy).
- **Review fixes on the #113-#116 HTML feature** (#102 follow-up) - A diff review of the shipped sub-issues surfaced gaps, now fixed:
  - `setup.sh` and `setup.ps1` create `artifacts/` and propagate the tracked `artifacts/README.md`. Previously orphaned: the feature wrote to `artifacts/html/` downstream but the orientation README never shipped, and `.gitignore` pushed an `artifacts/html/` rule for a directory that did not exist (R1).
  - HTML artifacts auto-open in the user's browser (`open` / `wslview` / `explorer.exe` / `xdg-open`) via a new "Opening the Artifact" rule in `html-outputs.md`. Previously the user got a file link that opens HTML source in the editor, not the rendered page (R4).
  - `bump-version.sh` collapses its two duplicated version-stamp blocks into one loop over a `RULES_FILES` array (R6).
  - `/ask-gpt` and `/ask-gemini` HTML headings match the review skills ("HTML Companion (when gate fires)") with the 3+ Recommended Actions trigger stated in the body (R7).
  - `/explore`'s HTML bullet is now four scannable sub-bullets marking the `artifacts/html/` file as the canonical record and the playground as the disposable throwaway (R9, R14).
  - `/document`'s cycle summary states its chosen window in plain English on fallback so a wrong scope (e.g. a marker from another branch) is catchable (R10).
  - `artifacts/README.md` corrected (plan renders live in `plans/`, not `artifacts/`) and gained a disposability note (R5).

---

## v4.6.0 - Debate Hardening

### Changed
- **`/ask-gpt` and `/ask-gemini` final summaries now use the 4-field finding structure** (#103, PR #104) - Each Recommended Action emits What / Why it matters / Example / Suggested fix, sourced from the canonical `.claude/skills/shared/output-template.md` via a new `loadOutputTemplate()` slice. Mid-debate severity vocabulary unified from `[CRITICAL/MAJOR/MINOR]` to 🚫/⚠️/💡 + R-IDs, matching `/review`. End-to-end the user now sees one severity language across `/review`, `/ask-gpt`, and `/ask-gemini`.
- **"Disagreed Points" emoji changed from ⚠️ to 🤔** to avoid collision with Warn severity in the same report.
- **`loadOutputTemplate()` is lazy and memoized** via a `get summary()` getter on the PROMPTS object. The `review` and `respond` paths still work when the template file is missing; only `summary` requires it.
- **Loud-failure error paths** when the shared template is missing or the slice marker has been renamed. Errors name both scripts and the specific marker constant to update, satisfying the mirror-parity requirement.
- **Skill permissions for `/explore`, `/create-plan`, `/execute`, `/review`** added to `.claude/settings.local.json` so subagents do not prompt mid-flow.

### Fixed
- **`/ask-gpt` and `/ask-gemini` silent empty bodies** (#101) - Both scripts previously returned `''` with exit code 0 when a token cap was exhausted by reasoning tokens, a refusal hit, or a safety block triggered. Detection now actively inspects `finish_reason` / `finishReason`, `refusal`, `safetyRatings`, and reasoning/thoughts token counts, then throws a descriptive error naming the cause AND the fix (e.g. "Raise GPT_MAX_TOKENS or shorten the input"). Truncation (`finish_reason: length` with non-empty content) prints a stderr warning with token counts but does not fail.
- **`/ask-gpt` and `/ask-gemini` token caps raised from 4096 to 32000** (#101) - The previous 4096 cap could be entirely consumed by reasoning/thinking tokens on long contexts, leaving zero for visible output. New `GPT_MAX_TOKENS` / `GEMINI_MAX_TOKENS` env overrides for users who want a lower cap to limit cost.
- **`/ask-gpt` and `/ask-gemini` tab-collision in /tmp paths** (#101) - Two parallel Cursor or Claude Code tabs running the same command would clobber each other's `/tmp/ask-*-{context,debate}.md` files. Each invocation now generates a session ID (`$(date +%s)-$RANDOM`) via Step 1.5 of the command and embeds it in every temp file path. The debate file's first line is `<!-- Session: <id> -->` so the ID stays recoverable after context compression. A `warnIfSessionMismatch` helper warns when `--context-file` and `--debate-file` carry different session IDs.

### Notes
- **Mirror parity** between `ask-gpt.js` and `ask-gemini.js` (and between their `.md` command files) is enforced by convention. Any change to one is mirrored in the other; the loud-failure error message reminds future editors to update both scripts when the slice marker is renamed.
- **Settled action items from the post-merge `/ask-gpt` + `/ask-gemini` debate** (PR #104 follow-up): replace heading-based template slicing with explicit `BEGIN_REVIEW_FINDING_OUTPUT_CONTRACT` / `END_...` markers, narrow the slice to just the reusable finding contract, rename the helper to `loadFindingOutputContract()`, bracket-wrap meta-instructions in the summary prompt, align R-line shape across all surfaces, standardize the recovery command on `git restore`. Not in this release; tracked as a future follow-up titled "Harden debate summary prompt against template drift."
- **Re-running setup** picks up the new scripts, the new permissions, and the updated command files.

---

## What's new since v4.3.3

If you last installed v4.3.3, six releases have shipped on top of it. v4.4.0 replaced the old flat-tree `INDEX.md` with a semantic `CODEBASE_MAP.md` that `/explore`, `/create-plan`, and `/pair-debug` read at session start. v4.4.1 tightened every review skill to a 4-field `What / Why it matters / Example / Suggested fix` structure so even low-severity findings feel justified. v4.5.0 added a stale-model safety net so `/ask-gpt` and `/ask-gemini` auto-override known-old defaults in `.env.local` and print the model that actually fired. v4.5.1 is a documentation-only release: README repositioned for newcomers, AGENT-SETUP graveyard trimmed, unmeasured cost claims removed, broken anchors fixed. v4.6.0 hardens the debate path: silent empty bodies and parallel-tab `/tmp` collisions are gone (#101), and `/ask-gpt` + `/ask-gemini` final summaries now use the same 4-field finding structure as `/review` (#103). v5.0.0 is the HTML milestone: human-read toolkit outputs (plans, reviews, debates, cycle summaries, `/explore` comparisons) gain optional HTML views, plus the new `/playground` and `/audit-html` skills - all additive, with markdown still canonical. Re-run `setup.sh` (or ask your AI agent to follow [`AGENT-SETUP.md`](AGENT-SETUP.md)) to pick everything up. See full per-version details below.

## v4.5.1 - Documentation Audit

### Changed
- **README rewrite for non-AI-fluent newcomers** (#99) - Repositioned for colleagues you would forward the link to. New headline ("AI peer review for your work."), debate-output screenshot moved to the top as the orientation hook, new "How key commands work" section with 4-6 line callouts for `/explore` (scoping vs vision modes), `/create-plan`, `/execute`, `/review`, `/ask-gpt` and `/ask-gemini`, `/create-issue`. AGENT-SETUP path promoted to the recommended setup option. "Slash command", "Cursor", and "Claude Code" are now defined inline before any command name is referenced.
- **"What's new since v4.3.3" rollup** added at the top of CHANGELOG.md and linked from README so returning users get one upgrade story for v4.4.0 -> v4.4.1 -> v4.5.0 -> v4.5.1 instead of reading four release notes separately.
- **AGENT-SETUP.md graveyard trimmed.** Kept only the last three release-notes blocks inline (v4.5.0, v4.4.1, v4.4.0). Older entries point at CHANGELOG.md. File shrank from 291 to 213 lines.
- **Cost claims removed** from CHANGELOG.md (v4.4.0 entry) and AGENT-SETUP.md per the issue 99 review comment. Replaced "a few dollars" and "10-40k tokens saved" projections with "See `/index` output for actual cost."
- **API-KEYS.md** gained a "deprecated model warning" subsection explaining v4.5.0's auto-override behavior in plain language. Verified current defaults (`gpt-5.5`, `gemini-3.1-pro-preview`) match the JS sources.
- **SETUP.md** got a beginner-clarity pass: top-of-file pointer to AGENT-SETUP as the recommended path, one-line explainers for Node.js, GitHub CLI, Cursor, and npm.
- **CONTRIBUTING.md** Releasing section updated with the v4.5.0 model-bump checklist ordering and the `gh release create` step.
- **`.claude/rules/toolkit.md`** permissions table reconciled with `.claude/settings.local.json` (missing rows added for `git rev-list`, `bash scripts/setup/bump-version.sh`, `bash -n` syntax checks, the `GPT_MODEL=... node -e` probe entry, and `Skill(review-commands)`).
- **LESSONS.md** received a single annotation on the "version bumps touch more files than you think" entry to reflect setup.sh's path under `scripts/setup/`.

### Fixed (found during `/review-copy` of the rewritten README)
- **"Slash command" never defined** for the new newcomer audience - now explained inline in the opening section with a one-sentence framing of Claude Code and Cursor as the editors where slash commands live.
- **"What's new" placement** interrupted first-time readers - moved below Requirements so it does not block the headline-to-workflow-to-commands narrative.
- **"Tell your AI agent" instruction** did not say where to paste the message - now specifies the AI chat panel.
- **Broken internal anchors** discovered during link verification: README's `SETUP.md#step-4-...-bash-workflow` (heading was renamed during the SETUP audit) and API-KEYS's `README.md#full-setup-all-features` (section was consolidated). Both retargeted to live anchors.

### Notes
- **No behavior, workflow, or setup-script changes.** Re-running setup refreshes the doc files copied to downstream projects (`CLAUDE.md`, `LESSONS.md`, and `settings.local.json` are still preserved per existing rules).
- **Slash command files and skill files were not modified.** The user reviewed the audit framing for these prompt files mid-execution and judged them current. A new `feedback-prompt-files-approval` memory captures that prompt files require explicit per-change approval going forward.
- **`/ask-gemini` did not run** for this release - issue 99 worked through the structured `/explore` -> `/create-plan` -> `/execute` -> `/review-copy` flow rather than a debate cycle.

---

## v4.5.0 - Model Default Safety Net

### Added
- **Stale-model auto-override in `/ask-gpt` and `/ask-gemini`** (#100) - Each script now holds a `KNOWN_STALE_*_MODELS` list. If `GPT_MODEL` or `GEMINI_MODEL` in `.env.local` matches a previous default (e.g. `gpt-5.2`, `gpt-5.4`, `gemini-3-flash-preview`), the script ignores the env value, uses the current default, and prints a one-line warning. Custom values not on the stale list are still respected silently - this only catches users who copied an old `.env.local.example` once and never updated. Result: latest toolkit = latest models, no manual file edits required.
- **"Using <provider> model: X" print on every script run.** `ask-gpt.js` and `ask-gemini.js` print which model fired at the start of each invocation so users can confirm overrides took effect and notice when an auto-override happened.
- **Setup output shows current model defaults.** `scripts/setup/setup.sh` extracts the defaults from the runtime scripts at install time (greps `const DEFAULT_*_MODEL = '...'`) and prints them before "What to do next", with a one-liner noting we never read or write `.env.local`.
- **Maintainer reminder in `bump-version.sh`.** A new manual-TODO bullet covers updating `DEFAULT_*_MODEL`, appending the previous default to `KNOWN_STALE_*_MODELS`, and syncing `.env.local.example` + `API-KEYS.md` whenever a model is bumped.

### Fixed (found during `/review`)
- **Stale-model check is now case-insensitive.** A value like `GPT_MODEL=GPT-5.2` (wrong casing from a copy-paste) now triggers the override; previously the lowercase-only comparison silently let it through.
- **"Using model X" and deprecation warning routed to stderr.** Both diagnostic lines now use `console.error` instead of `console.log` so they stay out of the captured `/tmp/ask-*-debate.md` transcript that subsequent rounds re-read.
- **`bump-version.sh` reminder reordered.** The model-bump checklist is now a single ordered step ("append OLD default to KNOWN_STALE FIRST, then update DEFAULT") so a maintainer can't paste the new value into the stale list by accident.
- **Help text wording harmonized between `ask-gpt.js` and `ask-gemini.js`.** Both now say "Stale values are auto-overridden with a warning." instead of listing specific values inline, so the help line scales when more stale values are added later.

### Notes
- **`.env.local` is never read or written by any of this code.** Security design constraint: the file contains API keys, so all override logic lives in the Node scripts where the env value is already in memory. No backup files containing keys are created. No setup-time file edits touch `.env.local`. Users who want to silence the warning edit the file themselves.
- **No model bumps in this release.** Current defaults (`gpt-5.5`, `gemini-3.1-pro-preview`) are unchanged - confirmed via [ai.google.dev](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview) that Gemini 3.1 Pro still ships only as `-preview`. This release is the machinery; future model bumps benefit from it automatically.
- **Issue #100's original framing was scoped up during `/explore`.** The issue asked for a passive "print defaults at end of setup" so users could eyeball-compare. During exploration the scope expanded to an active safety net once it was clear that passive printing relies on users manually fixing stale files - which most don't.

---

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
- **No new permissions needed.** The existing `Bash(node .claude/scripts/generate-index.js *)` permission covers the refactored scanner. Agent tool calls (subagent spawning) are built-in to Claude Code and not gated by allowlist.
- **The v3.4 lesson stands, with nuance.** The original lesson against mid-session scanning was correct, but it was over-applied during v3.4 to cancel one-time upfront generation as well, which left an empty file tree behind. v4.4.0 restores upfront generation while keeping mid-session scanning off. See LESSONS.md for the full re-read.

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
