# Extending the Toolkit

How the toolkit fits around a workflow you already have, what its files are and where they live, how parallel worktrees work, and what you can customize.

## Already Have Your Own Workflow?

The toolkit now runs as a **loop** rather than a set of one-shot commands, and that is the change most likely to affect you if you arrive with your own commands, scripts, or way of working.

**What "a loop" means here.** The old behavior was report-first: a command found problems, showed you a list, and waited. The new behavior is that a command finds problems, checks them, fixes the ones that survive the check, verifies the fixes, and hands off to the next stage on its own. You type `/explore` and approve the plan. The rest runs. Two phrases take control back: say **"report only"** on a run you start and it reports without changing anything (for the review that chains from `/execute`, see [The loop and its two brakes](COMMANDS.md#the-loop-and-its-two-brakes) in the commands guide), or **"no chaining"** and it finishes that one stage without starting the next.

You do not have to give up what you already have. The loop is a pattern you can add to your own commands, and the rest of this section is how to do that safely, followed by what to check so your files survive an upgrade.

### Adding the loop to your own workflow

Automatic fixing is only safe because of what sits around it. If you take the "fix it automatically" half without these, you get the risk with none of the protection. In rough order of how much they matter:

| Add this | Why | Check your command |
|---|---|---|
| **An escape phrase** | Some runs you want to look before anything moves | Does your command honor "report only" by producing its report and changing nothing? If the phrase does nothing, you have no brake |
| **Proof attached to every finding** | A finding with no proof cannot be checked, so fixing it is guesswork | Does each finding carry a read-only command someone could run, plus a line saying what that output showed? |
| **A second opinion before the fix** | The thing that found a problem is the worst judge of whether it is real | Does anything with a fresh view check a finding before it gets fixed? Finder and judge must not be the same actor |
| **A different checker after the fix** | Models favor their own output and will not reliably catch their own mistakes | Does whatever wrote the fix also declare it verified? If yes, that verification is worth very little |
| **A retry limit and somewhere to fall back to** | Unbounded retrying is how an automatic command turns a small problem into a large one | Is there a number on the attempts, and a commit or checkpoint to revert to when they run out? |
| **A deletion guard** | A fix that restores something a person removed on purpose is a correct-looking regression | Before re-adding anything, does your command check whether a human deleted it deliberately? |

The short version: **auto-fixing is a privilege earned by verification.** Add the verification first and the automation second.

### Keeping your own files through an upgrade

**On the plugin (v7.0.0 and later), an update cannot touch your files:** `/plugin update` changes the plugin cache and nothing in your project. What can go stale is the other direction, your files referring to toolkit pieces that moved, and that is what `/tk:upgrade` audits: it reads the [conventions](CONVENTIONS.md) that changed, finds each file of yours behind one, and fixes it through the loop after asking you once. Three habits keep that audit short: refer to toolkit pieces by name (`Skill(tk:<name>)`, `subagent_type=tk:<name>`) rather than by a `.claude/...` path; give your own agents a `skills:` line instead of pasting criteria; and never edit a toolkit script, because the plugin replaces it whole (file an issue instead).

**On a copy-install,** re-running setup is how you get toolkit updates, and it is also where custom work quietly disappears. These are worth checking once, before your next upgrade.

**Do not customize by editing a toolkit file.** Editing `.claude/commands/review.md` to add your own step works until the next upgrade copies the toolkit's version back over it. Put your customization in a file the toolkit does not ship.

**Do not use a name the installer reclaims.** These names were toolkit locations once, so setup backs them up and removes them without checking whose they are:

- In `.claude/commands/`: `review-code.md`, `review-ux.md`, `review-plan.md`, `review-commands.md`, `review-browser.md`, `review-full.md`, `learning-opportunity.md`, `dev-lead-gpt.md`, `dev-lead-gemini.md`
- In your project's top-level `scripts/`: `ask-gpt.js`, `ask-gemini.js`, `browse.js`, `dev-lead-gpt.js`, `dev-lead-gemini.js`
- At the root: `INDEX.md`

**Prefix your own files, or put them in a subfolder.** `.claude/commands/myteam/deploy.md` survives an upgrade byte for byte, and a prefix also protects you from names the toolkit adds in future versions.

**Check your root `package.json`.** Every setup run removes these five dependencies if it finds them: `openai`, `@google/generative-ai`, `@google/genai`, `playwright-core`, `@axe-core/playwright`. They belong to the toolkit and live in `.claude/scripts/` instead. It also removes `ask-gpt` and `ask-gemini` from your `scripts` block, but only when they still point at the retired `scripts/ask-gpt.js` path; a script of your own by that name pointing anywhere else is left alone. If your own code genuinely imports one of the five, re-add it after setup or restore it from the timestamped backup folder setup leaves behind.

**See all of this before it happens.** Run the installer with `--dry-run`. It changes nothing and prints what would happen:

```bash
bash /path/to/llm-peer-review/scripts/setup/setup.sh /path/to/your-project --dry-run
```

Your files listed under "Custom files detected" are safe. Anything under "Managed toolkit files that differ" is about to be replaced.

### Extending a toolkit stage

**On the plugin you cannot edit a toolkit file, and from v7.4.0 you do not need to.** Seven files in `.claude/toolkit/`, a folder that is yours, let your project add its own text to a stage. Each is read when it exists and changes nothing when it does not:

| File | What it adds |
|---|---|
| `review-kinds.md` | Your own kinds of review: rows in the same three columns `/tk:review` uses, each naming an agent of yours under `.claude/agents/` |
| `plan-gate.md` | A gate every plan must pass, read by `/tk:create-plan` before its own requirements |
| `execute-gate.md` | A gate every implementation step must pass, read by `/tk:execute` |
| `fix-rules.md` | Extra conditions before a fix is applied, or extra actions that must always ask you. Additive only: a line that loosens one of the loop's own rules is ignored |
| `severity-anchors.md` | How severe your own kinds' findings are |
| `do-not-report.md` | Finding categories that are noise in your project, read by the security reviewers right after the toolkit's own list; an entry suppresses a category and never lowers a real severity |
| `checks.json` | Your project's checks, run by `/tk:execute` at its test step through the toolkit's checks runner: a JSON array of `{"id", "check", "expect"}`, for example `[{"id": "tests", "check": "npm test", "expect": {"exit": 0}}]`; `expect` is one of `exit`, `match`, `noMatch` or `lines`, `id` is letters, digits, dot, underscore and hyphen only (the full id rules are under this table), and `check` must start with a word on the runner's allow-list (also under this table). When the file exists it replaces the default test run, so include your test command; a failed or refused check fails the step |

**What a check may start with.** The runner is a guard, not a shell: a check runs only when its first word, and the first word after every `|`, `;`, `&&` or `||`, is on the read-only allow-list and the arguments pass that word's own rule. The test entry points are `npm test` and `npm run test`, `lint`, `typecheck` or `check` (also `test:<word>` and `check:<word>`), `npx jest`, `vitest`, `mocha`, `ava`, `tap`, `playwright`, `tsc` or `eslint`, `pytest`, `python -m pytest` (or `python3`), `go test`, `go vet`, `cargo test`, `check` or `clippy`, `make test`, `check` or `lint`, plus `yarn test`, `pnpm test`, `bun test`, `uv run pytest`, `poetry run pytest`, `bundle exec rspec` and `dotnet test`. The readers are `grep`, `sed -n`, `cat`, `head`, `tail`, `wc`, `test`, `diff`, `jq`, `ls`, `find` and a few more plain filters (`rg`, `sort`, `cut`, `uniq`, `stat`, `echo` and the like), each with its writing or executing flags refused (`sed -i`, `find -exec`, `sort -o`, the flags that follow symbolic links while walking: `grep -R`, `rg --follow`, `find -L`, `diff -r`, and the readers that open every file a folder or a list names: `diff` on a folder, `--files0-from`), and the read-only `git` subcommands (`log`, `show`, `diff`, `status`, `blame`, `ls-files` and the other readers; `branch` only as a listing). `node` may run only the toolkit's own `session-init.js`, `merge-findings.js`, `pre-push-check.js` and `upgrade-audit.js`. Anything else, and any redirect, command substitution, subshell, variable expansion, unquoted wildcard (quote a pattern; the runner expands nothing) or path outside the project, is refused before it runs: the check reads as a refused check (verdict `error`, the reason on the runner's stderr), which fails the step. So a yarn, pnpm or bun project writes its test command exactly as listed, and a tool that is not on the list goes behind a `check:<word>` script in your `package.json` or a `make check` target, which the runner allows because that code is yours.

**The id rules.** An `id` is the stem of the file the check's output is saved as, so it is letters, digits, dot, underscore and hyphen only, starts with a letter or digit, is at most 81 characters and is unique in the file. The runner validates the whole file before it runs anything: one id that breaks a rule (a space, a slash, a duplicate) stops every check in the file, with the reason as its one line on stderr.

`/tk:setup` writes a README into the folder that explains each file and the table format, and never touches the folder again. Your kinds run when `/tk:review` picks specialists on its own from what changed. `/tk:review <your-kind>` does not run it: it prints one line saying so (the name matches the short name in parentheses in your row's Specialist cell, or the whole cell), and `/tk:review-full` leaves your kinds out of its fan-out and says so in its charter (#201). Your review agent goes through the same audit as the toolkit's, so it needs an output contract and no edit tools; `/tk:upgrade` tells you when a row names an agent that is missing or can edit (C-12). Your kind runs on the model its agent file names in every mode, whatever the cycle's best, fit or cheap answer (see [If your command spawns subagents](#if-your-command-spawns-subagents)). The agent can stay short: list the plugin's skills in its `skills:` line by their scoped names (`tk:dispatch-contract`, `tk:review-code-criteria`) and write only what is specific to your project.

**Your own rules for Claude go under the marker.** The seeded `.claude/rules/toolkit.md` ends with a line that starts `<!-- Project section:`. A project seeded before v7.4.0 does not have that line and nothing adds it for you: copy it from the plugin's seed (`~/.claude/plugins/data/tk-llm-peer-review/current/seed/rules-toolkit.md`) to the end of your file. Everything under it is yours: the upgrade check stops comparing there, so your lines are never reported as drift.

### If your command spawns subagents

**Give finder workers no ability to edit.** A worker that can both find problems and change files will apply its findings before anything has judged them, which removes the check that makes the loop safe.

**Preload the expertise; paste only the run.** A subagent starts blank: it does not inherit your conversation and does not discover skills on its own. Since v7.0.0 the answer is a `skills:` line in the agent's frontmatter, which loads a skill into the worker byte for byte on every dispatch (the toolkit's finders preload `tk:review-<kind>-criteria` and `tk:dispatch-contract` this way). The prompt then carries only what differs per run: project context, file excerpts, notes. A manual pasted into the prompt sits in the parent transcript once per dispatch and is the first thing compaction truncates.

**Say which model each helper runs on.** The cycle's mode (best, fit or cheap) moves only the toolkit's own review and map helpers. For your own files:

- **Your agents.** An agent of yours runs on the model its file names, in every mode. With no `model:` line it follows `CLAUDE_CODE_SUBAGENT_MODEL` whenever that is set, which can put a reviewer or judge of yours below your session model: give such an agent `model: inherit`. Your review kinds are agents too, and `/tk:review` dispatches them with no model, so a kind whose agent names a model runs on it in every mode, even above your session model.
- **Your calls to the toolkit's finders or map helper.** Pass `model` the way the toolkit's own commands do: its `models.perRole` value from `node ~/.claude/plugins/data/tk-llm-peer-review/current/scripts/session-init.js --models`, never above your session model. Left out, the finders run on Opus whatever your session runs.
- **Your calls to the toolkit's judges** (`tk:audit-skeptic`, `tk:fix-verifier`, `tk:plan-critic`, `tk:design-critic`, `tk:design-comparer`). Pass no model: a model named in a call overrides the judge's own `model: inherit`.

`/tk:upgrade` checks these three on every upgrade (C-14): a reviewer, judge or review-kind agent of yours with no `model:` line, a call to a finder or the map helper that passes no model, and a call that names a model for a judge.

**Have a branch for the worker that fails.** Decide in advance what happens when one errors, times out, or returns something you cannot parse.

### A few things that will bite regardless

**Give temp files a per-run unique suffix.** Two tabs open on the same project will otherwise overwrite each other's working files.

**Never read a credentials file into the conversation.** Anything read becomes part of the transcript, and transcripts get written to temp files, sent to other AI models by the debate commands, and rendered into HTML. Copy such files with `cp`, which moves the bytes without putting them in context.

**Put permissions in `.claude/settings.local.json`.** That file is yours and survives upgrades. A project-level `.claude/settings.json` survives too, because setup never touches it; the toolkit keeps its own permissions in `settings.local.json` because that is the file it seeds and merges.

**Do not overwrite a file a toolkit command opens by name:** `plans/PLAN-*.md`, `CODEBASE_MAP.md`, `LESSONS.md`, `LESSONS-detail.md`.

**One thing to expect rather than fix:** `/tk:review` picks up a reviewer of yours only through a row in `.claude/toolkit/review-kinds.md` (see [Extending a toolkit stage](#extending-a-toolkit-stage)), and only when it picks specialists on its own. Without a row, type your command alongside it, or ask for it by name in the session.

---

## How It Works: File Architecture

When you set up the toolkit in a project, it creates several files. Here's how they fit together:

| File | Who owns it | What it does |
|---|---|---|
| `CLAUDE.md` | **You** | Your project-specific instructions (tech stack, preferences, team info). Never overwritten by setup. |
| `.claude/rules/toolkit.md` | **Toolkit** (seeded) | The short always-on rules, version-stamped. The full manual (workflow, command table, permissions, git and worktree conventions) is the plugin's `toolkit-reference` fragment. `/tk:setup` writes the seed once; `/tk:upgrade` flags the file only when its text differs from the seed the plugin ships (an older stamp alone is no finding). |
| `.claude/commands/*.md` | **Plugin** | One file per slash command, in the plugin cache on a plugin install (never in your project). Your own commands go beside them in your project's `.claude/commands/` and dispatch the toolkit's agents by scoped name. On a copy-install these are copied files you can edit until the next re-run. |
| `.claude/skills/<name>/SKILL.md` | **Plugin** | One folder per skill (review specialists, learning-opportunity, setup, upgrade). The `review-<kind>-criteria`, `dispatch-contract`, `design-rules`, and `project-context` skills are agent-only: they exist to be preloaded by name. |
| `.claude/skills/shared/*.md` | **Plugin** | Shared reference files used by multiple review skills (`severity-anchors.md`, `finding-contract.md`, `report-format.md`, `finding-id-system.md`, `browse-api.md`). Editing one of these affects every skill that injects it. |
| `LESSONS.md` | **You** | Lesson index (one line per lesson). Read at the start of `/explore`, `/create-plan`, `/execute`, and `/pair-debug` so past lessons inform new work. Never overwritten. |
| `LESSONS-detail.md` | **You** | Full write-ups behind the index, opened on demand when a lesson is relevant. Never overwritten. |
| `DESIGN-PROFILE.md` | **You** | Your repo's design answers: whether a design system exists and where, what exploration may vary, taste notes, directions tried, prompts to retry. Read by `/explore` and `/execute`, written by `/explore` and `/document`. Seeded once from `.claude/skills/shared/design-profile-template.md`, never overwritten. |
| `.claude/scripts/generate-index.js` | **Toolkit** | Scans the project and emits a manifest used by `/index` to build `CODEBASE_MAP.md`. Always updated on setup. |
| `.claude/scripts/render-html.js` | **Toolkit** | Injects a JSON payload plus the shared `tokens.css` into a prebuilt shell (`.claude/skills/shared/shells/`) to render HTML artifacts (review, document, explore, debate, audit, plan, audit static view), naming each page from the payload's own title. Also keeps the artifact index (`--index-add` / `--index-url`) that records every artifact published to a hosted page, stamps each published file's hosted URL onto its line 1 as `<!-- hosted: <url> -->`, and regenerates those stamps from the index with `--index-sync`. Always updated on setup. |
| `.claude/scripts/merge-findings.js` | **Toolkit** | Merges, sorts and numbers the findings a review run collected: findings that share a key become one at the highest severity with every receipt kept, and the set comes back as R1 onward with no gaps. Every runner calls it on a file it wrote. Always updated on setup. |
| `.claude/scripts/session-init.js` | **Toolkit** | Emits one JSON with codebase-map freshness, the lessons index, plan statuses, and worktree state, so `/explore`, `/create-plan`, `/pair-debug`, and `/execute` make one startup call instead of several reads. Always updated on setup. |
| `.claude/scripts/pre-push-check.js` | **Toolkit** | The pre-push tripwire: before any push it scans every outgoing commit for secrets, blocks never-push files (`.env`, `.env.local`, `.netrc`, your local settings), and shows any shared-settings change. Silent when clean; a hit blocks the push and asks you. Always updated on setup. |
| `.claude/scripts/correction-ledger.js` | **Toolkit** | Reads and writes the correction ledger at `~/.claude/correction-ledger.jsonl` for `/document`'s capture stage and `/error-analysis`. Uses only Node built-ins. Always updated on setup. |
| `.claude/scripts/gen-media.js` | **Toolkit** | The design workflow's helper: `--kind seed` prints a random string for seeded design directions; `image`, `video`, and `matte` generate media behind your own keys in `.env.local` and hand you the prompt to run elsewhere when a key is absent. Uses only Node built-ins (Node 18+). Always updated on setup. |
| `CODEBASE_MAP.md` | **Generated** | Auto-generated semantic map (modules, conventions, gotchas, navigation guide). Gitignored. Built by `/index`, refreshed by `/document`. |
| `plans/PLAN-*.md` | **Generated** | Plans produced by `/create-plan` and updated by `/execute`. Gitignored (local working docs). |
| `reports/` | **Yours** | Research and review reports you or the toolkit write during a cycle. Gitignored (local working docs). Setup does not create it; make it when you first need it. |
| `artifacts/html/` | **Generated** | Rendered HTML artifacts (reviews, cycle summaries, debates, audits) plus `index.jsonl`, the append-only record of every published page. Gitignored; the index is the one file in it that cannot be regenerated. |

On the plugin, `/tk:setup` also writes `.claude/.toolkit-state.json` (the install path and the versions the project came from and was audited against), merges a marketplace pointer into `.claude/settings.json`, and seeds `.gitignore`, `.gitattributes`, and `.env.local.example`. A project whose rules file already carries a 7.x stamp but has no state file counts as already set up: the stamp becomes the version it upgrades from, and no audited version is recorded. `.claude/.toolkit-state.json` is meant to be committed, so every collaborator's session sees the recorded version; the migration record `.claude/.toolkit-migration.json` is gitignored and keeps only a count of the permission rows it removed, not the rows. The `.claude/scripts/*.js` rows above describe the plugin's scripts; a plugin install has no `.claude/scripts/` folder in the project at all. A copy-install gets those files copied; see [Advanced: Do It Manually](INSTALL.md#advanced-do-it-manually) for the full list.

**Why is CLAUDE.md so short?** On purpose. It's a short template with project sections that are yours to fill in. On the plugin it also has a Toolkit section that says how the `tk:` commands are typed; a copy-install's template has a Skills section there instead. The toolkit rules live in `.claude/rules/toolkit.md` instead, so toolkit updates can reach you without overwriting your project notes.

**How does Claude find toolkit.md?** Claude Code automatically reads every file in `.claude/rules/` when it opens your project. No config needed; just having the file there is enough.

---

## Multi-Session Worktree Support

If you run multiple Claude Code sessions at the same time (in Cursor windows or via Remote Control), use Git worktrees so sessions don't conflict with each other.

**Starting a parallel session:** Type `/worktree` in the Claude Code panel. It creates an isolated worktree, installs dependencies, and copies your API keys. Open the path it gives you in a new Cursor window.

**What the toolkit does automatically:**
- `/worktree` creates the worktree, installs `npm` dependencies, and copies `.env.local`
- `/explore` and `/create-plan` detect worktree sessions and rename the branch to `worktree-<issue-number>-<short-label>` when an issue is referenced
- `/document` creates a PR from the worktree branch and offers to clean up the worktree folder when you're done
- The branch and PR stay alive even after the worktree folder is deleted; you can always re-create a worktree if fixes are needed

**What `/worktree` does:**
1. Checks you're not already in a worktree (and warns about uncommitted changes)
2. Creates a new worktree in `.claude/worktrees/worktree-N`
3. Runs `npm install` for both your host project (if a root `package.json` exists) and the toolkit (`.claude/scripts/package.json`), so debate and browser scripts work
4. Copies `.env.local` so API keys are available
5. Prints the path to open in a new Cursor window

**Key concept:** A worktree is just a folder. Deleting the folder does not delete the branch or PR. Think of it like closing a document window vs. deleting the file.

---

## Customization

- **CLAUDE.md** - Your project-specific instructions. Describe your project, tech stack, and preferences here. See [How It Works](#how-it-works-file-architecture) for details.
- **`.claude/rules/toolkit.md`** - The short toolkit rules seed. Don't edit this. `/tk:setup` writes it only when it is missing, so it never replaces yours; when `/tk:upgrade` flags it as stale, delete it and run `/tk:setup` for a fresh copy, or merge the new seed text by hand. Your own rules go in their own files beside it, which the toolkit never touches.
- **Commands and skills** - On the plugin, the toolkit's files are read-only in the plugin cache. Customize by adding your own command, skill, or agent in your project's `.claude/` folder: dispatch the toolkit's finders by scoped name (`subagent_type=tk:review-code-finder`), preload a criteria skill on your own agent with a `skills:` line, and refer to toolkit pieces by name rather than by path, which is what `/tk:upgrade` checks (see [docs/CONVENTIONS.md](CONVENTIONS.md)). On a copy-install each file in `.claude/commands/` and `.claude/skills/<name>/SKILL.md` is a copy you can edit until the next re-run of setup replaces it.
- **LESSONS.md** - Lesson index that Claude reads each session so past lessons feed back into new work; full write-ups live in **LESSONS-detail.md**. Both are yours to customize.

