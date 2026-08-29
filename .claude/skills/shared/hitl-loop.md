# The Auto Loop (Human-in-the-Loop Rules)

Shared reference for every command in the toolkit loop. Inlined via `` !`cat .claude/skills/shared/hitl-loop.md` `` or read directly by orchestrators that dispatch subagents. This file is operational rules only; the rationale and evidence behind every rule live in `docs/HITL-MAP.md`, which settles issue #146 and which this file cites by rule ID (M1 to M14).

The loop runs automatically by default. A human is brought in only where a human changes the outcome. Stages also hand off to each other automatically (M14): the human types `/explore` and approves the plan. Two per-run opt-outs, deliberately separate: saying **"report only"** restores report-first behavior for that run (M10), and saying **"no chaining"** runs one stage and stops (M14).

## The loop at a glance

```
Human:    /explore
Machine:  /create-plan (chains once the conversation converges, M14)
Human:    approve the plan                       <- the cycle's one gate
Machine:  /execute -> checkpoint commit per green unit (M4)
          /review: specialists -> dedup -> audit (M2) -> kills to log
                   -> report survivors -> auto-fix -> re-verify (M3, M6)
                      green -> digest with receipts (M8)
                      red after 2 rounds -> revert to last green -> page (M5)
          /document (receipts, M8) -> commit per logical unit
          -> pre-push tripwire (M11) -> push -> PR
          -> /index if 10+ commits behind (M12)
Human:    pages only (M1) + always-ask actions (M9)
Chaining: automatic per M14; "no chaining" runs one stage and stops
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

## The audit (M2)

**M2. Three-tier audit before the report.** Deduplicated findings (two specialists reporting the same issue is one finding with more confidence) are audited before the report is written. The report shows survivors only, each with its receipt; every finding the audit kills goes to the log with its verdict line, never fixed.

**Who runs it.** The *runner* is whoever produced the findings and is about to act on them: the `/review` orchestrator after dedup, a directly-typed `/review-*` skill after its own pass, or the session processing a debate's Recommended Actions (`/ask-gpt`, `/ask-gemini`) once the summary is presented. Every runner runs all three tiers. One deliberate exception: `/peer-review`'s evaluation already verifies each external finding against the code, so that evaluation IS its audit step and the tiers are not re-dispatched. A direct run is a deliberate focused check, not a lighter one, and a report that shows an Audited out section must have actually had an audit. The runner executes tier 1 itself and dispatches tiers 2 and 3 to fresh subagents; it never judges its own findings, because a fresh context is the entire thing those tiers buy (M3's trust order, applied at audit time).

1. **Receipts** (every finding, nearly free). Every finding carries a runnable check - a grep, a file read, a test, an exit code - plus one line stating what the check's output must show for the finding to stand. The runner executes the check and compares its output against that line. The output does not show it, or the finding carries no check at all: `RN: RECEIPT FAILED`. Even a judgment finding (quality, clarity, UX) has a mechanical receipt: the file read showing the cited pattern actually exists as described. A browser finding's check is the session evidence already captured - the screenshot path, console output, or network log - and re-reading that capture is its receipt. Do not re-drive the browser before the report: re-running the failing action is M3's post-fix re-verification, not tier 1, and it would blow the session budget.
2. **One skeptical pass** (surviving Warns and Suggests). Dispatch ONE fresh subagent carrying every surviving Warn and Suggest, instructed: "Try to refute each finding using its receipt output. The default prior is rejection: when in doubt, refute. Return exactly one line per ID - `RN: REFUTED` or `RN: STANDS` - plus one line of reasoning each."
3. **Three-vote refute** (surviving Blocks). Dispatch THREE independent skeptics in parallel, each carrying the surviving Blocks with the same refute instruction. Each returns one vote line per Block ID. Two or more refute: `RN: REFUTED 2/3` (or `3/3`) - killed. Otherwise `RN: STANDS`. Blocks skip tier 2: the vote replaces the single pass, so no lone skeptic can kill a Block. Reserved for Blocks because a wrong drop or a wrong page is costliest there, and voting gains plateau.

One verdict line per finding ID per tier, in exactly these formats - countable against the run's real output. The consequence is uniform: `RECEIPT FAILED` and `REFUTED` findings are logged with their verdict line and never fixed; `STANDS` findings proceed to auto-fix under the mechanics below.

**Nothing to audit.** A run that produced no findings skips the tiers entirely: verdict `approve`, no skeptics dispatched, and no Audited out section - an audit with no input proves nothing, and a specialist's quiet one-liner stays quiet.

**Dispatch hygiene:** everything handed to an audit or verify agent is verbatim bytes - the finding's original text or JSON and the receipt's actual output - never a paraphrase or summary. A reviewer can only judge the bytes it is given; a paraphrased finding produces a verdict about the paraphrase, not the artifact.

**Announce before dispatching.** One line before the skeptic tiers fire - "Auditing N findings: one skeptic on the Warns and Suggests, three on the Blocks." - so the extra subagents are never a surprise. The same courtesy M14 requires of stage handoffs.

**Concurrency.** Tier 3's three skeptics dispatch in parallel and fit the 4-subagent cap. The audit runs only after any review sub-agents have returned, so it never competes with them for that cap.

**When an audit subagent fails** (error, timeout, or malformed verdict lines): redispatch it once. Still failing: tier 2 survivors proceed to the report marked `unaudited` next to their Receipt line; a tier 3 vote left with two valid ballots kills the Block only when both refute - a majority of the dispatched three is never assumed.

## Auto-fix mechanics

- **M3. The fixer never verifies.** Trust order for verification signals: a runnable check first, a different model second, a fresh same-model context last. The agent or conversation that produced a fix never declares it verified. In practice: a mechanical finding (a test, build, script exit code, or specific browser action demonstrated it) is re-verified by re-running that exact check, and the check's result is the verdict; a judgment finding (quality, clarity, UX - nothing runnable proves it) is re-verified by one fresh subagent per round, given the finding IDs, the original finding text, each finding's file:line, and the diff of the fixes, and it returns one line per ID - "R3: FIXED" or "R3: NOT FIXED" - plus a one-line receipt.
- **M4. Checkpoint commits.** Commit after each green logical unit. The checkpoint is the undo button that makes auto-fix safe: a bad fix reverts surgically without dragging good work along.
- **M5. Bounded, then revert, then page.** Max 2 fix rounds per finding. Still red after round 2: revert to the last green checkpoint, stop, and page with a 3-line summary of what failed and what was tried. Never a third attempt, never silent continuation. A check that fails then passes on rerun is logged as a finding for the digest, never silently reclassified as green. New findings discovered during re-verification get one follow-up generation: deduped, guarded, fixed, and re-verified once. Anything surfacing after that lands in the digest as an open item for the next run - fix chains never grow unbounded.
- **M6. Re-verify the claim, not the instance.** A finding names one occurrence; what it reports is a claim that can have several. Before declaring a fix done, sweep the touched files for other instances of the same claim. A fix is new work and meets the same evidence bar as the finding that prompted it.
- **M7. Intent-reversal guard.** Before applying a fix, check whether it would restore or undo something the git history or diff shows was deliberately changed or removed. If so, page instead of applying, even when the finding is technically correct.
- **M8. Receipts, not claims.** Digests and documentation state what ran and show the evidence: the command and its output, the count delta, the diff stat. "All N fixed" without receipts is the failure mode, not the report. A doubt closed as "deliberate" carries a pointer to where the human actually decided it; otherwise it stays open.

## Gates and triggers

- **M9. Always-ask actions.** These never auto-apply, no matter which stage reaches them: releases and bumps of this project's own version (dependency version updates are ordinary auto-fixes under the normal loop), edits to prompt files (this repo's own command, skill, and rules files, and their copies in downstream projects alike), deletions of user data, outward-facing sends (anything leaving the machine for a human audience, except a pull request opened by `/document` at the end of a chained cycle - its plan was human-approved and its push already cleared M11), and force pushes. Hitting one pages for approval - all always-ask items in a run batch into a single approval page, exempt from the M1 cap - while the loop continues processing everything else. This list is short on purpose: rare gates stay meaningful.
- **M10. Opt-out is per-run only.** Saying "report only" on any invocation restores report-first behavior for that run. It governs the fixing, not the audit: the M2 audit still runs before the report, so a report-only report is still survivors plus the Audited out log; what stops is the auto-fixing that would follow. The next run is auto again. There is no sticky mode: persistent modes drift silently and get forgotten.
- **M11. Pre-push tripwire.** Before any push, run `node .claude/scripts/pre-push-check.js` from the project root. It scans every outgoing commit's added lines for secrets (keys, tokens, private URLs), blocks never-push files (`.claude/settings.local.json`, `.env`, `.env.local`), and surfaces any `.claude/settings.json` change riding in the push. Consequences by exit code: 0 = clean, push without ceremony. 1 = hit, the push is blocked and the report pages the human; only the human can say "push anyway". 2 = the script could not check; treat a missing script (older install) the same: fall back to running the same three checks by hand - grep EACH outgoing commit's diff for secrets (not the endpoint diff alone, which hides a secret added in one commit and removed in a later one), confirm no never-push file (`.claude/settings.local.json`, `.env`, `.env.local`) is newly introduced by any outgoing commit, and diff `.claude/settings.json` across the outgoing range - and never push unchecked.
- **M12. `/index` refresh.** Run `/index` automatically when `CODEBASE_MAP.md` is 10 or more commits behind HEAD; skip otherwise. Single-commit drift is noise.

## Stage verdicts and scope

Each command carries its own one-line verdict (human, auto, or human-triggered) next to its pointer at this file; this fragment is the shared mechanics those verdicts rely on. The full verdict table with evidence is in `docs/HITL-MAP.md`.

**M13. Scope.** The auto loop is carried by the toolkit's own rules and skill files, in this repo and in downstream projects that install the toolkit. A user-level `~/CLAUDE.md` outside a toolkit project stays conservative (report-first): projects without the loop's re-verify machinery keep the old behavior.

**M14. Stage chaining.** Stages hand off to each other automatically. The human types `/explore` and approves the plan; the four transitions below fire on their own, each behind a brake.

1. **`/explore` -> `/create-plan`**, only when the conversation has converged. Converged is countable against whichever closing summary the run produced, and the full mechanics live here so no call site has to invent them:
   - **The open-question field must be empty.** The vision-mode closing summary calls it "Open questions"; the Phase 2 summary calls it "Remaining questions". Either way, non-empty means stay in the conversation.
   - **In vision mode the scope dial must also read `Hold` or `Reduce`.** Mode is sticky, so a vision run that accepted Phase 2 still carries this condition. `Expand` means do not chain.
   - **If the dial was never offered** (it is conditional on a direction emerging, so a short session may never reach it): treat a summary naming exactly one direction as `Hold`; if it names more than one, offer the dial now and wait for the answer.
   - **When the gate does not pass**, say which condition failed and name the next step: answer the open question, or say "plan it anyway" to chain regardless. Never end an exploration without a next step.
2. **`/create-plan` -> nothing.** The plan is presented and the chain stops. Plan approval is the cycle's one human gate, so `/execute` is never invoked automatically, however clear the plan looks. This is the loop's one deliberate non-chaining handoff; it is stated so it stays deliberate rather than drifting into a chain.
3. **`/execute` -> `/review`**, only on a clean finish: every step green and its checkpoint commit made. No chain when the critical-blocker path fired, or when a step exhausted its 3-attempt retry bound - chaining past a hard stop reviews work that was never finished.
4. **`/review` -> `/document`**, only when the loop settled. Do not chain while a hard stop is still **open**: an M5 revert to the last green checkpoint, an unresolved `/execute` blocker, an M11 tripwire hit, or any page still waiting on the human's answer. An M9 approval the human has already **granted** does not block - those batch and the loop continues past them by design (M9), so a cycle that edited prompt files still chains once the approvals are in. Reading this as "any page ever raised" would kill the chain on every prompt-file cycle, which is most of them. A cycle summary written over a reverted state is exactly the bookkeeping drift M8 exists to prevent.

`/document` ends the chain; it already triggers `/index` per M12. Only the orchestrated `/review` chains: a directly-typed `/review-*` specialist run is a deliberate focused check and does not chain into the next stage - its own report, and the auto-fix loop that follows the report, still run. The debate stages (`/ask-gpt`, `/ask-gemini`, `/peer-review`) are **never chained into** and stay human-triggered for the same reason - running one is a deliberate, costly choice. Invoke a chained stage through the Skill tool, never by replicating it inline. Announce each handoff in one line before it fires, so the user can interrupt.

**Opt-out.** Saying **"no chaining"** on any invocation runs that one stage and stops. Per-run only, like M10. It is a separate phrase on purpose: "report only" governs whether findings are auto-fixed, "no chaining" governs whether the next stage fires. A single phrase covering both would be paraphrased into different behaviors at each call site.
