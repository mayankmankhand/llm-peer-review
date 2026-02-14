#!/bin/bash
#
# setup.sh — Copy the LLM Peer Review toolkit into any project.
# Compatible with Bash 3.2+ (macOS default), Linux, and WSL.
#
# Usage:
#   bash /path/to/llm-peer-review/scripts/setup/setup.sh [target-directory]
#
# If no target directory is given, uses the current working directory
# (but will error if run from inside the toolkit repo).
#
# Examples:
#   # From toolkit repo, specify target:
#   bash scripts/setup/setup.sh ~/Projects/my-app
#
#   # From your project directory:
#   cd ~/Projects/my-app
#   bash ~/llm-peer-review/scripts/setup/setup.sh
#

set -e
shopt -s failglob

# ─── Where this script lives and where the toolkit root is ───
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLKIT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ─── Target directory ────────────────────────────────────────
TARGET="${1:-.}"

# If no target specified, check if we're in the toolkit repo
if [ "$TARGET" = "." ]; then
  CURRENT_DIR="$(pwd)"
  RESOLVED_CURRENT="$(cd "$CURRENT_DIR" && pwd)"
  RESOLVED_TOOLKIT="$(cd "$TOOLKIT_ROOT" && pwd)"
  
  # Check if we're trying to copy into the toolkit repo itself
  if [ "$RESOLVED_CURRENT" = "$RESOLVED_TOOLKIT" ] || [ "${RESOLVED_CURRENT#$RESOLVED_TOOLKIT/}" != "$RESOLVED_CURRENT" ]; then
    echo ""
    echo "  Error: No target directory specified"
    echo ""
    echo "  You're running this from inside the toolkit repository."
    echo "  Please specify a target project directory:"
    echo ""
    echo "    bash scripts/setup/setup.sh /path/to/your-project"
    echo ""
    echo "  Or run it from your target project directory:"
    echo ""
    echo "    cd /path/to/your-project"
    echo "    bash /path/to/llm-peer-review/scripts/setup/setup.sh"
    echo ""
    exit 1
  fi
  
  # If we're in a different directory, use current directory as target
  TARGET="$RESOLVED_CURRENT"
fi

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
echo "   LLM Peer Review"
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

# Check runtime scripts (must exist)
for f in dev-lead-gpt.js dev-lead-gemini.js; do
  if [ ! -f "$TOOLKIT_ROOT/scripts/$f" ]; then
    echo "  Error: source file not found: $TOOLKIT_ROOT/scripts/$f"
    PREFLIGHT_OK=false
  fi
done

# Check setup scripts (must exist in setup folder)
for f in setup.sh setup.ps1 install-alias.sh install-alias.ps1; do
  if [ ! -f "$TOOLKIT_ROOT/scripts/setup/$f" ]; then
    echo "  Error: source file not found: $TOOLKIT_ROOT/scripts/setup/$f"
    PREFLIGHT_OK=false
  fi
done

for f in CLAUDE.md .env.local.example .claude/settings.local.json .gitignore .gitattributes; do
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

# ─── Scripts (runtime scripts only — setup scripts stay in toolkit repo) ──────────────────
echo "  Copying scripts/ ..."
# Only copy runtime scripts (dev-lead-*.js) - setup scripts stay in toolkit repo
cp "$TOOLKIT_ROOT/scripts/dev-lead-gpt.js"   "$TARGET/scripts/"
cp "$TOOLKIT_ROOT/scripts/dev-lead-gemini.js" "$TARGET/scripts/"
OVERWROTE+=(scripts/dev-lead-gpt.js scripts/dev-lead-gemini.js)

# ─── .env.local.example (template — safe to overwrite) ───────
echo "  Copying .env.local.example ..."
cp "$TOOLKIT_ROOT/.env.local.example" "$TARGET/.env.local.example"
OVERWROTE+=(.env.local.example)

# ─── .gitignore and .gitattributes (upstream-owned — always copy) ─
echo "  Copying .gitignore ..."
cp "$TOOLKIT_ROOT/.gitignore" "$TARGET/.gitignore"
OVERWROTE+=(.gitignore)

echo "  Copying .gitattributes ..."
cp "$TOOLKIT_ROOT/.gitattributes" "$TARGET/.gitattributes"
OVERWROTE+=(.gitattributes)

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
echo "    Tip: To update commands and scripts, run setup again from"
echo "    the toolkit repo: bash /path/to/llm-peer-review/scripts/setup/setup.sh $TARGET"
echo ""
