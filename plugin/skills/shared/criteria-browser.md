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

**Note:** Browser sessions are sequential by nature, so the review phase always runs in single-pass mode - no sub-agents ever drive the browser. That constraint is about browser sessions only: the M2 audit tiers below still dispatch their skeptic subagents after the sessions are done.

### Step 3: Compile findings

Use the evidence you gathered (screenshots, text, console errors, network failures) to write findings in the standard review format below.

</procedure>
