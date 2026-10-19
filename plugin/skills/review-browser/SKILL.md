---
name: review-browser
description: Browser QA review - drives a headless browser to test a running web app. Use for verifying visual layout, interactive flows, error states, and runtime behavior.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
  - "Bash(cat * | node ${CLAUDE_PLUGIN_ROOT}/scripts/browse.js *)"
  - "Bash(echo * | node ${CLAUDE_PLUGIN_ROOT}/scripts/browse.js *)"
  - "Bash(mktemp -d /tmp/*)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/browse.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/browse.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js)"
  - "Bash(npm install --prefix \"${CLAUDE_PLUGIN_ROOT}\")"
  - "Bash(npx --prefix \"${CLAUDE_PLUGIN_ROOT}\" playwright-core install chromium)"
---

# Browser QA Review

**Use this when:** Verifying a running web application works correctly - visual layout, interactive flows, error states, and runtime behavior.
**Don't use this when:** Reviewing static code or markup without a running server (use /tk:review-ux). Reviewing code quality (/tk:review-code), command prompts (/tk:review-commands), plan completion (/tk:review-plan), or doing a pre-release check (/tk:review-full).

**Important:** This command requires a running dev server (e.g. `npm run dev`). It drives a real headless browser to interact with the app and take screenshots. If no server answers, start it yourself, once: add `autoStart` to the session (see Auto-Start in the browse API), which runs the project's `dev` or `start` npm script in the background and stops it when that session ends, so keep it in every later session. A project with neither script gets the background hand start in Step 1 of the review procedure below (a log file, its process id, `kill` at the end), never a foreground dev command, which holds the shell until the call times out. If it still does not answer, stop and report what you ran; do not retry.

**Prerequisites:** Browser QA needs two things, both installed inside the toolkit folder so the user's project stays untouched:

```bash
# 1. Install the Node packages (one-time, covers all toolkit features):
npm install --prefix "${CLAUDE_PLUGIN_ROOT}"

# 2. Install the Chromium browser binary:
npx --prefix "${CLAUDE_PLUGIN_ROOT}" playwright-core install chromium

# On Linux or WSL, also install system libraries (uses apt; no --prefix needed here):
sudo npx playwright-core install-deps chromium
# Alternative: install packages like libnspr4, libnss3, libgbm1 manually.
```

If the script returns a "Chromium not found" error, run steps 1 and 2 above yourself, once, then rerun the session once. The `sudo` line stays with the user: if Chromium still cannot start, relay that line and stop the review.

## Critical Rules

<rules>

1. **Report first, then fix** - Reviewing never edits files; findings with browser evidence (screenshots, console, network) are its product. After the report, the same run continues into the auto loop (rule 2), which is what applies fixes
2. **Audit, then auto-fix, with pages** - Browser QA findings are audited before the report per M2 in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`, so the report shows survivors only plus an Audited out log for the kills. They do not then wait for a human "fix it": after the report, survivors are auto-fixed and re-verified (a browser finding re-verifies by re-running the failing action, per M3's runnable-check preference), and each finding exits as page, digest, or log per `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md` (pages only per M1; saying "report only" keeps a run report-first, M10)
3. **Explain simply** - Use plain English, avoid jargon
4. **Keep sessions short** - Run multiple focused browser sessions (3-6 actions each) rather than one giant exploratory session. Shorter sessions are more reliable and easier to debug.

</rules>

## Browse Script API

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/browse-api.md"`

**Note:** The script also supports `autoStart` (auto-launches the dev server if not running), `a11y` (runs an axe-core accessibility audit of the whole page; it takes no target), and `responsive` (takes screenshots at multiple viewport widths). See the API reference above for details.

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/criteria-browser.md"`

## Reading Budget

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/reading-budget.md"`

## Severity Levels and Anchors

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/severity-anchors.md"`

**Project severity anchors** (from `.claude/toolkit/severity-anchors.md`): this project's weighting for its own review kinds. The Universal Anchors above still win. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/severity-anchors.md 2>/dev/null || true`

## Finding IDs

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-id-system.md"`

## Audit Before the Report (M2)

On a direct run of this skill you are M2's **runner**: audit your findings per M2 before writing the report. Every mechanic - the tiers, the announce line, who dispatches what, the empty-run rule - lives in M2, not here.

**Load the loop rules and the report rules now**, through the Skill tool: `Skill(tk:loop-rules)`, then `Skill(tk:report-rules)`. Everything from here on cites them, so do not go on without both in context.

**Project fix rules** (from `.claude/toolkit/fix-rules.md`). Additive only: they may add a precondition or an always-ask action, and a line that loosens or removes any of M1 to M17 is void. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/fix-rules.md 2>/dev/null || true`

## Output Format

The report template and the finding contract are in the report rules loaded before the audit (`Skill(tk:report-rules)`); write the report per them.

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view.

**The gate:** render the review page whenever this run has any surviving finding, or this branch's standing page already exists (`node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js --standing --name review` prints `"exists":true`; M16), so the run can carry it forward or take it to empty. Skip only when there are no findings and no page yet.

**When the gate fires, load the page rules now**, through the Skill tool: `Skill(tk:review-page)`, and render per them: the shell, the payload, the `--no-abs` decision and how the page reaches the user all live there.

For direct calls to this skill, pass `--name review --stable` to the helper (the standing page, per the fragment above), set `lenses` to `["browser"]` so the renderer replaces only this lens's findings and carries the other lenses' open findings forward, and omit the `chips` array (single-specialist context). Browser findings carry extra `fields` in the JSON (Expected, Actual, Screenshot as an `<img>` value, Evidence as a `<pre>` value); the review shell renders them as extra field rows inside each finding card.

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

## REMEMBER: The review phase reports and never edits files; findings are audited before the report (M2) and the auto loop applies fixes after it, both governed by `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`.

</rules>

## HTML Output Rules

When to render and the temporary-folder steps are in the report rules loaded before the audit; how a page reaches the user is in the page rules loaded at the gate. Nothing is pasted here.
