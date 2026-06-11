# Unified Review

Run the right reviews automatically, combine findings into one report.

**Use this when:** You want a single command to review your changes. It detects what changed and dispatches the right specialists.
**Don't use this when:** You want a pre-release gate (use `/review-full`). Or you know exactly which review you need (use `/review-code`, `/review-ux`, etc. directly).

**The difference:** `/review` checks what you just changed. `/review-full` checks if the whole thing is ready to ship.

## Critical Rules

<rules>

1. **REPORT ONLY** - Do NOT make any changes or edits to files
2. **Wait for approval** - Only fix things after I say "fix it"
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

If focus arguments are provided, skip the detection phase and dispatch only the specified specialists. The arguments map to skill names: `code` = review-code, `ux` = review-ux, `plan` = review-plan, `commands` = review-commands, `browser` = review-browser, `deps` = review-deps, `copy` = review-copy, `full` = review-full.

</reference>

## How It Works

<procedure>

### Phase 1: Detect (skip if focus arguments provided)

Run `git diff --name-only` (staged + unstaged) and `git diff --name-only --cached` to see all changed files. Also check for untracked files with `git status --short`.

Categorize the changes and pick relevant specialists:

| What changed | Specialist | Skill file |
|---|---|---|
| `.ts`, `.js`, `.py`, `.go`, `.rs`, `.java`, `.sh` files | Code Quality | `.claude/skills/review-code/SKILL.md` |
| `.tsx`, `.jsx`, `.vue`, `.svelte`, `.css`, `.scss`, `.html` files | UX Quality | `.claude/skills/review-ux/SKILL.md` |
| Active `PLAN-*.md` exists in `plans/` | Plan Compliance | `.claude/skills/review-plan/SKILL.md` |
| `.claude/commands/` or `.claude/skills/` files changed | Command Quality | `.claude/skills/review-commands/SKILL.md` |
| `package.json` or lockfile changed | Dependency Security | `.claude/skills/review-deps/SKILL.md` |
| Visual/UI changes AND a dev server is running | Browser QA | `.claude/skills/review-browser/SKILL.md` |
| `README.md`, `index.html`, or files in `docs/`, `pages/`, `content/`, `posts/` (exclude `CHANGELOG.md`, ADRs, API refs, generated docs) | Copy Clarity | `.claude/skills/review-copy/SKILL.md` |

**Rules:**
- A file can trigger multiple specialists (e.g., a `.tsx` file triggers both Code and UX)
- When copy and UX both run on the same artifact, copy focuses on meaning/orientation while UX focuses on usability/accessibility. Deduplicate overlapping findings in synthesis.
- If no changes are detected (clean working tree), tell the user: "No changes detected. Use `/review code` to force a specific review."
- For browser-qa, check if a server is reachable on common ports (3000, 3001, 5173, 8080) before dispatching

### Phase 1.5: Size gate (skip the fan-out for tiny diffs)

This gate applies only to the auto-detect path. (Explicit focus calls like `/review code` and `/review full` skip detection entirely, so they never reach this gate - the specialist you named always runs, regardless of size.)

Count the changed lines: run `git diff --numstat` (staged + unstaged) and sum the added + removed columns across all changed files. **If the total is under 50 changed lines AND none of the selected specialists is a never-gate one, skip Phase 2 and review the diff inline** in a single pass: you (the orchestrator) read the changed files and produce the report yourself, using the same severity anchors, finding IDs, and output format the specialists would use, covering whichever domains the file-type table flagged.

**Never-gate specialist:** Dependency Security (selected when a `package.json`/lockfile changed). Its presence disables the size gate for the whole run - diff size is not a proxy for CVE risk.

The inline path still obeys the report-only rule and the HTML gate; it simply has no subagents to dispatch.

### Phase 2: Dispatch

For each selected specialist:

