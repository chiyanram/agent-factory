#!/usr/bin/env bash
# Usage: scripts/check-size.sh [ROOT]
# Fails when ROOT/AGENTS.md has 200 lines or more.
# The limit is ADR-0003's: "AGENTS.md (root, <200 lines" (docs/adr/0003-rulebook-layout-across-tools.md:14).
set -eu

root=${1:-.}
limit=200
file="$root/AGENTS.md"

[ -f "$file" ] || exit 0
lines=$(awk 'END { print NR }' "$file")
if [ "$lines" -ge "$limit" ]; then
  echo "too long: AGENTS.md: $lines lines; ADR-0003 allows fewer than $limit"
  exit 1
fi
