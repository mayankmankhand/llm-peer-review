#!/bin/bash
#
# setup.sh - Copy the LLM Peer Review toolkit into any project.
# Compatible with Bash 3.2+ (macOS default), Linux, and WSL.
#
# Usage:
#   bash /path/to/llm-peer-review/scripts/setup/setup.sh [target-directory] [--dry-run] [--force]
#
# If no target directory is given, uses the current working directory
# (but will error if run from inside the toolkit repo).
#
# --dry-run prints the pre-flight report (version gap, migrations that
# would run, managed files that would be overwritten, custom files that
# are left alone, backup location) and exits without creating, modifying,
# or deleting anything.
#
# --force skips the overwrite confirmation for locally modified managed
# files (issue #138). Without it, setup prompts before replacing files
# you have edited, and aborts when it cannot prompt (no terminal). Every
# replaced file is backed up first either way.
#
# Examples:
#   # From toolkit repo, specify target:
#   bash scripts/setup/setup.sh ~/Projects/my-app
#
#   # See what an upgrade would do without changing anything:
#   bash scripts/setup/setup.sh ~/Projects/my-app --dry-run
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

# ─── Arguments ───────────────────────────────────────────────
# Positional target directory plus the optional --dry-run and --force
# flags, in any order. Unknown options error out instead of being
# mistaken for a target directory.
TARGET=""
DRY_RUN=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=1
      ;;
    --force)
      FORCE=1
      ;;
    -*)
      echo ""
      echo "  Error: unknown option: $arg"
      echo "  Usage: bash setup.sh [target-directory] [--dry-run] [--force]"
      echo ""
      exit 1
      ;;
    *)
      if [ -n "$TARGET" ]; then
        echo ""
        echo "  Error: more than one target directory given: $TARGET, $arg"
        echo ""
        exit 1
      fi
      TARGET="$arg"
      ;;
  esac
done
TARGET="${TARGET:-.}"

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

# Check HTML renderer script (dependency-free, like generate-index.js / open-artifact.sh)
if [ ! -f "$TOOLKIT_ROOT/.claude/scripts/render-html.js" ]; then
  echo "  Error: source file not found: $TOOLKIT_ROOT/.claude/scripts/render-html.js"
  PREFLIGHT_OK=false
fi

# Check session-init script (dependency-free; aggregates command-startup reads into one JSON)
if [ ! -f "$TOOLKIT_ROOT/.claude/scripts/session-init.js" ]; then
  echo "  Error: source file not found: $TOOLKIT_ROOT/.claude/scripts/session-init.js"
  PREFLIGHT_OK=false
fi

# Check pre-push tripwire script (dependency-free; the M11 secret scan run before any push)
if [ ! -f "$TOOLKIT_ROOT/.claude/scripts/pre-push-check.js" ]; then
  echo "  Error: source file not found: $TOOLKIT_ROOT/.claude/scripts/pre-push-check.js"
  PREFLIGHT_OK=false
fi

# Check correction-ledger script (dependency-free; the issue #157 capture + rollup helper)
if [ ! -f "$TOOLKIT_ROOT/.claude/scripts/correction-ledger.js" ]; then
  echo "  Error: source file not found: $TOOLKIT_ROOT/.claude/scripts/correction-ledger.js"
  PREFLIGHT_OK=false
fi

# Check files that will be copied to the target project
for f in VERSION CLAUDE.md LESSONS.md LESSONS-detail.md .env.local.example .claude/settings.local.json .claude/rules/toolkit.md .claude/rules/html-outputs.md artifacts/README.md .gitignore .gitattributes; do
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

# ─── Migration inventory (issue #133) ────────────────────────
# The legacy-path lists consumed by the migration blocks further down,
# defined once up here so the pre-flight report can announce which
# migrations will run BEFORE any of them executes.

# v3.4 -> v3.5: commands that became skills (deleted before copy to
# avoid name conflicts; backed up first).
LEGACY_COMMANDS=(review-code.md review-ux.md review-plan.md review-commands.md review-browser.md review-full.md learning-opportunity.md)

# Issue #80: upstream renames, old -> new. Parallel indexed arrays map
# old -> new (associative arrays need Bash 4, setup.sh targets Bash 3.2+).
# Paths are relative to $TARGET.
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

# Issue #91 (v4.2 -> v4.3): runtime scripts that moved from scripts/ to
# .claude/scripts/ (old copies backed up, then removed).
ISSUE91_OLD_SCRIPTS=(
  scripts/ask-gpt.js
  scripts/ask-gemini.js
  scripts/browse.js
)

# ─── Pre-flight report (issue #133) ──────────────────────────
# Everything in this section is READ-ONLY. It prints what this run will
# do - the version gap, which migrations fire, which managed files will
# be overwritten (with a diff summary), which custom files are left
# alone, and where backups go - BEFORE any file is created, modified,
# or deleted. With --dry-run, the script exits right after this report.

# The backup directory name is fixed here so the report can announce the
# location up front. Creation stays lazy: the directory only appears if
# something is actually backed up. The process PID suffix keeps two
# same-second runs from sharing a backup dir.
BACKUP_DIR="$TARGET/.toolkit-backup-$(date +%Y%m%d-%H%M%S)-$$"

# Old version for the gap line. IS_UPGRADE (not the VERSION file) decides
# install vs upgrade: early toolkit versions did not ship VERSION, and a
# fresh target may carry its own unrelated VERSION file.
OLD_VERSION=""
if [ "$IS_UPGRADE" -eq 1 ] && [ -f "$TARGET/VERSION" ]; then
  OLD_VERSION="$(tr -d '[:space:]' < "$TARGET/VERSION")"
fi

# Strips the managed-version stamp comment that setup rewrites on copy,
# so a pure version-bump difference in the two rules files is not
# misreported as a local edit. Covers both the current pre-stamped form
# and the unstamped form older installs may still carry.
PF_STAMP_SED='/<!-- Toolkit version: .* | Managed by LLM Peer Review\./d
/<!-- This file is managed by the LLM Peer Review toolkit\./d'

