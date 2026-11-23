#!/usr/bin/env bash
# Install Better Teams, patch Teams (asks for your administrator password once)
# and relaunch it with the overlay. Nothing is added to PATH.
#
#   curl -fsSL https://github.com/ph1p/better-teams/releases/latest/download/install.sh | bash
#
# Downloads the latest prebuilt release into ~/.better-teams; no Node, pnpm or
# git needed. Re-run the same line to update, or after a Teams update removed
# the patch. Run from a source checkout (./install.sh) it builds from source.
#
# Options (after `bash -s --` when piped):
#   --no-start    install only; start later with ~/.better-teams/better-teams
#   --uninstall   restore Teams and delete ~/.better-teams
#
# Environment: BETTER_TEAMS_VERSION=v0.2.0 installs that release instead of
# the latest; BETTER_TEAMS_HOME changes the install folder.

set -euo pipefail

REPO="ph1p/better-teams"
HOME_DIR="${BETTER_TEAMS_HOME:-$HOME/.better-teams}"
VERSION_TAG="${BETTER_TEAMS_VERSION:-}"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

start=1
uninstall=0
for a in "$@"; do
  case "$a" in
    --no-start | --no-launch) start=0 ;;
    --uninstall) uninstall=1 ;;
    -h | --help) say "Install: curl -fsSL https://github.com/$REPO/releases/latest/download/install.sh | bash"; say "Options: --no-start, --uninstall"; exit 0 ;;
    *) die "unknown option: $a" ;;
  esac
done

[ "$(uname -s)" = Darwin ] || die "Better Teams runs on macOS only."

# Source checkout: this file sits next to app/. Piped through curl there is no
# file, so BASH_SOURCE is empty and the release path below runs.
src="${BASH_SOURCE[0]:-}"
if [ -n "$src" ] && [ -f "$src" ]; then
  SRC_DIR="$(cd "$(dirname "$src")" && pwd)"
  if [ -f "$SRC_DIR/app/package.json" ]; then
    if [ "$uninstall" = 1 ]; then exec "$SRC_DIR/better-teams" uninstall; fi
    if [ "$start" = 1 ]; then exec "$SRC_DIR/better-teams" start; fi
    exec "$SRC_DIR/better-teams" build
  fi
fi

if [ "$uninstall" = 1 ]; then
  [ -x "$HOME_DIR/better-teams" ] || die "Better Teams is not installed in $HOME_DIR."
  exec "$HOME_DIR/better-teams" uninstall
fi

[ -d "/Applications/Microsoft Teams.app" ] ||
  die "the new Microsoft Teams was not found in /Applications. Install it first: https://www.microsoft.com/microsoft-teams/download-app"

if [ -n "${BETTER_TEAMS_URL:-}" ]; then url="$BETTER_TEAMS_URL" # testing: a local file:// tarball
elif [ -n "$VERSION_TAG" ]; then url="https://github.com/$REPO/releases/download/$VERSION_TAG/better-teams.tar.gz"
else url="https://github.com/$REPO/releases/latest/download/better-teams.tar.gz"; fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
say "Downloading Better Teams${VERSION_TAG:+ $VERSION_TAG}..."
curl -fsSL "$url" -o "$tmp/better-teams.tar.gz" || die "download failed: $url"
mkdir "$tmp/pkg"
tar -xzf "$tmp/better-teams.tar.gz" -C "$tmp/pkg"
for f in better-teams better-teams-host.js VERSION; do
  [ -f "$tmp/pkg/$f" ] || die "the download is incomplete ($f missing); try again later."
done

# Replace the previous install as a whole, so no stale file survives. Only a
# folder that is empty or holds an earlier install is ever deleted.
if [ -e "$HOME_DIR" ] && [ -n "$(ls -A "$HOME_DIR" 2>/dev/null)" ] && [ ! -f "$HOME_DIR/better-teams-host.js" ]; then
  die "$HOME_DIR exists and is not a Better Teams install; move it away or set BETTER_TEAMS_HOME."
fi
mkdir -p "$(dirname "$HOME_DIR")"
rm -rf "$HOME_DIR"
mv "$tmp/pkg" "$HOME_DIR"
chmod +x "$HOME_DIR/better-teams"
say "Installed Better Teams $(cat "$HOME_DIR/VERSION") in $HOME_DIR"

if [ "$start" = 1 ]; then
  "$HOME_DIR/better-teams" start
else
  say "Start it with: ${HOME_DIR/#$HOME/~}/better-teams"
fi
