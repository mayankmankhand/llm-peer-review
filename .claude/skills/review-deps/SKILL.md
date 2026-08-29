---
name: review-deps
description: Dependency and supply chain security review. Checks for known CVEs, outdated packages, single-maintainer risks, and license issues.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - Agent
---

# Dependency Review

Be thorough but concise.

**Use this when:** Auditing project dependencies for security vulnerabilities, outdated packages, supply chain risks, or license compliance.
**Don't use this when:** Reviewing code logic (/review-code), testing a running app (/review-browser), or doing a pre-release check (/review-full).

## Critical Rules

<rules>

1. **THE REVIEW PHASE REPORTS ONLY** - Reviewing never edits files or touches `package.json`; findings are its product. After the report, the same run continues into the auto loop (rule 2), which is what may apply a dependency fix
2. **Audit, then auto-fix, with pages** - Dependency findings are audited before the report per M2 in `.claude/skills/shared/hitl-loop.md`, so the report shows survivors only plus an Audited out log for the kills. They do not then wait for a human "fix it": after the report, survivors are auto-fixed (e.g. a version bump re-checked with `npm audit`) and re-verified, and each finding exits as page, digest, or log per `.claude/skills/shared/hitl-loop.md` (pages only per M1; saying "report only" keeps a run report-first, M10)
3. **Explain simply** - Use plain English, avoid jargon

</rules>

## How to Review

<procedure>

1. **Run `npm audit --json`** and categorize findings by severity (critical, high, moderate, low). If the project has no lockfile, note that as a finding - audits require one.

2. **Run `npm outdated --json`** and flag packages where the installed version is more than one major version behind, or where the latest version includes security fixes.

3. **Check maintainer activity** for any dependency with high or critical vulnerabilities. Use `gh api` to check (this stays `gh` on every host, including GitLab projects - it queries the GitHub repos of the npm dependencies themselves, not the host this project is on, so it is deliberate and not a `glab` port that was missed):
   - Last commit date (stale if no commits in 12+ months)
   - Number of contributors (single-maintainer risk if fewer than 3)
   - Star count (low adoption signal if under 100 stars)
   - Open issues vs. closed issues ratio

4. **Review license types** in package.json dependencies. Flag:
   - Copyleft licenses (GPL, AGPL) in a project that expects permissive licensing
   - Missing license fields
   - `UNLICENSED` packages

5. **Compile findings** using the standard severity and output format below. Group findings by category: Vulnerabilities, Outdated Packages, Supply Chain Risks, License Issues.

</procedure>

## Reading Budget

!`cat .claude/skills/shared/reading-budget.md`

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Audit Before the Report (M2)

You are M2's **runner**: audit your own findings before writing the report, then report survivors only, with an Audited out log for the kills. Run every receipt yourself, and dispatch the skeptic tiers to fresh subagents rather than judging your own findings.

Do not improvise a lighter version. A direct run is a deliberate focused check, not a cheaper one, and the Audited out section in the format below is only honest if an audit actually ran. M2 is inlined here rather than cited by path because a pointer to a procedure you cannot read is not an instruction.

!`cat .claude/skills/shared/hitl-loop.md`

## Output Format

!`cat .claude/skills/shared/output-template.md`

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template:

!`cat .claude/skills/shared/html-render-review.md`

For direct calls to this skill, pass `--name review-deps` to the helper and omit the `chips` array (single-specialist context).

### Security Engineer Check

<guidelines>

After the standard review, step back and evaluate as a staff security engineer:
- **Known vulnerabilities?** - Are there any CVEs that could be exploited in this project's context?
- **Supply chain risk?** - Any dependencies that are unmaintained, single-maintainer, or recently transferred ownership?
- **License compliance?** - Do all dependency licenses match the project's licensing expectations?
- **Update urgency?** - Which updates are "do it now" vs. "plan for next sprint"?

</guidelines>

<rules>

## REMEMBER: The review phase reports and never edits files; findings are audited before the report (M2) and the auto loop applies fixes after it, both governed by `.claude/skills/shared/hitl-loop.md`.

</rules>
