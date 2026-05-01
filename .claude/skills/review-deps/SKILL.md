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

1. **REPORT ONLY** - Do NOT make any changes or edits to files
2. **Wait for approval** - Only fix things after I say "fix it"
3. **Explain simply** - Use plain English, avoid jargon

</rules>

## How to Review

<procedure>

1. **Run `npm audit --json`** and categorize findings by severity (critical, high, moderate, low). If the project has no lockfile, note that as a finding - audits require one.

2. **Run `npm outdated --json`** and flag packages where the installed version is more than one major version behind, or where the latest version includes security fixes.

3. **Check maintainer activity** for any dependency with high or critical vulnerabilities. Use `gh api` to check:
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

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Output Format

!`cat .claude/skills/shared/output-template.md`

### Security Engineer Check

<guidelines>

After the standard review, step back and evaluate as a staff security engineer:
- **Known vulnerabilities?** - Are there any CVEs that could be exploited in this project's context?
- **Supply chain risk?** - Any dependencies that are unmaintained, single-maintainer, or recently transferred ownership?
- **License compliance?** - Do all dependency licenses match the project's licensing expectations?
- **Update urgency?** - Which updates are "do it now" vs. "plan for next sprint"?

</guidelines>

<rules>

## REMEMBER: Report issues only. Do NOT edit any files until I approve.

</rules>
