# Review HTML Render

Shared reference for turning a review's findings into an HTML view. Inlined into the review skills and the `/review` orchestrator via `` !`cat .claude/skills/shared/html-render-review.md` ``.

This file documents WHEN to render (the gate) and HOW to render (data injection into the prebuilt shell). The HTML structure and visual look live in the shell template and `tokens.css`, NOT here - you never hand-write the HTML.

## When to Render (Judgement Gate)

Generate HTML when **any** of the following is true about the report:

- 3 or more findings total
- Visual evidence is present (e.g., browser screenshots from `/review-browser`)
- Severity mix spans 2 or more levels (e.g., both Blocks and Warns are present)

If none of the above is true (including 0 findings, or 1-2 findings of a single severity), skip HTML. Markdown alone is sufficient.

### Announce Upfront

When the gate fires, announce before generating:

> "Generating an HTML view because [reason]. Say 'skip HTML' if you want markdown only."

Honor "skip HTML" if the user replies with that phrase. Continue with markdown only.

## How to Render (data injection - do NOT hand-write HTML)

The boilerplate (all CSS, layout, and every card) lives once in the prebuilt shell `.claude/skills/shared/shells/review-shell.html`. You produce ONLY a compact JSON payload of the findings; the helper injects it (plus the shared `tokens.css`) into the shell and writes a self-contained file: for a review, the one standing page per repository (step 3 below). This is what makes the open fast and collision-free (issues #120, #127). Generating the whole HTML by hand is the old, slow path - do not do it.

Steps:

1. **Build the JSON payload** matching the schema documented at the top of `.claude/skills/shared/shells/review-shell.html`. Read that header comment for the authoritative field list (it is the single source of truth). Compact reference:
   - `title`, `subtitle` (HTML allowed)
   - `bottomLine`: `[string, string?, string?]` - **the whole first screen.** Two or three sentences, each 25 words or fewer, in fixed slots: (1) is it safe to ship, including "I could not tell, because..."; (2) the one other thing that matters; (3) what happens next. The first renders in display type. Omit the key and the page falls back to the old counter strip.
   - `disposition`: one sentence of **counts only** - how many were fixed, deferred, and left unchecked. It must not restate any sentence in `bottomLine`; a design critic scored an early draft down for saying the same thing three times before the first finding. `bottomLine` slot 3 says what happens next in words; this says how many, in figures.
   - `alreadyFixed`: `[string]` - one line each, past tense, with the check that confirmed it. This is the base-rate disclosure: a short list of open findings is only believable beside the count of what was handled.
   - `couldNotCheck`: `[string]` - named limits of this pass, one line each, in plain words. Never omitted when a limit exists; a page that states none is claiming there were none.
   - `chips`: `[{name, on}]` - `on:true` = specialist ran, `on:false` = "(skipped)". Omit for a single-specialist run.
   - `lenses`: `[string]` - the lenses this run checked, by specialist name: `["code"]` for a direct `/review-code` run, the dispatched set for `/review`. The renderer carries every open finding on the previous page whose lenses are all outside this list forward, marked `carried`, ranked and budgeted with the rest, and counts it as still open; only a finding from a lens that ran can be reported resolved. Omit the key only for a run that checked everything (`/review-full`): with no `lenses`, the whole page is replaced.
   - `topIssues`: `{block:[], warn:[], suggest:[]}` - each entry is a short string. **Only rendered when `bottomLine` is absent**; it is the backward-compatible fallback, not something to send alongside.
   - `looksGood`: `[string]` (HTML allowed)
   - `groups`: `[{label, findings:[...]}]` grouped by specialist. Each finding: `{id, severity, specialist, file:{relPath, absPath, line}, what, context, fix, locus, receipt, fields:[{label, value}]}`. `severity` is `"block" | "warn" | "suggest"`.
     - `what` / `context` / `fix` are the two-sentence contract's three prose keys - sentence one, the optional sentence two, and the fix line. **Omit `context` entirely** when there is no second sentence; that is the normal case. All three may carry trusted inline HTML (`<code>`, `<strong>`).
     - `locus`: `"user"` when only the human can answer this finding. It drives ranking; severity breaks ties. Omit it and the run degrades to severity-then-payload-order, which is today's behavior.
     - `receipt`: `{cmd, stdoutFile, exit}`. `stdoutFile` is the file the tier-1 runner saved the check's output to as it ran, under `reports/receipts/<run-stamp>/` (M2 tier 1 in `hitl-loop.md` names the folder; the orchestrator's Phase 4 shows the form); **`render-html.js` reads that file itself** and replaces it with a capped `stdout` array, taking the file's own `exit N` last line as the exit code. It refuses a file from anywhere else, a file over 64 KB, or anything that is not a plain file, and drops the receipt with a note on stderr naming the file. Supplying `stdout` inline instead is refused and dropped, because model-typed text presented as machine output is worse than no receipt at all.
     - `fields`: **attachments only**, never prose. Browser findings use `Expected`, `Actual`, `Screenshot` (an `<img>` value), `Evidence` (a `<pre>` value), in that order. Most findings emit none.
   - **What the renderer does to this payload, so you do not have to:** counts the words in `what`/`context`/`fix` and reports every cap violation to stderr; ranks by `locus` then severity; demotes the lowest-ranked findings to one-line rows once the page budget is spent, never a Block while a lower finding renders in full; carries the other lenses' open findings forward when `lenses` is set; sets `isNew`, `carried`, and `demoted` itself (a payload's own copies of those flags are stripped); and drops any `fields` row still using the retired `Why it matters` / `Example` / `Suggested fix` labels, in the Audited out group too. None of this aborts the render. Do not pre-truncate or pre-select findings to "help" - send everything that survived the audit and let the counter decide.
   - Audit rows (any audited run - orchestrated or direct): each surviving finding's `fields[]` ends with `{"label": "Receipt", "value": "<code>check</code> - what the output showed"}`, and one extra group `{label: "Audited out"}` is appended after the others, holding the killed findings with their assigned `id` and a field row `{"label": "Audit verdict", "value": "RECEIPT FAILED" / "REFUTED" / "REFUTED 2/3"}`, plus `{"label": "Split note", "value": "..."}` when the skeptic attached one. A downgraded finding stays in its specialist group at its new `severity`, with its Receipt value ending in `downgraded from Block: <ballots>`. No shell change: `groups[]` and `fields[]` are generic. A run with no findings renders neither (M2's empty-run rule).
   - `summary`: `[{emoji?, label, value}]` - the footer count strip.

