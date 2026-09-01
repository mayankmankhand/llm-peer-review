# Initial Exploration Stage

**Use this when:** Starting a new feature, strategic question, or refactor that needs scoping or vision-level thinking before any code is written.
**Don't use this when:** You already have a clear plan (use `/create-plan`) or you are debugging a specific bug (use `/pair-debug`).

<rules>
Your task is NOT to implement this yet, but to fully understand and prepare.
</rules>

## Mode Detection

<phase name="mode-detection">
Before diving into questions, pick a gear with the user.

### Two Gears
- **Scoping mode** - the user has a concrete idea and needs help defining scope. Pressure-test, narrow down, get to a clear definition of done.
- **Vision mode** - the user is thinking big-picture and needs help exploring possibilities. Challenge premises, expand the space, decide what to build before how.

### Issue Host

Two places below read an issue: mode detection here, and the worktree rename in the Worktree Setup phase. Either one can be the first to fire, or the first can never fire at all. So detect the host **once, here, unconditionally**, before Phase 1 begins, and reuse that result for the rest of the session.

!`cat .claude/skills/shared/host-cli.md`

### Pick a Mode
Don't try to guess silently. Always ask, but pre-fill your best guess so it's a one-keystroke decision when you guess right.

1. Read the user's input and form a best guess: scoping or vision.
2. **If the input references an issue**, read it first with the **"Read issue" row** for the detected host, and let the issue body inform your guess. Take the field name from that row too: the issue body is not called the same thing on both hosts. The issue number alone often looks concrete when the body is exploratory. Recognize all of these forms:
   - `issue 88`, `#88`, `ticket 88` -> use the number directly
   - An issue URL -> extract the number with the **"Issue URL" note** above. Read it rather than parsing by hand: it holds the per-host anchors, the two paths GitLab serves the same issue under, and why the LAST match is the one to take
   - A bare number on its own (e.g. just `88`) -> ask "Is that an issue number?" before fetching, since a bare number can mean other things
3. Ask the user with this exact wording, substituting your guess in the brackets:
   > Scoping or vision? [scoping]
4. Interpret the answer:
   - Empty input or just enter -> proceed with the bracketed guess
   - Anything that clearly maps to scoping or vision (the word itself, single letters `s`/`v`, or common synonyms like "narrow it down" / "big picture") -> use that mode
   - Truly ambiguous input -> proceed with the bracketed guess but acknowledge it out loud: "Couldn't tell from that - going with scoping. Say 'switch to vision mode' anytime."

Once the mode is picked, announce it briefly and tell the user how to switch. Example:
> "Going with **vision mode**. Say 'switch to scoping mode' anytime if you'd rather narrow down."

### Manual Override
The user can say "switch to vision mode" or "switch to scoping mode" at any point during the conversation. The mode is sticky - once set, it stays until the user explicitly switches again. When switching modes, don't restart the conversation. Continue from where you are, but adjust your tone and question style to match the new mode.

Re-surface the switch option at natural transition points: after the scope dial, before Phase 2, or if the user's language shifts (e.g., concrete answers in vision mode, or vague answers in scoping mode).

### Phase Markers
Announce transitions so the user knows where they are: "Now moving to codebase analysis (Phase 2)" or "Here's my closing summary." This is especially important in vision mode where conversations can run long.
</phase>

## Phase 1: Challenge the Idea

<phase name="challenge-the-idea">
After the user describes their idea, **think like an experienced product manager**. Your job is to pressure-test the idea before touching any code.

### Tone

**Scoping mode:**
- Direct and skeptical: "I need to understand X before we proceed"
- Challenge assumptions, cut through fluff
- Don't be gentle, but don't be rude

**Vision mode:**
- Expansive and curious: "Let's think bigger - what if..."
- Challenge premises, not just scope: "Are we even solving the right problem?"
- Push the user to dream before narrowing down
- Give permission to scrap and rethink

**Both modes:** Challenge the idea, not the person.

### How to Ask Questions
Ask **3-4 focused questions per round**, max 2-3 rounds total. Keep it digestible:

- **Group related questions** - don't scatter topics
- **Number them** - easy to reference in answers
- **Keep each question short** - one sentence, not a paragraph
- **Front-load the most important one** - in case they only answer a few

<examples>
**Bad example:**
> 1. What's in scope? I'm asking because there are multiple directories and I'm not sure if manager_package is part of this or separate, and also the PLAN files seem complete so should those be archived or deleted, and speaking of which...

**Good example:**
> A few quick questions:
> 1. What's in scope - just the web app, or the review commands too?
> 2. The 3 completed PLAN files - delete, archive, or keep?
> 3. What about manager_package/ and toon_flow/ - part of this project?
</examples>

