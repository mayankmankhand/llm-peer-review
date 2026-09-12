---
name: review-security
description: Application security review of a code change - the diff-catchable vulnerability classes (secrets, injection, XSS, path traversal, SSRF, unsafe deserialization, weak crypto) reviewed through an adversarial lens. Use when code changed and you want a security pass; runs automatically inside /review on any code change. For dependency CVEs use /review-deps; for a deep whole-repo audit use /security-audit.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
---

# Security Review

Be thorough but concise. Read the change like an attacker, not like an author.

**Use this when:** Reviewing a code change for application-level security flaws - the kind a diff can actually reveal. Runs automatically inside `/review` whenever code changes, and can be called directly as `/review-security`.
**Don't use this when:** Auditing dependency versions or CVEs (use `/review-deps`), doing a deep whole-repo security pass (use `/security-audit`), or reviewing non-security code quality (use `/review-code`).

**How it differs from `/review-code`:** same code, attacker's eyes. `/review-code` asks "is this written well?"; this skill asks "what can a malicious user make this do?" That adversarial lens surfaces a class of bug a correctness review walks straight past.

## Critical Rules

<rules>

1. **THE REVIEW PHASE REPORTS ONLY** - Reviewing never edits files; findings with exploit receipts are its product. After the report, the same run continues into the auto loop (rule 2), which is what applies fixes
2. **Audit, then auto-fix, with pages** - Security findings are audited before the report per M2 in `.claude/skills/shared/hitl-loop.md`, so the report shows survivors only plus an Audited out log for the kills. They do not then wait for a human "fix it": after the report, survivors are auto-fixed and re-verified, and each finding exits as page, digest, or log per `.claude/skills/shared/hitl-loop.md` (pages only per M1; saying "report only" keeps a run report-first, M10)
3. **Explain simply** - Use plain English, avoid jargon
4. **Stay silent when there is nothing to find** - a security reviewer that cries wolf gets muted. See the gate below.

</rules>

!`cat .claude/skills/shared/criteria-security.md`

## Reading Budget

!`cat .claude/skills/shared/reading-budget.md`

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Noise Control

!`cat .claude/skills/shared/do-not-report.md`

## Audit Before the Report (M2)

On a direct run of this skill you are M2's **runner**: audit your findings per M2 below before writing the report. Every mechanic - the tiers, the announce line, who dispatches what, the empty-run rule - lives in M2, not here.

!`cat .claude/skills/shared/hitl-loop.md`

## Output Format

!`cat .claude/skills/shared/report-format.md`

!`cat .claude/skills/shared/finding-contract.md`

Security findings use that shape unchanged: the exploit sentence above is sentence two, answering when it fires (who is hit belongs in the receipt's demonstrated path, never in a third sentence), or it is the receipt itself when the path can be demonstrated rather than described.

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template:

!`cat .claude/skills/shared/html-render-review.md`

For direct calls to this skill, pass `--name review --stable` to the helper (the standing page, per the fragment above), set `lenses` to `["security"]` so the renderer replaces only this lens's findings and carries the other lenses' open findings forward, and omit the `chips` array (single-specialist context).

### Security Engineer Check

<guidelines>

After the standard review, step back and evaluate as a staff security engineer:
- **Attacker's eyes?** - For each new danger spot, what is the worst a malicious user could do, and did the review trace it source-to-sink?
- **New attack surface?** - What did this diff newly expose (a route, an input, a sink) that was not reachable before?
- **Trust boundary crossed?** - Does anything here warrant the deeper `/security-audit`, and did I say so?
- **Crying wolf?** - Is every finding backed by a concrete exploit sentence, or did a pattern match sneak in unproven?

</guidelines>

<rules>

## REMEMBER: The review phase reports and never edits files; findings are audited before the report (M2) and the auto loop applies fixes after it, both governed by `.claude/skills/shared/hitl-loop.md`.

</rules>

## HTML Output Rules

Every HTML decision above (whether to render, `--no-abs`, publish or open locally, record the publish) is governed by the shared rules fragment, inlined here so it is in context when the render runs. It was an always-on rules file until v7.0.0 (issue #167); now it loads with the commands that need it.

!`cat .claude/skills/shared/html-outputs.md`
