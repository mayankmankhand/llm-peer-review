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

### Phase 2: Dispatch

For each selected specialist:

1. Read the specialist's SKILL.md file (subagents cannot discover skills on their own - you must read the file and pass its content)
2. Also read `.claude/skills/project-context/SKILL.md` and follow its instructions to gather project context
3. Spawn a subagent using the Agent tool. Pass the skill's full content as the subagent's prompt, along with the project context summary. Tell the subagent what files to review.

**Concurrency:** Dispatch up to 4 subagents in parallel. If more than 4 specialists are relevant, run the first 4 in parallel, wait for results, then run the remainder. Browser QA is always sequential (it drives a browser), so it runs last if included.

**Subagent prompt template:**
```
You are a specialist reviewer. Follow these instructions exactly:

[PASTE FULL SKILL.MD CONTENT HERE]

Project context:
[PASTE PROJECT CONTEXT SUMMARY HERE]

Files to review:
[LIST CHANGED FILES RELEVANT TO THIS SPECIALIST]

Important: Do NOT generate an HTML companion file. The orchestrator produces a single combined HTML for the whole run after synthesizing your findings. Only output the markdown report; skip the HTML Companion section entirely.
```

**If a subagent fails** (error, timeout, or empty response), note it in the final report: "Note: [Specialist name] review did not complete. Run `/review [type]` to retry."

### Phase 3: Synthesize

Collect all findings from all subagents. Then:

1. **Renumber** - Assign a single R1, R2, R3 sequence across all specialists. Order by severity (Blocks first, then Warns, then Suggests).
2. **Deduplicate** - If two specialists flagged the same file:line with the same issue, merge them into one finding and note which specialists agreed.
3. **Tag source** - After each finding ID, note which specialist it came from: e.g., `**R1** [code] 🚫` or `**R3** [ux, plan] ⚠️`
4. **Present one combined report** using the format below.

</procedure>

## Output Format

<output_format>

### Specialists Dispatched
```
[code] ✅ | [ux] ✅ | [plan] ⏭️ skipped (no plan file) | [deps] ✅
```

### Base Structure

The orchestrator report uses the standard 4-field finding structure (What / Why it matters / Example / Suggested fix) inlined below from the shared template. This is the single source of truth - do not duplicate it elsewhere. The `<shared_template>` tags isolate the inlined content from this file's own heading hierarchy so the template's headings do not collide with the orchestrator's structure.

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

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template:

!`cat .claude/skills/shared/html-render-review.md`

Design tokens for the HTML output (typography, color palette, severity hex values):

!`cat .claude/skills/shared/html-look.md`

For orchestrator output specifically:
- Use `<type>` = `orchestrator` in the HTML filename
- Render the Specialist Chips header when 2 or more specialists were dispatched; skip the chips for single-specialist orchestrator runs
- Group finding cards by specialist tag, preserving the order from Phase 3 synthesis

<rules>
## REMEMBER: Report issues only. Do NOT edit any files until I approve.
</rules>
