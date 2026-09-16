---
name: review-full
description: Pre-release cross-domain review with go/no-go recommendation. Use for release gates, major milestones, or when multiple domains changed and you need a single assessment.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh *)"
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh)"
  - "Bash(mktemp -d /tmp/*)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js)"
---

# Full Review - Pre-Release Check

Mile wide, inch deep. Cross-domain release readiness, not a deep specialist review.

**Use this when:** Pre-release gate, major milestone check, or when multiple domains changed significantly and you need a single go/no-go assessment.
**Don't use this when:** You need deep review of one area - use /tk:review-code, /tk:review-commands, /tk:review-plan, /tk:review-ux, or /tk:review-browser instead. This command will recommend which specialist review to run if it finds areas needing deeper attention.

## Critical Rules

<rules>

1. **THE REVIEW PHASE REPORTS ONLY** - Reviewing never edits files; findings and a go/no-go recommendation are its product. After the report, the same run continues into the auto loop (rule 2), which is what applies fixes
2. **Audit, then auto-fix, with pages** - Release-readiness findings are audited before the report per M2 in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`, so the report shows survivors only plus an Audited out log for the kills. They do not then wait for a human "fix it": after the report, survivors are auto-fixed and re-verified, and each finding exits as page, digest, or log per `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md` (pages only per M1). The release decision itself stays with the user: releases and version bumps are always-ask (M9). Saying "report only" keeps a run report-first (M10)
3. **Explain simply** - Use plain English, avoid jargon
4. **Don't duplicate specialist reviews** - Prioritize cross-domain issues, release blockers, and interactions between code, UX, scope, and operations. If something needs deeper investigation, recommend which specialist command to run next.

</rules>

## How to Review

<procedure>

Read the changed files and any relevant plan file. Auto-detect the most recently modified `PLAN-*.md` in `plans/` (also check the project root for legacy plan files). If no plan file exists, skip plan comparison and note it in the summary. If multiple plan files exist and the most recent one is not clearly complete (all tasks checked off), pause and ask the user which plan to evaluate against.

Then pick one of two modes:

**Small change** (1-2 files, minor update): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or significant feature): when running this skill **directly** (a subagent dispatched by /tk:review is always single-pass - subagents cannot spawn sub-agents), run five focused sub-agents in parallel using the Agent tool, one per row below: four per-kind finders (the roster in `${CLAUDE_PLUGIN_ROOT}/skills/shared/model-routing.md`; each preloads its own criteria and the dispatch contract in `${CLAUDE_PLUGIN_ROOT}/skills/dispatch-contract/SKILL.md`; fallback per that rule: `general-purpose` carrying what the row declares plus that kind's criteria fragment pasted in) and one general worker for Operations (a general worker's prompt pastes the dispatch contract, `${CLAUDE_PLUGIN_ROOT}/skills/dispatch-contract/SKILL.md` with `${CLAUDE_PLUGIN_ROOT}/skills/shared/dispatch-format.md`, and the finding contract, `${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-contract.md`, after its charter, so it returns the same JSONL with receipts the typed finders do; a charter alone yields prose without receipts, which the audit drops), then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Code & Architecture** (`subagent_type=tk:review-code-finder`) | Security red flags, architectural soundness, obvious logic issues, performance risks |
| **Design & Completeness** (`subagent_type=tk:review-plan-finder` only when a plan file exists; otherwise `general-purpose` carrying this row's charter minus plan alignment, and the summary says "plan alignment skipped (no plan file)") | Plan alignment, feature gaps, scope drift, test coverage, docs updated |
| **UX & Accessibility** (`subagent_type=tk:review-ux-finder`) | Usability quick-check, WCAG AA basics, error states, key user flows |
| **Security** (`subagent_type=tk:review-security-finder`) | Secrets in code, injection, auth and unsafe sinks; quiet by rule when the change touches none of these |
| **Operations** (`general-purpose`, this row's charter pasted in: no typed finder has covered it since 7.0.0) | Logging and monitoring, deployment readiness, rollback plan, config and migration safety |

Each sub-agent should stay broad. If a sub-agent finds something that needs deep investigation, flag it and recommend the appropriate specialist review command.

The Design & Completeness row is the one whose worker can need input: the plan criteria open by asking which plan to compare against, and a dispatched finder cannot ask, so with no plan file it returned nothing at all (issue #184). That is why the row switches workers when no plan exists, the same guard `/tk:review` applies with its `[plan] ⏭️ skipped (no plan file)` chip.

Each sub-agent uses the severity scale below; the runner assigns Finding IDs after dedup. A sub-agent with no findings returns the literal `NO FINDINGS`, the dispatch contract's form, and the report still lists that lens as run so the user knows it ran.

</procedure>

## Reading Budget

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/reading-budget.md"`

## Severity Levels and Anchors

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/severity-anchors.md"`

## Finding IDs

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-id-system.md"`

## Audit Before the Report (M2)

On a direct run of this skill you are M2's **runner**: audit your findings per M2 below before writing the report. Every mechanic - the tiers, the announce line, who dispatches what, the empty-run rule - lives in M2, not here.

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md"`

## Output Format

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/report-format.md"`

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-contract.md"`

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template:

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/html-render-review.md"`

For direct calls to this skill, pass `--name review --stable` to the helper (the standing page, per the fragment above) and omit `lenses`: a full check replaces the whole page. Include the `chips` array with the five sub-domains this skill covers (Code & Architecture, Design & Completeness, UX & Accessibility, Security, Operations) so the reader sees at a glance which domains were checked. Treat `/tk:review-full` as a multi-specialist run for chip purposes.

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

## REMEMBER: The review phase reports and never edits files; findings are audited before the report (M2) and the auto loop applies fixes after it, both governed by `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md` (the release itself always asks, M9).

</rules>

## HTML Output Rules

Every HTML decision above (whether to render, `--no-abs`, publish or open locally, record the publish) is governed by the shared rules fragment, inlined here so it is in context when the render runs. It was an always-on rules file until v7.0.0 (issue #167); now it loads with the commands that need it.

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md"`
