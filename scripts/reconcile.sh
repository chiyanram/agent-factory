#!/usr/bin/env bash
# reconcile — after a coordinator restart, puts claims and worktrees back in line with the live runs (#39).
#
# A claim label on an open MR with no live run is removed, so the MR goes back to the queue; a claim left on a merged
# MR is removed too. A run's worktree with no live run is removed (docs/archive/research/37: "restart must be a non-event").
# Prints one line per action, or "nothing to reconcile". Run it only when no claim is between `claim` and `start`.
set -u
. "$(dirname "$0")/lib/gitlab.sh"
. "$(dirname "$0")/lib/runs.sh"
label=${FACTORY_CLAIM_LABEL:-agent::claimed}
require_repo || exit 1
require_bot || exit 1
runs=$(live_runs) || exit 1
live() { printf '%s\n' "$runs" | grep -Eqx "(writer|reviewer)-$1"; }

ref=$(project_ref) || exit 1
by_label=$(printf '%s' "$label" | jq -sRr @uri)
open=$(gl_api "projects/$ref/merge_requests?state=opened&labels=$by_label&per_page=100") || exit 1
merged=$(gl_api "projects/$ref/merge_requests?state=merged&labels=$by_label&per_page=100") || exit 1
release() {
  gl_api "projects/$ref/merge_requests/$1" -X PUT -f remove_labels="$label" > /dev/null || exit 1
  echo "released !$1 ($2)"
}

done=0
for iid in $(printf '%s' "$open" | jq -r '.[].iid'); do
  live "$iid" || { release "$iid" "no live run"; done=1; }
done
for iid in $(printf '%s' "$merged" | jq -r '.[].iid'); do
  release "$iid" merged; done=1
done
for path in "$FACTORY_REPO"/.claude/worktrees/*; do
  [ -d "$path" ] || continue
  name=$(basename "$path")
  case $name in writer-[0-9]* | reviewer-[0-9]*) ;; *) continue ;; esac
  printf '%s\n' "$runs" | grep -qx "$name" && continue
  remove_worktree "$path"
  echo "removed worktree $name (no live run)"; done=1
done
[ "$done" = 1 ] || echo "nothing to reconcile"
