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

Read the screenshot (use the Read tool on the returned path) and the text output to understand the current state. Briefly state what you think the app does and which flows you plan to test. On a direct run, let the user correct you before proceeding; a dispatched finder states its plan and goes on.

**If the page is a login screen:** Tell the user you can't test behind authentication. Suggest they either provide a pre-authenticated URL, test only public pages, or add `fill` actions for login credentials as the first steps.

### Step 2: Test key user flows

Based on what you see, run focused sessions (3-6 actions each) to test the main interactive flows. Aim for 3-5 sessions, max 8. For example:
- Navigate to a page, fill a form, submit, check the result
- Click through navigation, verify pages load
- Test error states (submit empty forms, click disabled buttons)

Then check that state survives the page redrawing itself. A still screenshot cannot show any of these, so run them as sessions:
- **A keystroke between two renders.** Type into a field, wait past a render (1 second, or one full cycle of the page's animation), and read the field back with `value`. The typed text must still be there.
- **An armed two-step control across a re-render.** Click the first half of a two-step action (a delete that asks for a second click, a confirm), wait the same way, and read its text. The armed state must still show, and the second click must still complete the action.
- **A re-render when nothing changed.** Set something (a draft, an armed step, an open panel), then leave the page idle for a few seconds and read it again. Anything that reverted while nothing else on screen changed means the page redraws itself without cause, and that is a finding.

When the Run notes carry a `[behaviour]` line from the plan's must-check list, run these three checks on every stateful control of the surface it names that the design loop's pass did not cover. The checks count toward the 8-session cap; when the controls outnumber it, cover one control of each kind (field, two-step control, panel) and name the rest under "What I could not check".

Each session should have a clear purpose. After each session, read the screenshots and check the JSON output for console errors, failed network requests, and page errors.

**When actions fail:** If a session stops on a failed action, run a new session with just a screenshot to see the current state. Adjust your selectors or action sequence. Don't retry the same failing action more than once. The exception is a click or read that times out on a control the screenshot shows on a page that keeps redrawing: that is a finding of the kind above (the control is rebuilt faster than a click can land), not a selector to adjust.

**Note:** Browser sessions are sequential by nature, so a browser review never fans out: one agent runs every session in order, whether that is you on a direct run or the browser finder `/tk:review` dispatched. That constraint is about browser sessions only: the M2 audit tiers below still dispatch their skeptic subagents after the sessions are done.

### Step 3: Compile findings

Use the evidence you gathered (screenshots, text, console errors, network failures) to write findings in the standard review format below.

</procedure>
