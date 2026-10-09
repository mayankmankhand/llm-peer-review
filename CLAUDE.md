# Project Instructions for Claude

<!-- This file is YOURS. Add your project-specific info below. -->
<!-- Toolkit rules live in .claude/rules/toolkit.md (managed by the toolkit, auto-discovered by Claude). -->
<!-- See docs/EXTENDING.md > "How It Works: File Architecture" for details on how these files connect. -->

## About This Project
<!-- Describe your project: what it is, what it does, what tech stack it uses -->

## Who I Am
<!-- Describe yourself or your team: experience level, how you like to work -->

## My Preferences
<!-- Add project-specific rules, coding conventions, or preferences here -->

- **Where documentation goes.** `README.md` is the front door and stays under 1,500 words (the release gate counts it on every run). The manual lives in `docs/`: new features, changed behavior, setup and update steps, and new commands go to `docs/COMMANDS.md`, `docs/INSTALL.md`, `docs/EXTENDING.md` or `docs/TROUBLESHOOTING.md`; release notes go to `CHANGELOG.md`.

## Skills

Review capabilities live in `.claude/skills/` as SKILL.md files. They auto-create slash commands and Claude can invoke them through the Skill tool; a subagent gets a skill only when its agent file preloads it (`skills:` frontmatter). Shared reference files in `.claude/skills/shared/`. Use `/review` for unified auto-detected review or individual `/review-code`, `/review-ux`, etc. for focused reviews.
