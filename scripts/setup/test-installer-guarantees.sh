#!/bin/bash
# test-installer-guarantees.sh - scratch-project test for the installer
# guarantees added in issue #133. Verifies, against a throwaway project:
#
#   1. --dry-run makes zero filesystem changes (empty and populated targets)
#   2. The pre-flight report announces the version gap, migrations, locally
#      edited managed files, and custom files before anything is touched
#   3. Custom files planted in EVERY toolkit-managed directory (including a
#      nested command subdirectory) survive an upgrade byte-for-byte
#   4. A locally edited managed file blocks a non-interactive run (exit 1,
#      target untouched) until --force is passed; the forced run backs the
#      file up, refreshes it to stock, and lists it (with its backup path)
#      in the post-setup summary (issue #138)
#   5. Legacy migration targets are reported as migrations, not as custom
#      files, and are backed up before removal
#   6. An identical re-run creates no new backup directory and never
#      triggers the overwrite gate
#   7. A manifest (.claude/.toolkit-manifest.json) is written on every real
#      run, never on --dry-run, and carries per-file sha256 entries
#   8. Every path an installed file READS at runtime resolves in the installed
#      tree, and no installed file points at docs/, which neither installer
#      copies (issue #153). Scoped deliberately: it checks the `!`cat ...``
#      inline directives, which are real filesystem reads, plus the docs/
#      class that caused the HITL-MAP.md dead links. It does NOT try to
#      resolve every path-shaped string in prose - most of those are
#      illustrative examples, literal placeholders, or runtime-generated
#      files, so a blanket check would be noise rather than signal.
#   9. A pre-manifest install (no manifest file) upgrades without a gate:
#      a differing managed file is "[differs, provenance unknown]", replaced
#      with the stock copy, and its edited copy lands in the backup dir
#  10. A managed path with NO manifest entry while a manifest exists is a
#      user-created file the toolkit now ships under the same name: it is
#      "[LOCALLY MODIFIED]", gates the run (exit 1 without --force), and is
#      replaced only with --force
#  11. A run that died after some copies but before the manifest write is
#      recovered by the next run. The manifest write is atomic, so what a
#      crash actually leaves is the OLD manifest intact plus a partial
#      .toolkit-manifest.json.tmp beside it: the next run must restore every
#      file, rebuild the manifest whole, and leave no .tmp behind
#  12. The line-merged files (.gitignore, .claude/settings.local.json) and
#      the regenerated manifest each land in the backup dir as their
#      pre-merge copies whenever a run rewrites them
#  13. A settings.local.json node cannot parse produces a warning naming the
#      error, leaves the file untouched, and never prints the error text as
#      a "+" permission line
#  14. (ps1 only) see test-installer-guarantees.ps1 - numbers are kept
#      aligned so the same scenario carries the same number in both suites
#  15. (ps1 only) see test-installer-guarantees.ps1
#  16. With node absent from PATH the pre-flight says the permission merge
#      will be skipped (one --dry-run, PATH untouched for the rest); a dry
#      run with node present does not carry the note
#  17. A symlinked .claude/settings.local.json (a dotfiles setup) survives
#      the permission merge: it is still a symlink afterwards, the link
#      target received the merged content, and its file mode is preserved
#  18. Each installer manages only the browse.js path form it can vouch
#      for: setup.sh leaves a UNC-form (//server/...) entry alone, which
#      setup.ps1 owns, while still retiring a stale POSIX-form one
#  19. The version-neutral "new this version" box fires only when the
#      installed version actually changes: present when the target's
#      VERSION differs from the toolkit's, absent on an identical re-run
#      (the absent half is checked in 7)
#  20. (sh only) An unusable TMPDIR does not abort the run: the settings
#      merge keeps node's stderr beside its own .tmp in the target instead
#      of in mktemp, so the run exits 0 and still writes the manifest
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

# remove_perm <settings-file> <entry>: drop one permissions.allow entry
# through node, so the JSON stays valid wherever the entry sits. A
# trailing-comma sed (scenario 12 uses one while the entry is still
# mid-list) silently misses an entry that a previous merge appended last.
remove_perm() {
  PERM_TO_REMOVE="$2" node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const j = JSON.parse(fs.readFileSync(file, "utf-8"));
    j.permissions.allow = j.permissions.allow.filter(p => p !== process.env.PERM_TO_REMOVE);
    fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
  ' "$1"
}

# list_backup_dirs: one absolute path per line, sorted, so a before/after
# comparison (comm -13) isolates the directory a single run created. Name
# order is not enough: the PID suffix does not sort by time.
list_backup_dirs() {
  find "$SCRATCH" -maxdepth 1 -name '.toolkit-backup-*' -type d | sort
}

echo ""
echo "Toolkit: $TOOLKIT_ROOT"
echo "Scratch: $SCRATCH"
echo ""

# All setup invocations run with stdin redirected from /dev/null so the
# overwrite gate (issue #138) can never prompt: the suite exercises the
# non-interactive abort path and the --force path, never a live prompt.

# ─── [1] --dry-run on an empty target makes no changes ───────
echo "[1] --dry-run on an empty target"
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" --dry-run < /dev/null > "$LOG/dryrun-fresh.log" 2>&1
if [ -z "$(ls -A "$SCRATCH")" ]; then
  ok "empty target untouched"
