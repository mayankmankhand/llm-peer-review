---
name: html-viewing
description: How a rendered toolkit page reaches the user - the --no-abs render, the private hosted page and its record, and the local browser open. Loaded by name right before a render, by a command whose page is optional. Not a command.
user-invocable: false
allowed-tools:
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh *)"
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js)"
---

# HTML Viewing Rules (loaded by name)

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/html-viewing.md"`
