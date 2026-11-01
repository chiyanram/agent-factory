#!/usr/bin/env bash
# release <mr> — removes the claim label, from an open or a merged MR (playbook §Triggers). Releasing an MR that
# carries no claim is not an error. Prints one line: "released !12" or "!12 was not claimed".
set -u
. "$(dirname "$0")/lib/gitlab.sh"
iid=${1:-}
label=${FACTORY_CLAIM_LABEL:-agent::claimed}
valid_iid "$iid" || exit 1
require_bot || exit 1

mr=$(mr_get "$iid") || exit 1
if [ "$(printf '%s' "$mr" | jq --arg l "$label" '.labels | index($l) != null')" != true ]; then
  echo "!$iid was not claimed"
  exit 0
fi
gl_api "projects/$(project_ref)/merge_requests/$iid" -X PUT -f remove_labels="$label" > /dev/null || exit 1
echo "released !$iid"
