#!/usr/bin/env bash
# reconcile — after a coordinator restart, puts claims and worktrees back in line with the live runs (#39).
#
# A claim label on an open MR with no live run is removed, so the MR goes back to the queue; a claim left on a merged
# MR is removed too. A run's worktree with no live run is removed (docs/archive/research/37: "restart must be a non-event").
# Prints one line per action, or "nothing to reconcile". Run it only when no claim is between `claim` and `start`.
set -u
. "$(dirname "$0")/lib/forge.sh"
. "$(dirname "$0")/lib/runs.sh"
label=${FACTORY_CLAIM_LABEL:-agent::claimed}
require_repo || exit 1
forge_require_bot || exit 1
runs=$(live_runs) || exit 1
live() { printf '%s\n' "$runs" | grep -Eqx "(writer|reviewer)-$1"; }

open=$(forge_claimed opened "$label") || exit 1
merged=$(forge_claimed merged "$label") || exit 1
release() {
  forge_label_remove "$1" "$label" || exit 1
  echo "released $mark$1 ($2)"
}

done=0
for iid in $open; do
  live "$iid" || { release "$iid" "no live run"; done=1; }
done
for iid in $merged; do
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
