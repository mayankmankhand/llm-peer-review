# README Restructure Plan (Issue #15)

**Overall Progress:** `66%`

## TLDR
Restructure README so the toolkit's identity and commands come first. Move the 160-line "Setting Up a Brand New Computer" section to a new `SETUP.md` file, replace it with a short pointer section, and move the Commands table up right after the intro. No writing changes — just reorganization.

## Critical Decisions
- **Separate file over bottom-of-README:** Setup content goes to `SETUP.md` — keeps README focused, serves first-timers with a dedicated page
- **Keep an explicit section in README:** AI agents scanning README will see "Setting Up a Brand New Computer" and know where to go
- **Commands table moves up:** Right after the intro, before "Add to a New Project" — answers "what does this do?" before "how do I get it?"
- **No writing changes:** All existing content stays word-for-word

## New README Section Order
1. Title + intro paragraphs (lines 1-7) — unchanged
2. **Commands** (moved up from lines 227-252)
3. **Setting Up a Brand New Computer** — new short section with link to `SETUP.md`
4. **Add to a New Project** (lines 182-225) — unchanged
5. **How Dev-Lead Commands Work** (lines 255-284) — unchanged
6. **Customization** (lines 287-292) — unchanged
7. **Troubleshooting** (lines 295-303) — unchanged
8. **License** (lines 306-308) — unchanged

## Tasks

- [x] 🟩 **Step 1: Create SETUP.md**
  - [x] 🟩 Copy lines 15-178 (from `## Setting Up a Brand New Computer` through `You're set up. Read the next section to use this toolkit in your actual projects.`) into a new `SETUP.md` file
  - [x] 🟩 Keep the content exactly as-is — no edits to wording

- [x] 🟩 **Step 2: Restructure README.md**
  - [x] 🟩 Remove the old "Already set up?" skip link (lines 11-13) — no longer needed since setup is in a separate file
  - [x] 🟩 Remove the full setup section (lines 15-180)
  - [x] 🟩 Insert the Commands section (table + workflow) right after the intro `---`
  - [x] 🟩 After Commands, add a new "Setting Up a Brand New Computer" section with a clear callout linking to `SETUP.md`
  - [x] 🟩 Keep everything else (Add to a New Project, Dev-Lead, Customization, Troubleshooting, License) in current order
  - [x] 🟩 Verify all internal anchor links still work

- [ ] 🟨 **Step 3: Verify and commit**
  - [ ] 🟨 Review both files for correctness
  - [ ] 🟥 Commit with message referencing issue #15
