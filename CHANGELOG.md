# Changelog

<!-- Placement rule: the "What's new since v4.3.3" rollup below stays at the
     top of this file, ABOVE the newest release section. When cutting a
     release, add the new "## vX.Y.Z" section BELOW the rollup and extend the
     rollup paragraph with one sentence for the new version - the README links
     here as "the full upgrade summary", so it must stay current and findable. -->

## What's new since v4.3.3

If you last installed v4.3.3, sixteen releases have shipped on top of it. v4.4.0 replaced the old flat-tree `INDEX.md` with a semantic `CODEBASE_MAP.md` that `/explore`, `/create-plan`, and `/pair-debug` read at session start. v4.4.1 tightened every review skill to a 4-field `What / Why it matters / Example / Suggested fix` structure so even low-severity findings feel justified. v4.5.0 added a stale-model safety net so `/ask-gpt` and `/ask-gemini` auto-override known-old defaults in `.env.local` and print the model that actually fired. v4.5.1 is a documentation-only release: README repositioned for newcomers, AGENT-SETUP graveyard trimmed, unmeasured cost claims removed, broken anchors fixed. v4.6.0 hardens the debate path: silent empty bodies and parallel-tab `/tmp` collisions are gone (#101), and `/ask-gpt` + `/ask-gemini` final summaries now use the same 4-field finding structure as `/review` (#103). v5.0.0 is the HTML milestone: human-read toolkit outputs (plans, reviews, debates, cycle summaries, `/explore` comparisons) gain optional HTML views, plus the new `/playground` and `/audit-html` skills - all additive, with markdown still canonical. v5.0.1 makes HTML artifacts open reliably on WSL (a deterministic opener script with real fallbacks) and fixes the Windows installer so `/index` works out of the box. v5.1.0 rewires HTML generation through a prebuilt-shell pipeline (`render-html.js`): reports open faster, filenames are timestamped so re-runs never collide, and an accessibility pass lands. v5.2.0 adds installer pre-flight reports with `--dry-run` and a tested custom-file guarantee, cuts command startup to one `session-init.js` call, restructures `/review` for token economy, pins `/index`'s heavy lifting to Sonnet, renders plan HTML through the shared pipeline (about 2x faster), splits the lessons log into an always-read index plus on-demand detail, and lets plans include test steps when the work warrants them. v5.3.0 adds an application-security review domain - a `review-security` lens that runs on every code change inside `/review` plus a standalone `/security-audit` for deep whole-repo passes - and sharpens every reviewer (expert personas wired into the dispatched subagents, a finding-level receipt rule, an overall verdict line, and a readability backstop). v5.4.0 bounds every open-ended loop with a verifier gate: approved review fixes are re-verified with countable verdicts (max 2 rounds), `/execute` caps fix retries at 3 attempts per step, debates end early when round 2 converges (up to 3 rounds), and `/index` auto-retries a failed chunk once before asking. v5.5.0 adds manifest-based overwrite guardrails to both installers (local edits inside managed files now warn, back up, and require confirmation or `--force` instead of being silently reverted), refreshes the debate scripts to `gpt-5.6-sol` and `gemini-3.6-flash`, reworks the WSL artifact opener (PowerShell-first, wslview dropped, UNC path printed when genuinely headless), and makes `/worktree` carry `CODEBASE_MAP.md` into new worktrees. v6.0.0 is the breaking one: the loop stops handing you a report and waiting, and instead fixes what it found, re-verifies its own fixes, and starts the next stage on its own, with "report only" and "no chaining" as the two per-run brakes. Around that sit the machinery that makes it safe (findings must carry a runnable receipt and survive a skeptical audit before anything is fixed, a pre-push tripwire reads every outgoing commit for secrets, and fixes are bounded and revertible), GitLab support alongside GitHub, and a second viewport that publishes any HTML artifact to a private Claude-hosted page while still opening it locally. v6.1.0 builds on that without changing it: the hosted page becomes the primary viewport for every HTML artifact (published to a private Claude-hosted page without a consent ask, the local browser open as the fallback, and each local file stamped with its page URL on line 1), `/document` keeps a correction ledger that `/error-analysis` ranks (the data never leaves your machine), `setup.ps1` reaches parity with `setup.sh` and both installers harden upgrades (atomic manifest, fuller backups, a gate for a file of yours at a path the toolkit newly ships), and the GitLab column of `host-cli.md` is tested end to end with three defects fixed. Re-run `setup.sh` (or ask your AI agent to follow [`AGENT-SETUP.md`](AGENT-SETUP.md)) to pick everything up. v6.1.1 is a patch on top of that: it fixes a v6.1.0 regression that dumped the plan shell's header comment onto every rendered plan page, and adds a guard so no shell can ship that way again. v6.2.0 adds the design workflow: when a feature has a look, `/explore` runs a named design step (an existing design system is never overwritten; new work gets three seeded prototypes to pick from), `/execute` runs a fresh-context design critic under the new M15 bound, `gen-media.js` generates seeds, images, video, and matted video behind your own keys with a prompt handoff when a key is absent, and both installers seed a user-owned `DESIGN-PROFILE.md` once. See full per-version details below.

---

## v6.2.0 - The Design Workflow (2026-09-02)

**Additive on top of v6.1.1, which stays a patch on v6.1.0 over v6.0.0 (#160).** Nothing here changes how the loop runs; it adds a design step to it. v6.0.0 is still the release to read first when upgrading from v5.x. Re-run `setup.sh` (or `setup.ps1`) to pick it up.

### Added

- **A design workflow that follows Techniques 1 to 6 of Anshu Chimala's "How to turn your AI into a world-class designer".** When a feature has a look, `/explore` runs a named "Design exploration" step: it checks whether the repo already has a design system (detection signals, then one confirmation, remembered in a user-owned `DESIGN-PROFILE.md`) and sets a load level (none, improve, new). New work gets an idea list you react to, three directions seeded from random strings, three working prototypes side by side in the playground to pick from, and then, in `/execute`, a fresh-context design critic that scores each round until the design clears 9/10 or the round budget runs out. Improve gets one critic pass plus polish. A repo with a design system keeps it: only layout, composition, motion, and copy vary inside one, and going further pages you. Every mechanic lives once in `.claude/skills/shared/design-rules.md`; `/explore`, `/create-plan`, `/execute`, `/document`, and the playground skill cite it. The toolkit's own artifact look is untouched.
- **M15, the design loop bound.** A round is one screenshot, one critic dispatch, and one fix pass with the polish checklist inside it; new work gets up to 5 rounds with a converging check after round 2, improve gets 2; every round is checkpointed and the best-scoring one is kept; running out is a digest entry, never a hard stop. Media and divergence asks are M1 pages exempt from the page cap. Rationale in `docs/HITL-MAP.md`.
- **`gen-media.js`** (`.claude/scripts/`, dependency-free, Node 18+): `--kind seed` prints the random string the directions are derived from; `image`, `video`, and `matte` generate media behind your own keys in `.env.local` (images reuse `OPENAI_API_KEY` or `GEMINI_API_KEY`, video and matting take a new optional `FAL_KEY`). With no key it exits 2 with a ready-to-paste prompt and the file to paste back. A submitted fal.ai job that is not collected exits 3 with a request id, and `--request-id` collects it later without paying twice. Sandboxed tests (`scripts/test-gen-media.js`, 89 assertions) run without a network or a key. The pre-push tripwire now recognises the fal.ai key shape.
- **`design-critic`**, a fourth worker in `.claude/agents/`: Read only, no model pin (a scoring critic whose verdict is final is a judge, and judges inherit), given one screenshot and the fixed contract, returning `Score: N/10` and the gaps.
- **`DESIGN-PROFILE.md`, seeded once by both installers** from `.claude/skills/shared/design-profile-template.md` and never overwritten, like `CLAUDE.md` and `LESSONS.md`. Scenario 22 in both installer suites covers the seed-once behavior and the new managed script.
- **Guides:** README introduces the workflow under `/explore` and lists the new file, script, agent, and key everywhere it inventories them; API-KEYS gains a "Media Generation (optional)" section; SETUP and AGENT-SETUP name the optional key.

### Notes from the cycle's review

- The review of this cycle caught 14 issues that were fixed before anything was pushed: the test's fake keys were shaped like real ones and tripped the toolkit's own tripwire (now assembled at runtime, and the local history was replayed so no commit ever carried a key shape); the resume promise had no flag behind it; failures after a fal.ai submission dropped the request id; the output directory was checked only after the provider was paid; polish was placed in a "last round" the loop cannot know in advance; the critic contract asked for text its own return shape had no room for; and nobody was assigned to build the prototypes the playground lays out.
- Technique 7 onward is not adopted yet. `/review-ux` is deliberately unchanged.

---

## v6.1.1 - Plan Page Regression Fix (2026-09-01)

**A patch on top of v6.1.0, which stays additive on top of v6.0.0.** Nothing here changes behavior; it fixes one v6.1.0 regression and adds the guard that would have caught it. Re-run `setup.sh` (or `setup.ps1`) to pick up the fixed shell.

### Fixed

- **Every rendered plan page opened with a wall of schema text above its title (#159).** v6.1.0's hosted-URL stamp was documented inside `plan-shell.html`'s header comment by writing the stamp out as a literal HTML comment. HTML comments do not nest, so that literal closing marker ended the shell's own header comment at line 18, and the remaining 77 lines of schema documentation rendered as visible text on every plan page `/create-plan` produced. The paragraph now describes the stamp in prose, with a sentence saying why it is not written literally. The other six shells were never affected. Reported, bisected across v5.5.0, v6.0.0, and v6.1.0, and diagnosed to the line by @sqmayank, who also supplied a negative-tested guard implementation; the toolkit folded that guard into its existing suite rather than shipping a second test entry point.

### Added

- **Two guards, because the bug was invisible to every layer that existed.** The defect read as a comment to anyone scanning the source, rendered without complaint (the helper only checked its two placeholders), and no test read the shells. Now `render-html.js` refuses to render a shell whose comments do not open once and close once (a nested opener, a stray closer typed into the prose, or a comment that never closes: each ends the header early with the same symptom), naming the shell, the line, and which defect it found. That is the layer that protects a downstream project that hand-edits a shell. And `scripts/test-render-html.js` renders all seven shells through that guard (the real one, not a copy of its logic), asserts each placeholder appears exactly once and the render-data island is present, reads every rendered page the way a browser does to assert it paints no static text and that the header documentation never survives comment-stripping, and runs a copied helper against a shell broken all three ways to prove each refusal fires. The suite grows from 188 to 248 checks; the new checks were mutation-tested by restoring the bug, and separately by the stray-closer variant, and confirming the suite fails naming `plan-shell.html:18` both times. The review of this cycle caught that the first version of the guard only knew the nested case and that the first page check passed by a coincidence of the header's wording; both were fixed before this note was written.
- **The three-vote audit can downgrade instead of kill (#158, added to this release on 2026-09-02).** M2's tier-3 vote had two outcomes, `STANDS` and `REFUTED`, and `REFUTED` meant logged and never fixed, so a skeptic who thought a Block was real but over-called had no way to say so: in the #155/#156 review two real Blocks died 3/3 on severity alone and were fixed only because a human overrode the rule. Each voter now returns one of `STANDS`, `DOWNGRADE Warn`, `DOWNGRADE Suggest`, or `REFUTED`. The runner tallies in a fixed order: two or more `REFUTED` kills; otherwise two or more `STANDS` keeps the Block; otherwise the finding survives at the higher level the downgrade ballots named, keeps its R-ID, skips tier 2, and its Receipt row says "downgraded from Block" with the ballots. A downgrade ballot must name which Block condition fails (normal-action reach, harm beyond the triggering user, no workaround), or it counts as `STANDS`; that is what keeps the new verdict from becoming a soft vote. Any skeptic that refutes a finding can also attach one `split:` line naming a true sub-claim inside it, which the report lists under Audited out as an open digest item, never as a finding. Tier 2 is unchanged. The review of this addition caught that the two-ballot fallback (one voter failed twice) still described only the old outcomes, so a lone STANDS plus DOWNGRADE pair would have moved a Block on one ballot; it now downgrades only when both remaining ballots downgrade and otherwise keeps the Block. Files: `hitl-loop.md` (M2), `output-template.md`, `html-render-review.md`, `severity-anchors.md`, and the rationale in `docs/HITL-MAP.md`. Re-run setup to pick up the prompt files.

---

## v6.1.0 - Hosted Viewport + Correction Ledger (2026-09-01)

**Additive on top of v6.0.0, which is still the release to read first.** v6.0.0 (the next section down) is the one that changed behavior: the loop runs auto by default, and nothing in this release changes that. If you are upgrading from v5.x or earlier, read the v6.0.0 notes before these. This release builds on it: the hosted page becomes the primary viewport for every HTML artifact and publishing no longer asks, `/document` gains a correction ledger that `/error-analysis` ranks, the Windows installer catches up with the bash one and both harden upgrades, and the GitLab column is tested end to end. Implements #155, #156, and #157, plus a review of the whole range since v6.0.0 (the items tagged "holistic pass"). Re-run `setup.sh` / `setup.ps1` to pick everything up.

### Added

- **Correction ledger (#157).** `/document` gains a capture stage: it finds the moments you stepped in during the cycle, has a fresh subagent read them cold, and records each one as a row with an open code you write in your own words. A new `/error-analysis` command groups those open codes into categories, counts them, and ranks them. The point is to replace fixing-at-first-sighting with knowing which problems are frequent. `LESSONS.md`'s own capture rule already assumed counting ("the user typed the same correction twice") without having a counter; this is the counter.
- New `.claude/scripts/correction-ledger.js` (dependency-free), `.claude/agents/correction-extractor.md`, and the `/error-analysis` skill, all shipped by the installers. A one-time backfill of older transcripts exists (`--since` on `--candidates`), but it runs only when you ask and only for the repo you name.
- **Every published file carries its hosted URL on line 1 (holistic pass).** Finding the page a local file was published to meant opening the index. Now the file's first line is an HTML comment, `<!-- hosted: <url> -->`, so anyone opening it or grepping the directory finds its page. `artifacts/html/index.jsonl` remains the single record (append-only, one JSON line per publish, keyed to the repository so worktrees share it); the stamp is a derived copy of it. `render-html.js --index-add` writes both, and a new `--index-sync` regenerates every stamp from the newest record per file and prints `index-sync: N stamped, M missing`. Markdown twins (`PLAN-*.md`) are not stamped: Claude reads those.
- **The installer guarantee suites cover the new upgrade behavior (holistic pass).** A guarantee that lives only in prose is a guess, so each new installer behavior listed under Fixed has a check: the bash suite grew from 51 to 129 checks and the PowerShell suite from 51 to 148. Every new check was mutation-tested (the behavior was broken on purpose to confirm the check fails), and the PowerShell suite was run from WSL, through a Windows network path into the Linux filesystem.

### Changed

- **The hosted page is now the primary viewport for HTML artifacts (#155).** Plans, reviews, cycle summaries and the rest are published to a private Claude-hosted page under claude.ai and you get the link; the local browser open is the fallback, used when the session cannot publish (Cursor, or the feature is off). Exactly one viewport opens either way, so you are never handed a bare file path.
- **Publishing no longer asks for consent (holistic pass).** The page is private by default under your own account, and the toolkit never changes a page's sharing setting, so publishing is not an outward-facing send under the loop's always-ask rule (M9). The ask is gone for every artifact type, review and debate included; the local fallback never asked either. What still asks: every other M9 action (prompt-file edits, releases and version bumps, deleting user data, force pushes), any send to a destination other than a private claude.ai page (an issue or PR comment, email, a shared drive), and sharing a page. The rule's other named exemption is unchanged: the pull request `/document` opens at the end of a chained cycle still goes out without a separate ask, and a publish to a private claude.ai page now sits beside it as the second exemption. `/error-analysis` output is never published at all, the M11 pre-push tripwire still scans every push, and `--no-abs` still strips machine-identifying paths from every published page. The trade-off, stated honestly: a review or debate page can hold findings you have not read yet, so Claude says in one clause what such a page contains when it hands you the link. One more thing to know: an update to a `--stable` page (plans, docview) that you have since shared reaches whoever you shared it with.
- **Dark mode.** The shared token file gained a full dark palette, keyed to the viewer's theme, which matters now that these pages are read on someone else's machine. Severity colors are re-derived rather than reused: light-mode badges are white text on the fill, dark-mode badges are near-black text on a lighter fill. Every text-on-surface pairing is measured against WCAG AA rather than assumed.
- **Shells declare `color-scheme` and tint their state surfaces (holistic pass).** Scrollbars and form controls follow the palette instead of staying light in dark mode. On chips, signal and veto tags, NEW/MOD/DEL tags, the version pill, and the recommended-option badge sit on new `-soft` tint tokens that clear AA in both palettes; the vetoed audit card is muted with a surface and full-opacity text (7.03:1 light, 5.81:1 dark) instead of a fade that fell under 4.5:1.

### Fixed

- **Published pages no longer carry the paths that identify your machine (#155).** Five shells turned each file reference into a `vscode://file/<absolute path>` editor link, so a published page disclosed your directory layout and account name; those links were also dead for anyone but you. A publish-bound render now passes `--no-abs`, which drops the editor links and rewrites the repo root and your home directory out of the page text. File references read as repo-relative. Paths elsewhere on the filesystem (`/tmp`, `/usr`) are left alone deliberately - they identify nothing.
- **Browser QA screenshots survive publishing (#155).** `browse.js` returns a filesystem path, which a hosted page cannot read, so published browser reports showed broken images. Images are now inlined as base64 `data:` URIs at render time, under a size budget; anything unreadable or over budget is replaced with a visible note instead of a broken image.
- **The artifact index follows you into a worktree (#155).** It resolved against the current directory, so a worktree got its own empty index and a re-published plan created a duplicate page instead of updating the existing one. It is now keyed to the repository.
- **`/review-ux`'s Research sub-agent can actually search (#155).** It was dispatched to do web search through an agent that grants none, so it returned heuristics indistinguishable from research. The skill now runs the searches itself and passes the results down.
- **`/review` dedup defines which severity a merged finding inherits (#155).** It takes the highest of its sources. Severity routes the audit, so a Block merged down to a Warn would have faced one skeptic where three are required.

- **The GitLab column of `host-cli.md` is now tested, and three defects are fixed (#156).** Every documented `glab` invocation was run against `glab 1.115.0` on a live GitLab repo (~270 issues, 31 merged MRs). Most of the column was correct as written. Three things were not. (1) The merged-MR lookup piped into `jq`, which is not a toolkit dependency and appears in no permission entry or setup doc - on a machine without it the command died with `command not found`, breaking `/document`'s cycle-window detection. It now uses glab's own `--jq` with server-side ordering (`--order merged_at --sort desc`), so it needs no external binary and no client-side sort. (2) The stated reason for that pipe - that `--jq` is a `gh` flag glab lacks - was simply false. (3) The issue-URL anchor rule matched only `/-/issues/<N>`, but GitLab's API returns the canonical URL as `/-/work_items/<N>`, so the documented pattern failed against the API's own output; it now matches either form. Also new: a note that MRs imported from GitHub carry an empty `merge_commit_sha` (29 of 31 in the tested repo), with the `git log --merges` fallback that handles it.
- **Direct `/review-*` runs dedup the way `/review` does (holistic pass).** A skill typed directly (say `/review-code`) that fanned out sub-agents merged their combined findings without a rule for which severity the merged finding keeps. It now keeps the highest severity of its sources, the same rule as the orchestrator, so the M2 audit routes it the same way. While there, `/peer-review` was dropped from `html-outputs.md`'s list of HTML call sites.
- **`setup.ps1` caught up with `setup.sh` (holistic pass).** Three blocks the bash installer already had were missing on Windows: the `settings.local.json` permission merge (adds missing template entries, removes known-stale ones, never touches a project-level `.claude/settings.json`), the legacy `INDEX.md` removal with its `.gitignore` cleanup, and the `.claude/plans/` to `plans/` migration. The practical cost: a Windows upgrade never received new permission entries, such as the ones for `pre-push-check.js` and `correction-ledger.js`. Two defects fixed on the way: a reorder-only edit to a managed file slipped past the overwrite gate, because the diff summary is order-insensitive (the file is now hashed as well), and a failed `package.json` rewrite is now a warning that names the backup instead of silence.
- **Upgrades are harder to leave half-done, on both installers (holistic pass).** The manifest is written to a temp file and renamed into place, so a run that dies mid-write leaves the old manifest rather than a truncated one. The backup folder now also holds the previous `.claude/.toolkit-manifest.json` and the pre-merge `.gitignore` and `.claude/settings.local.json`, so a rollback has everything it needs. A file of yours sitting at a path the toolkit newly ships is treated as locally modified: it gates the run instead of being silently replaced. The upgrade banner is version-neutral and points at `CHANGELOG.md` and `AGENT-SETUP.md` instead of stale v5.0 text. A failed permission merge is reported as a warning and leaves the file unchanged.
- **Nineteen review findings on the installer and stamp work, each landed with a test that failed first (holistic pass).** Stamp containment now normalizes paths and compares real paths on both sides, so a `..` segment or a symlink inside the repo can no longer point a stamp at a file outside it; only `.html` mirrors and plain `https://` URLs are accepted; a stamp that gained CRLF endings is replaced instead of doubled; a leading BOM is dropped; Windows casing is folded. The settings merge no longer depends on a temp directory and installs `settings.local.json` in place, so a symlinked file and its mode survive; each installer manages only its own `browse.js` path form on a network-mounted target instead of flipping the other's entries; manifest keys are sorted; the "new this version" box needs an actual version change; the interrupted-run scenario now plants the partial manifest a crash really leaves, and two other checks that could not fail were made falsifiable.
- **A fresh install now ignores the seeded `settings.local.json` (holistic pass).** The toolkit tracks that file as the seed for the permission merge, so its own `.gitignore` could never list it, and a downstream `git add -A` staged a file full of machine paths that the pre-push tripwire then refused. Both installers append the ignore line once. If the file is already tracked, they warn and name `git rm --cached` instead of claiming it is never pushed.
- **Eleven findings from the whole-range review (holistic pass).** Images embed before the `--no-abs` scrub, so a screenshot under your home directory no longer shows as unavailable only on the published page; a bare home directory path is elided too; a file reference that carried only an absolute path keeps a repo-relative reference instead of vanishing. The correction ledger deletes its hand-off file only inside the temp directory and resolves the main copy without a git 2.31 flag, so the opt-out marker holds on older git. The tripwire reports an added secret-container binary (`.pfx`, `.p12`, key files) as unscannable, and a clean run prints nothing. A legacy upgrade box now points at the changelog, and the docs that quote suite counts quote the counts at HEAD.
- **Documentation caught up with what ships (holistic pass).** README's two file lists (the "Copies into your project" bullet and the manual-copy table) omitted `correction-ledger.js`, and the manual-copy table also omitted `package-lock.json`; its generated-files table omitted `reports/` and `artifacts/html/` (both gitignored). `AGENT-SETUP.md`'s v6.0.0 block now says its viewport and always-ask wording has since changed and points at the unreleased block, which carries the current behavior. `DEMO-SCRIPT.md`'s plan step and presenter cues now describe the hosted link first, with the browser open as the fallback. README and `AGENT-SETUP.md` each gained an after-upgrade checklist item telling project owners to retire any "report first" wording left in their own `CLAUDE.md`. The permissions table in `toolkit.md` gains rows for four scripts the settings already allow (`render-html.js`, `session-init.js`, `correction-ledger.js`, `open-artifact.sh`) and for the artifact-opener launchers (`xdg-open`, `explorer.exe`, `powershell.exe`); that file is a prompt file, so the rows land once the prompt-file approval in this cycle is given. And the README sentence claiming the installer test suite covers custom files in `.claude/agents/` now says plainly that the suite plants one there.

### Notes

- Data lives at `~/.claude/`, per machine, append-only, outside every repo. The mechanism ships to every install; the data never leaves the machine that wrote it. Two fields hold near-verbatim fragments and are structurally excluded from every rollup; `/error-analysis` never publishes and never sends anything to an external model.
- Opt out per repo with `touch .claude/.no-correction-log`. Nothing is captured at all for that repo, and the marker applies repo-wide: it is honored from any subdirectory and from a linked worktree, not just from the directory holding it.
- Review findings are deliberately not logged here. They already reach `LESSONS.md`, and a review writes a durable report every run, so recurrence is already answerable for findings and unanswerable for corrections.
- Installs made before v5.5.0 carry no manifest. Their differing managed files are labelled `[differs, provenance unknown]` in the pre-flight and replaced with a backup, with no prompt, because the installer cannot tell a local edit from an older toolkit version. On such an install, run `--dry-run` (or `-DryRun`) first and read that list; copy anything you customized out of the backup folder afterwards.
- A project that keeps its own root `VERSION` file or its own `.gitattributes` will have it replaced on upgrade (backed up first): both are toolkit-managed files.
- On upgrade, only the permissions list in `.claude/settings.local.json` is merged (missing template entries added, known-stale ones removed). Every other top-level setting in that file is left alone, so anything you set there yourself survives the upgrade.
- A v4.2-era install has its toolkit dependencies cleaned out of the root `package.json` by setup, but `package-lock.json` is not touched, so the two no longer agree. Run `npm install` at the project root afterwards to bring the lock file back in line.

---

## v6.0.0 - Auto by Default (2026-08-30)

**Breaking: the toolkit now runs auto by default.** A command that used to hand you a report and wait now fixes what it found, re-verifies its own fixes, and starts the next stage on its own, which is why this release is 6.0.0 and not 5.6.0. Two per-run phrases put you back in charge: say "report only" and the run tells you what it found without changing anything, or say "no chaining" and it finishes the stage it is on without starting the next. Implements #143, #145, #146, #147, #148, #149, #150, #151, #152, and #154, plus a stage-chaining cycle that shipped without an issue number. Re-run `setup.sh` / `setup.ps1` to pick it up.

### Added

- **Review findings now have to prove themselves before you see them** (#148) - Until now `/review` handed you whatever the specialists reported, deduplicated and nothing more. Findings now pass a three-tier audit first. Every finding ships with a receipt: one safe read-only command such as a grep or a test, plus a line stating what its output must show for the finding to stand, and the run actually executes it. What survives goes to a fresh skeptic subagent told to refute it, with rejection as the default when in doubt, and a Block-severity finding faces three independent skeptics instead of one, so no lone agent can kill the most serious findings. Expect noticeably shorter reports: on the audit's first live run, all seven receipts passed and the skeptics then killed four of the seven findings, including the only Block. The cost is extra subagents and some waiting before you see anything. One honest limit: the filtering came almost entirely from the skeptics rather than the receipts, since the same specialist that writes a finding also writes its check. As shipped under this issue the tiers ran only inside the `/review` orchestrator, even though the rules text already claimed them for directly typed `/review-*` runs; that gap was closed separately in this release.

- **A pre-push tripwire that reads every outgoing commit** (#149, `.claude/scripts/pre-push-check.js`) - Before any push, the loop now runs a script over exactly the commits that push would publish. It looks for three things: secrets in added lines (private key blocks, common cloud and AI provider key formats, URLs with a password in them, and generic `token = "..."` assignments), never-push files newly introduced by those commits (`.env`, `.env.local`, your local `settings.local.json`), and any change to the shared `.claude/settings.json`, with the changed lines printed so a settings change is approved knowingly instead of riding along unnoticed. It reads commit by commit rather than the combined diff, because a secret added in one commit and removed in a later one leaves no trace at the endpoint but still lands in public history. A clean run prints nothing and the push proceeds; a hit blocks the push, prints the report with the matched values masked, and pages you, because only you can say "push anyway". It fails closed: a path it cannot parse is reported as unscannable rather than skipped, and if the script errors or is missing, the loop runs the same three checks by hand. One boundary worth knowing: this is a rule the toolkit follows before it pushes, not a git hook. A `git push` you type yourself in a terminal goes out unscanned.

- **The toolkit now works on GitLab, not just GitHub** (#143) - `/create-issue`, `/explore`, and `/document` used to hardcode `gh`, so a GitLab-hosted project had to re-apply its own `glab` edits to those three prompts after every toolkit re-setup. They now read the repo's remote address at the moment they need it and pick `gh` or `glab` from what it says, so both the SSH and the HTTPS form of a remote work. Nothing is configured at setup time and no state is stored, so there is nothing to keep in sync; a self-hosted GitLab or GitHub Enterprise remote falls back to whichever CLI is installed, and asks you once if both are. The shared reference carries whole commands rather than just tool names, because the flags and field names differ per host, and a pasted GitLab issue URL now parses correctly even when the project sits under nested groups. `/review-deps` deliberately keeps calling `gh` on every host, with a note in its prompt explaining why, because it inspects the GitHub repos of your npm dependencies rather than the host your own project sits on.

- **The loop's rules live in one file** (#147, `.claude/skills/shared/hitl-loop.md`) - The old "report first, wait for approval" instruction was copied into every review skill, the rules file, and most commands, which is how a toolkit ends up contradicting itself halfway through a rewrite. The mechanics now live in one place, and each command and skill in the loop carries a one-line pointer to it plus its own verdict on whether a human changes the outcome at that stage. It matters on the day you disagree with something the loop did, because there is then exactly one place to look and one place to change.

- **A README section for people who already have their own workflow** - New "Already Have Your Own Workflow?" section, for someone who arrives with their own commands rather than adopting the toolkit's. It explains what the move to an auto loop changes, then lists the six things that have to be in place before automatic fixing is safe to copy into a workflow of your own: an escape phrase, proof attached to every finding, a second opinion before the fix, a different checker after it, a retry limit with a checkpoint to fall back to, and a guard against re-adding something a person deleted on purpose. The second half is upgrade survival: the exact filenames setup reclaims without asking (nine old command names, five old top-level `scripts/` names, and root `INDEX.md`), the five toolkit dependencies every run strips out of `package.json` plus the two old `ask-gpt` / `ask-gemini` script entries when they still point at the retired `scripts/` path, and the `--dry-run` flag that prints all of it first. It is also honest about one thing it cannot fix: `/review` will not pick up a reviewer you wrote, because its specialist list is fixed. CONTRIBUTING's list of shared reference files is current again.

- **A written model-routing rule** (`.claude/skills/shared/model-routing.md`) - Until now only `/index` chose a model for its workers, and it did so in prose that nothing enforced. There is now one rule covering every dispatch: worker "finders" may pin a cheaper model, while judges (the M2 skeptics and voters, the M3 verifier), code-writing agents, and the main loop always stay on your session model. A judge never runs below the tier of the work it judges. The rule also carries its own guardrails, including the requirement that no pin ships without a measured A/B receipt.

- **Agent definitions in `.claude/agents/`** - Worker roles (`review-finder`, `index-mapper`) are now real files whose model, effort, and tool access are applied by Claude Code on every dispatch, replacing prose instructions that could silently do nothing (the #131 failure). Both installers copy the new folder, and custom files you add there are protected by the same guarantee as `commands/` and `skills/`.

- **A second viewport for every HTML artifact** (#154) - Plans, reviews, cycle summaries, debates, explorations, and audit views are still written to disk and still opened in your local browser, exactly as before. When the session can publish, the same file is now *also* published as a private Claude-hosted page and you get a link. Purely additive: if publishing is unavailable (Cursor, or the feature is off), the step is skipped silently and nothing is lost, because the local open already happened. Consent is asked once and is deliberately narrower than session-wide - a yes covers plan, document, explore, docview, and audit artifacts, while review and debate artifacts ask again every time, because a consent granted at plan time predates the findings and a review can quote code you have not read yet.

- **An index of everything published** (#154) - Every publish appends one line to `artifacts/html/index.jsonl` recording type, name, local path, URL, and timestamp, so a past artifact can be found again. It is append-only and never read-then-rewritten, so two sessions publishing at once cannot clobber each other. The identity-keyed types (plan views and `/audit-html` static views) look their name up in it and update their existing page instead of piling up duplicate links. Gitignored, like the rest of `artifacts/html/`.

- **Artifacts carry their own page title** (#154) - `render-html.js` writes the payload's title into the page's `<title>`, so a plan is named for the plan and a review for the review, rather than all seven shells shipping their generic default. That tag is the browser-tab label locally and the page name when published; a title supplied alongside a published file is ignored when the file carries its own tag, so this is the only place a per-artifact name can come from.

### Changed

- **The loop now fixes what it finds instead of stopping at a report** (#147) - Before this release every review ended in a list and waited for you to type "fix it", the debates asked once (Yes, Partial, or No) before implementing anything, and `/peer-review`'s action plan sat behind the same global "wait until I say fix it" rule. Now the run keeps going on its own. The reviewers still never touch your files, but once the report is out the same run fixes the findings that survived the check, re-verifies each fix with something other than whatever made it, and sends every finding out one of three doors: page you now, land in the end-of-run digest with its evidence, or drop into a log of dismissed non-issues. How it reaches you: re-running `setup.sh` or `setup.ps1` replaces the managed command, skill, and rules files, and the loop is automatic from the next session on, with no prompt and no per-project switch, so the two per-run phrases below are how you take it back on any single run. This is why the release is 6.0.0 and not 5.6.0: nothing was renamed or removed, but what a command does once it starts is no longer what it did before.

- **The other half of that change: the stages now start each other** - `/explore` calls `/create-plan` once the conversation has converged, the plan is then presented and the chain deliberately stops for your approval, `/execute` calls `/review` on a clean finish, and `/review` calls `/document` once its fix loop has settled. Every handoff is announced in one line before it fires, so you can interrupt, and every transition has a brake: an unanswered question keeps `/explore` in the conversation, a blocker or an exhausted retry bound stops `/execute` where it is, and a rollback, a tripwire hit, or a question waiting on you stops `/review` before a cycle summary gets written over work that was rolled back. Plan approval is the one gate left in the cycle, which is why `/create-plan` is the single stage written to chain into nothing. One knock-on: a chained `/document` can open its pull request without a separate approval, because you approved the plan and the push already cleared the secret scan.

- **Every auto-fix is bounded, reversible, and has to show its receipt** (#147) - Letting the toolkit change code without asking only works if a bad change is cheap to undo, so three brakes ship with it. The loop commits after each unit of work that passes its checks and treats those commits as its undo button, so one bad fix reverts without dragging good work along. A finding gets at most two fix rounds; still failing after the second, the loop reverts to the last of those commits, stops, and pages you with what it tried, rather than leaving half-finished edits behind. A fix that would undo something your git history shows you did deliberately is never applied quietly, even when the finding is technically correct. And the end-of-run digest has to state what actually ran with the evidence beside it (the command and its output, the count delta, the diff stat), because "all 12 fixed" with nothing behind it is the failure this release was most worried about.

- **Two per-run phrases take back control, and they do different things** (#147) - Say "report only" to stop the changing: that run tells you what it found and edits nothing. Say "no chaining" to stop the handoff: the run finishes its own stage and does not start the next. They are deliberately separate knobs, so you can have either without the other. Both last exactly one run, because a sticky mode gets switched on once and then silently forgotten. One precision worth knowing: "report only" governs the fixing, not the checking, so a report-only report is still the audited survivors plus the audited-out log. "report only" shipped with this rewrite; "no chaining" arrived with stage chaining later in the same cycle.

- **A short list of things that still always ask** (#147) - Auto by default is not auto for everything. Five kinds of action never apply on their own, whichever stage reaches them: releasing or bumping this project's own version (ordinary dependency updates are not on the list and go through the normal loop), editing prompt files (the toolkit's own command, skill, and rules files, and their copies in any project that installed it), deleting user data, sending anything off your machine to a human audience, and force pushes. Everything in one run that needs your approval is batched into a single page instead of interrupting you five times, and the loop keeps working on the rest while it waits. The list is short on purpose: rare gates stay meaningful. Two exceptions to the outward-send rule are named in the rule itself, both added later in this same release: the pull request `/document` opens at the end of a chained cycle, and an artifact publish you already consented to this session.

- **What each stage stopped asking you** (#147) - Inside each stage, the check-ins are gone. `/execute` announces which steps it is about to run in parallel and starts, where it used to ask "OK to proceed?" and wait. `/document` drafts this session's lessons, commits, and pushes instead of walking you through each step one confirmation at a time, with the pre-push secret check still standing in front of every push. `/pair-debug` applies the fix once a check confirms the root cause and you agree with the diagnosis, instead of waiting for a second "fix it". And `/explore`, `/create-plan`, and `/pair-debug` refresh a codebase map that is 10 or more commits stale by running `/index` themselves rather than asking. What stays yours: `/explore` and `/pair-debug` are conversations you drive, the debates and any `/review-*` you type by hand are still yours to start, and the three worktree cleanup steps that turn on your intent (uncommitted changes, branch naming, deleting a worktree folder) still ask.

- **The review report shows its evidence and logs what it threw out** (#148) - Each surviving finding gains a **Receipt** row naming the check that was run and what its output showed, so the evidence sits next to the claim instead of being implied. A new "Audited out" section at the end lists every killed finding on one line with its verdict and a one-clause reason. On any run that found something, that section is never omitted and prints `Audited out: none` when nothing was killed, so a report that quietly skipped its audit is easy to spot; a run that found nothing at all has nothing to audit and prints neither. The Overall Verdict and the "lead with the top 5" readability backstop are now computed from survivors, so a Block the audit killed no longer forces a `changes-requested` verdict. The HTML view carries both additions with no change to its shell.

- **Typing a single review command now gets the same audit as the full `/review`** (#151) - Before this release only the orchestrated `/review` put its findings through the three-tier check; a directly typed `/review-code`, `/review-ux`, or `/review-security` reported whatever it found. All ten review skills (the nine `/review-*` plus `/security-audit`) now run it. The extra subagents are a real cost and are announced in one line before they fire. A direct run still fixes what survives; the one thing it does not do is hand off to the next stage. Two boundaries: a browser review's receipts re-read the screenshots it already captured rather than driving the browser twice, and a run that found nothing skips the audit entirely. Live-tested on one of the ten: a direct `/review-commands` run produced 27 raw findings from four reviewers, 23 after dedup, all 23 receipts executed, 7 killed by the skeptics, and 16 survivors fixed and re-verified. The other nine carry the same instruction but have not been run through it, and that single run is what caught six skills lacking the tool access to execute the receipts they were being told to run.

- **The severity rubric now says what a label actually costs** (#150) - The shared rubric every reviewer reads now opens by stating what a Block, Warn, or Suggest decides: how hard the audit checks the finding (three independent skeptics for a Block, one skeptical pass otherwise), whether the report reads `changes-requested`, and the order findings are numbered in. It also says plainly that severity does not decide whether you get interrupted, so inflating a finding buys extra subagents and nothing else. A new calibration rule separates a solo or local tool from a production service: scale-and-hardening findings such as no rate limiting or no monitoring land a level lower on a personal script and often should not be reported at all, while a production bump requires both halves of the risk, a failure that strikes unattended and one that reaches users who cannot undo it. The floors did not move: an exposed secret in a solo tool is still at least a Warn. This is guidance the reviewers read, not a check that runs, so a mislabeled finding is still possible; what changed is what the shared rubric they all already read now tells them.

- **Outside AI feedback is graded on that same scale, and now gets audited too** (#150, #151) - `/ask-gpt` and `/ask-gemini` now read the shared rubric before writing their Recommended Actions, because an external reviewer's instinct is to grade every missing rate limit as critical, and the label it picks decides how many skeptics the audit then spends on that action. `/peer-review` dropped its own High/Medium/Low column and uses Block/Warn/Suggest like everything else, so a finding from another model and a finding from `/review-code` sit on one comparable scale. One thing does change about running a debate: its Recommended Actions now go through the same three-tier audit before anything is applied. After the summary, the run executes each action's check, sends the survivors to a skeptic (three for a Block), and posts the result in chat, the surviving actions with their receipts and then the ones it threw out, before the first fix. `/peer-review` is the exception and dispatches no skeptics, because checking each claim against the code is what it already does.

- **A fixed tab icon per artifact type** (#154) - Each of the seven artifact types now publishes with the same icon every time, because the icon is how you find a page again among open tabs and a changed one reads as a different page. Also corrects `artifacts/README.md`, which called that whole folder disposable: `artifacts/html/index.jsonl` is the one file in it that cannot be regenerated.

- **The audit no longer bottlenecks on one agent** - M2's skeptical pass and M3's judgment re-verification used to hand every finding to a single subagent, whose runtime grew with the finding count (measured at 15-20 seconds per finding, up to 7 minutes on a big report). Both now split across parallel agents, one per 7 findings, with verdict formats unchanged. Receipt checks also run as each reviewer returns instead of waiting for the whole wave.

- **`/index` chunk workers pin through frontmatter** - Same Sonnet tier as before, now enforced by the agent file rather than a sentence in the prompt, so the cost message you approve is the model that actually runs.

### Fixed

- **`/document` could summarize from the wrong starting commit** (#143) - When the cycle marker file is missing or stale, `/document` falls back to the last merged pull request to decide where the cycle window starts. It asked for that PR with a command that sorts by the date the PR was opened, not the date it was merged, so an old PR merged late handed back a stale starting point and the summary quietly covered the wrong range of work. Both the GitHub and the GitLab lookups now sort on the merge date explicitly and take the newest. This one bites existing GitHub users too, not only the new GitLab path.

- **Dead links in installed projects** - Neither installer copies `docs/`, but seven links across six files under `.claude/` pointed at `docs/HITL-MAP.md` for the reasoning behind the loop, so every downstream project received a path that does not resolve. All seven now link to that file on GitHub instead of shipping a 26KB maintainer document that nothing reads at runtime. Four other stale references went with them: the toolkit rules described `settings.json` as holding debate permissions it no longer has, both debate scripts told you to re-run a setup path that is absent downstream, `generate-index.js` cited a gitignored plan file, and the lessons log cited review artifacts that are the maintainer's own local files with nothing saying so. A new installer-guarantee scenario now runs against a real install and fails if an inline-read target or a `docs/` citation stops resolving, which is the part that catches this class next time: every one of these gaps resolved fine in the source repo and only broke once installed. The bash suite is now 51 assertions, up from the 49 the `setup.sh` fix above was verified against, and passes clean. The PowerShell mirror was added in lockstep and has been run on Windows: both suites return 51 passed, 0 failed, with matching internals.

- **`setup.sh` could abort on an empty directory** - The script enables `failglob` globally, which overrides the `nullglob` guards that eight of its file-copy loops relied on. An existing-but-empty managed directory (for example `.claude/skills/shared/`) would kill setup with a bare `no match` error instead of copying nothing and moving on. All eight loops now disable `failglob` for their duration and restore it afterward. Two code comments that asserted the wrong behavior were corrected. Verified with real installs at both commits; the installer guarantee suite passes 49/49.

### Notes

- **The auto loop stops at the toolkit's edge** (#147) - The behavior change applies inside this repo and inside projects that installed the toolkit. A user-level `~/CLAUDE.md` outside one deliberately keeps the old report-first wording, because the machinery that makes automatic fixing safe (checkpoint commits, bounded rounds, independent re-verification) is not present there. So upgrading this repo does not change how Claude behaves in an unrelated project on the same machine.

- **Running an AI debate now takes a deliberate detour** - `/review` hands straight to `/document`, so the natural pause where you used to type `/ask-gpt` or `/ask-gemini` is gone. The debates and `/peer-review` are never chained into on purpose, since starting one is a costly choice, but getting that window back is now a four-step move: say "no chaining" when you approve the plan so `/execute` runs and stops, type `/review no chaining`, run the debate, then type `/document` yourself. A `/review-*` specialist you type directly also ends with its own report and never chains; only the orchestrated `/review` hands off.

- **Published pages carry the paths of files on your machine** (#154) - Five of the seven artifact shells turn each file reference into an editor link built from the full local path, so a published page carries your directory layout and account name alongside its content, and those links are dead for everyone else because they only resolve on the machine that made them. The consent rule now requires this to be said in one clause during the first ask of a session, because a yes given without knowing it is not an informed yes. The pages are still private by default; this is about what you are agreeing to send, not who can see it.

- **The tripwire is a guard, not a full secret scanner** (#149) - The pattern list is a hand-picked set of common credential formats and is deliberately not exhaustive; the script stays dependency-free rather than wrapping a tool like gitleaks, so a clean run means nothing obvious was found, not that the push is provably clean. Two behaviors are worth knowing before you meet them. A never-push file that already exists on the remote is not re-flagged, because this repo tracks `settings.local.json` as the seed template and alarming on it every push would only train the habit of overriding the tripwire; when there is no remote copy to compare against, every match blocks instead. And the script does not scan its own file, since its pattern list matches itself. Both installers copy it and the permission to run it ships in the settings template, so an existing project picks it up on the next `setup.sh` or `setup.ps1` run. Both sides are tested: the bash and PowerShell guarantee suites were each run and each returns 51 passed, 0 failed.

- **Browser QA reports do not publish cleanly** (#154) - `browse.js` writes each screenshot to disk and hands back a filesystem path, and nothing in the pipeline turns those images into something a hosted page can show, so a published browser review renders with broken images. The rule now says to either skip publishing that one report or state in the link line that the screenshots appear only in the local copy. This is a stated gap rather than a fix, so you meet it in a sentence instead of in a broken page.

- **The GitLab half of this had never been run when v6.0.0 shipped** (#143) - Every `glab` command was written from glab's published CLI documentation and executed zero times, because there was no `glab` on the machine the toolkit was authored on. It has since been executed end to end against `glab 1.115.0` on a live repo, and three defects were found and fixed in Unreleased (#156) - see that entry. One claim in this section was wrong when written: `--jq` is **not** a `gh`-only flag, `glab` has it too, so the merge lookup never needed the `jq` pipe it shipped with. The other caveat named here stands untested: `--output json` has moved between glab versions, and older builds want `-F json`. One more thing GitLab users should expect: the `glab` permission entries are documented in the toolkit rules but deliberately not seeded into a fresh install, so you either add the ones you use to your own `.claude/settings.local.json` or approve each call at the prompt. GitHub behavior is unchanged and remains the tested path.

- **A pin was tested and revoked.** The headline proposal of #152 was to run `/review`'s specialists one tier down for speed. It was measured the way the new rule requires: the same diff reviewed twice, pinned and inherited, survivors compared after the audit. The pinned arm was 15% faster and missed a real bug in installer code that the inherited arm caught, so the pin was dropped and the receipt recorded in the routing rule under "Tested and revoked". Review specialists continue to run on your session model. The mechanism stays in place for a future pin that earns its receipt.

---

## v5.5.0 - Installer Guardrails + Model Refresh (2026-08-05)

> **First GitHub release since v5.2.0 - cumulative, not breaking.** This release rolls up v5.3.0 (security review domain + sharper reviewers) and v5.4.0 (bounded verifier-gated loops), neither of which was published to GitHub, plus the v5.5.0 changes below. Re-running setup once picks up all three versions.

Implements #134, #138, #139, #140. Additive, with one deliberate behavior change in the installers (called out below). Re-run `setup.sh` / `setup.ps1` to pick up the updated scripts, command, and rules files.

### Added
- **Local-modification guardrails in both installers** (#138) - Setup now writes `.claude/.toolkit-manifest.json` (an EOL- and stamp-normalized sha256 per managed file, regenerated every run) and uses it in the pre-flight to classify each differing managed file: locally modified, merely outdated, or provenance unknown. Locally modified files gate the run before any write: an interactive terminal prompts `Continue? [y/N]`; a non-interactive run aborts listing the files and instructing `--force` (bash) / `-Force` (PowerShell), the new flags that skip the gate. Every replaced modified file is backed up as before and listed with its backup path in a post-setup summary, so re-applying local changes is a checklist instead of an archaeology dig. A file whose hash equals the incoming version counts as clean, which keeps interrupted runs and first upgrades from pre-manifest versions warning-free. The manifest is gitignored and the format is byte-identical across both installers, so a project can be set up from WSL and re-set-up from Windows against the same manifest. Guarantee suites updated in lockstep (49 bash + 49 PowerShell assertions).
- **`/worktree` carries the codebase map** (#140) - The worktree command now copies `CODEBASE_MAP.md` into the new worktree exactly like `.env.local` (skip if missing, never overwrite), with a `Map:` line in the summary. Fresh worktrees no longer start blind or trigger a full `/index` regeneration.

### Changed
- **Debate scripts pin the current flagship models** (#139) - `/ask-gpt` defaults to `gpt-5.6-sol` (128K output cap, 1.05M context) and `/ask-gemini` to `gemini-3.6-flash` (65,536 output cap; chosen over the preview-only Pro tier for GA status). The old defaults `gpt-5.5` and `gemini-3.1-pro-preview` joined the stale lists, so an old pin in `.env.local` auto-overrides with a stderr notice. Output caps verified against the official model pages; the 32,000-token default budget is unchanged and safely under both caps.
- **WSL opener drops wslview, goes PowerShell-first** (#134) - `open-artifact.sh` no longer calls wslview: its interop detection is version-dependent (newer WSL registers binfmt interop as `WSLInterop-late`), its error text leaked into tool output, and its exit 0 was blindly trusted. PowerShell `Start-Process` (trustworthy exit code, works whenever interop is functional) is now the first rung, with `explorer.exe` as best-effort fallback. The Windows system root is derived via `wslpath` instead of hardcoded `/mnt/c`, so custom automount roots work, and a genuinely headless failure now also prints the Windows-side (UNC) path, which - unlike the Linux path - can be pasted into a Windows browser. The retired `Bash(wslview *)` permission is removed from the settings template and, on bash setup runs, from existing installs via the stale-permission cleanup (setup.ps1 has no permission-merge step, so Windows-only installs keep the grant until one is added).

### Fixed
- **Transitive dependency advisories cleared** - `npm audit fix` in `.claude/scripts/` moved protobufjs to 7.6.5 and ws to 8.21.2 within the existing SDK ranges, clearing all published advisories (audit now reports 0 vulnerabilities).

### Behavior change
- **Non-interactive re-setup over locally modified managed files now aborts** instead of silently replacing them (backups were and are always made). Interactive runs are prompted. Automated flows that intend to discard local modifications must pass `--force` / `-Force`. Fresh installs and clean upgrades are unaffected - the gate only fires when a managed file was actually edited locally.

## v5.4.0 - Bounded Verifier-Gated Loops (2026-07-03)

Implements #137. Additive prompt-file and doc changes, no breaking changes. Re-run `setup.sh` / `setup.ps1` to pick up the updated command, rules, script, and shared files.

### Added
- **Fix-then-re-verify protocol** (#137) - After you approve review fixes ("fix it" on `/review` findings, or "Yes"/"Partial" on `/ask-gpt`/`/ask-gemini` Recommended Actions), the fixes are re-verified instead of assumed done. Mechanical findings (a test, build, script exit code, or browser action proved the issue) re-run that exact check inline; judgment findings get ONE fresh subagent per round, briefed with the approved finding IDs, original finding text, file:line, and the diff, and it must return a countable per-finding verdict ("R3: FIXED" / "R3: NOT FIXED" plus a one-line receipt). Hard cap: 2 rounds - round 2 re-fixes and re-checks only the NOT FIXED set, then status is reported honestly. Anything new discovered while verifying is report-only. Review reports (all entry points, via the shared output template) now announce the loop so it is never a surprise.
- **Debate early exit on convergence** (#137) - `/ask-gpt` and `/ask-gemini` debates now run "up to 3 rounds": after round 2, if the reviewer's "Still Discussing" and "New Observations" sections are both settled (absent, empty, or only a none-style placeholder with no substantive bullet), the debate ends early and goes straight to the summary - saving an API round on debates that already agree. The maximum stays 3, never extended. The gate is worded byte-identically in both mirror files, and all round-count copy (README, DEMO-SCRIPT, API-KEYS, the embedded script summary prompts) now says "up to 3 rounds".

### Changed
- **`/execute` fix loop bounded** (#137) - Small failures get max 3 fix attempts per step, each iterating against that step's verification output (the failing test or build result). A plan's Verify step counts as a step under the SAME shared budget - no fresh allowance when the same failure resurfaces. The 3rd failed attempt routes into the existing critical-blocker path (stop, explain, suggest re-running `/create-plan`). Parallel step agents carry the same bound through a new Agent Contract item, so a background agent cannot loop unbounded on a doomed step.
- **`/index` failed-chunk auto-retry** (#137) - A failed or empty chunk subagent is retried once silently before the user is interrupted (then: retry again vs continue with partial coverage). Oversized chunks (`totalTokens` above `chunkTargetTokens`, now documented in the manifest field list) skip the doomed auto-retry and go straight to the user. If EVERY chunk failed after retries, `/index` stops and leaves the existing map untouched instead of offering partial coverage.

## v5.3.0 - Security Review Domain + Sharper Reviewers (2026-06-18)

Implements #136. Additive: new skills and reviewer-prompt sharpening, no breaking changes. Re-run `setup.sh` / `setup.ps1` to pick up the new skills and updated command/shared files.

### Added
- **Application-security review domain** (#136) - `/review` now runs a dedicated security pass on **every code change**, and a new standalone **`/security-audit`** does a deep whole-repo pass on demand. The light lens (`review-security`) hunts the diff-catchable vulnerability classes - hardcoded secrets, SQL/command/code/template injection, XSS, path traversal, unsafe deserialization, SSRF, weak crypto - through an adversarial "what can a malicious user do?" lens, requires a concrete source-to-sink exploit sentence per finding, and stays silent via a **danger-spot gate** when a change touches no security-sensitive sink. It is a **never-gate specialist** (security is never skipped just because a diff is small) and nudges toward `/security-audit` when a change crosses a trust boundary (new route/upload/webhook, auth, crypto, secrets). The deep `/security-audit` enumerates entry points, checks authorization per route, inventories crypto, and recommends a `gitleaks` history scan. Both defer dependency CVEs to `/review-deps`. The security prompts borrow ideas (source-to-sink reasoning, a required exploit scenario, a do-not-report list) from Anthropic's open-source claude-code-security-review as prompt text, not a dependency.

### Changed
- **Sharper reviewers across `/review`** (#136) - Each reviewer's expert persona (Staff Engineer, Staff Security Engineer, Staff Editor, etc.) is now wired into the **dispatched subagent that actually finds issues**, which forms a one-line design-level verdict before line-level nits (previously the persona only applied on direct skill calls). Every finding must now carry a **receipt** - the `file:line`/snippet that proves it, or it is dropped - and a new near-empty shared `do-not-report.md` (a noise-scoped sibling of `LESSONS.md`, grown from real false alarms) suppresses known-noise classes. Reports now open with an **Overall Verdict** line (approve / approve-with-nits / changes-requested) and apply a **readability backstop** (lead with the top 5 findings, collapse the rest, once a report exceeds 7). Because security is a never-gate specialist, code reviews now always fan out to subagents rather than taking the fast inline path for tiny diffs - the deliberate cost of never size-gating security.

## v5.2.0 - Installer Guarantees + Token Economy (2026-06-11)

> **First GitHub release since v5.0.0 - cumulative, not breaking.** This release rolls up v5.0.1 (WSL opener + Windows installer fixes) and v5.1.0 (HTML render pipeline), neither of which was published to GitHub, plus the v5.2.0 changes below. Re-running setup once picks up all three versions.

### Added
- **Installer pre-flight report, `--dry-run`, and a tested custom-file guarantee** (#133) - Both installers now print a read-only pre-flight report BEFORE creating, modifying, or deleting anything: the install type and version gap (e.g. `upgrade (v4.0.0 -> v5.1.0)`), which staged migrations will run, every managed toolkit file that differs from the incoming version (with a `+added/-removed` line summary - a locally edited managed file about to be overwritten is no longer a silent surprise), every custom file detected inside toolkit-managed directories with the explicit statement that setup will not modify or delete it, and the backup location announced up front instead of after the fact. Stale `.toolkit-backup-*` folders from past runs are flagged for cleanup. A new `--dry-run` flag (bash) / `-DryRun` switch (PowerShell) prints the report and exits with zero changes. The long-implicit custom-file guarantee is now enforced by scratch-project test suites (`scripts/setup/test-installer-guarantees.sh` / `.ps1`, toolkit-repo only, never copied to projects) that plant custom files in every managed directory - including a nested command subdirectory - and verify byte-for-byte survival through a full fresh-install -> local-edit -> dry-run -> upgrade -> re-run cycle; 37/37 assertions pass on Linux bash and on Windows PowerShell 5.1. The version-stamp line in the two managed rules files is ignored during comparison, so a pure version bump is never misreported as a local edit. `.env.local.example` (previously the one managed file overwritten without backup) now goes through `safe_copy` in both installers. Re-run `setup.sh` / `setup.ps1` to pick it up.
- **Faster command startup with one session-init call** (#131) - `/explore`, `/create-plan`, `/pair-debug`, and `/execute` each began with 4-5 sequential reads (`CODEBASE_MAP.md` staleness checks, `LESSONS.md`, `plans/` listing, worktree detection) before any real work. A new dependency-free `.claude/scripts/session-init.js` emits all of it as one JSON (map freshness plus a System Overview summary, the lessons index, plan files with progress/status, and worktree state), so each command makes one call instead of several roundtrips. The script is strictly read-only and fail-soft (it exits cleanly with `exists:false` when the map/lessons/plans are absent) and follows the `generate-index.js` pattern (zero deps, data to stdout, diagnostics to stderr). Each command keeps its original manual reads as a labeled fallback, so older installs without the script behave identically. Both installers copy the new script; add `Bash(node .claude/scripts/session-init.js *)` to `settings.local.json` to pre-approve it. Re-run `setup.sh` / `setup.ps1` to pick it up.
- **Lessons now feed back into future runs** (#125) - `LESSONS.md` used to be written but never read, so the same mistakes could recur. It is now split into a short always-read index (`LESSONS.md`, one line per lesson) plus full write-ups in a new `LESSONS-detail.md` that load on demand. `/explore`, `/create-plan`, `/execute`, and `/pair-debug` read the index at session start (the same point they read `CODEBASE_MAP.md`; `/execute` reads lessons but not the map) and open a lesson's detail only when it is relevant, keeping the per-session cost to the ~1.3k-token index instead of the ~8k-token detail file. `/document`'s capture step now shows the current index first to avoid duplicates, writes new lessons to both files, and runs a dedupe/cleanup pass, with a tightened trigger (the same mistake twice, a review caught something Claude should have known, or you repeated a correction); capture stays user-approved. Backward compatible: a pre-split flat `LESSONS.md` is still read whole. Both installers seed `LESSONS-detail.md` only on a fresh install (an existing flat `LESSONS.md` is preserved, with a migration tip). Re-run `setup.sh` / `setup.ps1` to pick it up.
- **Conditional unit-test steps in `/create-plan`** (#121) - Plans now decide for themselves whether to include a dedicated "Verify" test step, instead of never planning tests. A new `## Test Steps (conditional)` block (modeled on the existing "Execution Order Tags" conditions) adds the step when the plan changes verifiable logic - WRITE new tests for new business logic (a pricing calculator), RUN existing tests after a refactor of covered code (a parser) - and skips it for docs/config/comment-only or exploratory/research plans ("when in doubt, skip it"). The decision reads from the task descriptions plus `CODEBASE_MAP.md` signals (a `tests/` directory, a test framework in dependencies); no extra codebase scanning. When the project has no test runner, the plan adds a flagged *optional* "Set up <framework> (optional - recommended)" step with the idiomatic tool auto-detected (Vitest/Jest for JS, pytest for Python; generic wording if unclear); the Verify step depends on the code steps and never on that optional step, so deleting it never leaves a dangling reference. Each test step carries a plain-English `_Why this step:_` note for non-technical readers.

### Changed
- **`/review` restructured for token economy (structured findings, diff gating, leaner payloads)** (#130) - Four reinforcing changes plus a correctness fix to the toolkit's biggest token/latency multiplier. **Structured findings (R3):** dispatched specialists now emit findings as JSONL (one object per line, schema aligned to the HTML shell) instead of prose; the `/review` orchestrator dedups mechanically by key and derives both the markdown report and the HTML payload from that one structure, so findings are authored once and formatted twice instead of up to three times. **Diff-size gate (R4):** a new Phase 1.5 reviews changes under 50 lines inline instead of fanning out to specialists (never-gated: Dependency Security, `/review-full`, and explicit focus calls like `/review code`). **Leaner payloads (R5):** the orchestrator no longer passes `html-render-review.md` to dispatched specialists (they never render HTML) and hands them pre-read file excerpts instead of having each subagent re-read every file. **Reading budgets (R6):** a new shared `reading-budget.md`, inlined into all 8 review skills, caps how much each reviewer opens. **Impossible-instruction fix (R12b):** six skills told dispatched subagents to "run four sub-agents in parallel", which a subagent cannot do (subagents cannot spawn subagents); that fan-out is now scoped to direct invocation, with the single-pass rule enforced in the orchestrator's dispatch contract where it actually executes. Direct `/review-*` calls are unchanged - the JSONL contract and single-pass rule apply only to orchestrator-dispatched subagents. Re-run `setup.sh` / `setup.ps1` to pick up the updated command and skill files.
- **`/index` chunk subagents now actually run on Sonnet** (#131) - `/index`'s cost message told users its parallel chunk analysis ran on "Sonnet via general-purpose subagent", but the dispatch never specified a model, so the chunk agents silently inherited the session model (Opus or Fable when active) - the toolkit's single largest input-token job, running several times more expensive than advertised. The Step 3 dispatch now pins the chunk agents to Sonnet (`model=sonnet`), making the message true; synthesis (Step 4) deliberately stays on the session model ("pin down, inherit up", since main-loop model switches bust the prompt cache while subagent pins do not). No installer change beyond the updated command file. Re-run `setup.sh` / `setup.ps1` to pick it up.
- **Plan creation is now roughly 2x faster** (#129) - `/create-plan` was the last default-on command that hand-wrote its entire HTML view as model output (~2,950 slow tokens per plan, roughly doubling plan-creation time). It now emits a compact JSON payload that `render-html.js` injects into a new prebuilt `plan` shell. Two new helper flags make the migration possible: `--out-dir <dir>` (plan views land in `plans/`, next to their canonical markdown) and `--stable` (writes exactly `<name>.html` with no timestamp and overwrites on re-run - the right behavior for identity-keyed views that are replaced on re-plan). The `/audit-html` opt-in static view migrated the same way onto a new generic `docview` shell (block-based JSON: prose, lists, tables, code) with sortable tables and auto-collapsing long sections built into the shell once. Default helper behavior for the five existing artifact types is unchanged. `/playground` is now the only hand-rendered HTML in the toolkit. Re-run `setup.sh` / `setup.ps1` to pick up the updated helper.
- **`/review-plan` Quality Gate softened to match** (#121) - The plan-compliance reviewer's gate changed from "Tests written?" to "Tests written (when the plan warranted them)?" so it no longer flags plans that correctly skipped tests. This closes a loop: `/review-plan` already graded test presence, but `/create-plan` never planned tests, so a plan could be dinged for something the planning step never asked for.

### Fixed
- **Windows installer parity gaps closed** (#133) - Mirroring the pre-flight work into `setup.ps1` (and grepping it for prerequisite logic first, per the #126 lesson) surfaced four pre-existing gaps, all fixed: `setup.ps1` never copied `VERSION` into the target project, so Windows installs could not report a version gap on upgrade; it lacked the v3.5 legacy command cleanup, so Windows upgrades from the v3.4 era kept stale `review-*.md` command files alongside the skills that replaced them; its issue-91 dependency cleanup list was missing `@google/genai`; and it resolved paths with `.Path` instead of `.ProviderPath`, which crashes the byte-comparison in `Invoke-SafeCopy` when the toolkit is run from a UNC location such as `\\wsl.localhost\...`. `setup.ps1` also now creates `plans/` like `setup.sh` does. Re-run `setup.ps1` to pick these up.
- **`/create-plan` HTML filename no longer doubles the `PLAN-` prefix** (#130) - The Run-the-Helper step defined `<basename>` as the full markdown plan name (e.g. `PLAN-issue-129`) while the command template used `--name PLAN-<basename>`, so a literal reading produced `--name PLAN-PLAN-issue-129` and an HTML file (`PLAN-PLAN-issue-129.html`) that no longer paired with its markdown twin or got replaced on re-plan. `<basename>` is now defined as the identifier *after* the `PLAN-` prefix (e.g. `issue-129`), consistent with `plan-shell.html` and `html-outputs.md`. Surfaced by the issue-130 review before/after comparison. Re-run `setup.sh` / `setup.ps1` to pick up the fix.

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
