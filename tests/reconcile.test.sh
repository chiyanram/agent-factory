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
ago() { jq -nr --argjson m "$1" '(now - $m * 60) | todate'; }   # an ISO time M minutes ago
mr_at() { printf '{"iid":%s,"state":"opened","labels":["agent::claimed"],"updated_at":"%s"}' "$1" "$2"; }

setup
live "$FACTORY_CLAUDE" writer-13
worktree writer-12; worktree reviewer-7; worktree writer-13
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 '[{"iid":12},{"iid":13}]'
respond "$FACTORY_GLAB" 3 200 '[{"iid":9}]'
respond "$FACTORY_GLAB" 4 200 "$(mr_at 12 "$(ago 90)")"
respond "$FACTORY_GLAB" 5 200 '{"iid":12,"labels":[]}'
respond "$FACTORY_GLAB" 6 200 '{"iid":9,"labels":[]}'
out=$("$REPO_ROOT/scripts/reconcile.sh")
expect_eq "each action is one line" "released !12 (no live run, quiet for 90 min)
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
echo '{"error":"not a list"}' > "$(dirname "$FACTORY_CLAUDE")/agents.json"
respond "$FACTORY_GLAB" 1 200 "$bot"
expect_fail "unreadable claude agents output releases nothing" "cannot list live runs" "$REPO_ROOT/scripts/reconcile.sh"
expect_eq "no GitLab write happened" 1 "$(calls "$FACTORY_GLAB" | wc -l | tr -d ' ')"

setup
mkdir -p "$FACTORY_REPO/.claude/runs" && echo $$ > "$FACTORY_REPO/.claude/runs/writer-12.pid"
worktree writer-12
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 '[{"iid":12}]'
respond "$FACTORY_GLAB" 3 200 '[]'
expect_eq "a live -p run keeps its claim and worktree" "nothing to reconcile" "$("$REPO_ROOT/scripts/reconcile.sh")"

# Liveness is checked twice: a run claude agents misses keeps its claim while its MR still changes (ADR-0011 D14)
setup
worktree writer-12
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 '[{"iid":12}]'
respond "$FACTORY_GLAB" 3 200 '[]'
respond "$FACTORY_GLAB" 4 200 "$(mr_at 12 "$(ago 5)")"
expect_eq "an MR that changed within FACTORY_QUIET_MINUTES keeps its claim" \
  "kept !12 (no live run, but it changed 5 min ago; quiet after 30)" "$("$REPO_ROOT/scripts/reconcile.sh")"
expect_eq "and its worktree, since its run may be alive" yes "$([ -d "$FACTORY_REPO/.claude/worktrees/writer-12" ] && echo yes || echo no)"
expect_eq "nothing was written" 4 "$(calls "$FACTORY_GLAB" | wc -l | tr -d ' ')"

setup
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 '[{"iid":12}]'
respond "$FACTORY_GLAB" 3 200 '[]'
respond "$FACTORY_GLAB" 4 200 "$(mr_at 12 "$(ago 5)")"
respond "$FACTORY_GLAB" 5 200 '{"iid":12,"labels":[]}'
expect_eq "the quiet time is a setting" "released !12 (no live run, quiet for 5 min)" \
  "$(FACTORY_QUIET_MINUTES=5 "$REPO_ROOT/scripts/reconcile.sh")"

setup
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 '[{"iid":12}]'
respond "$FACTORY_GLAB" 3 200 '[]'
respond "$FACTORY_GLAB" 4 200 '{"iid":12,"state":"opened","labels":["agent::claimed"],"updated_at":"yesterday"}'
expect_eq "a time it cannot read keeps the claim: release only what is known to be quiet" \
  "kept !12 (no live run, but the forge gave no time it last changed)" "$("$REPO_ROOT/scripts/reconcile.sh")"

setup
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 '[{"iid":12}]'
respond "$FACTORY_GLAB" 3 200 '[]'
respond "$FACTORY_GLAB" 4 500 '{"message":"boom"}'
expect_fail "an MR it cannot read releases nothing" "HTTP 500" "$REPO_ROOT/scripts/reconcile.sh"
expect_fail "a quiet time that is not a number is refused" "whole number of minutes" \
  env FACTORY_QUIET_MINUTES=soon "$REPO_ROOT/scripts/reconcile.sh"

setup
respond "$FACTORY_GLAB" 1 200 '{"username":"ann","bot":false}'
expect_fail "a human login is refused before any write (ADR-0006)" "a human account" "$REPO_ROOT/scripts/reconcile.sh"

finish
