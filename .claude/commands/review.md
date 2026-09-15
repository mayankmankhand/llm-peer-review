# Unified Review

Run the right reviews automatically, combine findings into one report.

**Use this when:** You want a single command to review your changes. It detects what changed and dispatches the right specialists.
**Don't use this when:** You want a pre-release gate (use `/review-full`). Or you know exactly which review you need (use `/review-code`, `/review-ux`, etc. directly).

**The difference:** `/review` checks what you just changed. `/review-full` checks if the whole thing is ready to ship.

## Critical Rules

<rules>

1. **REVIEWERS NEVER EDIT** - Specialists and the report phase never modify files; findings are their product
2. **Audit, then continue into the auto loop** - Findings are deduped and audited (M2: receipts, skeptical pass, three-vote for Blocks) BEFORE the report, so the report shows survivors only. After the report, do not wait for a human "fix it": auto-fix survivors (guards: M7, M9), re-verify (M3, M5, M6), and exit each finding as page (M1), digest, or log. Operating rules live in `.claude/skills/shared/hitl-loop.md`, inlined under "After the Report" below. Saying "report only" keeps this run report-first (M10)
3. **Explain simply** - Use plain English, avoid jargon
4. **Respect the concurrency cap** - Max 4 parallel subagents per run

</rules>

## Focus Mode

<reference>

This command supports optional focus arguments:

- `/review` - auto-detect what to review based on changes
- `/review code` - just code quality
- `/review code,ux` - specific combination
- `/review full` - invokes the review-full skill (same as `/review-full`)
- `/review <base>..<end>` - a commit range plus any uncommitted work, e.g. `/review a1b2c3d..HEAD`; it combines with focus names (`/review code a1b2c3d..HEAD`). `/execute` passes one when it chains here (M14)

If focus arguments are provided, skip the detection phase and dispatch only the specified specialists. The arguments map to skill names: `code` = review-code, `security` = review-security, `ux` = review-ux, `plan` = review-plan, `commands` = review-commands, `browser` = review-browser, `deps` = review-deps, `copy` = review-copy, `full` = review-full. An argument containing `..` is the range, never a focus name (no focus name contains `..`).

</reference>

## How It Works

<procedure>

### Phase 0: Resolve the scope (every run)

