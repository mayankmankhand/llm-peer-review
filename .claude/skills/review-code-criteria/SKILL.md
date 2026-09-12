---
name: review-code-criteria
description: The code review criteria, reading budget, severity anchors, finding ids, and finding contract, preloaded into the review-code-finder agent. Not a command; the direct-run skill is /review-code.
user-invocable: false
---

# Code Review Criteria (preloaded)

This is the expertise of `/review-code`, loaded into the finder that reviews through the Staff Engineer lens. The direct-run skill inlines the same criteria file, so there is one source (issue #167).

!`cat .claude/skills/shared/criteria-code.md`

## Reading Budget

!`cat .claude/skills/shared/reading-budget.md`

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## What a Finding Contains

!`cat .claude/skills/shared/finding-contract.md`
