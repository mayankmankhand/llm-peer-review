# Browse Script API Reference

## Invoking the Script

Write your action sequence as JSON, save to a temp file, and pipe it to the script:

```bash
cat /tmp/browse-actions.json | node .claude/scripts/browse.js
```

Or inline:

```bash
echo '{"baseUrl":"http://localhost:3000","actions":[...]}' | node .claude/scripts/browse.js
```

## Input Format

```json
{
  "baseUrl": "http://localhost:3000",
  "actions": [
    { "type": "goto", "url": "/" },
    { "type": "screenshot" },
    { "type": "text" }
  ]
}
```

- `baseUrl` - The root URL for the app under test. Defaults to `http://localhost:3000` if omitted.
- `actions` - Ordered list of actions to execute. Must start with a `goto`.

## Action Types

| Action | Fields | What it does |
|--------|--------|-------------|
| `goto` | `url` or `path` (resolved against baseUrl) | Navigate to a page. Must be the first action. `url` is canonical; `path` works as an alias. |
| `click` | `target` (selector) | Click an element |
| `fill` | `target` (selector), `value` | Type text into an input field |
| `screenshot` | none | Take a full-page screenshot (saved to /tmp) |
| `text` | `target` (optional selector) | Extract visible text from page or element |
| `wait` | `ms` or `selector` (note: uses `selector`, not `target`) | Wait for time or for an element to appear |
| `a11y` | none | Run accessibility audit on the current page using axe-core. Returns violations grouped by impact level (critical, serious, moderate, minor). |
| `responsive` | none | Capture screenshots at 3 fixed viewports: mobile (375x812), tablet (768x1024), desktop (1280x720). Returns paths to all screenshots. |

## Execution Behavior

Execution stops on the first failed action. Remaining actions are skipped, but diagnostics (console errors, network failures, page errors) captured up to that point are still returned in the output.

Because of this, keep action sequences short (3-6 actions) and place screenshots or text captures early if you want them recorded even when a later step fails. When a session stops mid-way, read the diagnostics before retrying - they usually tell you what went wrong.

## Selector Syntax

Use these prefixes to target elements:

| Prefix | Example | What it matches |
|--------|---------|----------------|
| `css:` | `css:.btn-submit` | CSS selector |
| `text:` | `text:Sign In` | Text content (substring match) |
| `role:` | `role:button:Submit` | ARIA role with accessible name |
| (none) | `.btn-submit` | Treated as CSS selector |

## Auto-Start (opt-in)

If the app's dev server is not already running, you can request the script to start it automatically by adding `autoStart` to the input JSON:

```json
{
  "baseUrl": "http://localhost:3000",
  "autoStart": true,
  "actions": [...]
}
```

When `autoStart` is `true`, the script will:
1. Check if `baseUrl` is reachable
2. If not, run `npm run dev` (or the project's start command) in the background
3. Wait for the server to become reachable (30s timeout)
4. Proceed with the action sequence
5. Stop the auto-started server when done (success or failure)

If the server is already running, `autoStart` has no effect.

## Output Format

The script returns JSON with per-action results plus diagnostics:

```json
{
  "ok": true,
  "url": "http://localhost:3000/",
  "title": "My App",
  "actions": [
    { "type": "goto", "ok": true, "url": "http://localhost:3000/", "status": 200, "title": "My App" },
    { "type": "screenshot", "ok": true, "path": "/tmp/browse-screenshot-1234567890.png" },
    { "type": "text", "ok": true, "text": "Welcome to My App..." }
  ],
  "console": [{ "type": "error", "text": "..." }],
  "network": [
    { "url": "/api/data", "status": 500, "method": "GET" },
    { "url": "/api/health", "method": "GET", "error": "net::ERR_CONNECTION_REFUSED" }
  ],
  "errors": [{ "type": "pageerror", "text": "Uncaught TypeError: ..." }]
}
```

- `ok` - `true` if all actions succeeded, `false` if any failed.
- `actions` - Per-action results in the same order as the input.
- `console` - Browser console messages (errors and warnings only). Only present when there are issues.
- `network` - Failed network requests (4xx, 5xx, connection errors). Only present when there are issues.
- `errors` - Uncaught page errors. Only present when there are issues.

Always check `console`, `network`, and `errors` - they often reveal the root cause of visible UI bugs.
