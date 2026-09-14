#!/usr/bin/env bash
# Point this clone's git hooks at scripts/git-hooks (issue #175).
#
# Usage:
#   bash scripts/setup/install-hooks.sh
#
# Maintainer-only: it wires the toolkit repo's own pre-push gate (the M11
# tripwire on every push, plus scripts/release-check.js on pushes to main or a
# v* tag). It lives in scripts/setup/ and never ships to a project or plugin/.
#
# Sets `git config core.hooksPath scripts/git-hooks` in this clone's local
# config and makes sure the hook is executable. Safe to run again: a second
# run changes nothing and says so.
#
# Undo:
#   git config --unset core.hooksPath
#
# Exit codes: 0 installed (or already installed), 1 not a git clone or the
# hook file is missing.

set -e

TOOLKIT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$TOOLKIT_ROOT"

HOOKS_DIR="scripts/git-hooks"
HOOK="$HOOKS_DIR/pre-push"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: $TOOLKIT_ROOT is not a git clone"
  exit 1
fi

if [ ! -f "$HOOK" ]; then
  echo "Error: $HOOK not found in $TOOLKIT_ROOT"
  exit 1
fi

# git ignores a hook that is not executable, silently. Checkouts on some
# filesystems drop the bit, so set it every time.
if [ -x "$HOOK" ]; then
  echo "ok: $HOOK is executable"
else
  chmod +x "$HOOK"
  echo "Made $HOOK executable"
fi

# core.hooksPath replaces .git/hooks entirely, so any hook living there stops
# running. Name them so nothing is switched off unnoticed. Read the folder
# from the common git dir, not `git rev-parse --git-path hooks`: once
# core.hooksPath is set that returns scripts/git-hooks itself, and a second run
# would warn that the gate's own hook is switched off.
DEFAULT_HOOKS="$(git rev-parse --git-common-dir)/hooks"
if [ -d "$DEFAULT_HOOKS" ]; then
  for f in "$DEFAULT_HOOKS"/*; do
    [ -f "$f" ] || continue
    case "$f" in *.sample) continue ;; esac
    echo "Warning: $f will no longer run while core.hooksPath is set"
  done
fi

CURRENT="$(git config --local --get core.hooksPath || true)"
if [ "$CURRENT" = "$HOOKS_DIR" ]; then
  echo "ok: core.hooksPath is already $HOOKS_DIR (nothing changed)"
else
  if [ -n "$CURRENT" ]; then
    echo "Replacing previous core.hooksPath: $CURRENT"
  fi
  git config --local core.hooksPath "$HOOKS_DIR"
  echo "Set core.hooksPath to $HOOKS_DIR for $TOOLKIT_ROOT"
fi

echo "Every push now runs $HOOK."
echo "Undo: git config --unset core.hooksPath"
