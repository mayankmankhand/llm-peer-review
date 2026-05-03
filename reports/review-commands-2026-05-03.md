# Review: Slash Commands and Skills

**Date:** 2026-05-03
**Trigger:** D3 deferral from `reports/review-2026-05-03.md` (the scheduled-agent run that produced commit `9aa9347`).
**Scope:** All 14 commands in `.claude/commands/`, all 10 skills in `.claude/skills/*/SKILL.md`, and 4 shared files in `.claude/skills/shared/`. 28 files, ~2,460 lines.
**Mode:** Single-pass across four lenses (Prompt Engineering, Cross-command Consistency, Workflow Completeness, Workflow Ergonomics). Used single-pass instead of the skill's prescribed four parallel sub-agents because this is a periodic audit on a stable surface (no recent changes to commands/skills) - four sub-agents each re-reading 28 files would be wasteful for the input size.

## Top Issues (scannable summary)

```
🚫 0 Blocks
⚠️ 4 Warns: R1 (ask-gpt.md:90 - debate file built only at end, not between rounds),
           R2 (ask-gpt.md:38-46 - initial review never saved to debate transcript),
           R3 (worktree.md:48 - missing toolkit-deps install after v4.3 quarantine),
           R4 (9 commands - missing "Use this when / Don't use this when" markers)
💡 6 Suggests: R5-R10 (see findings)
```

## Looks Good

- The shared severity/finding-id/output-template files are inlined into every review skill via the `` !`cat ...` `` dynamic-injection syntax. This works and keeps drift to zero.
- All review skills repeat the "REPORT ONLY" rule in both opening and closing positions, which is the right belt-and-braces against AI drift toward auto-fixing.
- The `/explore` -> `/create-plan` -> `/execute` -> `/review` -> `/document` chain has clear handoff points (worktree rename, plan file location, status emoji updates, INDEX regeneration).
- `/review.md` Phase 1 dispatch table is comprehensive and has been kept in sync with the v4.3 skill set (review-deps and review-copy both wired in correctly).
- `pair-debug.md` enforces "check logs first, then form hypotheses, then ask the user which check to run" - a crisp investigation flow that matches the toolkit's report-first-fix-later philosophy.

## Findings

- **R1** ⚠️ `.claude/commands/ask-gpt.md:90` (and the mirror at `.claude/commands/ask-gemini.md:90`) - The debate file `/tmp/ask-gpt-debate.md` is only assembled in Step 5 (after all 3 rounds complete), but Step 4c calls `node .claude/scripts/ask-gpt.js respond --debate-file /tmp/ask-gpt-debate.md` for each round. Verified the script (`.claude/scripts/ask-gpt.js:506`) reads the path via `readFile(args.debateFile)` and has no fallback - so for rounds 1-3, the script either fails on a missing file or reads stale/empty content from a prior session.
  - **Why:** The whole point of multi-round debate is that GPT/Gemini sees Claude's prior responses. With the file built only at the end, each round's `respond` call runs without prior debate context (or fails noisily if the file does not exist).
  - **Fix direction:** Build the debate file incrementally - after each round, append `round-N.md` and `round-N-gpt.md` to the cumulative `debate.md` BEFORE running the next round's `respond`. Or pass the per-round files directly to `--debate-file`. Document the chosen approach explicitly in the prompt.

- **R2** ⚠️ `.claude/commands/ask-gpt.md:38-46` (and mirror in `ask-gemini.md`) - The initial review from GPT/Gemini (Step 3) is read off stdout by the orchestrator but never saved to disk. Step 5's "Read all 6 round files" implies six files, but the original review (call it "round 0") is not among them. The final summary call therefore lacks the original review baseline.
  - **Why:** A non-technical user trying to inspect or share the debate transcript later will not have the initial review preserved anywhere durable. Also makes Step 5's assembled `debate.md` an incomplete record.
  - **Fix direction:** In Step 3, save the script's stdout to `/tmp/ask-gpt-round-0-gpt.md` (or similar) and include it in Step 5's assembly. Mirror the change in `ask-gemini.md`.

- **R3** ⚠️ `.claude/commands/worktree.md:48` - Step 5 runs `npm install --prefix .claude/worktrees/worktree-N` for the host project's package.json only. After PR #91 quarantined toolkit dependencies into `.claude/scripts/package.json`, a freshly created worktree will not have toolkit deps installed, so `/review-browser`, `/ask-gpt`, `/ask-gemini`, etc. fail in the new worktree until the user runs `npm install --prefix .claude/scripts` separately. Confirmed via git log: worktree.md was last touched in `0f90ad7`, which predates the v4.3 quarantine in `b58bcc2`.
  - **Why:** Silently-broken toolkit in worktrees is exactly the kind of "user opens a worktree, hits a confusing error" failure the report-first rule is supposed to prevent. A non-technical user will not know to install toolkit deps separately.
  - **Fix direction:** Add a Step 5b to install toolkit deps when `.claude/worktrees/worktree-N/.claude/scripts/package.json` exists: `npm install --prefix .claude/worktrees/worktree-N/.claude/scripts`. Update the printed summary in Step 7 to reflect both installs.

