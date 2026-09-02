# Human-in-the-Loop Map

**What this is:** the decision document for issue #146. It answers one question for every stage of the toolkit loop: **does a human actually change the outcome here?** Where the answer is no, the loop runs automatically. Where the answer is yes, the map says exactly when and how the human is brought in.

**Status:** settles #146. Implemented by #147, which rewrites the 17 files carrying report-only language to match this map. Two sequencing facts that held before #147 started: it was contingent on the #144 architecture answer, and the M2 audit pipeline was built as its own separate issue, not by #147 (both under Scoped-out follow-ups below, now marked resolved). This document touches no prompt files itself. Decided 2026-08-28 through an `/explore` session on #146; the evidence behind every verdict is in the appendix.

**Amended 2026-08-29 (stage chaining, M14):** the original verdict table answered "who decides the outcome" but never separately answered "who types the command", so every stage transition silently stayed a human keystroke. M14 closes that gap: `/create-plan`, `/review`, and `/document` are now invoked automatically, and M9's outward-send clause is narrowed so a chained `/document` may open a PR. Plan approval remains the cycle's one gate.

**What the amendment actually edited:** six verdict cells were rewritten in place (`/create-plan`, `/execute`, `/review`, `/ask-gpt` and `/ask-gemini`, `/peer-review`, `/document`) to name their trigger alongside their verdict, and one row was added (`/review-*` run directly). In the numbered rules, **M9 was narrowed** (its outward-send clause now exempts a chained `/document` PR) and **M14 was added**. The *decisions* those verdicts record are unchanged - every stage answers "does a human change the outcome here?" the same way it did on 2026-08-28. The *wording* changed, and this document does not retain the pre-amendment text; consult git history (`git log -p docs/HITL-MAP.md`) for it. All evidence in the appendix is untouched. The **Status** line below still describes the document's original 2026-08-28 purpose and has deliberately not been rewritten; read it as history, and this note as what changed since.