else
  fail "dry run created files: $(ls -A "$SCRATCH" | tr '\n' ' ')"
fi
assert_grep "fresh install" "$LOG/dryrun-fresh.log" "reports fresh install"
assert_grep "Dry run complete" "$LOG/dryrun-fresh.log" "prints dry-run completion line"

# ─── [2] fresh install ───────────────────────────────────────
echo "[2] fresh install"
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" < /dev/null > "$LOG/install.log" 2>&1
if [ -f "$SCRATCH/.claude/rules/toolkit.md" ]; then
  ok "install completed"
else
  fail "install did not complete"
fi
if [ -f "$SCRATCH/.claude/.toolkit-manifest.json" ]; then
  ok "manifest written on fresh install"
else
  fail "manifest missing after fresh install"
fi
# The settings merge writes on a fresh install too (it adds the absolute-path
# browse.js entries), and a template this run just copied must not be backed up.
if [ -z "$(list_backup_dirs)" ]; then
  ok "fresh install created no backup dir"
else
  fail "fresh install created a backup dir"
fi

# ─── [3] plant custom files + edit a managed file ────────────
echo "[3] plant custom files in every managed directory"
CUSTOM_FILES=(
  .claude/agents/my-custom-agent.md
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
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" --dry-run < /dev/null > "$LOG/dryrun.log" 2>&1
if diff -r "$SCRATCH" "$SNAP" > /dev/null 2>&1; then
  ok "dry run changed nothing (manifest included)"
else
  fail "dry run modified the target: $(diff -rq "$SCRATCH" "$SNAP" 2>&1 | head -3 | tr '\n' ' ')"
fi
assert_grep "upgrade (v4.0.0 -> v" "$LOG/dryrun.log" "reports the version gap"
assert_grep "Legacy command cleanup" "$LOG/dryrun.log" "announces the legacy migration"
assert_grep ".claude/commands/$EDITED_CMD" "$LOG/dryrun.log" "lists the locally edited managed file"
assert_grep "LOCALLY MODIFIED" "$LOG/dryrun.log" "shows the locally modified classification"
for rel in "${CUSTOM_FILES[@]}"; do
  assert_grep "$rel" "$LOG/dryrun.log" "lists custom file $rel"
done
if grep -qF -- "- .claude/commands/review-code.md" "$LOG/dryrun.log"; then
  fail "legacy file wrongly listed as a custom file"
else
  ok "legacy file not listed as custom"
fi

# ─── [5] non-interactive upgrade aborts on modified files ────
# The overwrite gate (issue #138): a locally modified managed file plus
# no --force plus no terminal on stdin must abort with exit 1 before any
# filesystem write.
echo "[5] upgrade without --force aborts (modified file, non-interactive)"
set +e
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" < /dev/null > "$LOG/abort.log" 2>&1
ABORT_RC=$?
set -e
if [ "$ABORT_RC" -eq 1 ]; then
  ok "aborted with exit 1"
else
  fail "expected exit 1, got $ABORT_RC"
fi
assert_grep ".claude/commands/$EDITED_CMD" "$LOG/abort.log" "abort lists the modified file"
assert_grep "--force" "$LOG/abort.log" "abort points at --force"
if grep -q "LOCAL EDIT MARKER" "$SCRATCH/.claude/commands/$EDITED_CMD"; then
  ok "modified file untouched by the aborted run"
else
  fail "aborted run replaced the modified file"
fi
if diff -r "$SCRATCH" "$SNAP" > /dev/null 2>&1; then
  ok "aborted run changed nothing"
else
  fail "aborted run modified the target: $(diff -rq "$SCRATCH" "$SNAP" 2>&1 | head -3 | tr '\n' ' ')"
fi

# ─── [6] real upgrade run (--force) ──────────────────────────
echo "[6] real upgrade run (--force)"
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" --force < /dev/null > "$LOG/upgrade.log" 2>&1

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

assert_grep "Locally modified file(s) replaced with stock versions:" "$LOG/upgrade.log" "summary announces replaced modified files"
if grep -F "backup:" "$LOG/upgrade.log" | grep -qF ".claude/commands/$EDITED_CMD"; then
  ok "summary pairs the modified file with its backup path"
else
  fail "backup path for the modified file missing from summary"
fi

# Manifest guarantees (issue #138): written on the real run, one
# plausible sha256 entry per managed file.
if grep -qE "\"\.claude/commands/$EDITED_CMD\": \"[0-9a-f]{64}\"" "$SCRATCH/.claude/.toolkit-manifest.json" 2>/dev/null; then
  ok "manifest has a plausible entry for the refreshed file"
else
  fail "manifest entry for .claude/commands/$EDITED_CMD missing or malformed"
fi
# Keys in byte order (LC_ALL=C), the same order setup.ps1 writes: the two
# installers used to write enumeration order (glob order here, Get-ChildItem
# order there), so a target set up from both sides saw a different byte
# order every time and backed the manifest up on every alternating run.
MF_KEYS="$(sed -n 's/^    "\([^"]*\)": "[0-9a-f]\{64\}".*/\1/p' "$SCRATCH/.claude/.toolkit-manifest.json" 2>/dev/null)"
if [ -n "$MF_KEYS" ] && [ "$MF_KEYS" = "$(printf '%s\n' "$MF_KEYS" | LC_ALL=C sort)" ]; then
  ok "manifest keys are in sorted (byte) order"
else
  fail "manifest keys are not in sorted (byte) order"
fi

# ─── [7] identical re-run is clean ───────────────────────────
echo "[7] identical re-run"
BACKUPS_BEFORE="$(find "$SCRATCH" -maxdepth 1 -name '.toolkit-backup-*' -type d | wc -l | tr -d ' ')"
set +e
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" < /dev/null > "$LOG/rerun.log" 2>&1
RERUN_RC=$?
set -e
if [ "$RERUN_RC" -eq 0 ]; then
  ok "clean re-run exited 0"
else
  fail "clean re-run exited $RERUN_RC (log: $LOG/rerun.log)"
fi
BACKUPS_AFTER="$(find "$SCRATCH" -maxdepth 1 -name '.toolkit-backup-*' -type d | wc -l | tr -d ' ')"
if [ "$BACKUPS_BEFORE" = "$BACKUPS_AFTER" ]; then
  ok "no new backup dir on identical re-run"
else
  fail "identical re-run created a backup dir"
fi
if grep -qi "locally modified" "$LOG/rerun.log"; then
  fail "clean re-run triggered the overwrite gate"
else
  ok "clean re-run did not trigger the overwrite gate"
fi
# The "new this version" box is for upgrades. IS_UPGRADE is true whenever
# toolkit.md exists, so without a version-changed guard the box fired on
# every same-version re-run too. The positive half is scenario 19.
if grep -qF "new this version:" "$LOG/rerun.log"; then
  fail "identical re-run printed the \"new this version\" box"
else
  ok "identical re-run did not print the \"new this version\" box"
fi
for rel in "${CUSTOM_FILES[@]}"; do
  if cmp -s "$SCRATCH/$rel" "$SNAP/$rel"; then
    ok "custom file survived re-run: $rel"
  else
    fail "custom file changed on re-run: $rel"
  fi
done
assert_grep "older .toolkit-backup-" "$LOG/rerun.log" "re-run notes the stale backup dir"

# ─── [8] referenced paths resolve in the INSTALLED tree ──────
# Runs against $SCRATCH (a real install by this point), never against the
# toolkit source. That distinction is the whole point: every gap issue #153
# found resolved fine in the source repo and only broke once installed.
echo "[8] referenced-path resolution (installed tree)"

# 8a. Inline `!`cat <path>`` directives are executed at skill-load time, so a
#     missing target is a real break rather than a dead link in prose.
INLINE_MISSING=0
INLINE_TOTAL=0
while IFS= read -r ref; do
  [ -z "$ref" ] && continue
  # Skip angle-bracket placeholders (e.g. .claude/skills/shared/<file>), which
  # are prose showing the syntax rather than a path anything reads.
  case "$ref" in *"<"*|*">"*) continue ;; esac
  INLINE_TOTAL=$((INLINE_TOTAL + 1))
  if [ ! -f "$SCRATCH/$ref" ]; then
    fail "inline-read target missing from install: $ref"
    INLINE_MISSING=$((INLINE_MISSING + 1))
  fi
done <<EOF
$(grep -rhoE '!`cat [^`]+`' "$SCRATCH/.claude" 2>/dev/null | sed 's/^!`cat //; s/`$//' | sort -u)
EOF
if [ "$INLINE_TOTAL" -eq 0 ]; then
  fail "found no inline-read directives to check - the extraction pattern is probably broken"
elif [ "$INLINE_MISSING" -eq 0 ]; then
  ok "all $INLINE_TOTAL inline-read targets resolve in the installed tree"
fi

# 8b. docs/ is not copied by either installer, so an installed file citing a
#     docs/ path is a dead link by construction. This is the exact bug class
#     that shipped seven HITL-MAP.md citations to downstream projects.
# Only a docs/ path that EXISTS in the toolkit source is a real dead link: it
# is a file that should have reached the install and did not. A docs/ path
# present in neither tree (docs/runbook.md in audit-html's sample report) is an
# illustrative example, so cross-referencing the source is what separates the
# two without an allowlist to maintain.
DOCS_BROKEN=""
while IFS= read -r ref; do
  [ -z "$ref" ] && continue
  if [ -f "$TOOLKIT_ROOT/$ref" ] && [ ! -f "$SCRATCH/$ref" ]; then
    DOCS_BROKEN="$DOCS_BROKEN $ref"
  fi
done <<EOF
$(grep -rhoE '(^|[^A-Za-z0-9_./-])docs/[A-Za-z0-9._/-]+\.md' "$SCRATCH/.claude" 2>/dev/null | sed 's/^[^d]*//' | sort -u)
EOF
if [ -z "$DOCS_BROKEN" ]; then
  ok "no installed file cites a docs/ file that exists in the toolkit but was not copied"
else
  fail "installed file(s) cite docs/ files present in the toolkit but not installed:$DOCS_BROKEN"
fi

# ─── [9] pre-manifest upgrade: no manifest, no gate ──────────
# A target installed before the manifest existed has nothing to compare
# against, so a differing managed file is "[differs, provenance unknown]":
# replaced with a backup, never gated. A gate here would block every
# pre-5.5 upgrade on files setup itself wrote.
echo "[9] pre-manifest upgrade (manifest absent, edited managed file)"
MANIFEST="$SCRATCH/.claude/.toolkit-manifest.json"
rm -f "$MANIFEST"
printf '\nPRE-MANIFEST EDIT MARKER\n' >> "$SCRATCH/.claude/commands/$EDITED_CMD"
BACKUPS_BEFORE_LIST="$(list_backup_dirs)"
set +e
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" < /dev/null > "$LOG/premanifest.log" 2>&1
PRE_RC=$?
set -e
if [ "$PRE_RC" -eq 0 ]; then
  ok "pre-manifest upgrade exited 0 without --force"
else
  fail "pre-manifest upgrade exited $PRE_RC (expected 0: no manifest means no gate)"
fi
if grep -F ".claude/commands/$EDITED_CMD" "$LOG/premanifest.log" | grep -qF "[differs, provenance unknown]"; then
  ok "edited file labelled [differs, provenance unknown]"
else
  fail "edited file not labelled [differs, provenance unknown]"
fi
if cmp -s "$SCRATCH/.claude/commands/$EDITED_CMD" "$TOOLKIT_ROOT/.claude/commands/$EDITED_CMD"; then
  ok "edited file replaced with the stock copy"
else
  fail "edited file not replaced with the stock copy"
fi
PRE_BACKUP="$(comm -13 <(echo "$BACKUPS_BEFORE_LIST") <(list_backup_dirs))"
if [ -n "$PRE_BACKUP" ] && grep -q "PRE-MANIFEST EDIT MARKER" "$PRE_BACKUP/.claude/commands/$EDITED_CMD" 2>/dev/null; then
  ok "edited copy preserved in the backup dir"
else
  fail "edited copy not found in the backup dir"
fi
if [ -f "$MANIFEST" ]; then
  ok "manifest rebuilt after the pre-manifest upgrade"
else
  fail "manifest not rebuilt after the pre-manifest upgrade"
fi

# ─── [10] manifest collision gate ────────────────────────────
# The manifest lists everything the last run wrote, so a managed path with
# no entry while a manifest exists is a file the user created at a name the
# toolkit now ships. It must gate exactly like a local edit: exit 1 without
# --force, replaced (and backed up) with it. The second command file is
# used so this cannot interact with EDITED_CMD's history above.
echo "[10] manifest collision gate (entry missing, file differs)"
COLLIDE_CMD="$(basename "$(ls "$TOOLKIT_ROOT/.claude/commands/"*.md | sed -n '2p')")"
# `|| true` keeps a missing manifest (a cascade from [9]) a reported failure
# rather than a set -e abort with no summary.
grep -vF "\".claude/commands/$COLLIDE_CMD\": \"" "$MANIFEST" > "$MANIFEST.edited" 2>/dev/null || true
mv "$MANIFEST.edited" "$MANIFEST"
if [ ! -s "$MANIFEST" ] || grep -qF "\".claude/commands/$COLLIDE_CMD\"" "$MANIFEST"; then
  fail "test setup: could not remove the manifest entry for $COLLIDE_CMD"
fi
printf '\nUSER-CREATED COLLISION MARKER\n' >> "$SCRATCH/.claude/commands/$COLLIDE_CMD"
set +e
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" < /dev/null > "$LOG/collide.log" 2>&1
COLLIDE_RC=$?
set -e
if [ "$COLLIDE_RC" -eq 1 ]; then
  ok "collision aborted with exit 1 without --force"
else
  fail "collision run exited $COLLIDE_RC (expected 1)"
fi
if grep -F ".claude/commands/$COLLIDE_CMD" "$LOG/collide.log" | grep -qF "[LOCALLY MODIFIED]"; then
  ok "colliding file labelled [LOCALLY MODIFIED]"
else
  fail "colliding file not labelled [LOCALLY MODIFIED]"
fi
if grep -q "USER-CREATED COLLISION MARKER" "$SCRATCH/.claude/commands/$COLLIDE_CMD"; then
  ok "colliding file untouched by the aborted run"
else
  fail "aborted run replaced the colliding file"
fi
set +e
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" --force < /dev/null > "$LOG/collide-force.log" 2>&1
COLLIDE_FORCE_RC=$?
set -e
if [ "$COLLIDE_FORCE_RC" -eq 0 ]; then
  ok "--force run exited 0"
else
  fail "--force run exited $COLLIDE_FORCE_RC"
fi
if cmp -s "$SCRATCH/.claude/commands/$COLLIDE_CMD" "$TOOLKIT_ROOT/.claude/commands/$COLLIDE_CMD"; then
  ok "--force replaced the colliding file with the stock copy"
else
  fail "--force did not replace the colliding file"
fi
if grep -F "backup:" "$LOG/collide-force.log" | grep -qF ".claude/commands/$COLLIDE_CMD"; then
  ok "forced run pairs the colliding file with its backup path"
else
  fail "forced run summary missing the colliding file's backup path"
fi

# ─── [11] interrupted run recovery ───────────────────────────
# Simulates a run that died after some copies but before the manifest
# write. The manifest is built in a .tmp sibling and moved into place, so
# a real crash never leaves a missing or truncated manifest: it leaves the
# OLD manifest intact plus, at most, a partial .tmp beside it. The old
# shape of this scenario (manifest deleted, three files deleted) could not
# tell an atomic writer from a plain redirect - both rebuild a whole file
# when nothing crashes. The stale .tmp is what separates them: an atomic
# writer necessarily passes through that path and replaces it, a plain
# redirect never touches it and leaves the fragment behind.
echo "[11] interrupted run recovery"
LOST_SHELL="$(basename "$(ls "$TOOLKIT_ROOT/.claude/skills/shared/shells/"* | head -1)")"
LOST_FILES=(
  ".claude/commands/$EDITED_CMD"
  .claude/scripts/render-html.js
  ".claude/skills/shared/shells/$LOST_SHELL"
)
cp "$MANIFEST" "$WORK/manifest-before-interrupt.json"
# A truncated JSON fragment, cut mid-key: exactly what a crash mid-write
# leaves in the .tmp slot.
printf '{\n  "toolkitVersion": "0.0.0-partial",\n  "files": {\n    ".claude/commands/' > "$MANIFEST.tmp"
for rel in "${LOST_FILES[@]}"; do rm -f "$SCRATCH/$rel"; done
if [ ! -f "$MANIFEST" ] || [ ! -s "$MANIFEST.tmp" ] || [ -f "$SCRATCH/.claude/scripts/render-html.js" ]; then
  fail "test setup: expected the manifest in place, a partial .tmp beside it, and the three files gone"
fi
set +e
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" < /dev/null > "$LOG/interrupted.log" 2>&1
INT_RC=$?
set -e
if [ "$INT_RC" -eq 0 ]; then
  ok "recovery run exited 0"
else
  fail "recovery run exited $INT_RC"
fi
for rel in "${LOST_FILES[@]}"; do
  if cmp -s "$SCRATCH/$rel" "$TOOLKIT_ROOT/$rel"; then
    ok "restored: $rel"
  else
    fail "not restored: $rel"
  fi
done
if [ ! -e "$MANIFEST.tmp" ]; then
  ok "partial .toolkit-manifest.json.tmp replaced, none left behind"
else
  fail ".toolkit-manifest.json.tmp left behind (writer did not go through the .tmp)"
fi
# Completeness is checked three ways, because the first alone cannot catch a
# writer that truncates consistently (both manifests would then match): the
# rebuilt file equals the last clean run's, every restored file has an entry
# (the keys are sorted, so two of the three sit well past the commands
# block), and the file is closed properly.
if cmp -s "$MANIFEST" "$WORK/manifest-before-interrupt.json"; then
  ok "manifest rebuilt whole (identical to the last clean run's)"
else
  # The differing lines are named so a changed hash (a toolkit source file
  # edited between the two runs) is told apart from a missing entry.
  fail "rebuilt manifest differs from the last clean run's (partial or missing entries): $(diff "$WORK/manifest-before-interrupt.json" "$MANIFEST" 2>&1 | grep -E '^[<>]' | head -4 | tr '\n' ' ')"
fi
for rel in "${LOST_FILES[@]}"; do
  if grep -qE "\"$rel\": \"[0-9a-f]{64}\"" "$MANIFEST" 2>/dev/null; then
    ok "manifest has an entry for restored $rel"
  else
    fail "manifest missing an entry for restored $rel"
  fi
done
if [ "$(tail -n 1 "$MANIFEST" 2>/dev/null)" = "}" ]; then
  ok "manifest is well-formed (closing brace present)"
else
  fail "manifest is not well-formed (no closing brace - partial write?)"
fi

# ─── [12] backup completeness for merged files ───────────────
# .gitignore and settings.local.json are line-merged rather than copied,
# and the manifest is regenerated; each is rewritten in place, so each
# needs its pre-merge copy in the backup dir for a rollback to be whole.
# A missing toolkit line/entry makes both merges write, and an older
# toolkitVersion stamp (a real upgrade always changes it) makes the
# manifest differ - so all three must back up in one run.
echo "[12] backup completeness for merged files"
GI_LINE="artifacts/html/"
PERM_ENTRY="Bash(git worktree *)"
sed -i.bak '\#^artifacts/html/$#d' "$SCRATCH/.gitignore"; rm -f "$SCRATCH/.gitignore.bak"
# Strip the trailing newline too, so the merge's newline guard is actually
# exercised: sed alone leaves the file newline-terminated and the guard has
# nothing to do. Command substitution drops trailing newlines, which is the
# portable way to do this (no GNU-only head -c -1 or truncate). Without the
# guard the restored line is glued onto the last line and the exact-line
# grep below fails.
printf '%s' "$(cat "$SCRATCH/.gitignore")" > "$SCRATCH/.gitignore.tmp" && mv "$SCRATCH/.gitignore.tmp" "$SCRATCH/.gitignore"
if [ -z "$(tail -c 1 "$SCRATCH/.gitignore")" ]; then
  fail "test setup: .gitignore still ends in a newline, so the newline guard is not exercised"
fi
sed -i.bak '/"Bash(git worktree \*)",/d' "$SCRATCH/.claude/settings.local.json"; rm -f "$SCRATCH/.claude/settings.local.json.bak"
sed -i.bak 's/"toolkitVersion": "[^"]*"/"toolkitVersion": "0.0.0-test"/' "$MANIFEST"; rm -f "$MANIFEST.bak"
if grep -qxF "$GI_LINE" "$SCRATCH/.gitignore" || grep -qF "$PERM_ENTRY" "$SCRATCH/.claude/settings.local.json" || ! grep -qF '0.0.0-test' "$MANIFEST"; then
  fail "test setup: could not remove the gitignore line / permission entry, or restamp the manifest"
fi
BACKUPS_BEFORE_LIST="$(list_backup_dirs)"
set +e
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" < /dev/null > "$LOG/merge-backup.log" 2>&1
MB_RC=$?
set -e
if [ "$MB_RC" -eq 0 ]; then
  ok "merge-backup run exited 0"
else
  fail "merge-backup run exited $MB_RC"
fi
MB_BACKUP="$(comm -13 <(echo "$BACKUPS_BEFORE_LIST") <(list_backup_dirs))"
for rel in .gitignore .claude/settings.local.json .claude/.toolkit-manifest.json; do
  if [ -n "$MB_BACKUP" ] && [ -f "$MB_BACKUP/$rel" ]; then
    ok "pre-merge copy backed up: $rel"
  else
    fail "pre-merge copy missing from backup: $rel"
  fi
done
if [ -n "$MB_BACKUP" ] && [ -f "$MB_BACKUP/.gitignore" ] && ! grep -qxF "$GI_LINE" "$MB_BACKUP/.gitignore"; then
  ok "backed-up .gitignore is the pre-merge copy"
else
  fail "backed-up .gitignore is not the pre-merge copy"
fi
if grep -qxF "$GI_LINE" "$SCRATCH/.gitignore"; then
  ok "live .gitignore has the restored line"
else
  fail "live .gitignore missing the restored line: $GI_LINE"
fi
if [ -n "$MB_BACKUP" ] && [ -f "$MB_BACKUP/.claude/settings.local.json" ] && ! grep -qF "$PERM_ENTRY" "$MB_BACKUP/.claude/settings.local.json"; then
  ok "backed-up settings.local.json is the pre-merge copy"
else
  fail "backed-up settings.local.json is not the pre-merge copy"
fi
if grep -qF "$PERM_ENTRY" "$SCRATCH/.claude/settings.local.json"; then
  ok "live settings.local.json has the restored entry"
else
  fail "live settings.local.json missing the restored entry: $PERM_ENTRY"
fi
if [ -n "$MB_BACKUP" ] && grep -qF '0.0.0-test' "$MB_BACKUP/.claude/.toolkit-manifest.json" 2>/dev/null; then
  ok "backed-up manifest is the pre-run copy"
else
  fail "backed-up manifest is not the pre-run copy"
fi
if ! grep -qF '0.0.0-test' "$MANIFEST"; then
  ok "live manifest restamped with the current version"
else
  fail "live manifest still carries the old version stamp"
fi

# ─── [13] unparseable settings.local.json ────────────────────
# A settings.local.json node cannot parse used to print its stack trace as
# a "+ SyntaxError ..." permission line (stderr was merged into the change
# list). It must now warn, name the error, leave the file untouched, and
# still exit 0.
echo "[13] unparseable settings.local.json"
cp "$SCRATCH/.claude/settings.local.json" "$WORK/settings-good.json"
printf '{ "permissions": { "allow": [ "Bash(git status *)", ] }\n' > "$WORK/settings-bad.json"
cp "$WORK/settings-bad.json" "$SCRATCH/.claude/settings.local.json"
set +e
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" < /dev/null > "$LOG/bad-settings.log" 2>&1
BAD_RC=$?
set -e
if [ "$BAD_RC" -eq 0 ]; then
  ok "run with unparseable settings still exited 0"
else
  fail "run with unparseable settings exited $BAD_RC"
fi
assert_grep "Warning: could not merge permissions into .claude/settings.local.json (" "$LOG/bad-settings.log" "warns that the merge was skipped"
# The error name must sit inside the warning's parentheses. A bare
# "SyntaxError" anywhere in the log was satisfied by the old bug's output
# too (the stack trace printed as "+ SyntaxError ..." lines).
assert_grep "could not merge permissions into .claude/settings.local.json (SyntaxError" "$LOG/bad-settings.log" "warning names the error"
assert_grep "add new entries by hand from the permissions" "$LOG/bad-settings.log" "warning points at the permissions table"
if grep -E '^[[:space:]]+\+ ' "$LOG/bad-settings.log" | grep -qE 'Error|^[[:space:]]+\+ +at '; then
  fail "error text printed as a + permission line"
else
  ok "no error text printed as a + permission line"
fi
if cmp -s "$SCRATCH/.claude/settings.local.json" "$WORK/settings-bad.json"; then
  ok "unparseable settings.local.json left unchanged"
else
  fail "unparseable settings.local.json was modified"
fi
if [ ! -e "$SCRATCH/.claude/settings.local.json.tmp" ]; then
  ok "no settings.local.json.tmp left behind"
else
  fail "settings.local.json.tmp left behind"
fi
cp "$WORK/settings-good.json" "$SCRATCH/.claude/settings.local.json"

# Scenarios 14 and 15 are ps1-only (see test-installer-guarantees.ps1);
# the numbers are kept aligned so the same scenario carries the same
# number in both suites.

# ─── [16] node-absent pre-flight note ────────────────────────
# The permission merge needs node. When it is missing the pre-flight must
# say so up front rather than letting the merge silently not happen. PATH
# is rebuilt without every directory holding a node executable for one
# --dry-run (nothing is written); the suite's own PATH is untouched. The
# negative control reads the populated dry run from scenario 4, where node
# was present, and expects no note there.
echo "[16] node-absent pre-flight note"
NO_NODE_PATH=""
IFS=':' read -r -a PATH_DIRS <<< "$PATH"
for d in "${PATH_DIRS[@]}"; do
  [ -n "$d" ] || continue
  [ -x "$d/node" ] && continue
  NO_NODE_PATH="${NO_NODE_PATH:+$NO_NODE_PATH:}$d"
done
# The dry run still needs the coreutils setup.sh calls (sed, grep, find,
# diff, ...). If node shares a directory with them (an apt install puts
# node in /usr/bin), trimming that directory would break the run for the
# wrong reason, so the scenario is skipped with a note rather than failing.
if PATH="$NO_NODE_PATH" command -v node > /dev/null 2>&1; then
  fail "test setup: node is still on the trimmed PATH"
elif ! PATH="$NO_NODE_PATH" command -v sed > /dev/null 2>&1 || ! PATH="$NO_NODE_PATH" command -v grep > /dev/null 2>&1; then
  echo "  skip: node shares a PATH directory with sed/grep here, so a node-free PATH cannot be built"
else
  # $BASH (this interpreter's absolute path) sidesteps a bash lookup on the
  # trimmed PATH.
  PATH="$NO_NODE_PATH" "$BASH" "$SCRIPT_DIR/setup.sh" "$SCRATCH" --dry-run < /dev/null > "$LOG/no-node.log" 2>&1
  assert_grep "Note: node was not found, so the .claude/settings.local.json permission" "$LOG/no-node.log" "pre-flight notes that node is missing"
  assert_grep "Dry run complete" "$LOG/no-node.log" "dry run without node still completes"
fi
if grep -qF "Note: node was not found" "$LOG/dryrun.log"; then
  fail "dry run with node present carried the node-absent note"
else
  ok "dry run with node present does not carry the node-absent note"
fi

# ─── [17] symlinked settings.local.json survives the merge ───
# A dotfiles setup keeps settings.local.json elsewhere and symlinks it into
# .claude/. The merge used to mv a fresh .tmp over the path, which swaps
# the inode: the link is severed (the dotfiles copy stops receiving
# updates) and the file mode is reset to the .tmp's. It must write through
# the link instead, so the link survives, the link target gets the merged
# content, and a 600 mode stays 600. Reuses PERM_ENTRY from scenario 12 to
# make the merge write.
echo "[17] symlinked settings.local.json survives the merge"
DOTFILES="$WORK/dotfiles"
mkdir -p "$DOTFILES"
cp "$SCRATCH/.claude/settings.local.json" "$DOTFILES/settings.local.json"
remove_perm "$DOTFILES/settings.local.json" "$PERM_ENTRY"
chmod 600 "$DOTFILES/settings.local.json"
rm -f "$SCRATCH/.claude/settings.local.json"
ln -s "$DOTFILES/settings.local.json" "$SCRATCH/.claude/settings.local.json"
if grep -qF "$PERM_ENTRY" "$DOTFILES/settings.local.json" || [ ! -L "$SCRATCH/.claude/settings.local.json" ]; then
  fail "test setup: could not stage the symlinked settings.local.json without $PERM_ENTRY"
fi
set +e
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" < /dev/null > "$LOG/symlink.log" 2>&1
SYM_RC=$?
set -e
if [ "$SYM_RC" -eq 0 ]; then
  ok "symlink run exited 0"
else
  fail "symlink run exited $SYM_RC"
fi
if [ -L "$SCRATCH/.claude/settings.local.json" ]; then
  ok "settings.local.json is still a symlink after the merge"
else
  fail "settings.local.json is no longer a symlink (merge replaced the link)"
fi
if grep -qF "$PERM_ENTRY" "$DOTFILES/settings.local.json"; then
  ok "symlink target received the merged content"
else
  fail "symlink target did not receive the restored entry: $PERM_ENTRY"
fi
# ls -l's mode column is the portable read (stat's flags differ between GNU
# and BSD); the target is read directly so a severed link cannot mask a
# reset mode.
SYM_MODE="$(ls -l "$DOTFILES/settings.local.json" | cut -c1-10)"
if [ "$SYM_MODE" = "-rw-------" ]; then
  ok "file mode preserved (600)"
else
  fail "file mode changed: $SYM_MODE (expected -rw-------)"
fi
# Back to a regular file so the remaining scenarios see the usual layout.
rm -f "$SCRATCH/.claude/settings.local.json"
cp "$DOTFILES/settings.local.json" "$SCRATCH/.claude/settings.local.json"
chmod 644 "$SCRATCH/.claude/settings.local.json"

# ─── [18] foreign-form browse.js entries are left alone ──────
# The absolute-path browse.js entries carry whichever path form wrote them:
# setup.sh writes POSIX paths, setup.ps1 writes drive-letter paths, and a
# target reached over UNC from PowerShell (\\wsl.localhost\...) would have
# become a //wsl.localhost/... entry. Each installer now manages only the
# form it can vouch for, so setup.sh must leave a UNC-form entry alone
# (never delete it, never add one) while still retiring a stale POSIX-form
# one - otherwise two installers took turns undoing each other and every
# alternating run created a backup.
echo "[18] UNC-form browse.js entry left alone, stale POSIX-form one retired"
UNC_ENTRY="Bash(echo * | node //wsl.localhost/Ubuntu/home/someone/project/.claude/scripts/browse.js *)"
STALE_POSIX_ENTRY="Bash(echo * | node /home/someone/old-project/.claude/scripts/browse.js *)"
awk -v unc="$UNC_ENTRY" -v stale="$STALE_POSIX_ENTRY" '
  { print }
  /"allow": \[/ { printf "      \"%s\",\n      \"%s\",\n", unc, stale }
' "$SCRATCH/.claude/settings.local.json" > "$SCRATCH/.claude/settings.local.json.seeded"
mv "$SCRATCH/.claude/settings.local.json.seeded" "$SCRATCH/.claude/settings.local.json"
if ! grep -qF "$UNC_ENTRY" "$SCRATCH/.claude/settings.local.json" || ! grep -qF "$STALE_POSIX_ENTRY" "$SCRATCH/.claude/settings.local.json"; then
  fail "test setup: could not seed the UNC-form and stale POSIX-form entries"
fi
set +e
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" < /dev/null > "$LOG/unc-entry.log" 2>&1
UNC_RC=$?
set -e
if [ "$UNC_RC" -eq 0 ]; then
  ok "path-form run exited 0"
else
  fail "path-form run exited $UNC_RC"
fi
if grep -qF "$UNC_ENTRY" "$SCRATCH/.claude/settings.local.json"; then
  ok "UNC-form browse.js entry left alone"
else
  fail "UNC-form browse.js entry was removed"
fi
if grep -qF "$STALE_POSIX_ENTRY" "$SCRATCH/.claude/settings.local.json"; then
  fail "stale POSIX-form browse.js entry was not retired"
else
  ok "stale POSIX-form browse.js entry retired"
fi
if grep -qF "Bash(echo * | node $SCRATCH/.claude/scripts/browse.js *)" "$SCRATCH/.claude/settings.local.json"; then
  ok "this target's own POSIX-form entry is still present"
else
  fail "this target's own POSIX-form entry is missing"
fi

# ─── [19] "new this version" box fires on a version change ───
# The positive half of the guard checked in scenario 7: with the target's
# VERSION stamped to something else, the version-neutral box must print.
# The stamp is a managed-file change (VERSION is refreshed and backed up),
# so this run legitimately creates a backup dir.
echo "[19] \"new this version\" box fires on a version change"
printf '0.0.0-test\n' > "$SCRATCH/VERSION"
set +e
bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" < /dev/null > "$LOG/version-box.log" 2>&1
VB_RC=$?
set -e
if [ "$VB_RC" -eq 0 ]; then
  ok "version-change run exited 0"
else
  fail "version-change run exited $VB_RC"
fi
assert_grep "upgrade (v0.0.0-test -> v" "$LOG/version-box.log" "pre-flight reports the version gap"
assert_grep "new this version:" "$LOG/version-box.log" "version-change run printed the \"new this version\" box"
if cmp -s "$SCRATCH/VERSION" "$TOOLKIT_ROOT/VERSION"; then
  ok "VERSION refreshed to the toolkit's"
else
  fail "VERSION not refreshed"
fi

# ─── [20] unusable TMPDIR does not abort the run (sh only) ───
# The settings merge captured node's stderr in a mktemp file under TMPDIR,
# inside an assignment - fatal under set -e, so a bad TMPDIR aborted the
# run after every copy and before the manifest write, leaving a half-done
# upgrade with no manifest. The stderr file now sits beside the merge's
# own .tmp in the target's .claude/, which is already known to be
# writable. The manifest is removed first so "present afterwards" proves
# this run wrote it. setup.ps1 has no TMPDIR dependency, hence sh only.
echo "[20] unusable TMPDIR does not abort the run (sh only)"
rm -f "$MANIFEST"
set +e
TMPDIR=/nonexistent-dir-xyz bash "$SCRIPT_DIR/setup.sh" "$SCRATCH" < /dev/null > "$LOG/bad-tmpdir.log" 2>&1
TMPDIR_RC=$?
set -e
if [ "$TMPDIR_RC" -eq 0 ]; then
  ok "run with an unusable TMPDIR exited 0"
else
  fail "run with an unusable TMPDIR exited $TMPDIR_RC"
fi
if [ -f "$MANIFEST" ]; then
  ok "manifest written despite the unusable TMPDIR"
else
  fail "manifest missing after the run with an unusable TMPDIR"
fi
if [ ! -e "$SCRATCH/.claude/settings.local.json.tmp.err" ]; then
  ok "no settings.local.json.tmp.err left behind"
else
  fail "settings.local.json.tmp.err left behind"
fi

# ─── Summary ─────────────────────────────────────────────────
echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "Logs preserved nowhere (scratch is removed) - re-run with 'bash -x' to debug."
  exit 1
fi
echo "All installer guarantees hold."
