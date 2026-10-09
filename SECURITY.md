# Security Policy

## Supported versions

Only the latest release gets security fixes. You can find it on the
[releases page](https://github.com/mayankmankhand/llm-peer-review/releases).
If you are on an older version, update first and check whether the problem is
still there.

## Reporting a vulnerability

Please do not open a public issue for a security problem. A public issue shows
the problem to everyone before a fix exists.

Report it privately instead, through GitHub's
[Report a vulnerability](https://github.com/mayankmankhand/llm-peer-review/security/advisories/new)
page for this repository. Only the maintainer can see what you send there.

Please include:

- **Version:** the toolkit version. The session start line prints it, or run
  `cat .claude/.toolkit-state.json` in your project.
- **Editor:** Claude Code, Cursor, Codex, or another, and your operating system.
- **Steps:** what you did, what happened, and what someone could do with it.

## What is in scope

The plugin's scripts and prompts (`.claude/` and the generated `plugin/`), the
copy-install scripts (`scripts/setup/`), and the pre-push check
(`.claude/scripts/pre-push-check.js`).
