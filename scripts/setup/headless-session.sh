#!/usr/bin/env bash
# headless-session.sh - run Claude Code headless against a plugin build without
# touching the real ~/.claude (maintainer-only; not shipped in the plugin).
#
# Why: a product-level test of the toolkit has to run a real session, and a real
# session writes into whatever HOME it sees: the plugin registry, the stable
# plugin link, the correction ledger. The 7.2.0 cycle's first headless run did
# exactly that to the real config (its plan's Outcomes, "Harness"). Every later
# run used a scratch home, and the helper scripts that built it lived in /tmp,
# which this machine clears overnight. This script is that procedure, kept.
#
# Usage:
#   scripts/setup/headless-session.sh --build <plugin-folder> --project <folder> \
#       [--home <scratch-home>] [--mode default|acceptEdits|bypassPermissions] \
#       -- <arguments passed to claude -p>
#   scripts/setup/headless-session.sh --baseline <file>   record hashes of the real config
#   scripts/setup/headless-session.sh --verify <file>     compare the real config with a baseline
#
# --build    the plugin folder to test: `git archive v7.2.0 plugin | tar -x -C <scratch>`
#            gives <scratch>/plugin; `node scripts/build-plugin.js --out <scratch>/plugin
#            --version <v>` gives one from the working tree.
# --project  the scratch project claude runs in (its cwd).
# --home     the scratch home to use or create (default: a fresh mktemp folder).
#            Reuse one across calls so `--resume <session-id>` finds its session.
# --mode     the permission mode (default: default).
#
# The scratch home holds, and only holds, what a session needs (settled by trial
# on 2026-09-16, see "Scratch home contents" below). Everything else a session
# writes lands in the scratch home and is thrown away with it.
#
# Scratch home contents:
#   $HOME/.claude/.credentials.json  -> a symlink to the real credentials file
#   $HOME/.claude/plugins/data/tk-llm-peer-review/current -> a symlink to --build
#     (the stable path the shipped rules file and session-start.js resolve)
#   TK_LEDGER_DIR=$HOME/tk-ledger      the correction ledger for the run
#   $HOME/.claude.json                 linked only when NEED_CLAUDE_JSON=1 is set
#     (the first trial ran without it; set the variable if a session refuses to
#     start with an onboarding or account error)
#
# --add-dir "$BUILD" is passed as well: every plugin command inlines fragments
# with !`cat "${CLAUDE_PLUGIN_ROOT}/..."`, and Claude Code only concatenates files
# from the session's allowed directories. A real install sits under the plugin
# cache, which is allowed; a --plugin-dir elsewhere is not, and the first #184
# scenario run ended at turn zero with "cat ... was blocked" until this was added.
#
# The binary: the `claude` on PATH here is a wrapper that looks under $HOME for
# an editor's extension binary, so it cannot run with HOME moved. The script
# resolves the native binary from the REAL home first (CLAUDE_BIN overrides).
#
# Exit codes: claude's own exit code for a run; 0/1 for --verify (1 = a file
# changed, each named); 2 for a usage error.
set -euo pipefail

REAL_HOME="$HOME"
BASELINE_FILES=(
  ".claude/settings.json"
  ".claude/settings.local.json"
  ".claude/plugins/installed_plugins.json"
  ".claude/plugins/known_marketplaces.json"
  ".claude/plugins/blocklist.json"
  ".claude/correction-ledger.jsonl"
  ".claude/correction-heartbeat.jsonl"
  ".claude/correction-rollup.json"
)

usage() { sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

# One line per baseline file: sha256 (or "missing"), plus the stable link target.
snapshot() {
  local f
  for f in "${BASELINE_FILES[@]}"; do
    if [ -e "$REAL_HOME/$f" ]; then
      printf '%s  %s\n' "$(sha256sum "$REAL_HOME/$f" | cut -d' ' -f1)" "$f"
    else
      printf 'missing  %s\n' "$f"
    fi
  done
  printf '%s  %s\n' "$(readlink "$REAL_HOME/.claude/plugins/data/tk-llm-peer-review/current" 2>/dev/null || echo none)" ".claude/plugins/data/tk-llm-peer-review/current -> target"
  printf '%s  %s\n' "$(ls -1 "$REAL_HOME/.claude/plugins/data" 2>/dev/null | tr '\n' ',' )" ".claude/plugins/data entries"
}

resolve_bin() {
  if [ -n "${CLAUDE_BIN:-}" ]; then echo "$CLAUDE_BIN"; return; fi
  local bin
  bin=$(ls -d "$REAL_HOME"/.cursor-server/extensions/anthropic.claude-code-*/resources/native-binary/claude \
              "$REAL_HOME"/.vscode-server/extensions/anthropic.claude-code-*/resources/native-binary/claude \
        2>/dev/null | sort -V | tail -1 || true)
  if [ -z "$bin" ]; then
    bin=$(command -v claude || true)
  fi
  if [ -z "$bin" ]; then
    echo "headless-session: no claude binary found; set CLAUDE_BIN" >&2; exit 2
  fi
  echo "$bin"
}

MODE="default"; BUILD=""; PROJECT=""; SCRATCH=""
case "${1:-}" in
  --baseline) [ -n "${2:-}" ] || usage; snapshot > "$2"; echo "baseline written: $2"; exit 0 ;;
  --verify)
    [ -n "${2:-}" ] || usage
    if diff <(snapshot) "$2" > /dev/null; then echo "verify: real config unchanged"; exit 0; fi
    echo "verify: real config CHANGED since baseline:"; diff <(snapshot) "$2" || true; exit 1 ;;
  "" | -h | --help) usage ;;
esac

while [ $# -gt 0 ]; do
  case "$1" in
    --build) BUILD="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --home) SCRATCH="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --) shift; break ;;
    *) echo "headless-session: unknown argument $1" >&2; usage ;;
  esac
done
[ -n "$BUILD" ] && [ -n "$PROJECT" ] || usage
[ -f "$BUILD/.claude-plugin/plugin.json" ] || { echo "headless-session: $BUILD is not a plugin folder (no .claude-plugin/plugin.json)" >&2; exit 2; }
[ -d "$PROJECT" ] || { echo "headless-session: project folder $PROJECT does not exist" >&2; exit 2; }
BUILD=$(cd "$BUILD" && pwd)
PROJECT=$(cd "$PROJECT" && pwd)

BIN=$(resolve_bin)
if [ -z "$SCRATCH" ]; then SCRATCH=$(mktemp -d /tmp/tk-home.XXXXXX); fi
mkdir -p "$SCRATCH/.claude/plugins/data/tk-llm-peer-review" "$SCRATCH/tk-ledger"
ln -sfn "$REAL_HOME/.claude/.credentials.json" "$SCRATCH/.claude/.credentials.json"
ln -sfn "$BUILD" "$SCRATCH/.claude/plugins/data/tk-llm-peer-review/current"
if [ "${NEED_CLAUDE_JSON:-0}" = "1" ] && [ ! -e "$SCRATCH/.claude.json" ]; then
  cp "$REAL_HOME/.claude.json" "$SCRATCH/.claude.json"
fi

echo "headless-session: home=$SCRATCH build=$BUILD project=$PROJECT mode=$MODE bin=$BIN" >&2
cd "$PROJECT"
HOME="$SCRATCH" TK_LEDGER_DIR="$SCRATCH/tk-ledger" \
  "$BIN" -p --plugin-dir "$BUILD" --add-dir "$BUILD" --permission-mode "$MODE" \
  --settings '{"enabledPlugins":{"tk@llm-peer-review":false}}' "$@"
