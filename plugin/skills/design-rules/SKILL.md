---
name: design-rules
description: The design workflow rules (three-state rule, load dial, six techniques, the design-critic contract, the side-by-side judge, the loop procedure), loaded by name when /tk:explore's design step or /tk:execute's design step fires. Not a command.
user-invocable: false
allowed-tools:
  - "Bash(mktemp -d /tmp/*)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/gen-media.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/gen-media.js)"
---

# Design Rules (loaded by name)

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/design-rules.md"`
