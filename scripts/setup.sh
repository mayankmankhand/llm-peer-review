#!/bin/bash
#
# setup.sh — Copy the Cursor Slash Command Toolkit into any project.
# Assumes Bash 5+ (WSL / Ubuntu). Does not support macOS default Bash 3.2.
#
# Usage:
#   bash /path/to/llm-peer-review/scripts/setup.sh [target-directory]
#
# If no target directory is given, uses the current working directory.
#
# Example:
#   bash ~/llm-peer-review/scripts/setup.sh ~/Projects/my-app
#

set -e
shopt -s failglob

# ─── Where this script lives and where the toolkit root is ───
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Target directory ────────────────────────────────────────
TARGET="${1:-.}"

if [ ! -d "$TARGET" ]; then
  echo ""
  echo "  Error: target directory does not exist: $TARGET"
  echo "  Create it first:  mkdir -p $TARGET"
  echo ""
  exit 1
fi

TARGET="$(cd "$TARGET" && pwd)"

# ─── Header ──────────────────────────────────────────────────
echo ""
echo "  ================================"
echo "   Cursor Slash Command Toolkit"
echo "  ================================"
echo ""
echo "    From:  $TOOLKIT_ROOT"
echo "    Into:  $TARGET"
echo ""

# ─── Preflight: verify source is a complete toolkit ──────────
PREFLIGHT_OK=true

if [ ! -d "$TOOLKIT_ROOT/.claude/commands" ]; then
  echo "  Error: source directory not found: $TOOLKIT_ROOT/.claude/commands/"
  PREFLIGHT_OK=false
elif ! compgen -G "$TOOLKIT_ROOT/.claude/commands/"*.md > /dev/null 2>&1; then
  echo "  Error: no .md command files found in $TOOLKIT_ROOT/.claude/commands/"
  PREFLIGHT_OK=false
fi

for f in dev-lead-gpt.js dev-lead-gemini.js setup.sh; do
  if [ ! -f "$TOOLKIT_ROOT/scripts/$f" ]; then
    echo "  Error: source file not found: $TOOLKIT_ROOT/scripts/$f"
    PREFLIGHT_OK=false
  fi
done

for f in CLAUDE.md .env.local.example .claude/settings.local.json; do
  if [ ! -f "$TOOLKIT_ROOT/$f" ]; then
    echo "  Error: source file not found: $TOOLKIT_ROOT/$f"
    PREFLIGHT_OK=false
  fi
done

if [ "$PREFLIGHT_OK" = false ]; then
  echo ""
  echo "  The toolkit source looks incomplete. Make sure you're running"
  echo "  this from a valid llm-peer-review repo."
  echo ""
  exit 1
fi

# ─── Create target directories ───────────────────────────────
mkdir -p "$TARGET/.claude/commands"
mkdir -p "$TARGET/scripts"

# ─── Track what happens ──────────────────────────────────────
OVERWROTE=()
SKIPPED=()

# ─── Command files (upstream-owned — always copy, warn if overwriting) ─
echo "  Copying .claude/commands/ ..."
for src in "$TOOLKIT_ROOT/.claude/commands/"*.md; do
  fname="$(basename "$src")"
  if [ -f "$TARGET/.claude/commands/$fname" ]; then
    echo "    ↻ overwriting $fname (back up first if you customized it)"
  fi
  cp "$src" "$TARGET/.claude/commands/$fname"
  OVERWROTE+=("commands/$fname")
done

# ─── Scripts (upstream-owned — always copy) ──────────────────
echo "  Copying scripts/ ..."
cp "$TOOLKIT_ROOT/scripts/dev-lead-gpt.js"   "$TARGET/scripts/"
cp "$TOOLKIT_ROOT/scripts/dev-lead-gemini.js" "$TARGET/scripts/"
cp "$SCRIPT_DIR/setup.sh"                    "$TARGET/scripts/"
OVERWROTE+=(scripts/dev-lead-gpt.js scripts/dev-lead-gemini.js scripts/setup.sh)

# ─── .env.local.example (template — safe to overwrite) ───────
echo "  Copying .env.local.example ..."
cp "$TOOLKIT_ROOT/.env.local.example" "$TARGET/.env.local.example"
OVERWROTE+=(.env.local.example)

# ─── Project-owned files (skip if already exist) ─────────────
for f in CLAUDE.md .claude/settings.local.json; do
  if [ -f "$TARGET/$f" ]; then
    echo "  Skipping $f — already exists (yours to customize)"
    SKIPPED+=("$f")
  else
    echo "  Copying $f ..."
    cp "$TOOLKIT_ROOT/$f" "$TARGET/$f"
    OVERWROTE+=("$f")
  fi
done

# ─── Summary ─────────────────────────────────────────────────
echo ""
echo "  ================================"
echo "   Done"
echo "  ================================"
echo ""

if [ ${#SKIPPED[@]} -gt 0 ]; then
  echo "    Skipped (already existed — not overwritten):"
  for f in "${SKIPPED[@]}"; do
    echo "      - $f"
  done
  echo ""
  echo "    To refresh a skipped file: delete it and rerun this script."
  echo ""
fi

echo "    What to do next:"
echo ""
echo "      cd $TARGET"
echo ""
echo "      1. Install the npm packages:"
echo "           npm install @google/generative-ai openai"
echo ""
echo "      2. Set up your API keys:"
echo "           cp .env.local.example .env.local"
echo "         Then open .env.local and paste:"
echo "           OPENAI_API_KEY  →  https://platform.openai.com/api-keys"
echo "           GEMINI_API_KEY  →  https://aistudio.google.com/apikey"
echo ""
echo "      3. Open the folder in Cursor and type / to see your commands."
echo ""
echo "      Steps 1 and 2 are optional — skip them if you don't"
echo "      need /dev-lead-gpt or /dev-lead-gemini."
echo ""
echo "    Tip: This copy of setup.sh is a snapshot. Run the one from"
echo "    the toolkit repo for updates in the future."
echo ""
