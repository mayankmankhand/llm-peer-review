# Toolkit Conventions

The conventions live in one file, [`.claude/skills/shared/conventions.md`](../.claude/skills/shared/conventions.md), which ships inside the plugin as `skills/shared/conventions.md`. This page exists so the link is discoverable from the docs folder; it holds no second copy.

Each convention is a countable unit: an id that never changes, the release it arrived in, a scope, a detector, the signal that finds a file still behind it, and the shape of the fix. After `/plugin update`, `/upgrade` reads the entries whose `Since` lies between the version the project was last audited against and the installed one, inventories the files the project owns under `.claude/` plus `CLAUDE.md`, and turns every hit into a finding with a receipt. The normal loop takes it from there: M2 audit, auto-fix, re-verify with the same detector, one sample cycle, `/document`. The one-time migration from a copy-install is the same run with the longer range.

The CHANGELOG's Upgrading section names the conventions each release adds, by id.
