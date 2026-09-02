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

The boilerplate (all CSS, layout, and every card) lives once in the prebuilt shell `.claude/skills/shared/shells/review-shell.html`. You produce ONLY a compact JSON payload of the findings; the helper injects it (plus the shared `tokens.css`) into the shell and writes a self-contained, uniquely-timestamped file. This is what makes the open fast and collision-free (issues #120, #127). Generating the whole HTML by hand is the old, slow path - do not do it.

Steps:

1. **Build the JSON payload** matching the schema documented at the top of `.claude/skills/shared/shells/review-shell.html`. Read that header comment for the authoritative field list (it is the single source of truth). Compact reference:
   - `title`, `subtitle` (HTML allowed)
   - `chips`: `[{name, on}]` - `on:true` = specialist ran, `on:false` = "(skipped)". Omit for a single-specialist run.
   - `topIssues`: `{block:[], warn:[], suggest:[]}` - each entry is a short string (e.g. `"R1 [code] (file.sh:91 - desc)"`).
   - `looksGood`: `[string]` (HTML allowed)
   - `groups`: `[{label, findings:[...]}]` grouped by specialist. Each finding: `{id, severity, specialist, file:{relPath, absPath, line}, what, fields:[{label, value}]}`. `severity` is `"block" | "warn" | "suggest"`. `what` and each field `value` may contain trusted inline HTML (`<code>`, `<strong>`). Browser findings just add more `fields` (Screenshot as an `<img>` value, Evidence as a `<pre>` value, Expected, Actual).
   - Audit rows (any audited run - orchestrated or direct): each surviving finding's `fields[]` ends with `{"label": "Receipt", "value": "<code>check</code> - what the output showed"}`, and one extra group `{label: "Audited out"}` is appended after the others, holding the killed findings with their assigned `id` and a field row `{"label": "Audit verdict", "value": "RECEIPT FAILED" / "REFUTED" / "REFUTED 2/3"}`, plus `{"label": "Split note", "value": "..."}` when the skeptic attached one. A downgraded finding stays in its specialist group at its new `severity`, with its Receipt value ending in `downgraded from Block: <ballots>`. No shell change: `groups[]` and `fields[]` are generic. A run with no findings renders neither (M2's empty-run rule).
   - `summary`: `[{emoji?, label, value}]` - the footer count strip.

2. **Write the JSON to a temp file**, e.g. `/tmp/review-data.json`.

3. **Run the helper from the project root** (it computes the timestamped name, creates `artifacts/html/`, overwrites freely, and prints the output path):
   Check the publish gate first (see **"Render for the viewport"** in `.claude/rules/html-outputs.md`): if this session can publish, add `--no-abs` to the command below.

      ```
   node .claude/scripts/render-html.js --shell review --name review-<type> --data /tmp/review-data.json
   ```
   - `<type>` = the skill name (`code`, `ux`, `browser`, `plan`, `full`, `deps`, `copy`, `commands`) when a specialist is called directly, or `orchestrator` when called via `/review`. So `--name review-orchestrator`, `--name review-code`, etc.
   - You do NOT read, name, or delete any prior file. The helper handles naming and overwrites; there is nothing to clean up.

4. **Show it to the user** per the **"Viewing the Artifact"** rules in `.claude/rules/html-outputs.md`: publish is the primary viewport, the local open is the fallback, and that section holds the whole decision. Pass `--no-abs` to the render above when this session can publish. The publish never asks (a private claude.ai page is not an outward send under M9); when you hand over the link, say in one clause what the page holds: the surviving findings with their receipts and the audited-out log.

   **Screenshots publish fine; relay any omission note.** `browse.js` writes each screenshot to disk and returns its filesystem path, and `render-html.js` inlines every readable local image as a base64 `data:` URI before writing the page, so a published browser QA report shows its screenshots and the local file is self-contained. Two cases do not make it: an unreadable file, and an image over the render's encoded-size budget. Both are replaced in the page with a visible note and announced on stderr as a `note:` line. Relay those notes rather than letting the user find the gaps; never claim the images are local-only.

## Subagent Rule (orchestrator dispatch only)

When the orchestrator (`/review`) dispatches specialist subagents, those subagents MUST NOT emit their own HTML companion. Only the orchestrator produces HTML for an orchestrator run - this guarantees one combined HTML file per cycle rather than several overlapping ones. Specialist skills only generate HTML when called directly (e.g., `/review-code` on its own).
