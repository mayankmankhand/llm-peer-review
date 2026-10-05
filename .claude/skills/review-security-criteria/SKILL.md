---
name: review-security-criteria
description: The security review criteria, reading budget, severity anchors, finding ids, and finding contract, preloaded into the review-security-finder agent. Not a command; the direct-run skill is /review-security.
user-invocable: false
---

# Security Review Criteria (preloaded)

This is the expertise of `/review-security`, loaded into the finder that reviews through the Staff Security Engineer lens. The direct-run skill inlines the same criteria file, so there is one source.

!`cat .claude/skills/shared/criteria-security.md`

## Reading Budget

!`cat .claude/skills/shared/reading-budget.md`

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

**Project severity anchors** (from `.claude/toolkit/severity-anchors.md`): this project's weighting for its own review kinds. The Universal Anchors above still win. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/severity-anchors.md 2>/dev/null || true`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Noise Control

!`cat .claude/skills/shared/do-not-report.md`

The project's own entries, from `.claude/toolkit/do-not-report.md`, in the same format and under the same rules (an entry suppresses a category and never lowers a real severity). A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/do-not-report.md 2>/dev/null || true`

## What a Finding Contains

!`cat .claude/skills/shared/finding-contract.md`
