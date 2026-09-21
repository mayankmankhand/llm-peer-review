---
name: review-plan-criteria
description: The plan compliance review criteria, reading budget, severity anchors, finding ids, and finding contract, preloaded into the review-plan-finder agent. Not a command; the direct-run skill is /review-plan.
user-invocable: false
---

# Plan Compliance Review Criteria (preloaded)

This is the expertise of `/review-plan`, loaded into the finder that reviews through the Staff PM (scope) lens. The direct-run skill inlines the same criteria file, so there is one source (issue #167).

!`cat .claude/skills/shared/criteria-plan.md`

## Reading Budget

!`cat .claude/skills/shared/reading-budget.md`

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

**Project severity anchors** (from `.claude/toolkit/severity-anchors.md`): this project's weighting for its own review kinds. The Universal Anchors above still win. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/severity-anchors.md 2>/dev/null || true`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## What a Finding Contains

!`cat .claude/skills/shared/finding-contract.md`
