# Merge Rules (landing worktree PRs)

Shared reference for `/merge`, `/document`, `/worktree`, and the branch-rename step in `/explore` and `/create-plan`. It defines the formats they share; `.claude/scripts/merge-check.js` implements every part a machine can decide. Call sites point here; they never restate it.

## Why

A branch is blind to what lands on main after it was cut. A conflict fix made while landing it can drop that work, or its own, and a squash or a rebase hides the fix from history (issue #232: in the replays, one whole-file "keep mine" fix dropped 9 lines of two earlier landings, including changes that never conflicted). So every landing is checked, keyed on the branch's cut point.

## The cut point

The commit a branch was cut from.

- **Recorded, never computed.** When a branch is created or renamed for its issue, run `node .claude/scripts/merge-check.js --record-cut [<branch>]` (M16). It writes `branch.<name>.tkCut` to the repository's git config when the setting is absent, taken from git's branch log (its "Created from" entry), else from the merge-base with main, and prints JSON with `cut` and `source`. `git branch -m` carries the setting with the branch. Updating a branch from main, or rebasing it, moves git's merge-base past every line the branch never saw, so a merge-base found at landing time hides exactly the losses this check exists to catch.
- **Lookup order** for an open branch (`--cut <branch>`): the branch's `tkCut`, then the PR body's `Cut from:` line, then the branch log, then the merge-base with main, reported as `weaker`. A branch log entry created from a remote-tracking ref is a fetched copy of someone's branch, not a cut, and is skipped.
- **It travels.** `/document` writes it into the PR body, and `/merge` writes it into the landing commit message, so it outlives the branch, the worktree and a squash.
- **A cut that is not on main** means the branch was cut from another branch, and landing it would land that branch's commits too. The check flags it as `cut`, and the landing stops.

## The default branch

`merge-check.js` takes `--main <ref>`; without it, the remote's default branch, as the local branch when one exists, else `main`, else `master`. A landing made on this machine uses the local branch. A host landing passes `--main origin/<branch>` after a fetch, because the host's copy is the one that moves.

## What counts as a landing

A first-parent commit on main is a landing when it has two parents (a merge), when its message has a `Cut from:` line (a squash `/merge` made), or when GitHub's merge button committed it (committer `noreply@github.com`: a subject ending in `(#<number>)` is a squash, anything else part of a rebase). Every other commit is a direct commit: it saw all of main and is never checked. A GitLab button squash looks like a direct commit and is not seen.

A landing's cut comes from its `Cut from:` line. A merge without one uses the merge-base of its parents, reported `weaker`. A squash or rebase without one is reported `not checkable` for rule 1, and `/merge` then reads the PR body's `Cut from:` line and reruns that landing with `--landing`. A squash or a rebase keeps no branch tip, so its rule 2 cannot be checked after the fact.

## The checks

- **Rule 1:** a line another landing added to main after the cut, which this landing removes.
- **Rule 2:** a line the branch itself added that does not make it into the landing. Copies are counted per file: against git's own merge where the file merges cleanly (so a line both sides added identically counts once), and as main's copies plus the branch's minus the common ancestor's where it conflicts (so a dropped `}` is caught even when another `}` remains).
- **Cut:** the cut is not on main.
- **Rule 3:** a decision of this PR that contradicts one a landing after its cut made, in the same file or another (one says go right, the other go left). The `decision-checker` agent judges it from the decisions file below; it is the one check that is judgment, and it runs at landing only.
- **Deleted and untracked** are listed, never flagged: the files a landing removes from main, and among them the ones the branch's own `.gitignore` files ignore at the landing. A branch that stops tracking a file it means to keep (`git rm --cached` and an ignore line) still deletes every other checkout's copy when the landing reaches it, so `/merge` saves that copy first and puts it back.

`merge-check.js` exits 0 when nothing is flagged, 1 when anything is, and 2 on a usage or git error; each flag is one plain line on stderr. Paths in `.claude/toolkit/generated.json` are skipped. A conflict combined correctly (a new line that keeps both sides' intent) still flags both original lines: a combined line is a judgment, and you confirm it by keeping them on purpose. `weaker` and `not checkable` are notes, never flags, and a gate fails on flags only.

## The PR body parts

`/document` writes these into a PR it opens from a worktree, after its summary, with these exact headings and in this order:

    ## Decisions
    - <decision> - <why>

    ## Changelog
    ````markdown
    <the block /document wrote to CHANGELOG.md, byte for byte>
    ````

    Cut from: <full sha that merge-check.js --cut printed>

`## Decisions` lists the plan's Critical Decisions, or `- None recorded` when the cycle had no plan. The changelog fence is four backticks, or one more than the longest run of backticks inside the block; the part is left out when the cycle wrote no changelog block. `node .claude/scripts/merge-check.js --pr <N>` (or `--pr-body <file>`) reads the parts back as JSON (`decisions`, `changelog`, `cutFrom`, each null when absent). The decisions are the part's list lines only, from its first list line (with indented continuation lines, and blank lines between items) to the first line that is neither, so an attribution line below the list is not read as a decision. `--pr` also prints `ref`, the host's full reference on GitLab (`<project path>!<number>`), null on GitHub. A PR opened before these parts existed has none, and `/merge` falls back: the branch log or merge-base for the cut, the PR's text and diff for its decisions, and its own changelog edit kept with both sides.

## The landing commit message

    <subject>

    <the PR title, as one line>

    Decisions:
    - <each decision from the PR body>

    Cut from: <full sha>
    Kept on purpose: <sha> <file>: <line>
    See merge request <ref>

The subject is `Merge PR #<N>: <title>` for a merge commit and `<title> (#<N>)` for a squash; a branch landed without a PR names the branch, `Merge <branch>: <title>`. `Kept on purpose:` lines appear only when you kept a flagged line. `See merge request <ref>` ends a GitLab host-merge message, with the `ref` `merge-check.js --pr` printed: GitLab's merge button writes that line, and `--style` reads it, so a landing `/merge` made through GitLab is not later read as a local merge.

## The decisions file

`node .claude/scripts/merge-check.js --decisions --cut <sha> --tip <sha> --out <file> [--pr <N> | --pr-body <file>]` writes the one file the `decision-checker` agent reads: a `## This PR` part, then one `## Landing <short sha>: <subject>` part per landing on main after the cut, oldest first. A part holds its decision list, from the PR body's `## Decisions` part or a landing message's `Decisions:` lines. A part with none (a PR opened before these parts existed, a list that says `None recorded`, a landing made without `/merge`) holds its text and its changes instead, generated paths left out and cut at 150 lines. A commit made straight on main is not a landing and gets no part; rule 1 still covers its lines. With no landing after the cut there is nothing to contradict, and the agent is not dispatched. Each diff in it is word by word (`git diff --word-diff=plain`), and the file says so at its top: `[-...-]` is text that part removed and `{+...+}` text it added. Unmarked text was already there, so text a landing only carried over is not read as its decision.

## Kept on purpose

A flagged line you accept is recorded as

    Kept on purpose: <short sha of the commit that added the line> <file>: <line text>

copied exactly from the flag's `keep` field. It may stand in the landing commit message, or after the fact in any later commit message on main's first-parent line: the next landing's message, or an empty commit that only records acceptances (`git commit --allow-empty`). `merge-check.js` reads every such line on main and suppresses exactly the matching flag; a same-text line that another commit added stays flagged.

## Changelog placement

In a worktree, `/document` writes its changelog block to the branch's `CHANGELOG.md` as before and copies it into the PR body. When `/merge` updates the branch, it takes main's `CHANGELOG.md` and re-inserts the block, as its own commit, before the line that `merge-check.js --changelog-place CHANGELOG.md <block file>` prints:

- a block that opens with its own `## ` heading goes directly above the file's first `## ` section, so the newest entry is on top and never inside a released version;
- a block of bare entries goes directly below an `## Unreleased` heading;
- with neither anchor, after the title and the blank lines under it.

Rule 2 then confirms that every line of the block landed.

## Generated files

`.claude/toolkit/generated.json` lists the files a project rebuilds rather than merges, and the command that rebuilds them:

    [{ "paths": ["plugin/"], "rebuild": "node scripts/build-plugin.js" }]

A path is a repository path (a folder ends in `/`). `rebuild` is one command, run from the project root as an ordinary command under your permission rules, never inside the check script. On a conflict, a generated path takes main's side and is rebuilt after the other fixes.

## The marker and the style

`merge-check.js --mark <sha>` records the last landing checked (`tk.landingChecked` in git config) and `--marker` reads it; `/merge` checks every landing after the marker before landing more. `--style` reads the repo's landing habit from its last 50 first-parent commits, unless `tk.mergeStyle` records one: `local-merge` (merge commits made on this machine), `host-merge` (merge commits the host's button made: GitHub's `noreply@github.com` committer, or GitLab's `See merge request` line), `host-squash` (squashes, the host's or `/merge`'s; a rebase habit counts here too, because a rebase leaves no landing commit to carry the record), or `unknown`. `--style local-merge`, `--style host-merge` or `--style host-squash` records the answer to the one-time question.
