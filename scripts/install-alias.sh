#!/bin/bash
#
# install-alias.sh - Install a convenient alias for the setup script
#
# This adds a 'setup-claude-toolkit' command to your shell that you can run from anywhere.
#
# Usage:
#   bash scripts/install-alias.sh
#
# This will detect your shell and add the alias to the appropriate config file.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SETUP_SCRIPT="$TOOLKIT_ROOT/scripts/setup.sh"

# Detect shell
if [ -n "$ZSH_VERSION" ]; then
  SHELL_CONFIG="$HOME/.zshrc"
  SHELL_NAME="zsh"
elif [ -n "$BASH_VERSION" ]; then
  SHELL_CONFIG="$HOME/.bashrc"
  SHELL_NAME="bash"
else
  echo "Error: Unsupported shell. Please add the alias manually to your shell config."
  exit 1
fi

# Create function
FUNCTION="
# Claude Toolkit Setup - Added by install-alias.sh
setup-claude-toolkit() {
  if [ -z \"\$1\" ]; then
    echo \"Usage: setup-claude-toolkit [target-project-directory]\"
    echo \"  If run from your project directory, omit the target.\"
    return 1
  fi
  bash \"$SETUP_SCRIPT\" \"\$1\"
}
"

# Check if already installed
if grep -q "setup-claude-toolkit" "$SHELL_CONFIG" 2>/dev/null; then
  echo "Alias already exists in $SHELL_CONFIG"
  echo "Skipping installation. To reinstall, remove the existing alias first."
  exit 0
fi

# Add to config file
echo "" >> "$SHELL_CONFIG"
echo "$FUNCTION" >> "$SHELL_CONFIG"

echo "✓ Added 'setup-claude-toolkit' alias to $SHELL_CONFIG"
echo ""
echo "To use it:"
echo "  1. Reload your shell: source $SHELL_CONFIG"
echo "  2. Run: setup-claude-toolkit /path/to/your-project"
echo ""
echo "Or from your project directory:"
echo "  cd /path/to/your-project"
echo "  setup-claude-toolkit ."
