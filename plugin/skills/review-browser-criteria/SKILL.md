---
name: review-browser-criteria
description: The browser qa review criteria, reading budget, severity anchors, finding ids, and finding contract, preloaded into the review-browser-finder agent. Not a command; the direct-run skill is /tk:review-browser.
user-invocable: false
allowed-tools:
  - "Bash(cat * | node ${CLAUDE_PLUGIN_ROOT}/scripts/browse.js *)"
  - "Bash(echo * | node ${CLAUDE_PLUGIN_ROOT}/scripts/browse.js *)"
  - "Bash(mktemp -d /tmp/*)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/browse.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/browse.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js)"
---

# Browser QA Review Criteria (preloaded)

This is the expertise of `/tk:review-browser`, loaded into the finder that reviews through the Staff QA lens. The direct-run skill inlines the same criteria file, so there is one source (issue #167).

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/criteria-browser.md"`

## Reading Budget

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/reading-budget.md"`

## Severity Levels and Anchors

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/severity-anchors.md"`

## Finding IDs

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-id-system.md"`

## Browse Script API

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/browse-api.md"`

## What a Finding Contains

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-contract.md"`
