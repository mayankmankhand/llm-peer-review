#!/usr/bin/env bash
# Copy data/notes.json into backups/ with a timestamp, keeping the newest 7 copies.
# Run from the project root: npm run backup
set -euo pipefail
shopt -s failglob

KEEP=7
mkdir -p backups

# Collect the existing backups. An empty backups/ folder would still trigger
# failglob, so the loop is guarded by nullglob (restored afterward) to yield
# zero iterations instead of a "no match" abort.
shopt -s nullglob
existing=()
for f in backups/notes-*.json; do
  [ -f "$f" ] || continue
  existing+=("$f")
done
shopt -u nullglob

# Delete the oldest copies so the new one makes $KEEP. File names carry the
# timestamp, so sorting by name sorts by age.
excess=$(( ${#existing[@]} - (KEEP - 1) ))
if [ "$excess" -gt 0 ]; then
  printf '%s\n' "${existing[@]}" | sort | head -n "$excess" | while read -r old; do
    rm -- "$old"
  done
fi

stamp="$(date +%Y%m%d-%H%M%S)"
cp data/notes.json "backups/notes-$stamp.json"
echo "Backed up data/notes.json to backups/notes-$stamp.json"