**Amended 2026-08-29 (worker model routing + audit sharding, #152):** subagent model routing became a written rule, `.claude/skills/shared/model-routing.md`. Worker subagents may pin a model one tier down through agent frontmatter in `.claude/agents/`, while every judge role (M2 skeptics and voters, M3 verifiers), every code-writing agent, and the main loop stay on the session model - a judge never runs below the tier of the work it judges. Crucially, no pin ships on that reasoning alone: guardrail 3 requires an A/B receipt first (the same diff reviewed pinned and inherited in report-only mode, post-audit survivors compared), and the review-specialist pin proposed in this very cycle was **tested and revoked** when the pinned arm missed a real installer bug the inherited arm caught. The rule earns its keep by killing its own proposal; the roster and the revocation receipt live in the routing fragment. Operationally, M2 tier 2 and M3's judgment verifier now shard by finding count (one skeptic or verifier per 7 findings, in parallel, verdict formats unchanged; live transcripts measured the single-agent versions at 15-20 seconds per finding, the audit's serial long pole), and tier 1 receipts run as each worker returns instead of after the whole wave.

**Amended 2026-08-31 (private artifact pages, M9):** M9's outward-send clause gained its second named exemption. An artifact rendered by `render-html.js` and published to a private `claude.ai` page no longer asks for consent: the page is private by default and the toolkit never changes its sharing setting, so it reaches no one the user has not chosen themselves. The same edit records that dependency version updates are ordinary auto-fixes, which `hitl-loop.md` had said since #147 and this document had not, and M2's dedup rule now states that a merged finding keeps the highest severity of its sources, previously written only in `review.md`. The verdicts are unchanged.

**Amended 2026-09-02 (downgrade verdict, #158):** M2's tier-3 vote gained a third outcome. Each voter now returns `STANDS`, `DOWNGRADE Warn`, `DOWNGRADE Suggest`, or `REFUTED`, and the runner tallies in a fixed order: two or more `REFUTED` kills the Block as before; otherwise two or more `STANDS` keeps it a Block; otherwise the finding survives at the higher level the downgrade ballots named. The guard against this becoming a soft vote is countable: a `DOWNGRADE` ballot must name which Block condition fails (not reachable through a normal action, harms only the triggering user, or a workaround exists), and one that names none is counted as `STANDS`. A downgraded finding keeps its R-ID and skips tier 2, since three voters already judged the claim real. Any skeptic, tier 2 or 3, may also attach one `split:` line to a finding it refutes, naming a true sub-claim; the runner lists those in the digest as open items and never turns one into a finding. Evidence: in the #155/#156 review two Blocks were killed 3/3 while all three voters said the same thing, real defect, wrong severity, and a third fact died inside one of them because the neighbouring skeptic could only say "that is a different finding". Both were fixed only because a human overrode the rule, which is the M1 page the audit exists to avoid. Tier 2 is unchanged: moving a Warn to Suggest changes report order, not routing, so it earns no verdict of its own. The verdicts are unchanged.

**How to read it:** the verdict table gives each command a one-line verdict and reason. The numbered rules (M1 to M15) are the shared mechanics the verdicts rely on; #147 should cite rule IDs when rewriting files. Three exit words recur throughout: a **page** interrupts the human now; a **digest** is auto-handled work with receipts attached, read at leisure; a **log** records dropped non-issues, never fixed and never surfaced unless asked. Evidence sources are cited as E1 (downstream mining), E2 (external retrospective), E3 (published research).

---

## The loop at a glance

```
Human:    /explore
Machine:  /create-plan (chains once the conversation converges, M14)
Human:    approve the plan                       <- the cycle's one gate
Machine:  /execute
          /review: specialists -> dedup -> audit (M2) -> drop non-issues
                   -> auto-fix survivors -> re-verify (M3, M6)
                      green -> digest with receipts (M8)
                      red after 2 rounds -> revert to last green -> page (M5)
          /document (receipts, M8) -> commit per logical unit
          -> pre-push tripwire (M11) -> push -> PR
          -> /index if 10+ commits behind (M12)
Human:    pages only (M1): outside-the-repo facts, intent reversals,
          tripwire hits, exhausted fix rounds
Chaining: automatic per M14; "no chaining" runs one stage and stops
Opt-out:  "report only" on any run restores today's behavior for that run (M10)
```

---

## Stage-by-stage verdicts

| Stage | Verdict | Reason |
|---|---|---|
| `/explore` | **Human** | The conversation is the product. Scoping and vision decisions depend on goals, constraints, and domain facts that live only with the user (E2: every escaped-defect class traces to outside-the-repo facts). |
| `/create-plan` | **Auto-invoked, human approves** | M14 chains into it once the conversation converges; the approval, not the typing, is the gate. Plan approval is the release lever for the whole cycle: the cheapest point to catch a wrong direction (E1: plan-stage debates caught rework before it was built; E3: plan-then-apply pattern). Everything downstream executes an approved plan. |
| `/execute` | **Auto, human-triggered by the plan approval** | Never chained into (M14): saying "go" on the plan is what starts it. Mechanical implementation of an approved plan. Bounded retries already exist; checkpoint commits (M4) make any step reversible. A blocker the run cannot resolve within its retry bound stops it, which is a page (M1 hard-stop list). |
| `/review` (orchestrator) | **Auto, chained, with pages** | Sampled findings are roughly half noise (E1: ~53% real across 348 findings; E3: published precision can be below 10%). Auditing, fixing, and verifying are mechanical (M2, M3). A human reading raw findings audits noise a machine filters better (E2: 5-55% of raw findings die on one skeptical pass). Pages fire only per M1. |
| `/ask-gpt`, `/ask-gemini` | **Human-triggered, never chained into, auto-processed** | Running a debate stays a deliberate, costly choice. Its Recommended Actions then enter the same audit pipeline as review findings (M2), because external recommendations systematically over-engineer (E1: rejected-as-over-engineering appears across projects) and cross-model agreement is weaker than it feels (E3: correlated failures). |
| `/review-*` run directly | **Auto, not chained** | A typed specialist run is a deliberate focused check and does not chain into the next stage (M14). Its findings still enter the audit and fix loop. |
| `/peer-review` | **Human-triggered, never chained into, auto-processed** | It is itself an audit step: evaluating external feedback against the codebase. The human filtering it used to require is exactly what M2 mechanizes; page criterion M1 still applies to what survives. |
| `/document` | **Auto, chained, receipts required** | Documentation updates are mechanical, but generated bookkeeping drifts from reality (E1: plans marked done for unbuilt work in 5 projects). Every claim of work done carries a receipt (M8). Commit and push run per M4 and M11. |
| `/index` | **Auto, conditional** | Pure generation from the codebase. Runs when `CODEBASE_MAP.md` is 10+ commits behind (M12); skipped otherwise. |
| `/pair-debug` | **Human** | Debugging is interactive by nature: the bug report, reproduction knowledge, and "that is not what I saw" judgment live with the user. Investigation stays a conversation; fixes that come out of it flow through M3 and M6. |

**Trigger is not the same as gate.** A verdict of **Human** means a human changes the outcome at that stage, not that a human must type the command. The two were fused in the original table, which is why every transition stayed manual even after #147 made the loop auto. M14 separates them: `/explore` and `/pair-debug` are typed, plan approval is the gate, the debates and directly-typed `/review-*` runs stay human-triggered, and the four M14 transitions chain.

---

## Operating rules

**M1. Page criterion: information locus, not severity.**
A finding or event interrupts the human ("page") only when:
- its truth depends on facts outside the repo that only the user holds: real-world behavior being modeled, actual ship status, the actual reference design, audience fit, personal or business facts (E2: every defect that escaped a clean review traces to this class), or
- its fix would reverse something the diff or history shows was deliberately done (M7), or
- a hard stop fired: fix rounds exhausted (M5), an `/execute` blocker unresolved within its retry bound, pre-push tripwire hit (M11), always-ask action reached (M9).

Everything else takes one of the other two exits: **digest** (auto-handled, receipts attached, read at leisure) or **log** (dropped non-issues, never fixed, never surfaced unless asked). Both land in the run's report artifact under the existing `artifacts/html/` convention, the digest also summarized in chat at end of run; #147 may refine the exact location, but both stay inspectable. Pages are capped at 2-3 per cycle; the pipeline ranks and truncates rather than forwarding everything above a threshold (E3: alert fatigue research; escalations that are mostly waved through mean the gate has failed and the threshold must tighten).

A page is phrased as a decision a non-engineer can make: what happened, what the options are, what happens if we ship anyway, with a recommended default.

**M2. Three-tier audit before any fix.**
Raw findings are deduplicated across specialists (two reporting the same issue is one finding with more confidence), then audited:
1. **Receipts** (always, nearly free): every finding gets a runnable check: a grep, a file read, a test, an exit code. A finding whose receipt fails is dropped and logged, never fixed (E1: fabricated findings in 5 projects died on a cheap mechanical re-check).
2. **One skeptical pass** (survivors headed for auto-fix): a fresh agent tries to refute the finding using the receipts. Default prior is rejection (E2: this pass kills 5-55% of raw findings).
3. **Three-vote majority refute** (Blocks only): three independent skeptics; majority refute kills it. Reserved for the tier where a wrong drop or a wrong page is costly (E3: voting gains plateau; spend where stakes are highest).

Dispatch hygiene: all content handed to audit and verify agents is passed as verbatim bytes, never paraphrased or summarized. A reviewer can only judge the bytes it is given, so a paraphrase manufactures findings about the paraphrase, not the artifact (E1: findings born from paraphrased dispatch content).

Maximum-depth review (the opt-in mode that fans out many parallel reviewers with multi-vote verification, at several times the default token cost) stays opt-in and is not part of the default loop.

**M3. Independence: the fixer never verifies.**
Trust order for verification signals: a runnable check first, a different model second, a fresh same-model context last. The agent or conversation that produced a fix never declares it verified (E2: independent verification rejected ~40% of a sampled set where self-checking caught ~13%; E3: models cannot reliably self-correct and favor their own output).

**M4. Checkpoint commits.**
Commit after each green logical unit. A checkpoint is the undo button that makes auto-fix safe: a bad fix reverts surgically without dragging good work along (E3: roll-back-first).

**M5. Failure semantics: bounded, then revert, then page.**
Max 2 fix rounds per finding (the existing re-verify bound, kept). If round 2 is still red: revert to the last green checkpoint, stop, and page with a 3-line summary of what failed and what was tried. Never a third attempt, never silent continuation. A check that fails then passes on rerun is logged as a finding for the digest, never silently reclassified as green (E3: flaky-test experience; retry-until-green trains everyone to ignore red).

**M6. Re-verify the claim, not the instance.**
A finding names one occurrence; what it reports is a claim that can have several. Re-verification sweeps for other instances of the same claim in the touched files before declaring the fix done (E2: 2 of 14 re-verifications failed exactly this way). A fix is new work and meets the same evidence bar as the finding that prompted it.

**M7. Intent-reversal guard.**
Before applying a fix, check whether it would restore or undo something the git history shows was deliberately changed or removed. If so, the finding pages instead of auto-applying, even when the finding is technically correct (E2: an auto-applied rule restored a section the author had deliberately deleted, twice).

**M8. Receipts, not claims.**
Digests and documentation state what ran and show the evidence: the command and its output, the count delta, the diff stat. "All N fixed" without receipts is the failure mode, not the report (E1: generated status records drifted from reality in 5 projects). A doubt closed as "deliberate" carries a pointer to where the human actually decided it; otherwise it stays open (E2: a plausible rationale converted an open question into false certainty that survived several passes).

**M9. Always-ask actions.**
These stop the loop no matter which stage reaches them: releases and bumps of this project's own version (dependency version updates are ordinary auto-fixes), edits to prompt files (this toolkit repo's own command, skill, and rules files, and their copies in downstream projects alike), deletions of user data, outward-facing sends (anything leaving the machine for a human audience, except two named cases: a pull request opened by `/document` at the end of a chained cycle - its plan was human-approved and its push already cleared M11 - and an artifact rendered by `render-html.js` and published to a private `claude.ai` page, per `html-outputs.md` - private by default, and the toolkit never changes its sharing setting, so it reaches no one the user has not chosen themselves; sharing that page or sending anywhere else still asks), force pushes. This list is short on purpose: rare gates stay meaningful (E3: the vigilance trap).

**M10. Opt-out is per-run only.**
Saying "report only" on any invocation restores report-first behavior for that run. The next run is auto again. There is no sticky mode: persistent modes drift silently and get forgotten (E1: automation infrastructure drifting with no failure signal).

**M11. Pre-push tripwire.**
Push runs automatically after a pre-push check, hardened into a script by #149 (`.claude/scripts/pre-push-check.js`): a per-commit secret scan of the outgoing range (per-commit because an added-then-removed secret is invisible in the endpoint diff yet still publishes in history), a never-push file check, and a settings diff. Silent when clean; a hit blocks the push and pages (E1: personal data sat tracked for weeks; a credential exposure forced a history rewrite; subagents silently added permission grants caught only by a human pre-commit diff). The prose checks remain the fallback when the script is absent or errors.

**M12. `/index` refresh trigger.**
`/index` runs automatically when `CODEBASE_MAP.md` is 10 or more commits behind HEAD, and is skipped otherwise. Single-commit drift is noise.

**M13. Scope of the rewrite.**
This map governs the toolkit's rules files and skills (the 17 files in #147). The user-level `~/CLAUDE.md` outside this repo stays conservative: projects without the toolkit's audit-and-verify machinery keep report-first. Toolkit projects get the new behavior through the toolkit's own rules files, delivered by the normal update path.

**M14. Stage chaining.**
Stages hand off automatically. The human types `/explore` and approves the plan; the debates, `/peer-review`, `/pair-debug`, and directly-typed `/review-*` runs stay typed as well and are never chained into. Four transitions, each with a brake: `/explore` -> `/create-plan` on a countable convergence check (scoping: "Remaining questions" empty; vision: dial on `Hold`/`Reduce` and "Open questions" empty), `/create-plan` -> stop for approval, `/execute` -> `/review` on a clean finish, `/review` -> `/document` once the loop settles. Debates are never chained into, and a directly-typed `/review-*` specialist run does not chain onward (its own audit and fix loop still run) - only the orchestrated `/review` chains. The per-run opt-out is "no chaining", deliberately distinct from M10's "report only": one governs whether the next stage fires, the other whether findings are auto-fixed (E1: automation infrastructure drifting with no failure signal; the #147 finding that call sites paraphrase an underspecified rule into different behaviors on day one).


**M15. Design loop bound.**
The design critic loop that `/execute` runs on a surface with load level new or improve (issue #160) has its own bound, separate from M5, because M5 is per finding and absolute while a critic loop iterates on one surface toward a quality bar. A round is one screenshot, one critic dispatch, and one fix pass, with the polish checklist inside the last round. New work gets up to 5 rounds; improve gets 2. After round 2 and after every later round the latest score is compared with the previous one, and the loop stops when it has not risen by at least one point. Every round is checkpointed (M4); when the loop stops, the highest-scoring checkpoint is kept and any later round that scored lower is reverted, so the digest reports the best score and its round. Exhausting the bound is a digest entry, never a hard stop: M14's clean finish holds and the run chains into `/review`. Media asks and divergence asks raised during design work are M1 pages exempt from the 2-3 cap the way M9 approvals are, because a truncated media ask would silently ship a surface without media; an unanswered divergence ask defaults to staying inside the allowed set. The critic contract itself (fixed prompt, fresh context, image only, the 9/10 target never shown to the critic) lives in `.claude/skills/shared/design-rules.md`; M15 cites it rather than restating it. Evidence: the source article's own warning that without a stopping rule "the critic may never consider the design good enough, and your agent will helplessly burn tokens trying to please it" (E3), and the #147 and M14 drift lessons that put mechanics in one shared rule.

---

## Questions issue #146 asked, and where they are settled

| Question | Answer |
|---|---|
| What does automatic mean when a fix fails? | M5: two rounds, revert to last green, page. Never a third attempt. |
| Does the re-verify protocol survive when nobody approved the fix? | Yes, strengthened: M3 (independence) and M6 (claim-level sweep) apply to every auto-fix. |
| What does `/review` do now that it can write? | Audit (M2), fix survivors, re-verify (M3, M6), then page/digest/log per M1. Non-issues are dropped, never fixed. |
| Is the opt-out per-run or sticky? | Per-run only (M10), and "no chaining" (M14) is per-run too. |
| Does a **Human** verdict mean a human must type the command? | No. M14 separates the trigger from the gate. Typed by the human: `/explore`, `/pair-debug`, the debates, `/peer-review`, and any directly-typed `/review-*` run. Plan approval is the gate. The four M14 transitions chain. |
| Does the user-level `CLAUDE.md` outside this repo change too? | No. It stays conservative; toolkit rules carry the change (M13). |

---

## Scoped-out follow-ups

- **Verify-before-report stage in `/review` (M2) is a pipeline change, not a rules rewrite.** Recommendation: its own issue, separate from #147. #147 rewrites language to match this map; building the audit tiers into the `/review` orchestrator is implementation work with its own testing surface. Resolved by #148 item 1 (the M2 audit tiers, shipped 2026-08-29) and #151 (the same audit on direct `/review-*` runs).
- **Shared severity rubric.** Evidence E1 showed every project judging "critical" differently and severity labels unreliable in both directions. The map sidesteps severity as a gate input (M1), but the review skills would still benefit from one calibrated rubric. **Resolved by #150:** `severity-anchors.md` now opens with what severity actually decides (audit tier, verdict line, R-ID order, readability backstop) and what it explicitly does not (paging, which stays on M1's information locus), carries a solo-tool-versus-production calibration rule, and teaches the Block/Warn and Warn/Suggest lines by worked example. The two debates (`/ask-gpt`, `/ask-gemini`) inline it too, since their Recommended Actions are audit-routed by the same label, and so does `/peer-review`, whose confirmed findings carry the same Block/Warn/Suggest labels through its own evaluation.
- **Sequencing.** #147 remains contingent on the #144 architecture answer (one shared source of truth per command vs a copy per tool), exactly as #147 already records. Resolved: #147 shipped 2026-08-29 as the auto-by-default rewrite (0fe3f33); the #144 architecture question stays open on its own.

---

## Evidence appendix

### E1. Downstream mining (this machine, generalized)

A multi-agent mining run (2026-08-28) read the full lessons logs, opened the review and debate HTML artifacts, and diffed fix commits against review reports across 7 toolkit projects, letter-coded A to G. Nothing identifying is reproduced here.

- **348 findings sampled from 36 review artifacts:** roughly 53% real defects, 37% style or noise, 9% speculative. About 10% carried a critical label, but labels were unreliable: one project's 15 "critical" findings were 5 or 6 true blockers by its own notes.
- **Wholesale "fix all N" approval was the dominant recorded behavior in every project:** findings applied verbatim, the human gate adding no per-finding information on the mechanical majority.
- **When the human did filter, it mattered:** rejected findings were mostly context-miscalibrated (enterprise severity applied to solo local tools) and are not recorded as ever resurfacing as bugs. Human triage of external debate recommendations repeatedly rejected over-engineering.
- **Reviewers fabricate:** hallucinated defects at specific lines, false claims about file contents, findings born from paraphrased dispatch content. In 5 projects these died on a cheap mechanical re-check (a grep, a file read): the receipts tier exists because of this.
- **A bug class is visible only at runtime:** dead features shipped through passing test suites and multiple approving static reviews in 5 projects; live browser QA or running on real data was what caught them. Execution-based verification is part of the auto loop, not an escalation.
- **Lessons logs do not prevent recurrence:** logged footguns recurred; the next review pass or a mechanical script is what stopped them. The review-fix-verify stage is load-bearing.
- **Generated bookkeeping drifts:** plans marked done for unbuilt work, "all fixed" tallies covering unfixed items, in 5 projects. Receipts (M8) exist because of this.
- **Auto-push is where irreversible damage lived:** personal data tracked in git for weeks, one credential exposure forcing a full history rewrite, permission grants silently added to shared settings. The tripwire (M11) exists because of this.
- **Plan-stage review catches rework early:** debates and reviews run on plans rather than finished work caught refinements before anything was built, recorded across projects as cheaper than rewriting shipped work. Basis for the `/create-plan` verdict.
- **Automation infrastructure drifts silently:** stale global prompt copies degraded every review for months in one project; a scheduled run in another produced no output while appearing to fire. Basis for M10's no-sticky-modes rule.

### E2. External retrospective (separate project, different machine)

A retrospective mined from ~60 review invocations over two months, cross-referenced against a 400+ entry dated lesson log, in a pipeline that already runs a verify-before-report stage:

- **5-55% of raw findings were rejected by one adversarial pass before any human read anything** (over half on reviews of freshly written prompt or instruction content).
- **Severity mix across 59 cycles: 26 Blocks, 380 Warns, 346 Suggests.** Blocks appeared in fewer than half of cycles: pages under this map are rare by construction.
- **Independent verification rejected or downgraded ~40% of a sampled finding set; self-checking caught ~13%** on the same material. Independence roughly triples the filter.
- **Every defect that escaped a clean review traced to a fact outside the diff:** the real interaction model, the real ship status, the real reference design, the real audience. This is the empirical basis for M1.
- **2 of 14 re-verifications failed the same way:** the fix corrected the quoted sentence and missed the same claim elsewhere in the file (basis for M6).
- **An auto-applied correct finding restored a deliberately deleted section, twice** (basis for M7). A doubt closed as "deliberate" without a receipt protected a real error through several passes (basis for M8).

### E3. Published research

- Bainbridge, "Ironies of Automation" (1983): humans are poor monitors of automation; a gate that is always approved creates fake oversight while skills atrophy. Fewer, meaningful gates.
- Alarm fatigue (AHRQ Patient Safety Network): 72-99% false alarms cause desensitization and missed true alarms. Basis for the page cap and the escalation-quality tracking in M1.
- Huang et al., "Large Language Models Cannot Self-Correct Reasoning Yet" (ICLR 2024, arXiv:2310.01798) and CRITIC (arXiv:2305.11738): self-review without external feedback does not work; external signals do. Basis for M3.
- Panickssery et al., self-preference bias (NeurIPS 2024, arXiv:2404.13076); Zheng et al., LLM-as-judge biases (arXiv:2306.05685). Same-model judging inflates. Basis for M3's trust order.
- Olausson et al., self-repair bottleneck (ICLR 2024, arXiv:2306.09896): better feedback beats more attempts. Basis for M5's tight bound.
- Knight and Leveson (1986): independent implementations fail together more than independence predicts; cross-model agreement is weak evidence. Only ground truth breaks the correlation.
- Fowler, Continuous Integration (stop-the-line, fix-within-10-minutes-or-revert); Google SRE Workbook (roll back first, fix forward later). Basis for M4 and M5.
- Google flaky-test experience: retry-until-green hides real regressions. Basis for M5's pass-on-retry rule.
- Google SRE monitoring (pages vs tickets vs logs): a page must be urgent, actionable, and require human intelligence. Basis for M1's three exits.
- DORA metrics: stability comes from small batches and fast recovery, not heavier approvals. Change failure rate is the loop's health number.
- SWR-Bench (arXiv:2509.01494): LLM review precision can be below 10%; assume raw findings are majority-noise and make the audit layer core, not polish.
- Anthropic's code review (InfoQ, 2026): a dedicated disprove-each-finding pass plus a confidence cutoff reaches under 1% incorrect findings. Production precedent for M2.
- Greptile: LLM self-rated severity is near-random. Basis for M1 rejecting severity as the gate input. CodeRabbit: findings ship with runnable receipts. Production precedent for M2's tier 1.
- Plan-then-apply workflow (Terraform and infrastructure-as-code practice): humans review the plan artifact, apply runs automatically after approval. Basis for the `/create-plan` verdict.
- Self-consistency voting (arXiv:2511.00751): majority-vote accuracy gains plateau early while token cost grows linearly. Basis for reserving 3-vote refutation for Blocks only (M2).
