#!/usr/bin/env bash
# claim <mr> — adds the claim label, so the MR gets one run at a time (playbook §Triggers; ADR-0002; docs/archive/research/37 P1).
# Refuses an MR that is already claimed or not open. Prints one line: "claimed !12".
set -u
set -o pipefail
. "$(dirname "$0")/lib/forge.sh"
iid=${1:-}
label=${FACTORY_CLAIM_LABEL:-agent::claimed}
valid_iid "$iid" || exit 1
forge_require_bot || exit 1

mr=$(forge_pr "$iid") || exit 1
state=$(printf '%s' "$mr" | jq -r .state)
[ "$state" = opened ] || { echo "$mark$iid is $state; only an open MR is claimed" >&2; exit 1; }
if has_label "$mr" "$label"; then
  echo "$mark$iid is already claimed ($label)" >&2
  exit 1
fi

forge_label_add "$iid" "$label" || exit 1
echo "claimed $mark$iid$dry"
