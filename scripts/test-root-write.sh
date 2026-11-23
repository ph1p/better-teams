#!/usr/bin/env bash
# Exercises better-teams' root_write against temp files (no root, no Teams).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
eval "$(sed -n '/^root_write() {/,/^}/p' "$ROOT/better-teams")"
MARK='/*better-teams:begin*/'
OLD_MARK='/*teams-calm:begin*/'
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

printf 'original teams bundle\n' > "$T/orig"
printf '\n%s\nconsole.log(1)\n' "$MARK" > "$T/p1"
printf '\n%s\nconsole.log(2)\n' "$MARK" > "$T/p2"
B="$T/backup"
BUNDLE="$T/bundle.js"

# Each call runs in a subshell so root_write's EXIT trap stays local.
# usage: rw <target> <mode> <stdin-file>; sets rc
rw() {
  rc=0
  ( root_write "$1" "$2" "$B" "$MARK" "$OLD_MARK" < "$3" ) || rc=$?
}
same() { cmp -s "$1" "$2" || fail "$3: bytes differ ($1 vs $2)"; }
want_rc() { [ "$rc" = "$1" ] || fail "$2: expected rc $1, got $rc"; }

# 1+2. First patch; inode kept
cp "$T/orig" "$BUNDLE"
ino_before="$(ls -i "$BUNDLE" | awk '{print $1}')"
rw "$BUNDLE" patch "$T/p1"
want_rc 0 "first patch"
cat "$T/orig" "$T/p1" > "$T/expect"
same "$BUNDLE" "$T/expect" "first patch"
same "$B/bundle.js.orig" "$T/orig" "backup copy"
(cd "$B" && shasum -a 256 -c bundle.js.orig.sha256 >/dev/null) || fail "backup sha256"
ino_after="$(ls -i "$BUNDLE" | awk '{print $1}')"
[ "$ino_before" = "$ino_after" ] || fail "inode changed"

# 3. Re-patch
cp "$B/bundle.js.orig" "$T/backup.before"
rw "$BUNDLE" patch "$T/p2"
want_rc 0 "re-patch"
cat "$T/orig" "$T/p2" > "$T/expect"
same "$BUNDLE" "$T/expect" "re-patch"
same "$B/bundle.js.orig" "$T/backup.before" "backup after re-patch"

# 4. Restore
rw "$BUNDLE" restore /dev/null
want_rc 0 "restore"
same "$BUNDLE" "$T/orig" "restore"
[ ! -e "$B" ] || fail "backup dir still exists after restore"

# 5. Restore when unpatched
rw "$BUNDLE" restore /dev/null
want_rc 0 "restore unpatched"
same "$BUNDLE" "$T/orig" "restore unpatched"

# 6. Payload without marker
printf 'hello' > "$T/nomark"
rw "$BUNDLE" patch "$T/nomark"
want_rc 2 "payload without marker"
same "$BUNDLE" "$T/orig" "payload without marker"
[ ! -e "$B" ] || fail "backup created for a rejected payload"

# 7. Tampered original
rw "$BUNDLE" patch "$T/p1"
want_rc 0 "patch before tamper"
printf 'X' | dd of="$BUNDLE" bs=1 count=1 conv=notrunc 2>/dev/null
cp "$BUNDLE" "$T/tampered"
rw "$BUNDLE" restore /dev/null
want_rc 3 "tampered original"
same "$BUNDLE" "$T/tampered" "tampered original"
rm -rf "$B"

# 8. Old marker, no backup
{ cat "$T/orig"; printf '\n%s\nold\n' "$OLD_MARK"; } > "$BUNDLE"
rw "$BUNDLE" patch "$T/p1"
want_rc 0 "old marker"
cat "$T/orig" "$T/p1" > "$T/expect"
same "$BUNDLE" "$T/expect" "old marker"
rm -rf "$B"

# 9. Symlink target
ln -s "$T/orig" "$T/link.js"
cp "$T/orig" "$T/orig.keep"
rw "$T/link.js" patch "$T/p1"
want_rc 2 "symlink target"
same "$T/orig" "$T/orig.keep" "symlink target"

# 10. Bad mode
rw "$BUNDLE" x /dev/null
want_rc 2 "bad mode"

echo "all root-write tests passed"
