#!/bin/bash
# test-installer-guarantees.sh - scratch-project test for the installer
# guarantees added in issue #133. Verifies, against a throwaway project:
#
#   1. --dry-run makes zero filesystem changes (empty and populated targets)
#   2. The pre-flight report announces the version gap, migrations, locally
#      edited managed files, and custom files before anything is touched
#   3. Custom files planted in EVERY toolkit-managed directory (including a
#      nested command subdirectory) survive an upgrade byte-for-byte
#   4. A locally edited managed file is backed up, then refreshed to stock
#   5. Legacy migration targets are reported as migrations, not as custom
#      files, and are backed up before removal
#   6. An identical re-run creates no new backup directory
#
# Usage:
#   bash scripts/setup/test-installer-guarantees.sh
#
# Exits 0 when every assertion passes, 1 otherwise. The scratch project
# lives under mktemp and is removed on exit. This script is NOT copied to
# downstream projects; like bump-version.sh it stays in the toolkit repo.
# Compatible with Bash 3.2+ (macOS default), Linux, and WSL.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLKIT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/toolkit-guarantee-test-XXXXXX")"
SCRATCH="$WORK/scratch"
SNAP="$WORK/snapshot"
LOG="$WORK/logs"
mkdir -p "$SCRATCH" "$LOG"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok:   $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

# assert_grep <fixed-string> <file> <label>
assert_grep() {
  if grep -qF -- "$1" "$2"; then
    ok "$3"
  else
    fail "$3 (not found in $(basename "$2"): $1)"
  fi
}

echo ""
echo "Toolkit: $TOOLKIT_ROOT"
echo "Scratch: $SCRATCH"
echo ""

# ─── [1] --dry-run on an empty target makes no changes ───────
echo "[1] --dry-run on an empty target"
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" --dry-run > "$LOG/dryrun-fresh.log" 2>&1
if [ -z "$(ls -A "$SCRATCH")" ]; then
  ok "empty target untouched"
else
  fail "dry run created files: $(ls -A "$SCRATCH" | tr '\n' ' ')"
fi
assert_grep "fresh install" "$LOG/dryrun-fresh.log" "reports fresh install"
assert_grep "Dry run complete" "$LOG/dryrun-fresh.log" "prints dry-run completion line"

# ─── [2] fresh install ───────────────────────────────────────
echo "[2] fresh install"
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" > "$LOG/install.log" 2>&1
if [ -f "$SCRATCH/.claude/rules/toolkit.md" ]; then
  ok "install completed"
else
  fail "install did not complete"
fi

# ─── [3] plant custom files + edit a managed file ────────────
echo "[3] plant custom files in every managed directory"
CUSTOM_FILES=(
  .claude/commands/my-custom-command.md
  .claude/commands/team/nested-custom.md
  .claude/skills/my-custom-skill/SKILL.md
  .claude/skills/shared/my-custom-shared.md
  .claude/skills/shared/shells/my-custom-shell.html
  .claude/scripts/my-custom-script.js
  .claude/rules/my-custom-rule.md
)
for rel in "${CUSTOM_FILES[@]}"; do
  mkdir -p "$SCRATCH/$(dirname "$rel")"
  printf 'custom content for %s\n' "$rel" > "$SCRATCH/$rel"
done

# A legacy v3.4-era command file: must be reported as a migration, NOT as
# a custom file, and must be backed up + removed by the upgrade.
printf 'old legacy command\n' > "$SCRATCH/.claude/commands/review-code.md"

# Locally edit a managed file (first toolkit command file, picked
# dynamically so a rename upstream does not break the test).
EDITED_CMD="$(basename "$(ls "$TOOLKIT_ROOT/.claude/commands/"*.md | head -1)")"
printf '\nLOCAL EDIT MARKER\n' >> "$SCRATCH/.claude/commands/$EDITED_CMD"

# Simulate an older install so the version gap line has something to say.
printf '4.0.0\n' > "$SCRATCH/VERSION"
ok "planted ${#CUSTOM_FILES[@]} custom files, 1 legacy file, 1 local edit"

