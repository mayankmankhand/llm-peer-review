# What a Finding Contains

<!-- Split out of output-template.md in v7.0.0 (issue #167): this half is what a finding IS, preloaded into every finder agent. The report structure lives in report-format.md; a direct-run skill inlines both. -->

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

Whether you write the finding directly (a direct `/review-*` call) or the orchestrator formats it from a structured JSON finding (`what` plus the `context` and `fix` fields, in the `/tk:review` dispatch path), the shape is identical - only the serialization differs.

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
>   - **Receipt:** `node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js` - tripwire hit, three keys flagged at lines 31 to 33, exit 1.

Eleven words in sentence one, with the harm verb inside it. Eighteen in sentence two, answering when it fires. Seventeen in the fix line, carrying a cost. An 86% cut, with evidence added rather than removed.

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

- **R3** ⚠️ `${CLAUDE_PLUGIN_ROOT}/commands/explore.md:55` - Should fix. A vague instruction here probably stalls exploration on the wrong files.
  - It fires on every run, so the cost is paid before the user has asked anything.
  - **Fix:** One list: name the four things to look for. Ten minutes, or leave the wandering.

Note `probably` in sentence one. The reviewer cannot run this to prove it, so the verb carries the confidence rather than a hedge phrase doing it.

### Suggest example (with skip-boundary annotation)

This example is deliberately on the boundary between "skip-worthy" and "valid Suggest" so the model learns where the line is.

- **R4** 💡 `dashboard/utils.ts:120` - Optional. A second copy of the date formatter may silence a future format change.
  - **Fix:** One import, deleting the local copy. Ten minutes, or accept two places to update.
  - *Boundary note (for the reviewer):* A Suggest, not a skip, because the duplication has real maintainability cost across the codebase. It would be a skip if it were a one-line helper used only inside a single isolated module. Test it the new way: this survives compression to one honest sentence with `may silence` in it, so it is reportable. A finding that needed a paragraph to sound important would not.

Note this one has no second sentence. It had nothing to say about who is hit or when it fires, so the line is omitted rather than padded.

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