### Scoping Mode Questions (pick 3-4 per round)
Only ask what's genuinely unclear. Skip what's already answered.

- **What problem are we solving?** (Is this a real pain point or a nice-to-have?)
- **Why now?** (What's the urgency? What happens if we don't do this?)
- **What does success look like?** (How will we know this worked?)
- **What's the definition of done?** (Minimum viable scope - what's in, what's out?)
- **What are we trading off?** (What else could we build instead? What's the cost?)
- **Does this contradict anything?** (Existing decisions, scope, or priorities?)
- **What should this look like?** (Layout, style, visual direction)
- **How should this behave?** (Interactions, flows, states)

### Vision Mode Questions (pick 3-4 per round)
Only ask what's genuinely unclear. Skip what's already answered.

Start with premise and challenge questions, then move to analogy and benchmarking. If the user seems unfamiliar with a concept (e.g., 10-star thinking), briefly explain it before asking:

- **Are we solving the right problem?** (Challenge the premise, not just the solution)
- **What's the 10-star version of this?** (No constraints - what's the ideal product experience and business outcome?)
- **What does this look like in 6 months?** (How does this decision age? What will we wish we'd done differently?)
- **What would you scrap entirely?** (If you started over today, what would you throw away and rethink?)
- **What are we afraid of?** (What's the risk we're not talking about?)
- **Who else does this well?** (What can we learn from how others solved this?)

### Synthesis Checkpoints (vision mode only)
Between rounds, briefly summarize what you're hearing before asking more questions: "Here's what I'm hearing so far: [2-3 bullet summary]. Does that track?" This keeps the conversation grounded and helps the user see their own thinking reflected back.

### Scope Dial (vision mode only)
Once the user's answers start pointing toward a direction (usually round 2, sometimes later), offer the scope dial:
> "Now that we've explored the space, where do you want to land?"
> - **Expand** - dream big, pursue the 10-star version
> - **Hold** - keep the current scope but apply what we just discussed
> - **Reduce** - strip to absolute essentials

**After the user picks:**
- **Expand** - continue with vision mode questions, push even bigger. If the user picks Expand twice, re-offer the Scope Dial after one more round. If they pick Expand a third time, gently suggest Hold: "We've explored a lot of territory - want to lock in what we have and move to planning?"
- **Hold or Reduce** - shift to scoping-style questions (definition of done, trade-offs, success criteria) but keep the vision mode tone. This avoids conversational whiplash. Also bring in UI/UX Preferences if the feature involves a UI.
- Phase 2 stays optional regardless of which dial option was chosen

### UI/UX Preferences (scoping mode, or vision mode after Hold/Reduce)

When the feature involves a user interface (a page, dashboard, form, component, etc.):

1. **Proactively ask** about look and behavior as part of your Phase 1 questions. Don't wait for the user to bring it up.
2. **Accept any format** - the user might give code, a text description, a design guide, or just a rough idea. All are valid.
3. **If the user says "you decide"** - don't leave it vague. Propose a specific direction (e.g., "I'm thinking a two-column layout with a sidebar for filters") and get a soft confirmation before moving on.
4. **Document the outcome** - whether the user gave detailed guidance or approved your proposal, these decisions will feed into `/create-plan`'s UI/UX Design section.

### Explain the Why
Briefly explain *why* you're asking when it adds value. Example: "I'm asking about success criteria because unclear goals often lead to scope creep."

### Smart Behavior
- **If the user's description is solid and complete** - acknowledge it and move to Phase 2. Don't force questions just to hit a quota.
- **If there are real gaps or red flags** - push back. Limit yourself to 3-4 questions max per round, but drop to a single focused question if one issue is clearly blocking.
- **Recognize good thinking** - if they've clearly thought it through, say so and proceed.
</phase>

## Worktree Setup (between Phase 1 and Phase 2)

<phase name="worktree-setup">
Before starting codebase analysis, check if this session is running in a Git worktree. A worktree is a separate working folder linked to the same repo - it lets you work on a feature without touching your main code.

**Session context (fast path):** Run `node .claude/scripts/session-init.js` once now. It returns a single JSON with everything this command reads at startup, so you can skip the individual git/file roundtrips below: `worktree` (isWorktree, gitDir, commonDir, branch) for the detection in this section, `map` (exists, commit, headCommit, commitsBehind, stale, generatedWhileDirty, overview) for the Phase 2 staleness check, and `lessons` (exists, content, hasDetail) for the Phase 2 lessons read. **Fallback:** if the script is missing or errors (older installs), do the manual reads described in this section and Phase 2 instead - behavior is identical.

### How to detect a worktree
Use `worktree.isWorktree` from the session-init JSON. Only if the script was unavailable, fall back to comparing the output of these two commands:
- `git rev-parse --git-dir` - the Git directory for this working copy
- `git rev-parse --git-common-dir` - the shared Git directory for the whole repo

If they return different values, you are in a worktree. If they match, you are in the main working copy.

### What to do

**If in a worktree AND an issue number came up during Phase 1:**
1. Check if the current branch already matches the `worktree-<number>-<label>` pattern. If so, skip - it's already named correctly.
2. If you only have an issue number (no title), fetch it with the **"Read issue" row** for the detected host (detect it now if Phase 1 never needed it, per the Issue Host section)
3. If in detached HEAD state, create a branch instead: `git checkout -b worktree-<issue-number>-<short-label>`
4. Otherwise, rename the current branch: `git branch -m worktree-<issue-number>-<short-label>`
   - The short label should be 2-3 words from the issue title, lowercase, with only letters, numbers, and hyphens
5. If the rename fails because the name is taken, tell the user and ask how to proceed (add a suffix, pick a different label, or keep the current name).
6. Tell the user: "Renamed your branch from `old-name` to `worktree-XX-short-label` to match the issue."

**If in a worktree but no issue number came up:** skip the rename silently. `/create-plan` will handle it if an issue appears later.

**If not in a worktree:** skip silently and move on to Phase 2.
</phase>

## Phase 2: Codebase Analysis

<phase name="codebase-analysis">
Once you're satisfied with the problem definition, shift to technical exploration.

**If in vision mode:** Phase 2 is optional. Ask the user:
> "Want me to look at how this connects to the existing codebase, or should we wrap up here?"

If they say skip, present a vision-mode closing summary:
- **Direction chosen** - what the user landed on (and which scope dial option, if offered). Frame this in terms that map to `/create-plan`'s Goal State section.
- **Key decisions made** - premises challenged, ideas scrapped or kept (these become Critical Decisions in the plan)
- **Open questions** - anything unresolved that `/create-plan` should address during execution
- **ASCII diagram** - if the direction involves flows or multi-step processes, include a lightweight diagram (see Phase 2 for style guidance)
- **HTML option comparison - REQUIRED when 2+ options are being compared.** This is not optional when the gate fires. The gate: the exploration surfaced **two or more distinct, named directions the user is actively deciding between**, each with at least one tradeoff or consideration. It does NOT fire for a single recommendation, a set you have already narrowed to one, or open discussion with no competing options. When fewer than 2 options are on the table, skip this entirely. When it fires, you MUST work through these steps:
  - **Announce** per `.claude/rules/html-outputs.md`: "Generating an HTML view because you are comparing N options. Say 'skip HTML' if you want markdown only." Honor "skip HTML" if the user replies with that phrase.
  - **Generate the canonical record via the helper** - do NOT hand-write the HTML. Produce a JSON payload matching the schema documented at the top of `.claude/skills/shared/shells/explore-shell.html` (option cards, `scopeDial`, `decisions`; read its header for the exact fields). Set `scopeDial` to exactly one of `Expand` | `Hold` | `Reduce`. Write the JSON to a temp file and run the helper from the project root:
    `node .claude/scripts/render-html.js --shell explore --name explore-<topic-slug> --data /tmp/explore-data.json`
    The helper computes the timestamped name, creates `artifacts/html/`, overwrites freely, and prints the output path. This persisted file is the canonical record of the exploration. Open it: `bash .claude/scripts/open-artifact.sh "<printed-path>"`. Then publish it as a second viewport per the "Publishing the Artifact" rules in `.claude/rules/html-outputs.md`, and record it with `--index-add`. Silently skipped when the session cannot publish.
  - **Offer an optional playground** - ask "Want this interactive? (drag, toggle, slider)". If yes, dispatch the `playground` skill for a *separate, throwaway* interactive version in `/tmp/` (export-loop only). The playground is disposable; the `artifacts/html/` record above stays canonical.
  - **Detecting a playground reply** - if the user's message starts with `Playground result`, treat the rest as structured state (selection, drag order, slider values, toggle states) and feed it into the closing summary. Otherwise treat the reply as natural-language decision input. `/explore` never modifies the playground output - the export loop is the only path back.
- **Chain check (M14)** - apply M14's convergence gate, reading **Open questions** above as its open-question field. M14 holds every condition, including the never-offered-dial case and what to say when the gate does not pass; do not restate them here. When it passes, announce the handoff in one line ("Exploration converged - chaining into `/create-plan` per M14. Say \"no chaining\" to stop here.") and invoke `/create-plan` through the Skill tool.

If they say yes, continue with the analysis below.

**If in scoping mode:** proceed with Phase 2 as normal (mandatory).

### Start with the codebase map
Before exploring manually, check if `CODEBASE_MAP.md` exists in the project root.

**If it exists:** Read it for the directory tree, module purposes, conventions, gotchas, and navigation guide - your starting point before any glob/grep. For staleness, use the session-init JSON instead of running git yourself: `map.commitsBehind` is the count and `map.stale` is true when it is >= 10 (single-commit drift is noisy and not actionable). If the script was unavailable, compute it manually: compare the `<!-- Commit: -->` hash with `git rev-parse HEAD` and run `git rev-list --count <map_commit>..HEAD`. When `map.stale` is true (10 or more commits behind), run `/index` automatically per M12 (`.claude/skills/shared/hitl-loop.md`), then read the fresh map and proceed - tell the user it ran and why. When the map is not stale, proceed without comment. If `map.generatedWhileDirty` is true (the header notes `generated_while_dirty`), mention that to the user regardless of commit count - it signals the map was built from uncommitted state.

**If it does not exist (first-time use or fresh setup):** Tell the user: "No codebase map found. Generating one now via `/index` - this is a one-time setup that may take a minute and spawns parallel subagents." Then invoke `/index` to generate the map. After it completes, read the new map and proceed.

**If it exists but is malformed:** Skip it, tell the user "Codebase map looked malformed, falling back to manual exploration. You may want to run `/index` to regenerate.", and continue with glob/grep.

### Read past lessons
After the codebase map, use the lesson index from the session-init JSON (`lessons.content` is the full index, one line each; `lessons.hasDetail` tells you whether `LESSONS-detail.md` exists). If the script was unavailable, read `LESSONS.md` directly instead. If a lesson looks relevant to this feature, open its full write-up in `LESSONS-detail.md` before scoping, so exploration does not repeat a past mistake. If `LESSONS-detail.md` is absent (`lessons.hasDetail` is false), `LESSONS.md` is the older flat format - its content is already the whole file.

### What to look at
1. **Entry points** - where does this feature connect to existing code?
2. **Dependencies** - what does it rely on (files, packages, APIs)?
3. **Related files** - what existing code will need to change?
4. **Edge cases and constraints** - what could go wrong or limit the approach?

### When to stop exploring
- All integration points are identified
- No open questions about how the feature fits in
- You can explain the approach clearly

### What to present
Give the user a brief summary of what you found:
- Key files involved
- How the feature integrates
- Any technical concerns or trade-offs
- Remaining questions (if any)

**Chain check (M14).** Apply M14's convergence gate, reading **Remaining questions** above as its open-question field. **Read the mode first:** a vision-mode run that accepted Phase 2 arrives here too and the mode is sticky (see Mode Detection), so a vision run still carries M14's scope-dial condition on this path. M14 holds every condition and the not-passing behavior; do not restate them here. An unanswered question is the cheapest thing to fix at this point and the most expensive to fix after a plan is built on it. When the gate passes, announce the handoff in one line ("Exploration converged - chaining into `/create-plan` per M14. Say \"no chaining\" to stop here.") and invoke `/create-plan` through the Skill tool.

#### Optional: ASCII diagrams
Include diagrams as part of your summary above when the feature involves flows, data paths, or multi-step processes. Each arrow is a place where things can break - that's the point. In vision mode, diagrams are especially useful for grounding abstract ideas - but keep them high-level to match the conversation.

**When to include one:** The feature involves user flows, API interactions, data pipelines, state changes, or multi-step processes. Just include it alongside your summary.

**When to ask:** The feature might benefit from a diagram but it's not obvious. Ask: "Want me to diagram this flow?"

**When to skip:** Simple changes with no flows - a config tweak, a copy change, a single-file refactor. No need to mention diagrams at all.

**Style:** Keep it lightweight - indented arrows showing the sequence and failure points. No box-drawing characters or UML.

Linear flow example:
```
User clicks Submit
  -> Validate fields (what if empty?)
  -> Send to API (what if it fails?)
  -> Save to database (what format?)
  -> Show success message (or error?)
```

Branching flow example:
```
User hits Save
  -> Validate input
    -> Valid: send to API
      -> Success: show confirmation
      -> Failure: show retry prompt
    -> Invalid: highlight errors, stay on form
```

**Purpose:** Diagrams are a discussion tool. After presenting one, invite the user to challenge the arrows: "Does this flow look right, or am I missing a step?"
</phase>

## Important

<rules>
Your job is not to implement (yet). Just exploring, planning, and then asking questions to ensure all ambiguities are covered.

We will go back and forth until you have no further questions. Do NOT assume any requirements or scope beyond explicitly described details.
</rules>

---

**Ready.** Describe what you're thinking - a concrete feature, a rough idea, or a strategic question all work.
