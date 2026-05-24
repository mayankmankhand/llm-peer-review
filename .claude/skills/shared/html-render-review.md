# Review HTML Render Template

Shared HTML rendering reference for review output. Inlined into review skills and the `/review` orchestrator via `` !`cat .claude/skills/shared/html-render-review.md` ``. Same pattern `output-template.md` and `severity-anchors.md` use.

This file documents WHEN to render HTML (the gate), WHERE the file goes, and WHAT structure it takes.

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

## File Naming and Location

| Output | Path |
|---|---|
| Markdown report | Inline in chat by default. If a skill also saves markdown to disk, use `reports/review-<type>-<YYYY-MM-DD>.md`. |
| HTML companion | `artifacts/html/review-<type>-<YYYY-MM-DD>.html` |

The `<type>` is the skill name (`code`, `ux`, `browser`, `plan`, `full`, `deps`, `copy`, `commands`) when called directly, or `orchestrator` when called via `/review`. The HTML companion is standalone - it can be opened on its own without a markdown file on disk.

Create the `artifacts/html/` directory before writing. It is already gitignored. (`artifacts/` itself is tracked via a README so it exists in fresh clones.)

## Subagent Rule (orchestrator dispatch only)

When the orchestrator (`/review`) dispatches specialist subagents, those subagents MUST NOT emit their own HTML companion. Only the orchestrator produces HTML for an orchestrator run - this guarantees one combined HTML file per cycle rather than several overlapping ones. Specialist skills only generate HTML when called directly (e.g., `/review-code` on its own).

## HTML Structure

Self-contained file. Inline `<style>` block, no CDN, no external assets.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>[Review Type] Review</title>
  <style>
    /* Inline tokens from .claude/skills/shared/html-look.md */
  </style>
</head>
<body>
  <header>
    <h1>[Review Type] Review</h1>
    <!-- Specialist chips here (orchestrator only, when 2+ specialists) -->
  </header>
  <section class="top-issues">...</section>
  <section class="looks-good">...</section>
  <section class="findings">...</section>
  <footer class="summary">...</footer>
</body>
</html>
```

Inline the design tokens from `.claude/skills/shared/html-look.md` into the `<style>` block.

## Specialist Chips Header (orchestrator only)

Render only when 2 or more specialists were dispatched. Skip for single-specialist runs (the page title already says what was reviewed).

```html
<div class="chips">
  <span class="chip">code</span>
  <span class="chip">ux</span>
  <span class="chip">browser</span>
</div>
```

## Top Issues (sticky)

Sticky-position bar at the top so it stays visible while scrolling. Mirrors the markdown Top Issues block.

```html
<section class="top-issues" style="position: sticky; top: 0;">
  <div class="top-row top-row--block">🚫 X Blocks: R1, R3</div>
  <div class="top-row top-row--warn">⚠️ X Warns: R2</div>
  <div class="top-row top-row--suggest">💡 X Suggests: R4</div>
</section>
```

## Looks Good Section

Mirrors the markdown "Looks Good" block.

```html
<section class="looks-good">
  <h2>Looks Good</h2>
  <ul>
    <li>[What's working well]</li>
  </ul>
</section>
```

## Finding Card Template

Each finding is a card with a severity-colored left border, badge, file:line link, and the four required fields.

```html
<article class="finding finding--block">
  <header>
    <span class="badge badge--block">🚫 Block</span>
    <span class="finding-id">R1</span>
    <span class="specialist-tag">[code]</span>
    <a class="file-link" href="vscode://file/[absolute-path]:[line]">[relative-path]:[line]</a>
  </header>
  <h3 class="what">[What: one-line summary]</h3>
  <div class="field"><strong>Why it matters:</strong> [...]</div>
  <div class="field"><strong>Example:</strong> [...]</div>
  <div class="field"><strong>Suggested fix:</strong> [...]</div>
</article>
```

### Severity Colors (from html-look.md)

| Severity | CSS class | Hex |
|---|---|---|
| Block (🚫) | `finding--block` | `#dc2626` |
| Warn (⚠️) | `finding--warn` | `#d97706` |
| Suggest (💡) | `finding--suggest` | `#2563eb` |

Apply the hex as the `border-left` color (4 to 6 px) and as the badge background.

### File:Line Links

Render as a clickable `<a>` element with the `vscode://file/...` scheme.

```html
<a href="vscode://file/[absolute-path]:[line]">[relative-path]:[line]</a>
```

- Visible text uses the relative path so it matches the markdown report.
- The `href` uses the absolute path so the editor can resolve it.
- In editors that don't recognize `vscode://`, the link gracefully no-ops; the path stays readable as text.

## Browser Review Extensions

Browser findings (from `/review-browser`) carry extra evidence fields. Add them inside the finding card between Example and Suggested fix.

```html
<div class="field"><strong>Screenshot:</strong> <img src="[path]" alt="[description]"></div>
<div class="field"><strong>Evidence:</strong> <pre>[console errors / failed API calls]</pre></div>
<div class="field"><strong>Expected:</strong> [...]</div>
<div class="field"><strong>Actual:</strong> [...]</div>
```

## Summary Block (footer)

Mirrors the markdown Summary block.

```html
<footer class="summary">
  <span>Files reviewed: X</span>
  <span>🚫 Blocks: X</span>
  <span>⚠️ Warns: X</span>
  <span>💡 Suggests: X</span>
</footer>
```

For orchestrator output, also include:

- Specialists run: X of Y
- Deduplicated findings: X (Y raw findings)
