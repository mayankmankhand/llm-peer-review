---
name: review-commands-criteria
description: The slash command review criteria, reading budget, severity anchors, finding ids, and finding contract, preloaded into the review-commands-finder agent. Not a command; the direct-run skill is /tk:review-commands.
user-invocable: false
allowed-tools:
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js)"
---

# Slash Command Review Criteria (preloaded)

This is the expertise of `/tk:review-commands`, loaded into the finder that reviews through the Staff PM (ops) lens. The direct-run skill inlines the same criteria file, so there is one source (issue #167).

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/criteria-commands.md"`

## Reading Budget

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/reading-budget.md"`

## Severity Levels and Anchors

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/severity-anchors.md"`

**Project severity anchors** (from `.claude/toolkit/severity-anchors.md`): this project's weighting for its own review kinds. The Universal Anchors above still win. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/severity-anchors.md 2>/dev/null || true`

## Finding IDs

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-id-system.md"`

## What a Finding Contains

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-contract.md"`
