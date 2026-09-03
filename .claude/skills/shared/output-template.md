# Review Output Template

## Base Format

### Overall Verdict (one line, first thing the reader sees)

Open every report with a single verdict so a long, thorough review still gets read at a glance:

```
Verdict: <approve | approve-with-nits | changes-requested> - <one-line reason>
```

Derive it mechanically from the findings, never by gut feel:
- Any **Block** present -> `changes-requested`
- No Blocks, but one or more **Warn**/**Suggest** -> `approve-with-nits`
- Nothing worth reporting -> `approve`

### Top Issues (scannable summary)
```
🚫 X Blocks: R1 (file:line - one-line What), R3 (file:line - one-line What)
⚠️ X Warns: R2 (file:line - one-line What)
💡 X Suggests: R4 (file:line - one-line What)
```

**Readability backstop.** A review that flags everything is a review nobody reads. When a single report has **more than 7 findings**, lead with the **5 highest-severity** ones in full (the Findings section below) and list the remainder compactly - one line each (`R6 ⚠️ file:line - What`) under a `### More findings` subhead - so the headline risks are not buried. This caps what the reader must process, never what the review looks at: nothing is dropped, only demoted. It governs the report as displayed; the copy written to disk always carries every finding in full.

### Looks Good
- [What's working well - 2-3 items]

### Findings

**The two-sentence contract.** A finding is one sentence, sometimes two, plus a fix line and the check's own output. It is not a record with fields. The four-field structure this replaces (What / Why it matters / Example / Suggested fix) mandated four fields whether or not there were four things to say, and its skip rule told you to drop anything not worth four fields - so the only way to report a small true thing was to inflate it. Measured result: half of every review page was "Why it matters" and "Example", and "Why it matters" opened on a file path rather than a consequence in 42% of cases.

| Part | Cap | Rule |
|---|---|---|
| Sentence one | 18 words | Required. Opens with the severity spelled out, and carries **both** the defect and its consequence. |
| Sentence two | 22 words | Optional. Written **only** if it answers exactly one of: who is hit, when it fires, why now. There is never a third sentence. |
| Fix line | 20 words | Required. States a **cost**, not an approach. |
| Receipt | 6 lines | Attached, not written. Audit-time output (see The Receipt row). |

Open prose per finding is capped at **40 words** before the fix line. A reader who reads only sentence one must still learn what breaks.

**Severity is the first word, spelled out:** `Blocks.` / `Should fix.` / `Optional.` It goes in the sentence, not only in a badge, so it survives copy-paste into chat, into a commit message, and into markdown, and so it does not depend on a reader distinguishing a 5px border from another 5px border.

**Sentence one needs a harm verb** from this closed list: *blocks, breaks, deletes, leaks, skips, stalls, misses, overwrites, stops, refuses, silences, corrupts*. If no verb on this list is honestly true of the finding, that is a signal about the finding, not about the list - see the skip rule below. Never reach for one that overstates: a doc inconsistency that `misses` a case is not one that `breaks` anything, and an inflated verb in the highest-salience position on the page is worse than a vague paragraph.

**Confidence lives in the main verb**, from a closed four-row table. A verb cannot be skipped the way a confidence badge can, because it is load-bearing in the sentence.

| Confidence | Verb form | Example |
|---|---|---|
| high | `does` | "Blocks. The scanner refuses your next push." |
| moderate | `probably does` | "Should fix. This probably breaks the first install on a clean machine." |
| low | `may` | "Optional. A future rename may silence this check." |
| very low | `I do not know whether` | "Optional. I do not know whether this fires outside CI." |

Eleven hedges are banned outright, because an uncalibrated hedge reads as anywhere from 20:80 to 80:20 and so carries no information: *it appears, it is possible that, could potentially, consider whether, it may be worth, you might want to, arguably, in a sense, it is worth noting, somewhat, in certain scenarios*.

**Skip rule, inverted.** The old rule said a finding not worth four fields should not be reported, which taught exactly one behavior: bulk it up. The new rule is the opposite test. **A finding must survive being compressed to one sentence with an honest harm verb in it.** A finding that only exists at 134 words was never a finding. Report the small true thing in eleven words; drop the thing that needs a paragraph to sound important.

**No identifiers in open prose.** Zero rule IDs, commit hashes, command flags, function names, code spans, or file paths in the two sentences or the fix line. One file path is permitted in the fix line and nowhere else; the location belongs in the finding's own `file:line` slot, which every finding already carries. The reader is not always an engineer, and every identifier is a stop sign: they either halt to decode it or skip the sentence, and they cannot tell from the outside whether what is behind it is trivial or catastrophic. Grep-checkable: `\bM\d{1,2}\b`, `\b[0-9a-f]{7,}\b`, `--[a-z-]+`, `[A-Za-z_]\w*\(\)` and backticked spans must all return zero outside the fix line and the attachments.

**No meta.** A finding never mentions the severity taxonomy, audit tiers, skeptics, votes, or why it was included. That is the machine talking to itself in front of the reader, and it spends the finding's closing breath explaining why it might not have been worth writing.

**Receipt rule (every finding must be provable).** A finding must point at the specific evidence that proves it - the exact `file:line` (already required in the format) and, when the claim is about behavior, the concrete code or pattern you can cite. If you cannot point to the line or snippet that demonstrates the problem, do not report it. This keeps reviews honest: a real issue always has a receipt, and "confident findings that point at nothing" are the fastest way to lose the reader's trust. The receipt grounds the finding; it does not lower its severity (the Universal Anchors in severity-anchors.md still apply). What you author here is the *check*; the **Receipt** row that reports what the check actually output is audit-time output, not something you author.

Whether you write the finding directly (a direct `/review-*` call) or the orchestrator formats it from a structured JSON finding (`what` plus the `context` and `fix` fields, in the `/review` dispatch path), the shape is identical - only the serialization differs.

- **R1** 🚫 `file:line` - Blocks. [Sentence one: severity word, defect, harm verb. 18 words or fewer.]
  - [Sentence two, only if it answers who is hit, when it fires, or why now. 22 words or fewer. Omit the line entirely otherwise.]
  - **Fix:** [A cost and a choice. One size word, both options named. 20 words or fewer.]

- **R2** ⚠️ `file:line` - Should fix. [Sentence one.]
  - **Fix:** [Cost and choice.]

A worked pair, so the target is unambiguous. Before, at 321 words across four labelled fields with no machine output:

> **R1** ⚠️ `scripts/test-gen-media.js:31` - The test fixture constructs API key literals that match the pre-push tripwire's detection patterns.
>   - **Why it matters:** [134 words opening on a file path, restating the tripwire's design intent and the absence of an allow-list.]
>   - **Example:** [53 words of invented hypothetical beginning "a future contributor could".]
>   - **Suggested fix:** [75 words including function arguments, despite this template forbidding code.]

After, at 46 words plus the check's real output:

> **R2** ⚠️ `scripts/test-gen-media.js:31` - Should fix. Your own secret scanner will block your next push.
>   - The new test file's fake keys are shaped like real ones, so the scanner counts three and refuses.
>   - **Fix:** One line in that file: build the fake keys from pieces so they stop matching. Ten minutes.
>   - **Receipt:** `node .claude/scripts/pre-push-check.js` - tripwire hit, three keys flagged at lines 31 to 33, exit 1.

Eleven words in sentence one, with the harm verb inside it. Eighteen in sentence two, answering when it fires. Seventeen in the fix line, carrying a cost. An 86% cut, with evidence added rather than removed.

### Staff Check
[See Staff Check Variants below for the role matching your review type]

### Summary
- Files reviewed: X
- Blocks: X | Warns: X | Suggests: X

End the report with one line so the user knows what happens next: _"Fixes for surviving findings apply automatically and are re-verified per the auto loop in `.claude/skills/shared/hitl-loop.md`; saying 'report only' at the start would have kept this run report-first, and works the same on any future run."_

## Where the report is written

Every review that produces a report writes it to disk before rendering anything: `reports/review-<who>-<YYYY-MM-DD-HHMMSS>.md`, where `<who>` is `orchestrator` for `/review` or the lens name for a direct specialist run. Create `reports/` if absent; it is gitignored. Print the path to **stderr**, never stdout, so a caller capturing a render path is unaffected.

**The second thing a run writes is the receipts folder.** Tier 1 saves each check's output to `reports/receipts/<run-stamp>/` as it runs (M2 in `hitl-loop.md`; the orchestrator's Phase 4 shows the form), and the page's receipt slot is filled only from there. The markdown's **Receipt** row and the page's receipt block come from the same file.

**The markdown and the HTML are named on different principles, deliberately.** The markdown is timestamped per run because it is the archive: every run's full report, kept. The HTML page is `--stable --name review` because it is the standing page: one per repository, replaced in place, carrying only what is still open. One accumulates on purpose; the other refuses to.

This applies to the orchestrator and to a directly-typed `/review-*` run alike, which is why it lives here rather than in either call site.

**The markdown on disk is the canonical copy and is always complete.** It carries every finding, the full Audited out log, and every attachment. The HTML view may carry less; the markdown never carries less than the HTML. Chat scrollback is not a file: without this write, the report exists nowhere once the conversation is cleared, and every claim that a shortened view is safe "because the long version survives in the markdown" is false.

## Illustrative Examples

These show the two-sentence contract in practice across different review types. Note what each one does NOT contain: no restated harm, no invented hypothetical, no approach essay.

### Code review example

- **R1** 🚫 `auth/login.ts:42` - Blocks. Failed logins leak a live session token into the console log.
  - Anyone who can read the support log dashboard can reuse those tokens while they are still valid.
  - **Fix:** One line: log that the attempt failed, never the payload. Ten minutes, or leave it and the tokens keep landing in logs.

Sentence one is 12 words and names the harm with a verb from the list. Sentence two answers *who is hit*. The fix line carries a size and both options. Nothing restates anything.

### UX review example

- **R2** ⚠️ `Dashboard.tsx:88` - Should fix. Delete removes work permanently with no confirmation step.
  - A mistap on mobile destroys unsaved work, and the gesture is next to Edit.
  - **Fix:** One component: a confirm dialog naming the item. An afternoon, or accept the occasional lost record.

### Command review example

- **R3** ⚠️ `.claude/commands/explore.md:55` - Should fix. A vague instruction here probably stalls exploration on the wrong files.
  - It fires on every run, so the cost is paid before the user has asked anything.
  - **Fix:** One list: name the four things to look for. Ten minutes, or leave the wandering.

Note `probably` in sentence one. The reviewer cannot run this to prove it, so the verb carries the confidence rather than a hedge phrase doing it.

### Suggest example (with skip-boundary annotation)

This example is deliberately on the boundary between "skip-worthy" and "valid Suggest" so the model learns where the line is.

- **R4** 💡 `dashboard/utils.ts:120` - Optional. A second copy of the date formatter may silence a future format change.
  - **Fix:** One import, deleting the local copy. Ten minutes, or accept two places to update.
  - *Boundary note (for the reviewer):* A Suggest, not a skip, because the duplication has real maintainability cost across the codebase. It would be a skip if it were a one-line helper used only inside a single isolated module. Test it the new way: this survives compression to one honest sentence with `may silence` in it, so it is reportable. A finding that needed a paragraph to sound important would not.

Note this one has no second sentence. It had nothing to say about who is hit or when it fires, so the line is omitted rather than padded.

## Staff Check Variants

| Domain | Staff Role | Focus |
|--------|-----------|-------|
| Code | Staff Engineer | Right approach? Shortcuts to clean up? What would you push back on? |
| Security | Staff Security Engineer | Attacker's eyes? New attack surface? Trust boundary crossed? Every finding backed by an exploit path? |
| UX | Staff Designer | Coherent experience? User confidence? Edge cases (empty, loading, error, first-time)? |
| Plan | Staff PM (scope) | Scope discipline? Acceptance completeness? Traceability? Delivery risk? |
| Commands | Staff PM (ops) | Any user can follow? Workflow reliability? Handoff quality? |
| Browser | Staff QA | Core flow works? Error handling? Console health? Network health? |
| Full | Staff Architect | Cross-domain conflicts? Release risk? What's missing? Deeper reviews needed? |
| Deps | Security Engineer | Known vulnerabilities? Supply chain risk? License compliance? Update urgency? |
| Copy | Staff Editor | Clear to a newcomer? Oriented before interaction? Plain language? What would you send back for revision? |

## Browser Review Extensions

Browser findings use the same two-sentence contract plus extra evidence rows. The evidence rows are attachments, not prose: they do not count toward the 40-word cap, and they are shown rather than described.

- **R1** 🚫 `page/route` - Blocks. [Sentence one: severity, defect, harm verb.]
  - [Sentence two, only if it answers who is hit, when it fires, or why now.]
  - **Expected:** [What should happen]
  - **Actual:** [What actually happens]
  - **Screenshot:** [Path to screenshot showing the issue]
  - **Evidence:** [Console errors, failed API calls, or text output that supports the finding]
  - **Fix:** [A cost and a choice.]

Expected and Actual come first among the attachments on purpose: a wrong value beside the right one is the fastest thing on the page to understand, and it replaces the sentence of prose that would otherwise describe the gap.

(At audit time the **Receipt:** row is appended last, after `Fix` - defined once under "Audit-Aware Report Sections" below, not part of this authoring list.)

Browser summary also includes:
- Pages tested: X
- Browser sessions run: X
- Blocks: X | Warns: X | Suggests: X

## Audit-Aware Report Sections

These two additions apply to any run that performs the M2 audit: `/review` after dedup, a directly-typed `/review-*` skill after its own pass, and the session auditing a debate's Recommended Actions - whose report surface is the in-chat audit result M2 defines, not a rendered file. M2 in `.claude/skills/shared/hitl-loop.md` defines who the runner is and how the tiers work; this section defines only what the resulting report looks like.

They are not part of the authoring contract above. A receipt's *check* is authored with the finding; the **Receipt** row reports what that check actually output, which does not exist until tier 1 has run.

A run that produced no findings renders neither one: there was nothing to audit (M2), so a quiet report - like the security skill's one-line no-sink note - stays quiet, with no Audited out section.

A debate summary (`/ask-gpt`, `/ask-gemini`) renders neither one. Its Recommended Actions are audited later, by the loop, not by the command that wrote them.

### The Receipt row

Every surviving finding carries one extra sub-bullet, last, after `Fix`:

- **Receipt:** [The check that was run and what its output showed]

A finding the tier-3 vote downgraded (M2) renders at its new severity emoji, keeps its R-ID, and its Receipt row ends with the clause `downgraded from Block: <ballots>`, e.g. `downgraded from Block: 1 STANDS, 2 DOWNGRADE Warn`. That clause is why a Warn can carry an early ID.

When an audit subagent failed twice and its tier could not run (M2), mark that finding `unaudited` next to this row rather than dropping the row.

### Audited out

After the findings (and `### More findings`, when present), list every finding the audit killed - one line each, with its M2 verdict and a short evidence clause:

- **R7** `RECEIPT FAILED` - [What] (check output did not show the claim)
- **R9** `REFUTED` - [What] (skeptic: one-clause reason)
- **R2** `REFUTED 2/3` - [What] (two of three skeptics refuted: one-clause reason)

A downgraded finding is a survivor and never appears here. When a skeptic attached a `split:` line to a finding it refuted, list it directly under that finding's Audited out line as an open digest item: `  - split: <the sub-claim>`. It is a note for the human, never a finding: no ID of its own, no fields, no fix.

When nothing was killed, print `Audited out: none - all findings survived the audit.` **Never omit the section.** It is the run's log exit and M8 requires it stay inspectable; a report with no Audited out section is indistinguishable from a run that never audited at all.

R-IDs stay gap-free across the report and this log together. A finding that exits here keeps the number it was assigned, and the findings list simply skips that number.