# ─── Overwrite guardrails: hashes + manifest (issue #138) ────
# The manifest written at the end of every real run records the sha256 of
# each managed file exactly as setup left it on disk. On the next run,
# comparing a file's current hash against that recorded hash separates
# "locally modified" (the user edited it - confirm before overwriting)
# from "outdated" (setup wrote it and the toolkit has since moved on -
# normal overwrite with backup). Hashes are EOL-normalized (CR bytes
# stripped before hashing) so a CRLF flip on Windows never flags a file
# as modified; forward-slash keys keep the manifest portable between
# setup.sh and setup.ps1.
MANIFEST_FILE="$TARGET/.claude/.toolkit-manifest.json"

# toolkit_sha256_stdin: sha256 hex digest of stdin. Fallback chain covers
# macOS, which ships shasum and openssl but not sha256sum. Every branch is
# guarded so a machine with none of the three fails with a clear message
# instead of a raw command-not-found mid-preflight.
toolkit_sha256_stdin() {
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  elif command -v shasum > /dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  elif command -v openssl > /dev/null 2>&1; then
    openssl dgst -sha256 | awk '{print $NF}'
  else
    echo "Error: no sha256 tool found (need sha256sum, shasum, or openssl)." >&2
    exit 1
  fi
}

# toolkit_hash <file> [stamped]: EOL-normalized sha256 of <file>. In
# stamped mode the managed-version stamp line is dropped first (the same
# PF_STAMP_SED normalization the diff report uses), so a pure version-
# bump difference in the two rules files never reads as a local edit.
toolkit_hash() {
  local f="$1" mode="${2:-plain}"
  if [ "$mode" = "stamped" ]; then
    sed "$PF_STAMP_SED" "$f" | tr -d '\r' | toolkit_sha256_stdin
  else
    tr -d '\r' < "$f" | toolkit_sha256_stdin
  fi
}

# manifest_lookup <rel>: the recorded hash for <rel>, empty when the
# manifest is absent or has no entry (pre-manifest installs). The
# manifest is written by this script in a fixed one-entry-per-line shape,
# so a grep/sed line parse is safe and avoids a node dependency.
manifest_lookup() {
  local rel="$1"
  [ -f "$MANIFEST_FILE" ] || return 0
  grep -F "\"$rel\": \"" "$MANIFEST_FILE" 2>/dev/null | head -1 | sed -n 's/.*": "\([0-9a-f]\{64\}\)".*/\1/p'
}

# preflight_record_diff <src> <rel> [stamped]
# Compares the incoming file <src> against $TARGET/<rel>. If the target
# copy exists and differs, records it with a +added/-removed line summary
# and a manifest-based classification (issue #138). Three cases:
#   [outdated]                   the manifest has an entry and the file
#                                still matches it: setup wrote this file
#                                and the toolkit has since moved on -
#                                normal overwrite with backup, no gate
#   [LOCALLY MODIFIED]           the manifest has an entry and the file no
#                                longer matches it (the user edited it),
#                                OR the manifest exists but has NO entry
#                                for this path. The manifest is regenerated
#                                wholesale on every run and lists everything
#                                the last run wrote, so a managed path with
#                                no entry is a file the user created
#                                themselves that the toolkit now ships
#                                under the same name. Both gate the run:
#                                prompt, or require --force, before the
#                                file is replaced (backed up first)
#   [differs, provenance unknown] no manifest file at all (a pre-manifest
#                                install), so there is nothing to compare
#                                against - warn + backup, no gate
PF_DIFFS=()
PF_MODIFIED=()
MANAGED_RELS=()
preflight_record_diff() {
  local src="$1" rel="$2" mode="${3:-plain}"
  local dst="$TARGET/$rel"
  local diffout added removed cls_inc cls_cur cls_man cls_label
  # Every enumerated file is manifest-managed, whether or not it exists in
  # the target yet. The manifest write at the end of the run reuses this
  # list, so the two enumerations cannot drift apart.
  MANAGED_RELS+=("$rel")
  [ -f "$dst" ] || return 0
  if [ "$mode" = "stamped" ]; then
    diffout=$(diff <(sed "$PF_STAMP_SED" "$dst") <(sed "$PF_STAMP_SED" "$src") 2>/dev/null) || true
  else
    if cmp -s "$src" "$dst"; then return 0; fi
    diffout=$(diff "$dst" "$src" 2>/dev/null) || true
  fi
  [ -n "$diffout" ] || return 0
  added=$(printf '%s\n' "$diffout" | grep -c '^>') || true
  removed=$(printf '%s\n' "$diffout" | grep -c '^<') || true
  # Classification for the overwrite gate. The clean check (current vs
  # incoming, stamp-normalized for the two rules files) never reaches
  # here - identical files returned above. The manifest hash was recorded
  # from the FINAL on-disk file of the previous run (after version
  # stamping), so it is compared against the plain EOL-normalized hash.
  cls_label=""
  cls_cur=$(toolkit_hash "$dst" "$mode")
  cls_inc=$(toolkit_hash "$src" "$mode")
  if [ "$cls_cur" != "$cls_inc" ]; then
    cls_man=$(manifest_lookup "$rel")
    if [ -n "$cls_man" ]; then
      if [ "$(toolkit_hash "$dst")" = "$cls_man" ]; then
        cls_label=" [outdated]"
      else
        cls_label=" [LOCALLY MODIFIED]"
        PF_MODIFIED+=("$rel")
      fi
    elif [ -f "$MANIFEST_FILE" ]; then
      # Manifest present, entry absent: setup never wrote this path, the
      # user did (see the case list above). Gated like any local edit.
      cls_label=" [LOCALLY MODIFIED]"
      PF_MODIFIED+=("$rel")
    else
      cls_label=" [differs, provenance unknown]"
    fi
  fi
  PF_DIFFS+=("$rel  (+$added/-$removed line(s) vs incoming)$cls_label")
}

# preflight_is_migration_target <rel>: true when a target file is one of
# the legacy paths a migration block will remove. Those are reported
# under "migrations", not as custom files (they will NOT be left alone).
preflight_is_migration_target() {
  local rel="$1" pf_name
  for pf_name in "${LEGACY_COMMANDS[@]}"; do
    if [ "$rel" = ".claude/commands/$pf_name" ]; then return 0; fi
  done
  for pf_name in "${RENAMED_OLD[@]}"; do
    if [ "$rel" = "$pf_name" ]; then return 0; fi
  done
  return 1
}

