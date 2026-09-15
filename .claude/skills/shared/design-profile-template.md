<!--
  design-profile-template.md - the template for a project's DESIGN-PROFILE.md
  (issue #160).

  A project gets its DESIGN-PROFILE.md ONCE and never has it overwritten: the copy
  is user-owned, like CLAUDE.md and LESSONS.md. On the plugin, setup writes it from
  the plugin's seed/DESIGN-PROFILE.md (these same sections under a project header);
  on a copy-install, the installer copies this file on a fresh install. /explore
  reads the profile before any design work and offers to create it when it is
  missing. /explore and /document write it; /execute only reads it. The rules that
  use these sections live in .claude/skills/shared/design-rules.md.

  This template ships through the shared-fragment glob, so it is present in every
  install. It is a template, not this repository's own profile: keep every value
  below blank here.
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

<!-- Reactions captured while reacting to idea lists in /explore: what felt right,
     what felt tacky, what to avoid. One line each, newest last. -->

## Directions tried

<!-- One line per direction: name, seed, best critic score, kept or dropped. Written
     by /document at the end of a cycle. -->

## Prompts to retry on newer models

<!-- Briefs that did not work this time. Try them again when a newer model ships;
     that is how you learn what the latest models can do. -->

## Baseline images

<!-- Optional paths to screenshots or concept art the design critic treats as a
     moodboard for the quality bar, never as a target to copy. -->
