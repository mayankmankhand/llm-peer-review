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
#  21. A settings.local.json the target already TRACKS gets a warning that
#      names git rm --cached instead of "(machine-specific, never pushed)":
#      an ignore line never untracks a file, and the tripwire exempts a
#      never-push path the remote already has, so the file kept going out
#      on every push while the installer said the opposite (holistic
#      review, R3). The file stays tracked and keeps every committed entry
#      (setup never runs git rm); an untracked copy in a repo and a
#      non-repo target keep the normal message
#  22. DESIGN-PROFILE.md is seeded once from the installed template: a
#      fresh install creates it, a re-run skips it and keeps a local edit.
#      gen-media.js is a managed dep-free script and enters the manifest
#      like its siblings (issue #160)
#  23. --tools codex records the answer in .claude/.toolkit-tools.json; a
#      re-run without the flag reuses it and never prompts (stdin is
#      /dev/null); a --dry-run with a different answer changes nothing in
#      the target or under $HOME (issue #144)
#  24. A chosen tool's layout exists after install (.agents/skills/review/
#      SKILL.md, .codex/config.toml, AGENTS.md); without a terminal the
#      Codex trust step is printed, never written
#  25. A fresh install with no flag and no terminal creates no .agents/,
#      .codex/, .cursor/ and no AGENTS.md, and records Claude Code only
#  26. The manifest lists .claude/toolkit-permissions.json, the three new
#      scripts, an emitter and a host-notes file, and no path under
#      .agents/, .codex/, .cursor/, nor AGENTS.md or the build's own record
#  27. A fresh install seeds .claude/settings.local.json from the permission
#      list (it carries Bash(node .claude/scripts/build-layouts.js *) plus
#      this target's absolute browse.js entries) even when the toolkit
#      source has no settings.local.json at all: the suite installs from a
#      source copy with that file deleted
#  28. With cursor chosen and a bare `.cursor/` line pre-planted in the
#      target's .gitignore, the line is retired and `git check-ignore
#      .cursor/hooks.json` returns nothing afterwards, while a file Cursor
#      writes on its own stays ignored. The allowlist lands in the redirected
#      $HOME/.cursor/permissions.json: other keys and entries preserved, the
#      pre-existing file backed up, the _generated marker never copied, and
#      a re-run finds nothing to add
#  29. In a git-initialised target the pre-push hook is installed with the
#      marker line, executable, LF-only; a re-run finds it identical; a
#      pre-existing hook WITHOUT the marker is left byte-for-byte untouched
#      with a message; a non-repo target gets one skip note
#  30. --tools codex,cursor then --tools codex removes the generated .cursor/
#      files (and only those), the report names the clean, and the record
#      drops them
#
# Every setup run below gets HOME redirected to a scratch directory, so the
# per-machine merges (issue #144) can never touch the real ~/.cursor, ~/.gemini,
# or ~/.codex.
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

# Every setup run honors $HOME for its per-machine merges (issue #144), so the
# whole suite runs against a scratch home: the real ~/.cursor, ~/.gemini and
# ~/.codex are never read or written. mktemp above already used TMPDIR.
HOME="$WORK/home"
export HOME
mkdir -p "$HOME"

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

