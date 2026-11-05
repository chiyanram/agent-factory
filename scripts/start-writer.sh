#!/usr/bin/env bash
# start-writer <mr> — starts a fresh writer for a claimed MR, in its own worktree at the MR's head (#39).
#
# Every run is fresh: it never resumes or continues a session, because a resumed worker drops instructions and its
# context rots (ADR-0001). The writer runs in the background as `claude --bg -n writer-<mr>`; FACTORY_RUN_MODE=print
# falls back to a foreground `claude -p` that removes its worktree when it exits. Refuses an MR that is not claimed or
# already has a live run, and refuses when this machine is at FACTORY_MAX_RUNS. Prints one line.
#
# The prompt only points at /crq: how to build lives in the project's /crq, not here (#39 Q2).
set -u
. "$(dirname "$0")/lib/forge.sh"
. "$(dirname "$0")/lib/runs.sh"
iid=${1:-}
label=${FACTORY_CLAIM_LABEL:-agent::claimed}
valid_iid "$iid" || exit 1
require_repo || exit 1
note=$(forge_writer_note) || exit 1

mr=$(forge_pr "$iid") || exit 1
state=$(printf '%s' "$mr" | jq -r .state)
[ "$state" = opened ] || { echo "$mark$iid is $state; a writer runs only on an open MR" >&2; exit 1; }
has_label "$mr" "$label" \
  || { echo "$mark$iid is not claimed; claim it first, so it gets one run at a time" >&2; exit 1; }
branch=$(printf '%s' "$mr" | jq -r .source_branch)
sha=$(printf '%s' "$mr" | jq -r .sha)

runs=$(live_runs) || exit 1
if printf '%s\n' "$runs" | grep -Eqx "(writer|reviewer)-$iid"; then
  echo "$mark$iid already has a live run: $(printf '%s\n' "$runs" | grep -Ex "(writer|reviewer)-$iid")" >&2
  exit 1
fi
count=$(printf '%s\n' "$runs" | grep -c . || true)
[ "$count" -lt "${FACTORY_MAX_RUNS:-2}" ] \
  || { echo "this machine is at its run limit: $count live runs (FACTORY_MAX_RUNS=${FACTORY_MAX_RUNS:-2})" >&2; exit 1; }

git -C "$FACTORY_REPO" fetch -q origin "+refs/heads/$branch:refs/remotes/origin/$branch" \
  || { echo "cannot fetch $branch" >&2; exit 1; }
tip=$(git -C "$FACTORY_REPO" rev-parse "origin/$branch")
[ "$tip" = "$sha" ] || { echo "$mark$iid: the tip of $branch is ${tip:0:8}, but the MR's head is ${sha:0:8}; not started" >&2; exit 1; }

name=writer-$iid
path=$(worktree_path "$name")
[ ! -e "$path" ] || remove_worktree "$path"   # left by a dead run: never reuse it
mkdir -p "$(dirname "$path")"
git -C "$FACTORY_REPO" worktree add -q --track -B "$branch" "$path" "origin/$branch" \
  || { echo "cannot make the worktree $path" >&2; exit 1; }

prompt="You are the writer for merge request $mark$iid in $FACTORY_PROJECT, on branch $branch at head $sha.
Run /crq from the build phase for this MR. The MR description is your contract: the intent, the acceptance criteria
and the design link. You never talk to the human. Push only this branch; after a rebase use --force-with-lease.${note:+
$note}"
set --
[ -z "${FACTORY_WRITER_MODEL:-}" ] || set -- --model "$FACTORY_WRITER_MODEL"

if [ "${FACTORY_RUN_MODE:-bg}" = print ]; then
  pidfile="$FACTORY_REPO/.claude/runs/$name.pid"
  mkdir -p "$(dirname "$pidfile")" && echo $$ > "$pidfile"   # a -p run is not in claude agents: this marks it live
  trap 'rm -f "$pidfile"; remove_worktree "$path"' EXIT
  (cd "$path" && "${FACTORY_CLAUDE:-claude}" -p -n "$name" "$@" "$prompt") >&2
  status=$?
  echo "writer finished $mark$iid at ${sha:0:8}"
  exit "$status"
fi

if ! started=$(cd "$path" && "${FACTORY_CLAUDE:-claude}" --bg -n "$name" "$@" "$prompt" 2>&1); then
  remove_worktree "$path"
  echo "the writer for $mark$iid did not start: $started" >&2
  exit 1
fi
echo "writer started $mark$iid at ${sha:0:8}: $(printf '%s\n' "$started" | head -n 1)"
