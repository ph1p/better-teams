#!/usr/bin/env bash
# Uninstall Better Teams from a source checkout: restore Teams' original files
# (asks for your administrator password) and relaunch plain Teams if it was
# running. Leaves the project folder in place. A release install uninstalls
# with: ~/.better-teams/better-teams uninstall
#
#   ./uninstall.sh            uninstall
#   ./uninstall.sh --purge    also delete node_modules and build output
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/better-teams" uninstall "$@"