# tgit <repo> <git args...>: git against a scratch repo with the global and
# system config masked and a fixed identity supplied, so a signing key or
# hooks path on this machine cannot fail a scratch commit. Setup itself runs
# with the real config, as it would downstream. Used by scenarios 21, 28,
# 29 and 30, which skip when git is not on PATH.
GIT_EMPTY_CONFIG="$WORK/gitconfig-empty"
: > "$GIT_EMPTY_CONFIG"
tgit() {
  local repo="$1"
  shift
  GIT_CONFIG_GLOBAL="$GIT_EMPTY_CONFIG" GIT_CONFIG_NOSYSTEM=1 \
  GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com \
  GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com \
  git -C "$repo" "$@"
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
# The seeded settings.local.json carries machine paths and is never-push for the
# tripwire, so a fresh install must ignore it downstream (holistic pass, W1).
if grep -qxF ".claude/settings.local.json" "$SCRATCH/.gitignore"; then
  ok "fresh install ignores the seeded settings.local.json"
else
  fail "fresh install does not ignore .claude/settings.local.json"
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
if [ "$(grep -cxF ".claude/settings.local.json" "$SCRATCH/.gitignore")" -eq 1 ]; then
  ok "settings.local.json ignore line appears exactly once after the re-run"
else
  fail "settings.local.json ignore line missing or duplicated after the re-run"
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
#     missing target is a real break rather than a dead link in prose. Only
#     prompt files (*.md) are scanned: Claude Code expands the token nowhere
#     else, and build-layouts.js carries it inside a regex (issue #144),
#     which would otherwise read as a path.
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
$(grep -rhoE --include='*.md' '!`cat [^`]+`' "$SCRATCH/.claude" 2>/dev/null | sed 's/^!`cat //; s/`$//' | sort -u)
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

# ─── [21] tracked settings.local.json is warned about, not called "never pushed" ───
# The ignore line cannot untrack a file git already holds in its index, and
# pre-push-check.js deliberately exempts a never-push path that already
# exists at the remote base, so a downstream copy committed before this
# install kept going out on every push while the installer printed
# "(machine-specific, never pushed)" (holistic review, R3). The installer
# now asks the index when the target is a git repo and git is on PATH, and
# warns instead; the untrack itself stays with the user. Two fresh targets:
# one that committed the seed before setup (must get the warning, stay
# tracked, and keep every committed entry - the merge adds, never replaces)
# and a control repo whose copy is untracked (must get the normal message).
# The seed committed here is the Claude Code translation of the permission
# list, the same content a fresh install writes: since issue #144 the toolkit
# tracks no settings.local.json of its own, so there is no file to copy.
echo "[21] tracked settings.local.json gets a warning, untracked gets the normal message"
TRACKED_MSG="already tracked by git"
UNTRACK_CMD="git rm --cached .claude/settings.local.json"
NORMAL_MSG="(machine-specific, never pushed)"
if ! command -v git > /dev/null 2>&1; then
  echo "  skip: git is not on PATH, so there is no index to seed here"
else
  node "$TOOLKIT_ROOT/.claude/scripts/build-layouts.js" --root "$TOOLKIT_ROOT" --claude-settings --print > "$WORK/seed-settings.json"
  TRACKED="$WORK/tracked"
  mkdir -p "$TRACKED/.claude"
  cp "$WORK/seed-settings.json" "$TRACKED/.claude/settings.local.json"
  # The committed content, kept aside so "every committed entry survived"
  # can be checked without a second git call.
  cp "$TRACKED/.claude/settings.local.json" "$WORK/committed-settings.json"
  # add -f: a global excludes file (~/.config/git/ignore, which the config
  # masking above does not cover) may already ignore this path, and a
  # downstream copy that got committed anyway is exactly the case here.
  if tgit "$TRACKED" init -q > "$LOG/tracked-seed.log" 2>&1 \
     && tgit "$TRACKED" add -f -- .claude/settings.local.json >> "$LOG/tracked-seed.log" 2>&1 \
     && tgit "$TRACKED" commit -q -m "seed settings.local.json" >> "$LOG/tracked-seed.log" 2>&1; then
    ok "test setup: committed settings.local.json in a scratch repo"
  else
    fail "test setup: could not commit settings.local.json in a scratch repo (log: $LOG/tracked-seed.log)"
  fi
  set +e
  bash "$SCRIPT_DIR/setup.sh" "$TRACKED" < /dev/null > "$LOG/tracked.log" 2>&1
  TRACKED_RC=$?
  set -e
  if [ "$TRACKED_RC" -eq 0 ]; then
    ok "run on the tracked repo exited 0"
  else
    fail "run on the tracked repo exited $TRACKED_RC"
  fi
  assert_grep "$TRACKED_MSG" "$LOG/tracked.log" "tracked run warns that settings.local.json is already tracked"
  assert_grep "$UNTRACK_CMD" "$LOG/tracked.log" "tracked run names the untrack command"
  if grep -qF "$NORMAL_MSG" "$LOG/tracked.log"; then
    fail "tracked run still claims \"never pushed\""
  else
    ok "tracked run does not claim \"never pushed\""
  fi
  if tgit "$TRACKED" ls-files --error-unmatch -- .claude/settings.local.json > /dev/null 2>&1; then
    ok "settings.local.json is still tracked (setup never ran git rm)"
  else
    fail "settings.local.json is no longer tracked"
  fi
  # "Unchanged beyond the merge": the merge adds this target's browse.js
  # entries and may reformat, so the check is that the file is still a
  # regular file git sees as modified in place (not deleted or replaced)
  # and that every entry that was committed is still in it.
  TRACKED_STATUS="$(tgit "$TRACKED" status --porcelain -- .claude/settings.local.json 2>/dev/null)"
  case "$TRACKED_STATUS" in
    " M "*) ok "git sees settings.local.json as modified in place by the merge" ;;
    *) fail "unexpected git status for settings.local.json: '$TRACKED_STATUS'" ;;
  esac
  if [ -f "$TRACKED/.claude/settings.local.json" ] \
     && COMMITTED_FILE="$WORK/committed-settings.json" node -e '
       const fs = require("fs");
       const was = JSON.parse(fs.readFileSync(process.env.COMMITTED_FILE, "utf-8")).permissions.allow;
       const now = JSON.parse(fs.readFileSync(process.argv[1], "utf-8")).permissions.allow;
       process.exit(was.every(p => now.includes(p)) ? 0 : 1);
     ' "$TRACKED/.claude/settings.local.json"; then
    ok "every committed permission entry survived the merge"
  else
    fail "a committed permission entry is missing after the merge"
  fi
  # Control: the same seed, untracked, in a repo of its own.
  UNTRACKED="$WORK/untracked"
  mkdir -p "$UNTRACKED/.claude"
  cp "$WORK/seed-settings.json" "$UNTRACKED/.claude/settings.local.json"
  if tgit "$UNTRACKED" init -q > "$LOG/untracked-seed.log" 2>&1; then
    ok "test setup: scratch repo with an untracked settings.local.json"
  else
    fail "test setup: could not init the untracked scratch repo (log: $LOG/untracked-seed.log)"
  fi
  set +e
  bash "$SCRIPT_DIR/setup.sh" "$UNTRACKED" < /dev/null > "$LOG/untracked.log" 2>&1
  UNTRACKED_RC=$?
  set -e
  if [ "$UNTRACKED_RC" -eq 0 ]; then
    ok "run on the untracked repo exited 0"
  else
    fail "run on the untracked repo exited $UNTRACKED_RC"
  fi
  assert_grep "$NORMAL_MSG" "$LOG/untracked.log" "untracked copy in a repo gets the normal message"
  if grep -qF "$TRACKED_MSG" "$LOG/untracked.log"; then
    fail "untracked copy was warned about as tracked"
  else
    ok "untracked copy is not warned about"
  fi
  if tgit "$UNTRACKED" ls-files --error-unmatch -- .claude/settings.local.json > /dev/null 2>&1; then
    fail "untracked copy became tracked (setup must never run git add)"
  else
    ok "untracked copy is still untracked (setup never ran git add)"
  fi
  # A target that is not a repo at all keeps the normal message too: the
  # scenario 2 fresh install ran on one.
  assert_grep "$NORMAL_MSG" "$LOG/install.log" "non-repo target gets the normal message (scenario 2 log)"
