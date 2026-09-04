<!--
  DESIGN-PROFILE.md - this repository's own design answers (issue #160).

  Both installers copy this file to <project>/DESIGN-PROFILE.md ONCE, on a fresh
  install, and never overwrite it afterwards: the seeded copy is user-owned, like
  CLAUDE.md and LESSONS.md. /explore reads it before any design work and offers to
  create it from this template when it is missing. /explore and /document write it;
  /execute only reads it. The rules that use these sections live in
  .claude/skills/shared/design-rules.md.

  This is the toolkit repository's own profile, seeded by hand during issue #163:
  the source repo never runs setup against itself, so the installers' one-time copy
  never fired here.
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

## Directions tried

<!-- One line per direction: name, seed, best critic score, kept or dropped. Written
     by /document at the end of a cycle. -->

- **Narrative-first cycle page** (issue #163, v6.3.2) - load level improve, surface `.claude/skills/shared/shells/document-shell.html`. No seed: seeds are generated for the three directions of new work, and an improve run varies one existing surface. Brief: the reader opens this page to understand what changed and why, so the story takes the first screen and the mechanical file inventory moves below it. Rounds: 4/10, then 4/10. Round 2 kept (the score did not rise, so the loop stopped under M15 and the later state was kept, since both rounds scored equally and round 2 held the fixes). **Kept.** Divergence: stay inside, and none was taken - no new colour, type size, or spacing value was introduced. Gaps left open at the stop, all judged out of scope for this issue: the 64ch prose column against the 940px page is a shared-token question, not a per-shell one; the page carries two labelling idioms (quiet uppercase micro-labels above prose, sentence-case section headings below); and the accent colour appears in unrelated roles across the page. Two of round 2's six gaps were fixture artifacts rather than design faults - a deliberately trivial demo diagram, and a two-bar chart - which is worth knowing when reading a critic score: the critic judges the screenshot it is given, so a weak fixture costs real points.

## Prompts to retry on newer models

<!-- Briefs that did not work this time. Try them again when a newer model ships;
     that is how you learn what the latest models can do. -->

- **"Narrative-first cycle page"** (issue #163). Failed by the digest definition: the loop stopped at 4/10, under the 9/10 bar. Worth rerunning on a newer model with a *realistic* fixture rather than the demo one - the critic penalised a placeholder diagram and a two-bar chart that a real cycle would not produce, so part of the score was measuring the fixture. The brief itself still looks right: the redesign did move the narrative to the first screen and demote the inventory, which was the goal. What no round reached was studio-level composition on a single-column document page.

## Baseline images

<!-- Optional paths to screenshots or concept art the design critic treats as a
     moodboard for the quality bar, never as a target to copy. -->
