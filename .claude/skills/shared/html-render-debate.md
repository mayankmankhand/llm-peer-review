# Debate HTML Render

Shared reference for turning an `/ask-gpt` or `/ask-gemini` debate summary into an HTML view. Inlined into both commands via `` !`cat .claude/skills/shared/html-render-debate.md` ``.

This file documents WHEN to render (the gate) and HOW to render (data injection into the prebuilt shell). The HTML structure and visual look live in the shell template and `tokens.css`, NOT here - you never hand-write the HTML.

## When to Render (Judgement Gate)

Generate HTML when the Lead Reviewer Summary lists **3 or more Recommended Actions**.

If there are 2 or fewer Recommended Actions, skip HTML. The markdown summary alone is sufficient. This single countable trigger keeps the gate judgement-based and never default-on (a debate can run all 3 rounds and still produce fewer than 3 actions), and it matches the `/ask-gpt` / `/ask-gemini` trigger in `.claude/rules/html-outputs.md` exactly.

### Announce Upfront

When the gate fires, announce before generating:

> "Generating an HTML view because [reason]. Say 'skip HTML' if you want markdown only."

Honor "skip HTML" if the user replies with that phrase. Continue with markdown only.

## How to Render (data injection - do NOT hand-write HTML)

The boilerplate (all CSS, the per-round two-column layout, and the synthesis cards) lives once in the prebuilt shell `.claude/skills/shared/shells/debate-shell.html`. You produce ONLY a compact JSON payload; the helper injects it (plus the shared `tokens.css`) into the shell and writes a self-contained, uniquely-timestamped file (issues #120, #127). Do not hand-write the HTML.

Steps:

1. **Build the JSON payload** matching the schema documented at the top of `.claude/skills/shared/shells/debate-shell.html` (the authoritative source). Compact reference:
   - `topic`, `model` (e.g. `"GPT-5.5"` or `"Gemini"`) - used in the title and the right-column header.
   - `rounds`: `[{n, claude, model}]` - one per debate round; `claude` and `model` are the two positions (trusted inline HTML allowed).
   - `synthesis`: `{agreed:[], disagreed:[], actions:[...]}`. Each action: `{id, severity, file:{relPath, absPath, line}, what, fields:[{label, value}]}`, mirroring the review finding shape. `severity` is `"block" | "warn" | "suggest"`. `what` and field `value`s may contain trusted inline HTML.

2. **Write the JSON to a temp file**, e.g. `/tmp/debate-data.json`.

3. **Run the helper from the project root** (it computes the timestamped name, creates `artifacts/html/`, overwrites freely, and prints the output path):
   ```
   node .claude/scripts/render-html.js --shell debate --name debate-<model> --data /tmp/debate-data.json
   ```
   - `<model>` is `gpt` or `gemini` (passed by the calling command). So `--name debate-gpt` or `--name debate-gemini`.
   - You do NOT read, name, or delete any prior file. The helper handles naming and overwrites; there is nothing to clean up.

4. **Open the printed path** in the browser per the "Opening the Artifact" rules in `.claude/rules/html-outputs.md`:
   ```
   bash .claude/scripts/open-artifact.sh "<printed-path>"
   ```

The debate cards reuse the same severity scale, file-link scheme, and field format as the review shell for visual consistency across the toolkit.
