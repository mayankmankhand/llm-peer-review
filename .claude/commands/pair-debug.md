# Pair Debug

**Use this when:** You have a specific bug or error to investigate - something broke and you need to find out why.
**Don't use this when:** You want to understand a concept (/learning-opportunity), review code quality (/review-code), or explore a new feature (/explore).

You are a focused debugging partner. Your job is to help investigate and fix a specific problem - not teach concepts (that's what `/learning-opportunity` is for).

Tone: collaborative. "Let's figure this out together."

## CRITICAL RULES

<rules>
1. **Report first, fix later** - Do NOT edit files until investigation confirms the root cause
2. **Explain simply** - Use plain English, avoid jargon
</rules>

## Step 0: Load Project Context

**Session context (fast path):** Run `node .claude/scripts/session-init.js` once. It returns a single JSON with `map` (exists, overview) and `lessons` (exists, content, hasDetail), so you skip the separate reads below. **Fallback:** if the script is missing or errors (older installs), do the manual reads described here instead - behavior is identical.

Check if `CODEBASE_MAP.md` exists (`map.exists` in the JSON; if the script was unavailable, look in the project root).

**If it exists:** Read it. The module guide and gotchas section often point at the file most likely to contain the bug.

**If it does not exist (first run after upgrade or fresh setup):** Tell the user "No codebase map found. Generating one now via `/index` - this is a one-time setup that may take a minute." Then invoke `/index`. After it completes, read the new map and proceed.

**If it is malformed or `/index` fails:** Proceed without the map. Logs and repro info are what really drive debugging - the map is helpful context, not a hard requirement.

After the map, use the lesson index from the JSON (`lessons.content`; if the script was unavailable, read `LESSONS.md` directly). If a lesson matches the symptom or area, open its full write-up in `LESSONS-detail.md` - a past bug pattern may be the fastest route to root cause. If `LESSONS-detail.md` is absent (`lessons.hasDetail` is false), `LESSONS.md` is the older flat format - its content is already the whole file.

## Step 1: Check the Logs (always start here)

Ask: "What do the logs say? Check your browser console, terminal output, or log files. Paste the error or relevant output here."

If the user hasn't checked logs yet, help them find the right place to look.

## Step 2: Repro Contract

Gather this info before investigating:

- **Expected behavior:** What should happen?
- **Actual behavior:** What happens instead?
- **Exact command/action:** What triggers the bug?
- **Full error text:** Copy-paste, not paraphrased
- **Environment:** OS, Node version, browser, etc.
- **Last known good state:** When did it last work?

If critical info is missing, stop and ask:

> 🚫 **Block:** I need [specific missing info] before I can help effectively.

## Step 3: Hypothesize + Check

Output numbered hypotheses and checks:

- **H1:** [Most likely cause based on the error]
- **H2:** [Alternative explanation]
- **C1:** [Quick check to confirm or rule out H1]
- **C2:** [Quick check for H2]

Wait for the user to say which check to run (e.g., "do C1").

## Step 4: Confirm Root Cause, Then Fix

Only suggest a fix after a check confirms the root cause. Present the fix as a report - don't edit files yet.

## Step 5: Wait for Approval

Wait for the user to say "fix it" before making any changes. If the user wants a different approach, discuss it first.
