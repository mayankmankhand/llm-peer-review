#!/bin/bash
#
# install-alias.sh - Install a convenient alias for the setup script
#
# This adds a 'setup-claude-toolkit' command to your shell that you can run from anywhere.
#
# Usage:
#   bash scripts/setup/install-alias.sh
#
# This will detect your shell and add the alias to the appropriate config file.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLKIT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SETUP_SCRIPT="$TOOLKIT_ROOT/scripts/setup/setup.sh"

# Detect user's login shell (not the shell running this script)
case "$SHELL" in
  */zsh)
    SHELL_CONFIG="$HOME/.zshrc"
    SHELL_NAME="zsh"
    ;;
  */bash)
    SHELL_CONFIG="$HOME/.bashrc"
    SHELL_NAME="bash"
    ;;
  *)
    echo "Error: Unsupported shell: ${SHELL:-unknown}"
    echo "Please add the alias manually to your shell config file."
    exit 1
    ;;
esac

# Create function
FUNCTION="
# Claude Toolkit Setup - Added by install-alias.sh
setup-claude-toolkit() {
  local target=\"\${1:-.}\"
  if [ \"\$target\" = \".\" ]; then
    echo \"Setting up Claude Toolkit in: \$(pwd)\"
  else
    echo \"Setting up Claude Toolkit in: \$target\"
  fi
  bash \"$SETUP_SCRIPT\" \"\$target\"
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

echo "Added 'setup-claude-toolkit' alias to $SHELL_CONFIG"
echo ""
echo "To use it:"
echo "  1. Reload your shell: source $SHELL_CONFIG"
echo "  2. Run: setup-claude-toolkit /path/to/your-project"
echo ""
echo "Or from your project directory:"
echo "  cd /path/to/your-project"
echo "  setup-claude-toolkit ."
