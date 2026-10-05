# Design Rules

Shared reference for design work in the toolkit loop. Read on demand, never inlined: `/tk:explore` reads it when its Design exploration step fires, `/tk:create-plan` when it fills the UI/UX Design section, `/tk:execute` when a plan step carries a load level, `/tk:document` at its profile capture step, and the `playground` skill when `/tk:explore` dispatches the rendered-prototypes variant. A run with no design work never reads it. Every mechanic lives here once; call sites cite a section by name rather than restating it, because two copies of a mechanic drift apart. The loop bound, M15, is its own section below; `hitl-loop.md` keeps a pointer to it.

Adapted from Anshu Chimala's "How to turn your AI into a world-class designer" (Lenny's Newsletter, 2026), Techniques 1 to 6. The premise: a model picks the most predictable design choice at every step, so variety and taste have to be injected from outside it. Technique 7 onward is not adopted yet.

**The toolkit's own artifact look** (`${CLAUDE_PLUGIN_ROOT}/skills/shared/shells/`, `tokens.css`, `html-look.md`) is an existing design system in state `exists` under the three-state rule, and the allowed-variance rules apply to it exactly as they do to any other repo's system. Layout, composition, motion and copy may vary freely, and colors, type, spacing and components still require the divergence page. That keeps a look every downstream project inherits from churning, while still letting the loop fix it when it fails its reader.

## The three-state rule

A repo is in exactly one state, recorded in `DESIGN-PROFILE.md` under "Design system":

| State | Meaning | What design work may do |
|---|---|---|
| exists | the repo already has a design system | never overwrite it; vary only what "Allowed variance" lists |
| none | the repo has no design system | the full flow decides the look, and the plan's UI/UX Design section writes it down so the next feature can find it |
| unknown | nobody has answered yet | detect, confirm once, record (below) |

### Detection signals

Look in this order and stop at the first hit:

1. Token or theme files: `tailwind.config.*`, `theme.*`, `tokens.*`, `design-tokens*`, `styles/variables.*`, `*.tokens.json`
2. A component library in the `package.json` dependencies: `@mui/*`, `@chakra-ui/*`, shadcn (a `components.json` at the root), `antd`, `@mantine/*`, `vuetify`, `@radix-ui/*`
3. A design document: `DESIGN.md`, `STYLEGUIDE.md`, a Storybook config (`.storybook/`), a Figma link in `README.md`

### Confirm once

Say what you found in one line and ask one question, pre-filled with your guess: "It looks like this repo has a design system at <where>. Treat it as the design system? [yes]". Record the answer (state, where it lives, what it covers) in the profile. Never ask again while the profile says exists or none; ask only while it says unknown.

### Allowed variance inside a system

Default: layout, composition, motion, copy. Colors, type, spacing, and components come from the system. The profile's "Allowed variance" section can widen or narrow this per repo.

### The divergence page

When a pick in `/tk:explore` or a critic-round change in `/tk:execute` would alter color, type, spacing, or components inside an existing system, page per M1 (the reference design is a user-held fact) in this shape:

> This direction changes <what> in your design system (<where>). How far may it diverge?
> - **Stay inside** (recommended): keep <what> as the system defines it and vary the rest
> - **This surface only**: allow the change here and leave the system alone
> - **Propose a system change**: allow it here and list the change in the plan's Divergence row for you to carry into the system yourself

Record the answer in the plan's Divergence allowed row. An unanswered page defaults to Stay inside (M15). Design pages are exempt from M1's cap (M15).

## The load dial

| Level | When | What runs |
|---|---|---|
| none | nothing a human looks at changes | nothing; the step is skipped silently |
| improve | the page, screen, or component the feature targets already exists in the repo | one critic pass on the current design, its gaps, the polish checklist; 2 rounds (M15) |
| new | the target surface does not exist yet | the full flow, always: idea list, three seeded directions, prototypes, the pick, the critic loop up to 5 rounds (M15), the media ask, polish |

The countable test: search the repo for the surface the feature names (a route, a page file, a component). Found means improve; not found means new. `/tk:explore` confirms in one line ("Treating this as improve: `<file>` already exists. Say 'treat as new' for the full flow."). "Treat as new" overrides the test; a redesign of an existing surface is the usual reason.

## Technique 1: seed strings