# Which staged migrations will fire. Read-only mirrors of the conditions
# the migration blocks below check.
PF_MIGRATIONS=()
PF_COUNT=0
for pf_name in "${LEGACY_COMMANDS[@]}"; do
  if [ -f "$TARGET/.claude/commands/$pf_name" ]; then PF_COUNT=$((PF_COUNT + 1)); fi
done
if [ "$PF_COUNT" -gt 0 ]; then
  PF_MIGRATIONS+=("Legacy command cleanup (v3.5): $PF_COUNT command file(s) became skills - old copies backed up, then removed")
fi
PF_COUNT=0
for pf_rel in "${RENAMED_OLD[@]}"; do
  if [ -f "$TARGET/$pf_rel" ]; then PF_COUNT=$((PF_COUNT + 1)); fi
done
if [ "$PF_COUNT" -gt 0 ]; then
  PF_MIGRATIONS+=("Renamed-file cleanup (issue #80): $PF_COUNT old-named file(s) backed up, then removed")
fi
PF_COUNT=$(compgen -G "$TARGET/.claude/plans/PLAN-*.md" 2>/dev/null | wc -l | tr -d ' ')
if [ "$PF_COUNT" -gt 0 ]; then
  PF_MIGRATIONS+=("Plan migration (v4.0): $PF_COUNT plan(s) move from .claude/plans/ to plans/")
fi
PF_COUNT=0
for pf_rel in "${ISSUE91_OLD_SCRIPTS[@]}"; do
  if [ -f "$TARGET/$pf_rel" ]; then PF_COUNT=$((PF_COUNT + 1)); fi
done
if [ "$PF_COUNT" -gt 0 ]; then
  PF_MIGRATIONS+=("Script relocation (issue #91): $PF_COUNT old script(s) under scripts/ backed up, then removed")
fi

# Issue #91 package.json detection. Computed once here (read-only) and
# reused by the migration block below, so detection and action cannot
# drift apart.
# Note: `node -e` wraps the script in a vm context, so a top-level `return`
# is a SyntaxError. Use a nullable `pkg` + outer `if` instead of an early
# return out of the try/catch.
ISSUE91_PKG_DRY=""
if [ -f "$TARGET/package.json" ] && command -v node > /dev/null 2>&1; then
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
fi
if [ "$ISSUE91_PKG_DRY" = "touched" ]; then
  PF_MIGRATIONS+=("package.json cleanup (issue #91): toolkit deps/scripts removed from your package.json (backed up first)")
fi
if [ -f "$TARGET/INDEX.md" ]; then
  PF_MIGRATIONS+=("Legacy INDEX.md removal: backed up, then removed (replaced by CODEBASE_MAP.md)")
fi

# Managed files that differ from the incoming version. The enumeration
# below mirrors the copy blocks exactly: every file setup overwrites via
# safe_copy is compared here, nothing else.
for pf_src in "$TOOLKIT_ROOT/.claude/commands/"*.md; do
  preflight_record_diff "$pf_src" ".claude/commands/$(basename "$pf_src")"
done
if [ -d "$TOOLKIT_ROOT/.claude/skills/shared" ]; then
  # failglob off for the loop, then restored - see the shells/ block below.
  # Pre-flight verifies commands/*.md is non-empty but never checks shared/,
  # so an existing-but-empty shared/ would otherwise abort the run here.
  shopt -u failglob; shopt -s nullglob
  for pf_src in "$TOOLKIT_ROOT/.claude/skills/shared/"*.md; do
    [ -f "$pf_src" ] || continue
    preflight_record_diff "$pf_src" ".claude/skills/shared/$(basename "$pf_src")"
  done
  shopt -u nullglob; shopt -s failglob
fi
if [ -d "$TOOLKIT_ROOT/.claude/skills/shared/shells" ]; then
  # failglob (set globally at the top) takes precedence over nullglob, so
  # nullglob alone does NOT stop an empty directory from aborting the run with
  # "no match" - failglob must be turned OFF for the duration of the loop and
  # restored afterward. Verified on bash 5.2 (issue #152).
  shopt -u failglob; shopt -s nullglob
  for pf_src in "$TOOLKIT_ROOT/.claude/skills/shared/shells/"*; do
    [ -f "$pf_src" ] || continue
    preflight_record_diff "$pf_src" ".claude/skills/shared/shells/$(basename "$pf_src")"
  done
  shopt -u nullglob; shopt -s failglob
fi
shopt -u failglob; shopt -s nullglob
for pf_skill_dir in "$TOOLKIT_ROOT/.claude/skills/"*/; do
  [ -d "$pf_skill_dir" ] || continue
  pf_skill_name="$(basename "$pf_skill_dir")"
  [ "$pf_skill_name" = "shared" ] && continue
  for pf_src in "$pf_skill_dir"*; do
    [ -f "$pf_src" ] || continue
    preflight_record_diff "$pf_src" ".claude/skills/$pf_skill_name/$(basename "$pf_src")"
  done
done
shopt -u nullglob; shopt -s failglob
if [ -d "$TOOLKIT_ROOT/.claude/agents" ]; then
  # failglob off for the loop, then restored - see the shells/ block above.
  shopt -u failglob; shopt -s nullglob
  for pf_src in "$TOOLKIT_ROOT/.claude/agents/"*.md; do
    [ -f "$pf_src" ] || continue
    preflight_record_diff "$pf_src" ".claude/agents/$(basename "$pf_src")"
  done
  shopt -u nullglob; shopt -s failglob
fi
for pf_name in ask-gpt.js ask-gemini.js browse.js package.json generate-index.js open-artifact.sh render-html.js session-init.js pre-push-check.js correction-ledger.js; do
  preflight_record_diff "$TOOLKIT_ROOT/.claude/scripts/$pf_name" ".claude/scripts/$pf_name"
done
if [ -f "$TOOLKIT_ROOT/.claude/scripts/package-lock.json" ]; then
  preflight_record_diff "$TOOLKIT_ROOT/.claude/scripts/package-lock.json" ".claude/scripts/package-lock.json"
