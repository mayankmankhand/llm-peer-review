# Browser QA Review Task

Be thorough but concise.

**Use this when:** Verifying a running web application works correctly - visual layout, interactive flows, error states, and runtime behavior.
**Don't use this when:** Reviewing static code or markup without a running server (use /review-ux). Reviewing code quality (/review-code), command prompts (/review-commands), plan completion (/review-plan), or doing a pre-release check (/review-full).

**Important:** This command requires a running dev server (e.g. `npm run dev`). It drives a real headless browser to interact with the app and take screenshots. Ask the user to confirm the server is running before you start.

**Prerequisites:** Requires `playwright-core` (`npm install playwright-core`) and a Chromium binary (`npx playwright-core install chromium`). On Linux/WSL, system libraries are also needed: `sudo npx playwright-core install-deps chromium` (or install packages like `libnspr4`, `libnss3`, `libgbm1` manually). If the script returns a "Chromium not found" error, relay the install instructions to the user and stop the review.

## CRITICAL RULES
<rules>
1. **REPORT ONLY** - Do NOT make any changes or edits to files
2. **Wait for approval** - Only fix things after I say "fix it"
3. **Explain simply** - I'm a PM learning to code, use plain English
4. **Keep sessions short** - Run multiple focused browser sessions (3-6 actions each) rather than one giant exploratory session. Shorter sessions are more reliable and easier to debug.
</rules>

## How to Use the Browser Script

<procedure>

### Invoking the Script

Write your action sequence as JSON, save to a temp file, and pipe it to the script:

```bash
cat /tmp/browse-actions.json | node scripts/browse.js
```

### Input Format

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

### Action Types

| Action | Fields | What it does |
|--------|--------|-------------|
| `goto` | `url` (resolved against baseUrl) | Navigate to a page. Must be the first action. |
| `click` | `target` (selector) | Click an element |
| `fill` | `target` (selector), `value` | Type text into an input field |
| `screenshot` | none | Take a full-page screenshot (saved to /tmp) |
| `text` | `target` (optional selector) | Extract visible text from page or element |
| `wait` | `ms` or `selector` (note: uses `selector`, not `target`) | Wait for time or for an element to appear |

### Selector Syntax

Use these prefixes to target elements:

| Prefix | Example | What it matches |
|--------|---------|----------------|
| `css:` | `css:.btn-submit` | CSS selector |
| `text:` | `text:Sign In` | Text content (substring) |
| `role:` | `role:button:Submit` | ARIA role with name |
| (none) | `.btn-submit` | Treated as CSS selector |

### Output Format

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

The `console`, `network`, and `errors` fields only appear when there are issues to report. Always check them - they often reveal the root cause of visible UI bugs.

</procedure>

## Review Procedure

<procedure>

### Step 1: Take an initial screenshot and read the page
Run the initial session below. If the `goto` action fails with a connection error, tell the user: "I can't reach the server. Check that your dev server is running (e.g. `npm run dev`) and confirm the port number." Then stop the review.
Run a quick browser session to see what's on screen:
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

Read the screenshot (use the Read tool on the returned path) and the text output to understand the current state. Briefly state what you think the app does and which flows you plan to test. Let the user correct you before proceeding.

**If the page is a login screen:** Tell the user you can't test behind authentication. Suggest they either provide a pre-authenticated URL, test only public pages, or add `fill` actions for login credentials as the first steps.

### Step 2: Test key user flows
Based on what you see, run focused sessions (3-6 actions each) to test the main interactive flows. Aim for 3-5 sessions, max 8. For example:
- Navigate to a page, fill a form, submit, check the result
- Click through navigation, verify pages load
- Test error states (submit empty forms, click disabled buttons)

Each session should have a clear purpose. After each session, read the screenshots and check the JSON output for console errors, failed network requests, and page errors.

**When actions fail:** If a session stops on a failed action, run a new session with just a screenshot to see the current state. Adjust your selectors or action sequence. Don't retry the same failing action more than once.

**Note:** Browser sessions are sequential by nature, so this command always runs in single-pass mode (no sub-agents).

### Step 3: Compile findings
Use the evidence you gathered (screenshots, text, console errors, network failures) to write findings in the standard review format below.

</procedure>

## Severity Levels
<reference>
- 🚫 **Block** - Users will get stuck, lose data, or be unable to complete a key task. Must fix.
- ⚠️ **Warn** - Usability pain point that will frustrate users or exclude some. Should fix.
- 💡 **Suggest** - Polish item. Improves experience but users can work around it.

<!-- Shared block - keep in sync with other review-*.md files -->
**Severity anchors (apply to all review types):**
These categories have minimum severity floors - never downgrade them:
- Exposed secrets, insecure auth, or injection risks = always at least **Warn**, usually **Block**
- Data loss or irreversible user harm without safeguards = always at least **Warn**
- Accessibility failures blocking keyboard/screen-reader on primary tasks = always at least **Warn**
- Committed requirements plainly unmet = always at least **Warn**

**Browser review weighting:**
- Page crashes, blank screens, or broken core flows = lean toward **Block**
- Console errors, failed API calls, or layout issues on main pages = lean toward **Warn**
- Minor visual glitches or slow loading = lean toward **Suggest**
</reference>

## Finding IDs

<reference>
Every finding gets a unique ID: **R1**, **R2**, **R3**, etc. This lets the user say "fix R2 and R5" to approve specific fixes.

To fix specific issues after the review, say "fix R2" or "fix R2 and R5". For a code-level review of the fixes, run `/review-code`.
</reference>

## Output Format
<output_format>
### Top Issues (scannable summary)
```
🚫 X Blocks: R1 (page - one-line description), R3 (page - one-line description)
⚠️ X Warns: R2 (page - one-line description)
💡 X Suggests: R4 (page - one-line description)
```

### ✅ Looks Good
- [What's working well - 2-3 items]

### 🔍 Findings

- **R1** 🚫 `page/route` - [Issue description in plain English]
  - **Screenshot:** [path to screenshot showing the issue]
  - **Why:** [Why this matters to users]
  - **Evidence:** [Console errors, failed API calls, or text output that supports the finding]
  - **Expected:** [What should happen]
  - **Actual:** [What actually happens]
  - **Fix direction:** [What to change - not the exact code, just the approach]

- **R2** ⚠️ `page/route` - [Issue description]
  - **Screenshot:** [path]
  - **Why:** [Why this matters]
  - **Evidence:** [Supporting data]
  - **Fix direction:** [Approach]
</output_format>

### 🏗️ Staff QA Check
<guidelines>
After the standard review, step back and evaluate as a staff QA engineer:
- **Core flow works?** - Can the user complete the main task the app is built for?
- **Error handling** - What happens when things go wrong? Are errors helpful or cryptic?
- **Console health** - Are there warnings or errors that suggest deeper problems?
- **Network health** - Are API calls succeeding? Any unexpected 4xx/5xx responses?
- **What would you flag before release?** - What would a senior QA engineer escalate?
</guidelines>

### 📊 Summary
- Pages tested: X
- Browser sessions run: X
- Blocks: X | Warns: X | Suggests: X

<rules>
## REMEMBER: Report issues only. Do NOT edit any files until I approve.
</rules>
