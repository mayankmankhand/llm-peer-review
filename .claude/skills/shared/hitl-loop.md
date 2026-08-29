# The Auto Loop (Human-in-the-Loop Rules)

Shared reference for every command in the toolkit loop. Inlined via `` !`cat .claude/skills/shared/hitl-loop.md` `` or read directly by orchestrators that dispatch subagents. This file is operational rules only; the rationale and evidence behind every rule live in `docs/HITL-MAP.md`, which settles issue #146 and which this file cites by rule ID (M1 to M13).

The loop runs automatically by default. A human is brought in only where a human changes the outcome. Saying **"report only"** on any run restores report-first behavior for that run (M10).

## The loop at a glance

```
Human:    /explore -> approve the plan
Machine:  /execute -> checkpoint commit per green unit (M4)
          /review: specialists -> dedup -> drop non-issues
                   -> auto-fix survivors -> re-verify (M3, M6)
                      green -> digest with receipts (M8)
                      red after 2 rounds -> revert to last green -> page (M5)
          /document (receipts, M8) -> commit per logical unit
          -> pre-push tripwire (M11) -> push
          -> /index if 10+ commits behind (M12)
Human:    pages only (M1) + always-ask actions (M9)
Opt-out:  "report only" on any run restores report-first for that run (M10)
```

## The three exits

Every finding or event leaves the loop through exactly one exit:

- **Page** - interrupt the human now. Only per the M1 criterion below.
- **Digest** - auto-handled work with receipts attached, read at leisure. Lands in the run's report artifact (the existing `artifacts/html/` convention) and is summarized in chat at end of run.
- **Log** - dropped non-issues. Never fixed, never surfaced unless asked. Recorded in the same report artifact.

**M1. When to page: information locus, not severity.** A finding or event pages only when:

- its truth depends on facts outside the repo that only the user holds: real-world behavior being modeled, actual ship status, the actual reference design, audience fit, personal or business facts, or
- its fix would reverse something the diff or git history shows was deliberately done (M7), or
- a hard stop fired: fix rounds exhausted (M5), an `/execute` blocker unresolved within its retry bound, the pre-push tripwire hit (M11), or an always-ask action reached (M9).

Everything else exits as digest or log. Cap pages at 2-3 per cycle: rank and truncate rather than forwarding everything above a threshold. A truncated page-candidate lands in the digest explicitly marked as needing the user, never silently dropped; always-ask approvals (M9) are exempt from the cap and batch into a single page. Phrase every page as a decision a non-engineer can make: what happened, what the options are, what happens if we ship anyway, and a recommended default.

## Auto-fix mechanics

- **M3. The fixer never verifies.** Trust order for verification signals: a runnable check first, a different model second, a fresh same-model context last. The agent or conversation that produced a fix never declares it verified. In practice: a mechanical finding (a test, build, script exit code, or specific browser action demonstrated it) is re-verified by re-running that exact check, and the check's result is the verdict; a judgment finding (quality, clarity, UX - nothing runnable proves it) is re-verified by one fresh subagent per round, given the finding IDs, the original finding text, each finding's file:line, and the diff of the fixes, and it returns one line per ID - "R3: FIXED" or "R3: NOT FIXED" - plus a one-line receipt.
- **M4. Checkpoint commits.** Commit after each green logical unit. The checkpoint is the undo button that makes auto-fix safe: a bad fix reverts surgically without dragging good work along.
- **M5. Bounded, then revert, then page.** Max 2 fix rounds per finding. Still red after round 2: revert to the last green checkpoint, stop, and page with a 3-line summary of what failed and what was tried. Never a third attempt, never silent continuation. A check that fails then passes on rerun is logged as a finding for the digest, never silently reclassified as green. New findings discovered during re-verification get one follow-up generation: deduped, guarded, fixed, and re-verified once. Anything surfacing after that lands in the digest as an open item for the next run - fix chains never grow unbounded.
- **M6. Re-verify the claim, not the instance.** A finding names one occurrence; what it reports is a claim that can have several. Before declaring a fix done, sweep the touched files for other instances of the same claim. A fix is new work and meets the same evidence bar as the finding that prompted it.
- **M7. Intent-reversal guard.** Before applying a fix, check whether it would restore or undo something the git history or diff shows was deliberately changed or removed. If so, page instead of applying, even when the finding is technically correct.
- **M8. Receipts, not claims.** Digests and documentation state what ran and show the evidence: the command and its output, the count delta, the diff stat. "All N fixed" without receipts is the failure mode, not the report. A doubt closed as "deliberate" carries a pointer to where the human actually decided it; otherwise it stays open.

**Interim note on auditing:** the three-tier audit (M2: receipts, one skeptical pass, three-vote refute for Blocks) is built as its own follow-up issue. Until it lands, the loop uses specialist dedup plus the M3/M5/M6 re-verify mechanics above. Do not describe or invoke audit tiers that do not exist yet.

## Gates and triggers

- **M9. Always-ask actions.** These never auto-apply, no matter which stage reaches them: releases and bumps of this project's own version (dependency version updates are ordinary auto-fixes under the normal loop), edits to prompt files (this repo's own command, skill, and rules files, and their copies in downstream projects alike), deletions of user data, outward-facing sends (anything leaving the machine for a human audience), and force pushes. Hitting one pages for approval - all always-ask items in a run batch into a single approval page, exempt from the M1 cap - while the loop continues processing everything else. This list is short on purpose: rare gates stay meaningful.
- **M10. Opt-out is per-run only.** Saying "report only" on any invocation restores report-first behavior for that run. The next run is auto again. There is no sticky mode: persistent modes drift silently and get forgotten.
- **M11. Pre-push tripwire (interim, prose-run).** Before any push: grep the outgoing diff for secrets (keys, tokens, passwords, private URLs) and diff the settings files (`.claude/settings.json`, `.claude/settings.local.json`) for unexpected permission changes. Silent when clean; a hit blocks the push and pages. A hardened script version ships as its own follow-up issue.
- **M12. `/index` refresh.** Run `/index` automatically when `CODEBASE_MAP.md` is 10 or more commits behind HEAD; skip otherwise. Single-commit drift is noise.

## Stage verdicts and scope

Each command carries its own one-line verdict (human, auto, or human-triggered) next to its pointer at this file; this fragment is the shared mechanics those verdicts rely on. The full verdict table with evidence is in `docs/HITL-MAP.md`.

**M13. Scope.** The auto loop is carried by the toolkit's own rules and skill files, in this repo and in downstream projects that install the toolkit. A user-level `~/CLAUDE.md` outside a toolkit project stays conservative (report-first): projects without the loop's re-verify machinery keep the old behavior.