fi

# ─── [22] DESIGN-PROFILE.md seeded once, gen-media.js managed ───
# Its own scratch tree: the main one has been through crash recovery, manifest
# collisions, and a hand-broken settings file by now, so a clean re-run there
# would test those scenarios' cleanup rather than the seed-once guarantee.
echo "[22] DESIGN-PROFILE.md seeded once, gen-media.js managed"
PROFILE_SCRATCH="$WORK/profile"
mkdir -p "$PROFILE_SCRATCH"
bash "$SCRIPT_DIR/setup.sh" "$PROFILE_SCRATCH" < /dev/null > "$LOG/profile-install.log" 2>&1
if [ -f "$PROFILE_SCRATCH/DESIGN-PROFILE.md" ]; then
  ok "fresh install seeded DESIGN-PROFILE.md"
else
  fail "fresh install did not seed DESIGN-PROFILE.md (log: $LOG/profile-install.log)"
fi
if cmp -s "$PROFILE_SCRATCH/DESIGN-PROFILE.md" "$TOOLKIT_ROOT/.claude/skills/shared/design-profile-template.md"; then
  ok "seeded profile is the template byte-for-byte"
else
  fail "seeded profile differs from the template"
fi
if [ -f "$PROFILE_SCRATCH/.claude/scripts/gen-media.js" ]; then
  ok "gen-media.js installed"
else
  fail "gen-media.js missing after install"
fi
if grep -qE '"\.claude/scripts/gen-media\.js": "[0-9a-f]{64}"' "$PROFILE_SCRATCH/.claude/.toolkit-manifest.json" 2>/dev/null; then
  ok "manifest carries gen-media.js"
else
  fail "manifest lacks gen-media.js"
fi
if grep -qF '"DESIGN-PROFILE.md"' "$PROFILE_SCRATCH/.claude/.toolkit-manifest.json" 2>/dev/null; then
  fail "manifest tracks the user-owned DESIGN-PROFILE.md"
else
  ok "manifest does not track the user-owned DESIGN-PROFILE.md"
fi
printf '\n- taste note: LOCAL EDIT MARKER\n' >> "$PROFILE_SCRATCH/DESIGN-PROFILE.md"
set +e
bash "$SCRIPT_DIR/setup.sh" "$PROFILE_SCRATCH" < /dev/null > "$LOG/profile-rerun.log" 2>&1
PROFILE_RC=$?
set -e
if [ "$PROFILE_RC" -eq 0 ]; then
  ok "re-run after a profile edit exited 0"
else
  fail "re-run after a profile edit exited $PROFILE_RC (log: $LOG/profile-rerun.log)"
