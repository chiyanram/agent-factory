#!/usr/bin/env bash
# ask <mr> <sha> "<question>" — the writer's one way to reach the human (ADR-0011 D10): posts one
# "[writer] OPEN: <question>" note on the MR. poll counts it as an open ask until a human replies. <sha> is the head
# the writer started at; when the head has moved since, the question is refused, like a status note.
# Prints one line: "asked !12 at 1a2b3c4d".
set -u
. "$(dirname "$0")/lib/forge.sh"
iid=${1:-} sha=${2:-} question=${3:-}
valid_iid "$iid" || exit 1
printf '%s' "$sha" | grep -Eq '^[0-9a-f]{7,40}$' \
  || { echo "the run's head SHA must be at least 7 hex characters, got '$sha'" >&2; exit 1; }
case $question in
  '' | *"
"*) echo "a question is one line of text" >&2; exit 1 ;;
esac
forge_require_bot || exit 1

mr=$(forge_pr "$iid") || exit 1
head=$(printf '%s' "$mr" | jq -r .sha)
case $head in
  "$sha"*) ;;
  *) echo "$mark$iid head moved: the run started at $sha, the head is now ${head:0:8}; question not posted" >&2; exit 1 ;;
esac
forge_note "$iid" "[writer] OPEN: $question" || exit 1
echo "asked $mark$iid at ${head:0:8}"
