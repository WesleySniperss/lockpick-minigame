#!/usr/bin/env bash
# Regenerates lock-preview.html from the real module sources.
# The preview inlines LockController.mjs + LockRenderer.mjs with the module
# syntax stripped, so it opens straight from disk (file://) with no server —
# ES module imports are blocked over file://, plain scripts are not.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=demos/lock-preview.html
HEAD=demos/_preview-head.html
TAIL=demos/_preview-tail.html
[ -f "$HEAD" ] && [ -f "$TAIL" ] || { echo "missing $HEAD / $TAIL"; exit 1; }
cat "$HEAD" > "$OUT"
sed -e 's/^export //' scripts/LockController.mjs >> "$OUT"
echo '' >> "$OUT"
sed -e "/^import .*LockController\.mjs';$/d" -e 's/^export //' scripts/LockRenderer.mjs >> "$OUT"
cat "$TAIL" >> "$OUT"
echo "rebuilt $OUT ($(wc -c < "$OUT") bytes)"
