---
name: loop-rules
description: The auto loop's rules M1 to M17 - the audit tiers, the fix and re-verify loop, the always-ask actions and the stage handoffs. Loaded by name once a review's finders have returned, before its synthesis phase, by every file that runs the loop. Not a command.
user-invocable: false
allowed-tools:
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-findings.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-findings.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/run-checks.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/run-checks.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js)"
---

# Loop Rules (loaded by name)

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md"`

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-stages.md"`
