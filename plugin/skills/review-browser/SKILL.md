---
name: review-browser
description: Browser QA review - drives a headless browser to test a running web app. Use for verifying visual layout, interactive flows, error states, and runtime behavior.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh *)"
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh)"
  - "Bash(cat * | node ${CLAUDE_PLUGIN_ROOT}/scripts/browse.js *)"
  - "Bash(echo * | node ${CLAUDE_PLUGIN_ROOT}/scripts/browse.js *)"
  - "Bash(mktemp -d /tmp/*)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/browse.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/browse.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js)"
  - "Bash(npm install --prefix \"${CLAUDE_PLUGIN_ROOT}\")"
  - "Bash(npx --prefix \"${CLAUDE_PLUGIN_ROOT}\" playwright-core install chromium)"
---

# Browser QA Review

Be thorough but concise.

**Use this when:** Verifying a running web application works correctly - visual layout, interactive flows, error states, and runtime behavior.
**Don't use this when:** Reviewing static code or markup without a running server (use /tk:review-ux). Reviewing code quality (/tk:review-code), command prompts (/tk:review-commands), plan completion (/tk:review-plan), or doing a pre-release check (/tk:review-full).

**Important:** This command requires a running dev server (e.g. `npm run dev`). It drives a real headless browser to interact with the app and take screenshots. Ask the user to confirm the server is running before you start.

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

If the script returns a "Chromium not found" error, relay these install instructions to the user and stop the review.

## Critical Rules

<rules>

1. **THE REVIEW PHASE REPORTS ONLY** - Reviewing never edits files; findings with browser evidence (screenshots, console, network) are its product. After the report, the same run continues into the auto loop (rule 2), which is what applies fixes
2. **Audit, then auto-fix, with pages** - Browser QA findings are audited before the report per M2 in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`, so the report shows survivors only plus an Audited out log for the kills. They do not then wait for a human "fix it": after the report, survivors are auto-fixed and re-verified (a browser finding re-verifies by re-running the failing action, per M3's runnable-check preference), and each finding exits as page, digest, or log per `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md` (pages only per M1; saying "report only" keeps a run report-first, M10)
3. **Explain simply** - Use plain English, avoid jargon
4. **Keep sessions short** - Run multiple focused browser sessions (3-6 actions each) rather than one giant exploratory session. Shorter sessions are more reliable and easier to debug.

</rules>

## Browse Script API

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/browse-api.md"`

**Note:** The script also supports `autoStart` (auto-launches the dev server if not running), `a11y` (runs accessibility audits on the page or a specific element), and `responsive` (takes screenshots at multiple viewport widths). See the API reference above for details.

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/criteria-browser.md"`

## Reading Budget

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/reading-budget.md"`

## Severity Levels and Anchors

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/severity-anchors.md"`

## Finding IDs

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-id-system.md"`

## Audit Before the Report (M2)

On a direct run of this skill you are M2's **runner**: audit your findings per M2 below before writing the report. Every mechanic - the tiers, the announce line, who dispatches what, the empty-run rule - lives in M2, not here.

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md"`

## Output Format

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/report-format.md"`

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-contract.md"`

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template:

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/html-render-review.md"`

For direct calls to this skill, pass `--name review --stable` to the helper (the standing page, per the fragment above), set `lenses` to `["browser"]` so the renderer replaces only this lens's findings and carries the other lenses' open findings forward, and omit the `chips` array (single-specialist context). Browser findings carry extra `fields` in the JSON (Screenshot as an `<img>` value, Evidence as a `<pre>` value, Expected, Actual); the review shell renders them as extra field rows inside each finding card.

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

Every HTML decision above (whether to render, `--no-abs`, publish or open locally, record the publish) is governed by the shared rules fragment, inlined here so it is in context when the render runs. It was an always-on rules file until v7.0.0 (issue #167); now it loads with the commands that need it.

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md"`
