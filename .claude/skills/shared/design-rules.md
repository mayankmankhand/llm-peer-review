# Design Rules

Shared reference for design work in the toolkit loop (issue #160). Read on demand, never inlined: `/explore` reads it when its Design exploration step fires, `/create-plan` when it fills the UI/UX Design section, `/execute` when a plan step carries a load level, `/document` at its profile capture step, and the `playground` skill when `/explore` dispatches the rendered-prototypes variant. A run with no design work never reads it. Every mechanic lives here once; call sites cite a section by name rather than restating it (the #147 and M14 drift lessons). The loop bound is M15 in `hitl-loop.md`.

Adapted from Anshu Chimala's "How to turn your AI into a world-class designer" (Lenny's Newsletter, 2026), Techniques 1 to 6. The premise: a model picks the most predictable design choice at every step, so variety and taste have to be injected from outside it. Technique 7 onward is not adopted yet.

**The toolkit's own artifact look** (`.claude/skills/shared/shells/`, `tokens.css`, `html-look.md`) is an existing design system in state `exists` under the three-state rule, and the allowed-variance rules apply to it exactly as they do to any other repo's system. It was previously carved out entirely, on the reasoning that the loop should not churn a look every downstream project inherits. That protection now comes from the right place: layout, composition, motion and copy may vary freely, and colors, type, spacing and components still require the divergence page (issue #161). A blanket exemption also blocked fixing the look when it was measurably failing its reader, which is what it turned out to be doing.

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

When a pick in `/explore` or a critic-round change in `/execute` would alter color, type, spacing, or components inside an existing system, page per M1 (the reference design is a user-held fact) in this shape:

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

The countable test: search the repo for the surface the feature names (a route, a page file, a component). Found means improve; not found means new. `/explore` confirms in one line ("Treating this as improve: `<file>` already exists. Say 'treat as new' for the full flow."). "Treat as new" overrides the test; a redesign of an existing surface is the usual reason.

## Technique 1: seed strings

A model cannot act randomly, so variety has to come from outside it. For each of the three directions a new surface gets:

1. Run `node .claude/scripts/gen-media.js --kind seed` and take the `seed` field. The script is installer-copied and its permission row is documented in `toolkit.md`; if the call prompts for permission, that row is missing from `.claude/settings.local.json` and belongs there (a one-line edit the user makes). Do not reach for a shell one-liner.
2. Define the creative direction from the string: color scheme, layout, typography, motion. Look past the surface for sub-patterns, repeated characters, special numbers, anything that inspires a choice. Three seeds give three genuinely different directions.
3. Bring the direction to life with judgment, so it looks great and not merely different.

Never reveal a seed in the design. It is inspiration, not content. Record every direction's name and seed: the picked one in the plan's Direction row, the other two in the plan's Directions tried row marked "dropped at pick", so all three can be reproduced or retried later.

## Technique 2: ambitious briefs

The best ideas come from the user's own taste, so the brief is written with them, not for them:

1. **List ideas, broad not deep.** Ask for as many bold, one-line design languages as you can think of. No detail yet; the list exists to spark the user's imagination.
2. **Show them and capture reactions.** The user reacts ("tactile, clicky", "cartoony feels tacky, avoid"). Write each reaction as one line in the profile's Taste notes, newest last. This is the only stage that writes Taste notes.
3. **Sharpen the favorites** against those reactions until the user is satisfied. Ideas that sound terrible are worth one try; a direction that does not work is thrown away, not softened.
4. **Write the build prompt**: a concise brief an agent could build a first page from. This is the plan's Direction brief.

Prompts that did not work go to the profile's "Prompts to retry on newer models" at `/document` time, so they are tried again when a newer model ships.

Accept any format the user offers: code, a text description, a design guide, a rough idea. When the user says "you decide", propose one specific direction and get a soft confirmation instead of leaving it vague.

## Technique 3: the design critic

The implementing agent cannot judge its own design: it reviews its own code, decisions, and rationale. A critic in a fresh context, given only a screenshot, judges whether the design hits the bar.

**The contract.** The dispatcher pastes the prompt below verbatim plus one image path, and nothing else: no code, no plan, no earlier critiques, no round number, no target score. The same prompt every round. Profile "Baseline images", when present, are passed as extra image paths with the sentence "These are a moodboard for the quality bar, not a target to copy."

> You are a design critic at a top design studio. Look at this screenshot of a product design. Reason through these steps silently, without writing them out: name the aesthetic the design is going for; imagine how the best studio in the world would execute that exact aesthetic; find the biggest gaps between that and what you see, at two levels, overall structure and composition, and the fine details. Watch for patterns that feel overdone, excessive, or obviously AI-generated (gradient hero blocks, glows, decorative cards that hold nothing, text on the left and a graphic on the right, over-explaining) and penalise them. Be tight and specific, never vague. Be bold and opinionated; do not reward what is safe or easy. Then score how close this design is to that studio-level bar, out of 10.
>
> Return exactly this shape and nothing else, no preamble and no closing remarks:
> Score: N/10
> 1. Structure: <biggest gap, one line>
> 2. Detail: <next gap, one line>
> (up to 6 gaps, each prefixed Structure: or Detail:)

**The judge.** The critic is the `design-critic` agent (`.claude/agents/design-critic.md`), Read only, no model pin: a scoring critic whose verdict is final is a judge, and judges inherit the session model (`model-routing.md`). Fallback per that file: `general-purpose` with no model parameter when the agent type is unavailable.

**The return.** `Score: N/10` on the first line, then a numbered gaps list. A return without a parseable score is redispatched once (routing guardrail 2); still malformed, the round counts with no score and the loop stops with a digest note.

**The bar.** The loop is done when the critic independently scores 9/10 or higher. That target is never given to the critic, so its scoring stays objective. The bound on rounds, the converging check, and what happens when the bound runs out are M15.

## The loop procedure

One round is one screenshot, one critic dispatch, and one fix pass; the polish checklist (Technique 6) is part of every fix pass, so each polished state is what the next critic scores and no round has to know it is the last. `/execute` runs it in the main loop under M15:

1. **Serve the surface.** `browse.js` navigates `http(s)` only. Start the dev server per the Self-Service rule and probe the common ports the way `/review` does. A surface that cannot be served skips the critic with a digest note; the loop never blocks on it.
2. **Screenshot** with `browse.js` (`goto`, then `screenshot`); the returned path is the critic's whole input.
3. **Dispatch the critic** per Technique 3 and read the score and gaps.
4. **Fix** the gaps that matter most, run the polish checklist (Technique 6), checkpoint (M4), and go to 1, or stop per M15.
5. **Media**, once per surface, when the design would gain from an image or a clip: Techniques 4 and 5. A declined ask means continue without the asset.

## Techniques 4 and 5: image and video

Code-only visuals (gradients, shapes, basic patterns) are the strongest giveaway of an AI-generated design. Real images and motion show effort beyond the surface.

**The ask.** Once per surface, when an image or clip would add personality the code cannot: page per M1 (exempt from the cap, M15) in plain English: "This surface would gain from <an image of X | a looping clip of Y>. Generating it costs about <estimate> on your <provider> key. Generate it? [yes]".

**The call.** Claude runs, through the Bash tool with its maximum timeout:

```
node .claude/scripts/gen-media.js --kind image --prompt "<prompt>" --out <asset dir>/<surface>-<name>.png
node .claude/scripts/gen-media.js --kind video --prompt "<prompt>" [--image <still>] --out <asset dir>/<surface>-<name>.mp4
node .claude/scripts/gen-media.js --kind matte --image <clip> --out <asset dir>/<surface>-<name>-matte.mp4
```

`<asset dir>` is the surface's static asset directory (`public/media/`, `static/`, whatever the repo already uses). Exit 0 returns `path`; reference it from the surface's markup or CSS. Exit 2 means the key is absent: relay `handoffPrompt` to the user verbatim with `expectedFile`, and continue without the asset if they decline. Exit 3 means the job was submitted but not collected (a timeout, or a failure after submission); rerun the same `--kind` and `--out` with `--request-id <requestId>` from the JSON to collect it without paying twice. The script reads `.env.local` itself; Claude never does. Keys and model ids: `API-KEYS.md`.

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
- which briefs failed: a brief failed when it was dropped at the pick, or when its loop stopped under 9/10
- the score of every round and which round was kept
- the gaps left open at the stop
- media assets by path, or the handoff prompts the user was given
- divergence approved, and how far