fi
assert_grep "Skipping DESIGN-PROFILE.md - already exists (yours to customize)" "$LOG/profile-rerun.log" "re-run skips the existing profile"
assert_grep "LOCAL EDIT MARKER" "$PROFILE_SCRATCH/DESIGN-PROFILE.md" "local profile edit survived the re-run"

# ─── [23] the tools answer persists; a dry run never rewrites it ───
# --tools codex records the answer in .claude/.toolkit-tools.json (printf,
# one line). A re-run without the flag reuses it and never prompts: stdin
# is /dev/null, so a prompt would read an empty answer and silently record
# Claude Code only instead. A --dry-run with a DIFFERENT answer must change
# nothing in the target or under $HOME - the record, the clean, the build,
# and the per-machine merges all sit after the dry-run exit.
echo "[23] tools answer persists across runs; a dry run never rewrites it"
TOOLS_SCRATCH="$WORK/tools"
TOOLS_FILE="$TOOLS_SCRATCH/.claude/.toolkit-tools.json"
mkdir -p "$TOOLS_SCRATCH"
set +e
bash "$SCRIPT_DIR/setup.sh" "$TOOLS_SCRATCH" --tools codex < /dev/null > "$LOG/tools-first.log" 2>&1
TOOLS_RC=$?
set -e
if [ "$TOOLS_RC" -eq 0 ]; then
  ok "--tools codex run exited 0"
else
  fail "--tools codex run exited $TOOLS_RC (log: $LOG/tools-first.log)"
fi
if [ "$(cat "$TOOLS_FILE" 2>/dev/null)" = '{ "tools": ["codex"] }' ]; then
  ok "answer recorded as { \"tools\": [\"codex\"] }"
else
  fail "answer not recorded as expected: $(cat "$TOOLS_FILE" 2>/dev/null)"
fi
assert_grep "Tools: codex (from --tools)" "$LOG/tools-first.log" "pre-flight names the tools from the flag"
assert_grep "Recorded the tool layouts in .claude/.toolkit-tools.json: codex" "$LOG/tools-first.log" "run reports the record"
set +e
bash "$SCRIPT_DIR/setup.sh" "$TOOLS_SCRATCH" < /dev/null > "$LOG/tools-rerun.log" 2>&1
TOOLS_RERUN_RC=$?
set -e
if [ "$TOOLS_RERUN_RC" -eq 0 ]; then
  ok "re-run without --tools exited 0"
else
  fail "re-run without --tools exited $TOOLS_RERUN_RC"
fi
assert_grep "Tools: codex (recorded in .claude/.toolkit-tools.json)" "$LOG/tools-rerun.log" "re-run reuses the recorded answer"
if [ "$(cat "$TOOLS_FILE" 2>/dev/null)" = '{ "tools": ["codex"] }' ]; then
  ok "recorded answer unchanged by the re-run"
else
  fail "re-run changed the recorded answer: $(cat "$TOOLS_FILE" 2>/dev/null)"
fi
if grep -qF "Which AI tools" "$LOG/tools-first.log" "$LOG/tools-rerun.log"; then
  fail "a non-interactive run printed the tools prompt"
else
  ok "no run printed the tools prompt (stdin is not a terminal)"
fi
cp -R "$TOOLS_SCRATCH" "$WORK/tools-snap"
cp -R "$HOME" "$WORK/home-snap"
bash "$SCRIPT_DIR/setup.sh" "$TOOLS_SCRATCH" --dry-run --tools cursor < /dev/null > "$LOG/tools-dryrun.log" 2>&1
if diff -r "$TOOLS_SCRATCH" "$WORK/tools-snap" > /dev/null 2>&1; then
  ok "dry run with a different --tools changed nothing in the target"
else
  fail "dry run with --tools modified the target: $(diff -rq "$TOOLS_SCRATCH" "$WORK/tools-snap" 2>&1 | head -3 | tr '\n' ' ')"
fi
if diff -r "$HOME" "$WORK/home-snap" > /dev/null 2>&1; then
  ok "dry run with a different --tools changed nothing under HOME"
else
  fail "dry run with --tools modified HOME: $(diff -rq "$HOME" "$WORK/home-snap" 2>&1 | head -3 | tr '\n' ' ')"
fi
assert_grep "Tools: cursor (from --tools)" "$LOG/tools-dryrun.log" "dry run reports the flag's answer"
assert_grep "Remove the generated files of: codex" "$LOG/tools-dryrun.log" "dry run announces the clean it would run"
assert_grep "Dry run complete" "$LOG/tools-dryrun.log" "dry run completes"
rm -rf "$WORK/tools-snap" "$WORK/home-snap"

