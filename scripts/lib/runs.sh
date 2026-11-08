# Runs on this machine: the writer and reviewer sessions the coordinator starts (#39). Source it; do not run it.
#
#   FACTORY_CLAUDE     the claude binary (default: claude); a test points it at a stub
#   FACTORY_REPO       the local clone of the project; runs get worktrees in $FACTORY_REPO/.claude/worktrees/
#   FACTORY_MAX_RUNS   live runs allowed on this machine at once (default 2, playbook §Triggers)
#
# A run is a Claude session named writer-<mr> or reviewer-<mr>. A background run is live while `claude agents --json`
# lists it, so liveness never depends on poking a worker (ADR-0002). A foreground `claude -p` run is not listed there,
# so it holds a pid file in $FACTORY_REPO/.claude/runs/ while it lives.

. "$(dirname "${BASH_SOURCE[0]}")/git.sh"

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
  hgit -C "${FACTORY_REPO:-}" rev-parse --git-dir > /dev/null 2>&1 \
    || { echo "FACTORY_REPO must be a local clone of the project, got '${FACTORY_REPO:-}'" >&2; return 1; }
  FACTORY_REPO=$(cd "$FACTORY_REPO" && pwd)   # absolute, so hgit -C and cd read a run's path the same way
}

# writer_settings DIR JSON : merges JSON into the run's .claude/settings.local.json in the worktree DIR. The file is
# excluded from git, so it is never committed; a project that tracks it is refused, since the run would overwrite it.
writer_settings() {
  hgit -C "$1" ls-files --error-unmatch .claude/settings.local.json > /dev/null 2>&1 \
    && { echo "refused: the project tracks .claude/settings.local.json, which the writer's settings would overwrite" >&2; return 1; }
  ws_file="$1/.claude/settings.local.json"
  mkdir -p "$1/.claude" || return 1
  [ -f "$ws_file" ] || echo '{}' > "$ws_file"
  jq --argjson add "$2" '. * $add' "$ws_file" > "$ws_file.new" && mv "$ws_file.new" "$ws_file" || return 1
  ws_exclude="$(hgit -C "$FACTORY_REPO" rev-parse --absolute-git-dir)/info/exclude"
  mkdir -p "$(dirname "$ws_exclude")"
  grep -qxF /.claude/settings.local.json "$ws_exclude" 2> /dev/null || echo /.claude/settings.local.json >> "$ws_exclude"
}

# worktree_path NAME : where the run NAME gets its worktree.
worktree_path() {
  printf '%s/.claude/worktrees/%s' "$FACTORY_REPO" "$1"
}

# remove_worktree PATH : removes a run's worktree and anything left in it.
# unlanded_in PATH : why a dead run's worktree must not be removed, or nothing when it holds nothing to land: git never
# climbs out of the worktrees folder, so a folder that is not a worktree is never read as the clone above it (#189)
unlanded_in() {
  ul_top=$(export GIT_CEILING_DIRECTORIES="$(dirname "$1")"; hgit -C "$1" rev-parse --show-toplevel 2> /dev/null) || ul_top=''
  if [ -z "$ul_top" ] || [ "$ul_top" != "$(cd "$1" && pwd -P)" ]; then
    echo "is not a worktree git can check"
    return 0
  fi
  ul_files=$(export GIT_CEILING_DIRECTORIES="$(dirname "$1")"; hgit -C "$1" status --porcelain --untracked-files=all) \
    || { echo "cannot be checked"; return 0; }
  [ -z "$ul_files" ] || { echo "holds uncommitted files"; return 0; }
  ul_commits=$(export GIT_CEILING_DIRECTORIES="$(dirname "$1")"; hgit -C "$1" rev-list HEAD --not --remotes) \
    || { echo "cannot be checked"; return 0; }
  [ -z "$ul_commits" ] || echo "holds commits that no remote branch has"
}

remove_worktree() {
  hgit -C "$FACTORY_REPO" worktree remove --force "$1" > /dev/null 2>&1 || rm -rf "$1"
  hgit -C "$FACTORY_REPO" worktree prune
}
