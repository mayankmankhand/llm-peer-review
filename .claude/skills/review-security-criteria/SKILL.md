---
name: review-security-criteria
description: The security review criteria, reading budget, severity anchors, finding ids, and finding contract, preloaded into the review-security-finder agent. Not a command; the direct-run skill is /review-security.
user-invocable: false
---

# Security Review Criteria (preloaded)

This is the expertise of `/review-security`, loaded into the finder that reviews through the Staff Security Engineer lens. The direct-run skill inlines the same criteria file, so there is one source (issue #167).

!`cat .claude/skills/shared/criteria-security.md`

## Reading Budget

!`cat .claude/skills/shared/reading-budget.md`

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Noise Control

!`cat .claude/skills/shared/do-not-report.md`

## What a Finding Contains

!`cat .claude/skills/shared/finding-contract.md`