# ─── [24] a chosen tool's layout exists after install ────────
# The Codex layout is what --tools codex asked for; the shared skills and
# AGENTS.md come with any tool. Without a terminal the Codex trust section
# is printed for the user to add, never written into ~/.codex/config.toml.
echo "[24] a chosen tool's layout exists after install"
for rel in .agents/skills/review/SKILL.md .codex/config.toml AGENTS.md .claude/.toolkit-generated.json; do
  if [ -f "$TOOLS_SCRATCH/$rel" ]; then
    ok "generated: $rel"
  else
    fail "missing after --tools codex: $rel"
  fi
done
assert_grep "build-layouts.js:" "$LOG/tools-first.log" "install printed the build summary line"
assert_grep 'trust_level = "trusted"' "$LOG/tools-first.log" "Codex trust step printed for a non-interactive run"
assert_grep "run /hooks once" "$LOG/tools-first.log" "the one-time /hooks step is printed"
if [ ! -e "$HOME/.codex/config.toml" ]; then
  ok "no terminal, so ~/.codex/config.toml was not written"
else
  fail "~/.codex/config.toml was written without a terminal"
fi

# ─── [25] no flag, no terminal: nothing is generated ─────────
# The downstream default. An existing project must never gain folders
# unasked, and a fresh install that cannot ask records Claude Code only.
echo "[25] a fresh install with no flag and no terminal generates nothing"
PLAIN_SCRATCH="$WORK/plain"
mkdir -p "$PLAIN_SCRATCH"
bash "$SCRIPT_DIR/setup.sh" "$PLAIN_SCRATCH" < /dev/null > "$LOG/plain.log" 2>&1
for rel in .agents .codex .cursor AGENTS.md .claude/.toolkit-generated.json; do
  if [ ! -e "$PLAIN_SCRATCH/$rel" ]; then
    ok "not created: $rel"
  else
    fail "created without being asked for: $rel"
  fi
done
if [ "$(cat "$PLAIN_SCRATCH/.claude/.toolkit-tools.json" 2>/dev/null)" = '{ "tools": [] }' ]; then
  ok "answer recorded as Claude Code only"
else
  fail "answer not recorded as Claude Code only: $(cat "$PLAIN_SCRATCH/.claude/.toolkit-tools.json" 2>/dev/null)"
fi
assert_grep "Tools: none (Claude Code only) (default: Claude Code only)" "$LOG/plain.log" "pre-flight reports the default"
if grep -qF "Which AI tools" "$LOG/plain.log"; then
  fail "non-interactive fresh install printed the tools prompt"
else
  ok "non-interactive fresh install did not prompt"
fi

# ─── [26] manifest: new sources in, generated paths out ──────
# The sources setup copies are manifest-managed like their siblings; what
# build-layouts.js writes, and the tools answer, never are - the build
# hashes its own output and the answer belongs to the repo.
echo "[26] manifest lists the new sources and no generated path"
TOOLS_MANIFEST="$TOOLS_SCRATCH/.claude/.toolkit-manifest.json"
EMITTER="$(basename "$(ls "$TOOLKIT_ROOT/.claude/scripts/layouts/"*.js | head -1)")"
HOST_NOTE="$(basename "$(ls "$TOOLKIT_ROOT/.claude/skills/shared/host-notes/"*.md | head -1)")"
for rel in .claude/toolkit-permissions.json .claude/scripts/build-layouts.js .claude/scripts/write-guard.js .claude/scripts/chain-hook.js ".claude/scripts/layouts/$EMITTER" ".claude/skills/shared/host-notes/$HOST_NOTE"; do
  if grep -qE "\"$rel\": \"[0-9a-f]{64}\"" "$TOOLS_MANIFEST" 2>/dev/null; then
    ok "manifest carries $rel"
  else
    fail "manifest lacks $rel"
  fi
done
if grep -qE '"(\.agents|\.codex|\.cursor)/|"AGENTS\.md"|toolkit-tools\.json|toolkit-generated\.json' "$TOOLS_MANIFEST" 2>/dev/null; then
  fail "manifest tracks a generated path or the tools answer: $(grep -E '"(\.agents|\.codex|\.cursor)/|"AGENTS\.md"|toolkit-tools\.json|toolkit-generated\.json' "$TOOLS_MANIFEST" | head -2 | tr '\n' ' ')"
else
  ok "manifest tracks no generated path and not the tools answer"
fi

