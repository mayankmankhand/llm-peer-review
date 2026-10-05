---
name: review-copy-criteria
description: The copy review criteria, reading budget, severity anchors, finding ids, and finding contract, preloaded into the review-copy-finder agent. Not a command; the direct-run skill is /tk:review-copy.
user-invocable: false
allowed-tools:
  - "Bash(mktemp -d /tmp/*)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-findings.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-findings.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js)"
---

# Copy Review Criteria (preloaded)

This is the expertise of `/tk:review-copy`, loaded into the finder that reviews through the Staff Editor lens. The direct-run skill inlines the same criteria file, so there is one source.

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/criteria-copy.md"`

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
