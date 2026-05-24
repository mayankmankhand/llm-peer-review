# Debate HTML Render Template

Shared HTML rendering reference for `/ask-gpt` and `/ask-gemini` debate summaries. Inlined into both commands via `` !`cat .claude/skills/shared/html-render-debate.md` ``. Same pattern `html-render-review.md` uses.

This file documents WHEN to render HTML (the gate), WHERE the file goes, and WHAT structure it takes.

## When to Render (Judgement Gate)

Generate HTML when the Lead Reviewer Summary lists **3 or more Recommended Actions**.

If there are 2 or fewer Recommended Actions, skip HTML. The markdown summary alone is sufficient. This single countable trigger keeps the gate judgement-based and never default-on (a debate can run all 3 rounds and still produce fewer than 3 actions), and it matches the `/ask-gpt` / `/ask-gemini` trigger in `.claude/rules/html-outputs.md` exactly.

### Announce Upfront

When the gate fires, announce before generating:

> "Generating an HTML view because [reason]. Say 'skip HTML' if you want markdown only."

Honor "skip HTML" if the user replies with that phrase. Continue with markdown only.

## File Naming and Location

| Output | Path |
|---|---|
| Markdown summary | Inline in chat (today's behavior) |
| HTML companion | `artifacts/html/debate-{model}-<YYYY-MM-DD>.html` |

`{model}` is `gpt` or `gemini` (passed by the calling command). Same-day re-run overwrites (latest wins). Create `artifacts/html/` before writing; it is already gitignored.

## HTML Structure

Self-contained file. Inline `<style>` block, no CDN, no external assets. Inline the design tokens from `.claude/skills/shared/html-look.md`.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Debate: [topic] (Claude vs [Model])</title>
  <style>/* Inline tokens from html-look.md */</style>
</head>
<body>
  <header><h1>Debate Summary</h1></header>
  <section class="rounds">...</section>     <!-- per-round two-column -->
  <section class="synthesis">...</section>   <!-- agreed / disagreed / actions -->
</body>
</html>
```

### Per-Round Two-Column

One row per debate round. Left column = Claude's position, right column = the model's position. Lets the reader see how positions converged or diverged across the 3 rounds.

```html
<section class="rounds">
  <article class="round">
    <h2>Round 1</h2>
    <div class="two-col">
      <div class="col col--claude"><h3>Claude</h3><p>[position]</p></div>
      <div class="col col--model"><h3>[Model]</h3><p>[position]</p></div>
    </div>
  </article>
  <!-- Rounds 2, 3 -->
</section>
```

### Synthesis Block

Mirrors the markdown Lead Reviewer Summary: Agreed Points, Disagreed Points, Top Issues, and Recommended Actions. Recommended Actions reuse the severity badge colors from `html-look.md` (🚫 Block `#dc2626`, ⚠️ Warn `#d97706`, 💡 Suggest `#2563eb`) as card left-borders and badges, with the same R-IDs as the markdown.

```html
<section class="synthesis">
  <div class="agreed">...</div>
  <div class="disagreed">...</div>
  <div class="actions">
    <article class="action action--block">
      <span class="badge badge--block">🚫 Block</span>
      <span class="action-id">R1</span>
      <a class="file-link" href="vscode://file/[absolute-path]:[line]">[relative-path]:[line]</a>
      <h3>[What]</h3>
      <div class="field"><strong>Why it matters:</strong> [...]</div>
      <div class="field"><strong>Example:</strong> [...]</div>
      <div class="field"><strong>Suggested fix:</strong> [...]</div>
    </article>
  </div>
</section>
```

Use the same severity hex, file:line link scheme (visible relative path, `vscode://` absolute href), and 4-field action format as `html-render-review.md` for visual consistency across the toolkit.
