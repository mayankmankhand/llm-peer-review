# Update Documentation Task

**Use this when:** Updating README, CLAUDE.md, CHANGELOG, LESSONS, or INDEX after code changes have shipped.
**Don't use this when:** You only need in-code docstrings or comments (just edit the code directly), or you are mid-implementation - wait until the work is done.

You are updating documentation after code changes. Run the steps automatically, receipts required: every claim of work done carries its evidence per M8, and the run ends with a short digest of what was updated, committed, and pushed. The auto loop's operating rules live in `.claude/skills/shared/hitl-loop.md` (rule IDs M1-M15). Saying **"report only"** on this run restores the confirm-first flow for that run (M10).

## Primary Documentation Files

- **CLAUDE.md** - Project-specific instructions: tech stack, preferences, team info (user-owned)
- **README.md** - Project overview for humans
- **LESSONS.md** / **LESSONS-detail.md** - Learning log (user-owned): `LESSONS.md` is the one-line index Claude reads each session, `LESSONS-detail.md` holds the full write-ups it opens on demand
- **DESIGN-PROFILE.md** - The repo's design answers (user-owned): design system state, allowed variance, taste notes, directions tried, prompts to retry. Read by `/explore` and `/execute`; written by `/explore` and this command (see `.claude/skills/shared/design-rules.md`)
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
- **LESSONS.md** / **LESSONS-detail.md** - Read the current lesson index (`LESSONS.md`) first so nothing gets duplicated, then auto-draft this session's lessons and write them per M8: each entry carries its receipt (what happened, where). Capture a lesson when Claude repeated a mistake, a review caught something Claude should have known, or the user typed the same correction twice. When adding one, write the one-liner to `LESSONS.md` (under the right section) AND the full write-up to `LESSONS-detail.md` (same bold lead). Then do a quick cleanup pass: dedupe near-duplicate lessons, mark superseded ones, and keep the index short.
- **DESIGN-PROFILE.md** - When this cycle ran a design step, append each direction tried (name, seed, best critic score, kept or dropped) under Directions tried, and each brief that failed under Prompts to retry on newer models, each with its receipt per M8 (the plan's Outcomes and the design digest). Taste notes are written by `/explore` as they happen; do not duplicate them here.
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

## 6. Capture Corrections (the ledger)

Records the times the user stepped in during this cycle, so the toolkit can eventually
count what it keeps getting wrong instead of fixing each instance and forgetting it.
Issue #157. Full rationale in `.claude/rules/toolkit.md`.

**Containment rule, read this before running anything below.** This stage is the only
place in the toolkit that pulls near-verbatim fragments of what the user typed into
context. Those fragments - the `human_said` and `assistant_said` text in the candidate
list, and the `produced` and `correction` fields you draft from them - **stay in this
stage.** They never enter:

- the Section 9 cycle summary or its JSON payload, and never any HTML artifact or
  published page
- a commit message or a PR body
- `LESSONS.md` or `LESSONS-detail.md`
- `/ask-gpt`, `/ask-gemini`, `/peer-review`, or any other external model

Only counts and the user's own open codes may cross that line. This matters because
Section 9 of this same command publishes to a hosted URL without asking anyone (a
private claude.ai page is not an outward send under M9), so nothing downstream would
ever stop this text from leaving the ledger. There is no exception and no "ask the user
first" path: a summary of the data is still the data.

This complements the LESSONS work in Section 3 rather than repeating it. A lesson is a
judgment worth remembering; a ledger row is one data point. The lesson rule in Section 3
already says to capture when "the user typed the same correction twice" - this is what
makes that countable instead of remembered.

### Find the candidates

```bash
node .claude/scripts/correction-ledger.js --candidates
```

A deterministic pre-filter, no model involved. It reads this project's session
transcripts, excludes subagent transcripts, and windows to everything since this repo
last captured. It removes machine text and bare acknowledgments and keeps everything
else: the filter deliberately does not try to guess which turns were corrections,
because a candidate wrongly dropped here is invisible to every later step.

**If `optedOut` is true, stop.** The repo has `.claude/.no-correction-log` and nothing is
recorded. Say nothing.

**If `scanned` is false, stop here and record NO heartbeat.** The script could not find a
transcript directory for this project, so nothing was examined. Recording a heartbeat
would permanently certify a scan that never ran, and `/error-analysis` would later tell
the user capture had run and found nothing. Say one line: capture could not find this
project's transcripts, so nothing was scanned.

**If `scanned` is true and `candidates` is empty, skip to "Record the heartbeat" and say
nothing to the user.** The stage is silent when there was genuinely nothing to capture.

### Explain it, the first time only

When `everCaptured` is false, this is the first capture in this project. Before showing
anything, tell the user in a few lines:

- Every time they corrected Claude or asked for something different, that becomes one row.
- Only their own interventions are recorded. Reviews are not: those already go to LESSONS.
- The data lives at `~/.claude/`, per machine, and never leaves it. It is never published
  and never sent to another model.
- They can turn it off for this repo with `touch .claude/.no-correction-log`.

Nobody reads a rules file to discover a feature they do not know exists, so this is the
primary way the feature introduces itself. Say it once, then never again in this project.

### Read the candidates cold

Dispatch the `correction-extractor` agent (`.claude/agents/correction-extractor.md`) with
the candidate list. It has no memory of this session, which is the point: a participant
has a stake in reading a correction as a clarification, the same reason the M2 audit never
lets anything judge its own output.

Pass it the candidates JSON and nothing else. Do not summarize the session for it, and do
not tell it what you think happened.

### Confirm every open code with the user

Show the drafted rows: for each one, what it thinks happened and the open code it wrote.

**Nothing is written until the user accepts it.** They can accept, rewrite the open code in
their own words, or drop the row. Their wording is better than a paraphrase, and their
words are the entire value of the data: an open code Claude wrote about Claude's own
mistake is a different and weaker kind of evidence.

Keep this short. A list they can scan and correct, not a report.

### Append what they accepted

Write the accepted rows to a temp JSON array under a name unique to this session, then append them. Two parallel sessions must never share the file: the script deletes it after a successful `--add`, so a shared name lets one session eat the other's rows (holistic review, R21).

```bash
node .claude/scripts/correction-ledger.js --add --data /tmp/correction-rows-<session>.json
```

`<session>` is the `session` value the `--candidates` output carried for this cycle; any token unique to this session works.

The script derives `repo`, `repo_path`, and `kind` itself, so those cannot be got wrong
from here, and it hard-truncates the private fields. It accepts the `at` you pass, but
only after checking it is a real ISO timestamp, falling back to now if it is not.

### Record the heartbeat (always)

```bash
node .claude/scripts/correction-ledger.js --heartbeat --candidate-count <N> --added-count <M>
```

**Run this even when nothing was captured**, as long as `scanned` was true. It is what
separates "capture has never run here" from "capture ran and found nothing", and without
it an empty ledger silently looks like a user who never corrected anything. The one case
where you do NOT run it is the `scanned: false` branch above: a heartbeat there would
claim a scan that never happened, which is the same lie in the opposite direction.

Do not run `/error-analysis` from here. Grouping and ranking is a deliberate, user-triggered
step, and it needs more rows than one cycle produces.

## 7. Commit and Push

- **Commit** the documentation updates automatically: one checkpoint commit per logical unit, per M4. Follow the commit message conventions in toolkit.md.
- **Push** behind the M11 tripwire: run `node .claude/scripts/pre-push-check.js` and follow M11's exit-code consequences (`.claude/skills/shared/hitl-loop.md`).

This covers every push in this command, including the branch push in Section 8.

**Host CLI (used by Sections 8 and 9).** Both sections call the issue/PR CLI, but Section 8 is skipped when you are not in a worktree while Section 9 always runs. Detect the host here, outside that conditional, and reuse the result in both.

!`cat .claude/skills/shared/host-cli.md`

## 8. Worktree Cleanup

Detect if you're in a worktree: compare `git rev-parse --git-dir` with `git rev-parse --git-common-dir`. If they differ, you're in a worktree.

**If NOT in a worktree** - skip this section entirely.

**If in a worktree:**

Run the steps below automatically, attaching a receipt to each per M8 (what ran, plus the evidence: command output, count delta, diff stat). The receipts land in the end-of-run digest. Three steps are deliberate exceptions that still ask the user: step 1 (uncommitted changes - their intent is a fact only the user holds, M1), step 3 (branch naming), and step 6 (removing a worktree folder sits next to the M9 data-deletion gate). In step 4, showing the PR draft is an announcement, not a wait.

1. Run `git status`. If there are uncommitted changes, ask the user whether to commit them before proceeding. Follow the commit message conventions in toolkit.md (start with a verb, under 50 characters). Do not continue with uncommitted work.
2. Push the branch to the remote.
3. If the branch name does not match `worktree-<number>-<label>`, ask the user: "Your branch still has its default name. Want to rename it before creating the PR?" Follow the worktree naming convention in toolkit.md if they say yes.
4. Draft a PR title and body summarizing the branch's changes. Show it to the user for review, then create the PR using the **"Create PR / MR" row** for the detected host. Take the command from that row rather than from memory: the base-branch flag and the body flag are both named differently on GitLab.
5. Show the user the PR URL.
6. Ask the user: "Want me to delete this worktree? The branch and PR will stay - only the local folder is removed."
7. If they say yes, run `git worktree remove <worktree-root-path>` from outside the worktree directory. If removal fails due to untracked files (build artifacts, .env.local, etc.), let the user know they can clean up manually or use `--force`.
8. The branch stays alive on the remote until the PR is merged or closed. To re-create the worktree later if fixes are needed: `git worktree add <path> <branch-name>`.

## 9. Cycle Summary (HTML, default-on)

Generate a one-page HTML summary of what shipped this cycle. Runs on every `/document`, per `.claude/rules/html-outputs.md` (default-on).

### Determine the cycle window

The "cycle" is everything since the last `/document` run, tracked by a marker file.

1. Read `artifacts/html/.last-cycle` (a single line: the last summarized commit SHA).
2. **If the marker exists** and the SHA is still in history: window = `<marker>..HEAD`.
3. **If the marker is absent** (first run / fresh clone) **or the SHA is missing** (rebased/force-pushed, or the marker belongs to a different branch after a worktree switch): fall back to the last merged PR's merge commit, using the **"Most recently merged"** fenced block for the detected host (or the most recent merge in `git log` if that CLI call fails). Run it exactly as written there: it sorts on the merge date on purpose, because taking the first row of a merged list sorts by CREATION date on BOTH hosts and hands back a stale PR that was opened long ago and merged late. Window = `<last-merge>..HEAD`. If no merged PR exists, use the last 20 commits.
4. **State the chosen window in plain English** before generating, especially on any fallback: e.g., "Summarizing commits since `<ref>` (cycle marker found)." or "The cycle marker was missing or stale, so I am summarizing since `<ref>` instead - check that scope looks right." This lets the user catch a wrong window (for example a marker SHA from a different branch) before trusting the summary.

### Decide whether to generate

Inspect `git diff --stat <window>`. If there are **zero meaningful changes** (only whitespace or a single typo fix), skip the HTML but still advance the marker (last step). Otherwise generate the summary.

### Generate the summary

Do NOT hand-write the HTML. Produce a JSON payload matching the schema documented at the top of `.claude/skills/shared/shells/document-shell.html` (read its header comment for the exact fields); the helper injects it into the prebuilt shell. Contents:
- **Files changed by category** (commands, skills, scripts, docs) from `git diff --name-status <window>` -> `filesByCategory`
- **Documentation deltas** - which of README / CLAUDE.md / CHANGELOG / LESSONS changed, one line each -> `docDeltas`
- **PR link** - the PR from Section 8 (worktree runs), else the most recent PR via the **"Most recent PR / MR (URL)" row** for the detected host (the URL field is named differently on each host, so read it off that row), else omit -> `prLink` / `prNote`
- **Mini commit chart** - commits per day across the window, from `git log --format=%ad --date=short <window>` -> `commitChart` (the shell renders the inline bars)

Write the JSON to a temp file, then run the helper from the project root (it computes the timestamped name, creates `artifacts/html/`, overwrites freely, and prints the output path):

Check the publish gate first (see **"Render for the viewport"** in `.claude/rules/html-outputs.md`): if this session can publish, add `--no-abs` to the command below.

```
node .claude/scripts/render-html.js --shell document --name document --data /tmp/document-data.json
```

You do not name, read, or clean up any prior file - the helper handles naming and overwrites. Then show it to the user per the **"Viewing the Artifact"** rules in `.claude/rules/html-outputs.md`: publish is the primary viewport, the local open is the fallback, and that section holds the whole decision. Pass `--no-abs` to the render above when this session can publish.

### Advance the marker (LAST step)

After the HTML is written (or deliberately skipped), write the current `HEAD` SHA to `artifacts/html/.last-cycle`, overwriting the previous value.

**This must be the final action of `/document`.** The marker is a high-water mark meaning "every commit up to here is already summarized." Writing it last guarantees that an interrupted run re-summarizes the same window (a harmless duplicate) rather than skipping work permanently. Never write the marker before the summary exists.