fi
preflight_record_diff "$TOOLKIT_ROOT/.env.local.example" ".env.local.example"
preflight_record_diff "$TOOLKIT_ROOT/.gitattributes" ".gitattributes"
preflight_record_diff "$TOOLKIT_ROOT/artifacts/README.md" "artifacts/README.md"
preflight_record_diff "$TOOLKIT_ROOT/.claude/rules/toolkit.md" ".claude/rules/toolkit.md" stamped
preflight_record_diff "$TOOLKIT_ROOT/.claude/rules/html-outputs.md" ".claude/rules/html-outputs.md" stamped
# VERSION is compared only on a fresh install: on upgrade it always
# differs (that is the version gap, reported above), but a fresh target
# carrying its own unrelated VERSION file is about to lose it. On
# upgrade it still joins MANAGED_RELS so the manifest keeps tracking it.
if [ "$IS_UPGRADE" -eq 0 ]; then
  preflight_record_diff "$TOOLKIT_ROOT/VERSION" "VERSION"
else
  MANAGED_RELS+=("VERSION")
fi

# Custom files in toolkit-managed directories. Anything listed here is
# NOT shipped by the toolkit and setup NEVER modifies or deletes it:
# the copy loops only write files that exist in the toolkit source, and
# the migration blocks only touch the specific legacy paths inventoried
# above. node_modules/ (created by npm install under .claude/scripts/)
# is skipped - it is machine-generated, not a customization.
PF_CUSTOM=()
for pf_dir_name in agents commands rules scripts skills; do
  pf_dir="$TARGET/.claude/$pf_dir_name"
  [ -d "$pf_dir" ] || continue
  while IFS= read -r pf_file; do
    [ -n "$pf_file" ] || continue
    pf_rel="${pf_file#"$TARGET"/}"
    if preflight_is_migration_target "$pf_rel"; then continue; fi
    [ -f "$TOOLKIT_ROOT/$pf_rel" ] && continue
    PF_CUSTOM+=("$pf_rel")
  done < <(find "$pf_dir" -name node_modules -prune -o -type f -print 2>/dev/null | sort)
done

# Stale backup directories from earlier runs (issue #133 evidence: these
# linger in project roots for years without anyone noticing).
PF_STALE_BACKUPS=$(find "$TARGET" -maxdepth 1 -name '.toolkit-backup-*' -type d 2>/dev/null | wc -l | tr -d ' ')

echo "  ────────────────────────────────────────"
echo "   Pre-flight report (no changes made yet)"
echo "  ────────────────────────────────────────"
echo ""
if [ "$IS_UPGRADE" -eq 1 ]; then
  if [ -n "$OLD_VERSION" ] && [ "$OLD_VERSION" != "$VERSION" ]; then
    echo "    Install type: upgrade (v$OLD_VERSION -> v$VERSION)"
  elif [ -n "$OLD_VERSION" ]; then
    echo "    Install type: re-run of v$VERSION"
  else
    echo "    Install type: upgrade (pre-VERSION install -> v$VERSION)"
  fi
else
  echo "    Install type: fresh install (v$VERSION)"
