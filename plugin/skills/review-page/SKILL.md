---
name: review-page
description: How the standing review page is rendered and how it reaches the user. Loaded by name only when a review's HTML gate fires, right before the render. Not a command.
user-invocable: false
allowed-tools:
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh *)"
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh)"
  - "Bash(mktemp -d /tmp/*)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js)"
---

# Review Page Rules (loaded by name)

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/html-render-review.md"`

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/html-viewing.md"`
