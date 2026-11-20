#!/usr/bin/env bash
# Uninstall Teams Calm: restore Teams' original files (asks for your
# administrator password), relaunch plain Teams if it was running, and remove
# the `teams-calm` launcher. Leaves the project folder in place.
#
#   ./uninstall.sh            uninstall
#   ./uninstall.sh --purge    also delete node_modules and build output
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/teams-calm" uninstall "$@"
