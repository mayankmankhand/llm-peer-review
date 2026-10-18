<!--
  DESIGN-PROFILE.md - this repository's own design answers.

  User-owned, like CLAUDE.md and LESSONS.md, and never copied by an installer:
  projects are seeded from .claude/skills/shared/design-profile-template.md, or on
  the plugin from seed/DESIGN-PROFILE.md. /explore reads it before any design work;
  /explore and /document write it; /execute only reads it. The rules that use these
  sections live in .claude/skills/shared/design-rules.md.

  The source repository never runs setup on itself, so this profile was written by
  hand.
-->
# Design Profile

This file remembers this repository's design answers so the toolkit never asks twice
and never overwrites a design system you already have. Edit it freely.

## Design system

<!-- One of: unknown | none | exists. When it exists, say where it lives (a tokens
     file, a theme config, a component library, a style guide, a Figma link) and what
     it covers (colors, type, spacing, components, motion). -->
- **Status:** exists
- **Where it lives:** `.claude/skills/shared/shells/tokens.css` (the machine-usable embodiment, inlined into every shell at render time) and `.claude/skills/shared/html-look.md` (the documented source of truth). The two mirror each other and are updated together.
- **What it covers:** colors (light and dark palettes, severity tokens), type (a 17px base and the `--text-*` scale), spacing, the `--measure` prose bound, and the cross-shell card system (findings, badges, fields, summary footer).

## Allowed variance

<!-- What exploration may change inside the design system without asking. The
     default is layout, composition, motion, and copy. Colors, type, spacing, and
     components stay as the system defines them unless a divergence page says
     otherwise. -->
- layout, composition, motion, copy

## Taste notes

<!-- Reactions captured while reacting to idea lists in /explore: what felt right,
     what felt tacky, what to avoid. One line each, newest last. -->
- 2026-10-14, docs diagrams: assembly line (an idea goes in, stations stamp it, a merged change comes out) felt right; subway map a close second. Picked from eight rendered sketches, not from text: describe a look in words and the owner cannot react, so show it.
- 2026-10-14, docs diagrams: for loops and hooks, picked the vertical line diagram (loops as amber side stops with their limits, hooks as ticket gates) over loops drawn as rework arrows on the line and over a map with loop tags only.

## Directions tried

<!-- One line per direction: name, seed, rounds run and rounds won, kept or dropped. Written
     by /document at the end of a cycle. -->

- **Narrative-first cycle page** (issue #163, v6.3.2) - load level improve, surface `.claude/skills/shared/shells/document-shell.html`. No seed: seeds are generated for the three directions of new work, and an improve run varies one existing surface. Brief: the reader opens this page to understand what changed and why, so the story takes the first screen and the mechanical file inventory moves below it. Rounds: 4/10, then 4/10. Round 2 kept (the score did not rise, so the loop stopped under M15 and the later state was kept, since both rounds scored equally and round 2 held the fixes). **Kept.** Divergence: stay inside, and none was taken - no new colour, type size, or spacing value was introduced. Gaps left open at the stop, all judged out of scope for this issue: the 64ch prose column against the 940px page is a shared-token question, not a per-shell one; the page carries two labelling idioms (quiet uppercase micro-labels above prose, sentence-case section headings below); and the accent colour appears in unrelated roles across the page. Two of round 2's six gaps were fixture artifacts rather than design faults - a deliberately trivial demo diagram, and a two-bar chart - which is worth knowing when reading a critic score: the critic judges the screenshot it is given, so a weak fixture costs real points.

- **B. Line diagram** (docs visual tour, 2026-10-14) - load level new, surface the ten tour diagrams (`docs/diagrams/*.mmd`, judged on the overview's preview page). Seed `e5xryiYycRjCeKzZpvx2QOgrg9eEm4AZ`. Brief: a subway line running top to bottom, like the strip map on a train door; looping stations get an amber side stop with their limit, the debate is a branch line, the hooks are ticket gates in and out. Rounds run 3, rounds won 2 (rounds 1 and 2 won both orders of the side-by-side; round 3 split, so the loop stopped and kept round 3). **Kept.** Divergence: stay inside. Gaps left open (Mermaid's ELK layout): the main line steps left at a few stops, loops have no return arrow, and dark-mode labels show little weight contrast.
- **A. Factory floor** (docs visual tour) - seed `5aaQn3gI7H72ahTPEi7J6EW3R3G70nC5`. Dropped at pick.
- **C. Map, then close-ups** (docs visual tour) - seed `5McrpOIpT6jKRI6hroGhNn9CxJ3KFWv/`. Dropped at pick.
- **Docs and code disagree section** (issue #262) - load level improve, surface `.claude/skills/shared/shells/document-shell.html`. No seed (improve). Brief: one entry per open mismatch, the doc's `path:line` over its quoted text and the code's `path:line` over its quoted code, then one line on why it was not fixed and the date first reported; static, every quote rendered as text. Rounds run 1, rounds won 0: round 1 (each side as "<path> says" over a quote and "<path> does" over a code surface) split the side-by-side, one order preferring it and the other preferring round 0's small-caps DOC/CODE labels, so the loop stopped and kept round 1. Critic labels 6/10, then 5/10. **Kept.** Divergence: stay inside. Gaps left open went to the review as `[design]` lines: the review fixed the date wrap, the footer rule and the history order (a9ec246); the narrow column and a visible open-status marker per item stay open.

## Prompts to retry on newer models

<!-- Briefs that did not work this time. Try them again when a newer model ships;
     that is how you learn what the latest models can do. -->

- **"Narrative-first cycle page"** (issue #163). Failed under the stop rule of the time: the loop stopped at 4/10, under its 9/10 bar. Worth rerunning on a newer model with a *realistic* fixture rather than the demo one - the critic penalised a placeholder diagram and a two-bar chart that a real cycle would not produce, so part of the score was measuring the fixture. The brief itself still looks right: the redesign did move the narrative to the first screen and demote the inventory, which was the goal. What no round reached was studio-level composition on a single-column document page.
- **"Docs and code disagree section"** (issue #262). Failed: its one fix round split the side-by-side, so no round beat the first build. One judge read round 0's small-caps labels as the page's own rhythm, the other read round 1's quote and code surface as the clearer contrast, so the open question is which idiom a findings list on a narrative page should borrow. Worth rerunning with the column question settled first: both final critiques led with the narrow column, which this surface does not own.

## Baseline images

<!-- Optional paths to screenshots or concept art the design judges treat as a
     moodboard for the quality bar, never as a target to copy. -->
