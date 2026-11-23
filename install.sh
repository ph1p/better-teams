#!/usr/bin/env bash
# Install Better Teams: check requirements, install dependencies, put the
# `better-teams` launcher on PATH, then build, patch Teams (asks for your
# administrator password) and relaunch it with the overlay.
#
#   ./install.sh               install and start
#   ./install.sh --no-start    install only; run `better-teams` later
#
# Safe to re-run (e.g. after `git pull` or a Teams update).
# Uninstall with ./uninstall.sh

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
BIN="$HOME/.local/bin"
LINK="$BIN/better-teams"
NODE_MIN=20

start=1
for a in "$@"; do
  case "$a" in
    --no-start|--no-launch) start=0 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "error: unknown option: $a" >&2; exit 1 ;;
  esac
done

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] || die "Better Teams runs on macOS only."
[ -d "/Applications/Microsoft Teams.app" ] || die "new Microsoft Teams not found in /Applications."
command -v node >/dev/null 2>&1 || die "Node.js $NODE_MIN+ is required (https://nodejs.org or 'brew install node')."
command -v pnpm >/dev/null 2>&1 || die "pnpm is required ('corepack enable pnpm' or 'brew install pnpm')."
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge "$NODE_MIN" ] || die "Node.js $NODE_MIN+ is required, found $(node --version)."
[ "$major" -ge 22 ] || echo "note: 'better-teams dev' needs Node 22+; everything else works."

echo "Installing overlay dependencies..."
( cd "$DIR/app" && pnpm install --frozen-lockfile --reporter=silent )

mkdir -p "$BIN"
if [ -e "$LINK" ] && [ ! -L "$LINK" ]; then
  die "$LINK exists and is not a symlink; move it away and re-run."
fi
ln -sfn "$DIR/better-teams" "$LINK"
# Drop the launcher of the pre-rename name (teams-calm) if it points here.
OLD_LINK="$BIN/teams-calm"
if [ -L "$OLD_LINK" ] && [ "$(readlink "$OLD_LINK")" = "$DIR/teams-calm" ]; then rm -f "$OLD_LINK"; fi
echo "Launcher: $LINK -> $DIR/better-teams"

case ":$PATH:" in
  *":$BIN:"*) ;;
  *)
    case "${SHELL##*/}" in
      zsh)  rc="~/.zshrc" ;;
      bash) rc="~/.bash_profile" ;;
      fish) rc="" ;;
      *)    rc="your shell profile" ;;
    esac
    if [ "${SHELL##*/}" = fish ]; then
      echo "NOTE: $BIN is not on PATH. Run:  fish_add_path ~/.local/bin"
    else
      echo "NOTE: $BIN is not on PATH. Add this line to $rc:"
      echo "        export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi
    ;;
esac

if [ "$start" = 1 ]; then
  "$DIR/better-teams" start
else
  echo "Installed. Run 'better-teams' to patch and start Teams."
fi
