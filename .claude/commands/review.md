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

If focus arguments are provided, skip the detection phase and dispatch only the specified specialists. The arguments map to skill names: `code` = review-code, `security` = review-security, `ux` = review-ux, `plan` = review-plan, `commands` = review-commands, `browser` = review-browser, `deps` = review-deps, `copy` = review-copy, `full` = review-full.

</reference>

## How It Works

<procedure>

### Phase 1: Detect (skip if focus arguments provided)

Run `git diff --name-only` (staged + unstaged) and `git diff --name-only --cached` to see all changed files. Also check for untracked files with `git status --short`.

Categorize the changes and pick relevant specialists:

| What changed | Specialist | Skill file |
|---|---|---|
| `.ts`, `.js`, `.py`, `.go`, `.rs`, `.java`, `.sh` files | Code Quality | `.claude/skills/review-code/SKILL.md` |
| The same code files (any code change) | Security | `.claude/skills/review-security/SKILL.md` |
| `.tsx`, `.jsx`, `.vue`, `.svelte`, `.css`, `.scss`, `.html` files | UX Quality | `.claude/skills/review-ux/SKILL.md` |
| Active `PLAN-*.md` exists in `plans/` | Plan Compliance | `.claude/skills/review-plan/SKILL.md` |
| `.claude/commands/` or `.claude/skills/` files changed | Command Quality | `.claude/skills/review-commands/SKILL.md` |
| `package.json` or lockfile changed | Dependency Security | `.claude/skills/review-deps/SKILL.md` |
| Visual/UI changes AND a dev server is running | Browser QA | `.claude/skills/review-browser/SKILL.md` |
| `README.md`, `index.html`, or files in `docs/`, `pages/`, `content/`, `posts/` (exclude `CHANGELOG.md`, ADRs, API refs, generated docs) | Copy Clarity | `.claude/skills/review-copy/SKILL.md` |

**Rules:**
- A file can trigger multiple specialists (e.g., a `.tsx` file triggers both Code and UX)
- **Security runs on every code change, alongside Code Quality.** The same files that select Code Quality also select Security (review-security). Code Quality asks "is this written well?"; Security asks "what can a malicious user make this do?" - different lenses, both run. Security has its own danger-spot gate, so it stays quiet on changes that touch no security-sensitive sink.
- When copy and UX both run on the same artifact, copy focuses on meaning/orientation while UX focuses on usability/accessibility. Deduplicate overlapping findings in synthesis.
- If no changes are detected (clean working tree), tell the user: "No changes detected. Use `/review code` to force a specific review."
- For browser-qa, check if a server is reachable on common ports (3000, 3001, 5173, 8080) before dispatching

### Phase 1.5: Size gate (skip the fan-out for tiny diffs)

This gate applies only to the auto-detect path. (Explicit focus calls like `/review code` and `/review full` skip detection entirely, so they never reach this gate - the specialist you named always runs, regardless of size.)

Count the changed lines: run `git diff --numstat` (staged + unstaged) and sum the added + removed columns across all changed files. **If the total is under 50 changed lines AND none of the selected specialists is a never-gate one, skip Phase 2 and review the diff inline** in a single pass: you (the orchestrator) read the changed files and produce the report yourself, using the same severity anchors, finding IDs, and output format the specialists would use, covering whichever domains the file-type table flagged. Author a `receipt` for each inline finding and run the Phase 4 audit before writing the report - tier 1 inline, tiers 2 and 3 via fresh subagents per the inline-path note in Phase 4.

**Never-gate specialists:** Dependency Security (selected when a `package.json`/lockfile changed) and Security (selected whenever code changes). Either one's presence disables the size gate for the whole run - diff size is not a proxy for risk. A one-line change can introduce a severe vulnerability or pull in a bad dependency, so neither security pass is ever skipped for being small. (Trade-off: because Security is selected on any code change, code reviews fan out to subagents rather than taking the fast inline path - the deliberate cost of never size-gating security.)

