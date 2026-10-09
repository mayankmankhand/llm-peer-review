## Review Procedure

<procedure>

### Step 1: Take an initial screenshot and read the page

Run the initial session below. If the `goto` action fails with a connection error, start the server once. Prefer `autoStart` (see Auto-Start in the browse API): it runs the project's `dev` npm script, else its `start` script, in the background, and stops it when that session ends, so keep `autoStart` in every later session too (a server that already answers makes it a no-op). A project with neither script needs a hand start, and never in the foreground, where a dev command holds the shell until the call times out: make a folder with `mktemp -d /tmp/dev-server.XXXXXX`, run `<dev command> > <folder>/server.log 2>&1 & echo $!` to start it in the background, keep the process id it prints, and stop it with `kill <pid>` when the review ends, early or not; if you cannot, name that process id in your last message. That hand start is for a direct run, where the user is there to approve the redirect; a dispatched finder never starts a server by hand, and when the auto-start finds no script it returns `NO FINDINGS` with a `NOT CHECKED:` line saying so. If it still does not answer, tell the user: "I can't reach the server. Check that your dev server is running (e.g. `npm run dev`) and confirm the port number." Then stop the review; do not retry. A dispatched finder has no user to tell: it returns `NO FINDINGS` with the line `NOT CHECKED: the server at <baseUrl> did not answer, so no page was tested`, and stops.

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

**If the page is a login screen:** Tell the user you can't test behind authentication. Suggest they either provide a pre-authenticated URL, test only public pages, or add `fill` actions for login credentials as the first steps. A dispatched finder returns a `NOT CHECKED:` line saying the page is a login screen and nothing behind it was tested, then tests the public pages it can reach.

### Step 2: Test key user flows

Based on what you see, run focused sessions (3-6 actions each) to test the main interactive flows. Aim for 3-5 sessions, max 8. For example:
- Navigate to a page, fill a form, submit, check the result
- Click through navigation, verify pages load
- Test error states (submit empty forms, click disabled buttons)

Then check that state survives the page redrawing itself. A still screenshot cannot show any of these, so run them as sessions:
- **A keystroke between two renders.** Type into a field, wait past a render (1 second, or one full cycle of the page's animation), and read the field back with `value`. The typed text must still be there.
- **An armed two-step control across a re-render.** Click the first half of a two-step action (a delete that asks for a second click, a confirm), wait the same way, and read its text. The armed state must still show, and the second click must still complete the action.
- **A re-render when nothing changed.** Set something (a draft, an armed step, an open panel), then leave the page idle for a few seconds and read it again. Anything that reverted while nothing else on screen changed means the page redraws itself without cause, and that is a finding.

When the Run notes carry a `[behaviour]` line from the plan's must-check list, run these three checks on every stateful control of the surface it names that the design loop's pass did not cover. The checks count toward the 8-session cap; when the controls outnumber it, cover one control of each kind (field, two-step control, panel) and name the rest under "What I could not check" (a dispatched finder: in one `NOT CHECKED:` line).

Each session should have a clear purpose. After each session, read the screenshots, and take the console, failed-request and page-error counts from the saved output with the count one-liner under "Output Format" in the Browse Script API, never by eye (M16): `ok` true and all three counts 0 is a clean session, and any count above 0 is entries to read.

**When actions fail:** If a session stops on a failed action, run a new session with just a screenshot to see the current state. Adjust your selectors or action sequence. Don't retry the same failing action more than once. The exception is a click or read that times out on a control the screenshot shows on a page that keeps redrawing: that is a finding of the kind above (the control is rebuilt faster than a click can land), not a selector to adjust.

**Note:** Browser sessions are sequential by nature, so a browser review never fans out: one agent runs every session in order, whether that is you on a direct run or the browser finder `/tk:review` dispatched. That constraint is about browser sessions only: the M2 audit tiers below still dispatch their skeptic subagents after the sessions are done.

### Step 3: Compile findings

Use the evidence you gathered (screenshots, text, console errors, network failures) to write findings in the standard review format below.

</procedure>
