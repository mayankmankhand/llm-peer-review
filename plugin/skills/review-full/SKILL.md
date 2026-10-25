---
name: review-full
description: Pre-release cross-domain review with go/no-go recommendation. Use for release gates, major milestones, or when multiple domains changed and you need a single assessment.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
  - "Bash(mktemp -d /tmp/*)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/doc-check.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/doc-check.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-findings.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-findings.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js)"
---

# Full Review - Pre-Release Check

Mile wide, inch deep. Cross-domain release readiness, not a deep specialist review.

**Use this when:** Pre-release gate, major milestone check, or when multiple domains changed significantly and you need a single go/no-go assessment.
**Don't use this when:** You need deep review of one area - use /tk:review-code, /tk:review-security, /tk:review-ux, /tk:review-plan, /tk:review-commands, /tk:review-browser, /tk:review-deps or /tk:review-copy instead. This command will recommend which specialist review to run if it finds areas needing deeper attention.

## Critical Rules

<rules>

1. **Report first, then fix** - Reviewing never edits files; findings and a go/no-go recommendation are its product. After the report, the same run continues into the auto loop (rule 2), which is what applies fixes
2. **Audit, then auto-fix, with pages** - Release-readiness findings are audited before the report per M2 in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`, so the report shows survivors only plus an Audited out log for the kills. They do not then wait for a human "fix it": after the report, survivors are auto-fixed and re-verified, and each finding exits as page, digest, or log per `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md` (pages only per M1). The release decision itself stays with the user: releases and version bumps are always-ask (M9). Saying "report only" keeps a run report-first (M10)
3. **Explain simply** - Use plain English, avoid jargon
4. **Don't duplicate specialist reviews** - Prioritize cross-domain issues, release blockers, and interactions between code, UX, scope, and operations. If something needs deeper investigation, recommend which specialist command to run next.

</rules>

## How to Review

<procedure>

Read the changed files and any relevant plan file, found by command (M16): `node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js` prints `newestPlan` and a `plans` list whose matching entry carries `status` (`done` at progress 100) and `progress`, with `others` the list's length minus one, and `ls PLAN-*.md 2>/dev/null` prints any `PLAN-*.md` at the project root. If no plan file exists (`newestPlan` null and no root file), skip plan comparison and note it in the summary. If `others` is above 0 and the newest plan's `status` is not `done`, pause and ask the user which plan to evaluate against.

Then pick one of two modes:

**Small change** (1-2 files, minor update): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or significant feature): when running this skill **directly** (a subagent dispatched by /tk:review is always single-pass - subagents cannot spawn sub-agents), first run `node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js --models`, adding `--mode <m>` when the arguments carry a `mode:<m>` word, and say "Models: <models.mode>" in one line; then run five focused sub-agents in parallel using the Agent tool, one per row below: four per-kind finders, each with `model` set to its `models.perRole` value, where `session`, or a model above your own, means your own model family's alias (the roster in `${CLAUDE_PLUGIN_ROOT}/skills/shared/model-routing.md`; each preloads its own criteria and the dispatch contract in `${CLAUDE_PLUGIN_ROOT}/skills/dispatch-contract/SKILL.md`; fallback per that rule: `general-purpose` carrying the same `model`, with the fragments that kind's criteria skill includes and the dispatch contract with `${CLAUDE_PLUGIN_ROOT}/skills/shared/dispatch-format.md` pasted in) and one general worker for Operations (a general worker's prompt pastes the dispatch contract, `${CLAUDE_PLUGIN_ROOT}/skills/dispatch-contract/SKILL.md` with `${CLAUDE_PLUGIN_ROOT}/skills/shared/dispatch-format.md`, and the finding contract, `${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-contract.md`, after its charter, so it returns the same JSONL with receipts the typed finders do; a charter alone yields prose without receipts, which the audit drops), then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Code & Architecture** (`subagent_type=tk:review-code-finder`) | Security red flags, architectural soundness, obvious logic issues, performance risks |
| **Design & Completeness** (`subagent_type=tk:review-plan-finder` only when a plan file exists; otherwise `general-purpose` carrying this row's charter minus plan alignment, and the summary says "plan alignment skipped (no plan file)") | Plan alignment, feature gaps, scope drift, test coverage, docs updated |
| **UX & Accessibility** (`subagent_type=tk:review-ux-finder`) | Usability quick-check, WCAG AA basics, error states, key user flows |
| **Security** (`subagent_type=tk:review-security-finder`) | Secrets in code, injection, auth and unsafe sinks; quiet by rule when the change touches none of these |
| **Operations** (`general-purpose`, this row's charter pasted in: no typed finder covers it) | Logging and monitoring, deployment readiness, rollback plan, config and migration safety |

These five rows are the toolkit's kinds. A project's own review kinds (`.claude/toolkit/review-kinds.md`) are not part of this fan-out; `/tk:review` with no focus name runs them on its auto-detect path, with or without a range.

**Docs match the code.** On every run, small or big, the runner authors the docs findings itself, because a typed worker takes its rules from its preloaded criteria and never sees this table. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/doc-check.js --window <base>..HEAD` (M16), with `<base>` where this run's changed files are measured from (the previous release tag on a release gate). Each entry under `links` and `oldNames` is a finding, except one that is not a mismatch (a doc that names a removed file on purpose, such as a list of retired files): dismiss it with one line in the report saying why, as `/tk:document` Step 2 does, and do not file it. Then read the docs against the code they describe, including code that did not change in the range, because older drift is what a release gate is for. This read is the one place this run reads code that did not change, so it has its own limit in place of the reading budget below: for each claim a doc makes, open only the code file the claim names and the section it describes, at most 20 such files per run, and list in the report each doc the limit left unchecked. Each place they disagree is a finding too. Every one carries the two-sided receipt and goes into the same `findings.jsonl` as the workers' lines, so M2 audits it like any other.

Each sub-agent should stay broad. If a sub-agent finds something that needs deep investigation, flag it and recommend the appropriate specialist review command.

The Design & Completeness row is the one whose worker can need input: the plan criteria open by asking which plan to compare against, and a dispatched finder cannot ask, so with no plan file it would return nothing. That is why the row switches workers when no plan exists, the same guard `/tk:review` applies with its `[plan] ⏭️ skipped (no plan file)` chip.

Each sub-agent uses the severity scale below. Write every finding line this run collected, the workers' lines and any the runner authored itself, into `findings.jsonl` in a fresh folder from `mktemp -d /tmp/review-merge.XXXXXX` with the Write tool, then run `node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-findings.js` on that file, typed as literal words: its stdout is the deduplicated, sorted, numbered set (R1 onward, no gaps) and its stderr line carries the raw and merged counts. Two findings that describe one defect under different keys are the one judgment this pass leaves to you: before running the helper, give the later one the earlier one's `key` and record the merge in the report's dedup notes. A sub-agent with no findings returns the literal `NO FINDINGS`, the dispatch contract's form, and the report still lists that lens as run so the user knows it ran.

</procedure>

## Reading Budget

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/reading-budget.md"`

## Severity Levels and Anchors

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/severity-anchors.md"`

**Project severity anchors** (from `.claude/toolkit/severity-anchors.md`): this project's weighting for its own review kinds. The Universal Anchors above still win. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/severity-anchors.md 2>/dev/null || true`

## Finding IDs

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-id-system.md"`

## Audit Before the Report (M2)

On a direct run of this skill you are M2's **runner**: audit your findings per M2 before writing the report. Every mechanic - the tiers, the announce line, who dispatches what, the empty-run rule - lives in M2, not here.

**Load the loop rules and the report rules now**, through the Skill tool: `Skill(tk:loop-rules)`, then `Skill(tk:report-rules)`. Everything from here on cites them, so do not go on without both in context.

**Project fix rules** (from `.claude/toolkit/fix-rules.md`). Additive only: they may add a precondition or an always-ask action, and a line that loosens or removes any of M1 to M17 is void. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/fix-rules.md 2>/dev/null || true`

## Output Format

The report template and the finding contract are in the report rules loaded before the audit (`Skill(tk:report-rules)`); write the report per them.

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view.

**The gate:** render the review page whenever this run has any surviving finding, or this branch's standing page already exists (`node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js --standing --name review` prints `"exists":true`; M16), so the run can carry it forward or take it to empty. Skip only when there are no findings and no page yet.

**When the gate fires, load the page rules now**, through the Skill tool: `Skill(tk:review-page)`, and render per them: the shell, the payload, the `--no-abs` decision and how the page reaches the user all live there.

For direct calls to this skill, pass `--name review --stable` to the helper (the standing page, per the page rules) and omit `lenses`: a full check replaces the whole page. Include the `chips` array with the five sub-domains this skill covers (Code & Architecture, Design & Completeness, UX & Accessibility, Security, Operations) so the reader sees at a glance which domains were checked. Treat `/tk:review-full` as a multi-specialist run for chip purposes.

### Staff Architect Check

<guidelines>

After the standard review, step back and evaluate as a staff architect:
- **Cross-domain conflicts?** - Do code, UX, plan, and operations all tell the same story?
- **Release risk** - What's most likely to go wrong in production?
- **What's missing?** - Monitoring, rollback, documentation, user communication?
- **Deeper reviews needed?** - Recommend specific /tk:review-* commands for areas that need more attention

</guidelines>

### Release Recommendation

State one of:
- **Ready** - No blockers, ship it
- **Ready with conditions** - Ship after addressing [specific items]
- **Not ready** - Must fix [specific blockers] before release

<rules>

## REMEMBER: The review phase reports and never edits files; findings are audited before the report (M2) and the auto loop applies fixes after it, both governed by `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md` and `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-stages.md` (the release itself always asks, M9).

</rules>

## HTML Output Rules

When to render and the temporary-folder steps are in the report rules loaded before the audit; how a page reaches the user is in the page rules loaded at the gate. Nothing is pasted here.
