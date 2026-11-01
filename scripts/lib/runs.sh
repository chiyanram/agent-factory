# Runs on this machine: the writer and reviewer sessions the coordinator starts (#39). Source it; do not run it.
#
#   FACTORY_CLAUDE     the claude binary (default: claude); a test points it at a stub
#   FACTORY_REPO       the local clone of the project; runs get worktrees in $FACTORY_REPO/.claude/worktrees/
#   FACTORY_MAX_RUNS   live runs allowed on this machine at once (default 2, playbook §Triggers)
#
# A run is a Claude session named writer-<mr> or reviewer-<mr>. A background run is live while `claude agents --json`
# lists it, so liveness never depends on poking a worker (ADR-0002). A foreground `claude -p` run is not listed there,
# so it holds a pid file in $FACTORY_REPO/.claude/runs/ while it lives.

# live_runs : the names of this machine's live runs, one per line. Fails when claude cannot say, so a caller never
# mistakes "unknown" for "none" and releases a claim that a run still holds.
live_runs() {
  sessions=$("${FACTORY_CLAUDE:-claude}" agents --json) \
    || { echo "cannot list live runs: claude agents --json failed" >&2; return 1; }
  names=$(printf '%s' "$sessions" | jq -r 'if type == "array" then .[] | .name // empty else error("not a list") end') \
    || { echo "cannot list live runs: claude agents --json did not print a list" >&2; return 1; }
  for pidfile in "$FACTORY_REPO"/.claude/runs/*.pid; do
    [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2> /dev/null && names="$names
$(basename "$pidfile" .pid)"
  done
  printf '%s\n' "$names" | grep -E '^(writer|reviewer)-[0-9]+$' || true
}

# require_repo : fails unless FACTORY_REPO is a git clone.
require_repo() {
  git -C "${FACTORY_REPO:-}" rev-parse --git-dir > /dev/null 2>&1 \
    || { echo "FACTORY_REPO must be a local clone of the project, got '${FACTORY_REPO:-}'" >&2; return 1; }
  FACTORY_REPO=$(cd "$FACTORY_REPO" && pwd)   # absolute, so git -C and cd read a run's path the same way
}

# worktree_path NAME : where the run NAME gets its worktree.
worktree_path() {
  printf '%s/.claude/worktrees/%s' "$FACTORY_REPO" "$1"
}

# remove_worktree PATH : removes a run's worktree and anything left in it.
remove_worktree() {
  git -C "$FACTORY_REPO" worktree remove --force "$1" > /dev/null 2>&1 || rm -rf "$1"
  git -C "$FACTORY_REPO" worktree prune
}
