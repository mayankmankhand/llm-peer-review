# Install and Update

The install and update guide for the LLM Peer Review plugin and the copy-install for other editors. The README is the short version; this is the whole of it.

## Requirements

The plugin needs **Claude Code** with plugin support (2.x) and **Node.js 22 or newer** (from 7.3.1, the debate scripts' OpenAI library requires it). It is tested on Linux under WSL. Native Windows is untested: the plugin keeps the stable path the rules file names (`~/.claude/plugins/data/tk-llm-peer-review/current`) as a symbolic link, and on Windows without symlink rights that link is silently not created, so open the manual from the plugin cache instead. The copy-install for other editors runs on **macOS, Linux, or WSL** (Windows Subsystem for Linux). Windows users: [install WSL](../SETUP.md#step-4-optional-install-wsl-if-you-prefer-a-bash-workflow) first. Native Windows PowerShell also works for setup and all non-debate commands; only `/ask-gpt` and `/ask-gemini` require bash/WSL. Browser QA (`/review-browser`) is not supported on native Windows yet: its script now writes to the Windows temp folder, but it has not been run there.

---

## Add to a New Project

Since v7.0.0 the toolkit is a Claude Code plugin. Nothing is copied into your project except a short rules file and a few seed files; the commands, skills, agents, and scripts live in the plugin and update in one command. Other editors keep the copy-install below.

### Install the plugin (Claude Code)

Inside Claude Code, from any folder:

```
/plugin marketplace add mayankmankhand/llm-peer-review
/plugin install tk@llm-peer-review
```

Or from a terminal: `claude plugin marketplace add mayankmankhand/llm-peer-review && claude plugin install tk@llm-peer-review -s user`. Restart Claude Code or run `/reload-plugins`, and the commands appear under the plugin's prefix: `/tk:explore`, `/tk:review`, `/tk:document`, and the rest. The plugin installs its own runtime packages (for `/tk:ask-gpt`, `/tk:ask-gemini`, `/tk:review-browser`) from its lockfile; nothing lands in your project's `package.json`.

### Seed your project

Open your project in Claude Code and run `/tk:setup`. On a fresh project it writes the short rules file `.claude/rules/toolkit.md`, `LESSONS.md`, `DESIGN-PROFILE.md`, `CLAUDE.md` (a short template: a Toolkit section plus project sections that are yours to fill in), the `plans/` and `artifacts/` folders, the gitignore lines, and a pointer to the marketplace in `.claude/settings.json` so a collaborator's Claude Code offers the install. Every file is write-when-absent: your existing files are never overwritten. The permission rows are the one list setup merges into an existing file: it backs up `.claude/settings.local.json` and `.claude/settings.json` before changing either, names every row it adds or removes, never adds back a row you deleted in that working copy, and stops without writing anything when a settings file does not parse. On a project that carried the copy-installed toolkit, it migrates instead; see [Update an Existing Project](#update-an-existing-project).

### Optional: API keys and Chromium

- `/tk:ask-gpt`, `/tk:ask-gemini`, and the design workflow's media helper look for each key in a real environment variable first, then in the project's own `.env.local` (from the folder the command runs in up to the git root), then in `~/.claude/plugins/.env.local` (one file shared by every project on the machine). Only the toolkit's own key and model variables are read from those files. [API-KEYS.md](../API-KEYS.md) walks through it.
- `/tk:review-browser` needs Chromium once per machine: `npx --prefix ~/.claude/plugins/data/tk-llm-peer-review/current playwright-core install chromium` (on Linux and WSL also `sudo npx playwright-core install-deps chromium`). That `current` path is a link the plugin keeps pointing at its installed version.

### Cloning a project that uses the toolkit

A clone carries the project's `.claude/settings.json`, which names the toolkit's marketplace and switches the plugin on, but not the plugin itself and not your local permissions. On a machine that has not installed the toolkit:

```bash
claude plugin marketplace add mayankmankhand/llm-peer-review
claude plugin install tk@llm-peer-review
```

Then restart Claude Code, open the project, and run `/tk:setup`: it writes the permission rows, which live in `.claude/settings.local.json` and are never committed. Opening the project in Claude Code and trusting the folder adds the marketplace from the project's settings too, and Claude Code then shows the same install command.

### Recommended for a hands-off install: tell your AI agent

Paste this into Claude Code's chat and it will run the steps above for you:

> "Set up the workflow from this repo in my project. Follow the instructions in https://github.com/mayankmankhand/llm-peer-review/blob/main/AGENT-SETUP.md"

[`AGENT-SETUP.md`](../AGENT-SETUP.md) has the step-by-step instructions written for AI agents, for both the plugin and the copy-install.

### Copy-install for other editors (Cursor, Codex, and any editor without Claude Code plugins)

The setup scripts copy the same files into your project the way every release before 7.0.0 did. They stay supported until the per-editor layouts land (#144); Claude Code users should prefer the plugin, because a copy-install cannot be audited by `/tk:upgrade` and its scripts are replaced whole on every re-run.

#### Manual Setup (run the script yourself)

Prefer to run the setup script yourself? Pick the script that matches your shell:

**Bash (WSL, macOS, Linux):**
```bash
bash /path/to/llm-peer-review/scripts/setup/setup.sh /path/to/your-project
```

**PowerShell (setup and non-debate commands - see [Requirements](#requirements)):**
```powershell
powershell -ExecutionPolicy Bypass -File C:\path\to\llm-peer-review\scripts\setup\setup.ps1 -Target "C:\path\to\your-project"
```

Or run from inside your project directory (no target needed):
```bash
cd /path/to/your-project
bash /path/to/llm-peer-review/scripts/setup/setup.sh
```

> **Note:** If you run the script from inside the toolkit repository without specifying a target, it shows an error to prevent accidentally copying files into the wrong place.

**Preview first (optional):** add `--dry-run` (bash) or `-DryRun` (PowerShell) to see exactly what an install or upgrade would do - version gap, migrations, files that would be overwritten, custom files that are left alone, and where backups go - without changing anything:

```bash
bash /path/to/llm-peer-review/scripts/setup/setup.sh /path/to/your-project --dry-run
```

Every real run prints the same pre-flight report before it touches anything.

**Local edits are guarded:** if you edited a toolkit-managed file, setup detects it (via a hash manifest at `.claude/.toolkit-manifest.json`) and asks before overwriting - in a terminal it prompts, in scripts and AI-agent runs it stops and lists the files. Add `--force` (bash) or `-Force` (PowerShell) after the target path to proceed without the prompt; every replaced file is still backed up first and listed at the end of the run. The guard needs the hash manifest to compare against, so it applies from the second run onward: a first install into a project that already keeps its own root `VERSION` or `.gitattributes` replaces them with a backup and no prompt (the pre-flight labels them "provenance unknown").

**What setup does:**
- **Copies into your project:** commands, skills (including the prebuilt HTML shells), agent definitions (`.claude/agents/` - the worker roles `/review`, `/index`, `/document`, and `/execute` dispatch, carrying their model, effort, and tool settings), the rules file (`toolkit.md`) and the two version-stamped shared fragments (`html-outputs.md`, `toolkit-reference.md`), and all runtime and helper scripts (`ask-gpt.js`, `env-local.js`, `ask-gemini.js`, `browse.js`, `generate-index.js`, `render-html.js`, `merge-findings.js`, `session-init.js`, `pre-push-check.js`, `correction-ledger.js`, `gen-media.js`, `open-artifact.sh`), plus `VERSION` and `.env.local.example`. Detects and removes any legacy `INDEX.md`. `CODEBASE_MAP.md` (a semantic map of your project) is generated on your first `/explore` run, when Claude auto-invokes `/index`. Setup also lands `.gitignore` (merged, not overwritten), `.gitattributes`, `VERSION`, `artifacts/README.md`, and the quarantined `.claude/scripts/package.json` and `package-lock.json`, and creates an empty `plans/` folder for your plan files.
- **Preserves your work:** `CLAUDE.md`, `LESSONS.md` (plus its companion `LESSONS-detail.md`), `DESIGN-PROFILE.md` (the design workflow's per-repo answers, see `/explore` above), and `settings.local.json` are skipped if they already exist - those are yours to customize. Custom files you add inside `.claude/commands/`, `.claude/skills/`, `.claude/agents/`, `.claude/scripts/`, or `.claude/rules/` are never modified or deleted (the toolkit's installer test suite plants a custom file in each of those folders, `.claude/agents/` included, and checks it survives an upgrade byte for byte), and anything setup does overwrite is backed up to a timestamped `.toolkit-backup-*` folder first. One thing setup does add to `settings.local.json` even on a first install: the two `browse.js` permission entries that need your project's absolute path, so `/review-browser` runs without a prompt.
- **Always updates:** the managed rules file (`.claude/rules/toolkit.md`) and the two version-stamped fragments in `.claude/skills/shared/` (`html-outputs.md`, `toolkit-reference.md`).
- **Stays in the toolkit repo:** setup scripts (`setup.sh`, `setup.ps1`, `install-alias.*`) are never copied.

See [How It Works](EXTENDING.md#how-it-works-file-architecture) for details on which files are yours vs. managed by the toolkit.

#### Reusable Command (for multiple projects)

Install a `setup-claude-toolkit` command you can run from anywhere:

**Bash (WSL, macOS, Linux):**
```bash
cd /path/to/llm-peer-review
bash scripts/setup/install-alias.sh
source ~/.bashrc  # or ~/.zshrc for zsh
```

**PowerShell (native Windows):**
```powershell
cd C:\path\to\llm-peer-review
powershell -ExecutionPolicy Bypass -File scripts\setup\install-alias.ps1
. $PROFILE  # Reload profile (or restart PowerShell)
```

> **Note:** If you don't have a PowerShell profile yet, the installer will create one for you automatically.

Then use it from anywhere:
```bash
setup-claude-toolkit /path/to/your-project
```

<a id="advanced-do-it-manually"></a>
<details>
<summary><strong>Advanced: Do It Manually</strong></summary>

Copy these into your project:

| What to copy | Where it goes |
|---|---|
| `.claude/commands/` (whole folder) | `your-project/.claude/commands/` |
| `.claude/skills/` (whole folder) | `your-project/.claude/skills/` |
| `.claude/agents/` (whole folder) | `your-project/.claude/agents/` |
| `.claude/rules/toolkit.md` | `your-project/.claude/rules/toolkit.md` |
| `.claude/settings.local.json` | `your-project/.claude/settings.local.json` |
| `.claude/scripts/` (`ask-gpt.js`, `env-local.js`, `ask-gemini.js`, `browse.js`, `correction-ledger.js`, `gen-media.js`, `generate-index.js`, `merge-findings.js`, `open-artifact.sh`, `pre-push-check.js`, `render-html.js`, `session-init.js`, `package.json`, `package-lock.json`) | `your-project/.claude/scripts/` |
| `CLAUDE.md` | `your-project/CLAUDE.md` |
| `LESSONS.md` | `your-project/LESSONS.md` |
| `LESSONS-detail.md` | `your-project/LESSONS-detail.md` |
| `.claude/skills/shared/design-profile-template.md` | `your-project/DESIGN-PROFILE.md` (seeded once, never overwritten) |
| `.env.local.example` | `your-project/.env.local.example` |
| `.gitignore` | `your-project/.gitignore` |
| `.gitattributes` | `your-project/.gitattributes` |
| `artifacts/README.md` | `your-project/artifacts/README.md` |

Then in your project folder:
```bash
# One install covers everything - it stays inside .claude/scripts/ so your
# project's own package.json is never touched.
npm install --prefix .claude/scripts

# For /ask-gpt and /ask-gemini, set up your API keys:
cp .env.local.example .env.local
# Open .env.local and paste your API keys

# For /review-browser, install the Chromium browser:
npx --prefix .claude/scripts playwright-core install chromium
# On Linux/WSL, also: sudo npx playwright-core install-deps chromium
```

> The debate commands and the browser command are optional. Skip the API keys if you don't want `/ask-gpt` and `/ask-gemini`. Skip the Chromium install if you don't want `/review-browser`. The core workflow commands work either way.

</details>

> **Never set up a dev environment before?** Follow the step-by-step guide in **[SETUP.md](../SETUP.md)**. It covers Windows (WSL), Mac, Node.js, GitHub CLI, Cursor, and API keys - everything you need from scratch.

> **Not using Cursor?** The setup guide assumes Cursor, but the toolkit works with any editor that supports Claude Code. Copy the relevant setup page into any AI assistant and ask it to rewrite the steps for your editor.

---

## Update an Existing Project

### On the plugin (v7.0.0 and later)

```
/plugin marketplace update llm-peer-review
/plugin update tk@llm-peer-review
```

From a terminal, the same two steps are:

```bash
claude plugin marketplace update llm-peer-review
claude plugin update tk@llm-peer-review
```

Keep the first step: `claude plugin update` on its own does not fetch the marketplace's catalog, so it would not see a new release. For a plugin installed for one project only, run the second step as `claude plugin update tk@llm-peer-review --scope project` from that project.

Either way, restart Claude Code or run `/reload-plugins`. That moves the plugin; your project has not changed. Until a session starts on the new release, the stable `current` link under `~/.claude/plugins/data/tk-llm-peer-review/` still points at the release you had before (the session-start hook moves it, and only a session start fires it: a restart starts one, while `/reload-plugins` loads the new release into the running session without starting one), so a script run through that path before then is the old release's. Then run `/tk:upgrade` in every project on the plugin; the session notice asks for it in each project that is behind. It checks more than your own commands, skills, agents, rules and `CLAUDE.md`: it also checks `.claude/settings.local.json`, and since 7.1.0 it compares that file's rows with the seed and reads `.gitignore`, `.gitattributes`, `artifacts/README.md`, and a migration record git still tracks, and four checks run on every upgrade whatever version you came from: the rules-file check (C-7) and the three repair checks (C-9 permission rows, C-10 seeded lines, C-11 `tk:` names). From v7.4.0 a fifth joins them: C-12 checks the rows of your own review kinds, when your project has any (see [Extending a toolkit stage](EXTENDING.md#extending-a-toolkit-stage)). From v7.5.0, on the upgrade that brings it, it also runs Claude Code's prompt audit once on your own `CLAUDE.md` and `.claude/` files, looking for instructions newer models no longer need, and you approve each edit it proposes (C-13). From v7.5.1 a sixth check runs on every upgrade: C-14 checks that your own agents, and the toolkit helpers your commands call, run on the model they should (see [If your command spawns subagents](EXTENDING.md#if-your-command-spawns-subagents)). From v7.6.0 two more join them, C-15 and C-16, the seeded-file and lessons-index checks described under "Your own files are never overwritten" below. It opens the cycle's issue, reads the [conventions](CONVENTIONS.md) that changed since the version the project was last audited against, and turns every file of yours that is behind one into a finding with a receipt: a command that still dispatches the old generic finder, a prompt that pastes review criteria, an agent with edit tools in a reviewer role, a path into `.claude/skills/shared/` that no longer exists in the project. The findings go through the same M2 audit and auto-fix loop a review uses, stopping once to ask, with every prompt file listed, before the first edit, then one sample `/tk:review` proves the loop on the new version and `/tk:document` records the cycle. A project with nothing behind is told so in one line.

Your own files are never overwritten by an update, because the update touches only the plugin cache. The two files the toolkit does write into a project, the short rules seed and the state file `.claude/.toolkit-state.json`, are the ones `/tk:upgrade` stamps. From v7.6.0, `/tk:upgrade` also reads the four files setup wrote once (`CLAUDE.md`, `LESSONS.md`, `DESIGN-PROFILE.md`, `.claude/toolkit/README.md`) and may offer the current seed's text for a paragraph or comment that is still an older release's (C-15). It also reads `LESSONS.md`, the one-line lessons index every session loads, and reports a bullet that has grown into a full write-up while there is no `LESSONS-detail.md` to hold it, or a lesson an old copy-install carried over from the toolkit's own log (C-16). Nothing is applied until you tick it on the approval page the upgrade shows once. A finding the upgrade's own audit refuted, such as a line in `CLAUDE.md` that records past work, stays out of later upgrades while that line is unchanged, so it is not raised at you again.

#### Version notices

Updates reach you from tagged releases, not from every commit on main. Each project records the toolkit version it was last set up or audited at, and when a session starts on a different plugin version, Claude tells you at the start of its first reply:

- **The plugin is newer than the project.** Run `/tk:upgrade` in the project. Nothing is blocked in the meantime.
- **The plugin is older than the project** (a collaborator upgraded the project first, for example). The pre-push check the toolkit runs before its own pushes (and any git hook your project wires to it) blocks the push until you update the marketplace and then the plugin, as above (`/plugin marketplace update llm-peer-review`, then `/plugin update tk@llm-peer-review`), and restart Claude Code, because an older plugin checks outgoing commits with older rules than the project was set up with. A push you type by hand in a project with no such hook is not checked.
- **The old copy-install still sits beside the plugin.** Run `/tk:setup` to migrate it, so you stop running the stale unprefixed commands by accident.

### Automatic updates

Off unless you turn them on: Claude Code leaves automatic updates off for third-party marketplaces such as this one, and setup never changes that. To turn them on, run `/plugin`, open **Marketplaces**, choose `llm-peer-review`, and select **Enable auto-update**. Claude Code then checks for a new release in the background after a session starts, and the new version loads after `/reload-plugins` or at the next launch; run `/tk:upgrade` in each project once it has. Setting the `DISABLE_AUTOUPDATER` environment variable turns every automatic update off. Turn automatic updates off before going back to an earlier release, so nothing moves you forward again unasked.

### Going back to an earlier release

1. In each project that uses the toolkit, while the newer release is still installed, lower the version the project records to the release you are going back to (here 7.1.0), then commit `.claude/.toolkit-state.json`:

   ```bash
   node ~/.claude/plugins/data/tk-llm-peer-review/current/scripts/upgrade-audit.js --rollback-to 7.1.0
   ```

   An older release's pre-push check blocks every push from a project that records a newer version, and this command is the one way to lower the record. It prints each value it changed.
2. Replace the plugin with the older release, with the marketplace pinned to that release's tag. Run these lines from a folder that is not a project, such as your home folder: run inside a project, the uninstall and the marketplace removal also delete the toolkit's marketplace and plugin entries from that project's `.claude/settings.json`.

   ```bash
   claude plugin uninstall tk@llm-peer-review --keep-data
   claude plugin marketplace remove llm-peer-review
   claude plugin marketplace add mayankmankhand/llm-peer-review@v7.1.0
   claude plugin install tk@llm-peer-review
   ```

   Then restart Claude Code. Uninstall with `--keep-data` first: removing the marketplace while the plugin is still installed also deletes the plugin's data folder. For a plugin installed for one project only, add `--scope project` to the uninstall and install lines and run them from that project, then put its settings back with `git checkout -- .claude/settings.json`.
3. If you reinstalled before step 1, the older release's push check blocks and names both versions. In each project, open `.claude/.toolkit-state.json`, set each of `version`, `previousVersion` and `auditedVersion` that is above the older release to that release (`7.1.0`), and commit the file.

To return to the newest release, run step 2 with `claude plugin marketplace add mayankmankhand/llm-peer-review` (no tag) in its third line, restart Claude Code, and run `/tk:upgrade` in each project.

### Moving a copy-install to the plugin

Install the plugin, then run `/tk:setup` in the project. It detects the copy-install, classifies every managed file against the installer's manifest, and stops to ask about any file you edited locally (each one is backed up and becomes an `/tk:upgrade` finding under C-6 whose receipt is the migration record's line for the file plus two hashes, the one the old manifest recorded and the backup copy's; the base to diff your edit against is the same file at the toolkit tag for the version the backup came from, not the current plugin copy). An install old enough to have no manifest is recognized too, by `VERSION` beside `.claude/commands/review.md` or by an early stamp in its rules file; every file it finds is of unknown provenance, so the run stops until you rerun with `--force`. Helper scripts an early installer copied into your root `scripts/` folder are removed with the rest (backed up first), while every other file there is left alone, and a `VERSION` file of your project's own is kept. On a clean or approved run it backs up and removes the toolkit's files, keeps every custom file, seeds the short rules file, merges the marketplace pointer and permissions (backing up both settings files first and naming every row it adds or removes), records the migration, and hands off to `/tk:upgrade`, which audits your custom files against every convention since the version you came from. The report ends with a one-line `Undo:` built from what that run actually did. Follow it left to right: `git checkout --` the tracked files it names, then delete the files it created (and its new folders, if empty), then copy the listed files back from the backup folder it names (or restore by hand the few it says git holds no copy of), then remove that backup folder. Use that line rather than a generic checkout, which would leave the new files in place and skip what only the backup holds. The first push after the migration stops to ask about the settings change, which is the tripwire doing its job. Your API keys need no move: the plugin's scripts read the project's own `.env.local` (after a real environment variable, before `~/.claude/plugins/.env.local`), so the file the copy-install used keeps working (see [API-KEYS.md](../API-KEYS.md)).

### Copy-install updates (other editors)

Re-run the same setup command (or ask your AI agent to follow [`AGENT-SETUP.md`](../AGENT-SETUP.md) again); it is safe to rerun, and the list below says exactly what it touches.

**What an upgrade touches:**

- **Overwritten** (tracked in the manifest, backed up first when they differ): `.claude/commands/*.md`, `.claude/agents/*.md`, all of `.claude/skills/` (including `shared/` and its shells), `.claude/rules/toolkit.md` (version-stamped, as are `html-outputs.md` and `toolkit-reference.md` under `shared/`), the toolkit scripts in `.claude/scripts/` (`ask-gpt.js`, `env-local.js`, `ask-gemini.js`, `browse.js`, `generate-index.js`, `render-html.js`, `merge-findings.js`, `session-init.js`, `pre-push-check.js`, `correction-ledger.js`, `gen-media.js`, `open-artifact.sh`, plus `package.json` and `package-lock.json`), `VERSION`, `.gitattributes`, `.env.local.example`, and `artifacts/README.md`.
- **Preserved** (skipped if present): `CLAUDE.md`, `LESSONS.md`, `LESSONS-detail.md` (seeded only on a fresh install), `DESIGN-PROFILE.md` (seeded from the installed template), and `.claude/settings.local.json` (kept, with new toolkit permissions merged in).
- **Merged in place:** `.gitignore` (missing toolkit lines appended, comments skipped, no duplicates) and the permissions list in `.claude/settings.local.json` (missing template entries added, known-stale entries removed). Only that permissions list is merged; every other top-level setting in `settings.local.json` (such as `defaultMode`) is left alone. A project-level `.claude/settings.json` is never touched.
- **Migrated when needed** (backed up first): command files that became skills (v3.5), `.claude/plans/` to `plans/` (v4.0), the old top-level `scripts/` location to `.claude/scripts/`, toolkit dependencies stripped from your root `package.json`, and a legacy `INDEX.md` removed (`/index` builds `CODEBASE_MAP.md` in its place).

**Before you upgrade.** The gate that stops a run when you edited a managed file is the one described under "Local edits are guarded" in [Manual Setup](#manual-setup-run-the-script-yourself) above. An install from before v5.5.0 has no manifest, so that gate cannot fire: its differing managed files show as `[differs, provenance unknown]` in the pre-flight and are replaced with a backup, with no prompt. For those, run `--dry-run` / `-DryRun` first, read that list, and copy anything you customized out of the backup folder afterwards. One more thing to know: a project that keeps its own root `VERSION` file or its own `.gitattributes` will have it replaced (backed up).

**If you need to undo it.** Setup creates `.toolkit-backup-<YYYYMMDD-HHMMSS>-<pid>` at the project root, and only when something is replaced or deleted. It holds every replaced managed file at its original relative path, files removed by a migration, your root `package.json` when it was cleaned, the previous `.claude/.toolkit-manifest.json`, and the pre-merge `.gitignore` and `.claude/settings.local.json`. Rollback is manual: copy files from the backup folder back to the same relative paths, manifest included. Files the upgrade *added* are not in the backup, but the restored manifest tells you which they are: open `.claude/.toolkit-manifest.json`; every path under `"files"` is one the toolkit tracks. Anything under `.claude/commands`, `skills`, `agents`, `scripts`, or `rules` that is not listed there and that you did not create was added by the upgrade and can be deleted. Leaving them is harmless; the next setup treats them as custom files. You can re-run setup later whenever you are ready.

**After upgrading:**

- Run `/index` if `CODEBASE_MAP.md` is missing or the upgrade removed an `INDEX.md`.
- If setup cleaned toolkit dependencies out of your root `package.json` (installs from before v4.3), run `npm install` at the project root so `package-lock.json` matches; setup does not touch the lock file.
- If your `CLAUDE.md` still says "report first" or carries a "CRITICAL RULES" block from an older version, retire that wording: the loop is auto by default from 6.0.0, and "report only" is a per-run phrase now.
- Permission entries in a project-level `.claude/settings.json` are yours to clean; setup never touches that file.
- Try `/audit-html` to see if any of your project's own markdown files would benefit from an HTML view. Toolkit outputs (plans, reviews, debates) already render HTML automatically; `/audit-html` is for your project's own long human-read pages.

Want optional features (`/ask-gpt`, `/ask-gemini`, `/review-browser`)? After re-running setup, run these in your project folder:

```bash
# Install the toolkit's runtime packages (one-time, stays in .claude/scripts/).
npm install --prefix .claude/scripts

# AI debate commands (/ask-gpt, /ask-gemini): set up API keys
cp .env.local.example .env.local
# Edit .env.local and paste your OPENAI_API_KEY and GEMINI_API_KEY
# Optional: FAL_KEY for video generation in the design workflow (see API-KEYS.md)

# Browser QA (/review-browser): install Chromium
npx --prefix .claude/scripts playwright-core install chromium
# On Linux/WSL only (apt-based; no --prefix needed):
sudo npx playwright-core install-deps chromium
```

**Check what's already installed:**
```bash
node -v                                                # Node.js
npm list --prefix .claude/scripts --depth=0            # toolkit runtime deps
npx --prefix .claude/scripts playwright-core --version # Chromium binary
```

### Checking Your Version

On the plugin, `/plugin` lists the installed version of `tk@llm-peer-review`. The version a project was last set up or audited at is recorded in `.claude/.toolkit-state.json`, along with the install path and the version it came from. The stamp near the top of `.claude/rules/toolkit.md` says which toolkit version its rules text matches; a clean `/tk:upgrade` raises that stamp only while the file's text still matches the shipped seed, so an older stamp on an edited file stays as it is:

```
<!-- Toolkit version: X.Y.Z | Managed by LLM Peer Review. ...
```

On a copy-install the same stamp shows the installed version; re-running setup updates it. See [CHANGELOG.md](../CHANGELOG.md) for what changed between versions, and its Upgrading sections for the conventions each release adds.

**Coming from before the CLAUDE.md split?** If your `CLAUDE.md` has toolkit rules mixed in (workflow, permissions, slash commands table), those now live in the plugin's `toolkit-reference` fragment, and the short seed in `.claude/rules/toolkit.md` points at it. Edit your `CLAUDE.md` to keep only project-specific information; `/tk:upgrade` flags the toolkit paths it still carries.


Every release since v4.3.3 is described in [CHANGELOG.md](../CHANGELOG.md#whats-new-since-v433), and the [releases page](https://github.com/mayankmankhand/llm-peer-review/releases) has the tags. The copy-install clones `main`, not a tag, so it also gets the work listed under Unreleased in [CHANGELOG.md](../CHANGELOG.md); the plugin installs the tagged release.