A model cannot act randomly, so variety has to come from outside it. For each of the three directions a new surface gets:

1. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/gen-media.js --kind seed` and take the `seed` field. On the plugin, the commands that run a design step carry their own permission for the script, so the first call should not prompt; when one does after the user has answered a question, the usual cause is a project whose `settings.local.json` lacks the plugin script rows setup seeds to keep that permission past the user's next message, so approve it once, go on, and suggest re-running setup. Only when the command or the agent type itself is missing has the session not loaded the current plugin, and `/reload-plugins` is the fix for that. On a copy-install, setup seeds the row into `.claude/settings.local.json`, and an install that predates that seeding gets it by re-running setup. Either way the user can also add the row by hand, since Claude cannot edit that file. Do not reach for a shell one-liner.
2. Define the creative direction from the string: color scheme, layout, typography, motion. Look past the surface for sub-patterns, repeated characters, special numbers, anything that inspires a choice. Three seeds give three genuinely different directions.
3. Bring the direction to life with judgment, so it looks great and not merely different.

Never reveal a seed in the design. It is inspiration, not content. Record every direction's name and seed: the picked one in the plan's Direction row, the other two in the plan's Directions tried row marked "dropped at pick", so all three can be reproduced or retried later.

## Technique 2: ambitious briefs

The best ideas come from the user's own taste, so the brief is written with them, not for them:

1. **List ideas, broad not deep.** Ask for as many bold, one-line design languages as you can think of. No detail yet; the list exists to spark the user's imagination.
2. **Show them and capture reactions.** The user reacts ("tactile, clicky", "cartoony feels tacky, avoid"). Write each reaction as one line in the profile's Taste notes, newest last. This is the only stage that writes Taste notes.
3. **Sharpen the favorites** against those reactions until the user is satisfied. Ideas that sound terrible are worth one try; a direction that does not work is thrown away, not softened.
4. **Write the build prompt**: a concise brief an agent could build a first page from. This is the plan's Direction brief.

Prompts that did not work go to the profile's "Prompts to retry on newer models" at `/tk:document` time, so they are tried again when a newer model ships.

Accept any format the user offers: code, a text description, a design guide, a rough idea. When the user says "you decide", propose one specific direction and get a soft confirmation instead of leaving it vague.

## Technique 3: the design critic

The implementing agent cannot judge its own design: it reviews its own code, decisions, and rationale. A critic in a fresh context, given only a screenshot, names the biggest gaps between the design and the bar.

**The contract.** The dispatcher pastes the prompt below verbatim plus one image path, under the neutral name Technique 3b sets, and nothing else: no code, no plan, no earlier critiques, no round number, no target score. The same prompt every round. Profile "Baseline images", when present, are passed as extra image paths with the sentence "These are a moodboard for the quality bar, not a target to copy."

> You are a design critic at a top design studio. Look at this screenshot of a product design. Reason through these steps silently, without writing them out: name the aesthetic the design is going for; imagine how the best studio in the world would execute that exact aesthetic; find the biggest gaps between that and what you see, at two levels, overall structure and composition, and the fine details. Watch for patterns that feel overdone, excessive, or obviously AI-generated (gradient hero blocks, glows, decorative cards that hold nothing, text on the left and a graphic on the right, over-explaining) and penalise them. Be tight and specific, never vague. Be bold and opinionated; do not reward what is safe or easy. Then score how close this design is to that studio-level bar, out of 10.
>
> Return exactly this shape and nothing else, no preamble and no closing remarks:
> Score: N/10
> 1. Structure: <biggest gap, one line>
> 2. Detail: <next gap, one line>
> (up to 6 gaps, each prefixed Structure: or Detail:)

**What a still image cannot carry.** This note is for the dispatcher and the maintainer, never for the critic, whose prompt stays as it is. One screenshot shows one render. Anything that exists only across two renders, across a rebuild, across a focus change, or between two clicks is invisible to it: a typed draft a re-render throws away, the armed first step of a two-step button, a panel that snaps shut, a field that loses focus mid-word. A page that empties and rebuilds itself looks identical before and after the rebuild (three such defects once reached review after a critic loop, because no still image could show them). The interaction pass in the loop procedure and the `[behaviour]` must-check line exist for this gap; the critic's score says nothing about it.

**The judge.** The critic is the `design-critic` agent (`subagent_type=tk:design-critic`), Read only, no model pin: a critic whose gaps decide what the loop fixes is a judge, and judges inherit the session model (`model-routing.md`). Fallback per that file: `/reload-plugins` once when the plugin was installed this session, then `general-purpose` with no model parameter and this fixed prompt pasted, when the agent type is unavailable.

**The return.** `Score: N/10` on the first line, then a numbered gaps list. The gaps are the critique; the score is recorded in the digest as a label and decides nothing. A return with no parseable gap line is redispatched once (routing guardrail 2); still malformed, the round counts with no critique and the loop stops with a digest note.

**Why the score decides nothing.** Five fresh critics on one unchanged screenshot scored it 4, 4, 4, 5 and 4. The score is steady, but its one-point wobble is the same size as the step a score-based stop rule has to read, and no recorded loop reached 9/10. The gaps caught every real defect those loops found. So the score line stays as a label, and keep-or-revert decisions belong to the side-by-side judge in Technique 3b. The bound on rounds and what happens when a loop stops are M15.

## Technique 3b: the side-by-side judge

The toolkit's own addition, not one of the article's techniques. A critic in a fresh context has nothing to compare against, so two critics' scores cannot say whether a fix pass made the surface better. A judge shown both versions can. After every fix pass, a fresh judge sees the version before the pass's design changes and the version after them, without being told which is which.

**The contract.** The dispatcher pastes the prompt below verbatim plus two image paths, labeled A and B, and nothing else: no code, no plan, no critiques, no round number, and nothing that says which image is newer. Profile "Baseline images", when present, follow A and B with the moodboard sentence from Technique 3.

> You are a design critic at a top design studio. You are shown two screenshots, A and B, of the same product surface. Reason through these steps silently, without writing them out: name the aesthetic the design is going for; imagine how the best studio in the world would execute that exact aesthetic; compare A and B against that bar, at two levels, overall structure and composition, and the fine details, including anything broken, overlapping, or cut off. Watch for patterns that feel overdone, excessive, or obviously AI-generated, and penalise them. Do not reward an image for being first or second, and do not reward a difference for being a difference. If neither is clearly closer to the bar, say so.
>
> Return exactly this shape and nothing else, no preamble and no closing remarks:
> Closer: <A, B, or neither>
> Why: <the one difference that decided it, one line>

**Neutral file names, for every judge.** Before any judge dispatch, the critic's included, copy the images into a fresh folder from `mktemp -d /tmp/design-judge.XXXXXX`, made per "Temporary folders" in `${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md`: `A.png` and `B.png` for the comparer, `screen.png` for the critic. A path such as `round-3.png`, `broken.png`, or a `browse.js` timestamp tells the judge which image is newer, and dispatching both orders cannot undo that. The mapping from A and B back to commits goes into the digest, never into the prompt.

**Both orders.** Every comparison is two dispatches in parallel, one with the older version as A and one with it as B. The newer version wins only when both dispatches pick it, and the older version wins only when both pick it. Anything else, a `neither` from either dispatch included, is a split. A judge that favours whichever image comes first therefore cannot decide a round. What each outcome does to the loop is M15.

**The judge.** The `design-comparer` agent (`subagent_type=tk:design-comparer`), Read only, no model pin, for the same reason as the critic. Fallback per `model-routing.md`: when the agent type is not found, run `/reload-plugins` once (an agent added by a plugin install or update, or written this session, registers only after a reload), then `general-purpose` with no model parameter and the agent's body plus this prompt pasted. That fallback carries tools the agent does not have, Bash among them; the prompt still asks it to judge only what it sees.

**The return.** `Closer: A`, `Closer: B`, or `Closer: neither` on the first line, then one `Why:` line. A return without a parseable `Closer:` line is redispatched once; still malformed, that dispatch counts as `neither`, which makes the comparison a split.

**The prompt was validated as written**, against a bar set before the run: a page with a known rendering defect against the same page without it, a page with one of the critic's recurring gaps fixed against the page as it was, and two captures of an unchanged page, each dispatched in both orders, twice. Change its wording only with that check run again and its tally written down.

## The loop procedure

One round is one interaction pass, one critic dispatch, one fix pass with the polish checklist (Technique 6) inside it, committed in two parts (its interaction fixes, then its design checkpoint), and one side-by-side comparison of the version before the design checkpoint with the checkpoint. Polish runs in every fix pass, so the comparison always judges the polished state and no round has to know it is the last. `/tk:execute` runs it in the main loop under M15:

0. **Start clean.** Before round 1, commit the built surface as round 0 (M4). Any other uncommitted work pauses the step with a page (M1): only the user knows where it belongs, and committing it would sweep it into the range the review audits and auto-fixes. A clean start means a later revert can only ever take one round's design changes with it.
1. **Serve the surface.** `browse.js` navigates `http(s)` only. Start the dev server the way the browser criteria do: prefer `browse.js`'s `autoStart` (it runs the project's `dev` or `start` script in the background and stops it when the session ends), else start it by hand in the background with a log, never in the foreground; probe the common ports the way `/tk:review` does. A surface that cannot be served skips the loop with a digest note and a `[behaviour]` must-check line saying nothing on it was checked in a browser; the loop never blocks on it.
2. **Screenshot** the current version with `browse.js` (`goto`, then `screenshot`). A version the previous round's comparison already captured reuses that capture.
3. **Interaction pass.** List the controls on the surface that hold state: fields, two-step buttons, toggles, panels, anything with a pending or armed state. For each one, write a short `browse.js` session (3 to 6 actions) and the result it must show, before running it. Type into a field, wait past a render (1 second, or one full cycle of the page's animation), and read it back with `value`: the typed text is still there. Click the first half of a two-step control, wait the same way, and read its text: the armed state still shows. A result that differs from what was written down is a defect for this round's fix pass, and re-running the same session is its verdict (M3's mechanical path). A click or read that times out on a control the screenshot shows is such a result, not a broken session: a control rebuilt faster than a click can land is this defect at its worst, so the session is never rewritten to get around it. Keep each session's actions file under `reports/design/` as `<surface>-<name>.json`, and the output of any run that failed beside it as `<surface>-<name>-output.json`, so a must-check line can point at both.
4. **Dispatch the critic** per Technique 3 and read the gaps; record the score as a label.
5. **Fix** every interaction defect first and commit those fixes on their own (M4): the side-by-side judge cannot see behaviour, so a lost comparison must never take them with it. Then fix the gaps that matter most, run the polish checklist (Technique 6), and commit the result as this round's design checkpoint (M4).
6. **Compare** per Technique 3b: screenshot the design checkpoint and dispatch the side-by-side judge in both orders against the version just before it (the round's start, or its interaction-fix commit when it made one, captured again), so the judge weighs exactly what a loss would revert. M15 says what each outcome does: continue, revert and stop, or stop.
7. **Close the loop** on the version M15 kept. Run the interaction pass once more, and critique it twice; a critique it already received in the loop counts as one of the two. Save its screenshot as `reports/design/<surface>-final.png`. Then write the plan's `## Must-check for review` lines, in the shapes M14 (`hitl-loop.md`) gives: a `[design]` line for each gap both critiques raise, an `[interaction]` line for each session that fails on the kept version, and one `[behaviour]` line naming the surface, its URL, and what the pass covered. Two gaps match when they name the same element and the same problem. When unsure, count them as matching: a wrong match costs one skeptic's time, while a missed match ships an open gap nobody checks. Both critiques go into the digest verbatim, so the matching can be audited (M8).
8. **Media**, once per surface, when the design would gain from an image or a clip: Techniques 4 and 5. A declined ask means continue without the asset.

## The loop bound (M15)

The design loop that `/tk:execute` runs on a surface whose plan carries a load level has its own bound, separate from M5: M5 is per finding and absolute, while a design loop iterates on one surface. A round is one interaction pass, one critic dispatch, one fix pass with the polish checklist inside it, committed in two parts (M4): the interaction fixes on their own, then the design changes as the round's checkpoint; and one side-by-side comparison of the version before the checkpoint with the checkpoint ("The loop procedure" above). The built surface is committed as round 0 before round 1, on a clean tree, so a revert only ever takes one round's design changes with it. New work gets up to 5 rounds; improve gets 2. The comparison, run in both orders, decides each round:

- **The newer version wins in both orders:** continue to the next round while rounds remain.
- **The older version wins in both orders:** `git revert --no-edit` that round's checkpoint and stop. Its interaction fixes were committed before it and stay: they were proven by re-running their sessions, which the comparison cannot see. A revert, never a reset: the history keeps the judged round and the decision, and nothing is rewritten on a branch that may already be pushed.
- **Anything else is a split:** stop and keep the newer round.

The critic's score is recorded as a label and decides nothing. Stopping, whether by a loss, a split, or the round limit, is a digest entry with the kept round and the must-check lines written (M14), never a hard stop: it never pages, and M14's clean finish holds, so the run still chains into `/tk:review`. Media asks and divergence asks raised during design work are M1 pages exempt from the 2-3 cap the way M9 approvals are, because a truncated media ask would silently ship a surface without media; an unanswered divergence ask defaults to staying inside the allowed set. The judges' contracts (the fixed prompts, fresh context, images only, neutral file names, both orders) are Techniques 3 and 3b above.

## Techniques 4 and 5: image and video

Code-only visuals (gradients, shapes, basic patterns) are the strongest giveaway of an AI-generated design. Real images and motion show effort beyond the surface.

**The ask.** Once per surface, when an image or clip would add personality the code cannot: page per M1 (exempt from the cap, M15) in plain English: "This surface would gain from <an image of X | a looping clip of Y>. Generating it costs about <estimate> on your <provider> key. Generate it? [yes]".

**The call.** Write the prompt to a file first, never inline as `--prompt "<prompt>"`: inside double quotes the shell expands `$`, and a `$49` in a prompt once reached the paid API as `9`. Write the prompt as `prompt.txt` in a fresh folder from `mktemp -d /tmp/media-prompt.XXXXXX`, made and used per "Temporary folders" in `${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md`, and pass that file path as `<prompt file>`. Then Claude runs, through the Bash tool with its maximum timeout:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/gen-media.js --kind image --prompt-file <prompt file> --out <asset dir>/<surface>-<name>.png
node ${CLAUDE_PLUGIN_ROOT}/scripts/gen-media.js --kind video --prompt-file <prompt file> [--image <still>] --out <asset dir>/<surface>-<name>.mp4
node ${CLAUDE_PLUGIN_ROOT}/scripts/gen-media.js --kind matte --image <clip> --out <asset dir>/<surface>-<name>-matte.mp4
```

`<asset dir>` is the surface's static asset directory (`public/media/`, `static/`, whatever the repo already uses). Exit 0 returns `path`; reference it from the surface's markup or CSS. Exit 2 means the key is absent: relay `handoffPrompt` to the user verbatim with `expectedFile`, and continue without the asset if they decline. Exit 3 means the job was submitted but not collected (a timeout, or a failure after submission); rerun the same `--kind` and `--out` with `--request-id <requestId>` from the JSON to collect it without paying twice. The script reads `.env.local` itself; Claude never does. Keys and model ids: `API-KEYS.md` in the toolkit repository.

**Two video recipes.**
- *Animated graphic:* generate a looping clip over a solid or page-colored background so refraction and shadow bake in, then run `--kind matte` to remove the background, and layer the result anywhere in the UI. This matting step is Technique 5's own second step.
- *Fluid transition:* generate the first frame as an image, generate a clip from that frame to the next state, seed the next clip with the last frame, and scrub the clips on scroll or gesture.

## Technique 6: cut what does not add value

A model adds and rarely removes. Restraint is what makes a design look premium. In every fix pass, after addressing the critic's gaps, go through the surface and cut:

- gradients, glows, and shadows that do not serve a purpose
- containers, borders, and cards that hold nothing the layout needs
- labels and captions that repeat what the visuals already say
- custom controls where a native one looks better and behaves better
- color on text that carries no meaning
- anything the user does not need on this screen to do the job

Ask what really needs to be there. Putting less on the screen communicates more.

## The digest

A design run records, in the plan's Outcomes and the run digest:

- load level and the surface
- every direction's name and seed (three for new work) with the picked one's brief; unpicked ones marked dropped at pick
- which briefs failed: a brief failed when it was dropped at the pick, or when no round of its loop won the side-by-side (its fix passes never beat the first build)
- per round: its commit, the critic's gaps and score label, the interaction sessions and their results, and both comparison returns with the A and B mapping
- which round was kept, why the loop stopped (a loss, a split, or the round limit), and any revert
- the kept version's two critiques verbatim, and the must-check lines written from them
- media assets by path, or the handoff prompts the user was given
- divergence approved, and how far
