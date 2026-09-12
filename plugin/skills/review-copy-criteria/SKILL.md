---
name: review-copy-criteria
description: The copy review criteria, reading budget, severity anchors, finding ids, and finding contract, preloaded into the review-copy-finder agent. Not a command; the direct-run skill is /tk:review-copy.
user-invocable: false
allowed-tools:
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js)"
---

# Copy Review Criteria (preloaded)

This is the expertise of `/tk:review-copy`, loaded into the finder that reviews through the Staff Editor lens. The direct-run skill inlines the same criteria file, so there is one source (issue #167).

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/criteria-copy.md`

## Reading Budget

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/reading-budget.md`

## Severity Levels and Anchors

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/severity-anchors.md`

## Finding IDs

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-id-system.md`

## What a Finding Contains

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-contract.md`