The inline path continues into the same auto loop after the report (see "After the Report" below) and still obeys the HTML gate; it simply has no specialist subagents to dispatch - the Phase 4 audit still dispatches its skeptics per the inline-path note.

### Phase 2: Dispatch

For each selected specialist:

1. Read the specialist's SKILL.md for its **review criteria** (subagents cannot discover skills on their own). Resolve the shared review blocks it inlines once - severity anchors, finding-id system, do-not-report list, output template, and reading budget - but NOT `html-render-review.md` and NOT the skill's "Audit Before the Report (M2)" section with its inlined `hitl-loop.md`: rendering HTML and running the audit are both the orchestrator's job. Those two sections exist for the skill's DIRECT invocation path, where the skill is itself M2's runner. On this path you are the runner, so a dispatched specialist needs neither. Also note the specialist's **expert role** from its Staff Check section (the Staff Check Variants table in the output template lists each: Staff Engineer for code, Staff Security Engineer for security, Staff Designer for ux, etc.) - you pass this to the subagent as a review lens (see the template below).
2. Also read `.claude/skills/project-context/SKILL.md` and follow its instructions to gather project context
3. Read the changed files once, here, so each subagent receives the relevant excerpts instead of re-opening every file (paste-don't-read)
4. Spawn a subagent using the Agent tool with the prompt template below: the skill's review criteria, the project context summary, and the pre-read file excerpts

**Concurrency:** Dispatch up to 4 subagents in parallel. If more than 4 specialists are relevant, run the first 4 in parallel, wait for results, then run the remainder. Browser QA is always sequential (it drives a browser), so it runs last if included.

**Subagent prompt template:**
```
You are a [PASTE THE SPECIALIST'S EXPERT ROLE, e.g. "Staff Engineer" for code, "Staff Security Engineer" for security, "Staff Designer" for ux - from the skill's Staff Check section / the Staff Check Variants table]. Review through that expert lens. Follow these instructions exactly:

[PASTE THE SKILL'S REVIEW CRITERIA: its "How to Review" body plus the severity anchors, finding-id system, do-not-report list, output template, and reading budget it inlines. SKIP the skill's "HTML Companion" / html-render-review content AND its "Audit Before the Report (M2)" section with the inlined hitl-loop.md - as a dispatched subagent you never render HTML and never audit.]

Review lens (do this first): Before hunting line-level issues, make a one-line design-level judgment through your expert role above - is the overall approach of this change sound? If it is NOT, that is your highest-severity finding; emit it first (as a `what` describing the design problem). Only then look for the specific issues your criteria call out. The lens shapes what you flag and its priority; it does not change the output format.

Project context:
[PASTE PROJECT CONTEXT SUMMARY HERE]

Files to review (excerpts already read for you):
[PASTE THE RELEVANT EXCERPTS OF EACH CHANGED FILE. For a file over ~400 lines, paste the changed sections plus ~50 surrounding lines and point at the path for the rest.]

Important (dispatched-subagent contract): You are a single-pass subagent. Do NOT spawn sub-agents - the Agent tool is unavailable to you, so any "run N sub-agents in parallel" instruction in the skill above is for direct invocation only and does not apply to you. Do NOT generate an HTML companion file and do NOT write a prose markdown report. Output your findings as JSONL per "Dispatched findings format" below (or the literal NO FINDINGS). The output template above still governs *what* each finding contains - the 4 fields, the skip rule, the receipt rule, severity, the quality bar in its examples - just serialize each finding as JSON, not markdown bullets. Do NOT audit your own findings: the orchestrator runs the M2 audit after dedup, and a finding audited by the agent that produced it is not audited at all. Author each finding's `receipt` (the check plus what its output must show) and stop there - running the check and rendering the resulting **Receipt** row are the orchestrator's steps. The report-level SECTIONS (Top Issues, Overall Verdict, Looks Good, Audited out, Summary, and the written Staff Check section) are the orchestrator's job, not yours - but you DO review through the expert lens above and surface a design-level finding when the approach is unsound.
```

**Dispatched findings format (JSONL).** A dispatched specialist does NOT write a prose report. It emits its findings as JSONL - one JSON object per line - or the single literal line `NO FINDINGS` if it found nothing. The orchestrator parses these, dedups them, assigns IDs, and derives both the markdown report and the HTML from this one structure: findings are authored once and formatted twice, never re-written.

Each finding object (the field names match the HTML shell's finding schema, so the HTML maps directly):

- `severity`: `"block" | "warn" | "suggest"`
- `specialist`: the specialist name, e.g. `"code"`
- `file`: `{ "relPath": "...", "absPath": "...", "line": 42 }` - `line` optional; omit `file` entirely for a finding not tied to a location
- `what`: one-line summary of the issue (plain English; trusted inline HTML like `<code>` allowed)
- `fields`: an ordered array of `{ "label": "...", "value": "..." }` rows carrying the SAME depth the markdown would. For most reviews: `Why it matters`, `Example`, `Suggested fix`. Browser findings add `Screenshot`, `Evidence`, `Expected`, `Actual`. Each `value` is full prose, not a stub - a thin Example here becomes a thin Example in the report.
- `key`: a dedup key = `relPath:line:` followed by the first few normalized (lowercased) words of `what`. Two specialists flagging the same issue at the same spot emit the same key.
- `receipt`: `{ "check": "...", "expect": "..." }` - the finding's runnable proof (M2 tier 1). `check` is one safe, read-only command (a grep, a file read, a test run) executable from the project root; `expect` is one line stating what the check's output must show for the finding to stand. Every finding has one - even a judgment finding's receipt is the file read showing the cited pattern exists as described. A finding without a `receipt` fails tier 1 by definition.

Do NOT include an `id` field - the orchestrator assigns R1, R2, ... after dedup (IDs must be sequential and gap-free across the whole run).

Example line:
```
{"severity":"warn","specialist":"code","file":{"relPath":"auth/login.ts","absPath":"/abs/auth/login.ts","line":42},"what":"Session token logged on failed login","fields":[{"label":"Why it matters","value":"Tokens in logs let anyone with log access impersonate the user."},{"label":"Example","value":"An attacker reading the support log dashboard gets every active session token from the last hour."},{"label":"Suggested fix","value":"Log only that a failed attempt occurred, never the credential payload."}],"key":"auth/login.ts:42:session-token-logged","receipt":{"check":"grep -n 'logger' auth/login.ts","expect":"the failed-login path logs the token variable at line 42"}}
```

**If a subagent fails** (error, timeout, or empty response), note it in the final report: "Note: [Specialist name] review did not complete. Run `/review [type]` to retry."

### Phase 3: Synthesize

Collect the JSONL findings from all subagents (a specialist that emitted `NO FINDINGS` contributes none). Then:

1. **Dedup mechanically** - group findings by their `key`. Findings sharing a key are the same issue: merge them into one, unioning their `specialist` values (e.g. `[code, ux]`) and their `fields` (keep the browser-only evidence fields - Screenshot, Evidence, Expected, Actual - when a browser finding merges with a code one). Keep every merged finding's `receipt`: tier 1 runs each of them, and the finding stands if at least one check passes - a corroborated finding never dies on a single badly-written check. This is a free, mechanical pass over structured data - no re-judging.
2. **Order and number** - sort by severity (Blocks first, then Warns, then Suggests) and assign a single R1, R2, R3 ... sequence across ALL deduped findings. No gaps, no duplicates. Tag each ID with its merged specialist source(s): `**R1** [code] 🚫`, `**R3** [ux, plan] ⚠️`. The audit runs next, so some IDs will exit to the Audited out log rather than the report; the sequence stays gap-free across report plus log, and audit verdict lines reference these IDs.

### Phase 4: Audit (M2)

The three-tier audit runs here, between dedup and the report: the orchestrator is M2's *runner*. M2 in `.claude/skills/shared/hitl-loop.md` (inlined under "After the Report") holds every mechanic - the tiers and what each covers, the skeptic instruction, the verdict formats, dispatch hygiene, the concurrency note, and the redispatch-on-failure rule. Do not restate them here and do not improvise a variant.

Two things are specific to this path:

- **The bytes are JSONL.** A finding's `receipt.check` is its tier 1 command and `receipt.expect` is the line the output must satisfy. A merged finding carries every source receipt and stands if at least one check passes (Phase 3). What tiers 2 and 3 receive is the original JSONL lines plus each receipt's actual output.
- **The inline path is not exempt.** When Phase 1.5 reviewed the diff inline, the orchestrator authors receipts for its own findings and runs tier 1 the same way, but tiers 2 and 3 still dispatch fresh subagents. M2's never-judge-your-own-findings rule applies here exactly as it does to dispatched specialists.

Killed findings exit to the Audited out log (never fixed); survivors proceed to Phase 5 with receipts attached.

### Phase 5: Report

1. **Derive the markdown report** from the surviving findings using the format below: each finding's `what` becomes the dash summary line, each `fields[]` row becomes a labeled sub-bullet in order, and each finding's `receipt` plus the output tier 1 captured for it fills the template's final **Receipt:** row. Killed findings render in the template's Audited out section.
2. **Derive the HTML** (when the gate fires) from the SAME findings structure - see HTML Companion below. The findings are authored once (by the specialists) and formatted twice (markdown + HTML); they are never re-written.

</procedure>

## Output Format

<output_format>

### Specialists Dispatched
```
[code] ✅ | [ux] ✅ | [plan] ⏭️ skipped (no plan file) | [deps] ✅
```

### Base Structure

The orchestrator report uses the standard 4-field finding structure (What / Why it matters / Example / Suggested fix) inlined below from the shared template. This is the single source of truth - do not duplicate it elsewhere. The `<shared_template>` tags isolate the inlined content from this file's own heading hierarchy so the template's headings do not collide with the orchestrator's structure.

The orchestrator fills this structure from the surviving JSON findings (Phases 3-4): each finding's `what` becomes the dash summary line, and its `fields[]` rows become the labeled sub-bullets in order. It does not re-author the prose - it formats what the specialists already wrote.

<shared_template>
!`cat .claude/skills/shared/output-template.md`
</shared_template>

### Orchestrator Supplement

The orchestrator adds a `[specialist]` tag right after each finding ID, indicating which specialist flagged it. If multiple specialists flagged the same file:line with the same issue, merge them and list all sources: `[code, ux]`.

The Top Issues line also carries the tag: `🚫 X Blocks: R1 [code] (file:line - one-line What)`.

**Suppress the inlined Summary block.** The shared template inside `<shared_template>` includes its own `### Summary` block. Do NOT render it. Use only the orchestrator-specific Summary below (which adds Specialists run and Deduplicated findings). Otherwise the report ends with two Summary blocks and the reader cannot tell which is authoritative.

**Merging code+browser findings.** When both the code and browser specialists flag the same issue, preserve all fields from both. Do not drop the browser-only evidence fields (Screenshot, Evidence, Expected, Actual) - they pair with the code root cause to form a unified evidence-plus-fix report. The merged finding uses the browser field order from the template, unchanged.

The tag is the only thing this section adds to a finding. Every field row - the 4 authored fields, the browser evidence fields, and the audit-time **Receipt** row - is defined by the inlined template and rendered from there:

- **R1** [code] 🚫 `file:line` - [What]
  - [field rows per the template, **Receipt** last]

- **R3** [code, browser] ⚠️ `file:line` - [Issue flagged by both code and browser specialists]
  - [browser field rows per the template, **Receipt** last]

### Overall Verdict, readability, and the security nudge (orchestrator)

The inlined template defines the **Overall Verdict** line, the **readability backstop**, and the receipt rule. Apply each across the merged run rather than per specialist. Two things are specific to this path:

- **Compute the Verdict from the audit survivors**, not from everything the specialists reported. A Block the Phase 4 audit killed does not make the run `changes-requested`; the same goes for the readability backstop's count.
- **Security escalation nudge:** if the changed files touch a genuine trust boundary - a new route/endpoint, file upload, or webhook; authentication logic; crypto; or secret handling - append one line after the report: _"Consider `/security-audit`: this change touches [X], which deserves a deeper whole-repo pass."_ Only when a trigger is genuinely present; the Security specialist also emits this when called directly.

### Audited out

Rendered exactly as the template's "Audited out" section defines it - placement, verdict labels, the `Audited out: none` line, the empty-run rule, and the never-omit rule. The orchestrator's only addition is the `[specialist]` tag on each ID, as everywhere else: `- **R7** [code] \`RECEIPT FAILED\` - [What] (check output did not show the claim)`.

### Summary (orchestrator-specific)
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
- Pass `--name review-orchestrator` to the helper
- Include the `chips` array when 2 or more specialists were dispatched; omit it for single-specialist orchestrator runs
- Use the `groups[]` array (findings grouped by specialist), preserving the order from Phase 3 synthesis. These finding objects ARE the surviving Phase 4 findings - same `severity`, `specialist`, `file`, `what`, `fields` shape - grouped by specialist with the assigned `id`. Do NOT re-derive findings from the markdown prose; map the structured findings directly.
- The Receipt field rows and the Audited out group render per the audit rows rule in the shared HTML fragment above; the orchestrator's only addition is the `[specialist]` tag carried inside each finding's `what`/`id` as everywhere else.

## After the Report (auto loop)

What happens after the report is governed by the shared auto-loop fragment (the M-rule IDs cited in this file refer to it):

!`cat .claude/skills/shared/hitl-loop.md`

Once the report (and the HTML, when the gate fired) is out, continue without waiting for a human "fix it":

1. **Non-issues are already gone** - the Phase 4 audit (M2) dropped them to the Audited out log with their verdict lines; do not re-litigate them here.
2. **Auto-fix the survivors** - subject to the intent-reversal guard (M7) and the always-ask actions (M9).
3. **Re-verify every fix** per M3 (which defines the mechanical-vs-judgment split and the "R3: FIXED" / "R3: NOT FIXED" verdict format), M5 (including its one-generation rule for newly discovered findings), and M6.
4. **Route each finding to its exit** - page only per M1; everything else lands in the digest or the log.
5. **Close the run in chat** - summarize the digest with receipts (M8): what was fixed, what the audit and the loop dropped, and any page that needs the user.
6. **Chain into `/document`** (M14) - once the loop has settled, announce the handoff in one line ("Review complete - chaining into `/document` per M14. Say \"no chaining\" to stop here.") and invoke `/document` through the Skill tool. M14 is authoritative for the conditions. **Do not chain** while a hard stop is still open: an M5 revert to the last green checkpoint, an unresolved blocker, an M11 tripwire hit, or a page still waiting on the human's answer. An M9 approval already granted does **not** block, so a cycle that edited prompt files still chains once the approvals are in. A cycle summary written over a reverted state is exactly the bookkeeping drift M8 exists to prevent. The debate stages are never chained into. To get that window, drive the two stages yourself: say "no chaining" when you approve the plan (`/execute` then runs and stops), type `/review no chaining` (the review runs and stops), run the debate, then type `/document`.

Two separate per-run opt-outs: saying "report only" on the invocation keeps the entire run report-first (M10), and saying "no chaining" runs the review and stops without invoking `/document` (M14).

<rules>
## REMEMBER: Specialists report; the loop fixes. After the report, continue per the auto loop above and chain into `/document` (M14); "report only" keeps a run report-first (M10), "no chaining" stops after this stage.
</rules>
