# Toolkit Reference

<!-- Toolkit version: 7.2.0 | Managed by LLM Peer Review. Do not edit - changes will be overwritten on update. -->

The long manual: workflow, command table, plans, map, lessons, ledger, design, HTML outputs, command-specific rules, subagent strategy, git and worktree conventions, self-service, versions and updates, permissions. Since v7.0.0 (issue #167) it ships inside the plugin, at the stable path `~/.claude/plugins/data/tk-llm-peer-review/current/skills/shared/toolkit-reference.md`, rather than sitting in every session's context; the short always-on rules are the seeded `.claude/rules/toolkit.md`, which points here.

## How We Work Together

### CRITICAL RULES

<rules>

1. **Auto by default** - The loop runs automatically per the shared fragment `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`; a human is paged only per M1, stages hand off to each other automatically (M14), and two per-run opt-outs restore manual behavior: "report only" for auto-fixing (M10), "no chaining" for the stage handoff (M14)
2. **Ask questions** - If something is unclear, ask before assuming
3. **Explain simply** - Use plain English, avoid jargon
4. **Show your work** - Tell me what you're doing and why
5. **Use the Skill tool for /tk:create-plan, /tk:review, and /tk:review-*** - Never manually replicate these commands or skills. If the user says "create plan" or "review", invoke the appropriate command or skill via the Skill tool so the template is followed.
6. **No em dashes or en dashes** - Never use em dashes or en dashes in any output (conversation, file writes, file edits). Use regular hyphens or rewrite the sentence.
7. **Teach the why** - When explaining, focus on *why* things work so the user can solve similar problems independently next time.

</rules>

The full loop mechanics live in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md` (rules M1 to M15); the rationale and per-stage verdicts live in [HITL-MAP.md](https://github.com/mayankmankhand/llm-peer-review/blob/main/docs/HITL-MAP.md) in the toolkit repo.

### Our Workflow

<procedure>

We follow this flow for features. You type the steps marked **(you)**; the rest chain automatically per M14, and "no chaining" on any run stops after that stage:
0. `/tk:worktree` - **(you, optional)** Create an isolated worktree for parallel work
1. `/tk:explore` - **(you)** Understand the problem, ask clarifying questions
2. `/tk:create-plan` - *chains from `/tk:explore` once the conversation converges* - Create a step-by-step plan with status tracking, then stop for approval
3. `/tk:execute` - **(you: approve the plan)** Build it, updating the plan as we go
4. `/tk:review` - *chains from `/tk:execute` on a clean finish* - it finds issues, dedups them, audits them (M2), auto-fixes the survivors, re-verifies, and exits each finding as page, digest, or log - see command table below. Use a specific `/tk:review-*` command instead when you know which lens you need
5. `/tk:document` - *chains from `/tk:review` once the loop settles* - Update documentation

**Not steps in the chain.** `/tk:ask-gpt`, `/tk:ask-gemini`, and `/tk:peer-review` are human-triggered and never chained into (M14). Because `/tk:review` hands off to `/tk:document` directly, there is no pause between them in which to type one. To get that window, drive the two stages yourself: say "no chaining" when you approve the plan (`/tk:execute` then runs and stops), type `/tk:review no chaining` (the review runs and stops), run the debate, then type `/tk:document`. Their Recommended Actions are auto-processed through the same loop once you do.

The lessons captured at `/tk:document` are read back at the start of the next `/tk:explore`, `/tk:create-plan`, `/tk:execute`, and `/tk:pair-debug` - that feedback loop is what keeps the toolkit from repeating mistakes.

</procedure>

---

## Slash Commands

<reference>

| Command | Purpose |
|---------|---------|
| `/tk:explore` | Understand the problem, ask clarifying questions before implementation |
| `/tk:create-plan` | Create a step-by-step implementation plan with status tracking |
| `/tk:execute` | Build the feature, updating the plan as you go |
| `/tk:review` | Run the right reviews automatically, combine findings into one report |
| `/tk:review-code` | Review code - the specialist reports findings into the auto loop (skill - also invoked by /tk:review) |
| `/tk:review-security` | Application security review of a code change - injection, secrets, XSS, path traversal, SSRF, weak crypto (skill - also invoked by /tk:review on every code change) |
| `/tk:review-commands` | Review slash command prompts for quality and consistency (skill - also invoked by /tk:review) |
| `/tk:review-plan` | Check if implementation matches the plan (skill - also invoked by /tk:review) |
| `/tk:review-ux` | Evaluate UX quality from code and markup (skill - also invoked by /tk:review) |
| `/tk:review-browser` | QA a running web app via headless browser - screenshots, interactions, diagnostics (skill - also invoked by /tk:review) |
| `/tk:review-full` | Pre-release cross-domain check with go/no-go recommendation (skill - also invoked by /tk:review) |
| `/tk:review-deps` | Dependency and supply chain security review (skill - also invoked by /tk:review) |
| `/tk:review-copy` | Review copy clarity and reader orientation (skill - also invoked by /tk:review) |
| `/tk:security-audit` | Deep on-demand whole-repo security audit - entry points, authorization, crypto inventory, secret-history scan (skill - run deliberately, not part of /tk:review) |
| `/tk:peer-review` | Evaluate feedback from other AI models |
| `/tk:document` | Update documentation after changes |
| `/tk:error-analysis` | Group the correction ledger's open codes into categories, count them, and rank what you keep correcting (skill - user-triggered, never chained into) |
| `/tk:create-issue` | Create issues on GitHub or GitLab (ask questions first, keep short) |
| `/tk:ask-gpt` | AI peer review with ChatGPT debate (up to 3 rounds) |
| `/tk:ask-gemini` | AI peer review with Gemini debate (up to 3 rounds) |
| `/tk:pair-debug` | Focused debugging partner - investigate before fixing |
| `/tk:package-review` | Review a package/codebase |
| `/tk:learning-opportunity` | Pause to learn a concept at 3 levels of depth (skill - Claude can offer proactively) |
| `/tk:codebase-to-course` | Turn any codebase into a visual learning guide |
| `/tk:playground` | Generate throwaway interactive HTML for in-the-loop decisions: compare options, drag-to-reorder, toggle variants, tune sliders (skill - Claude can dispatch proactively, e.g. from /tk:explore vision mode) |
| `/tk:audit-html` | Scan your project's own markdown for files that would benefit from an HTML view. Report-only by default; opt-in static view generation (skill). |
| `/tk:worktree` | Create an isolated parallel session in a new worktree |
| `/tk:index` | (Re)generate `CODEBASE_MAP.md` - a semantic map of module purposes, conventions, and gotchas. Read by `/tk:explore`, `/tk:create-plan`, `/tk:pair-debug`. |
| `/tk:setup` | Seed a project for the plugin: the short rules file, gitignore lines, folders, `LESSONS.md`, `DESIGN-PROFILE.md`, the marketplace pointer and permissions; on a copy-install it migrates (managed files removed after backup, custom files kept) |
| `/tk:upgrade` | After `/plugin update`: audit the project's own commands, skills, agents, rules, `CLAUDE.md` and the other files its sessions read against the conventions that changed since the last audit, plus the checks that run on every upgrade (rules text, permission rows, seeded lines, `tk:` names), through the normal M2 audit and auto-fix loop. A row written `Bash(x:*)` counts as the same row as `Bash(x *)`, and a row this working copy was offered before is never offered again |

### Plans

Plans are saved in `plans/` at the project root as `PLAN-*.md` files. They are gitignored (local working docs). `/tk:create-plan` creates them, `/tk:execute` updates them, and `/tk:review-plan` reviews against them.

### Codebase Map

`CODEBASE_MAP.md` is an auto-generated semantic map (module purposes, entry points, conventions, gotchas, navigation guide). It is produced by `/tk:index`, which orchestrates parallel Claude subagents over the codebase. `/tk:explore`, `/tk:create-plan`, and `/tk:pair-debug` read it at session start to save tokens. `/tk:document` regenerates it after work cycles. The file is gitignored (per-user, per-machine) and should not be edited manually - always use `/tk:index`.

### Lessons

`LESSONS.md` is the user-owned learning log, split in two: `LESSONS.md` is a short index (one line per lesson) and `LESSONS-detail.md` holds the full write-ups. `/tk:explore`, `/tk:create-plan`, `/tk:execute`, and `/tk:pair-debug` read the index at session start (`/tk:explore`, `/tk:create-plan`, and `/tk:pair-debug` read it at the same point they read `CODEBASE_MAP.md`; `/tk:execute` reads it too, though it does not read the map); when a one-line lesson is relevant, they open the matching entry in `LESSONS-detail.md` on demand. This closes the loop: lessons captured at `/tk:document` time are read back into future work instead of sitting unused. Backward compatible: if `LESSONS-detail.md` is absent, `LESSONS.md` is the older flat format and is read whole. Lessons guide Claude; they are context, not enforced rules.

### Correction Ledger

Every time you step in during a cycle - correcting Claude, or asking for something
different from what it produced - `/tk:document` records that as one row in a ledger. The
point is to stop fixing at the first sighting and start seeing which problems are
actually frequent. The lesson rule in this file already assumes counting ("the user
typed the same correction twice") while having no counter; this is the counter.

**Two-stage coding.** At capture time you write an **open code**: free text, your own
words, describing what went wrong. Later, `/tk:error-analysis` does the **axial coding**:
grouping those open codes into categories and ranking them by count. The split exists
because a category invented from one instance is a guess.

**What is recorded.** Only your own interventions. Review findings are deliberately not
logged: they already reach `LESSONS.md`, and a review writes a durable report every run,
so "have I seen this before?" is already answerable for findings and unanswerable for
corrections. This ledger instruments the half that has no instrument.

**Where the data lives.** `~/.claude/correction-ledger.jsonl`, per machine, outside every
repo, append-only. Each row carries the repo it came from, so repo-specific and
cross-repo questions are both a filter rather than a decision made at write time. The
mechanism ships to every install; the data never leaves the machine that wrote it.

**Privacy.** Two fields (`produced`, `correction`) hold near-verbatim fragments and are a
private layer: the rollup is built from an explicit whitelist projection that cannot read
them, and `/tk:error-analysis` never publishes and never sends anything to an external
model. That is a flat rule with no consent path.

**Turning it off for a repo:** `touch .claude/.no-correction-log`. Nothing is captured at
all for that repo, rather than captured and redacted.

**If the ledger is empty**, `/tk:error-analysis` distinguishes "capture has never run here"
from "capture ran and found nothing". Capture fires at `/tk:document`, so nothing is
recorded where that stage has never run, or where cycles were closed through an older
document command that has no capture stage: a customized `document.md` kept from a
copy-install, or a global `~/.claude/commands/document.md` run by its bare name instead
of the toolkit's command.

### Design Rules and Profile

Design work follows `${CLAUDE_PLUGIN_ROOT}/skills/shared/design-rules.md` (issue #160): a three-state rule (a repo that already has a design system keeps it; exploration inside one varies only layout, composition, motion, and copy; going further pages you), a load dial (none, improve, new), and six techniques adapted from Anshu Chimala's "How to turn your AI into a world-class designer": seed strings, ambitious briefs, a fresh-context design critic under the M15 bound, image and video generation behind your own keys, and a cut-and-polish pass. `/tk:explore` runs the step when a feature has a look, `/tk:create-plan` records the direction, `/tk:execute` runs the critic loop, `/tk:document` records what was tried. Each repo's answers live in `DESIGN-PROFILE.md`, user-owned and seeded once by setup from `${CLAUDE_PLUGIN_ROOT}/skills/shared/design-profile-template.md`. The toolkit's own artifact look is never touched.

### Skills

Skills live in `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md`. They auto-create slash commands (so users can type `/tk:review-code`, `/tk:learning-opportunity`, etc.) and are also agent-discoverable, meaning Claude can find and invoke them without the user typing a slash command. Shared reference files used by multiple skills live in `${CLAUDE_PLUGIN_ROOT}/skills/shared/`. The `project-context` skill is agent-only (`user-invocable: false`) - it provides project context to subagents and is not meant to be called directly by users.

**How shared content works:** Skill files use `` !`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/<file>"` `` to inline shared content at skill-load time. This is Claude Code's dynamic context injection syntax - the runtime executes the shell command and replaces it with the output before the skill content reaches the model. It does not require Bash in the skill's `allowed-tools`. Note: subagents do NOT auto-discover skills. Since v7.0.0 each `review-<kind>-finder` agent preloads its `review-<kind>-criteria` skill and the `dispatch-contract` skill through its `skills:` frontmatter, so `/tk:review` pastes nothing from a skill file into a dispatch (issue #167).

### HTML Outputs

`${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md` (a rules file until v7.0.0, now a shared fragment inlined by every command that renders HTML) documents when and how toolkit commands produce HTML (Reader/Claude principle, default-on commands, Claude's judgement triggers, playground export-loop rule). The seven helper-rendered types (review, document, explore, debate, audit report, plan view, audit static view) are rendered by `${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js`, which injects a compact JSON payload plus the shared `${CLAUDE_PLUGIN_ROOT}/skills/shared/shells/tokens.css` into a prebuilt shell under `${CLAUDE_PLUGIN_ROOT}/skills/shared/shells/` and writes the file - timestamped for cycle-bound artifacts, or stable-named and overwritten (`--stable`, plus `--out-dir plans` for plan views) for identity-keyed views, whose identity outlives any one run. Some of those pair with a markdown twin and some do not: plan views do, while the standing review page and the standing cycle summary `artifacts/html/cycle.html` (issue #163, rendered as `--shell document --name cycle`) have none. The commands no longer hand-write HTML or inline `html-look.md`. The one hand-rendered exception, `/tk:playground`, still reads the visual reference `${CLAUDE_PLUGIN_ROOT}/skills/shared/html-look.md` (typography, colors, severity badge hex values, copy-button pattern), which `tokens.css` mirrors. Cycle-bound HTML artifacts land in `artifacts/html/` (gitignored); plan views land in `plans/` (also gitignored). Since #155 the private Claude-hosted page is the **primary** viewport and the local browser open is its fallback, used when the session cannot publish - exactly one viewport opens either way, and neither asks the user first: a private claude.ai page under the user's own account is not an outward send under M9. A publish-capable session renders with `--no-abs`, which strips this machine's absolute paths out of the page. Every publish is recorded in `artifacts/html/index.jsonl`, keyed to the repository rather than the working directory, and the record's URL is stamped onto line 1 of the local file (`--index-sync` regenerates every stamp from the index), so a past artifact can be reopened, an identity-keyed one updates its existing page instead of piling up duplicates, and a worktree shares the main copy's index. See the "Viewing the Artifact" section in `html-outputs.md`, which holds the whole decision.

The `/tk:audit-html` skill applies the same principle to the project's own markdown (see the "Your Own Files" section in `html-outputs.md`). Report-only by default; opt-in static view generation.

### Command-Specific Rules

**When Running any /tk:review-* command or skill:**
- Output a written report using the format in the corresponding skill's `SKILL.md` (`${CLAUDE_PLUGIN_ROOT}/skills/review-*/SKILL.md`; the review commands became skills in v3.5)
- Specialist reviewers never modify files themselves - their job is to report findings into the loop
- Nothing waits for human approval: after the M2 audit (preceded by dedup on an orchestrated `/tk:review`; a direct `/tk:review-*` run that fanned out sub-agents dedups their combined findings first, and a single-pass run has nothing to dedup), surviving findings flow into the auto-fix loop below, unless this run was started with "report only" (M10)
- Use the "Use this when / Don't use this when" guidance at the top of each command to pick the right one

**Auto-fix loop for review findings and debate Recommended Actions (mechanics in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`):**
- After the M2 audit (receipts, skeptical pass, three-vote for Blocks - kills go to the log), survivors are auto-fixed, subject to the intent-reversal guard (M7) and the always-ask actions (M9). Every runner audits - M2's who-runs-it list covers the orchestrator, direct `/tk:review-*` runs, and the session processing debate Recommended Actions, with `/tk:peer-review`'s code-verifying evaluation as the stated exception
- Every fix is re-verified per M3 (which defines the mechanical-vs-judgment split and the countable "R3: FIXED" / "R3: NOT FIXED" verdict format) and M6 (sweep for other instances of the same claim) - a fix is not done until its check passes
- Failure handling follows M5: max 2 fix rounds, then revert to the last green checkpoint and page
- Anything NEW discovered while re-verifying follows M5's one-generation rule: fixed and re-verified once, then further discoveries land in the digest as open items

**When Running /tk:create-issue:**
- Ask 2-3 clarifying questions first
- Keep issues short (10-15 lines max)
- No implementation details - that's for /tk:explore and /tk:create-plan

</reference>

### Subagent Strategy

<guidelines>

- **Use subagents for research and exploration** freely - no need to ask
- **One focused task per subagent** - don't bundle unrelated work
- **Don't duplicate work** - if a subagent is researching something, don't also do it yourself
- **Parallelize independent plan steps** - announce what each parallel task will do, then proceed without waiting (matches the auto verdict for /tk:execute)

</guidelines>

---

## Git Workflow

<guidelines>

### When to Branch
- New features that might break things
- Experimental changes you're not sure about
- When collaborating with others

### When to Work on Main
- Documentation updates
- Small fixes
- Cleanup work

### When to Commit
- After completing a logical unit of work
- After each green logical unit in the auto loop (M4) - these checkpoints are what make an auto-fix safe to undo one at a time
- Before switching to a different task
- When you want a checkpoint you can return to

### When to Push
- After commits you want to keep (backup)
- When you're done for the day
- Before asking for feedback
- In the auto loop, pushes happen automatically after the pre-push tripwire (M11): `node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js <remote> <branch-or-tag>` scans every commit that destination does not have yet for secrets, never-push files, and settings changes, and the push then goes to exactly that destination. A hit blocks the push and pages you; if the script is absent, M11's prose fallback runs instead. A push you type yourself in a terminal is not checked.

### Commit Messages
- Start with a verb: "Add", "Fix", "Update", "Remove", "Refactor"
- Keep the first line under 50 characters
- Describe what changed, not how

**Examples:**
- `Add git workflow guidance to CLAUDE.md`
- `Remove Next.js web app (out of scope for v1)`
- `Fix broken reference in ask-gpt command`

**Simple rule:** For solo learning projects, working on main is fine. Branch when you want to experiment safely.

### Worktree Workflow

When running multiple Claude Code sessions in parallel (via Cursor windows or Remote Control spawn mode), each session should use its own Git worktree. This prevents branch conflicts between sessions.

- **Setup:** Use `--spawn=worktree` when starting Claude Code, or set it in `/config`
- **Branch naming:** When an issue is identified, rename the worktree branch to `worktree-<issue-number>-<short-label>` (e.g., `worktree-58-branch-conflicts`)
- **How it works:** `/tk:explore` auto-renames the branch when an issue comes up. `/tk:create-plan` does the same as a fallback if `/tk:explore` was skipped.
- **Cleanup:** `/tk:document` handles end-of-session cleanup - creates a PR, then offers to delete the worktree folder. The branch stays alive until the PR is merged.
- **Key concept:** A worktree is just a folder on disk. Deleting it does not delete the branch or PR. You can always re-create a worktree from the same branch if you need to make fixes.

</guidelines>

---

## Self-Service

<guidelines>

If Claude can do it, Claude should do it. Do not ask the user to run commands that you are capable of running yourself. Act first, report what you did. (This covers running commands and checks; file edits follow the auto loop in Critical Rule #1, with the always-ask actions per M9 as the exception.)

### Do it yourself
- **Dev servers** - start the server in the background and report the localhost URL. The user should never have to start a server.
- **Tests and builds** - run `npm test`, `npm run build`, or the project's equivalent to verify your work. Report pass/fail.
- **Installing dependencies** - if a package is missing, run `npm install <package>` rather than telling the user to do it. It asks for approval once: the baseline allows only a plain `npm install`, because installing a new package can run that package's own install scripts.
- **Service status** - before asking "is the server running?", check yourself with `curl`, `lsof`, or similar tools.
- **Linting and formatting** - run the linter after changes. Fix what you can, report what you can't.

### Leave to the user
- **Screenshots and visual QA** - the user will take and review screenshots themselves.
- **Judgment calls** - anything that requires the user's opinion, approval, or decision.
- **Destructive actions** - deleting data, force-pushing, or anything hard to reverse still needs confirmation.

### The rule of thumb
Ask yourself: "Can I run this command and interpret the result?" If yes, just do it. If you need the user's eyes or opinion, then ask.

</guidelines>

---

## Versions and Updates

<reference>

**Where the plugin comes from.** Users receive the plugin from a release tag, not from main: the marketplace pins `tk` to the tag `v<version>`, so a change merged to main reaches no one until it is released.

**The version guard.** Setup and `/tk:upgrade` record in `.claude/.toolkit-state.json` the toolkit version the project was last set up or audited at. At the start of every session the plugin compares that version with its own, and when they differ Claude relays a notice in plain words:

- **The plugin is newer than the project.** Run `/tk:upgrade`, so the project's own files are checked against the newer conventions. Nothing is blocked in the meantime.
- **The plugin is older than the project** (for example, a collaborator already upgraded it). Every push from this project is blocked by the pre-push check until the plugin is updated with the steps under "Updating the plugin" below. The block exists because an older plugin scans outgoing commits with older checks than the project was set up or audited with.

A separate notice says when the old copy-install still sits beside the plugin: every command then exists twice, with and without the `tk:` prefix, and it is easy to run the stale copy. `/tk:setup` migrates it.

### Updating the plugin

From a terminal:

```bash
claude plugin marketplace update llm-peer-review
claude plugin update tk@llm-peer-review
```

Then restart Claude Code and run `/tk:upgrade` in each project. The first line fetches the marketplace's catalog, which names the newest release: `claude plugin update` on its own does not fetch a GitHub marketplace, so it would not see a new release. For a plugin installed for one project only, run the second line as `claude plugin update tk@llm-peer-review --scope project` from that project. Inside a session, `/plugin marketplace update llm-peer-review` and then `/plugin update tk@llm-peer-review` do the same.

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

### Cloning a project that uses the toolkit

A clone carries the project's `.claude/settings.json`, which names the toolkit's marketplace and switches the plugin on, but not the plugin itself and not your local permissions. On a machine that has not installed the toolkit:

```bash
claude plugin marketplace add mayankmankhand/llm-peer-review
claude plugin install tk@llm-peer-review
```

Then restart Claude Code, open the project, and run `/tk:setup`: it writes the permission rows, which live in `.claude/settings.local.json` and are never committed. Opening the project in Claude Code and trusting the folder adds the marketplace from the project's settings too, and Claude Code then shows the same install command.

</reference>

---

## Permissions

<reference>

`/tk:setup` merges a fixed baseline into the project's `.claude/settings.local.json`: every allow row in the table below, exactly as written there, plus `additionalDirectories: ["/tmp"]`. It adds a row only when no permissions list in the file holds it (allow, ask or deny, with `Bash(x:*)` and `Bash(x *)` counting as one row) and it has not offered that row in this working copy before, sets no `defaultMode`, and writes no row for a toolkit script: since v7.0.0 each plugin command carries an `allowed-tools` list for the scripts it runs, so the `node .claude/scripts/...` rows a copy-install needed are dead under the plugin, and setup removes the ones whose script the project no longer has, plus a few old toolkit rows.

**What setup and `/tk:upgrade` change.** Setup backs up `settings.local.json` and `settings.json` before it changes either (its report names the backup folder and the command that undoes the run), names every row it adds and removes, and stops without writing anything when a settings file does not parse. The rows it has offered are listed in the working copy's git directory (`git rev-parse --git-path tk-offered-rows.json`), where git never commits them: a row you delete is not added back in this working copy, and a fresh clone is offered every row again, as is a project whose `settings.local.json` is missing. `/tk:upgrade` removes, through its audit, the retired toolkit rows the plugin lists, among them the broad `git config` and `npm install` rows that 7.2.0 narrowed, and reports baseline rows the file lacks unless the offered-rows list names them.

A project has two settings files. `.claude/settings.json` is committed and shared: setup merges in only the marketplace pointer and the enabled plugin, which is what makes a collaborator's Claude Code offer the install. `.claude/settings.local.json` is yours and never pushed: your real permissions live there, and setup only adds the missing baseline rows.

The baseline carries the four `glab` rows the toolkit's own host commands run, the GitLab twins of its `gh issue create`, `gh issue view`, `gh pr create` and `gh pr list` rows, so a GitLab repo needs no extra row for them and a GitHub-hosted project simply never runs them. For other GitLab work, add the ones you use to your own `settings.local.json`, for example `Bash(glab auth status *)`, `Bash(glab issue close *)`, `Bash(glab issue list *)`, `Bash(glab issue reopen *)`, and `Bash(glab mr view *)`. Which CLI a command reaches for is decided at runtime from the git remote - see `${CLAUDE_PLUGIN_ROOT}/skills/shared/host-cli.md`.

Host detection itself needs no new permission: it reads `git config --get remote.origin.url`, which the baseline allows as that exact command and nothing broader. `git remote get-url origin` returns the same string but would need a new entry, and reading `.git/config` as a file breaks inside a worktree, where `.git` is a file rather than a directory. The installed-CLI fallback (`command -v gh` / `command -v glab`) may prompt on first use, which is acceptable because it only runs when the remote host is neither github.com nor gitlab.com.

| Permission | Why it's here |
|---|---|
| `Bash(git init *)`, `Bash(git add *)`, `Bash(git rm *)`, `Bash(git commit *)` | Initializing repos, staging files, committing work |
| `Bash(git push *)`, `Bash(git pull *)`, `Bash(git fetch *)` | Syncing with remote repositories |
| `Bash(git branch *)`, `Bash(git checkout *)`, `Bash(git stash *)` | Branch management and stashing work in progress |
| `Bash(git status *)`, `Bash(git log *)`, `Bash(git diff *)`, `Bash(git show *)` | Inspecting repo state and history |
| `Bash(git config --get remote.origin.url)`, `Bash(git remote add *)`, `Bash(git remote set-url *)` | Host detection and remote URLs. `git config --get remote.origin.url` is how commands detect whether this repo is on GitHub or GitLab, and it is the only `git config` call the toolkit makes, so the row allows exactly that read: any other `git config` command, one that changes a setting included, asks first |
| `Bash(git check-ignore *)` | Verifying .gitignore rules before committing |
| `Bash(git worktree *)` | Creating, listing, and removing worktrees for parallel sessions |
| `Bash(git rev-parse *)`, `Bash(git rev-list *)` | Worktree detection, repo path queries, commit-range checks |
| `Bash(gh repo create *)`, `Bash(gh repo view *)`, `Bash(gh repo edit *)`, `Bash(gh repo clone *)` | Repository scaffolding, viewing, cloning, and settings |
| `Bash(gh auth status *)` | GitHub authentication status check |
| `Bash(gh issue create *)`, `Bash(gh issue view *)`, `Bash(gh issue close *)`, `Bash(gh issue list *)`, `Bash(gh issue reopen *)` | `/tk:create-issue`, the cycle issue `/tk:upgrade` opens, and issue management (GitHub) |
| `Bash(gh label list *)`, `Bash(gh label create *)` | Managing GitHub labels |
| `Bash(gh pr create *)`, `Bash(gh pr view *)`, `Bash(gh pr diff *)`, `Bash(gh pr list *)` | Pull request workflows (GitHub). `/tk:document` calls `gh pr list` for the cycle window and the PR link, so it needs its own entry |
| `Bash(gh api *)`, `Bash(gh release list *)` | GitHub API calls and release checks. `/tk:review-deps` uses `gh api` on every host by design: it queries the GitHub repos of npm dependencies, not this project's host |
| `Bash(glab issue create *)`, `Bash(glab issue view *)`, `Bash(glab mr create *)`, `Bash(glab mr list *)` | The same host commands on a GitLab repo: `/tk:create-issue` and the cycle issue `/tk:upgrade` opens, reading an issue, and `/tk:document`'s merge request and its link |
| `Bash(npm install)`, `Bash(npm uninstall *)` | A plain `npm install` of the project's own dependencies, and removing a package. Any other install, the one `/tk:worktree` runs inside a new worktree included, asks once, because an install can run a package's own install scripts and a wildcard row would also allow added package names |
| `Bash(npm audit *)`, `Bash(npm outdated *)` | Dependency security and freshness checks (used by `/tk:review-deps`) |
| `Read`, `Edit`, `Write`, `Glob`, `Grep` | The built-in file tools setup allows. These are real allow rows: `Edit` and `Write` approve file edits inside the project without a prompt |
| `WebFetch(domain:github.com)`, `WebFetch(domain:raw.githubusercontent.com)`, `WebSearch` | Fetching GitHub content and web search |
| `Bash(cp *)` | Copying files (e.g. `.env.local` and `CODEBASE_MAP.md` into worktrees) |
| `Bash(ls *)`, `Bash(diff *)`, `Bash(echo *)`, `Bash(mkdir *)`, `Bash(cat *)` | Reading directories, comparing files, writing output, creating folders |
| `Bash(mktemp -d /tmp/*)` | Per-run temp folders under `/tmp` (render payloads, browser actions, media prompts, playground pages, and the issue and PR body file on both hosts), so two sessions never share a file. Each plugin command or skill that calls it also carries this rule in its own `allowed-tools`, so it works before `/tk:setup` has run |
| `Skill(tk:explore)`, `Skill(tk:explore:*)`, `Skill(tk:create-plan)`, `Skill(tk:create-plan:*)`, `Skill(tk:execute)`, `Skill(tk:execute:*)`, `Skill(tk:review)`, `Skill(tk:review:*)`, `Skill(tk:document)`, `Skill(tk:document:*)` | The workflow stages, which hand off to each other through the Skill tool (M14) without a prompt |
| `Skill(tk:index)`, `Skill(tk:index:*)`, `Skill(tk:upgrade)`, `Skill(tk:upgrade:*)` | Stages invoked by another stage: `/tk:explore` generates a missing map with `/tk:index`, and `/tk:setup` chains into `/tk:upgrade` after a migration |
| `Skill(tk:project-context)`, `Skill(tk:project-context:*)`, `Skill(tk:design-rules)`, `Skill(tk:design-rules:*)` | Skills loaded by name mid-run: project context for review dispatches, and the design rules when `/tk:explore` or `/tk:execute` runs its design step |
| `Skill(tk:review-commands)`, `Skill(tk:review-commands:*)`, `Skill(tk:review-copy)`, `Skill(tk:review-copy:*)`, `Skill(tk:playground)`, `Skill(tk:playground:*)`, `Skill(tk:audit-html)`, `Skill(tk:audit-html:*)` | Skills Claude may invoke on its own judgment: two review lenses, the playground (`/tk:explore` dispatches it for prototypes and option comparisons), and the HTML audit |

**Not in the baseline: `cd`.** If your workflow needs it, add `"Bash(cd *)"` to your project's `.claude/settings.local.json`. Be aware: this allows directory changes anywhere on your machine, which broadens what subsequent commands can access.

**`additionalDirectories: ["/tmp"]`** sits under `permissions` beside the `allow` list, not as an allow row: it lets Claude read and write `/tmp`, where the debate transcripts and the per-run temp folders live.

**Default permission mode has limits.** A plugin command's `allowed-tools` grant lasts only until you send your next message, so a toolkit script the command runs after you answer one of its questions stops for approval. A stage the loop starts for you ("go" into `/tk:execute`, then `/tk:review` and `/tk:document`, or `/tk:setup` into `/tk:upgrade`) gets no grant of its own, so its scripts ask too, unless the command you typed in that same turn carries the same rule. A later release is to lift both. Saving a review receipt's output to a file uses a redirect, which default mode always asks about, and so do a few of the checks `/tk:upgrade`'s receipts run (`node -e`, `awk`, `find`). Approve those prompts when they come.

**API keys are never a permission row.** `/tk:ask-gpt`, `/tk:ask-gemini`, and `gen-media.js` look up each key in this order, first value wins: a real environment variable, then the project's own `.env.local` (searched from the working folder up to the git root), then `~/.claude/plugins/.env.local`, one file for every project on the machine. Only the toolkit's own key and model variables are read from those files, and Claude never reads them; `API-KEYS.md` in the toolkit repository has the details.

</reference>

---

## Remember

<rules>

- I'm learning - explain what you do
- The loop runs auto by default; say "report only" on any run you start to get report-first behavior for that run (M10); for the review that chains from `/tk:execute`, say "no chaining" at plan approval and type `/tk:review <start>..HEAD report only` yourself, with the plan's `Start commit`
- Stages chain automatically (M14); say "no chaining" on any run to stop after that stage. Different knob from "report only": one governs whether the next stage fires, the other whether findings are auto-fixed
- Ask if unsure
- After non-trivial corrections, update the learning log: a one-liner in `LESSONS.md` plus the full write-up in `LESSONS-detail.md`. Capture a lesson when Claude makes the same mistake a second time, when a review catches something Claude should have known, or when you type the same correction you typed before.

</rules>
