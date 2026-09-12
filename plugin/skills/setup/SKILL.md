---
name: setup
description: Seed a project for the LLM Peer Review plugin, or migrate a copy-install onto it - the short rules file, gitignore lines, folders, LESSONS.md, DESIGN-PROFILE.md, the marketplace pointer and permissions; managed toolkit files are removed (backed up first) and every custom file is kept. Run once per project after installing the plugin.
allowed-tools:
  - Bash
  - Read
  - Skill
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/setup-project.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/setup-project.js)"
---

# Setup

**Use this when:** You installed the `tk` plugin and want this project ready for it: a fresh project, or one that carried the copy-installed toolkit (`setup.sh` or `setup.ps1`, versions up to 6.x).
**Don't use this when:** The project is already on the plugin and you want its custom files audited against a newer toolkit version (that is `/tk:upgrade`), or you are inside the toolkit's own repository.

## Critical Rules

<rules>

1. **The script decides, you relay.** Everything happens in `node ${CLAUDE_PLUGIN_ROOT}/scripts/setup-project.js`: detection, the page, the backup, the removal, the seed, the settings merge, the report. Never reproduce a step of it by hand, never edit a managed file yourself, and never "help" by deleting something the script chose to keep.
2. **A page is a decision (M1).** Exit code 3 means the script stopped before touching anything and needs a human answer. Present it as a decision a non-engineer can make: what it found, what the recommended default is, what `--force` will do. Only a clear yes reruns it.
3. **The toolkit's own repository is not a project.** If `.claude-plugin/marketplace.json` exists at the root, stop and say so: the source tree is what the plugin is built from, not something to seed.
4. **No em dashes or en dashes** in anything you write.

</rules>

## Procedure

<procedure>

1. **Guard.** Check for `.claude-plugin/marketplace.json` at the project root (rule 3). Present: stop.

2. **Run the script** from the project root, once:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/setup-project.js
   ```

   It detects one of four situations and says which in its first lines: a fresh project; a copy-install with its manifest (every managed file is classified against the manifest hash); a copy-install without a manifest (an install from before v5.5.0, provenance unknown); or a project already on the plugin (seed check only). On a migration it refuses to start on a dirty git tree, because `git checkout` plus the backup folder is the undo.

3. **Read the exit code.**
   - **0, done.** Relay the report verbatim. It ends with the one-line undo (`git checkout -- .claude VERSION .gitattributes` plus the backup path) and, after a migration, with "Next: run /tk:upgrade".
   - **3, paged.** Relay what it found: locally modified toolkit files with their diff summaries, files of unknown provenance, or a dirty tree. State the recommended default (commit or stash first; on locally modified files, proceed, since each one is backed up and becomes an `/tk:upgrade` finding with the diff as its receipt). Ask one question. On a clear yes, rerun with `--force`; on anything else, stop.
   - **1, error.** Relay the message and stop. Do not retry blindly; the message names the cause.

4. **After a migration, hand off.** Say the three things the report cannot: the first push will page on the settings change (M11 in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`, which is what a new marketplace pointer in `.claude/settings.json` looks like to the tripwire); if the plugin was installed in this same session, `/reload-plugins` registers its commands and agents; and the migration's locally modified files are now `/tk:upgrade` findings. Then announce the handoff in one line ("Setup complete, chaining into `/tk:upgrade` to audit your custom files against the 7.0.0 conventions. Say \"no chaining\" to stop here.") and invoke `/tk:upgrade` through the Skill tool. Say "no chaining" stops here (M14).

5. **On a fresh project, stop after the report.** Nothing pre-dates the plugin, so there is nothing to audit. Mention where the API keys go under the plugin: the debate and media scripts read `.env.local` upward from the plugin's own folder, so the file lives at `~/.claude/plugins/.env.local` (one per machine), or the keys are exported in the shell; `API-KEYS.md` in the toolkit repository has the details.

</procedure>

## What the seed writes

<reference>

Write-when-absent, never overwritten: `CLAUDE.md`, `LESSONS.md`, `LESSONS-detail.md`, `DESIGN-PROFILE.md`, `.env.local.example`, `.gitattributes`, `artifacts/README.md`, `plans/`, `artifacts/`, and the short rules file `.claude/rules/toolkit.md` stamped with the plugin version. Line-merged: `.gitignore`. Key-merged: `.claude/settings.json` (the marketplace pointer and the enabled plugin, which is what tells a collaborator's Claude Code to offer the install) and `.claude/settings.local.json` (`defaultMode`, `additionalDirectories`, and the non-script allowlist; the script rows are dead under the plugin because each command carries its own `allowed-tools`). Every path is listed in the report.

A copy-install's managed files (the toolkit's commands, agents, skills, scripts, rules, `VERSION`, and the manifest) are backed up to `.toolkit-backup-<stamp>-plugin/` and removed; a file the manifest does not list is a custom file and is never touched. `.claude/.toolkit-state.json` records the install path and the version the project came from; `.claude/.toolkit-migration.json` records the migration, including every locally modified file with its backup path.

</reference>
