#!/usr/bin/env bash
# Install Teams Calm: dependencies, `teams-calm` launcher on PATH, then build,
# patch Teams (asks for sudo) and relaunch it with the overlay.
# Uninstall with ./uninstall.sh

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
BIN="$HOME/.local/bin"

command -v node >/dev/null 2>&1 || { echo "error: Node is required but not found on PATH." >&2; exit 1; }
[ -d "/Applications/Microsoft Teams.app" ] || { echo "error: new Microsoft Teams not found in /Applications." >&2; exit 1; }

echo "Installing overlay dependencies..."
( cd "$DIR/app" && npm install --silent )

mkdir -p "$BIN"
ln -sf "$DIR/teams-calm" "$BIN/teams-calm"
echo "Launcher: $BIN/teams-calm -> $DIR/teams-calm"
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo "NOTE: add $BIN to your PATH:  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac

"$DIR/teams-calm"
