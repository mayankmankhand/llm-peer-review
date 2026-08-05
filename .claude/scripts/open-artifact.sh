#!/usr/bin/env bash
# open-artifact.sh - Open an HTML (or any) artifact in the user's default browser.
#
# Why this exists (issue #119):
#   Toolkit commands generate HTML artifacts (review reports, plans, course
#   pages) and need to open them in a real browser - clicking a file link in an
#   editor opens the SOURCE, not the rendered page. The opener used to be prose
#   instructions in .claude/rules/html-outputs.md that Claude ran by hand. On
#   WSL with no launcher on PATH that chain silently no-opped and the artifact
#   never appeared. This script makes the fallback deterministic: it tries each
#   opener in order with real error handling and reports failure ONLY when the
#   environment is genuinely headless.
#
# Why no wslview (issue #134):
#   The WSL chain used to try wslview first. Its interop detection is
#   version-dependent (newer WSL registers binfmt interop as WSLInterop-late,
#   which older wslu builds misread), its error text leaks into tool output,
#   and its exit code conflates interop state with launch success. PowerShell's
#   Start-Process exit code is trustworthy and works whenever interop is
#   functional, so the chain now goes straight there.
#
# Usage:   bash .claude/scripts/open-artifact.sh <file>
# Exit:    0  an opener launched successfully
#          1  bad usage, missing file, or every opener failed (headless)
#
# Compatible with Bash 3.2+ (macOS default). Uses only `command -v`, `case`,
# and POSIX test - no Bash 4 features (associative arrays, mapfile). `set -e` is
# intentionally NOT used: this script tries openers and falls through on
# failure, which `set -e` would abort.

set -u

FILE="${1:-}"

if [ -z "$FILE" ]; then
  echo "open-artifact.sh: no file given" >&2
  echo "Usage: bash .claude/scripts/open-artifact.sh <file>" >&2
  exit 1
fi

if [ ! -e "$FILE" ]; then
  echo "open-artifact.sh: file not found: $FILE" >&2
  exit 1
fi

# have <cmd>: true if cmd is on PATH. Wrapped so a missing command is never
# fatal and the result is easy to branch on.
have() { command -v "$1" >/dev/null 2>&1; }

# fail_headless: last resort. Tell the user where the file is and that it must
# be opened in a browser, not the editor. Claude keys off the exit-1 to print
# the same guidance in chat rather than silently moving on. On WSL, also print
# the Windows-side (UNC) path when we managed to compute one - the Linux path
# alone is not openable from a Windows browser (issue #134).
fail_headless() {
  echo "open-artifact.sh: could not auto-open. Open this in your browser (not the editor):"
  echo "  $FILE"
  if [ -n "${WINPATH:-}" ]; then
    echo "  From a Windows browser use this path instead: $WINPATH"
  fi
  exit 1
}

# Platform detection. WSL is Linux with a microsoft kernel string, so it must be
# tested before generic Linux.
UNAME="$(uname -s 2>/dev/null || echo unknown)"

case "$UNAME" in
  Darwin)
    # --- macOS ---
    if have open; then
      open "$FILE" && exit 0
    fi
    fail_headless
    ;;

  Linux)
    if grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
      # --- WSL: try launchers in order, fall through on failure ---

      # Convert to a Windows path once for the Windows-side launchers. wslpath
      # ships with WSL itself (not wslu), so it is effectively always present.
      # Computed before any rung so fail_headless can show it too.
      WINPATH=""
      if have wslpath; then
        WINPATH="$(wslpath -w "$FILE" 2>/dev/null || echo "")"
      fi

      # Derive the Linux mount of C:\Windows the same way, instead of
      # hardcoding /mnt/c: a custom automount root (wsl.conf [automount]
      # root=) would make every /mnt/c full-path fallback miss (issue #134).
      WINROOT=""
      if have wslpath; then
        WINROOT="$(wslpath -u 'C:\Windows' 2>/dev/null || echo "")"
      fi
      [ -n "$WINROOT" ] || WINROOT="/mnt/c/Windows"

      # 1) powershell.exe Start-Process: works even when nothing toolkit-related
      #    is on PATH (the reported #119 case) and gives a TRUSTWORTHY exit code,
      #    unlike explorer.exe. Locate it on PATH first, then fall back to the
      #    Windows PowerShell 5.1 full path that ships with every Windows install.
      PWSH=""
      if have powershell.exe; then
        PWSH="powershell.exe"
      elif [ -x "$WINROOT/System32/WindowsPowerShell/v1.0/powershell.exe" ]; then
        PWSH="$WINROOT/System32/WindowsPowerShell/v1.0/powershell.exe"
      fi
      if [ -n "$PWSH" ] && [ -n "$WINPATH" ]; then
        # PowerShell single-quoted strings require any embedded apostrophe to be
        # doubled, or a path like C:\Users\O'Brien\... truncates the string and
        # the launch silently fails. Double every ' before interpolating.
        WINPATH_PS="${WINPATH//\'/\'\'}"
        "$PWSH" -NoProfile -Command "Start-Process '$WINPATH_PS'" >/dev/null 2>&1 && exit 0
      fi

      # 2) explorer.exe via PATH interop. It almost always returns non-zero even
      #    on success, so its exit code cannot be trusted - if it exists and
      #    runs, treat the launch as done. NOTE: this makes the explorer rungs
      #    (2 and 3) best-effort - a genuine failure here cannot be detected and
      #    will still report exit 0. They are last-resort only, reached after
      #    PowerShell (which DOES return a trustworthy code) has failed.
      if have explorer.exe && [ -n "$WINPATH" ]; then
        explorer.exe "$WINPATH" >/dev/null 2>&1
        exit 0
      fi

      # 3) explorer.exe by full path: final Windows-side attempt when nothing is
      #    on PATH at all.
      if [ -x "$WINROOT/explorer.exe" ] && [ -n "$WINPATH" ]; then
        "$WINROOT/explorer.exe" "$WINPATH" >/dev/null 2>&1
        exit 0
      fi

      fail_headless
    else
      # --- Native Linux ---
      # Gate on a display: xdg-open frequently exits 0 even on a headless box
      # (no DISPLAY / no configured browser), which would falsely report success.
      # With no display, fall straight through to the headless message instead.
      if have xdg-open && { [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; }; then
        xdg-open "$FILE" >/dev/null 2>&1 && exit 0
      fi
      fail_headless
    fi
    ;;

  *)
    fail_headless
    ;;
esac
