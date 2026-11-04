#!/usr/bin/env bash
# status <mr> <sha> "<line>" — posts one "[coordinator] <line>" note on the MR (playbook §Scripts; ADR-0006 seat).
# <sha> is the head the run started at. When the MR's head has moved since, the note is refused: a note about an
# old head once went out in public (docs/archive/research/46 G7: !303). Prints one line: "posted !12 at 1a2b3c4d".
set -u
. "$(dirname "$0")/lib/gitlab.sh"
iid=${1:-} sha=${2:-} line=${3:-}
valid_iid "$iid" || exit 1
printf '%s' "$sha" | grep -Eq '^[0-9a-f]{7,40}$' \
  || { echo "the run's head SHA must be at least 7 hex characters, got '$sha'" >&2; exit 1; }
case $line in
  '' | *"
"*) echo "a status note is one line of text" >&2; exit 1 ;;
esac
require_bot || exit 1

mr=$(mr_get "$iid") || exit 1
head=$(printf '%s' "$mr" | jq -r .sha)
case $head in
  "$sha"*) ;;
  *) echo "!$iid head moved: the run started at $sha, the head is now ${head:0:8}; note not posted" >&2; exit 1 ;;
esac
gl_api "projects/$(project_ref)/merge_requests/$iid/notes" -X POST -f body="[coordinator] $line" > /dev/null || exit 1
echo "posted !$iid at ${head:0:8}"