fi
echo ""
echo "    Migrations that will run:"
if [ ${#PF_MIGRATIONS[@]} -gt 0 ]; then
  for pf_line in "${PF_MIGRATIONS[@]}"; do echo "      - $pf_line"; done
else
  echo "      (none)"
fi
echo ""
echo "    Managed toolkit files that differ from the incoming version"
echo "    (will be overwritten - your current copy is backed up first):"
if [ ${#PF_DIFFS[@]} -gt 0 ]; then
  for pf_line in "${PF_DIFFS[@]}"; do echo "      - $pf_line"; done
else
  echo "      (none - your managed files match the incoming ones)"
fi
echo ""
echo "    Custom files detected in toolkit-managed directories"
echo "    (not shipped by the toolkit - setup will NOT modify or delete them):"
if [ ${#PF_CUSTOM[@]} -gt 0 ]; then
  for pf_line in "${PF_CUSTOM[@]}"; do echo "      - $pf_line"; done
else
  echo "      (none)"
fi
echo ""
echo "    Backups: anything this run overwrites or deletes is copied first to"
echo "      $BACKUP_DIR"
if [ "$PF_STALE_BACKUPS" -gt 0 ]; then
  echo ""
  echo "    Note: $PF_STALE_BACKUPS older .toolkit-backup-* folder(s) from previous runs are"
  echo "    still in the project root. Delete them when no longer needed."
fi
# The two node-dependent steps (the settings.local.json permission merge
# and the issue #91 package.json cleanup) skip silently inside their own
# blocks when node is absent. Say so here, once, so a permission that never
# arrived is not a mystery later.
if ! command -v node > /dev/null 2>&1; then
  echo ""
  echo "    Note: node was not found, so the .claude/settings.local.json permission"
  echo "    merge and the package.json cleanup will be skipped this run."
fi
echo ""

if [ "$DRY_RUN" -eq 1 ]; then
  echo "  Dry run complete - no files were created, modified, or deleted."
  echo ""
  exit 0
fi

# ─── Overwrite gate (issue #138) ─────────────────────────────
# Runs after the pre-flight report and the --dry-run exit, BEFORE the
# first filesystem write. Files classified LOCALLY MODIFIED above carry
# the user's own edits; silently replacing them is the one destructive
# thing the installer could still do. Interactive runs get a confirm
# prompt; non-interactive runs abort and point at --force. Either way
# each file is backed up before being overwritten.
if [ ${#PF_MODIFIED[@]} -gt 0 ] && [ "$FORCE" -eq 0 ]; then
  echo "  ${#PF_MODIFIED[@]} locally modified file(s) will be overwritten (backups made):"
  for rel in "${PF_MODIFIED[@]}"; do
    echo "    - $rel"
  done
  echo ""
  if [ -t 0 ]; then
    printf "  Continue? [y/N] "
    read -r GATE_REPLY || GATE_REPLY=""
    case "$GATE_REPLY" in
      y|Y|yes|Yes|YES)
        echo ""
        ;;
      *)
        echo ""
        echo "  Aborted - no files were created, modified, or deleted."
        echo "  Re-run with --force after the target path (setup.sh <target> --force)"
        echo "  to skip this prompt; each file is backed up first."
        echo ""
        exit 1
        ;;
    esac
  else
    echo "  Not running interactively, so setup cannot ask for confirmation."
    echo "  Re-run with --force added to the setup.sh arguments, right after the"
    echo "  target path (setup.sh <target> --force); each file is backed up first."
    echo ""
    exit 1
  fi
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
# to a timestamped backup directory at the target root. The directory name
# is fixed in the pre-flight section above (so the report can announce it
# up front); it is only created on the first backup, so clean installs and
# identical re-runs leave no empty backup dir behind. All backups in one
# setup run share the same directory.
BACKUP_COUNT=0

# backup_file: copy a target-resident file into the backup root, mirroring
# its relative path. $BACKUP_DIR carries the process PID so two same-second
# runs get distinct backup dirs (avoids silent overwrite of a prior run's
# backups). `cp -P` preserves symlinks as links so a backed-up symlink can
# be restored later.
backup_file() {
  local original="$1"
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
# Commands that became skills in v3.5 (the LEGACY_COMMANDS list lives in
# the migration inventory above, shared with the pre-flight report).
# Delete old command files BEFORE copying new ones to avoid name conflicts.
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
# loads as a stale slash command. The RENAMED_OLD/RENAMED_NEW arrays live in
# the migration inventory above (shared with the pre-flight report).
# backup_file preserves any customizations the user made to the old-named
# file before rm removes it.
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
# PARITY: mirrored in setup.ps1 (plan migration .claude/plans/ -> plans/) - change both together
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
# land at .claude/scripts/. The ISSUE91_OLD_SCRIPTS list lives in the
# migration inventory above (shared with the pre-flight report).
ISSUE91_SCRIPTS_REMOVED=0
for old_rel in "${ISSUE91_OLD_SCRIPTS[@]}"; do
  if [ -f "$TARGET/$old_rel" ]; then
    backup_file "$TARGET/$old_rel"
    rm -f "$TARGET/$old_rel"
    ISSUE91_SCRIPTS_REMOVED=$((ISSUE91_SCRIPTS_REMOVED + 1))
  fi
done

# Remove leaked toolkit deps and convenience scripts from $TARGET/package.json.
# Two-phase approach: the read-only detection ran in the pre-flight section
# above (ISSUE91_PKG_DRY) so the report and this action cannot drift; here we
# back up and write only when it flagged the file. The deps are toolkit-owned
# and always safe to remove. The two convenience scripts are recognized only
# when their command body still points at the OLD `scripts/<name>.js` path -
# this avoids clobbering a script the user happens to have customized to do
# something else under the same name.
ISSUE91_PKG_TOUCHED=0
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
SKIPPED=()

# ─── Command files (upstream-owned - safe_copy backs up any customizations) ─
echo "  Copying .claude/commands/ ..."
for src in "$TOOLKIT_ROOT/.claude/commands/"*.md; do
  fname="$(basename "$src")"
  safe_copy "$src" "$TARGET/.claude/commands/$fname"
done

# ─── Agent definitions (upstream-owned - safe_copy backs up customizations) ─
# PARITY: .claude/agents/ must be copied by BOTH setup.sh and setup.ps1 (issue #152).
# Agent files carry the model/effort pins for worker subagents (the roster in
# .claude/skills/shared/model-routing.md). Guarded: an older toolkit checkout
# may not have the directory, and an absent roster just means dispatch falls
# back to inherit. Empty-directory handling as in the shells/ block below:
# failglob off for the loop, then restored.
if [ -d "$TOOLKIT_ROOT/.claude/agents" ]; then
  echo "  Copying .claude/agents/ ..."
  mkdir -p "$TARGET/.claude/agents"
  shopt -u failglob; shopt -s nullglob
  for src in "$TOOLKIT_ROOT/.claude/agents/"*.md; do
    [ -f "$src" ] || continue
    fname="$(basename "$src")"
    safe_copy "$src" "$TARGET/.claude/agents/$fname"
  done
  shopt -u nullglob; shopt -s failglob
fi

# ─── Skill files (upstream-owned - always copy) ─────────────
echo "  Copying .claude/skills/ ..."

# Copy shared supporting files first
if [ -d "$TOOLKIT_ROOT/.claude/skills/shared" ]; then
  mkdir -p "$TARGET/.claude/skills/shared"
  # failglob off for the loop, then restored - see the shells/ block below.
  shopt -u failglob; shopt -s nullglob
  for src in "$TOOLKIT_ROOT/.claude/skills/shared/"*.md; do
    [ -f "$src" ] || continue
    fname="$(basename "$src")"
    safe_copy "$src" "$TARGET/.claude/skills/shared/$fname"
  done
  shopt -u nullglob; shopt -s failglob
fi

# PARITY: shared/shells/ must be copied by BOTH setup.sh and setup.ps1 (issue #126).
# The shared/ loop above copies ONLY *.md, and the per-skill loop below SKIPS
# shared/ - so this prebuilt-shell subdirectory (the *.html shells + tokens.css
# that render-html.js injects into) needs its own copy step. Copy every file in
# the directory (the shells are *.html plus tokens.css). The [ -f ] guard skips
# any nested directories. A plain * glob avoids the failglob abort that separate
# *.html / *.css patterns would trigger if one extension were ever absent - but
# only when files are present. An empty shells/ dir would still trigger failglob,
# so the loop turns failglob OFF and nullglob ON for its duration (restoring both
# afterward) to yield zero iterations instead of a "no match" abort. nullglob
# alone is not enough: failglob takes precedence over it (verified, issue #152).
if [ -d "$TOOLKIT_ROOT/.claude/skills/shared/shells" ]; then
  mkdir -p "$TARGET/.claude/skills/shared/shells"
  shopt -u failglob; shopt -s nullglob
  for src in "$TOOLKIT_ROOT/.claude/skills/shared/shells/"*; do
    [ -f "$src" ] || continue
    fname="$(basename "$src")"
    safe_copy "$src" "$TARGET/.claude/skills/shared/shells/$fname" || { echo "  Error: failed to copy shells/$fname"; exit 1; }
  done
  shopt -u nullglob; shopt -s failglob
fi

# Copy each skill directory (contains SKILL.md and optional supporting files)
shopt -u failglob; shopt -s nullglob
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
done
shopt -u nullglob; shopt -s failglob

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

# ─── .env.local.example (template - safe_copy backs up any local edits) ──
echo "  Copying .env.local.example ..."
safe_copy "$TOOLKIT_ROOT/.env.local.example" "$TARGET/.env.local.example"

# ─── .gitignore (merge - preserve user entries, add toolkit lines) ─
# GITIGNORE_BACKED_UP: set once this run has copied the pre-merge
# .gitignore into the backup dir. The INDEX.md cleanup sed further down
# checks it, so a second backup_file call can never overwrite the pre-run
# copy with a post-merge one.
GITIGNORE_BACKED_UP=0
if [ -f "$TARGET/.gitignore" ]; then
  echo "  Merging .gitignore (preserving your entries) ..."
  while IFS= read -r line; do
    # Skip blank lines and comments to avoid accumulating duplicates on repeated runs
    [ -z "$line" ] || [[ "$line" == \#* ]] && continue
    if ! grep -qxF "$line" "$TARGET/.gitignore"; then
      # Back up right before the FIRST append, not before the loop: the
      # merge was the one write path with no backup, and doing it lazily
      # keeps an identical re-run from creating a backup dir for a no-op.
      if [ "$GITIGNORE_BACKED_UP" -eq 0 ]; then
        backup_file "$TARGET/.gitignore"
        # Ensure target ends with a newline before appending
        [ -n "$(tail -c 1 "$TARGET/.gitignore")" ] && echo "" >> "$TARGET/.gitignore"
        GITIGNORE_BACKED_UP=1
      fi
      echo "$line" >> "$TARGET/.gitignore"
    fi
  done < "$TOOLKIT_ROOT/.gitignore"
else
  echo "  Copying .gitignore ..."
  cp "$TOOLKIT_ROOT/.gitignore" "$TARGET/.gitignore"
fi

echo "  Copying .gitattributes ..."
safe_copy "$TOOLKIT_ROOT/.gitattributes" "$TARGET/.gitattributes"

echo "  Copying VERSION ..."
safe_copy "$TOOLKIT_ROOT/VERSION" "$TARGET/VERSION"

# ─── Toolkit rules (upstream-owned - safe_copy handles any customizations) ────────────
echo "  Copying .claude/rules/toolkit.md ..."
safe_copy "$TOOLKIT_ROOT/.claude/rules/toolkit.md" "$TARGET/.claude/rules/toolkit.md"
# Stamp the installed version into toolkit.md so users can check it later
# sed -i.bak works on both macOS (BSD sed) and Linux (GNU sed). This syntax was
# chosen for cross-platform compatibility - do not simplify to sed -i '' (breaks Linux).
sed -i.bak "s/<!-- This file is managed by the LLM Peer Review toolkit\./<!-- Toolkit version: $VERSION | Managed by LLM Peer Review./" "$TARGET/.claude/rules/toolkit.md"
rm -f "$TARGET/.claude/rules/toolkit.md.bak"

# HTML output rules (issue #113) - same stamp pattern as toolkit.md.
# Source ships pre-stamped via bump-version.sh; this sed is a no-op on
# stamped files and harmless on re-runs.
echo "  Copying .claude/rules/html-outputs.md ..."
safe_copy "$TOOLKIT_ROOT/.claude/rules/html-outputs.md" "$TARGET/.claude/rules/html-outputs.md"
sed -i.bak "s/<!-- This file is managed by the LLM Peer Review toolkit\./<!-- Toolkit version: $VERSION | Managed by LLM Peer Review./" "$TARGET/.claude/rules/html-outputs.md"
rm -f "$TARGET/.claude/rules/html-outputs.md.bak"

# ─── artifacts/ scaffold (issue #113) ────────────────────────
# The HTML-output feature writes to artifacts/html/ in the target project.
# Ship the tracked README so the directory is discoverable and the gitignored
# html/ subdir has a home. safe_copy backs up any user customization.
echo "  Copying artifacts/README.md ..."
safe_copy "$TOOLKIT_ROOT/artifacts/README.md" "$TARGET/artifacts/README.md"

# PARITY: .claude/scripts/ files must be copied by BOTH setup.sh and setup.ps1.
# Add a new script to one installer? Add it to the other too (issue #126).
# ─── Index generator script (upstream-owned - safe_copy handles any customizations) ──
echo "  Copying .claude/scripts/generate-index.js ..."
safe_copy "$TOOLKIT_ROOT/.claude/scripts/generate-index.js" "$TARGET/.claude/scripts/generate-index.js"

# ─── Artifact opener script (upstream-owned - safe_copy handles any customizations) ──
echo "  Copying .claude/scripts/open-artifact.sh ..."
safe_copy "$TOOLKIT_ROOT/.claude/scripts/open-artifact.sh" "$TARGET/.claude/scripts/open-artifact.sh"

# ─── HTML renderer script (upstream-owned - safe_copy handles any customizations) ──
# Dependency-free like generate-index.js / open-artifact.sh. It injects a JSON
# payload into a prebuilt shell under .claude/skills/shared/shells/ (copied below).
echo "  Copying .claude/scripts/render-html.js ..."
safe_copy "$TOOLKIT_ROOT/.claude/scripts/render-html.js" "$TARGET/.claude/scripts/render-html.js"

# ─── Session-init script (upstream-owned - safe_copy handles any customizations) ──
# Dependency-free like generate-index.js / open-artifact.sh. Emits one JSON with the
# map freshness, lessons index, plan statuses, and worktree state that /explore,
# /create-plan, /pair-debug, and /execute read at startup - one call instead of N.
echo "  Copying .claude/scripts/session-init.js ..."
safe_copy "$TOOLKIT_ROOT/.claude/scripts/session-init.js" "$TARGET/.claude/scripts/session-init.js"

# ─── Pre-push tripwire script (upstream-owned - safe_copy handles any customizations) ──
# Dependency-free like generate-index.js / open-artifact.sh. The M11 tripwire:
# scans every outgoing commit for secrets, never-push files, and settings
# changes before any push. Silent when clean; exit 1 blocks the push.
echo "  Copying .claude/scripts/pre-push-check.js ..."
safe_copy "$TOOLKIT_ROOT/.claude/scripts/pre-push-check.js" "$TARGET/.claude/scripts/pre-push-check.js"

# ─── Correction ledger script (upstream-owned - safe_copy handles any customizations) ──
# Dependency-free. Writes ONLY to ~/.claude/ (per machine, outside every repo), so its
# data files are never inside $TARGET and never enter the toolkit manifest. Nothing here
# creates or touches an existing ledger: installing into a new repo cannot disturb data
# another repo wrote. (issue #157)
echo "  Copying .claude/scripts/correction-ledger.js ..."
safe_copy "$TOOLKIT_ROOT/.claude/scripts/correction-ledger.js" "$TARGET/.claude/scripts/correction-ledger.js"

# ─── Project-owned files (skip if already exist) ─────────────
# Capture whether LESSONS.md predates this run BEFORE the loop copies it, so the paired
# LESSONS-detail.md is only seeded on a genuinely fresh install (see the block below).
# Written as an if-statement (not `&&`) so it is safe under `set -e`.
LESSONS_PREEXISTED=false
if [ -f "$TARGET/LESSONS.md" ]; then LESSONS_PREEXISTED=true; fi
# Same capture for settings.local.json: the permission merge below backs the
# file up before rewriting it, but only when it is the user's own copy. A
# template this run just copied carries nothing of theirs, and backing it up
# would give every fresh install a backup dir.
SETTINGS_PREEXISTED=false
if [ -f "$TARGET/.claude/settings.local.json" ]; then SETTINGS_PREEXISTED=true; fi

for f in CLAUDE.md LESSONS.md .claude/settings.local.json; do
  if [ -f "$TARGET/$f" ]; then
    echo "  Skipping $f - already exists (yours to customize)"
    SKIPPED+=("$f")
  else
    echo "  Copying $f ..."
    cp "$TOOLKIT_ROOT/$f" "$TARGET/$f"
  fi
done

# ─── LESSONS-detail.md (paired with the LESSONS.md index) ────
# LESSONS.md is the short index Claude reads each session; LESSONS-detail.md holds the full
# write-ups it opens on demand. Only SEED the detail file on a fresh install (LESSONS.md did
# not already exist). On upgrade, an existing flat LESSONS.md is preserved and we must NOT
# drop a mismatched detail file beside it - the session-start read treats a missing detail
# file as "LESSONS.md is the older flat format" and reads it whole instead.
if [ "$LESSONS_PREEXISTED" = true ]; then
  if [ -f "$TARGET/LESSONS-detail.md" ]; then
    echo "  Skipping LESSONS-detail.md - already exists (yours to customize)"
    SKIPPED+=("LESSONS-detail.md")
  else
    echo "  Note: your LESSONS.md predates the index/detail split - it still works as-is."
    echo "        To enable on-demand loading, ask Claude to split it into LESSONS.md (index) + LESSONS-detail.md."
  fi
elif [ ! -f "$TARGET/LESSONS-detail.md" ]; then
  echo "  Copying LESSONS-detail.md ..."
  cp "$TOOLKIT_ROOT/LESSONS-detail.md" "$TARGET/LESSONS-detail.md"
fi

# ─── Merge new permissions into existing settings.local.json ─
# PARITY: mirrored in setup.ps1 (settings.local.json permission merge) - change both together
# When upgrading, the user's settings.local.json is preserved (not overwritten).
# But new toolkit versions may require new permissions. This block:
#   1. Adds any missing permissions from the toolkit's template
#   2. Removes stale absolute-path browse.js permissions from old project locations
#   3. Injects absolute-path browse.js pipe permissions for the current $TARGET
# All three steps happen in one pass to avoid reading/writing the file multiple times.
# Paths are passed via environment variables to avoid quoting issues with special
# characters in directory names (spaces, quotes, etc.).
#
# node never touches the live file. When the merge changes anything it writes
# the result to a .tmp sibling and prints the change list; bash then backs up
# the live file (a pre-existing one - see SETTINGS_PREEXISTED) and moves the
# .tmp into place. A no-op merge writes nothing, so an identical re-run makes
# no backup. node's stderr goes to its own file, never into the change list -
# with 2>&1 a parse error used to print as a "+ SyntaxError" permission line.
# A non-zero exit leaves the file untouched and prints a warning instead.
if [ -f "$TARGET/.claude/settings.local.json" ] && command -v node > /dev/null 2>&1; then
  SETTINGS_TMP="$TARGET/.claude/settings.local.json.tmp"
  rm -f "$SETTINGS_TMP"
  PERMS_ERR_FILE="$(mktemp "${TMPDIR:-/tmp}/toolkit-settings-merge-XXXXXX")"
  PERMS_RC=0
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

    // Step 2a: remove stale exact-match entries the toolkit has retired:
    // relative-path entries for the v4.2-and-earlier script layout (their
    // .claude/scripts/-prefixed replacements come in via Step 1's merge), and
    // the wslview grant, unused since the opener went PowerShell-first (#134).
    const STALE_PERMS = [
      'Bash(node scripts/ask-gpt.js *)',
      'Bash(node scripts/ask-gemini.js *)',
      'Bash(node scripts/browse.js *)',
      'Bash(echo * | node scripts/browse.js *)',
      'Bash(cat * | node scripts/browse.js *)',
      'Bash(wslview *)'
    ];
    const staleRel = tgtPerms.filter(p => STALE_PERMS.includes(p));

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
      // Written to the .tmp sibling; bash backs up the live file and moves this into place.
      fs.writeFileSync(targetDir + '/.claude/settings.local.json.tmp', JSON.stringify(tgt, null, 2) + '\n');
      stale.forEach(p => console.log('removed: ' + p));
      allNew.forEach(p => console.log(p));
    }
  " 2> "$PERMS_ERR_FILE") || PERMS_RC=$?
  # Read and delete the stderr file straight away, so it lives only for the
  # node call and nothing that fails below can leave it behind in the temp dir.
  PERMS_ERR="$(cat "$PERMS_ERR_FILE" 2>/dev/null)"
  rm -f "$PERMS_ERR_FILE"
  if [ "$PERMS_RC" -ne 0 ]; then
    rm -f "$SETTINGS_TMP"
    # node's first stderr line is a stack location ("[eval]:5" or
    # "node:internal/..."), not the message, so take the first line that
    # names the error; fall back to the first non-empty line, then the code.
    PERMS_ERR_LINE="$(printf '%s\n' "$PERMS_ERR" | grep -E 'Error' | head -1)"
    [ -n "$PERMS_ERR_LINE" ] || PERMS_ERR_LINE="$(printf '%s\n' "$PERMS_ERR" | grep -v '^[[:space:]]*$' | head -1)"
    [ -n "$PERMS_ERR_LINE" ] || PERMS_ERR_LINE="node exited $PERMS_RC"
    echo "  Warning: could not merge permissions into .claude/settings.local.json ($PERMS_ERR_LINE)."
    echo "    Your file was left unchanged; add new entries by hand from the permissions"
    echo "    table in .claude/rules/toolkit.md."
  elif [ -f "$SETTINGS_TMP" ]; then
    if [ "$SETTINGS_PREEXISTED" = true ]; then
      backup_file "$TARGET/.claude/settings.local.json"
    fi
    mv -f "$SETTINGS_TMP" "$TARGET/.claude/settings.local.json"
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
# PARITY: mirrored in setup.ps1 (legacy INDEX.md removal) - change both together
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
  # Back up before the edit unless the merge above already saved the pre-run
  # copy this run - a second backup_file would overwrite it with a merged one.
  if [ "$GITIGNORE_BACKED_UP" -eq 0 ]; then
    backup_file "$TARGET/.gitignore"
    GITIGNORE_BACKED_UP=1
  fi
  sed -i.bak '/^# Project index (auto-generated by toolkit)$/d; /^INDEX\.md$/d' "$TARGET/.gitignore"
  rm -f "$TARGET/.gitignore.bak"
  echo "    Cleaned stale INDEX.md entries from .gitignore"
fi

# ─── Toolkit manifest (issue #138) ───────────────────────────
# Wholesale-regenerated on every real run (never on --dry-run, which
# exits above). Records the EOL-normalized sha256 of every managed file
# exactly as this run left it on disk - i.e. AFTER the version-stamp
# rewrites of the two rules files - so stamped files never self-flag on
# the next run. User-owned skip-if-exists files (CLAUDE.md, LESSONS.md,
# LESSONS-detail.md, .claude/settings.local.json) and the line-merged
# .gitignore are NOT tracked: setup never overwrites those, so they need
# no gate. MANAGED_RELS is accumulated by the pre-flight enumeration,
# which mirrors the copy blocks exactly. Written with printf (no node
# dependency); forward-slash keys keep it portable with setup.ps1.
#
# Built in a .tmp sibling and moved into place, so the manifest on disk is
# always whole or absent. A plain redirect truncates first, and a crash
# mid-write would leave a partial file that the next run reads as "no
# entry" for every path past the cut - misclassifying files setup itself
# wrote. The previous manifest is backed up first when the new one differs,
# so a rollback has the old hashes; an identical re-run makes no backup.
MANIFEST_TMP="$MANIFEST_FILE.tmp"
MANIFEST_ENTRIES=()
for i in "${!MANAGED_RELS[@]}"; do
  rel="${MANAGED_RELS[$i]}"
  # Tolerate conditionally-shipped files (e.g. package-lock.json) that
  # were enumerated but not written this run.
  [ -f "$TARGET/$rel" ] || continue
  MANIFEST_ENTRIES+=("    \"$rel\": \"$(toolkit_hash "$TARGET/$rel")\"")
done
MANIFEST_LAST=$(( ${#MANIFEST_ENTRIES[@]} - 1 ))
{
  printf '{\n'
  printf '  "toolkitVersion": "%s",\n' "$VERSION"
  printf '  "files": {\n'
  for i in "${!MANIFEST_ENTRIES[@]}"; do
    if [ "$i" -lt "$MANIFEST_LAST" ]; then
      printf '%s,\n' "${MANIFEST_ENTRIES[$i]}"
    else
      printf '%s\n' "${MANIFEST_ENTRIES[$i]}"
    fi
  done
  printf '  }\n'
  printf '}\n'
} > "$MANIFEST_TMP"
if [ -f "$MANIFEST_FILE" ] && ! cmp -s "$MANIFEST_FILE" "$MANIFEST_TMP"; then
  backup_file "$MANIFEST_FILE"
fi
mv -f "$MANIFEST_TMP" "$MANIFEST_FILE"
echo "  Wrote .claude/.toolkit-manifest.json (${#MANIFEST_ENTRIES[@]} managed file(s) tracked)"

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

# ─── Locally modified files summary (issue #138) ─────────────
# Printed when this run overwrote files the manifest flagged as locally
# modified (the user confirmed the gate or passed --force). Each line
# pairs the file with its backup so re-applying local changes is a
# checklist, not an archaeology dig.
if [ ${#PF_MODIFIED[@]} -gt 0 ]; then
  echo "    Locally modified file(s) replaced with stock versions:"
  for rel in "${PF_MODIFIED[@]}"; do
    echo "      - $rel"
    echo "        backup: $BACKUP_DIR/$rel"
  done
  echo ""
  echo "    Re-apply your changes from the backups above if you still need them."
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
# gate above, so a plain version bump (e.g. 4.6 -> 4.7) never lands
# silently. The text is deliberately version-neutral: a hardcoded feature
# list goes stale the release after it is written (the v5.0 HTML-viewing
# blurb was still printing on 5.5 -> 6.0 upgrades), so this points at the
# two places bump-version.sh keeps current instead. Neither file is copied
# into the target, hence "in the toolkit repo".
if [ "$IS_UPGRADE" -eq 1 ] && [ "$LEGACY_CLEANED" -eq 0 ] && [ "$PLANS_MIGRATED" -eq 0 ]; then
  echo "    ┌────────────────────────────────────────────────┐"
  echo "    │  Upgraded to v$VERSION - new this version:        │"
  echo "    └────────────────────────────────────────────────┘"
  echo ""
  echo "      Upgrade complete. To see what changed, open in the toolkit repo:"
  echo ""
  echo "      - CHANGELOG.md: the \"What's new since\" rollup at the top,"
  echo "        then the newest version section right below it."
  echo "      - AGENT-SETUP.md: the \"What's new in v$VERSION\" block."
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
