#!/usr/bin/env bash
# STAGE-033-002: Refresh the epic-033 test fixture from current Bills-Node-Server/data/.
# Excludes backup/, monteCarlo/, and simulations/ subtrees (see STAGE-033-002 spec for rationale).
#
# Usage: from repo root:
#   ./Bills-Node-Server/scripts/refresh-epic-033-fixture.sh
#
# Review mechanism: run `git diff test/fixtures/epic-033-data/` after refresh.

set -euo pipefail

# Resolve script dir so it works from any cwd
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SERVER_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
SRC="$SERVER_DIR/data"
DST="$SERVER_DIR/test/fixtures/epic-033-data"

if [[ ! -d "$SRC" ]]; then
  echo "ERROR: source directory not found: $SRC" >&2
  exit 1
fi

echo "About to overwrite fixture:"
echo "  $DST"
echo "Source:"
echo "  $SRC"
echo "Excluded subtrees: backup/ monteCarlo/ simulations/"
echo ""
read -r -p "Continue? [y/N] " response
case "$response" in
  [yY][eE][sS]|[yY])
    ;;
  *)
    echo "Aborted." >&2
    exit 1
    ;;
esac

rm -rf "$DST"
mkdir -p "$DST"

rsync -a \
  --exclude='backup/' \
  --exclude='monteCarlo/' \
  --exclude='simulations/' \
  "$SRC/" \
  "$DST/"

echo ""
echo "Fixture refreshed. git status:"
git -C "$SERVER_DIR" status "$DST" || true
