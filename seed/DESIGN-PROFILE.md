<!--
  DESIGN-PROFILE.md - this project's design profile (issue #160).

  /tk:setup writes this file ONCE, when the project has none, and never overwrites
  it afterwards: it is user-owned, like CLAUDE.md and LESSONS.md. /tk:explore reads
  it before any design work and offers to create it from the toolkit's template when
  it is missing. /tk:explore and /tk:document write it; /tk:execute only reads it.
  The rules that use these sections live in the toolkit's `design-rules` skill.

  It starts blank: every value below is filled in as this project answers the
  design questions.
-->
# Design Profile

This file remembers this repository's design answers so the toolkit never asks twice
and never overwrites a design system you already have. Edit it freely.

## Design system

<!-- One of: unknown | none | exists. When it exists, say where it lives (a tokens
     file, a theme config, a component library, a style guide, a Figma link) and what
     it covers (colors, type, spacing, components, motion). -->
- **Status:** unknown
- **Where it lives:**
- **What it covers:**

## Allowed variance

<!-- What exploration may change inside the design system without asking. The
     default is layout, composition, motion, and copy. Colors, type, spacing, and
     components stay as the system defines them unless a divergence page says
     otherwise. -->
- layout, composition, motion, copy

## Taste notes

<!-- Reactions captured while reacting to idea lists in /tk:explore: what felt right,
     what felt tacky, what to avoid. One line each, newest last. -->

## Directions tried

<!-- One line per direction: name, seed, best critic score, kept or dropped. Written
     by /tk:document at the end of a cycle. -->

## Prompts to retry on newer models

<!-- Briefs that did not work this time. Try them again when a newer model ships;
     that is how you learn what the latest models can do. -->

## Baseline images

<!-- Optional paths to screenshots or concept art the design critic treats as a
     moodboard for the quality bar, never as a target to copy. -->
