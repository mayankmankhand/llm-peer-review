#!/bin/bash
#
# setup.sh - Copy the LLM Peer Review toolkit into any project.
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

# ─── Read version ─────────────────────────────────────────────
VERSION="unknown"
if [ -f "$TOOLKIT_ROOT/VERSION" ]; then
  VERSION="$(tr -d '[:space:]' < "$TOOLKIT_ROOT/VERSION")"
fi

# ─── Header ──────────────────────────────────────────────────
echo ""
echo "  ================================"
echo "   LLM Peer Review v$VERSION"
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

if [ ! -d "$TOOLKIT_ROOT/.claude/skills" ]; then
  echo "  Error: source directory not found: $TOOLKIT_ROOT/.claude/skills/"
  PREFLIGHT_OK=false
fi

# Check runtime scripts and the quarantined package.json (must exist).
# Runtime scripts live in .claude/scripts/ alongside their own package.json
# so end users of downstream projects don't inherit toolkit-only deps.
for f in ask-gpt.js ask-gemini.js browse.js package.json; do
  if [ ! -f "$TOOLKIT_ROOT/.claude/scripts/$f" ]; then
    echo "  Error: source file not found: $TOOLKIT_ROOT/.claude/scripts/$f"
    PREFLIGHT_OK=false
  fi
done

# Check setup scripts (validates toolkit is complete, even though bash can't run .ps1 files)
for f in setup.sh setup.ps1 install-alias.sh install-alias.ps1; do
  if [ ! -f "$TOOLKIT_ROOT/scripts/setup/$f" ]; then
    echo "  Error: source file not found: $TOOLKIT_ROOT/scripts/setup/$f"
    PREFLIGHT_OK=false
  fi
done

# Check index generator script
if [ ! -f "$TOOLKIT_ROOT/.claude/scripts/generate-index.js" ]; then
  echo "  Error: source file not found: $TOOLKIT_ROOT/.claude/scripts/generate-index.js"
  PREFLIGHT_OK=false
fi

# Check artifact opener script
if [ ! -f "$TOOLKIT_ROOT/.claude/scripts/open-artifact.sh" ]; then
  echo "  Error: source file not found: $TOOLKIT_ROOT/.claude/scripts/open-artifact.sh"
  PREFLIGHT_OK=false
fi

# Check files that will be copied to the target project
for f in VERSION CLAUDE.md LESSONS.md .env.local.example .claude/settings.local.json .claude/rules/toolkit.md .claude/rules/html-outputs.md artifacts/README.md .gitignore .gitattributes; do
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

