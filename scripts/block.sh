#!/usr/bin/env bash
# block <mr> "<reason>" [<log>] — marks a run that failed, hit a cap or went silent (ADR-0011 D14): adds the
# needs-human label, posts one "[coordinator] blocked: <reason>" note naming the log, then releases the claim, so
# the human sees why the MR stopped and poll (needs_human=yes) does not hand it out again. Removing the label sends it
# back to the queue. needs-human, not a new label, because every trigger already stops on it.
# Prints one line: "blocked !12".
set -u
set -o pipefail
. "$(dirname "$0")/lib/forge.sh"
iid=${1:-} reason=${2:-} log=${3:-}
label=${FACTORY_CLAIM_LABEL:-agent::claimed}
valid_iid "$iid" || exit 1
case $reason$log in
  *"
"*) echo "the reason and the log path are one line each" >&2; exit 1 ;;
esac
[ -n "$reason" ] || { echo "say why the MR is blocked" >&2; exit 1; }
forge_require_bot || exit 1

mr=$(forge_pr "$iid") || exit 1
# the label goes first: a note without it would leave the MR in the queue
forge_label_add "$iid" needs-human || exit 1
forge_note "$iid" "[coordinator] blocked: $reason${log:+ · log: $log}" || exit 1
! has_label "$mr" "$label" || forge_label_remove "$iid" "$label" || exit 1
echo "blocked $mark$iid$dry"