1. Read the specialist's SKILL.md for its **review criteria** (subagents cannot discover skills on their own). Resolve the shared review blocks it inlines once - severity anchors, finding-id system, output template, and reading budget - but NOT `html-render-review.md`: rendering HTML is the orchestrator's job, so a dispatched specialist never needs it.
2. Also read `.claude/skills/project-context/SKILL.md` and follow its instructions to gather project context
3. Read the changed files once, here, so each subagent receives the relevant excerpts instead of re-opening every file (paste-don't-read)
4. Spawn a subagent using the Agent tool with the prompt template below: the skill's review criteria, the project context summary, and the pre-read file excerpts

**Concurrency:** Dispatch up to 4 subagents in parallel. If more than 4 specialists are relevant, run the first 4 in parallel, wait for results, then run the remainder. Browser QA is always sequential (it drives a browser), so it runs last if included.

**Subagent prompt template:**
```
You are a specialist reviewer. Follow these instructions exactly:

[PASTE THE SKILL'S REVIEW CRITERIA: its "How to Review" body plus the severity anchors, finding-id system, output template, and reading budget it inlines. SKIP the skill's "HTML Companion" / html-render-review content - as a dispatched subagent you never render HTML.]

Project context:
[PASTE PROJECT CONTEXT SUMMARY HERE]

Files to review (excerpts already read for you):
[PASTE THE RELEVANT EXCERPTS OF EACH CHANGED FILE. For a file over ~400 lines, paste the changed sections plus ~50 surrounding lines and point at the path for the rest.]

Important (dispatched-subagent contract): You are a single-pass subagent. Do NOT spawn sub-agents - the Agent tool is unavailable to you, so any "run N sub-agents in parallel" instruction in the skill above is for direct invocation only and does not apply to you. Do NOT generate an HTML companion file and do NOT write a prose markdown report. Output your findings as JSONL per "Dispatched findings format" below (or the literal NO FINDINGS). The output template above still governs *what* each finding contains - the 4 fields, the skip rule, severity, the quality bar in its examples - just serialize each finding as JSON, not markdown bullets. The report-level sections (Top Issues, Looks Good, Summary, Staff Check) are the orchestrator's job, not yours.
```

**Dispatched findings format (JSONL).** A dispatched specialist does NOT write a prose report. It emits its findings as JSONL - one JSON object per line - or the single literal line `NO FINDINGS` if it found nothing. The orchestrator parses these, dedups them, assigns IDs, and derives both the markdown report and the HTML from this one structure: findings are authored once and formatted twice, never re-written.

Each finding object (the field names match the HTML shell's finding schema, so the HTML maps directly):

- `severity`: `"block" | "warn" | "suggest"`
- `specialist`: the specialist name, e.g. `"code"`
- `file`: `{ "relPath": "...", "absPath": "...", "line": 42 }` - `line` optional; omit `file` entirely for a finding not tied to a location
- `what`: one-line summary of the issue (plain English; trusted inline HTML like `<code>` allowed)
- `fields`: an ordered array of `{ "label": "...", "value": "..." }` rows carrying the SAME depth the markdown would. For most reviews: `Why it matters`, `Example`, `Suggested fix`. Browser findings add `Screenshot`, `Evidence`, `Expected`, `Actual`. Each `value` is full prose, not a stub - a thin Example here becomes a thin Example in the report.
- `key`: a dedup key = `relPath:line:` followed by the first few normalized (lowercased) words of `what`. Two specialists flagging the same issue at the same spot emit the same key.

Do NOT include an `id` field - the orchestrator assigns R1, R2, ... after dedup (IDs must be sequential and gap-free across the whole run).

Example line:
```
{"severity":"warn","specialist":"code","file":{"relPath":"auth/login.ts","absPath":"/abs/auth/login.ts","line":42},"what":"Session token logged on failed login","fields":[{"label":"Why it matters","value":"Tokens in logs let anyone with log access impersonate the user."},{"label":"Example","value":"An attacker reading the support log dashboard gets every active session token from the last hour."},{"label":"Suggested fix","value":"Log only that a failed attempt occurred, never the credential payload."}],"key":"auth/login.ts:42:session-token-logged"}
```

**If a subagent fails** (error, timeout, or empty response), note it in the final report: "Note: [Specialist name] review did not complete. Run `/review [type]` to retry."

### Phase 3: Synthesize

Collect the JSONL findings from all subagents (a specialist that emitted `NO FINDINGS` contributes none). Then:

1. **Dedup mechanically** - group findings by their `key`. Findings sharing a key are the same issue: merge them into one, unioning their `specialist` values (e.g. `[code, ux]`) and their `fields` (keep the browser-only evidence fields - Screenshot, Evidence, Expected, Actual - when a browser finding merges with a code one). This is a free, mechanical pass over structured data - no re-judging.
2. **Order and number** - sort by severity (Blocks first, then Warns, then Suggests) and assign a single R1, R2, R3 ... sequence. No gaps, no duplicates. Tag each ID with its merged specialist source(s): `**R1** [code] 🚫`, `**R3** [ux, plan] ⚠️`.
3. **Derive the markdown report** from the deduped findings using the format below: each finding's `what` becomes the dash summary line and each `fields[]` row becomes a labeled sub-bullet, in order.
4. **Derive the HTML** (when the gate fires) from the SAME findings structure - see HTML Companion below. The findings are authored once (by the specialists) and formatted twice (markdown + HTML); they are never re-written.

</procedure>

## Output Format

<output_format>

### Specialists Dispatched
```
[code] ✅ | [ux] ✅ | [plan] ⏭️ skipped (no plan file) | [deps] ✅
```

### Base Structure

The orchestrator report uses the standard 4-field finding structure (What / Why it matters / Example / Suggested fix) inlined below from the shared template. This is the single source of truth - do not duplicate it elsewhere. The `<shared_template>` tags isolate the inlined content from this file's own heading hierarchy so the template's headings do not collide with the orchestrator's structure.

The orchestrator fills this structure from the deduped JSON findings (Phase 3): each finding's `what` becomes the dash summary line, and its `fields[]` rows become the labeled sub-bullets in order. It does not re-author the prose - it formats what the specialists already wrote.

<shared_template>
!`cat .claude/skills/shared/output-template.md`
</shared_template>

### Orchestrator Supplement

The orchestrator adds a `[specialist]` tag right after each finding ID, indicating which specialist flagged it. If multiple specialists flagged the same file:line with the same issue, merge them and list all sources: `[code, ux]`.

The Top Issues line also carries the tag: `🚫 X Blocks: R1 [code] (file:line - one-line What)`.

**Suppress the inlined Summary block.** The shared template inside `<shared_template>` includes its own `### Summary` block. Do NOT render it. Use only the orchestrator-specific Summary below (which adds Specialists run and Deduplicated findings). Otherwise the report ends with two Summary blocks and the reader cannot tell which is authoritative.

**Merging code+browser findings.** When both the code and browser specialists flag the same issue, preserve all fields from both. Do not drop the browser-only evidence fields (Screenshot, Evidence, Expected, Actual) - they pair with the code root cause to form a unified evidence-plus-fix report. Use this field order in the merged finding:

`What -> Why it matters -> Example -> Screenshot -> Evidence -> Expected -> Actual -> Suggested fix`

Example findings with tags applied:

- **R1** [code] 🚫 `file:line` - [What: the issue in plain English]
  - **Why it matters:** [The harm or risk this creates]
  - **Example:** [Real-world impact]
  - **Suggested fix:** [The approach]

- **R3** [code, browser] ⚠️ `file:line` - [Issue flagged by both code and browser specialists]
  - **Why it matters:** [The harm or risk this creates]
  - **Example:** [Real-world impact]
  - **Screenshot:** [Path]
  - **Evidence:** [Console errors, failed API calls, or text output]
  - **Expected:** [What should happen]
  - **Actual:** [What actually happens]
  - **Suggested fix:** [The approach]

### Summary (orchestrator-specific)
- Specialists run: X of Y
- Files reviewed: X
- Blocks: X | Warns: X | Suggests: X
- Deduplicated findings: X (Y raw findings from specialists)

</output_format>

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template (it covers the gate and the data-injection steps):

!`cat .claude/skills/shared/html-render-review.md`

For orchestrator output specifically:
- Pass `--name review-orchestrator` to the helper
- Include the `chips` array when 2 or more specialists were dispatched; omit it for single-specialist orchestrator runs
- Use the `groups[]` array (findings grouped by specialist), preserving the order from Phase 3 synthesis. These finding objects ARE the deduped Phase 3 findings - same `severity`, `specialist`, `file`, `what`, `fields` shape - grouped by specialist with the assigned `id`. Do NOT re-derive findings from the markdown prose; map the structured findings directly.

<rules>
## REMEMBER: Report issues only. Do NOT edit any files until I approve.
</rules>
