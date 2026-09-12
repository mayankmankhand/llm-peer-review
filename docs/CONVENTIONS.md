# Toolkit Conventions

The conventions live in one file, [`.claude/skills/shared/conventions.md`](../.claude/skills/shared/conventions.md), which ships inside the plugin as `skills/shared/conventions.md`. This page exists so the link is discoverable from the docs folder; it holds no second copy.

A convention is one rule about how your own files should refer to the toolkit, for example "dispatch the review finder for the kind by its scoped name" or "do not keep permission rows for scripts the plugin removed". Each one records the release that introduced it, a check that finds a file still following the old way, and what the fix looks like.

After you update the plugin, run `/tk:upgrade` in the project. It checks your commands, skills, agents, and rules under `.claude/`, plus `CLAUDE.md`, against every convention added since the version the project was last checked against. Each file still behind one becomes a review finding with the check's output attached. Those findings are double-checked by a second agent, fixed automatically, and checked again with the same test, and the run stops to ask you once before it edits any prompt file. Toolkit files themselves are never touched, because they live in the plugin. Moving a copy-install to the plugin runs the same audit over every convention since the version you came from.

The CHANGELOG's Upgrading section names the conventions each release adds, by id.
