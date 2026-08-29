---
name: review-browser
description: Browser QA review - drives a headless browser to test a running web app. Use for verifying visual layout, interactive flows, error states, and runtime behavior.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
---

# Browser QA Review

Be thorough but concise.

**Use this when:** Verifying a running web application works correctly - visual layout, interactive flows, error states, and runtime behavior.
**Don't use this when:** Reviewing static code or markup without a running server (use /review-ux). Reviewing code quality (/review-code), command prompts (/review-commands), plan completion (/review-plan), or doing a pre-release check (/review-full).

**Important:** This command requires a running dev server (e.g. `npm run dev`). It drives a real headless browser to interact with the app and take screenshots. Ask the user to confirm the server is running before you start.

**Prerequisites:** Browser QA needs two things, both installed inside the toolkit folder so the user's project stays untouched:

```bash
# 1. Install the Node packages (one-time, covers all toolkit features):
npm install --prefix .claude/scripts

# 2. Install the Chromium browser binary:
npx --prefix .claude/scripts playwright-core install chromium

# On Linux or WSL, also install system libraries (uses apt; no --prefix needed here):
sudo npx playwright-core install-deps chromium
# Alternative: install packages like libnspr4, libnss3, libgbm1 manually.
```

If the script returns a "Chromium not found" error, relay these install instructions to the user and stop the review.

## Critical Rules

<rules>

1. **THE REVIEW PHASE REPORTS ONLY** - Reviewing never edits files; findings with browser evidence (screenshots, console, network) are its product. After the report, the same run continues into the auto loop (rule 2), which is what applies fixes
2. **Audit, then auto-fix, with pages** - Browser QA findings are audited before the report per M2 in `.claude/skills/shared/hitl-loop.md`, so the report shows survivors only plus an Audited out log for the kills. They do not then wait for a human "fix it": after the report, survivors are auto-fixed and re-verified (a browser finding re-verifies by re-running the failing action, per M3's runnable-check preference), and each finding exits as page, digest, or log per `.claude/skills/shared/hitl-loop.md` (pages only per M1; saying "report only" keeps a run report-first, M10)
3. **Explain simply** - Use plain English, avoid jargon
4. **Keep sessions short** - Run multiple focused browser sessions (3-6 actions each) rather than one giant exploratory session. Shorter sessions are more reliable and easier to debug.

</rules>

## Browse Script API

!`cat .claude/skills/shared/browse-api.md`

**Note:** The script also supports `autoStart` (auto-launches the dev server if not running), `a11y` (runs accessibility audits on the page or a specific element), and `responsive` (takes screenshots at multiple viewport widths). See the API reference above for details.

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

## Reading Budget

!`cat .claude/skills/shared/reading-budget.md`

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Audit Before the Report (M2)

You are M2's **runner**: audit your own findings before writing the report, then report survivors only, with an Audited out log for the kills. Run every receipt yourself, and dispatch the skeptic tiers to fresh subagents rather than judging your own findings.

Do not improvise a lighter version. A direct run is a deliberate focused check, not a cheaper one, and the Audited out section in the format below is only honest if an audit actually ran. M2 is inlined here rather than cited by path because a pointer to a procedure you cannot read is not an instruction.

!`cat .claude/skills/shared/hitl-loop.md`

## Output Format

!`cat .claude/skills/shared/output-template.md`

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template:

!`cat .claude/skills/shared/html-render-review.md`

For direct calls to this skill, pass `--name review-browser` to the helper and omit the `chips` array (single-specialist context). Browser findings carry extra `fields` in the JSON (Screenshot as an `<img>` value, Evidence as a `<pre>` value, Expected, Actual); the review shell renders them as extra field rows inside each finding card.

### Staff QA Check

<guidelines>

After the standard review, step back and evaluate as a staff QA engineer:
- **Core flow works?** - Can the user complete the main task the app is built for?
- **Error handling** - What happens when things go wrong? Are errors helpful or cryptic?
- **Console health** - Are there warnings or errors that suggest deeper problems?
- **Network health** - Are API calls succeeding? Any unexpected 4xx/5xx responses?
- **What would you flag before release?** - What would a senior QA engineer escalate?

</guidelines>

<rules>

## REMEMBER: The review phase reports and never edits files; findings are audited before the report (M2) and the auto loop applies fixes after it, both governed by `.claude/skills/shared/hitl-loop.md`.

</rules>