# ─── [4] --dry-run on the populated project ──────────────────
echo "[4] --dry-run on the populated project"
cp -R "$SCRATCH" "$SNAP"
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" --dry-run > "$LOG/dryrun.log" 2>&1
if diff -r "$SCRATCH" "$SNAP" > /dev/null 2>&1; then
  ok "dry run changed nothing"
else
  fail "dry run modified the target: $(diff -rq "$SCRATCH" "$SNAP" 2>&1 | head -3 | tr '\n' ' ')"
fi
assert_grep "upgrade (v4.0.0 -> v" "$LOG/dryrun.log" "reports the version gap"
assert_grep "Legacy command cleanup" "$LOG/dryrun.log" "announces the legacy migration"
assert_grep ".claude/commands/$EDITED_CMD" "$LOG/dryrun.log" "lists the locally edited managed file"
for rel in "${CUSTOM_FILES[@]}"; do
  assert_grep "$rel" "$LOG/dryrun.log" "lists custom file $rel"
done
if grep -qF -- "- .claude/commands/review-code.md" "$LOG/dryrun.log"; then
  fail "legacy file wrongly listed as a custom file"
else
  ok "legacy file not listed as custom"
fi

# ─── [5] real upgrade run ────────────────────────────────────
echo "[5] real upgrade run"
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" > "$LOG/upgrade.log" 2>&1

for rel in "${CUSTOM_FILES[@]}"; do
  if cmp -s "$SCRATCH/$rel" "$SNAP/$rel"; then
    ok "custom file survived: $rel"
  else
    fail "custom file modified or deleted: $rel"
  fi
done

if cmp -s "$SCRATCH/.claude/commands/$EDITED_CMD" "$TOOLKIT_ROOT/.claude/commands/$EDITED_CMD"; then
  ok "edited managed file refreshed to stock"
else
  fail "edited managed file does not match the incoming version"
fi

BACKUP_ROOT="$(find "$SCRATCH" -maxdepth 1 -name '.toolkit-backup-*' -type d | sort | tail -1)"
if [ -n "$BACKUP_ROOT" ] && grep -q "LOCAL EDIT MARKER" "$BACKUP_ROOT/.claude/commands/$EDITED_CMD" 2>/dev/null; then
  ok "local edit preserved in backup"
else
  fail "local edit not found in backup dir"
fi

if [ ! -f "$SCRATCH/.claude/commands/review-code.md" ] && [ -f "$BACKUP_ROOT/.claude/commands/review-code.md" ]; then
  ok "legacy command removed and backed up"
else
  fail "legacy command not migrated correctly"
fi

if cmp -s "$SCRATCH/VERSION" "$TOOLKIT_ROOT/VERSION"; then
  ok "VERSION updated"
else
  fail "VERSION not updated"
fi

# ─── [6] identical re-run is clean ───────────────────────────
echo "[6] identical re-run"
BACKUPS_BEFORE="$(find "$SCRATCH" -maxdepth 1 -name '.toolkit-backup-*' -type d | wc -l | tr -d ' ')"
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" > "$LOG/rerun.log" 2>&1
BACKUPS_AFTER="$(find "$SCRATCH" -maxdepth 1 -name '.toolkit-backup-*' -type d | wc -l | tr -d ' ')"
if [ "$BACKUPS_BEFORE" = "$BACKUPS_AFTER" ]; then
  ok "no new backup dir on identical re-run"
else
  fail "identical re-run created a backup dir"
fi
for rel in "${CUSTOM_FILES[@]}"; do
  if cmp -s "$SCRATCH/$rel" "$SNAP/$rel"; then
    ok "custom file survived re-run: $rel"
  else
    fail "custom file changed on re-run: $rel"
  fi
done
assert_grep "older .toolkit-backup-" "$LOG/rerun.log" "re-run notes the stale backup dir"

# ─── Summary ─────────────────────────────────────────────────
echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "Logs preserved nowhere (scratch is removed) - re-run with 'bash -x' to debug."
  exit 1
fi
echo "All installer guarantees hold."