# ─── [27] settings.local.json seeded from the permission list ───
# The toolkit repo no longer tracks a settings.local.json of its own, so a
# fresh install must not depend on one being there. The suite builds a
# source copy that lacks the file outright (only what setup copies, minus
# node_modules and any nested worktree) and installs from it: the seed
# comes from .claude/toolkit-permissions.json via build-layouts.js, and
# the merge then adds this target's absolute browse.js entries on top.
echo "[27] settings.local.json is seeded from the permission list, not from a toolkit copy"
SOURCE_COPY="$WORK/source"
mkdir -p "$SOURCE_COPY/.claude" "$SOURCE_COPY/scripts" "$SOURCE_COPY/artifacts"
for d in agents commands rules scripts skills; do
  cp -R "$TOOLKIT_ROOT/.claude/$d" "$SOURCE_COPY/.claude/$d"
done
rm -rf "$SOURCE_COPY/.claude/scripts/node_modules"
cp "$TOOLKIT_ROOT/.claude/toolkit-permissions.json" "$SOURCE_COPY/.claude/toolkit-permissions.json"
cp -R "$TOOLKIT_ROOT/scripts/setup" "$SOURCE_COPY/scripts/setup"
cp "$TOOLKIT_ROOT/artifacts/README.md" "$SOURCE_COPY/artifacts/README.md"
for f in VERSION CLAUDE.md LESSONS.md LESSONS-detail.md .env.local.example .gitignore .gitattributes; do
  cp "$TOOLKIT_ROOT/$f" "$SOURCE_COPY/$f"
done
if [ ! -e "$SOURCE_COPY/.claude/settings.local.json" ]; then
  ok "test setup: source copy has no settings.local.json"
else
  fail "test setup: source copy still has a settings.local.json"
fi
SEED_SCRATCH="$WORK/seed"
mkdir -p "$SEED_SCRATCH"
set +e
bash "$SOURCE_COPY/scripts/setup/setup.sh" "$SEED_SCRATCH" < /dev/null > "$LOG/seed.log" 2>&1
SEED_RC=$?
set -e
if [ "$SEED_RC" -eq 0 ]; then
  ok "install from the seedless source exited 0"
else
  fail "install from the seedless source exited $SEED_RC (log: $LOG/seed.log)"
fi
assert_grep "Seeding .claude/settings.local.json from .claude/toolkit-permissions.json" "$LOG/seed.log" "run says the seed came from the permission list"
SEEDED="$SEED_SCRATCH/.claude/settings.local.json"
if [ -f "$SEEDED" ]; then
  ok "settings.local.json seeded"
else
  fail "settings.local.json missing after the seedless install"
fi
assert_grep 'Bash(node .claude/scripts/build-layouts.js *)' "$SEEDED" "seeded file carries the build-layouts.js permission"
assert_grep "Bash(echo * | node $SEED_SCRATCH/.claude/scripts/browse.js *)" "$SEEDED" "merge added this target's absolute browse.js entry after the seed"
assert_grep '"defaultMode": "acceptEdits"' "$SEEDED" "seeded file carries defaultMode"
if [ -z "$(find "$SEED_SCRATCH" -maxdepth 1 -name '.toolkit-backup-*' -type d)" ]; then
  ok "seed plus merge on a fresh install made no backup dir"
else
  fail "seed plus merge on a fresh install created a backup dir"
fi

# ─── [28] bare .cursor/ line retired; Cursor allowlist merged under HOME ───
# A target from before v7 ignores the whole .cursor/ directory, and git
# never descends into an excluded directory, so the toolkit's by-name
# negations would be dead. The pre-planted ~/.cursor/permissions.json has
# a key and an entry of its own that must survive the merge, and it must
# be backed up (it lives outside the target, so its absolute path is
# mirrored under the backup root without the leading slash).
echo "[28] a bare .cursor/ line is retired; the Cursor allowlist is merged under HOME"
if ! command -v git > /dev/null 2>&1; then
  echo "  skip: git is not on PATH, so check-ignore cannot be asked here"
