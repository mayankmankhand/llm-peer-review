---
name: playground
description: Generate throwaway, self-contained HTML files for in-the-loop decisions. Use when the user needs to see, drag, toggle, slide, or compare options to decide. Static-default; interactive only when it changes the decision.
allowed-tools:
  - Read
  - Write
---

# Playground

**Use this when:** The user is making a decision that benefits from seeing options side by side, reordering items, toggling between variants, or tuning a value, and a flat markdown comparison would be hard to scan or interact with.

**Don't use this when:** A short markdown list or table is enough (most simple "pick one of two" decisions), the output needs to live in the repo (use markdown), or the user wants a published artifact (use `/codebase-to-course` for learning content, or a regular HTML file in `artifacts/html/` for cycle-bound documents).

## Hard Rules

<rules>

1. **Never modify any toolkit file.** No edits to commands, skills, rules, settings, or any prompt file. The export-loop button is the only way state flows back to the conversation.
2. **Static-default invocation.** Generate a static side-by-side comparison unless interactivity (drag, toggle, slider) genuinely changes the decision. If unsure, ask the user first.
3. **Disposable.** Always write to `/tmp/playground-{timestamp}.html`. Never to the repo. The `/tmp/` location is reboot-wiped on Linux, macOS, and WSL by default.
4. **Self-contained.** One HTML file, inline CSS and JS, no CDN, no external assets. Must work offline. Must work in any browser without dev tools open.

</rules>

## Behavior

### When invoked directly (`/playground` cold)
The user has not given context. Ask: "What are we comparing or tuning?" Wait for the answer before generating anything. Do not guess.

### When dispatched from another command
The calling command (e.g. `/explore` vision mode) provides the option set, the comparison context, and a signal about whether interactive primitives would change the decision. Use that context to choose a pattern.

### Output
Always end the flow by writing the HTML to `/tmp/playground-{timestamp}.html` (use `date +%s` for the timestamp), then emit a clickable `file:///tmp/playground-{timestamp}.html` link in chat. Do not try to open the file via `xdg-open` or similar - the clickable link is the agreed-upon mechanism.

Per `.claude/rules/html-outputs.md`, announce the HTML generation upfront:
> "Generating an HTML playground because [reason]. Say 'skip HTML' if you want markdown only."

## Interaction Patterns

Four core patterns. Pick one per playground based on the decision shape. Click-to-expand is a combinable presentation primitive available to use with any of the four.

### 1. Side-by-side compare (default)
Two to four option cards laid out horizontally. Each card has a title, short description, and any visual or structural detail relevant to the decision (mockup, code snippet, list of properties).

**Use when:** The user is picking one of N options and each option fits in a card the user can scan in 2-3 seconds.

**More than 4 options?** Either ask the user to narrow the set first, or switch to Pattern 2 (toggle/variant switcher) and announce the switch so the user knows why their request changed shape. Six cards side-by-side violate principle #2 (fits on one screen) - the comparison becomes unreadable rather than helpful.

### 2. Toggle / variant switcher
A single content area with toggle buttons or tabs above it. Clicking a toggle swaps the displayed content.

**Use when:** Each option is too detailed to fit side-by-side (long code, large mockup, paragraphs of detail), but the user still wants to flip between them rapidly.

### 3. Drag-to-reorder
A list of items the user can drag to reorder. The current order is reflected in the copy-button payload.

**Use when:** The decision is about ordering or ranking (priority queues, step sequences, feature roadmaps). Static lists cannot capture this.

### 4. Slider
One or more numeric inputs (range sliders) with live-updating displayed values. The current values are reflected in the copy-button payload.

**Use when:** The decision is about tuning a numeric parameter (timeout values, percentages, thresholds) where the user wants to feel the trade-off.

### Combinable primitive: click-to-expand
Collapsible `<details>` panels for inline "why" annotations, long code blocks, or deep-dive content that would otherwise blow up the comparison. Not a headline pattern - combine with any of the four above.