2. **Write the JSON to a temp file**, e.g. `/tmp/review-data.json`.

3. **Run the helper from the project root, once, at the end of the run.** On an auto run that is after the auto-fix loop has settled (the runner's After the Report section says where), with the loop's FIXED findings in `alreadyFixed` and only the unfixed ones open; on a "report only" run, right after the report. A page rendered before the loop was stale within minutes of being published. The review page is `--stable`: one standing page per repository at `artifacts/html/review.html`, replaced in place rather than added to. The name is the bare `review` because the identity is the repo. Before overwriting, the helper reads the page it is replacing and fills `sinceLast` with what changed, so pass every surviving finding from the lenses that ran and name those lenses in `lenses` - the comparison is what produces the memory, and a finding from a lens that ran and is not in the payload is reported resolved.
   Check the publish gate first (see **"Render for the viewport"** in `.claude/rules/html-outputs.md`): if this session can publish, add `--no-abs` to the command below.

      ```
   node .claude/scripts/render-html.js --shell review --name review --out-dir artifacts/html --stable --data /tmp/review-data.json
   ```
   - The name is always the bare `review`, for every caller. A direct `/review-code` run and an orchestrated `/review` write the same standing page, because the page is the repository's open findings and not a record of which command produced them. Which lens ran belongs in `lenses` (which is what keeps a direct run from overwriting the other lenses' findings), in `chips`, and in the markdown filename, not in the page's identity.
   - You do NOT read, name, or delete any prior file. The helper handles naming and overwrites; there is nothing to clean up.

4. **Show it to the user** per the **"Viewing the Artifact"** rules in `.claude/rules/html-outputs.md`: publish is the primary viewport, the local open is the fallback, and that section holds the whole decision. Pass `--no-abs` to the render above when this session can publish. The publish never asks (a private claude.ai page is not an outward send under M9); when you hand over the link, say in one clause what the page holds: the surviving findings with their receipts and the audited-out log.

   **Screenshots publish fine; relay any omission note.** `browse.js` writes each screenshot to disk and returns its filesystem path, and `render-html.js` inlines every readable local image as a base64 `data:` URI before writing the page, so a published browser QA report shows its screenshots and the local file is self-contained. Two cases do not make it: an unreadable file, and an image over the render's encoded-size budget. Both are replaced in the page with a visible note and announced on stderr as a `note:` line. Relay those notes rather than letting the user find the gaps; never claim the images are local-only.

## Subagent Rule (orchestrator dispatch only)

When the orchestrator (`/review`) dispatches specialist subagents, those subagents MUST NOT emit their own HTML companion. Only the orchestrator produces HTML for an orchestrator run - this guarantees one combined HTML file per cycle rather than several overlapping ones. Specialist skills only generate HTML when called directly (e.g., `/review-code` on its own).
