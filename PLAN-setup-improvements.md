# Setup Improvements Plan

**Overall Progress:** `100%`

## TLDR
Fix setup friction for non-technical users on Windows and Mac. A user followed our instructions and hit 5 problems in 40 minutes. Some are real bugs, some are missing docs, some are overengineering we're skipping. This plan covers the 4 real improvements, refined by peer reviews from both Gemini and ChatGPT.

## Critical Decisions
- **No Node.js rewrite of setup.sh** — the bash script works fine, the bug was a Windows/WSL `/tmp` quirk, not our code
- **No npx installer** — overengineering for this project's stage
- **No trap-based cleanup in the one-liner** — readability matters more for non-technical users; setup.sh is idempotent so rerunning is safe
- **No `#!/usr/bin/env bash` change** — script is invoked as `bash setup.sh`, so shebang is irrelevant
- **The one-liner works on native bash** — verified. The failure only happens when PowerShell calls `wsl bash -c` (each invocation can get a different `/tmp`)
- **setup.sh is compatible with Bash 3.2+** — the comment in the script is wrong and incorrectly scares off Mac users
- **Frame as "works in any bash terminal"** — not "universal", since PowerShell isn't supported
- **Skip `*.md` in .gitattributes** — CRLF doesn't break markdown, and forced LF causes mysterious diffs for non-technical contributors

## Tasks

- [x] 🟩 **Step 1: Add `.gitattributes` to prevent line-ending issues**
  - [x] 🟩 Create `.gitattributes` with `* text=auto`, `*.sh text eol=lf`, `scripts/** text eol=lf`
  - [x] 🟩 This prevents Windows clones from getting CRLF in bash scripts and JS scripts in `scripts/`

- [x] 🟩 **Step 2: Fix the Bash version comment in `setup.sh`**
  - [x] 🟩 Change line 4 to: "Compatible with Bash 3.2+ (macOS default), Linux, and WSL"
  - [x] 🟩 Remove the "Does not support macOS default Bash 3.2" claim (it does work on 3.2)

- [x] 🟩 **Step 3: Restructure README "Setting Up a Brand New Computer"**
  - [x] 🟩 Split into three sections: **Windows** / **Mac** / **Both Platforms**
  - [x] 🟩 **Windows section:** existing WSL steps + add one-line WSL distro note ("If you have WSL but no distro, run `wsl --install -d Ubuntu`") + add path conversion key concept (`C:\` → `/mnt/c/`) with path-with-spaces example (`"/mnt/c/Users/Jane Doe/Projects/MyApp"`) + add "Run this in your Ubuntu (WSL) terminal — not PowerShell" label above commands
  - [x] 🟩 **Mac section:** `xcode-select --install`, Homebrew install link, `brew install node gh`, Cursor download link. Keep it shorter than Windows since Mac is simpler
  - [x] 🟩 **Both Platforms section:** Verify setup first (`node -v`, `git --version`, `gh --version`) as a confidence checkpoint, then API keys, clone repo, open in Cursor
  - [x] 🟩 **Troubleshooting additions:** Add CRLF symptoms box ("If you see `/bin/bash^M` or weird script failures...") with two options: fresh clone (simple) or `git add --renormalize .` (advanced). Add "If it fails, rerun the command; leftover `/tmp/tmp.*` folders are harmless"

- [x] 🟩 **Step 4: Fix the one-liner in README.md and AGENT-SETUP.md**
  - [x] 🟩 Wrap in `bash -c '...'` to ensure the whole sequence runs in one shell context
  - [x] 🟩 Update both README.md and AGENT-SETUP.md to use the same command form
  - [x] 🟩 Add "Assume you are running in a bash environment (Ubuntu/WSL terminal on Windows, Terminal on macOS)" preface to AGENT-SETUP.md
  - [x] 🟩 Link AGENT-SETUP.md path conversion to the README anchor instead of duplicating it
