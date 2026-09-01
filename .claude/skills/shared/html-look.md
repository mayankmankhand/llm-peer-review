# HTML Visual Look

Shared visual reference for HTML output produced by toolkit commands and the `/playground` skill. Inline this file into commands/skills via `` !`cat .claude/skills/shared/html-look.md` `` (same pattern as `output-template.md`).

This is the minimal v1: typography, colors, severity badges, and the copy-button pattern.

> **Mirror:** The seven helper-rendered shells read these tokens from `.claude/skills/shared/shells/tokens.css`, which mirrors this file. Update BOTH together when the look changes. (`tokens.css` points back here.)

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
| `--badge-text` | `#fff` | Text on a severity badge. A token rather than a literal because dark mode inverts it |

## Dark Mode

Supported since issue #155. The hosted page is now the primary place an artifact
is read, and it renders inside the **viewer's** theme, so a light-only stylesheet
hands a dark-mode reader a white slab. The local fallback needs the same
treatment, since a browser there follows the OS theme too.

The light palette above is the unconditional default and lives on bare `:root`.
Dark mode redefines only the tokens, in two places carrying identical
declarations: `@media (prefers-color-scheme: dark)` guarded as
`:root:not([data-theme="light"])` for a viewer whose theme is "system", and
`:root[data-theme="dark"]` for an explicit choice. The guard is what lets an
explicit light choice win on a machine set to dark. No color is ever given its
only definition inside a conditional block.

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#ffffff` | `#18181b` |
| `--bg-muted` | `#f4f4f5` | `#27272a` |
| `--border` | `#e4e4e7` | `#3f3f46` |
| `--text` | `#18181b` | `#f4f4f5` |
| `--text-muted` | `#52525b` | `#a1a1aa` |
| `--accent` | `#2563eb` | `#60a5fa` |
| `--block` | `#dc2626` | `#f87171` |
| `--warn` | `#d97706` | `#fbbf24` |
| `--warn-strong` | `#b45309` | `#fbbf24` |
| `--suggest` | `#2563eb` | `#60a5fa` |
| `--block-strong` | `#b91c1c` | `#f87171` |
| `--positive` | `#15803d` | `#4ade80` |
| `--badge-text` | `#fff` | `#18181b` |

**The severity colors are re-derived, not reused**, and the reasoning below
inverts. In light mode a badge is white text on the severity fill, which is
exactly why `--warn-strong` exists. On a dark ground the readable badge is a
light fill with near-black text, so every severity fill moves to its 400-level
tone and `--badge-text` flips to the page's dark ink. Each dark pairing clears
AA: 6.4:1 for red, 7.0:1 for blue, 10.6:1 for amber. Amber no longer needs a
separate strong variant in dark mode, so `--warn-strong` tracks `--warn` there.

**Two tokens exist so shells never reach for a literal.** `--positive` (keep,
added, pro) is not a severity - the severities are block, warn, and suggest -
but four shells were hardcoding a green for it. `--block-strong` is to `--block`
what `--warn-strong` is to `--warn`: the AA-safe variant for red TEXT on
`--bg-muted`, where plain `--block` measures 4.4:1 and fails.

**Shell CSS must use these tokens, never a literal.** `tokens.css` holds the
shared layer; each shell's own `<style>` holds its layout. A hex literal in a
shell survives the theme switch unchanged, which is how this feature's first
pass shipped two shells whose text rendered at 1.05:1 in dark mode. The only
legitimate literals are decorative borders and markers, where contrast rules do
not apply. Every pairing above is measured, not assumed - recheck with the WCAG
relative-luminance formula whenever a tone changes.

## Severity Badge Colors

Maps to the existing 🚫⚠️💡 scale used in markdown reports. Use these hex values for badge backgrounds, left-border accents on finding cards, and severity-colored chips.

| Level | Emoji | Hex | Notes |
|---|---|---|---|
| Block | 🚫 | `#dc2626` | Red. Badge background with white text, or left-border accent. |
| Warn (border) | ⚠️ | `#d97706` | Amber. Decorative card left-border only, where contrast rules do not apply. Distinct weight from red, not pale yellow (low contrast). |
| Warn (text/badge) | ⚠️ | `#b45309` | Darker amber for white-text surfaces (badge backgrounds, severity chips). About 5:1 contrast, AA-compliant. |
| Suggest | 💡 | `#2563eb` | Blue, not green. Green reads as "success/pass". |

These are the **light-mode** values; the Dark Mode table above re-derives all of them.

Block (`#dc2626`) and Suggest (`#2563eb`) pass WCAG AA contrast (>= 4.5:1) with white text. The base Warn amber `#d97706` does NOT (about 3.2:1 white-on-it), so it is used only for the decorative card left-border, where contrast rules do not apply. Any Warn text or badge surface uses the darker variant `#b45309` (about 5:1, AA-compliant) instead. These are Tailwind 600/700-level tones, chosen for visual consistency and readability across light backgrounds.

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

