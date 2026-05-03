# Create a Parallel Worktree

Set up an isolated worktree so you can work on a feature in a separate Cursor window without affecting your main working copy.

**Use this when:** You want to work on multiple features in parallel, or isolate experimental work from your main branch.
**Don't use this when:** You're doing a quick fix or documentation update on main.

<rules>

- Do NOT rollback or undo any steps if something fails partway through. Report the failure and move on. Attempting to undo a partially created worktree can leave git in a tangled state.
- Do NOT read the contents of `.env.local` - it contains API keys. Use the shell `cp` command to copy it.
- This command takes no arguments. Worktree names are auto-generated. The branch gets a meaningful name later when `/explore` identifies an issue.

</rules>

## Procedure

<procedure>

### Step 1: Guards

Run these checks. If any fail, stop with the indicated message.

1. **Git repo check** - Run `git rev-parse --git-dir`. If it fails, stop: "This isn't a git repository. Navigate to your project root and try again."
2. **Not already a worktree** - Compare `git rev-parse --git-dir` with `git rev-parse --git-common-dir`. These return the git directory for this working copy vs. the shared git directory for the whole repo. If they differ, you're in a worktree. Stop: "You're already in a worktree. Run this command from your main project folder instead."
3. **Not detached HEAD** - Run `git symbolic-ref HEAD`. If it fails, stop: "You're in detached HEAD state. Check out a branch first with `git checkout main`."
4. **Uncommitted changes warning** - Run `git status --porcelain`. If there is output, warn: "You have uncommitted changes. They won't appear in the new worktree - only committed code is copied." Do NOT stop - just inform the user.

### Step 2: Setup

1. Run `git worktree prune` to clean up stale entries.
2. Run `mkdir -p .claude/worktrees` to ensure the directory exists.

### Step 3: Find the next number

1. Parse `git worktree list` output and scan `.claude/worktrees/` for existing folders.
2. Look for folders matching the pattern `worktree-N` (simple numeric only - ignore issue-named folders like `worktree-58-branch-conflicts`).
3. Find the highest N and use N+1. If none exist, start at 1.

### Step 4: Create the worktree

Run: `git worktree add -b worktree-N .claude/worktrees/worktree-N HEAD`

If it fails because the branch name is taken, increment N and try again.

### Step 5: Install dependencies

Install host project deps and toolkit deps separately. The toolkit's deps live in `.claude/scripts/` (post-v4.3) and need their own install - without it, `/review-browser`, `/ask-gpt`, and `/ask-gemini` will not work in the new worktree.

1. **Host project deps** - if `package.json` exists at the worktree root, run: `npm install --prefix .claude/worktrees/worktree-N`. Skip if there is no host package.json.
2. **Toolkit deps** - if `.claude/scripts/package.json` exists in the worktree, run: `npm install --prefix .claude/worktrees/worktree-N/.claude/scripts`. Skip if there is no toolkit package.json (older v4.2 layouts kept toolkit deps at the host root).

If either install fails, warn the user but do NOT stop. The worktree is still usable for general work, but the affected toolkit features will not run until the missing deps are installed manually.

### Step 6: Copy environment

Copy `.env.local` from the main repo root into the worktree root:
`cp .env.local .claude/worktrees/worktree-N/.env.local`

- If `.env.local` does not exist in the main repo, skip and note it.
- If it already exists in the worktree, skip (don't overwrite).

### Step 7: Print summary

</procedure>

<reference>

Print a clear summary using this format:

```
Worktree ready!

  Path:         /full/absolute/path/to/.claude/worktrees/worktree-N
  Branch:       worktree-N
  Host npm:     installed (or: failed - run manually / skipped - no package.json)
  Toolkit npm:  installed (or: failed - run manually / skipped - no .claude/scripts/package.json)
  .env:         copied (or: skipped - not found / already exists)

Next steps:
  1. Open that path in a new Cursor window
  2. Use /explore to start working on your issue
     (/explore will rename the branch once an issue is identified)
  3. When done, run /document to create a PR and clean up
```

</reference>
