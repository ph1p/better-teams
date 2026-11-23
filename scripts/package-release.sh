#!/usr/bin/env bash
# Package the built overlay for a release: sets app/package.json to VERSION
# and writes release/better-teams.tar.gz, the file install.sh downloads.
# Run after `pnpm run build` in app/. Called by semantic-release (.releaserc.json).
#
#   scripts/package-release.sh 0.2.0
set -euo pipefail
VERSION="${1:?usage: package-release.sh VERSION}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node -e '
  const fs = require("fs"), f = "app/package.json";
  const p = JSON.parse(fs.readFileSync(f, "utf8"));
  p.version = process.argv[1];
  fs.writeFileSync(f, JSON.stringify(p, null, 2) + "\n");
' "$VERSION"

rm -rf release && mkdir -p release/pkg
node scripts/build-host-patch.ts app/dist/better-teams-app.js release/pkg/better-teams-host.js
cp better-teams LICENSE release/pkg/
chmod +x release/pkg/better-teams
printf '%s\n' "$VERSION" > release/pkg/VERSION
tar -czf release/better-teams.tar.gz -C release/pkg .
echo "packaged release/better-teams.tar.gz ($VERSION)"
