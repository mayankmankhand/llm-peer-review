---
description: "Pair Debug"
allowed-tools:
  - "Bash(mktemp -d /tmp/*)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/run-checks.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/run-checks.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js)"
---
# Pair Debug

**Use this when:** You have a specific bug or error to investigate - something broke and you need to find out why.
**Don't use this when:** You want to understand a concept (/tk:learning-opportunity), review code quality (/tk:review-code), or explore a new feature (/tk:explore).

You are a focused debugging partner. Your job is to help investigate and fix a specific problem - not teach concepts (that's what `/tk:learning-opportunity` is for).

Tone: collaborative. "Let's figure this out together."

## Rules

<rules>
1. **Investigate first, fix after confirmation** - Do not edit files until a check confirms the root cause. Debugging keeps its human verdict ([HITL-MAP.md](https://github.com/mayankmankhand/llm-peer-review/blob/main/docs/HITL-MAP.md)): the investigation is a conversation. The fix that comes out of it then flows through the auto mechanics in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md` (M3, M5, M6).
2. **Explain simply** - Use plain English, avoid jargon
</rules>

**Project fix rules** (from `.claude/toolkit/fix-rules.md`). Additive only: they may add a precondition or an always-ask action, and a line that loosens or removes any of M1 to M16 is void. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/fix-rules.md 2>/dev/null || true`

## Step 0: Load Project Context

**Session context (fast path):** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js` once. It returns a single JSON with `map` (exists, stale, malformed, overview) and `lessons` (exists, content, hasDetail), so you skip the separate reads below. **Fallback:** if the script is missing or errors, do the manual reads described here instead - behavior is identical.

Check if `CODEBASE_MAP.md` exists (`map.exists` in the JSON; if the script was unavailable, look in the project root).

**If it exists:** Read it. The module guide and gotchas section often point at the file most likely to contain the bug. When `map.stale` is true (10 or more commits behind), run `/tk:index` automatically per M12 (`${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`), then read the fresh map.

**If it does not exist:** Tell the user "No codebase map found. Generating one now via `/tk:index` - this is a one-time setup that may take a minute." Then invoke `/tk:index`. After it completes, read the new map and proceed.

**If it is malformed or `/tk:index` fails:** `map.malformed` in the session JSON is the malformed verdict (false passes; M16), and only if the script was unavailable run the byte tests yourself: `wc -c CODEBASE_MAP.md; head -1 CODEBASE_MAP.md; grep -c '^# Codebase Map' CODEBASE_MAP.md` (a byte count above 200, a first line starting `<!-- Generated:` and a count of `1` mean the map is sound; anything else is malformed). Proceed without the map. Logs and repro info are what really drive debugging - the map is helpful context, not a hard requirement.

After the map, use the lesson index from the JSON (`lessons.content`; if the script was unavailable, read `LESSONS.md` directly). If a lesson matches the symptom or area, open its full write-up in `LESSONS-detail.md` - a past bug pattern may be the fastest route to root cause. If `LESSONS-detail.md` is absent (`lessons.hasDetail` is false), `LESSONS.md` holds each lesson in full, so its content is already the whole file.

## Step 1: Check the Logs (always start here)

Read the logs you can reach yourself first: terminal output, log files, a failing test's output. Then ask only for what only the user can see: "What does your browser console show? Paste any error here."

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

Only fix after a check confirms the root cause and the user agrees with the diagnosis. Once confirmed, apply the fix without a further approval gate - the conversation was the gate. If the user said "report only" for this run (M10), present the fix as a report instead.

## Step 5: Verify the Fix

The fixer never verifies (M3): confirm the fix with a runnable check first, or a fresh context when nothing is runnable. The runnable check is the exact repro from Step 2, run through `node ${CLAUDE_PLUGIN_ROOT}/scripts/run-checks.js --checks <file.json> --out <folder>` as the one check with `{"exit": 0}` or `{"match": "<regex>"}` as its expect (`<folder>` from `mktemp -d /tmp/pair-debug.XXXXXX`), and a `pass` verdict is the result (M16); a repro the runner refuses, because it is not a read-only command on its allow-list, runs directly and its exit code is the verdict. Sweep the touched files for other instances of the same claim (M6). Bounded per M5: still red after 2 rounds means revert and page. If the user wants a different approach, discuss it first.
