# Toolkit Rules

<!-- Toolkit version: 4.2.2 | Managed by LLM Peer Review. Do not edit - changes will be overwritten on update. -->

## How We Work Together

### CRITICAL RULES

<rules>

1. **Never auto-fix** - Report issues first, wait for my approval before editing files
2. **Ask questions** - If something is unclear, ask before assuming
3. **Explain simply** - Use plain English, avoid jargon
4. **Show your work** - Tell me what you're doing and why
5. **Use the Skill tool for /create-plan, /review, and /review-*** - Never manually replicate these commands or skills. If the user says "create plan" or "review", invoke the appropriate command or skill via the Skill tool so the template is followed.
6. **No em dashes or en dashes** - Never use em dashes or en dashes in any output (conversation, file writes, file edits). Use regular hyphens or rewrite the sentence.
7. **Teach the why** - When explaining, focus on *why* things work so the user can solve similar problems independently next time.

</rules>

### Our Workflow

<procedure>

We follow this flow for features:
0. `/worktree` - (Optional) Create an isolated worktree for parallel work
1. `/explore` - Understand the problem, ask clarifying questions
2. `/create-plan` - Create a step-by-step plan with status tracking
3. `/execute` - Build it, updating the plan as we go
4. Run `/review` for auto-detected review, or a specific `/review-*` command (report only, don't fix) - see command table below
5. `/ask-gpt` or `/ask-gemini` - Get a second opinion via multi-model debate
6. `/peer-review` - Evaluate debate findings (paste results here)
7. `/document` - Update documentation

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
| `/review-code` | Review code - report issues only, don't fix (skill - also invoked by /review) |
| `/review-commands` | Review slash command prompts for quality and consistency (skill - also invoked by /review) |
| `/review-plan` | Check if implementation matches the plan (skill - also invoked by /review) |
| `/review-ux` | Evaluate UX quality from code and markup (skill - also invoked by /review) |
| `/review-browser` | QA a running web app via headless browser - screenshots, interactions, diagnostics (skill - also invoked by /review) |
| `/review-full` | Pre-release cross-domain check with go/no-go recommendation (skill - also invoked by /review) |
| `/review-deps` | Dependency and supply chain security review (skill - also invoked by /review) |
| `/review-copy` | Review copy clarity and reader orientation (skill - also invoked by /review) |
| `/peer-review` | Evaluate feedback from other AI models |
| `/document` | Update documentation after changes |
| `/create-issue` | Create GitHub issues (ask questions first, keep short) |
| `/ask-gpt` | AI peer review with ChatGPT debate (3 rounds) |
| `/ask-gemini` | AI peer review with Gemini debate (3 rounds) |
| `/pair-debug` | Focused debugging partner - investigate before fixing |
| `/package-review` | Review a package/codebase |
| `/learning-opportunity` | Pause to learn a concept at 3 levels of depth (skill - Claude can offer proactively) |
| `/codebase-to-course` | Turn any codebase into a visual learning guide |
| `/worktree` | Create an isolated parallel session in a new worktree |
| `/index` | Rebuild the project's INDEX.md file (auto-generated file tree) |

### Plans

Plans are saved in `plans/` at the project root as `PLAN-*.md` files. They are gitignored (local working docs). `/create-plan` creates them, `/execute` updates them, and `/review-plan` reviews against them.

### Project Index

`INDEX.md` is an auto-generated file tree of all git-tracked files. It's created by a Node script (`.claude/scripts/generate-index.js`) and is gitignored. `/explore` reads it at the start of Phase 2 to understand project structure. `/document` regenerates it after changes. `/index` rebuilds it on demand. Do not edit INDEX.md manually.

### Skills

Skills live in `.claude/skills/<name>/SKILL.md`. They auto-create slash commands (so users can type `/review-code`, `/learning-opportunity`, etc.) and are also agent-discoverable, meaning Claude can find and invoke them without the user typing a slash command. Shared reference files used by multiple skills live in `.claude/skills/shared/`. The `project-context` skill is agent-only (`user-invocable: false`) - it provides project context to subagents and is not meant to be called directly by users.

**How shared content works:** Skill files use `` !`cat .claude/skills/shared/<file>` `` to inline shared content at skill-load time. This is Claude Code's dynamic context injection syntax - the runtime executes the shell command and replaces it with the output before the skill content reaches the model. It does not require Bash in the skill's `allowed-tools`. Note: subagents do NOT auto-discover skills. The `/review` orchestrator explicitly reads skill files and passes their content to subagents.

### Command-Specific Rules

**When Running any /review-* command or skill:**
- Output a written report using the format in the corresponding skill's `SKILL.md` or `.claude/commands/review-*.md`
- Do NOT modify any files
- Wait for me to say "fix it" before making changes
- Use the "Use this when / Don't use this when" guidance at the top of each command to pick the right one

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
- **Parallelize independent plan steps** - tell the user what each parallel task will do and wait for approval before starting

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
- Before switching to a different task
- When you want a checkpoint you can return to

### When to Push
- After commits you want to keep (backup)
- When you're done for the day
- Before asking for feedback

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

If Claude can do it, Claude should do it. Do not ask the user to run commands that you are capable of running yourself. Act first, report what you did. (This applies to running commands and checks - Critical Rule #1 still governs code changes: report first, fix later.)

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

This project uses two settings files. `settings.json` is committed to the repo and provides a shared baseline (temp-file permissions for debate scripts). `settings.local.json` is user-specific and not overwritten on re-setup - your real permissions live here.

These are defined in `.claude/settings.local.json`. Each one exists for a reason:

| Permission | Why it's here |
|---|---|
| `git init`, `git add`, `git rm`, `git commit` | Initializing repos, staging files, committing work |
| `git push`, `git pull`, `git fetch` | Syncing with remote repositories |
| `git branch`, `git checkout`, `git stash` | Branch management and stashing work in progress |
| `git worktree` | Creating, listing, and removing worktrees for parallel sessions |
| `git rev-parse` | Worktree detection and repo path queries |
| `git status`, `git log`, `git diff`, `git show` | Inspecting repo state and history |
| `git config`, `git remote add`, `git remote set-url` | Git setup (e.g. safe.directory, remote URLs) |
| `git check-ignore` | Verifying .gitignore rules before committing |
| `gh repo create`, `gh repo view`, `gh repo edit`, `gh repo clone` | Repository scaffolding, viewing, cloning, and settings |
| `gh auth status` | GitHub authentication status check |
| `gh issue create`, `gh issue view`, `gh issue close`, `gh issue list`, `gh issue reopen` | `/create-issue` command and issue management |
| `gh label list`, `gh label create` | Managing GitHub labels |
| `gh pr create`, `gh pr view`, `gh pr diff` | Pull request workflows |
| `gh api`, `gh release list` | GitHub API calls and release checks |
| `npm install`, `npm uninstall` | Managing dependencies |
| `npm audit`, `npm outdated` | Dependency security and freshness checks (used by `/review-deps`) |
| `node scripts/ask-gpt.js` | Running the ask-gpt debate script |
| `node scripts/ask-gemini.js` | Running the ask-gemini debate script |
| `node scripts/browse.js` | Running the headless browser QA script |
| `echo/cat * \| node scripts/browse.js *` | Piped input to browse.js (browse-api patterns). Kept as explicit entries because `echo *` / `cat *` wildcards may not match piped commands. Absolute-path variants are injected by setup.sh per project. |
| `node .claude/scripts/generate-index.js` | Generating the project INDEX.md file |
| `Read`, `Edit`, `Write`, `Glob`, `Grep` | Claude's built-in file tools (included for documentation) |
| `WebFetch` (github.com, raw.githubusercontent.com), `WebSearch` | Fetching GitHub content and web search |
| `cp` | Copying files (e.g. `.env.local` into worktrees) |
| `ls`, `diff`, `echo`, `mkdir`, `cat` | Reading directories, comparing files, writing output, creating folders |
| `cd` | **Not included by default.** If your workflow needs it, add `"Bash(cd *)"` to your project's `.claude/settings.local.json`. Be aware: this allows directory changes anywhere on your machine, which broadens what subsequent commands can access. |

**Note:** `settings.local.json` also sets `defaultMode: acceptEdits`, which auto-approves file edits after you give a command. This is a top-level setting, not a permission entry.

</reference>

---

## Remember

<rules>

- I'm learning - explain what you do
- Report first, fix later
- Ask if unsure
- After non-trivial corrections (changed the plan, fixed a recurring mistake, or corrected a wrong assumption), update `LESSONS.md`

</rules>
