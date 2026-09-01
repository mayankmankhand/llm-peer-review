# Toolkit Rules

<!-- Toolkit version: 6.1.0 | Managed by LLM Peer Review. Do not edit - changes will be overwritten on update. -->

## How We Work Together

### CRITICAL RULES

<rules>

1. **Auto by default** - The loop runs automatically per the shared fragment `.claude/skills/shared/hitl-loop.md`; a human is paged only per M1, stages hand off to each other automatically (M14), and two per-run opt-outs restore manual behavior: "report only" for auto-fixing (M10), "no chaining" for the stage handoff (M14)
2. **Ask questions** - If something is unclear, ask before assuming
3. **Explain simply** - Use plain English, avoid jargon
4. **Show your work** - Tell me what you're doing and why
5. **Use the Skill tool for /create-plan, /review, and /review-*** - Never manually replicate these commands or skills. If the user says "create plan" or "review", invoke the appropriate command or skill via the Skill tool so the template is followed.
6. **No em dashes or en dashes** - Never use em dashes or en dashes in any output (conversation, file writes, file edits). Use regular hyphens or rewrite the sentence.
7. **Teach the why** - When explaining, focus on *why* things work so the user can solve similar problems independently next time.

</rules>

The full loop mechanics live in `.claude/skills/shared/hitl-loop.md` (rules M1 to M14); the rationale and per-stage verdicts live in [HITL-MAP.md](https://github.com/mayankmankhand/llm-peer-review/blob/main/docs/HITL-MAP.md) in the toolkit repo.

### Our Workflow

<procedure>

We follow this flow for features. You type the steps marked **(you)**; the rest chain automatically per M14, and "no chaining" on any run stops after that stage:
0. `/worktree` - **(you, optional)** Create an isolated worktree for parallel work
1. `/explore` - **(you)** Understand the problem, ask clarifying questions
2. `/create-plan` - *chains from `/explore` once the conversation converges* - Create a step-by-step plan with status tracking, then stop for approval
3. `/execute` - **(you: approve the plan)** Build it, updating the plan as we go
4. `/review` - *chains from `/execute` on a clean finish* - it finds issues, dedups them, audits them (M2), auto-fixes the survivors, re-verifies, and exits each finding as page, digest, or log - see command table below. Use a specific `/review-*` command instead when you know which lens you need
5. `/document` - *chains from `/review` once the loop settles* - Update documentation

**Not steps in the chain.** `/ask-gpt`, `/ask-gemini`, and `/peer-review` are human-triggered and never chained into (M14). Because `/review` hands off to `/document` directly, there is no pause between them in which to type one. To get that window, drive the two stages yourself: say "no chaining" when you approve the plan (`/execute` then runs and stops), type `/review no chaining` (the review runs and stops), run the debate, then type `/document`. Their Recommended Actions are auto-processed through the same loop once you do.

The lessons captured at `/document` are read back at the start of the next `/explore`, `/create-plan`, `/execute`, and `/pair-debug` - that feedback loop is what keeps the toolkit from repeating mistakes.

</procedure>

---

## Slash Commands

<reference>

| Command | Purpose |
|---------|---------|
| `/explore` | Understand the problem, ask clarifying questions before implementation |
| `/create-plan` | Create a step-by-step implementation plan with status tracking |
| `/execute` | Build the feature, updating the plan as you go |
| `/review` | Run the right reviews automatically, combine findings into one report |
| `/review-code` | Review code - the specialist reports findings into the auto loop (skill - also invoked by /review) |
| `/review-security` | Application security review of a code change - injection, secrets, XSS, path traversal, SSRF, weak crypto (skill - also invoked by /review on every code change) |
| `/review-commands` | Review slash command prompts for quality and consistency (skill - also invoked by /review) |
| `/review-plan` | Check if implementation matches the plan (skill - also invoked by /review) |
| `/review-ux` | Evaluate UX quality from code and markup (skill - also invoked by /review) |
| `/review-browser` | QA a running web app via headless browser - screenshots, interactions, diagnostics (skill - also invoked by /review) |
| `/review-full` | Pre-release cross-domain check with go/no-go recommendation (skill - also invoked by /review) |
| `/review-deps` | Dependency and supply chain security review (skill - also invoked by /review) |
| `/review-copy` | Review copy clarity and reader orientation (skill - also invoked by /review) |
| `/security-audit` | Deep on-demand whole-repo security audit - entry points, authorization, crypto inventory, secret-history scan (skill - run deliberately, not part of /review) |
| `/peer-review` | Evaluate feedback from other AI models |
| `/document` | Update documentation after changes |
| `/error-analysis` | Group the correction ledger's open codes into categories, count them, and rank what you keep correcting (skill - user-triggered, never chained into) |
| `/create-issue` | Create issues on GitHub or GitLab (ask questions first, keep short) |
| `/ask-gpt` | AI peer review with ChatGPT debate (up to 3 rounds) |
| `/ask-gemini` | AI peer review with Gemini debate (up to 3 rounds) |
| `/pair-debug` | Focused debugging partner - investigate before fixing |
| `/package-review` | Review a package/codebase |
| `/learning-opportunity` | Pause to learn a concept at 3 levels of depth (skill - Claude can offer proactively) |
| `/codebase-to-course` | Turn any codebase into a visual learning guide |
| `/playground` | Generate throwaway interactive HTML for in-the-loop decisions: compare options, drag-to-reorder, toggle variants, tune sliders (skill - Claude can dispatch proactively, e.g. from /explore vision mode) |
| `/audit-html` | Scan your project's own markdown for files that would benefit from an HTML view. Report-only by default; opt-in static view generation (skill). |
| `/worktree` | Create an isolated parallel session in a new worktree |
| `/index` | (Re)generate `CODEBASE_MAP.md` - a semantic map of module purposes, conventions, and gotchas. Read by `/explore`, `/create-plan`, `/pair-debug`. |

### Plans

Plans are saved in `plans/` at the project root as `PLAN-*.md` files. They are gitignored (local working docs). `/create-plan` creates them, `/execute` updates them, and `/review-plan` reviews against them.

### Codebase Map

`CODEBASE_MAP.md` is an auto-generated semantic map (module purposes, entry points, conventions, gotchas, navigation guide). It is produced by `/index`, which orchestrates parallel Claude subagents over the codebase. `/explore`, `/create-plan`, and `/pair-debug` read it at session start to save tokens. `/document` regenerates it after work cycles. The file is gitignored (per-user, per-machine) and should not be edited manually - always use `/index`.

### Lessons

`LESSONS.md` is the user-owned learning log, split in two: `LESSONS.md` is a short index (one line per lesson) and `LESSONS-detail.md` holds the full write-ups. `/explore`, `/create-plan`, `/execute`, and `/pair-debug` read the index at session start (`/explore`, `/create-plan`, and `/pair-debug` read it at the same point they read `CODEBASE_MAP.md`; `/execute` reads it too, though it does not read the map); when a one-line lesson is relevant, they open the matching entry in `LESSONS-detail.md` on demand. This closes the loop: lessons captured at `/document` time are read back into future work instead of sitting unused. Backward compatible: if `LESSONS-detail.md` is absent, `LESSONS.md` is the older flat format and is read whole. Lessons guide Claude; they are context, not enforced rules.

### Correction Ledger

Every time you step in during a cycle - correcting Claude, or asking for something
different from what it produced - `/document` records that as one row in a ledger. The
point is to stop fixing at the first sighting and start seeing which problems are
actually frequent. The lesson rule in this file already assumes counting ("the user
typed the same correction twice") while having no counter; this is the counter.

**Two-stage coding.** At capture time you write an **open code**: free text, your own
words, describing what went wrong. Later, `/error-analysis` does the **axial coding**:
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
them, and `/error-analysis` never publishes and never sends anything to an external
model. That is a flat rule with no consent path.

**Turning it off for a repo:** `touch .claude/.no-correction-log`. Nothing is captured at
all for that repo, rather than captured and redacted.

**If the ledger is empty**, `/error-analysis` distinguishes "capture has never run here"
from "capture ran and found nothing". Capture fires at `/document`, so a project that
never runs `/document`, or whose copy is shadowed by a global
`~/.claude/commands/document.md`, silently records nothing.

### Skills

Skills live in `.claude/skills/<name>/SKILL.md`. They auto-create slash commands (so users can type `/review-code`, `/learning-opportunity`, etc.) and are also agent-discoverable, meaning Claude can find and invoke them without the user typing a slash command. Shared reference files used by multiple skills live in `.claude/skills/shared/`. The `project-context` skill is agent-only (`user-invocable: false`) - it provides project context to subagents and is not meant to be called directly by users.

**How shared content works:** Skill files use `` !`cat .claude/skills/shared/<file>` `` to inline shared content at skill-load time. This is Claude Code's dynamic context injection syntax - the runtime executes the shell command and replaces it with the output before the skill content reaches the model. It does not require Bash in the skill's `allowed-tools`. Note: subagents do NOT auto-discover skills. The `/review` orchestrator explicitly reads skill files and passes their content to subagents.

### HTML Outputs

`.claude/rules/html-outputs.md` documents when and how toolkit commands produce HTML (Reader/Claude principle, default-on commands, Claude's judgement triggers, playground export-loop rule). The seven helper-rendered types (review, document, explore, debate, audit report, plan view, audit static view) are rendered by `.claude/scripts/render-html.js`, which injects a compact JSON payload plus the shared `.claude/skills/shared/shells/tokens.css` into a prebuilt shell under `.claude/skills/shared/shells/` and writes the file - timestamped for cycle-bound artifacts, or stable-named and overwritten (`--stable`, plus `--out-dir plans` for plan views) for identity-keyed views that pair with a markdown file. The commands no longer hand-write HTML or inline `html-look.md`. The one hand-rendered exception, `/playground`, still reads the visual reference `.claude/skills/shared/html-look.md` (typography, colors, severity badge hex values, copy-button pattern), which `tokens.css` mirrors. Cycle-bound HTML artifacts land in `artifacts/html/` (gitignored); plan views land in `plans/` (also gitignored). Since #155 the private Claude-hosted page is the **primary** viewport and the local browser open is its fallback, used when the session cannot publish - exactly one viewport opens either way, and neither asks the user first: a private claude.ai page under the user's own account is not an outward send under M9. A publish-capable session renders with `--no-abs`, which strips this machine's absolute paths out of the page. Every publish is recorded in `artifacts/html/index.jsonl`, keyed to the repository rather than the working directory, and the record's URL is stamped onto line 1 of the local file (`--index-sync` regenerates every stamp from the index), so a past artifact can be reopened, an identity-keyed one updates its existing page instead of piling up duplicates, and a worktree shares the main copy's index. See the "Viewing the Artifact" section in `html-outputs.md`, which holds the whole decision.

The `/audit-html` skill applies the same principle to the project's own markdown (see the "Your Own Files" section in `html-outputs.md`). Report-only by default; opt-in static view generation.

### Command-Specific Rules

**When Running any /review-* command or skill:**
- Output a written report using the format in the corresponding skill's `SKILL.md` (`.claude/skills/review-*/SKILL.md`; the review commands became skills in v3.5)
- Specialist reviewers never modify files themselves - their job is to report findings into the loop
- Nothing waits for human approval: after the M2 audit (preceded by dedup on an orchestrated `/review`; a direct `/review-*` run that fanned out sub-agents dedups their combined findings first, and a single-pass run has nothing to dedup), surviving findings flow into the auto-fix loop below, unless this run was started with "report only" (M10)
- Use the "Use this when / Don't use this when" guidance at the top of each command to pick the right one

**Auto-fix loop for review findings and debate Recommended Actions (mechanics in `.claude/skills/shared/hitl-loop.md`):**
- After the M2 audit (receipts, skeptical pass, three-vote for Blocks - kills go to the log), survivors are auto-fixed, subject to the intent-reversal guard (M7) and the always-ask actions (M9). Every runner audits - M2's who-runs-it list covers the orchestrator, direct `/review-*` runs, and the session processing debate Recommended Actions, with `/peer-review`'s code-verifying evaluation as the stated exception
- Every fix is re-verified per M3 (which defines the mechanical-vs-judgment split and the countable "R3: FIXED" / "R3: NOT FIXED" verdict format) and M6 (sweep for other instances of the same claim) - a fix is not done until its check passes
- Failure handling follows M5: max 2 fix rounds, then revert to the last green checkpoint and page
- Anything NEW discovered while re-verifying follows M5's one-generation rule: fixed and re-verified once, then further discoveries land in the digest as open items

**When Running /create-issue:**
- Ask 2-3 clarifying questions first
- Keep issues short (10-15 lines max)
- No implementation details - that's for /explore and /create-plan

</reference>

### Subagent Strategy

<guidelines>

- **Use subagents for research and exploration** freely - no need to ask
- **One focused task per subagent** - don't bundle unrelated work
- **Don't duplicate work** - if a subagent is researching something, don't also do it yourself
- **Parallelize independent plan steps** - announce what each parallel task will do, then proceed without waiting (matches the auto verdict for /execute)

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
- In the auto loop, pushes happen automatically after the pre-push tripwire (M11): `node .claude/scripts/pre-push-check.js` scans every outgoing commit for secrets, never-push files, and settings changes. A hit blocks the push and pages you; if the script is absent, M11's prose fallback runs instead.

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
- **How it works:** `/explore` auto-renames the branch when an issue comes up. `/create-plan` does the same as a fallback if `/explore` was skipped.
- **Cleanup:** `/document` handles end-of-session cleanup - creates a PR, then offers to delete the worktree folder. The branch stays alive until the PR is merged.
- **Key concept:** A worktree is just a folder on disk. Deleting it does not delete the branch or PR. You can always re-create a worktree from the same branch if you need to make fixes.

</guidelines>

---

## Self-Service

<guidelines>

If Claude can do it, Claude should do it. Do not ask the user to run commands that you are capable of running yourself. Act first, report what you did. (This covers running commands and checks; file edits follow the auto loop in Critical Rule #1, with the always-ask actions per M9 as the exception.)

### Do it yourself
- **Dev servers** - start the server in the background and report the localhost URL. The user should never have to start a server.
- **Tests and builds** - run `npm test`, `npm run build`, or the project's equivalent to verify your work. Report pass/fail.
- **Installing dependencies** - if a package is missing, run `npm install <package>` rather than telling the user to do it.
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

## Permissions

<reference>

This project uses two settings files. `settings.json` is committed to the toolkit repo and holds a shared baseline that currently contains only a context-autocompact threshold override, no permissions. Neither installer copies it, so a downstream project has one only if it creates its own. `settings.local.json` is user-specific and not overwritten on re-setup - your real permissions live here.

These are defined in `.claude/settings.local.json`. Each one exists for a reason.

The `glab` rows below are listed for completeness and are **not** seeded into a fresh install: a GitHub-hosted project never needs them. If your repo is on GitLab, add the `glab` entries you actually use to your own `settings.local.json`. Which CLI a command reaches for is decided at runtime from the git remote - see `.claude/skills/shared/host-cli.md`.

Host detection itself needs no new permission: it reads `git config --get remote.origin.url`, already covered by the `git config` row. `git remote get-url origin` returns the same string but would need a new entry, and reading `.git/config` as a file breaks inside a worktree, where `.git` is a file rather than a directory. The installed-CLI fallback (`command -v gh` / `command -v glab`) may prompt on first use, which is acceptable because it only runs when the remote host is neither github.com nor gitlab.com.

| Permission | Why it's here |
|---|---|
| `git init`, `git add`, `git rm`, `git commit` | Initializing repos, staging files, committing work |
| `git push`, `git pull`, `git fetch` | Syncing with remote repositories |
| `git branch`, `git checkout`, `git stash` | Branch management and stashing work in progress |
| `git worktree` | Creating, listing, and removing worktrees for parallel sessions |
| `git rev-parse`, `git rev-list` | Worktree detection, repo path queries, commit-range checks |
| `git status`, `git log`, `git diff`, `git show` | Inspecting repo state and history |
| `git config`, `git remote add`, `git remote set-url` | Git setup (e.g. safe.directory, remote URLs). `git config --get remote.origin.url` is also how commands detect whether this repo is on GitHub or GitLab |
| `git check-ignore` | Verifying .gitignore rules before committing |
| `gh repo create`, `gh repo view`, `gh repo edit`, `gh repo clone` | Repository scaffolding, viewing, cloning, and settings |
| `gh auth status` | GitHub authentication status check |
| `glab auth status` | GitLab authentication status check (GitLab repos only) |
| `gh issue create`, `gh issue view`, `gh issue close`, `gh issue list`, `gh issue reopen` | `/create-issue` command and issue management (GitHub) |
| `glab issue create`, `glab issue view`, `glab issue close`, `glab issue list`, `glab issue reopen` | The same, on GitLab repos |
| `gh label list`, `gh label create` | Managing GitHub labels |
| `gh pr create`, `gh pr view`, `gh pr diff`, `gh pr list` | Pull request workflows (GitHub). `/document` calls `gh pr list` for the cycle window and the PR link, so it needs its own entry |
| `glab mr create`, `glab mr view`, `glab mr list` | Merge request workflows (GitLab) |
| `gh api`, `gh release list` | GitHub API calls and release checks. `/review-deps` uses `gh api` on every host by design: it queries the GitHub repos of npm dependencies, not this project's host |
| `npm install`, `npm uninstall` | Managing dependencies |
| `npm audit`, `npm outdated` | Dependency security and freshness checks (used by `/review-deps`) |
| `node .claude/scripts/ask-gpt.js` | Running the ask-gpt debate script |
| `node .claude/scripts/ask-gemini.js` | Running the ask-gemini debate script |
| `node .claude/scripts/browse.js` | Running the headless browser QA script |
| `echo/cat * \| node .claude/scripts/browse.js *` | Piped input to browse.js (browse-api patterns). Kept as explicit entries because `echo *` / `cat *` wildcards may not match piped commands. Absolute-path variants pointing at the current project's `.claude/scripts/browse.js` are injected by setup.sh per project; stale `scripts/browse.js` entries from older installs are removed automatically on the next setup run. |
| `node .claude/scripts/generate-index.js` | Running the codebase scanner that emits the file manifest consumed by `/index` to build `CODEBASE_MAP.md` |
| `node .claude/scripts/pre-push-check.js` | Running the M11 pre-push tripwire (per-commit secret scan, never-push files, settings diff) before any push |
| `node .claude/scripts/render-html.js` | Rendering HTML artifacts through the shared shells, plus the artifact index modes (`--index-add`, `--index-url`, `--index-sync`) |
| `node .claude/scripts/session-init.js` | The one-call session context (map freshness, lessons, plans, worktree state) that `/explore`, `/create-plan`, `/execute`, and `/pair-debug` read at startup. Exact form, no wildcard: the script takes no arguments |
| `node .claude/scripts/correction-ledger.js` | The correction ledger behind `/document`'s capture stage and `/error-analysis`. The data it writes lives under `~/.claude/`, outside the repo |
| `bash .claude/scripts/open-artifact.sh` | Opening a rendered artifact in the browser (the local viewport fallback) |
| `open`, `xdg-open`, `powershell.exe`, `explorer.exe`, `wslpath` | The launchers `open-artifact.sh` reaches for per platform: `open` on macOS, `xdg-open` on Linux, `powershell.exe` then `explorer.exe` on WSL, plus `wslpath`, which converts the path for the WSL rungs |
| `bash scripts/setup/bump-version.sh` | Running the version-bump script during release prep |
| `bash -n scripts/setup/setup.sh`, `bash -n scripts/setup/bump-version.sh` | Syntax-checking setup scripts before release |
| `Read`, `Edit`, `Write`, `Glob`, `Grep` | Claude's built-in file tools (included for documentation) |
| `Skill(review-commands)`, `Skill(review-commands:*)` | Allow the `/review-commands` skill to be invoked without a prompt |
| `WebFetch` (github.com, raw.githubusercontent.com), `WebSearch` | Fetching GitHub content and web search |
| `cp` | Copying files (e.g. `.env.local` and `CODEBASE_MAP.md` into worktrees) |
| `ls`, `diff`, `echo`, `mkdir`, `cat` | Reading directories, comparing files, writing output, creating folders |
| `cd` | **Not included by default.** If your workflow needs it, add `"Bash(cd *)"` to your project's `.claude/settings.local.json`. Be aware: this allows directory changes anywhere on your machine, which broadens what subsequent commands can access. |

**Note:** `settings.local.json` also sets `defaultMode: acceptEdits` (auto-approves file edits after a command) and `additionalDirectories: ["/tmp"]` (lets Claude read/write `/tmp` for debate scripts and temp files). These are top-level settings, not permission entries.

</reference>

---

## Remember

<rules>

- I'm learning - explain what you do
- The loop runs auto by default; say "report only" on any run you start to get report-first behavior for that run (M10); for the review that chains from `/execute`, say "no chaining" at plan approval and type `/review report only` yourself
- Stages chain automatically (M14); say "no chaining" on any run to stop after that stage. Different knob from "report only": one governs whether the next stage fires, the other whether findings are auto-fixed
- Ask if unsure
- After non-trivial corrections, update the learning log: a one-liner in `LESSONS.md` plus the full write-up in `LESSONS-detail.md`. Capture a lesson when Claude makes the same mistake a second time, when a review catches something Claude should have known, or when you type the same correction you typed before.

</rules>
