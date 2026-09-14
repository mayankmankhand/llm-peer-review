# Review Report Format

<!-- Split out of output-template.md in v7.0.0 (issue #167): this half is the report a RUNNER writes (verdict, sections, where it is written, the audit-aware rows). What a finding contains is finding-contract.md, which a finder agent preloads and a direct-run skill inlines beside this file. -->

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
### Staff Check
[See Staff Check Variants below for the role matching your review type]

### Summary
- Files reviewed: X
- Blocks: X | Warns: X | Suggests: X

End the report with one line so the user knows what happens next: _"Fixes for surviving findings apply automatically and are re-verified per the auto loop in `.claude/skills/shared/hitl-loop.md`; saying 'report only' at the start would have kept this run report-first, and works the same on any future run."_

## Where the report is written

Every review that produces a report writes it to disk before rendering anything: `reports/review-<who>-<YYYY-MM-DD-HHMMSS>.md`, where `<who>` is `orchestrator` for `/review` or the lens name for a direct specialist run. Create `reports/` if absent; it is gitignored. Print the path to **stderr**, never stdout, so a caller capturing a render path is unaffected.

**The second thing a run writes is the receipts folder.** Tier 1 saves each check's output to `reports/receipts/<run-stamp>/` as it runs (M2 in `hitl-loop.md` names the folder; this is the form, for the orchestrator and every directly typed skill alike), and the page's receipt slot is filled only from there. The markdown's **Receipt** row and the page's receipt block come from the same file.

- `<run-stamp>` is the same `YYYY-MM-DD-HHMMSS` the markdown report carries. Once per run: `mkdir -p reports/receipts/<run-stamp>`.
- Each check's file is `reports/receipts/<run-stamp>/<lens>-<n>.txt`, where `<lens>` is the specialist that authored the finding (`orchestrator` uses the specialist's name; a direct run uses its own lens name; the orchestrator's inline path uses `inline`) and `<n>` is that finding's number within that lens's results, counting from 1.
- Run each check so its output is saved and read back in one go, with the check inside `{ ... ; }` because a bare redirect captures only the last command of a compound or piped check:

  ```bash
  { <check> ; } > reports/receipts/<run-stamp>/<lens>-<n>.txt 2>&1; echo "exit $?" >> reports/receipts/<run-stamp>/<lens>-<n>.txt; cat reports/receipts/<run-stamp>/<lens>-<n>.txt
  ```

  Tier 1 compares what `cat` printed against the finding's `expect`. The finding's HTML `receipt` becomes `{cmd, stdoutFile, exit}` with `stdoutFile` that path: `render-html.js` reads the bytes from there, refuses a file from anywhere else, and drops a receipt whose file is missing, so a capture typed by hand never wears the machine's clothes. `mkdir` and `cat` are on the toolkit's allow-list; the redirect may prompt once on a fresh install.

**The markdown and the HTML are named on different principles, deliberately.** The markdown is timestamped per run because it is the archive: every run's full report, kept. The HTML page is `--stable --name review` because it is the standing page: one per repository, replaced in place, carrying only what is still open. One accumulates on purpose; the other refuses to.

This applies to the orchestrator and to a directly-typed `/review-*` run alike, which is why it lives here rather than in either call site.

**The markdown on disk is the canonical copy and is always complete.** It carries every finding, the full Audited out log, and every attachment. The HTML view may carry less; the markdown never carries less than the HTML. Chat scrollback is not a file: without this write, the report exists nowhere once the conversation is cleared, and every claim that a shortened view is safe "because the long version survives in the markdown" is false.

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
