#!/usr/bin/env bash
# Bump the toolkit version across all tracked files.
#
# Usage:
#   bash scripts/setup/bump-version.sh <new-version>
#
# Example:
#   bash scripts/setup/bump-version.sh 4.3.0
#
# This script lives in scripts/setup/ and is NOT copied to downstream
# projects. setup.sh only propagates the three runtime scripts
# (ask-gpt.js, ask-gemini.js, browse.js); everything else in scripts/
# stays in the toolkit repo.
#
# It handles the mechanical updates only. CHANGELOG and AGENT-SETUP
# entries stay manual because release notes need human writing.

set -e

NEW="${1:-}"

if [ -z "$NEW" ]; then
  echo "Usage: bash scripts/setup/bump-version.sh <new-version>"
  echo "Example: bash scripts/setup/bump-version.sh 4.3.0"
  exit 1
fi

if ! echo "$NEW" | grep -qE '^[0-9]+\.[0-9]+(\.[0-9]+)?$'; then
  echo "Error: version must look like X.Y or X.Y.Z (got: $NEW)"
  exit 1
fi

TOOLKIT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$TOOLKIT_ROOT"

if [ ! -f VERSION ]; then
  echo "Error: VERSION file not found at $TOOLKIT_ROOT/VERSION"
  echo "Are you running this from the toolkit repo?"
  exit 1
fi

CURRENT="$(cat VERSION)"

if [ "$CURRENT" = "$NEW" ]; then
  echo "Error: VERSION is already $NEW - nothing to bump."
  echo "If individual files got out of sync, update them by hand."
  exit 1
fi

echo "Bumping from $CURRENT to $NEW"
echo ""

# 1. VERSION
printf '%s\n' "$NEW" > VERSION
echo "  Updated VERSION"

# 2. package.json (top-level "version" only - leaves dependency versions alone)
NEW_VERSION="$NEW" node -e '
  const fs = require("fs");
  const v = process.env.NEW_VERSION;
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  pkg.version = v;
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
'
echo "  Updated package.json"

# 3. Root package-lock.json - no longer present after issue #91. The toolkit's
# four runtime deps moved to .claude/scripts/package.json with its own
# (deliberately versioned 0.0.0, private:true) lockfile. Skip if missing.
if [ -f package-lock.json ]; then
  NEW_VERSION="$NEW" node -e '
    const fs = require("fs");
    const v = process.env.NEW_VERSION;
    const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
    lock.version = v;
    if (lock.packages && lock.packages[""]) lock.packages[""].version = v;
    fs.writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
  '
  echo "  Updated package-lock.json"
fi

# 4. Version stamp in managed rules files. Each file ships pre-stamped; this
# rewrites the stamp to the new version. To add a new managed rule file, append
# its path to the array below and it gets stamped automatically. Bash 3.2 safe
# (simple indexed array).
RULES_FILES=(
  .claude/rules/toolkit.md
  .claude/rules/html-outputs.md
)
for rules_file in "${RULES_FILES[@]}"; do
  RULES_FILE="$rules_file" NEW_VERSION="$NEW" node -e '
    const fs = require("fs");
    const path = process.env.RULES_FILE;
    const v = process.env.NEW_VERSION;
    const content = fs.readFileSync(path, "utf8");
    const updated = content.replace(
      /<!-- Toolkit version: [^|]+\|/,
      `<!-- Toolkit version: ${v} |`
    );
    if (updated === content) {
      console.error("Error: could not find version stamp in " + path);
      console.error("Expected pattern: <!-- Toolkit version: X.Y.Z |");
      process.exit(1);
    }
    fs.writeFileSync(path, updated);
  '
  echo "  Updated $rules_file"
done

echo ""
echo "Automated updates done. Still to do manually:"
echo ""
echo "  [ ] Add a v$NEW section to CHANGELOG.md (top of file)"
echo "  [ ] Update AGENT-SETUP.md:"
echo "        - Title line: # AI Agent Setup Instructions (v$NEW)"
echo "        - Add a new **What's new in v$NEW:** block"
echo "        - Rename the previous **What's new in vX.Y:** to **What was new in vX.Y:**"
echo "  [ ] If you bumped a default model in this release (do in this order):"
echo "        1. In .claude/scripts/ask-*.js, append the CURRENT value of DEFAULT_*_MODEL to KNOWN_STALE_*_MODELS"
echo "        2. Then update DEFAULT_*_MODEL to the new value"
echo "        3. Update .env.local.example and API-KEYS.md to match"
echo "        (Ordering matters: step 1 before step 2, otherwise the old default is gone from the file and easy to mistype.)"
echo "  [ ] Run 'git diff' to verify all changes"
echo "  [ ] Commit: git commit -m 'Bump to v$NEW (<reason>)'"
echo ""
