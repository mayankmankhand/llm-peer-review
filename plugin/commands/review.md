---
description: "Unified Review"
allowed-tools:
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh *)"
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh)"
  - "Bash(mktemp -d /tmp/*)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js)"
---
# Unified Review

Run the right reviews automatically, combine findings into one report.

**Use this when:** You want a single command to review your changes. It detects what changed and dispatches the right specialists.
**Don't use this when:** You want a pre-release gate (use `/tk:review-full`). Or you know exactly which review you need (use `/tk:review-code`, `/tk:review-ux`, etc. directly).

**The difference:** `/tk:review` checks what you just changed. `/tk:review-full` checks if the whole thing is ready to ship.

## Critical Rules

<rules>

1. **Reviewers never edit** - Specialists and the report phase never modify files; findings are their product
2. **Audit, then continue into the auto loop** - Findings are deduped and audited (M2: receipts, skeptical pass, three-vote for Blocks) BEFORE the report, so the report shows survivors only. After the report, do not wait for a human "fix it": auto-fix survivors (guards: M7, M9), re-verify (M3, M5, M6), and exit each finding as page (M1), digest, or log. Operating rules live in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`, inlined under "After the Report" below. Saying "report only" keeps this run report-first (M10)
3. **Explain simply** - Use plain English, avoid jargon
4. **Respect the concurrency cap** - Max 4 parallel subagents per run

</rules>

## Focus Mode

<reference>

This command supports optional focus arguments:

- `/tk:review` - auto-detect what to review based on changes
- `/tk:review code` - just code quality
- `/tk:review code,ux` - specific combination
- `/tk:review full` - invokes the review-full skill (same as `/tk:review-full`), passing on any `mode:` word
- `/tk:review <base>..<end>` - a commit range plus any uncommitted work, e.g. `/tk:review a1b2c3d..HEAD`; it combines with focus names (`/tk:review code a1b2c3d..HEAD`). `/tk:execute` passes one when it chains here (M14)
- `/tk:review mode:cheap` - this run's model mode: `best`, `fit` or `cheap` ("Model modes" in `${CLAUDE_PLUGIN_ROOT}/skills/shared/model-routing.md`). It combines with focus names and a range; without one, the newest unfinished plan's Models line decides, else fit

If focus arguments are provided, skip the detection phase and dispatch only the specified specialists. The arguments map to skill names: `code` = review-code, `security` = review-security, `ux` = review-ux, `plan` = review-plan, `commands` = review-commands, `browser` = review-browser, `deps` = review-deps, `copy` = review-copy, `full` = review-full. An argument containing `..` is the range, and one starting `mode:` is the model mode; neither is ever a focus name. Nor are the phrases "report only" and "no chaining": they are the two per-run opt-outs (M10 and M14 in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`), so set them aside before reading the rest of the arguments as focus names.

A focus name that matches none of those may be one of this project's own review kinds. Compare it against the rows under **Project review kinds** in Phase 1: that table is in this prompt on every run, because the harness expands the inline read when the command loads, so skipping Phase 1 skips detection, not the text; read the rows there and run nothing. A row's kind is the short name in parentheses in its Specialist cell when it has one (`Design Fidelity (fidelity)` matches `fidelity`), else the whole Specialist cell, compared ignoring case and surrounding spaces (`Design Fidelity` matches `design fidelity`). When a row matches, print exactly one line, "`<kind>` is a project review kind and runs on auto-detect only; run `/tk:review` with no focus name to include it", and continue with the remaining focus names; when it was the only one, stop with "Nothing to run." A name that matches no toolkit name and no row: print one line, "`<name>` is not a review kind here; the names are code, security, ux, plan, commands, browser, deps, copy, full", drop it, and continue the same way.

</reference>

## How It Works

<procedure>

### Phase 0: Resolve the scope (every run)

`/tk:execute` commits every green step, so uncommitted work alone can be empty when there is plenty to review. Decide what this run covers before anything else, with one call from the project root, run as literal words (never inside `$(...)`):

- with a range argument: `node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js --scope <base>..<end>`, passing the range exactly as it was typed
- without one: `node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js --scope`
- either way, with a `mode:<m>` word in the arguments: add `--mode <m>` to the call