# ─── Check for conflicting global commands ───────────────────
# If ~/.claude/commands/ has files with the same names as toolkit commands,
# they can override project-level commands and cause stale behavior.
GLOBAL_CMD_DIR="$HOME/.claude/commands"
if [ -d "$GLOBAL_CMD_DIR" ]; then
  CONFLICTS=()
  for src in "$TOOLKIT_ROOT/.claude/commands/"*.md; do
    fname="$(basename "$src")"
    if [ -f "$GLOBAL_CMD_DIR/$fname" ]; then
      CONFLICTS+=("$fname")
    fi
  done

  if [ ${#CONFLICTS[@]} -gt 0 ]; then
    echo "  ┌────────────────────────────────────────────────────┐"
    echo "  │  WARNING: Global commands may override this setup  │"
    echo "  └────────────────────────────────────────────────────┘"
    echo ""
    echo "    Found ${#CONFLICTS[@]} file(s) in $GLOBAL_CMD_DIR/"
    echo "    that share names with toolkit commands:"
    echo ""
    for f in "${CONFLICTS[@]}"; do
      echo "      - $f"
    done
    echo ""
    echo "    Global commands (~/.claude/commands/) can override"
    echo "    project commands (.claude/commands/), so you may get"
    echo "    outdated behavior even after updating the toolkit."
    echo ""
    echo "    To fix: delete the global copies listed above."
    echo "    They are not needed - the toolkit puts commands in"
    echo "    each project's .claude/commands/ folder instead."
    echo ""
  fi
fi

# ─── Detect install vs upgrade ───────────────────────────────
# Captured here, before any mkdir/copy runs, so we can tell later whether
# this target already had a toolkit install. The presence of a managed
# rules file is the most reliable signal: setup.sh always writes it, so a
# pre-existing copy proves an earlier setup ran. Used by the "new this
# version" announcement block below to fire on upgrades regardless of
# whether a legacy migration also happened.
IS_UPGRADE=0
if [ -f "$TARGET/.claude/rules/toolkit.md" ]; then
  IS_UPGRADE=1
fi

# ─── Create target directories ───────────────────────────────
mkdir -p "$TARGET/.claude/commands"
mkdir -p "$TARGET/.claude/rules"
mkdir -p "$TARGET/.claude/scripts"
mkdir -p "$TARGET/.claude/skills"
mkdir -p "$TARGET/plans"
mkdir -p "$TARGET/artifacts"

# ─── Backup helpers (issue #79) ──────────────────────────────
# Before overwriting or deleting any file in the target, copy the original
# to a timestamped backup directory at the target root. The directory is
# only created on the first backup (no noise for clean installs). All
# backups in one setup run share the same timestamp.
BACKUP_DIR=""
BACKUP_COUNT=0

# backup_file: copy a target-resident file into the backup root, mirroring
# its relative path. Creates the backup root lazily on first call. Appends
# the process PID to the timestamp so two same-second runs get distinct
# backup dirs (avoids silent overwrite of a prior run's backups). `cp -P`
# preserves symlinks as links so a backed-up symlink can be restored later.
backup_file() {
  local original="$1"
  if [ -z "$BACKUP_DIR" ]; then
    BACKUP_DIR="$TARGET/.toolkit-backup-$(date +%Y%m%d-%H%M%S)-$$"
  fi
  # Inner quotes make the prefix a literal, not a glob pattern - matters
  # if $TARGET contains `*`, `?`, or `[` characters.
  local rel="${original#"$TARGET"/}"
  local dest="$BACKUP_DIR/$rel"
  # mkdir -p handles nested paths and is portable across GNU and BSD systems
  mkdir -p "$(dirname "$dest")"
  cp -P "$original" "$dest"
  BACKUP_COUNT=$((BACKUP_COUNT + 1))
}

# safe_copy: copy src to dst. If dst exists and differs, back it up first.
# If dst is byte-identical to src, skip entirely (preserves mtime, keeps
# re-runs clean). Symlinks are backed up as links (not their targets), then
# removed before the new file is written - prevents `cp` from writing
# through the link and modifying the user's real target file.
safe_copy() {
  local src="$1"
  local dst="$2"
  if [ -L "$dst" ]; then
    backup_file "$dst"
    rm "$dst"
  elif [ -f "$dst" ]; then
    if cmp -s "$src" "$dst"; then
      return 0
    fi
    backup_file "$dst"
  fi
  cp "$src" "$dst"
}

# ─── Legacy cleanup (v3.4 -> v3.5 migration) ────────────────
# These commands were migrated to skills in v3.5. Delete old command
# files BEFORE copying new ones to avoid name conflicts.
LEGACY_COMMANDS=(review-code.md review-ux.md review-plan.md review-commands.md review-browser.md review-full.md learning-opportunity.md)
LEGACY_CLEANED=0
for fname in "${LEGACY_COMMANDS[@]}"; do
  if [ -f "$TARGET/.claude/commands/$fname" ]; then
    backup_file "$TARGET/.claude/commands/$fname"
    rm -f "$TARGET/.claude/commands/$fname"
    LEGACY_CLEANED=$((LEGACY_CLEANED + 1))
  fi
done
if [ "$LEGACY_CLEANED" -gt 0 ]; then
  echo "  Cleaned up $LEGACY_CLEANED legacy command file(s) (now skills)"
fi

# ─── Renamed files cleanup (issue #80) ───────────────────────
# When a toolkit file is renamed upstream (e.g. dev-lead-gpt.md -> ask-gpt.md),
# copying the new name is not enough: the old file sticks around and still
# loads as a stale slash command. Parallel indexed arrays map old -> new
# (associative arrays need Bash 4, setup.sh targets Bash 3.2+). Paths are
# relative to $TARGET. backup_file preserves any customizations the user
# made to the old-named file before rm removes it.
RENAMED_OLD=(
  .claude/commands/dev-lead-gpt.md
  .claude/commands/dev-lead-gemini.md
  scripts/dev-lead-gpt.js
  scripts/dev-lead-gemini.js
)
RENAMED_NEW=(
  .claude/commands/ask-gpt.md
  .claude/commands/ask-gemini.md
  .claude/scripts/ask-gpt.js
  .claude/scripts/ask-gemini.js
)
RENAMED_CLEANED=0
# `${!RENAMED_OLD[@]}` expands to the array's index list, scoping the loop
# variable cleanly and avoiding a manual counter. Bash 3.2 safe.
for i in "${!RENAMED_OLD[@]}"; do
  old_rel="${RENAMED_OLD[$i]}"
  new_rel="${RENAMED_NEW[$i]}"
  if [ -f "$TARGET/$old_rel" ]; then
    backup_file "$TARGET/$old_rel"
    rm -f "$TARGET/$old_rel"
    echo "  Removed renamed file: $old_rel -> $new_rel"
    RENAMED_CLEANED=$((RENAMED_CLEANED + 1))
  fi
done
if [ "$RENAMED_CLEANED" -gt 0 ]; then
  echo "  Cleaned up $RENAMED_CLEANED renamed file(s)"
fi

# ─── Plan migration (v3.5 -> v4.0) ─────────────────────────
# Plans moved from .claude/plans/ to plans/ (top-level) because .claude/
# is a protected path that always prompts for permission.
PLANS_MIGRATED=0
if compgen -G "$TARGET/.claude/plans/PLAN-*.md" > /dev/null 2>&1; then
  mkdir -p "$TARGET/plans"
  for plan in "$TARGET/.claude/plans/PLAN-"*.md; do
    fname="$(basename "$plan")"
    if [ -f "$TARGET/plans/$fname" ]; then
      echo "  Skipping $fname - already in plans/"
    else
      mv "$plan" "$TARGET/plans/"
      PLANS_MIGRATED=$((PLANS_MIGRATED + 1))
    fi
  done
fi
# Clean up old directory if empty (only .gitkeep or nothing left)
if [ -d "$TARGET/.claude/plans" ]; then
  rm -f "$TARGET/.claude/plans/.gitkeep"
  rmdir "$TARGET/.claude/plans" 2>/dev/null || true
fi
if [ "$PLANS_MIGRATED" -gt 0 ]; then
  echo "  Migrated $PLANS_MIGRATED plan file(s) from .claude/plans/ to plans/"
fi

# ─── Issue #91 migration (v4.2 -> v4.3): toolkit deps in target package.json ──
# In v4.2.x and earlier, toolkit deps (openai, @google/generative-ai,
# playwright-core, @axe-core/playwright) were installed at the project root,
# and runtime scripts lived at scripts/*.js. End users cloning the downstream
# project pulled toolkit deps they didn't need (issue #91). v4.3 quarantines
# both under .claude/scripts/. This block detects the old layout and cleans
# up. Runs BEFORE the copy block so old scripts are backed up before new ones
# land at .claude/scripts/.
ISSUE91_OLD_SCRIPTS=(
  scripts/ask-gpt.js
  scripts/ask-gemini.js
  scripts/browse.js
)
ISSUE91_SCRIPTS_REMOVED=0
for old_rel in "${ISSUE91_OLD_SCRIPTS[@]}"; do
  if [ -f "$TARGET/$old_rel" ]; then
    backup_file "$TARGET/$old_rel"
    rm -f "$TARGET/$old_rel"
    ISSUE91_SCRIPTS_REMOVED=$((ISSUE91_SCRIPTS_REMOVED + 1))
  fi
done

# Remove leaked toolkit deps and convenience scripts from $TARGET/package.json.
# Two-phase approach: dry-run detect first (to decide whether to back up), then
# write. The four deps are toolkit-owned and always safe to remove. The two
# convenience scripts are recognized only when their command body still points
# at the OLD `scripts/<name>.js` path - this avoids clobbering a script the
# user happens to have customized to do something else under the same name.
ISSUE91_PKG_TOUCHED=0
if [ -f "$TARGET/package.json" ] && command -v node > /dev/null 2>&1; then
  # Note: `node -e` wraps the script in a vm context, so a top-level `return`
  # is a SyntaxError. Use a nullable `pkg` + outer `if` instead of an early
  # return out of the try/catch.
  ISSUE91_PKG_DRY=$(TARGET_DIR="$TARGET" node -e "
    const fs = require('fs');
    let pkg = null;
    try { pkg = JSON.parse(fs.readFileSync(process.env.TARGET_DIR + '/package.json', 'utf-8')); } catch (_) {}
    if (pkg) {
      const TOOLKIT_DEPS = ['openai', '@google/generative-ai', '@google/genai', 'playwright-core', '@axe-core/playwright'];
      const TOOLKIT_SCRIPTS = ['ask-gpt', 'ask-gemini'];
      let touched = false;
      if (pkg.dependencies) {
        for (const dep of TOOLKIT_DEPS) {
          if (Object.prototype.hasOwnProperty.call(pkg.dependencies, dep)) { touched = true; break; }
        }
      }
      if (!touched && pkg.scripts) {
        for (const s of TOOLKIT_SCRIPTS) {
          const v = pkg.scripts[s];
          if (v && /node\\s+scripts\\/(ask-gpt|ask-gemini)\\.js/.test(v)) { touched = true; break; }
        }
      }
      if (touched) console.log('touched');
    }
  " 2>/dev/null) || true

  if [ "$ISSUE91_PKG_DRY" = "touched" ]; then
    backup_file "$TARGET/package.json"
    # Capture the write step's exit code instead of swallowing failures with
    # `|| true`. A migration that silently fails leaves the user with a backup
    # file, an "all clean" message, and an unchanged package.json - the worst
    # combination. Surface failures so the user can act.
    # The regex below intentionally matches the OLD `scripts/<name>.js` path,
    # not the new `.claude/scripts/...` path. We only want to remove convenience
    # scripts that point at the now-defunct location; new-path scripts are
    # user-authored and we leave them alone.
    if TARGET_DIR="$TARGET" node -e "
      const fs = require('fs');
      const pkgPath = process.env.TARGET_DIR + '/package.json';
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const TOOLKIT_DEPS = ['openai', '@google/generative-ai', '@google/genai', 'playwright-core', '@axe-core/playwright'];
      const TOOLKIT_SCRIPTS = ['ask-gpt', 'ask-gemini'];
      if (pkg.dependencies) {
        for (const dep of TOOLKIT_DEPS) delete pkg.dependencies[dep];
        if (Object.keys(pkg.dependencies).length === 0) delete pkg.dependencies;
      }
      if (pkg.scripts) {
        for (const s of TOOLKIT_SCRIPTS) {
          const v = pkg.scripts[s];
          if (v && /node\\s+scripts\\/(ask-gpt|ask-gemini)\\.js/.test(v)) delete pkg.scripts[s];
        }
        if (Object.keys(pkg.scripts).length === 0) delete pkg.scripts;
      }
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\\n');
    " 2>/dev/null; then
      ISSUE91_PKG_TOUCHED=1
    else
      echo "  Warning: could not rewrite $TARGET/package.json automatically."
      echo "    Original is preserved in $BACKUP_DIR/package.json."
      echo "    Manually remove these from your package.json dependencies:"
      echo "      openai  @google/generative-ai  @google/genai  playwright-core  @axe-core/playwright"
      echo "    And remove the ask-gpt / ask-gemini script entries if they still"
      echo "    point at scripts/ask-gpt.js or scripts/ask-gemini.js."
    fi
  fi
fi

if [ "$ISSUE91_SCRIPTS_REMOVED" -gt 0 ] || [ "$ISSUE91_PKG_TOUCHED" -gt 0 ]; then
  echo "  Migrated v4.2 -> v4.3 toolkit dep layout (issue #91):"
  if [ "$ISSUE91_SCRIPTS_REMOVED" -gt 0 ]; then
    echo "    - Removed $ISSUE91_SCRIPTS_REMOVED old script(s) from $TARGET/scripts/"
  fi
  if [ "$ISSUE91_PKG_TOUCHED" -gt 0 ]; then
    echo "    - Cleaned toolkit deps and convenience scripts from $TARGET/package.json"
  fi
  echo "    Run 'npm install --prefix .claude/scripts' to install the deps in the new location."
fi

# ─── Track what happens ──────────────────────────────────────
OVERWROTE=()
SKIPPED=()

# ─── Command files (upstream-owned - safe_copy backs up any customizations) ─
echo "  Copying .claude/commands/ ..."
for src in "$TOOLKIT_ROOT/.claude/commands/"*.md; do
  fname="$(basename "$src")"
  safe_copy "$src" "$TARGET/.claude/commands/$fname"
  OVERWROTE+=("commands/$fname")
done

# ─── Skill files (upstream-owned - always copy) ─────────────
echo "  Copying .claude/skills/ ..."

# Copy shared supporting files first
if [ -d "$TOOLKIT_ROOT/.claude/skills/shared" ]; then
  mkdir -p "$TARGET/.claude/skills/shared"
  for src in "$TOOLKIT_ROOT/.claude/skills/shared/"*.md; do
    [ -f "$src" ] || continue
    fname="$(basename "$src")"
    safe_copy "$src" "$TARGET/.claude/skills/shared/$fname"
  done
  OVERWROTE+=("skills/shared/")
fi

# Copy each skill directory (contains SKILL.md and optional supporting files)
for skill_dir in "$TOOLKIT_ROOT/.claude/skills/"*/; do
  [ -d "$skill_dir" ] || continue
  skill_name="$(basename "$skill_dir")"
  # Skip shared/ - already handled above
  [ "$skill_name" = "shared" ] && continue
  mkdir -p "$TARGET/.claude/skills/$skill_name"
  for src in "$skill_dir"*; do
    [ -f "$src" ] || continue
    fname="$(basename "$src")"
    safe_copy "$src" "$TARGET/.claude/skills/$skill_name/$fname"
  done
  OVERWROTE+=("skills/$skill_name/")
done

# ─── Runtime scripts and quarantined package.json (issue #91) ────────────────
# Runtime scripts and their deps live under .claude/scripts/ so they don't
# leak into the downstream project's root package.json. Setup scripts stay
# in the toolkit repo and are not copied to the target.
echo "  Copying .claude/scripts/ runtime files ..."
safe_copy "$TOOLKIT_ROOT/.claude/scripts/ask-gpt.js"     "$TARGET/.claude/scripts/ask-gpt.js"
safe_copy "$TOOLKIT_ROOT/.claude/scripts/ask-gemini.js"  "$TARGET/.claude/scripts/ask-gemini.js"
safe_copy "$TOOLKIT_ROOT/.claude/scripts/browse.js"      "$TARGET/.claude/scripts/browse.js"
safe_copy "$TOOLKIT_ROOT/.claude/scripts/package.json"   "$TARGET/.claude/scripts/package.json"
# Lockfile is optional - shipping it gives reproducible installs but if the
# toolkit author hasn't committed one yet, don't fail.
if [ -f "$TOOLKIT_ROOT/.claude/scripts/package-lock.json" ]; then
  safe_copy "$TOOLKIT_ROOT/.claude/scripts/package-lock.json" "$TARGET/.claude/scripts/package-lock.json"
fi
OVERWROTE+=(.claude/scripts/ask-gpt.js .claude/scripts/ask-gemini.js .claude/scripts/browse.js .claude/scripts/package.json)

# ─── .env.local.example (template - safe to overwrite) ───────
echo "  Copying .env.local.example ..."
cp "$TOOLKIT_ROOT/.env.local.example" "$TARGET/.env.local.example"
OVERWROTE+=(.env.local.example)

# ─── .gitignore (merge - preserve user entries, add toolkit lines) ─
if [ -f "$TARGET/.gitignore" ]; then
  echo "  Merging .gitignore (preserving your entries) ..."
  # Ensure target ends with a newline before appending
  [ -n "$(tail -c 1 "$TARGET/.gitignore")" ] && echo "" >> "$TARGET/.gitignore"
  while IFS= read -r line; do
    # Skip blank lines and comments to avoid accumulating duplicates on repeated runs
    [ -z "$line" ] || [[ "$line" == \#* ]] && continue
    if ! grep -qxF "$line" "$TARGET/.gitignore"; then
      echo "$line" >> "$TARGET/.gitignore"
    fi
  done < "$TOOLKIT_ROOT/.gitignore"
  OVERWROTE+=(".gitignore (merged)")
else
  echo "  Copying .gitignore ..."
  cp "$TOOLKIT_ROOT/.gitignore" "$TARGET/.gitignore"
  OVERWROTE+=(.gitignore)
fi

echo "  Copying .gitattributes ..."
safe_copy "$TOOLKIT_ROOT/.gitattributes" "$TARGET/.gitattributes"
OVERWROTE+=(.gitattributes)

echo "  Copying VERSION ..."
safe_copy "$TOOLKIT_ROOT/VERSION" "$TARGET/VERSION"
OVERWROTE+=(VERSION)

# ─── Toolkit rules (upstream-owned - safe_copy handles any customizations) ────────────
echo "  Copying .claude/rules/toolkit.md ..."
safe_copy "$TOOLKIT_ROOT/.claude/rules/toolkit.md" "$TARGET/.claude/rules/toolkit.md"
# Stamp the installed version into toolkit.md so users can check it later
# sed -i.bak works on both macOS (BSD sed) and Linux (GNU sed). This syntax was
# chosen for cross-platform compatibility - do not simplify to sed -i '' (breaks Linux).
sed -i.bak "s/<!-- This file is managed by the LLM Peer Review toolkit\./<!-- Toolkit version: $VERSION | Managed by LLM Peer Review./" "$TARGET/.claude/rules/toolkit.md"
rm -f "$TARGET/.claude/rules/toolkit.md.bak"
OVERWROTE+=(.claude/rules/toolkit.md)

# HTML output rules (issue #113) - same stamp pattern as toolkit.md.
# Source ships pre-stamped via bump-version.sh; this sed is a no-op on
# stamped files and harmless on re-runs.
echo "  Copying .claude/rules/html-outputs.md ..."
safe_copy "$TOOLKIT_ROOT/.claude/rules/html-outputs.md" "$TARGET/.claude/rules/html-outputs.md"
sed -i.bak "s/<!-- This file is managed by the LLM Peer Review toolkit\./<!-- Toolkit version: $VERSION | Managed by LLM Peer Review./" "$TARGET/.claude/rules/html-outputs.md"
rm -f "$TARGET/.claude/rules/html-outputs.md.bak"
OVERWROTE+=(.claude/rules/html-outputs.md)

# ─── artifacts/ scaffold (issue #113) ────────────────────────
# The HTML-output feature writes to artifacts/html/ in the target project.
# Ship the tracked README so the directory is discoverable and the gitignored
# html/ subdir has a home. safe_copy backs up any user customization.
echo "  Copying artifacts/README.md ..."
safe_copy "$TOOLKIT_ROOT/artifacts/README.md" "$TARGET/artifacts/README.md"
OVERWROTE+=(artifacts/README.md)

# PARITY: .claude/scripts/ files must be copied by BOTH setup.sh and setup.ps1.
# Add a new script to one installer? Add it to the other too (issue #126).
# ─── Index generator script (upstream-owned - safe_copy handles any customizations) ──
echo "  Copying .claude/scripts/generate-index.js ..."
safe_copy "$TOOLKIT_ROOT/.claude/scripts/generate-index.js" "$TARGET/.claude/scripts/generate-index.js"
OVERWROTE+=(.claude/scripts/generate-index.js)

# ─── Artifact opener script (upstream-owned - safe_copy handles any customizations) ──
echo "  Copying .claude/scripts/open-artifact.sh ..."
safe_copy "$TOOLKIT_ROOT/.claude/scripts/open-artifact.sh" "$TARGET/.claude/scripts/open-artifact.sh"
OVERWROTE+=(.claude/scripts/open-artifact.sh)

# ─── Project-owned files (skip if already exist) ─────────────
for f in CLAUDE.md LESSONS.md .claude/settings.local.json; do
  if [ -f "$TARGET/$f" ]; then
    echo "  Skipping $f - already exists (yours to customize)"
    SKIPPED+=("$f")
  else
    echo "  Copying $f ..."
    cp "$TOOLKIT_ROOT/$f" "$TARGET/$f"
    OVERWROTE+=("$f")
  fi
done

# ─── Merge new permissions into existing settings.local.json ─
# When upgrading, the user's settings.local.json is preserved (not overwritten).
# But new toolkit versions may require new permissions. This block:
#   1. Adds any missing permissions from the toolkit's template
#   2. Removes stale absolute-path browse.js permissions from old project locations
#   3. Injects absolute-path browse.js pipe permissions for the current $TARGET
# All three steps happen in one pass to avoid reading/writing the file multiple times.
# Paths are passed via environment variables to avoid quoting issues with special
# characters in directory names (spaces, quotes, etc.).
if [ -f "$TARGET/.claude/settings.local.json" ] && command -v node > /dev/null 2>&1; then
  PERMS_ADDED=$(TOOLKIT_SRC="$TOOLKIT_ROOT" TARGET_DIR="$TARGET" node -e "
    const fs = require('fs');
    const toolkitSrc = process.env.TOOLKIT_SRC;
    const targetDir = process.env.TARGET_DIR;
    const src = JSON.parse(fs.readFileSync(toolkitSrc + '/.claude/settings.local.json', 'utf-8'));
    const tgt = JSON.parse(fs.readFileSync(targetDir + '/.claude/settings.local.json', 'utf-8'));
    if (!tgt.permissions) tgt.permissions = {};
    if (!tgt.permissions.allow) tgt.permissions.allow = [];
    const srcPerms = (src.permissions && src.permissions.allow) || [];
    let tgtPerms = tgt.permissions.allow;

    // Step 1: merge missing template permissions (the new .claude/scripts/-prefixed
    // entries land here automatically once the source template has been updated).
    const missing = srcPerms.filter(p => !tgtPerms.includes(p));

    // Step 2a: remove stale relative-path entries for the v4.2-and-earlier
    // script layout. Their replacements (with .claude/scripts/ prefix) come
    // in via Step 1's missing-template merge.
    const STALE_RELATIVE_PERMS = [
      'Bash(node scripts/ask-gpt.js *)',
      'Bash(node scripts/ask-gemini.js *)',
      'Bash(node scripts/browse.js *)',
      'Bash(echo * | node scripts/browse.js *)',
      'Bash(cat * | node scripts/browse.js *)'
    ];
    const staleRel = tgtPerms.filter(p => STALE_RELATIVE_PERMS.includes(p));

    // Step 2b: remove stale absolute-path browse.js entries. Matches both old
    // (.../scripts/browse.js) and new (.../.claude/scripts/browse.js) shapes,
    // then drops anything that doesn't equal one of the two correct entries
    // for the current target. Using exact equality (not substring .includes())
    // avoids accidentally over-keeping unusual hand-edited entries that happen
    // to contain the target prefix.
    const browsePattern = /^Bash\\((echo|cat) \\* \\| node \\/.*\\/(\\.claude\\/)?scripts\\/browse\\.js \\*\\)$/;
    const correctAbsEntries = new Set([
      'Bash(echo * | node ' + targetDir + '/.claude/scripts/browse.js *)',
      'Bash(cat * | node ' + targetDir + '/.claude/scripts/browse.js *)'
    ]);
    const staleAbs = tgtPerms.filter(p => browsePattern.test(p) && !correctAbsEntries.has(p));

    const stale = [...staleRel, ...staleAbs];
    tgtPerms = tgtPerms.filter(p => !stale.includes(p));

    // Step 3: add absolute-path browse.js permissions for the current target,
    // pointing at the new .claude/scripts/ location.
    const absPerms = [
      'Bash(echo * | node ' + targetDir + '/.claude/scripts/browse.js *)',
      'Bash(cat * | node ' + targetDir + '/.claude/scripts/browse.js *)'
    ];
    const absNew = absPerms.filter(p => !tgtPerms.includes(p));

    const allNew = [...missing, ...absNew];
    if (allNew.length > 0 || stale.length > 0) {
      tgt.permissions.allow = [...tgtPerms, ...allNew];
      fs.writeFileSync(targetDir + '/.claude/settings.local.json', JSON.stringify(tgt, null, 2) + '\n');
      stale.forEach(p => console.log('removed: ' + p));
      allNew.forEach(p => console.log(p));
    }
  " 2>&1) || true
  if [ -n "$PERMS_ADDED" ]; then
    echo "  Updating permissions in .claude/settings.local.json ..."
    echo "$PERMS_ADDED" | while IFS= read -r perm; do
      case "$perm" in
        removed:*) echo "    - ${perm#removed: }" ;;
        *)         echo "    + $perm" ;;
      esac
    done
  fi
fi

# ─── Codebase map (CODEBASE_MAP.md) ─────────────────────────
# CODEBASE_MAP.md is a semantic map of the project (module purposes,
# conventions, gotchas, navigation guide). It is generated by the /index
# slash command, which spawns parallel Claude subagents - that requires
# a Claude session, so setup.sh cannot generate the map directly.
# /explore auto-runs /index on first use if no map exists, so the user
# does not need to invoke it manually.
#
# Legacy cleanup: prior toolkit versions wrote a flat-tree INDEX.md here.
# Remove it during upgrade so the user is not left with a stale flat tree
# alongside the new semantic map.
if [ -f "$TARGET/INDEX.md" ]; then
  backup_file "$TARGET/INDEX.md"
  rm -f "$TARGET/INDEX.md"
  echo "  Removed legacy INDEX.md (replaced by CODEBASE_MAP.md - generated on first /explore)"
fi

# Also strip stale INDEX.md entries from the target's .gitignore. The merge
# logic above only adds new lines, never removes retired ones, so without
# this block downstream users would keep dangling INDEX.md gitignore entries
# even after the file itself is gone. sed -i.bak is cross-platform safe
# (macOS BSD sed and Linux GNU sed both accept it); the .bak is removed
# immediately after.
if [ -f "$TARGET/.gitignore" ] && grep -qxF "INDEX.md" "$TARGET/.gitignore"; then
  sed -i.bak '/^# Project index (auto-generated by toolkit)$/d; /^INDEX\.md$/d' "$TARGET/.gitignore"
  rm -f "$TARGET/.gitignore.bak"
  echo "    Cleaned stale INDEX.md entries from .gitignore"
fi

# ─── Summary ─────────────────────────────────────────────────
echo ""
echo "  ================================"
echo "   Done"
echo "  ================================"
echo ""

# ─── Backup summary (issue #79) ──────────────────────────────
# Only printed when at least one file was backed up. Clean installs and
# identical re-runs stay silent.
if [ "$BACKUP_COUNT" -gt 0 ]; then
  echo "    Backed up $BACKUP_COUNT file(s) to:"
  echo "      $BACKUP_DIR"
  echo ""
  echo "    New in v4.2 - setup now preserves any file it would overwrite"
  echo "    or delete. If you customized a toolkit file, your original is"
  echo "    safe in the directory above. Delete when you are done."
  echo ""
fi

if [ ${#SKIPPED[@]} -gt 0 ]; then
  echo "    Skipped (already existed - not overwritten):"
  for f in "${SKIPPED[@]}"; do
    echo "      - $f"
  done
  echo ""
  echo "    To refresh a skipped file: delete it and rerun this script."
  echo ""
fi

# ─── Upgrade notes (shown if legacy cleanup or plan migration happened) ─
if [ "$LEGACY_CLEANED" -gt 0 ] || [ "$PLANS_MIGRATED" -gt 0 ]; then
  echo "    ┌────────────────────────────────────────────────┐"
  echo "    │  Upgraded to v$VERSION - here's what changed:     │"
  echo "    └────────────────────────────────────────────────┘"
  echo ""
  if [ "$LEGACY_CLEANED" -gt 0 ]; then
    echo "      - Review commands are now skills (.claude/skills/)"
    echo "        They still work as /review-code, /review-ux, etc."
    echo ""
    echo "      - NEW: /review - auto-detects changes, dispatches"
    echo "        the right review skills, combines findings"
    echo ""
    echo "      - NEW: /review-deps - dependency security review"
    echo "      - NEW: /codebase-to-course - learn any codebase"
    echo ""
    echo "      - browse.js now supports accessibility scanning"
    echo "        and responsive screenshots. The dep ships with"
    echo "        the toolkit's quarantined .claude/scripts/."
    echo ""
  fi
  if [ "$PLANS_MIGRATED" -gt 0 ]; then
    echo "      - Plans moved from .claude/plans/ to plans/"
    echo "        No more permission prompts for plan files."
    echo "        Your existing plans were moved automatically."
    echo ""
  fi
  echo "      See CHANGELOG.md for full details."
  echo ""
fi

# ─── New-this-version announcement (upgrades only) ───────────
# Fires on any upgrade, independent of the LEGACY_CLEANED/PLANS_MIGRATED
# gate above. Exists because a plain version bump (e.g. 4.6 -> 4.7) would
# otherwise land silently and users would never learn about the HTML
# viewing feature their old workflows now produce.
if [ "$IS_UPGRADE" -eq 1 ] && [ "$LEGACY_CLEANED" -eq 0 ] && [ "$PLANS_MIGRATED" -eq 0 ]; then
  echo "    ┌────────────────────────────────────────────────┐"
  echo "    │  Upgraded to v$VERSION - new this version:        │"
  echo "    └────────────────────────────────────────────────┘"
  echo ""
  echo "      - HTML viewing for human-read outputs."
  echo "        /create-plan and /document now render an HTML view"
  echo "        alongside markdown. /review-* and /ask-* may render"
  echo "        HTML when a finding count or severity mix justifies it."
  echo "        Markdown stays canonical; HTML is additive."
  echo ""
  echo "      - NEW: /audit-html scans your project's own markdown"
  echo "        for files that would benefit from an HTML view."
  echo "        Report-only; opt-in for static view generation."
  echo ""
  echo "      See .claude/rules/html-outputs.md and CHANGELOG.md."
  echo ""
fi

# ─── Current model defaults ──────────────────────────────────
# Extract defaults from the runtime scripts at install time so this block
# stays in sync without a hardcoded list. The grep target is the stable
# `const DEFAULT_X_MODEL = 'value';` line in each script. Fall back to
# "unknown" so a display bug never breaks the setup run.
GPT_DEFAULT="$(grep -oE "const DEFAULT_GPT_MODEL = '[^']+'" "$TOOLKIT_ROOT/.claude/scripts/ask-gpt.js" 2>/dev/null | sed -E "s/.*'([^']+)'/\\1/" | head -1)"
GEMINI_DEFAULT="$(grep -oE "const DEFAULT_GEMINI_MODEL = '[^']+'" "$TOOLKIT_ROOT/.claude/scripts/ask-gemini.js" 2>/dev/null | sed -E "s/.*'([^']+)'/\\1/" | head -1)"
GPT_DEFAULT="${GPT_DEFAULT:-unknown}"
GEMINI_DEFAULT="${GEMINI_DEFAULT:-unknown}"

echo "    Current model defaults (used when .env.local has no override):"
echo "      GPT_MODEL     = $GPT_DEFAULT"
echo "      GEMINI_MODEL  = $GEMINI_DEFAULT"
echo ""
echo "    The scripts override known-stale GPT_MODEL/GEMINI_MODEL values in"
echo "    .env.local with a warning. We never read or write your API keys."
echo ""

echo "    What to do next:"
echo ""
echo "      cd $TARGET"
echo ""
echo "      1. Install the toolkit's runtime packages."
echo "         (Stays inside .claude/scripts/. Your project's"
echo "         package.json is not touched.)"
echo "           npm install --prefix .claude/scripts"
echo ""
echo "      2. Set up your API keys:"
echo "           cp .env.local.example .env.local"
echo "         Then open .env.local and paste:"
echo "           OPENAI_API_KEY  ->  https://platform.openai.com/api-keys"
echo "           GEMINI_API_KEY  ->  https://aistudio.google.com/apikey"
echo ""
echo "      3. Open the folder in Cursor and run /explore to start your first workflow."
echo ""
echo "      4. (Optional) Install Chromium for /review-browser:"
echo "           npx --prefix .claude/scripts playwright-core install chromium"
echo "         On WSL/Linux, also run (apt-based; no --prefix needed):"
echo "           sudo npx playwright-core install-deps chromium"
echo ""
echo "      5. (Optional) Try /audit-html. It scans your project's"
echo "         own markdown for files that would benefit from an"
echo "         HTML view. Toolkit outputs (plans, reviews, debates)"
echo "         already render HTML automatically."
echo ""
echo "      Steps 1-4 are optional. Skip 1-2 if you don't need"
echo "      /ask-gpt or /ask-gemini. Skip 4 if you don't need"
echo "      /review-browser. Skip 5 if your project has no long"
echo "      human-read markdown."
echo ""
echo "    Tip: To update commands, skills, and scripts, run setup again from"
echo "    the toolkit repo: bash /path/to/llm-peer-review/scripts/setup/setup.sh $TARGET"
echo ""