`/execute` commits every green step, so uncommitted work alone can be empty when there is plenty to review (#182). Decide what this run covers before anything else, with one call from the project root, run as literal words (never inside `$(...)`):

- with a range argument: `node .claude/scripts/session-init.js --scope <base>..<end>`, passing the range exactly as it was typed
- without one: `node .claude/scripts/session-init.js --scope`

It prints one JSON object (the full shape is in the script's header comment). Read:

- **`range.end` is the pinned end.** The review covers `range.base..range.end` plus the uncommitted work, and nothing after it. This run's own fix commits land after the report, so everything after the pinned end (`<range.end>..HEAD`, plus what is uncommitted once the report is out) is the diff of the fixes M3 verifies and where M5's follow-up generation looks.
- **`source`** says where the range came from: `argument` (the range you were given), `unpushed` (no argument: the newest unpushed commits, counted from the merge-base with the upstream, else with the remote's default branch), or `none` (no range; `message` says why in one plain sentence).
- **`range.commits`** lists up to 20 commits, newest first. `range.capped` is true when older unpushed commits were left out, `range.omitted` counts them, and `range.fullBase` is where they start.
- **The changed files** are `range.files` plus the `files` lists under `uncommitted.staged`, `uncommitted.unstaged` and `uncommitted.untracked`; `totals.lines` sums their added and deleted lines. From here on, "the diff" and "the changed files" mean this scope.

Name the scope in one line before anything is dispatched, and open the report with the same line:

- **Commits in range:** "Reviewing N commits (`<base>..<end>`, short shas) plus uncommitted work." Drop "plus uncommitted work" when there is none. When `range.capped` is true, add: "M older unpushed commits were left out; `/review <range.fullBase>..HEAD` includes them."
- **A range argument that `source` reports as `none`:** stop. Say "That range cannot be reviewed: <message>" and ask for one whose base is an ancestor of its end.
- **No commits in range, uncommitted work present:** "Reviewing uncommitted work only; no commits in range." Add the `message` when there is one.
- **No commits in range and nothing uncommitted:** on the auto-detect path, stop with "Nothing to review: no commits in range and no uncommitted changes (<message, when there is one>). Pass a range: `/review <base>..HEAD`." A focus call continues as it always has.

**Fallback:** if the script is missing (an older install) or its output carries an `error` field, review the uncommitted work only (`git diff --name-only`, `git diff --name-only --cached`, and `git status --short` for untracked files; `git diff --numstat` for the size gate) and say in the scope line that no commit range was checked.

### Phase 1: Detect (skip if focus arguments provided)

The changed files come from the scope (Phase 0).

Categorize the changes and pick relevant specialists:

| What changed | Specialist | Finder agent |
|---|---|---|
| `.ts`, `.js`, `.py`, `.go`, `.rs`, `.java`, `.sh` files | Code Quality | `subagent_type=review-code-finder` |
| The same code files (any code change) | Security | `subagent_type=review-security-finder` |
| `.tsx`, `.jsx`, `.vue`, `.svelte`, `.css`, `.scss`, `.html` files | UX Quality | `subagent_type=review-ux-finder` |
| Active `PLAN-*.md` exists in `plans/` | Plan Compliance | `subagent_type=review-plan-finder` |
| `.claude/commands/` or `.claude/skills/` files changed | Command Quality | `subagent_type=review-commands-finder` |
| `package.json` or lockfile changed | Dependency Security | `subagent_type=review-deps-finder` |
| Visual/UI changes AND a dev server is running | Browser QA | `subagent_type=review-browser-finder` |
| `README.md`, `index.html`, or files in `docs/`, `pages/`, `content/`, `posts/` (exclude `CHANGELOG.md`, ADRs, API refs, generated docs) | Copy Clarity | `subagent_type=review-copy-finder` |

**Rules:**
- A file can trigger multiple specialists (e.g., a `.tsx` file triggers both Code and UX)
- **Security runs on every code change, alongside Code Quality.** The same files that select Code Quality also select Security (review-security). Code Quality asks "is this written well?"; Security asks "what can a malicious user make this do?" - different lenses, both run. Security has its own danger-spot gate, so it stays quiet on changes that touch no security-sensitive sink.
- When copy and UX both run on the same artifact, copy focuses on meaning/orientation while UX focuses on usability/accessibility. Deduplicate overlapping findings in synthesis.
- An empty scope never reaches this table: Phase 0 already stopped the run, or it is a focus call, which skips detection
- For browser-qa, check if a server is reachable on common ports (3000, 3001, 5173, 8080) before dispatching

### Phase 1.5: Size gate (skip the fan-out for tiny diffs)

This gate applies only to the auto-detect path. (Explicit focus calls like `/review code` and `/review full` skip detection entirely, so they never reach this gate - the specialist you named always runs, regardless of size.)

Count the changed lines: `totals.lines` from the scope, which sums added and deleted lines across the range, staged, unstaged and untracked work (a review of the uncommitted work alone once missed every committed line). **If the total is under 50 changed lines AND none of the selected specialists is a never-gate one, skip Phase 2 and review the diff inline** in a single pass: you (the orchestrator) read the changed files and produce the report yourself, using the same severity anchors, finding IDs, and output format the specialists would use, covering whichever domains the file-type table flagged. Author a `receipt` for each inline finding and run the Phase 4 audit before writing the report - tier 1 inline, tiers 2 and 3 via fresh subagents per the inline-path note in Phase 4.

**Never-gate specialists:** Dependency Security (selected when a `package.json`/lockfile changed) and Security (selected whenever code changes). Either one's presence disables the size gate for the whole run - diff size is not a proxy for risk. A one-line change can introduce a severe vulnerability or pull in a bad dependency, so neither security pass is ever skipped for being small. (Trade-off: because Security is selected on any code change, code reviews fan out to subagents rather than taking the fast inline path - the deliberate cost of never size-gating security.)

The inline path continues into the same auto loop after the report (see "After the Report" below) and still obeys the HTML gate; it simply has no specialist subagents to dispatch - the Phase 4 audit still dispatches its skeptics per the inline-path note.

### Phase 2: Dispatch

Each specialist is a typed finder agent that already carries its expertise (issue #167). The agent's `skills:` frontmatter preloads its `review-<kind>-criteria` skill (the How to Review criteria, reading budget, severity anchors, finding ids, and the finding contract) and the `dispatch-contract` skill (single pass, JSONL out, never audits its own findings), and its expert role is the first line of its body. Nothing from a SKILL.md is read here or pasted into a prompt: the prompt carries only what differs per run.

1. Gather project context with the `project-context` skill: invoke it through the Skill tool (`Skill(project-context)`; it is agent-only, never a slash command) and follow its instructions. Its summary goes into every finder prompt.
2. Read the changed files once, here, so each finder receives the relevant excerpts instead of re-opening every file (paste-don't-read). A change committed in the range shows in `git diff <range.base> <range.end> -- <path>`, and uncommitted work in `git diff HEAD -- <path>` (an untracked file is new in full); single-quote a path that holds a space.
3. Spawn one subagent per selected specialist with the Agent tool, using the exact `subagent_type=` value in the Finder column of the Phase 1 table (one typed finder per kind; the table holds the dispatchable name, so copy it rather than composing one). Its model, effort, and tool set (no file-editing tools) come from its frontmatter per the roster in `.claude/skills/shared/model-routing.md`. Fallback per that rule: when the type is not found and the toolkit plugin was installed or updated this session, run `/reload-plugins` once and retry; otherwise dispatch `general-purpose` carrying what the roster row declares plus what the agent's two skills would have preloaded, pasted as the fragments those skills include rather than the SKILL.md files, whose include lines do not expand when pasted: every file named on an include line of `.claude/skills/review-<kind>-criteria/SKILL.md`, in its order (for most kinds `criteria-<kind>.md`, `reading-budget.md`, `severity-anchors.md`, `finding-id-system.md`, and `finding-contract.md` from `.claude/skills/shared/`; security adds `do-not-report.md` and browser adds `browse-api.md`), then the contract paragraph of `.claude/skills/dispatch-contract/SKILL.md` followed by `.claude/skills/shared/dispatch-format.md`.

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
[ONLY WHAT THIS RUN NEEDS, OR OMIT THE SECTION: the focus arguments; the plan file path for the plan finder; the dev server URL for the browser finder; which other specialists run alongside, so copy and UX split meaning from usability.]
```

The role, the criteria, the review lens, and the single-pass contract used to be pasted here; they now live in the agent and the two skills it preloads, so a `/review` that compacts mid-run loses nothing and four dispatches no longer carry four copies of the manual. What the finder returns is fixed by the `dispatch-contract` skill; the orchestrator parses that format, so it is inlined here from the one file both share:

!`cat .claude/skills/shared/dispatch-format.md`

**If a subagent fails** (error, timeout, empty response, or output that will not parse as JSONL), re-dispatch that one finder once with the same prompt - and when it was running on a pinned model, dispatch the retry one tier up per guardrail 2 in `.claude/skills/shared/model-routing.md`. Malformed output counts as a failure precisely because it is silent: a specialist that returns prose instead of JSONL has produced nothing the run can use. Still failing after the one retry: note it in the final report: "Note: [Specialist name] review did not complete. Run `/review [type]` to retry."

### Phase 3: Synthesize

Collect the JSONL findings from all subagents (a specialist that emitted `NO FINDINGS` contributes none). Then:

1. **Dedup mechanically** - group findings by their `key`. Findings sharing a key are the same issue: merge them into one, unioning their `specialist` values (e.g. `[code, ux]`) and their `fields` (keep the browser-only evidence fields - Screenshot, Evidence, Expected, Actual - when a browser finding merges with a code one). Keep every merged finding's `receipt`: tier 1 runs each of them, and the finding stands if at least one check passes - a corroborated finding never dies on a single badly-written check. **A merged finding takes the HIGHEST severity of its sources** (Blocks over Warns over Suggests): severity is what routes the audit in Phase 4, so a Block merged down to a Warn would face one skeptic where M2 requires three voters, and two specialists independently flagging the same spot is corroboration, which never lowers confidence. This is a free, mechanical pass over structured data - no re-judging.
2. **Order and number** - sort by severity (Blocks first, then Warns, then Suggests) and assign a single R1, R2, R3 ... sequence across ALL deduped findings. No gaps, no duplicates. Tag each ID with its merged specialist source(s): `**R1** [code] 🚫`, `**R3** [ux, plan] ⚠️`. The audit runs next, so some IDs will exit to the Audited out log rather than the report; the sequence stays gap-free across report plus log, and audit verdict lines reference these IDs.

### Phase 4: Audit (M2)

The three-tier audit runs here, between dedup and the report: the orchestrator is M2's *runner*. M2 in `.claude/skills/shared/hitl-loop.md` (inlined under "After the Report") holds every mechanic - the tiers and what each covers, the skeptic instruction, the verdict formats, dispatch hygiene, the concurrency note, and the redispatch-on-failure rule. Do not restate them here and do not improvise a variant.

Two things are specific to this path:

- **The bytes are JSONL.** A finding's `receipt.check` is its tier 1 command and `receipt.expect` is the line the output must satisfy. A merged finding carries every source receipt and stands if at least one check passes (Phase 3). What tiers 2 and 3 receive is the original JSONL lines plus each receipt's actual output.
- **The inline path is not exempt.** When Phase 1.5 reviewed the diff inline, the orchestrator authors receipts for its own findings and runs tier 1 the same way, but tiers 2 and 3 still dispatch fresh `audit-skeptic` agents. M2's never-judge-your-own-findings rule applies here exactly as it does to dispatched specialists.
- **The skeptics are typed.** Tier 2 shards and tier 3 voters are `subagent_type=audit-skeptic` dispatches (no edit tools, `effort: high`, session model, per the roster in `.claude/skills/shared/model-routing.md`); the prompt names the tier it is running and carries the verbatim bytes, nothing else. Fallback per that file: `/reload-plugins` once when the plugin was installed this session, then `general-purpose` with no model parameter and M2's instruction for that tier pasted in.
- **Save each check's output as it runs**, with the form under "Where the report is written" in the shared template inlined below (the folder, the `<run-stamp>`, the `<lens>-<n>.txt` file name, and the redirect-then-cat command). It lives in the template so a directly typed skill follows the same form; do not restate it here. On this path `<lens>` is the specialist that authored the finding, or `inline` on the Phase 1.5 path. The v6.3.0 renderer had this slot and nothing wrote to it: on its first real run, every receipt that reached the page had been typed.

Killed findings exit to the Audited out log (never fixed); survivors proceed to Phase 5 with receipts attached.

### Phase 5: Report

1. **Derive the markdown report** from the surviving findings using the format below, opening with the Phase 0 scope line: each finding's `what` becomes the dash summary line, each `fields[]` row becomes a labeled sub-bullet in order, and each finding's `receipt` plus the output tier 1 captured for it fills the template's final **Receipt:** row. Killed findings render in the template's Audited out section.
2. **Write that markdown to disk** per the "Where the report is written" section of the shared template inlined below. Use `orchestrator` as the `<who>` segment. The section holds the path shape, the stderr rule, and why the on-disk copy is the canonical one; do not restate them here.
3. **Derive the HTML** (when the gate fires) from the SAME findings structure, at the END of the run - see HTML Companion below. On an auto run that is after the loop below has settled, so the page shows what was fixed and what is still open; on a "report only" run it is right after this report, since nothing gets fixed. The page used to be rendered here, before any fix, and was stale within minutes of being published. The findings are authored once (by the specialists) and formatted twice (markdown + HTML); they are never re-written. The HTML is a reader's view and may carry less than the markdown; the markdown never carries less than the HTML.

</procedure>

## Output Format

<output_format>

### Specialists Dispatched
```
[code] ✅ | [ux] ✅ | [plan] ⏭️ skipped (no plan file) | [deps] ✅
```

### Base Structure

The orchestrator report uses the two-sentence finding contract inlined below from the shared template. This is the single source of truth - do not duplicate it elsewhere. The `<shared_template>` tags isolate the inlined content from this file's own heading hierarchy so the template's headings do not collide with the orchestrator's structure.

The orchestrator fills this structure from the surviving JSON findings (Phases 3-4): each finding's `what` becomes the dash summary line, `context` becomes the unlabeled sub-bullet under it when present, `fix` becomes the **Fix:** row, and any `fields[]` attachments become labeled sub-bullets in order. It does not re-author the prose - it formats what the specialists already wrote.

<shared_template>
!`cat .claude/skills/shared/report-format.md`

!`cat .claude/skills/shared/finding-contract.md`
</shared_template>

### Orchestrator Supplement

The orchestrator adds a `[specialist]` tag right after each finding ID, indicating which specialist flagged it. If multiple specialists flagged the same file:line with the same issue, merge them and list all sources: `[code, ux]`.

The Top Issues line also carries the tag: `🚫 X Blocks: R1 [code] (file:line - one-line What)`.

**Suppress the inlined Summary block.** The shared template inside `<shared_template>` includes its own `### Summary` block. Do NOT render it. Use only the orchestrator-specific Summary below (which adds Specialists run and Deduplicated findings). Otherwise the report ends with two Summary blocks and the reader cannot tell which is authoritative.

**Merging code+browser findings.** When both the code and browser specialists flag the same issue, preserve all fields from both. Do not drop the browser-only evidence fields (Screenshot, Evidence, Expected, Actual) - they pair with the code root cause to form a unified evidence-plus-fix report. The merged finding uses the browser field order from the template, unchanged.

The tag is the only thing this section adds to a finding. Every row - the three prose keys (`what`, `context`, `fix`), the browser evidence fields, and the audit-time **Receipt** row - is defined by the inlined template and rendered from there:

- **R1** [code] 🚫 `file:line` - [What]
  - [field rows per the template, **Receipt** last]

- **R3** [code, browser] ⚠️ `file:line` - [Issue flagged by both code and browser specialists]
  - [browser field rows per the template, **Receipt** last]

### The first screen (orchestrator, HTML only)

The HTML companion opens on a **bottom line**, not on a counter strip. Write two or three sentences, 25 words or fewer each, in fixed slots: is it safe to ship (including "I could not tell, because..." when that is the honest answer), the one other thing that matters, and what happens next. Then one **disposition** sentence carrying counts only: how many were fixed, deferred, and left unchecked. It must not restate a bottom-line sentence. The bottom line says what happens next in words; the disposition says how many, in figures.

Also fill **What I already fixed** and **What I could not check**. These are the base-rate disclosure: a short list of open findings reads as a review that did not look hard unless it sits beside the count of what was handled and the named limits of the pass. Never omit the limits when limits exist.

Derive all four from the run you just did. None of them is a new judgement: the bottom line follows the same mechanical rule as the Overall Verdict below, the disposition is a count, and the two lists are records of what the loop already did.

### Overall Verdict, readability, and the security nudge (orchestrator)

The inlined template defines the **Overall Verdict** line, the **readability backstop**, and the receipt rule. Apply each across the merged run rather than per specialist. Two things are specific to this path:

- **Compute the Verdict from the audit survivors**, not from everything the specialists reported. A Block the Phase 4 audit killed does not make the run `changes-requested`; the same goes for the readability backstop's count.
- **Security escalation nudge:** if the changed files touch a genuine trust boundary - a new route/endpoint, file upload, or webhook; authentication logic; crypto; or secret handling - append one line after the report: _"Consider `/security-audit`: this change touches [X], which deserves a deeper whole-repo pass."_ Only when a trigger is genuinely present; the Security specialist also emits this when called directly.

### Audited out

Rendered exactly as the template's "Audited out" section defines it - placement, verdict labels, the `Audited out: none` line, the empty-run rule, and the never-omit rule. The orchestrator's only addition is the `[specialist]` tag on each ID, as everywhere else: `- **R7** [code] \`RECEIPT FAILED\` - [What] (check output did not show the claim)`.

### Summary (orchestrator-specific)
- Scope: `<base>..<end>` (N commits) plus uncommitted work, as Phase 0 named it
- Specialists run: X of Y
- Files reviewed: X
- Blocks: X | Warns: X | Suggests: X (audit survivors)
- Deduplicated findings: X (Y raw findings from specialists); audited out: Z

End the report with one line so the user knows what happens next: _"The loop now auto-fixes and re-verifies the surviving findings (auto loop in `.claude/skills/shared/hitl-loop.md`); saying 'report only' at the start would have kept this run report-first."_

</output_format>

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template (it covers the gate and the data-injection steps):

!`cat .claude/skills/shared/html-render-review.md`

For orchestrator output specifically:
- Pass `--name review --stable` to the helper: the HTML is one standing page per repository, not one per run. Set `lenses` to the specialists this run dispatched, so the renderer replaces only their findings and carries the other lenses' open findings forward (the fragment above says how). Two paths dispatch nothing and still need the right value: on `/review full`, omit `lenses` exactly as `/review-full` does, because a full check replaces the whole page; on the Phase 1.5 inline path, set `lenses` to the domains the file-type table flagged for the diff, because those are the lenses this run checked (review of the #162 cycle, R5 and R16)
- Include the `chips` array when 2 or more specialists were dispatched; omit it for single-specialist orchestrator runs
- Use the `groups[]` array (findings grouped by specialist); the renderer ranks them itself, so the order you send does not matter. These finding objects ARE the surviving Phase 4 findings - same `severity`, `specialist`, `file`, `what`, `context`, `fix`, `fields` shape - grouped by specialist with the assigned `id`, each `receipt` carrying the `stdoutFile` the Phase 4 save step wrote. Do NOT re-derive findings from the markdown prose; map the structured findings directly.
- On an auto run the render happens after the loop (After the Report, step 6): the findings the loop fixed go to `alreadyFixed`, one line each with the check that confirmed the fix, and only the unfixed ones stay in `groups[]`
- The Receipt field rows and the Audited out group render per the audit rows rule in the shared HTML fragment above; the orchestrator's only addition is the `[specialist]` tag carried inside each finding's `what`/`id` as everywhere else.

## After the Report (auto loop)

What happens after the report is governed by the shared auto-loop fragment (the M-rule IDs cited in this file refer to it):

!`cat .claude/skills/shared/hitl-loop.md`

Once the report is out, continue without waiting for a human "fix it" (the HTML comes at step 6, after the loop, so it shows what the loop left open):

1. **Non-issues are already gone** - the Phase 4 audit (M2) dropped them to the Audited out log with their verdict lines; do not re-litigate them here.
2. **Auto-fix the survivors** - subject to the intent-reversal guard (M7) and the always-ask actions (M9).
3. **Re-verify every fix** per M3 (which defines the mechanical-vs-judgment split and the "R3: FIXED" / "R3: NOT FIXED" verdict format), M5 (including its one-generation rule for newly discovered findings), and M6. Mechanical findings re-run their own check; judgment findings go to `subagent_type=fix-verifier` shards, the typed verifier M3 names, carrying the diff of the fixes: everything after the pinned end (`git diff <range.end>` shows every tracked change since it, committed or not; add any new untracked file in full).
4. **Route each finding to its exit** - page only per M1; everything else lands in the digest or the log.
5. **Close the run in chat** - summarize the digest with receipts (M8): what was fixed, what the audit and the loop dropped, and any page that needs the user.
6. **Write the digest to disk and render the standing page** - append a `## Digest` section to the markdown report Phase 5 wrote: one line per finding with its verdict and receipt (`R3: FIXED - <check>`, `R5: NOT FIXED - <what was tried>`, `R7: PAGED - <what needs the human>`), plus any finding the loop discovered on the way. Chat scrollback is not a file, and the fixes were the one part of the run that had none. Then render the HTML per the HTML Companion section when its gate fires, which with a standing page in place is every run, a clean one included, so the page can go empty: fixed findings in `alreadyFixed`, unfixed ones open, `lenses` set to the specialists that ran, `disposition` recounted; publish and record it per the fragment. This is the run's one render.
7. **Chain into `/document`** (M14) - once the loop has settled, announce the handoff in one line ("Review complete - chaining into `/document` per M14. Say \"no chaining\" to stop here.") and invoke `/document` through the Skill tool. M14 is authoritative for the conditions. **Do not chain** while a hard stop is still open: an M5 revert to the last green checkpoint, an unresolved blocker, an M11 tripwire hit, or a page still waiting on the human's answer. An M9 approval already granted does **not** block, so a cycle that edited prompt files still chains once the approvals are in. A cycle summary written over a reverted state is exactly the bookkeeping drift M8 exists to prevent. The debate stages are never chained into. To get that window, drive the two stages yourself: say "no chaining" when you approve the plan (`/execute` then runs and stops), type `/review <start>..HEAD no chaining` with the plan's `**Start commit:**` sha (the review runs and stops), run the debate, then type `/document`.

Two separate per-run opt-outs: saying "report only" on the invocation keeps the entire run report-first (M10), and saying "no chaining" runs the review and stops without invoking `/document` (M14).

## HTML Output Rules

Every HTML decision above (whether to render, `--no-abs`, publish or open locally, record the publish) is governed by the shared rules fragment, inlined here so it is in context when the render runs. It was an always-on rules file until v7.0.0 (issue #167); now it loads with the commands that need it.

!`cat .claude/skills/shared/html-outputs.md`

<rules>
## REMEMBER: Specialists report; the loop fixes. After the report, continue per the auto loop above and chain into `/document` (M14); "report only" keeps a run report-first (M10), "no chaining" stops after this stage.
</rules>
