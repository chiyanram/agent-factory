#!/usr/bin/env bash
# scripts/reconcile.sh: a claim with no live run goes back to the queue; a worktree with no live run is removed.
. "$(dirname "$0")/lib.sh"
export FACTORY_PROJECT=aruvii/agent-platform FACTORY_SLEEP=true
bot='{"username":"agent-coordinator","bot":true}'

setup() {
  FACTORY_REPO=$(project_clone feat/x); export FACTORY_REPO
  FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
  FACTORY_CLAUDE=$(claude_stub); export FACTORY_CLAUDE
}
worktree() { git -C "$FACTORY_REPO" worktree add -q --detach "$FACTORY_REPO/.claude/worktrees/$1" 2>/dev/null; }

setup
live "$FACTORY_CLAUDE" writer-13
worktree writer-12; worktree reviewer-7; worktree writer-13
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 '[{"iid":12},{"iid":13}]'
respond "$FACTORY_GLAB" 3 200 '[{"iid":9}]'
respond "$FACTORY_GLAB" 4 200 '{"iid":12,"labels":[]}'
respond "$FACTORY_GLAB" 5 200 '{"iid":9,"labels":[]}'
out=$("$REPO_ROOT/scripts/reconcile.sh")
expect_eq "each action is one line" "released !12 (no live run)
released !9 (merged)
removed worktree reviewer-7 (no live run)
removed worktree writer-12 (no live run)" "$out"
expect_pass "a live run keeps its claim" sh -c "! grep -q 'merge_requests/13 ' '$(dirname "$FACTORY_GLAB")/calls.log'"
expect_eq "a live run keeps its worktree" yes "$([ -d "$FACTORY_REPO/.claude/worktrees/writer-13" ] && echo yes || echo no)"
expect_eq "git forgets the removed worktrees" 2 "$(git -C "$FACTORY_REPO" worktree list | wc -l | tr -d ' ')"
expect_pass "claimed MRs are read with one call per state, by label" \
  grep -q 'merge_requests?state=opened&labels=agent%3A%3Aclaimed' "$(dirname "$FACTORY_GLAB")/calls.log"

setup
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 '[]'
respond "$FACTORY_GLAB" 3 200 '[]'
expect_eq "nothing to do says so" "nothing to reconcile" "$("$REPO_ROOT/scripts/reconcile.sh")"

setup
respond "$FACTORY_GLAB" 1 200 '{"username":"ann","bot":false}'
expect_fail "a human login is refused before any write (ADR-0006)" "a human account" "$REPO_ROOT/scripts/reconcile.sh"

finish
