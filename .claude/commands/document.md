# Update Documentation Task

**Use this when:** Updating README, CLAUDE.md, CHANGELOG, LESSONS, or INDEX after code changes have shipped.
**Don't use this when:** You only need in-code docstrings or comments (just edit the code directly), or you are mid-implementation - wait until the work is done.

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
- **CODEBASE_MAP.md** - Regenerate by invoking `/index` (the command orchestrates the scanner and parallel subagents to produce a fresh semantic map). For projects over 500k tokens or with per-chunk overflow, `/index` will prompt for cost confirmation before spending API tokens - tell the user this may happen and that they can decline to skip the refresh (the prior map remains intact). If `/index` fails or the user declines, leave the existing map untouched and continue with the rest of `/document`. Do not write the map file manually.

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

## 7. Cycle Summary (HTML, default-on)

Generate a one-page HTML summary of what shipped this cycle. Runs on every `/document`, per `.claude/rules/html-outputs.md` (default-on).

### Determine the cycle window

The "cycle" is everything since the last `/document` run, tracked by a marker file.

1. Read `artifacts/html/.last-cycle` (a single line: the last summarized commit SHA).
2. **If the marker exists** and the SHA is still in history: window = `<marker>..HEAD`.
3. **If the marker is absent** (first run / fresh clone) **or the SHA is missing** (rebased/force-pushed, or the marker belongs to a different branch after a worktree switch): fall back to the last merged PR's merge commit (`gh pr list --state merged --limit 1 --json mergeCommit`, or the most recent merge in `git log`). Window = `<last-merge>..HEAD`. If no merged PR exists, use the last 20 commits.
4. **State the chosen window in plain English** before generating, especially on any fallback: e.g., "Summarizing commits since `<ref>` (cycle marker found)." or "The cycle marker was missing or stale, so I am summarizing since `<ref>` instead - check that scope looks right." This lets the user catch a wrong window (for example a marker SHA from a different branch) before trusting the summary.

### Decide whether to generate

Inspect `git diff --stat <window>`. If there are **zero meaningful changes** (only whitespace or a single typo fix), skip the HTML but still advance the marker (last step). Otherwise generate the summary.

### Generate the summary

Do NOT hand-write the HTML. Produce a JSON payload matching the schema documented at the top of `.claude/skills/shared/shells/document-shell.html` (read its header comment for the exact fields); the helper injects it into the prebuilt shell. Contents:
- **Files changed by category** (commands, skills, scripts, docs) from `git diff --name-status <window>` -> `filesByCategory`
- **Documentation deltas** - which of README / CLAUDE.md / CHANGELOG / LESSONS changed, one line each -> `docDeltas`
- **PR link** - the PR from Section 6 (worktree runs), else the most recent PR (`gh pr list`), else omit -> `prLink` / `prNote`
- **Mini commit chart** - commits per day across the window, from `git log --format=%ad --date=short <window>` -> `commitChart` (the shell renders the inline bars)

Write the JSON to a temp file, then run the helper from the project root (it computes the timestamped name, creates `artifacts/html/`, overwrites freely, and prints the output path):

```
node .claude/scripts/render-html.js --shell document --name document --data /tmp/document-data.json
```

Open the printed path per the "Opening the Artifact" rules in `.claude/rules/html-outputs.md`: `bash .claude/scripts/open-artifact.sh "<printed-path>"`. You do not name, read, or clean up any prior file - the helper handles naming and overwrites.

### Advance the marker (LAST step)

After the HTML is written (or deliberately skipped), write the current `HEAD` SHA to `artifacts/html/.last-cycle`, overwriting the previous value.

**This must be the final action of `/document`.** The marker is a high-water mark meaning "every commit up to here is already summarized." Writing it last guarantees that an interrupted run re-summarizes the same window (a harmless duplicate) rather than skipping work permanently. Never write the marker before the summary exists.
