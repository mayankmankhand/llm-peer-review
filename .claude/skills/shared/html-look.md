# HTML Visual Look

Shared visual reference for HTML output produced by toolkit commands and the `/playground` skill. Inline this file into commands/skills via `` !`cat .claude/skills/shared/html-look.md` `` (same pattern as `output-template.md`).

This is the minimal v1: typography, colors, severity badges, and the copy-button pattern.

## Typography

- Body: system font stack: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
- Headings: same stack. Weight 600 for h1/h2, weight 500 for h3 and below
- Mono (code, IDs, file paths): `ui-monospace, "SF Mono", Menlo, Consolas, monospace`
- Base size: 16px. Scale: h1 1.875rem, h2 1.5rem, h3 1.25rem, body 1rem, small 0.875rem
- Line height: 1.6 for body, 1.3 for headings

## Color Tokens

Pick from this neutral palette unless an element calls for a severity color (see below).

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#ffffff` | Page background |
| `--bg-muted` | `#f4f4f5` | Card and section backgrounds |
| `--border` | `#e4e4e7` | Borders, dividers |
| `--text` | `#18181b` | Primary text |
| `--text-muted` | `#52525b` | Secondary text, captions |
| `--accent` | `#2563eb` | Links, interactive elements (matches Suggest severity for visual unity) |

Dark mode is out of scope for v1. Downstream projects may add their own.

## Severity Badge Colors

Maps to the existing 🚫⚠️💡 scale used in markdown reports. Use these hex values for badge backgrounds, left-border accents on finding cards, and severity-colored chips.

| Level | Emoji | Hex | Notes |
|---|---|---|---|
| Block | 🚫 | `#dc2626` | Red. Badge background with white text, or left-border accent. |
| Warn | ⚠️ | `#d97706` | Amber. Distinct weight from red, not pale yellow (low contrast). |
| Suggest | 💡 | `#2563eb` | Blue, not green. Green reads as "success/pass". |

All three pass WCAG AA contrast (>= 4.5:1) with white text. They are Tailwind 600-level tones, chosen for visual consistency and readability across light backgrounds.

## Copy-Button Pattern

Every interactive HTML artifact (notably from `/playground`) ends with a "copy as markdown" or "copy as prompt" button. The pattern:

- Position: inline at the end of the main content area, or fixed at the bottom of the page
- Label: literal text "Copy as markdown" or "Copy as prompt" (whichever fits the use case). No icon-only variants - text is required for clarity.
- Behavior: copies a markdown-formatted string to the clipboard. The user pastes it back into chat as a new message; that closes the export loop.
- Visual: solid accent-colored background (`--accent`), white text, slight border radius

Minimal implementation:

```html
<button onclick="navigator.clipboard.writeText(payload)">Copy as markdown</button>
```

Where `payload` is the markdown string the user should paste back into chat.

