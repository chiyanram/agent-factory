#!/usr/bin/env bash
# tokens <mr> — the tokens one ticket spent, by phase, from the records kept per head (ADR-0011 D16; rulebook crq RT1).
#
# Reads $FACTORY_REPO/.claude/runs/<mr>/<head>/ (scripts/lib/tokens.sh). Writer sessions the reviewer has not yet
# copied, such as a fix after the last round, count as writer too. Reads no forge and runs no model.
#
# Prints one line: "tokens !12: writer N · find N · verify N · total N (H heads)".
set -u
. "$(dirname "$0")/lib/forge.sh"
. "$(dirname "$0")/lib/runs.sh"
. "$(dirname "$0")/lib/tokens.sh"
iid=${1:-}
valid_iid "$iid" || exit 1
require_repo || exit 1
dir="$FACTORY_REPO/.claude/runs/$iid"
heads=$(ls "$dir"/*/writer-*.jsonl "$dir"/*/reviewer-*.json 2> /dev/null | sed 's|/[^/]*$||' | sort -u | grep -c . || true)
kept=$(ls "$dir"/*/writer-*.jsonl 2> /dev/null | sed 's|.*/writer-||')
set --
for t in "$(writer_transcripts "$iid")"/*.jsonl; do
  [ -f "$t" ] || continue
  printf '%s\n' "$kept" | grep -qxF "$(basename "$t")" || set -- "$@" "$t"
done
writer=$(tokens_in "$dir"/*/writer-*.jsonl "$@")
find=$(tokens_in "$dir"/*/reviewer-find.json)
verify=$(tokens_in "$dir"/*/reviewer-verify-*.json)
echo "tokens $mark$iid: writer $writer · find $find · verify $verify · total $((writer + find + verify)) ($heads heads)"
