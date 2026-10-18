---
name: report-rules
description: The review report template, the finding contract and the HTML output rules with their temporary-folder steps. Loaded by name together with loop-rules, once a review's finders have returned and before its synthesis phase writes receipts or a report. Not a command.
user-invocable: false
allowed-tools:
  - "Bash(mktemp -d /tmp/*)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/run-checks.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/run-checks.js)"
---

# Report Rules (loaded by name)

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/report-format.md"`

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-contract.md"`

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md"`