## Visual + Interaction Principles

<guidelines>

1. **Affordances must be obvious.** Draggable items show `cursor: grab`, a slight shadow on hover, and a dotted-border drop target. Toggles look like toggles (segmented control or pill buttons), not plain text. Sliders show their current value next to them.
2. **Fits on one screen when possible.** A playground is a decision tool, not a presentation deck. If the user has to scroll to compare two options, the comparison is broken. Use collapsible sections for "why" detail instead of inlining it.
3. **Defaults visible, details collapsible.** Surface the comparison upfront. Bury "why option B is faster" in a click-to-expand panel.
4. **Inline annotations.** Margin notes co-located with the thing being explained. Do not make the reader scroll between the option and its rationale.
5. **Keyboard navigable.** Tab through interactive elements. Arrow keys to reorder where it fits. Space to toggle. This is web standard, low cost, and makes the playground feel like a real tool.

</guidelines>

## Visual Look

Inline the shared HTML look reference. This gives the playground consistent typography, color tokens, and severity badge colors with the rest of the toolkit's HTML output.

!`cat .claude/skills/shared/html-look.md`

## Copy Button (Mandatory)

Every playground ends with a "Copy as markdown" button. This is the export loop - the only way the user's gesture flows back into the conversation.

### Payload guidance

**Simple decisions (one of N):** One-liner payload. Example:

```
Playground result: Selected Option B
```

**Complex state (orderings, slider values, multi-toggle):** Structured markdown that captures everything the user touched. Example:

```
Playground result for "Task prioritization"
- Order: Task A, Task D, Task B, Task C, Task E
- Slider (urgency threshold): 42
- Enabled flags: review, notify
```

The first line should always be a recognizable header (`Playground result...`) so the calling command can detect the paste.

### The button itself

```html
<button onclick="copyResult()" id="copy-btn">Copy as markdown</button>
<script>
function copyResult() {
  const payload = buildPayload();
  navigator.clipboard.writeText(payload);
  document.getElementById('copy-btn').textContent = 'Copied!';
  setTimeout(() => document.getElementById('copy-btn').textContent = 'Copy as markdown', 1500);
}
</script>
```

Use the `--accent` background and white text per the shared look. Position at the bottom of the page or fixed in the bottom-right corner so it is always reachable.

### `buildPayload()` sketches per pattern

`buildPayload()` reads the playground's current state and returns the markdown payload (per the Payload guidance above). Always start the payload with `Playground result` so the calling command can detect the paste. One sketch per pattern - adapt selectors and labels to the specific playground:

```js
// Side-by-side compare (one of N)
function buildPayload() {
  const sel = document.querySelector('.pick.selected');
  return sel
    ? `Playground result: Selected Option ${sel.dataset.option}`
    : 'Playground result: No option picked';
}

// Toggle / variant switcher
function buildPayload() {
  const active = document.querySelector('.tab.active');
  return `Playground result: Variant ${active.dataset.variant}`;
}

// Drag-to-reorder
function buildPayload() {
  const order = [...document.querySelectorAll('.item')]
    .map(el => el.textContent.trim())
    .join(', ');
  return `Playground result\n- Order: ${order}`;
}

// Slider
function buildPayload() {
  const value = document.getElementById('threshold').value;
  return `Playground result\n- Threshold: ${value}`;
}
```

The function name (`buildPayload`) and the `Playground result` header are conventions the dispatcher relies on. Everything else (selector names, label text, payload field names) is the generating Claude's call.

The user is always free to ignore the button and just type their decision in natural language. The button exists for moments when typing the state out would be tedious.

## Cleanup

`/tmp/playground-*.html` files accumulate over time. The skill never deletes them automatically (no risk of wiping an open browser tab).

If the user ever wants to clean up manually:

```bash
rm /tmp/playground-*.html
```

`/tmp/` is reboot-wiped on Linux, macOS, and WSL by default, so files self-clean on next restart.
