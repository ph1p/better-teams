#!/usr/bin/env bash
# Uninstall Teams Calm: restore Teams' original files, relaunch plain Teams and
# remove the launcher from PATH. Leaves the project folder untouched.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

"$DIR/teams-calm" off

BIN="$HOME/.local/bin/teams-calm"
if [ -L "$BIN" ] || [ -f "$BIN" ]; then rm -f "$BIN"; echo "Removed $BIN"; fi
