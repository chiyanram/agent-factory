#!/usr/bin/env bash
# reconcile — after a coordinator restart, puts claims and worktrees back in line with the live runs (#39).
#
# A claim label on an open MR with no live run is removed, so the MR goes back to the queue; a claim left on a merged
# MR is removed too. A run's worktree with no live run is removed (docs/archive/research/37: "restart must be a non-event").
# Liveness is checked twice (ADR-0011 D14): an open MR keeps its claim, and its worktrees, while it changed (a push,
# a note or a label) in the last FACTORY_QUIET_MINUTES (default 30), even when `claude agents` does not list its run,
# so a run that list misses is never released under it.
# Prints one line per action, or "nothing to reconcile". Run it only when no claim is between `claim` and `start`.
set -u
set -o pipefail
. "$(dirname "$0")/lib/forge.sh"
. "$(dirname "$0")/lib/runs.sh"
label=${FACTORY_CLAIM_LABEL:-agent::claimed}
quiet=${FACTORY_QUIET_MINUTES:-30}
printf '%s' "$quiet" | grep -Eq '^[0-9]+$' \
  || { echo "FACTORY_QUIET_MINUTES must be a whole number of minutes, got '$quiet'" >&2; exit 1; }
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

# idle MR-ANSWER : whole minutes since the MR last changed, or nothing when the forge gave no time it can read
idle() {
  printf '%s' "$1" | jq -r '(.updated_at // empty) | sub("\\.[0-9]+"; "") | sub("\\+00:?00$"; "Z")
    | (now - fromdateiso8601) / 60 | floor' 2> /dev/null
}

done=0 kept=''
for iid in $open; do
  live "$iid" && continue
  mr=$(forge_pr "$iid") || exit 1
  minutes=$(idle "$mr")
  if [ -z "$minutes" ]; then
    echo "kept $mark$iid (no live run, but the forge gave no time it last changed)"; kept="$kept $iid"; done=1
  elif [ "$minutes" -lt "$quiet" ]; then
    echo "kept $mark$iid (no live run, but it changed $minutes min ago; quiet after $quiet)"; kept="$kept $iid"; done=1
  else
    release "$iid" "no live run, quiet for $minutes min"; done=1
  fi
done
for iid in $merged; do
  release "$iid" merged; done=1
done
for path in "$FACTORY_REPO"/.claude/worktrees/*; do
  [ -d "$path" ] || continue
  name=$(basename "$path")
  case $name in writer-[0-9]* | reviewer-[0-9]*) ;; *) continue ;; esac
  printf '%s\n' "$runs" | grep -qx "$name" && continue
  case " $kept " in *" ${name#*-} "*) continue ;; esac   # its MR is still changing: the run may be alive
  remove_worktree "$path"
  echo "removed worktree $name (no live run)"; done=1
done
[ "$done" = 1 ] || echo "nothing to reconcile"