It prints one JSON object (the full shape is in the script's header comment). Read:

- **`range.end` is the pinned end.** The review covers `range.base..range.end` plus the uncommitted work, and nothing after it. This run's own fix commits land after the report, so what comes after the review's starting point is the diff of the fixes M3 verifies and where M5's follow-up generation looks. M3 names that starting point: `uncommitted.baseline` from this same JSON when it is set (the tree as the review found it, so uncommitted work that predates the run is not read as a fix), else the pinned end. Keep `uncommitted.baseline`, `uncommitted.baselineError` and `uncommitted.untracked.files` from this call; step 3 of After the Report needs them. Fix the run stamp now and save this call's JSON as `reports/receipts/<run-stamp>/scope.json`, with the redirect form the receipts use: the snapshot id is a commit nothing points at, so once a compaction loses it it cannot be looked up again, and a second scope call made after the fixes returns a snapshot that already holds them. Read the three values back from that file at step 3 rather than from memory.
- **`source`** says where the range came from: `argument` (the range you were given), `plan` (no argument: the newest plan's `**Start commit:**` up to HEAD, used while at least one commit after it is unpushed; `plan.name`, `plan.commits` and `plan.unpushed` carry the file and the counts), `unpushed` (no argument and no plan applies: the newest unpushed commits, counted from the merge-base with the upstream, else with the remote's default branch; when a plan was passed over, `plan.reason` says why: `plan-no-start`, `plan-shipped`, `plan-start-missing`, `plan-start-not-ancestor` or `plan-no-commits`), or `none` (no range; `message` says why in one plain sentence).
- **`range.commitCount`** is the whole count; **`range.commits`** lists up to 20 of them, newest first. Only the unpushed source is ever capped: `range.capped` is true when older unpushed commits were left out, `range.omitted` counts them, and `range.fullBase` is where they start. The plan source is never capped, whatever its size.
- **The changed files** are `range.files` plus the `files` lists under `uncommitted.staged`, `uncommitted.unstaged` and `uncommitted.untracked`; `totals.lines` sums their added and deleted lines. From here on, "the diff" and "the changed files" mean this scope.

**The scope line.** Write nothing before the scope call. When it returns, print its `scopeLine` exactly as your first words, on a line of its own, before any other tool call, and open the report with the same line. The script builds it, Models part included ("Models: <mode>" and where the mode came from, plus any models warning), so the line reads the same on every run. Then act on what it reported:

- **A range argument that `source` reports as `none`:** the line says why the range cannot be reviewed. Stop, and ask for a range whose base is an ancestor of its end.
- **No commits in range and nothing uncommitted** (the line starts "Nothing to review"): on the auto-detect path, stop, adding "Pass a range: `/tk:review <base>..HEAD`." unless the line already names a range to pass (a shipped plan's). A focus call does not stop here: it runs the specialists it names.

**Fallback:** if the script is missing or its output carries an `error` field, review the uncommitted work only (`git diff --name-only`, `git diff --name-only --cached`, and `git status --short` for untracked files; `git diff --numstat` for the size gate). An `error` output still carries a `scopeLine` saying no commit range was checked; with no script at all, print "Reviewing uncommitted work only; no commit range was checked. Models: fit (the default)." An output with no `scopeLine` (building the line failed) gets "Reviewing <range.commitCount> commits (`<range.base>..<range.end>`, short shas) and any uncommitted work. Models: <models.mode>." in its place.

### Phase 1: Detect (skip if focus arguments provided)

The changed files come from the scope (Phase 0).

Categorize the changes and pick relevant specialists:

| What changed | Specialist | Finder agent |
|---|---|---|
| `.ts`, `.js`, `.py`, `.go`, `.rs`, `.java`, `.sh` files | Code Quality | `subagent_type=tk:review-code-finder` |
| The same code files (any code change) | Security | `subagent_type=tk:review-security-finder` |
| `.tsx`, `.jsx`, `.vue`, `.svelte`, `.css`, `.scss`, `.html` files | UX Quality | `subagent_type=tk:review-ux-finder` |
| Active `PLAN-*.md` exists in `plans/` | Plan Compliance | `subagent_type=tk:review-plan-finder` |
| `.claude/commands/`, `.claude/skills/`, `.claude/agents/` or `.claude/rules/` files changed | Command Quality | `subagent_type=tk:review-commands-finder` |
| `package.json` or lockfile changed | Dependency Security | `subagent_type=tk:review-deps-finder` |
| Visual/UI changes AND (a dev server answers OR `package.json` has a `dev` or `start` script the finder can start) | Browser QA | `subagent_type=tk:review-browser-finder` |
| `README.md`, `index.html`, or files in `docs/`, `pages/`, `content/`, `posts/` (exclude `CHANGELOG.md`, ADRs, API refs, generated docs) | Copy Clarity | `subagent_type=tk:review-copy-finder` |

**Project review kinds.** Rows this project adds to the table above, in the same three columns, read from `.claude/toolkit/review-kinds.md`. Treat each one exactly like a row of the table: its Finder column names the project's own agent, dispatched by that name with the same per-run prompt and through the same audit. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/review-kinds.md 2>/dev/null || true`

**Rules:**
- A file can trigger multiple specialists (e.g., a `.tsx` file triggers both Code and UX)
- **Security runs on every code change, alongside Code Quality.** The same files that select Code Quality also select Security (review-security). Code Quality asks "is this written well?"; Security asks "what can a malicious user make this do?" - different lenses, both run. Security has its own danger-spot gate, so it stays quiet on changes that touch no security-sensitive sink.
- When copy and UX both run on the same artifact, copy focuses on meaning/orientation while UX focuses on usability/accessibility. Deduplicate overlapping findings in synthesis.
- An empty scope never reaches this table: Phase 0 already stopped the run, or it is a focus call, which skips detection
- A project review kind is selected by its own What changed cell, on this auto-detect path only: a focus argument names toolkit kinds, and one that names a project kind says so (Focus Mode)
- For browser-qa, check which common port (3000, 3001, 5173, 8080) answers and pass it as the dev server URL in the Run notes; with none answering, dispatch anyway when `package.json` has a `dev` or `start` script (the finder starts it in the background, per its criteria); with neither a server nor a script, skip Browser QA and say so under What I could not check
- A `[behaviour]` line in the plan's `## Must-check for review` section (M14) selects Browser QA the same way a visual change does, because a design loop's still images could not see behaviour. A surface the finder could not reach comes back on its `NOT CHECKED:` line and lands under "What I could not check"

### Phase 1.5: Size gate (skip the fan-out for tiny diffs)

This gate applies only to the auto-detect path. (Explicit focus calls like `/tk:review code` and `/tk:review full` skip detection entirely, so they never reach this gate - the specialist you named always runs, regardless of size.)

Count the changed lines: `totals.lines` from the scope, which sums added and deleted lines across the range, staged, unstaged and untracked work, so committed lines count as well as uncommitted ones. **If the total is under 50 changed lines AND none of the selected specialists is a never-gate one, skip Phase 2 and review the diff inline** in a single pass: you (the orchestrator) read the changed files and produce the report yourself, using the same severity anchors, finding IDs, and output format the specialists would use, covering whichever domains the file-type table flagged. Author a `receipt` for each inline finding and run the Phase 4 audit before writing the report - tier 1 inline, tiers 2 and 3 via fresh subagents per the inline-path note in Phase 4.

**Never-gate specialists:** Dependency Security (selected when a `package.json`/lockfile changed) and Security (selected whenever code changes). Either one's presence disables the size gate for the whole run - diff size is not a proxy for risk. A one-line change can introduce a severe vulnerability or pull in a bad dependency, so neither security pass is ever skipped for being small. (Trade-off: because Security is selected on any code change, code reviews fan out to subagents rather than taking the fast inline path - the deliberate cost of never size-gating security.) A project review kind is never-gate as well: the inline path applies the toolkit's own criteria, and a project kind's criteria live in its agent, so the orchestrator has nothing to review it with. A `[behaviour]` must-check line (Phase 1) makes Browser QA never-gate as well: the inline path only reads the changed files and drives no browser, so a small diff would otherwise drop the one check that line exists to force.

The inline path continues into the same auto loop after the report (see "After the Report" below) and still obeys the HTML gate; it simply has no specialist subagents to dispatch - the Phase 4 audit still dispatches its skeptics per the inline-path note.

### Phase 2: Dispatch

Each specialist is a typed finder agent that already carries its expertise. The agent's `skills:` frontmatter preloads its `review-<kind>-criteria` skill (the How to Review criteria, reading budget, severity anchors, finding ids, and the finding contract) and the `dispatch-contract` skill (single pass, JSONL out, never audits its own findings), and its expert role is the first line of its body. Nothing from a SKILL.md is read here or pasted into a prompt: the prompt carries only what differs per run.

1. Gather project context with the `project-context` skill: invoke it through the Skill tool (`Skill(tk:project-context)`; it is agent-only, never a slash command) and follow its instructions. Its summary goes into every finder prompt.
2. Read the changed files once, here, so each finder receives the relevant excerpts instead of re-opening every file (paste-don't-read). A change committed in the range shows in `git diff <range.base> <range.end> -- <path>`, and uncommitted work in `git diff HEAD -- <path>` (an untracked file is new in full); single-quote a path that holds a space.
3. Spawn one subagent per selected specialist with the Agent tool, using the exact `subagent_type=` value in the Finder column of the Phase 1 table (one typed finder per kind; the table holds the dispatchable name, so copy it rather than composing one), with `model` set to its `models.perRole` value, where `session`, or a model above your own, means your own model family's alias; a project kind's own agent has no entry there and takes no model. Its effort and tool set (no file-editing tools) come from its frontmatter per the roster in `${CLAUDE_PLUGIN_ROOT}/skills/shared/model-routing.md`. Fallback per that rule: when the type is not found, run `/reload-plugins` once (an agent added by a plugin install or update, or written this session, registers only after a reload) and retry; still not found, dispatch `general-purpose` carrying the same `model` plus what the agent's two skills would have preloaded, pasted as the fragments those skills include rather than the SKILL.md files, whose include lines do not expand when pasted: every file named on an include line of `${CLAUDE_PLUGIN_ROOT}/skills/review-<kind>-criteria/SKILL.md`, in its order (for most kinds `criteria-<kind>.md`, `reading-budget.md`, `severity-anchors.md`, `finding-id-system.md`, and `finding-contract.md` from `${CLAUDE_PLUGIN_ROOT}/skills/shared/`; security adds `do-not-report.md` and browser adds `browse-api.md`), then the contract paragraph of `${CLAUDE_PLUGIN_ROOT}/skills/dispatch-contract/SKILL.md` followed by `${CLAUDE_PLUGIN_ROOT}/skills/shared/dispatch-format.md`. A project review kind has no such fallback, because its criteria live only in its agent: when that type is not found, skip the kind and say so in the digest, naming the row (`/tk:upgrade` reports a row whose agent is missing, C-12).

**Concurrency:** Dispatch up to 4 subagents in parallel. If more than 4 specialists are relevant, run the first 4 in parallel, wait for results, then run the remainder - in practice most runs select 1 to 4 specialists, so the second wave is the exception, not the norm. Browser QA is always sequential (it drives a browser), so it runs last if included. As each specialist returns, run its findings' receipt checks right away instead of waiting for the whole wave - M2's Concurrency note (inlined under "After the Report") is authoritative for this tier-1 overlap.

**Subagent prompt template:**
```
Project context:
[PASTE PROJECT CONTEXT SUMMARY HERE]

Scope:
[THE PHASE 0 SCOPE LINE, e.g. "Reviewing 6 commits (a1b2c3d..e4f5a6b) plus uncommitted work."]

Files to review (excerpts already read for you):
[PASTE THE RELEVANT EXCERPTS OF EACH CHANGED FILE IN THE SCOPE, committed in the range or uncommitted. For a file over ~400 lines, paste the changed sections plus ~50 surrounding lines and point at the path for the rest.]

Run notes:
[ONLY WHAT THIS RUN NEEDS, OR OMIT THE SECTION: the focus arguments; the plan file path for the plan finder; the dev server URL for the browser finder; for the browser finder, each `[behaviour]` must-check line verbatim, with "exercise the stateful controls on this surface that the design loop's pass did not cover"; which other specialists run alongside, so copy and UX split meaning from usability.]
```

The role, the criteria, the review lens and the single-pass contract live in the agent and the two skills it preloads, so a dispatch does not carry them. What the finder returns is fixed by the `dispatch-contract` skill; the orchestrator parses that format, so it is inlined here from the one file both share:

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/dispatch-format.md"`

**If a subagent fails** (error, timeout, empty response, or output that will not parse as JSONL; a `NOT CHECKED:` line beside the JSONL or `NO FINDINGS` is part of the format, not a parse failure), re-dispatch that one finder once with the same prompt - and when it ran on a cheaper model than yours, dispatch the retry on your own model per guardrail 2 in `${CLAUDE_PLUGIN_ROOT}/skills/shared/model-routing.md`. Malformed output counts as a failure precisely because it is silent: a specialist that returns prose instead of JSONL has produced nothing the run can use. Still failing after the one retry: a hard stop, handled per "When a finder fails" in M2 (`${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`, inlined under "After the Report"): page with retry, continue anyway, or stop, and hold the chain until the answer. Do not improvise a variant, and never let it pass as a note.

### Phase 3: Synthesize

**Seed the must-check items**. Read the `## Must-check for review` section (M14) of the plan the Plan Compliance row selects; a plan without the section seeds nothing. Each `[plan]`, `[design]` and `[interaction]` line becomes one finding, added before dedup so a finder that raised the same gap corroborates it rather than duplicating it:

- `severity`: `warn`. The item already survived a fresh judge's read, and a Block needs a user harm the orchestrator cannot assert on that judge's behalf.
- `specialist`: `plan-critic`, `design-critic`, or `interaction-pass`.
- `file`: for a design or interaction line, the surface's source file as the Surface row of the plan's UI/UX Design section names it; for a plan line, the file it names; otherwise omitted.
- `what`, `context`, `fix`: written from the line to the finding contract.
- `fields`: a `Source` row carrying the line verbatim, the one attachment every seeded finding has; a design line adds its `Screenshot`.
- `key`: per the dispatch format inlined in Phase 2.
- `receipt`: written by the orchestrator against the work as delivered (the code, the tests, and the evidence the plan's Outcomes cite), never against the plan text the gap was raised on. A design line's check re-captures the surface with `browse.js` when a server is reachable, and the runner reads that capture: one screenshot per surface, not the failing-action re-run M2 rules out before the report. An interaction line's check re-runs its session. With no server, either one falls back to what the design loop saved (the screenshot, or the session's failing output) and the finding says it was not re-checked. A plan line's check is a grep, file read, or test run whose output shows the gap still holds.

A gap that no longer holds fails its receipt and is logged `RECEIPT FAILED`: dismissed with proof, which is the point of carrying it. The `[behaviour]` line is not a finding; Phase 1 and the Run notes route it to the browser finder. The inline path (Phase 1.5) seeds the same way.

Collect the JSONL findings from all subagents (a specialist that emitted `NO FINDINGS` contributes none), together with the seeded ones. Set each `NOT CHECKED:` line aside with its specialist's name for "What I could not check" in Phase 5: it is a disclosure, never a finding, so it gets no ID, no receipt and no audit. Then:

1. **Dedup mechanically** - group findings by their `key`. Findings sharing a key are the same issue: merge them into one, unioning their `specialist` values (e.g. `[code, ux]`) and their `fields` (keep the browser-only evidence fields - Screenshot, Evidence, Expected, Actual - when a browser finding merges with a code one). Keep every merged finding's `receipt`: tier 1 runs each of them, and the finding stands if at least one check passes - a corroborated finding never dies on a single badly-written check. **A merged finding takes the HIGHEST severity of its sources** (Blocks over Warns over Suggests): severity is what routes the audit in Phase 4, so a Block merged down to a Warn would face one skeptic where M2 requires three voters, and two specialists independently flagging the same spot is corroboration, which never lowers confidence. This is a free, mechanical pass over structured data - no re-judging.
2. **Order and number** - sort by severity (Blocks first, then Warns, then Suggests) and assign a single R1, R2, R3 ... sequence across ALL deduped findings. No gaps, no duplicates. Tag each ID with its merged specialist source(s): `**R1** [code] 🚫`, `**R3** [ux, plan] ⚠️`. The audit runs next, so some IDs will exit to the Audited out log rather than the report; the sequence stays gap-free across report plus log, and audit verdict lines reference these IDs.

### Phase 4: Audit (M2)

The three-tier audit runs here, between dedup and the report: the orchestrator is M2's *runner*. M2 in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md` (inlined under "After the Report") holds every mechanic - the tiers and what each covers, the skeptic instruction, the verdict formats, dispatch hygiene, the concurrency note, and the redispatch-on-failure rule. Do not restate them here and do not improvise a variant.

Two things are specific to this path:

- **The bytes are JSONL.** A finding's `receipt.check` is its tier 1 command and `receipt.expect` is the line the output must satisfy. A merged finding carries every source receipt and stands if at least one check passes (Phase 3). What tiers 2 and 3 receive is the original JSONL lines plus each receipt's actual output.
- **The inline path is not exempt.** When Phase 1.5 reviewed the diff inline, the orchestrator authors receipts for its own findings and runs tier 1 the same way, but tiers 2 and 3 still dispatch fresh `audit-skeptic` agents. M2's never-judge-your-own-findings rule applies here exactly as it does to dispatched specialists.
- **Seeded items are audited like any finding.** The orchestrator wrote their receipts in Phase 3, as it does on the inline path, and tiers 2 and 3 judge them exactly as they judge a finder's. In the receipts folder their `<lens>` is the seeded specialist (`plan-critic`, `design-critic`, `interaction-pass`).
- **The skeptics are typed.** Tier 2 shards and tier 3 voters are `subagent_type=tk:audit-skeptic` dispatches (no edit tools, `effort: high`, session model, per the roster in `${CLAUDE_PLUGIN_ROOT}/skills/shared/model-routing.md`); the prompt names the tier it is running and carries the verbatim bytes, nothing else. Fallback per that file: when the agent type is not found, run `/reload-plugins` once (an agent added by a plugin install or update, or written this session, registers only after a reload), then `general-purpose` with no model parameter and M2's instruction for that tier pasted in.
- **Save each check's output as it runs**, with the form under "Where the report is written" in the shared template inlined below (the folder, the `<run-stamp>`, the `<lens>-<n>.txt` file name, and the redirect-then-cat command). It lives in the template so a directly typed skill follows the same form; do not restate it here. On this path `<lens>` is the specialist that authored the finding, or `inline` on the Phase 1.5 path.

Killed findings exit to the Audited out log (never fixed); survivors proceed to Phase 5 with receipts attached.

### Phase 5: Report

1. **Derive the markdown report** from the surviving findings using the format below, opening with the Phase 0 scope line: each finding's `what` becomes the dash summary line, each `fields[]` row becomes a labeled sub-bullet in order, and each finding's `receipt` plus the output tier 1 captured for it fills the template's final **Receipt:** row. Killed findings render in the template's Audited out section.
2. **Write that markdown to disk** per the "Where the report is written" section of the shared template inlined below. Use `orchestrator` as the `<who>` segment. The section holds the path shape, the stderr rule, and why the on-disk copy is the canonical one; do not restate them here.
3. **Derive the HTML** (when the gate fires) from the SAME findings structure, at the END of the run - see HTML Companion below. On an auto run that is after the loop below has settled, so the page shows what was fixed and what is still open; on a "report only" run it is right after this report, since nothing gets fixed. The findings are authored once (by the specialists) and formatted twice (markdown + HTML); they are never re-written. The HTML is a reader's view and may carry less than the markdown; the markdown never carries less than the HTML.

</procedure>

## Output Format

<output_format>

### Specialists Dispatched
```
[code] ✅ | [ux] ✅ | [plan] ⏭️ skipped (no plan file) | [deps] ✅ | [security] ❌ failed (continued without it)
```

A `❌ failed` chip is the specialist that still failed after its retry and was continued past on the human's answer (M2); it is also listed under "What I could not check" in the markdown report (`report-format.md`), so the archive names the gap and not only the page.

When Phase 3 seeded must-check items, the line ends with one more chip, `[must-check] N seeded from <plan file>`, so the report shows the plan's open gaps were entered and not dropped.

### Base Structure

The orchestrator report uses the two-sentence finding contract inlined below from the shared template. This is the single source of truth - do not duplicate it elsewhere. The `<shared_template>` tags isolate the inlined content from this file's own heading hierarchy so the template's headings do not collide with the orchestrator's structure.

The orchestrator fills this structure from the surviving JSON findings (Phases 3-4): each finding's `what` becomes the dash summary line, `context` becomes the unlabeled sub-bullet under it when present, `fix` becomes the **Fix:** row, and any `fields[]` attachments become labeled sub-bullets in order. It does not re-author the prose - it formats what the specialists already wrote.

<shared_template>
!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/report-format.md"`

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-contract.md"`
</shared_template>

### Orchestrator Supplement

The orchestrator adds a `[specialist]` tag right after each finding ID, indicating which specialist flagged it. A finding Phase 3 merged lists every source: `[code, ux]`.

The Top Issues line also carries the tag: `🚫 X Blocks: R1 [code] (file:line - one-line What)`.

**Suppress the inlined Summary block.** The shared template inside `<shared_template>` includes its own `### Summary` block. Do NOT render it. Use only the orchestrator-specific Summary below (which adds Specialists run and Deduplicated findings). Otherwise the report ends with two Summary blocks and the reader cannot tell which is authoritative.

**Merging code+browser findings.** When both the code and browser specialists flag the same issue, preserve all fields from both. Do not drop the browser-only evidence fields (Screenshot, Evidence, Expected, Actual) - they pair with the code root cause to form a unified evidence-plus-fix report. The merged finding uses the browser field order from the template, unchanged.

The tag is the only thing this section adds to a finding. Every row - the three prose keys (`what`, `context`, `fix`), the browser evidence fields, and the audit-time **Receipt** row - is defined by the inlined template and rendered from there:

- **R1** [code] 🚫 `file:line` - [What]
  - [field rows per the template, **Receipt** last]

- **R3** [code, browser] ⚠️ `file:line` - [Issue flagged by both code and browser specialists]
  - [browser field rows per the template, **Receipt** last]

### The first screen (orchestrator, HTML only)

The HTML companion opens on a **bottom line**, not on a counter strip. Write two or three sentences, 25 words or fewer each so the bottom line fits the page's first screen, in fixed slots: is it safe to ship (including "I could not tell, because..." when that is the honest answer), the one other thing that matters, and what happens next. Then one **disposition** sentence carrying counts only: how many were fixed, deferred, and left unchecked. It must not restate a bottom-line sentence. The bottom line says what happens next in words; the disposition says how many, in figures.

Also fill **What I already fixed** and **What I could not check**; each `NOT CHECKED:` line a specialist returned goes under the latter as `[<specialist>] <its sentence>`, on the page and in the markdown report. These are the base-rate disclosure: a short list of open findings reads as a review that did not look hard unless it sits beside the count of what was handled and the named limits of the pass. Never omit the limits when limits exist.

Derive all four from the run you just did. None of them is a new judgement: the bottom line follows the same mechanical rule as the Overall Verdict below, the disposition is a count, and the two lists are records of what the loop already did.

### Overall Verdict, readability, and the security nudge (orchestrator)

The inlined template defines the **Overall Verdict** line, the **readability backstop**, and the receipt rule. Apply each across the merged run rather than per specialist. Two things are specific to this path:

- **Compute the Verdict from the audit survivors**, not from everything the specialists reported. A Block the Phase 4 audit killed does not make the run `changes-requested`; the same goes for the readability backstop's count.
- **Security escalation nudge:** if the changed files touch a genuine trust boundary - a new route/endpoint, file upload, or webhook; authentication logic; crypto; or secret handling - append one line after the report: _"Consider `/tk:security-audit`: this change touches [X], which deserves a deeper whole-repo pass."_ Only when a trigger is genuinely present; the Security specialist also emits this when called directly.

### Audited out

Rendered exactly as the template's "Audited out" section defines it - placement, verdict labels, the `Audited out: none` line, the empty-run rule, and the never-omit rule. The orchestrator's only addition is the `[specialist]` tag on each ID, as everywhere else: `- **R7** [code] \`RECEIPT FAILED\` - [What] (check output did not show the claim)`.

### Summary (orchestrator-specific)
- Scope: `<base>..<end>` (N commits, <why>) plus uncommitted work, as Phase 0 named it
- Specialists run: X of Y
- Files reviewed: X
- Blocks: X | Warns: X | Suggests: X (audit survivors)
- Deduplicated findings: X (Y raw findings from specialists); audited out: Z

End the report with one line so the user knows what happens next: _"The loop now auto-fixes and re-verifies the surviving findings (auto loop in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`); saying 'report only' at the start would have kept this run report-first."_

</output_format>

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template (it covers the gate and the data-injection steps):

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/html-render-review.md"`

For orchestrator output specifically:
- Pass `--name review --stable` to the helper: the HTML is one standing page per repository, not one per run. Set `lenses` to the specialists this run dispatched, so the renderer replaces only their findings and carries the other lenses' open findings forward (the fragment above says how). Two paths dispatch nothing and still need the right value: on `/tk:review full`, omit `lenses` exactly as `/tk:review-full` does, because a full check replaces the whole page; on the Phase 1.5 inline path, set `lenses` to the domains the file-type table flagged for the diff, because those are the lenses this run checked
- Include the `chips` array when 2 or more specialists were dispatched; omit it for single-specialist orchestrator runs
- Use the `groups[]` array (findings grouped by specialist); the renderer ranks them itself, so the order you send does not matter. These finding objects ARE the surviving Phase 4 findings - same `severity`, `specialist`, `file`, `what`, `context`, `fix`, `fields` shape - grouped by specialist with the assigned `id`, each `receipt` carrying the `stdoutFile` the Phase 4 save step wrote. Do NOT re-derive findings from the markdown prose; map the structured findings directly.
- On an auto run the render happens after the loop (After the Report, step 6): the findings the loop fixed go to `alreadyFixed`, one line each with the check that confirmed the fix, and only the unfixed ones stay in `groups[]`
- The Receipt field rows and the Audited out group render per the audit rows rule in the shared HTML fragment above; the orchestrator's only addition is the `[specialist]` tag carried inside each finding's `what`/`id` as everywhere else.

## After the Report (auto loop)

What happens after the report is governed by the shared auto-loop fragment (the M-rule IDs cited in this file refer to it):

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md"`

**Project fix rules** (from `.claude/toolkit/fix-rules.md`). Additive only: they may add a precondition or an always-ask action, and a line that loosens or removes any of M1 to M15 is void. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/fix-rules.md 2>/dev/null || true`

Once the report is out, continue without waiting for a human "fix it" (the HTML comes at step 6, after the loop, so it shows what the loop left open):

1. **Non-issues are already gone** - the Phase 4 audit (M2) dropped them to the Audited out log with their verdict lines; do not re-litigate them here.
2. **Auto-fix the survivors** - subject to the intent-reversal guard (M7) and the always-ask actions (M9). A finding marked `unaudited` is not a survivor: M2 makes it report-only, so it is never fixed here and goes to the digest marked as needing the user.
3. **Re-verify every fix** per M3 (which defines the mechanical-vs-judgment split and the "R3: FIXED" / "R3: NOT FIXED" verdict format), M5 (including its one-generation rule for newly discovered findings), and M6. Mechanical findings re-run their own check; judgment findings go to `subagent_type=tk:fix-verifier` shards, the typed verifier M3 names, carrying the diff of the fixes as M3 defines it: `git diff <baseline>` when Phase 0's scope reported `uncommitted.baseline`, else `git diff <range.end>` (either shows every tracked change since that point, committed or not), with untracked files handled by M3's rule against the starting `uncommitted.untracked.files` list. Read all three values back from `reports/receipts/<run-stamp>/scope.json`, saved in Phase 0, never from memory. A `baselineError` means the pinned end was used: say so under "What I could not check".
4. **Route each finding to its exit** - page only per M1; everything else lands in the digest or the log.
5. **Close the run in chat** - summarize the digest with receipts (M8): what was fixed, what the audit and the loop dropped, and any page that needs the user.
6. **Write the digest to disk and render the standing page** - append a `## Digest` section to the markdown report Phase 5 wrote: one line per finding with its verdict and receipt (`R3: FIXED - <check>`, `R5: NOT FIXED - <what was tried>`, `R7: PAGED - <what needs the human>`), plus any finding the loop discovered on the way. Chat scrollback is not a file, and the fixes were the one part of the run that had none. Then render the HTML per the HTML Companion section when its gate fires, which with a standing page in place is every run, a clean one included, so the page can go empty: fixed findings in `alreadyFixed`, unfixed ones open, `lenses` set to the specialists that ran, `disposition` recounted; publish and record it per the fragment. This is the run's one render.
7. **Chain into `/tk:document`** (M14) - once the loop has settled, announce the handoff in one line ("Review complete - chaining into `/tk:document` per M14. Say \"no chaining\" to stop here.") and invoke `/tk:document` through the Skill tool. M14 is authoritative for the conditions. **Do not chain** while a hard stop is still open: an M5 revert to the last green checkpoint, an unresolved blocker, a specialist that failed its retry and whose page is unanswered, an M11 tripwire hit, or a page still waiting on the human's answer. An M9 approval already granted does **not** block, so a cycle that edited prompt files still chains once the approvals are in. A cycle summary written over a reverted state is exactly the bookkeeping drift M8 exists to prevent. The debate stages are never chained into. To run one between review and document, drive the two stages yourself: say "no chaining" when you approve the plan (`/tk:execute` then runs and stops), type `/tk:review <start>..HEAD no chaining` with the plan's `**Start commit:**` sha (the review runs and stops), run the debate, then type `/tk:document`.

Two separate per-run opt-outs: saying "report only" on the invocation keeps the entire run report-first (M10), and saying "no chaining" runs the review and stops without invoking `/tk:document` (M14).

## HTML Output Rules

Every HTML decision above (whether to render, `--no-abs`, publish or open locally, record the publish) is governed by the shared rules fragments, inlined here so they are in context when the render runs.

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md"`

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/html-viewing.md"`

<rules>
## REMEMBER: Specialists report; the loop fixes. After the report, continue per the auto loop above and chain into `/tk:document` (M14); "report only" keeps a run report-first (M10), "no chaining" stops after this stage.
</rules>