else
  CURSOR_SCRATCH="$WORK/cursor"
  mkdir -p "$CURSOR_SCRATCH" "$HOME/.cursor"
  tgit "$CURSOR_SCRATCH" init -q
  printf 'node_modules/\n.cursor/\n' > "$CURSOR_SCRATCH/.gitignore"
  printf '{\n  "foo": 1,\n  "terminalAllowlist": ["my own command"]\n}\n' > "$HOME/.cursor/permissions.json"
  set +e
  bash "$SCRIPT_DIR/setup.sh" "$CURSOR_SCRATCH" --tools cursor < /dev/null > "$LOG/cursor.log" 2>&1
  CURSOR_RC=$?
  set -e
  if [ "$CURSOR_RC" -eq 0 ]; then
    ok "--tools cursor run exited 0"
  else
    fail "--tools cursor run exited $CURSOR_RC (log: $LOG/cursor.log)"
  fi
  assert_grep "Removed the bare .cursor/ line from .gitignore" "$LOG/cursor.log" "run reports the retired line"
  if grep -qxF ".cursor/" "$CURSOR_SCRATCH/.gitignore"; then
    fail "bare .cursor/ line still in .gitignore"
  else
    ok "bare .cursor/ line removed from .gitignore"
  fi
  assert_grep "node_modules/" "$CURSOR_SCRATCH/.gitignore" "the user's own ignore line survived"
  if [ -f "$CURSOR_SCRATCH/.cursor/hooks.json" ]; then
    ok "generated .cursor/hooks.json exists"
  else
    fail "generated .cursor/hooks.json missing"
  fi
  CURSOR_IGNORED="$(tgit "$CURSOR_SCRATCH" check-ignore .cursor/hooks.json 2>/dev/null || true)"
  if [ -z "$CURSOR_IGNORED" ]; then
    ok "git check-ignore .cursor/hooks.json returns nothing"
  else
    fail "generated .cursor/hooks.json is still ignored: $CURSOR_IGNORED"
  fi
  CURSOR_OWN_IGNORED="$(tgit "$CURSOR_SCRATCH" check-ignore .cursor/mcp.json 2>/dev/null || true)"
  if [ -n "$CURSOR_OWN_IGNORED" ]; then
    ok "a file Cursor writes on its own (.cursor/mcp.json) stays ignored"
  else
    fail ".cursor/mcp.json is no longer ignored"
  fi
  CURSOR_PERMS="$HOME/.cursor/permissions.json"
  assert_grep '"node .claude/scripts/build-layouts.js"' "$CURSOR_PERMS" "toolkit allowlist entry merged into HOME/.cursor/permissions.json"
  assert_grep '"my own command"' "$CURSOR_PERMS" "the user's own allowlist entry survived the merge"
  assert_grep '"foo": 1' "$CURSOR_PERMS" "the user's other key survived the merge"
  if grep -qF '_generated' "$CURSOR_PERMS"; then
    fail "the _generated marker was copied into the per-machine file"
  else
    ok "the _generated marker was not copied"
  fi
  assert_grep "machine-global" "$LOG/cursor.log" "the merge says the file is machine-global"
  CURSOR_BACKUP="$(find "$CURSOR_SCRATCH" -maxdepth 1 -name '.toolkit-backup-*' -type d | sort | tail -1)"
  if [ -n "$CURSOR_BACKUP" ] && grep -qF '"my own command"' "$CURSOR_BACKUP/${HOME#/}/.cursor/permissions.json" 2>/dev/null; then
    ok "pre-existing permissions.json backed up under the backup root"
  else
    fail "pre-existing permissions.json not found in the backup dir"
  fi
  set +e
  bash "$SCRIPT_DIR/setup.sh" "$CURSOR_SCRATCH" < /dev/null > "$LOG/cursor-rerun.log" 2>&1
  CURSOR_RERUN_RC=$?
  set -e
  if [ "$CURSOR_RERUN_RC" -eq 0 ]; then
    ok "cursor re-run exited 0"
  else
    fail "cursor re-run exited $CURSOR_RERUN_RC"
  fi
  assert_grep "already holds every toolkit allowlist entry" "$LOG/cursor-rerun.log" "re-run finds nothing to add to the allowlist"
fi

# ─── [29] pre-push hook installed; a foreign hook is left alone ───
# The hook is the toolkit's only when it carries the marker line. A hook
# somebody else wrote is never replaced, and a target that is not a git
# repository gets one skip note (the scenario 2 install ran on one).
echo "[29] git pre-push hook installed with the marker; a foreign hook is left alone"
if ! command -v git > /dev/null 2>&1; then
  echo "  skip: git is not on PATH, so there is no hooks directory to install into"
