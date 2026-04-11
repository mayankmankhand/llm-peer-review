# Update Documentation Task

You are updating documentation after code changes.

## Primary Documentation Files

- **CLAUDE.md** - Project-specific instructions: tech stack, preferences, team info (user-owned)
- **README.md** - Project overview for humans
- **LESSONS.md** - Learning log: what worked, what didn't, mistakes to avoid (user-owned)
- **CHANGELOG.md** - User-facing changes: new features, breaking changes (update if it exists)
- **`.claude/rules/toolkit.md`** - Toolkit workflow rules (toolkit-owned, **do not edit** - overwritten on update)

Keep README.md and CLAUDE.md consistent with each other. Never edit `toolkit.md`.

## 1. Identify Changes
- Check git diff or recent commits for modified files
- Identify which features/modules were changed
- Note any new files, deleted files, or renamed files

## 2. Verify Current Implementation
**CRITICAL**: DO NOT trust existing documentation. Read the actual code.

For each changed file:
- Read the current implementation
- Understand actual behavior (not documented behavior)
- Note any discrepancies with existing docs

## 3. Update Relevant Documentation

**What goes where:**
- **README.md** - New features, changed behavior, setup instructions, new commands
- **CLAUDE.md** - Project description, tech stack, team info, coding preferences
- **CHANGELOG.md** - User-facing changes: new features, breaking changes, fixes (if the file exists)
- **LESSONS.md** - Prompt the user: "Did you learn anything this session worth logging?"
- **INDEX.md** - Regenerate by running `node .claude/scripts/generate-index.js` (if the script exists). If the script fails, warn the user and skip INDEX.md. Do not write this file manually - always use the script.

## 4. Documentation Style Rules

✅ **Concise** - Sacrifice grammar for brevity
✅ **Practical** - Examples over theory
✅ **Accurate** - Code verified, not assumed
✅ **Current** - Matches actual implementation
✅ **Right file** - Put info where it belongs (see Section 3)

❌ No enterprise fluff
❌ No outdated information
❌ No assumptions without verification
❌ Don't edit `toolkit.md` - it's auto-managed

## 5. Ask if Uncertain

If you're unsure about intent behind a change or user-facing impact, **ask the user** - don't guess.

## 6. Worktree Cleanup

Detect if you're in a worktree: compare `git rev-parse --git-dir` with `git rev-parse --git-common-dir`. If they differ, you're in a worktree.

**If NOT in a worktree** - skip this section entirely.

**If in a worktree:**

Walk the user through each step one at a time, confirming before proceeding to the next.

1. Run `git status`. If there are uncommitted changes, ask the user whether to commit them before proceeding. Follow the commit message conventions in toolkit.md (start with a verb, under 50 characters). Do not continue with uncommitted work.
2. Push the branch to the remote.
3. If the branch name does not match `worktree-<number>-<label>`, ask the user: "Your branch still has its default name. Want to rename it before creating the PR?" Follow the worktree naming convention in toolkit.md if they say yes.
4. Draft a PR title and body summarizing the branch's changes. Show it to the user for review, then create the PR:
   ```
   gh pr create --base main --title "..." --body "..."
   ```
5. Show the user the PR URL.
6. Ask the user: "Want me to delete this worktree? The branch and PR will stay - only the local folder is removed."
7. If they say yes, run `git worktree remove <worktree-root-path>` from outside the worktree directory. If removal fails due to untracked files (build artifacts, .env.local, etc.), let the user know they can clean up manually or use `--force`.
8. The branch stays alive on GitHub until the PR is merged or closed. To re-create the worktree later if fixes are needed: `git worktree add <path> <branch-name>`.
