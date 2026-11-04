#!/usr/bin/env bash
# claim <mr> — adds the claim label, so the MR gets one run at a time (playbook §Triggers; ADR-0002; docs/archive/research/37 P1).
# Refuses an MR that is already claimed or not open. Prints one line: "claimed !12".
set -u
. "$(dirname "$0")/lib/gitlab.sh"
iid=${1:-}
label=${FACTORY_CLAIM_LABEL:-agent::claimed}
valid_iid "$iid" || exit 1
require_bot || exit 1

mr=$(mr_get "$iid") || exit 1
state=$(printf '%s' "$mr" | jq -r .state)
[ "$state" = opened ] || { echo "!$iid is $state; only an open MR is claimed" >&2; exit 1; }
if [ "$(printf '%s' "$mr" | jq --arg l "$label" '.labels | index($l) != null')" = true ]; then
  echo "!$iid is already claimed ($label)" >&2
  exit 1
fi

after=$(gl_api "projects/$(project_ref)/merge_requests/$iid" -X PUT -f add_labels="$label") || exit 1
[ "$(printf '%s' "$after" | jq --arg l "$label" '.labels | index($l) != null')" = true ] \
  || { echo "!$iid: GitLab did not keep the label $label" >&2; exit 1; }
echo "claimed !$iid"