else
  HOOK="$CURSOR_SCRATCH/.git/hooks/pre-push"
  if [ -x "$HOOK" ]; then
    ok "pre-push hook installed and executable"
  else
    fail "pre-push hook missing or not executable: $HOOK"
  fi
  assert_grep "# llm-peer-review toolkit pre-push hook (issue #144)" "$HOOK" "hook carries the marker line"
  assert_grep "exec node .claude/scripts/pre-push-check.js" "$HOOK" "hook runs the tripwire from the repository root"
  if [ "$(head -n 1 "$HOOK" 2>/dev/null)" = "#!/bin/sh" ]; then
    ok "hook starts with #!/bin/sh"
  else
    fail "hook does not start with #!/bin/sh"
  fi
  if grep -q $'\r' "$HOOK" 2>/dev/null; then
    fail "hook carries CR bytes (must be LF-only)"
  else
    ok "hook is LF-only"
  fi
  assert_grep "Installed the git pre-push hook" "$LOG/cursor.log" "first run reports the install"
  assert_grep "Git pre-push hook already installed" "$LOG/cursor-rerun.log" "re-run finds the hook identical"
  FOREIGN="$WORK/foreign"
  mkdir -p "$FOREIGN"
  tgit "$FOREIGN" init -q
  mkdir -p "$FOREIGN/.git/hooks"
  printf '#!/bin/sh\necho mine\n' > "$FOREIGN/.git/hooks/pre-push"
  chmod +x "$FOREIGN/.git/hooks/pre-push"
  cp "$FOREIGN/.git/hooks/pre-push" "$WORK/foreign-hook.orig"
  set +e
  bash "$SCRIPT_DIR/setup.sh" "$FOREIGN" < /dev/null > "$LOG/foreign.log" 2>&1
  FOREIGN_RC=$?
  set -e
  if [ "$FOREIGN_RC" -eq 0 ]; then
    ok "run with a foreign pre-push hook exited 0"
  else
    fail "run with a foreign pre-push hook exited $FOREIGN_RC"
  fi
  if cmp -s "$FOREIGN/.git/hooks/pre-push" "$WORK/foreign-hook.orig"; then
    ok "foreign pre-push hook left byte-for-byte untouched"
  else
    fail "foreign pre-push hook was modified"
  fi
  assert_grep "is not the toolkit's - left alone" "$LOG/foreign.log" "pre-flight announces the foreign hook"
  assert_grep "Left the existing pre-push hook alone" "$LOG/foreign.log" "run reports the foreign hook"
  assert_grep "Git pre-push hook: skipped, the target is not a git repository" "$LOG/install.log" "non-repo target gets the skip note (scenario 2 log)"
fi

# ─── [30] shrinking the answer cleans the dropped tool ───────
# The stored answer is which layouts live in the repo. Dropping cursor
# must remove exactly the Cursor files (and the empty directory), keep
# the Codex and shared files, and drop the entries from the build's record.
echo "[30] --tools codex,cursor then --tools codex removes the generated Cursor files"
SHRINK_SCRATCH="$WORK/shrink"
mkdir -p "$SHRINK_SCRATCH"
bash "$SCRIPT_DIR/setup.sh" "$SHRINK_SCRATCH" --tools codex,cursor < /dev/null > "$LOG/shrink-first.log" 2>&1
if [ -f "$SHRINK_SCRATCH/.cursor/hooks.json" ] && [ -f "$SHRINK_SCRATCH/.cursor/skills/tk-review/SKILL.md" ] && [ -f "$SHRINK_SCRATCH/.codex/config.toml" ]; then
  ok "codex and cursor layouts both built"
else
  fail "codex and cursor layouts not both built (log: $LOG/shrink-first.log)"
fi
set +e
bash "$SCRIPT_DIR/setup.sh" "$SHRINK_SCRATCH" --tools codex < /dev/null > "$LOG/shrink-second.log" 2>&1
SHRINK_RC=$?
set -e
if [ "$SHRINK_RC" -eq 0 ]; then
  ok "--tools codex run exited 0"
else
  fail "--tools codex run exited $SHRINK_RC (log: $LOG/shrink-second.log)"
fi
assert_grep "Remove the generated files of: cursor" "$LOG/shrink-second.log" "pre-flight announces the clean"
assert_grep "Removed the generated cursor layout" "$LOG/shrink-second.log" "report names the clean"
if [ ! -e "$SHRINK_SCRATCH/.cursor" ]; then
  ok "generated .cursor/ removed entirely"
else
  fail "generated .cursor/ still present: $(ls -R "$SHRINK_SCRATCH/.cursor" | head -3 | tr '\n' ' ')"
fi
if [ -f "$SHRINK_SCRATCH/.codex/config.toml" ] && [ -f "$SHRINK_SCRATCH/.agents/skills/review/SKILL.md" ] && [ -f "$SHRINK_SCRATCH/AGENTS.md" ]; then
  ok "codex and shared layouts kept"
else
  fail "codex or shared layout lost by the clean"
fi
if [ "$(cat "$SHRINK_SCRATCH/.claude/.toolkit-tools.json" 2>/dev/null)" = '{ "tools": ["codex"] }' ]; then
  ok "answer re-recorded as codex only"
else
  fail "answer not re-recorded: $(cat "$SHRINK_SCRATCH/.claude/.toolkit-tools.json" 2>/dev/null)"
fi
if grep -q '"\.cursor/' "$SHRINK_SCRATCH/.claude/.toolkit-generated.json" 2>/dev/null; then
  fail "the build's record still lists .cursor/ files"
else
  ok "the build's record no longer lists .cursor/ files"
fi

# ─── Summary ─────────────────────────────────────────────────
echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "Logs preserved nowhere (scratch is removed) - re-run with 'bash -x' to debug."
  exit 1
fi
echo "All installer guarantees hold."
