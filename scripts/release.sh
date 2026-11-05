#!/usr/bin/env bash
# release <mr> — removes the claim label, from an open or a merged MR (playbook §Triggers). Releasing an MR that
# carries no claim is not an error. Prints one line: "released !12" or "!12 was not claimed".
set -u
set -o pipefail
. "$(dirname "$0")/lib/forge.sh"
iid=${1:-}
label=${FACTORY_CLAIM_LABEL:-agent::claimed}
valid_iid "$iid" || exit 1
forge_require_bot || exit 1

mr=$(forge_pr "$iid") || exit 1
if ! has_label "$mr" "$label"; then
  echo "$mark$iid was not claimed"
  exit 0
fi
forge_label_remove "$iid" "$label" || exit 1
echo "released $mark$iid"