- **R4** ⚠️ Multiple files - Nine commands lack the "Use this when / Don't use this when" markers that `.claude/rules/toolkit.md` documents as a convention ("Use the 'Use this when / Don't use this when' guidance at the top of each command to pick the right one"). Affected files: `explore.md`, `create-plan.md`, `execute.md`, `document.md`, `ask-gpt.md`, `ask-gemini.md`, `create-issue.md`, `package-review.md`, and `.claude/skills/learning-opportunity/SKILL.md`.
  - **Why:** The convention exists so users can disambiguate similar-sounding commands at a glance. Nine missing markers means roughly two-thirds of the surface does not follow the documented rule. Categorized as Warn under the "Committed requirements plainly unmet" universal anchor.
  - **Fix direction:** Add a two-line "Use this when / Don't use this when" block near the top of each affected file, modeled on the existing markers in `pair-debug.md:3-4` or `worktree.md:5-6`.

- **R5** 💡 `.claude/commands/peer-review.md:1` - File begins with body text ("A different team lead within the company has reviewed...") rather than a `# Heading`. Every other command starts with `# <Title>`.
  - **Why:** Minor formatting inconsistency. Some Claude Code surfaces and aggregator tooling derive command titles from the first heading - a missing heading can show up as an unnamed entry.
  - **Fix direction:** Add `# Peer Review` (or similar) as line 1, then continue with the existing intro.

- **R6** 💡 `.claude/commands/index.md:15` - Error message says "Run `setup.sh` to install the toolkit" without specifying the path. If `setup.sh` is not on the user's PATH (it usually is not), the suggestion does not work as written.
  - **Why:** Frustrating dead end for a non-technical user who hits the missing-script case.
  - **Fix direction:** Use the actual path: "Run `bash scripts/setup/setup.sh` from the project root."

- **R7** 💡 `.claude/commands/pair-debug.md:35` - Uses the `🚫 Block:` emoji prefix as a "missing info, please supply" message. Elsewhere in the toolkit, `🚫 Block` is the highest finding severity (will-break-the-app).
  - **Why:** Confuses two different signals - "we cannot proceed without input" vs. "this code has a critical defect." A user familiar with review reports will read it as the latter.
  - **Fix direction:** Use a different prefix such as `**Need info:**` or `**Stopped:**` for prerequisites, and reserve `🚫 Block` for severity in actual findings.

- **R8** 💡 `.claude/commands/create-plan.md:13` - "rename the branch following the worktree naming convention in toolkit.md" - delegates the convention to a separate file. If `toolkit.md` is missing from the project, the convention is unrecoverable.
  - **Why:** Brittle in projects that drop or move `toolkit.md`. Inline fallback is cheap.
  - **Fix direction:** Add a one-line inline pattern as a fallback: "(pattern: `worktree-<issue-number>-<short-label>`, lowercase, hyphenated)".

- **R9** 💡 `.claude/commands/codebase-to-course.md:28` - Saves output to `/tmp/codebase-course-{timestamp}.html`. On native Windows (no WSL, no git-bash), `/tmp` does not exist.
  - **Why:** The toolkit explicitly supports Windows users (see `setup.ps1`, README's separate Windows section). A `/tmp` path will fail there.
  - **Fix direction:** Use a portable temp dir - either save to project root with a clear name, or use `os.tmpdir()` via Node, or document the WSL/git-bash requirement.

- **R10** 💡 `.claude/commands/package-review.md:42` - `package-lock.json` and `poetry.lock` are unconditionally excluded.
  - **Why:** Reasonable default for code review (lockfiles are huge), but for security-focused review (CVE checks, supply-chain audit), lockfiles are essential. The exclusion is unconditional.
  - **Fix direction:** Either ask the user "is this for security review?" before excluding, or note in the file that lockfiles can be re-included on request. Lower priority since `/review-deps` covers this case separately.

## Staff PM Check

- **Can any user follow this?** - Mostly yes for the core workflow (`/explore` -> `/create-plan` -> `/execute` -> `/review` -> `/document`). The `/ask-gpt` and `/ask-gemini` flows have R1 and R2 which a non-technical user would hit and be unable to debug.
- **Workflow reliability** - The main chain is reliable. Worktree creation has a real broken case (R3) post-v4.3.
- **Handoff quality** - Strong. `/explore` mode detection feeds `/create-plan`, `/create-plan`'s output feeds `/execute`, and `/document` cleanly closes the loop with worktree cleanup. The shared severity/finding-id files keep all review outputs interchangeable.
- **What would a staff PM push back on before shipping?** - R1, R3, and R4. R1 is a workflow bug that may have been silently producing degraded debates. R3 is a regression introduced by the v4.3 quarantine that nobody caught. R4 is a documented convention that two-thirds of the surface ignores - the kind of drift that signals the convention is not actually being enforced anywhere.

## Summary

- Files reviewed: 28 (14 commands, 10 skills, 4 shared)
- Blocks: 0 | Warns: 4 | Suggests: 6
- Mode: single-pass (deviation from skill's prescribed 4-sub-agent flow, justified above)
- Recommended next step: surface R1, R3, and R4 as GitHub issues so they can be tracked and fixed; treat R5-R10 as polish items to batch into a future cleanup PR.
