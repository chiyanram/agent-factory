#!/usr/bin/env bash
# scripts/start-writer.sh: a fresh writer per run, in its own worktree, never resumed (ADR-0001; #39).
. "$(dirname "$0")/lib.sh"
export FACTORY_PROJECT=aruvii/agent-platform FACTORY_SLEEP=true
mr() { printf '{"iid":12,"state":"opened","source_branch":"feat/x","sha":"%s","labels":%s}' "$1" "$2"; }

setup() {
  FACTORY_REPO=$(project_clone feat/x); export FACTORY_REPO
  head=$(cat "$(dirname "$FACTORY_REPO")/head")
  FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
  FACTORY_CLAUDE=$(claude_stub); export FACTORY_CLAUDE
  worktree="$FACTORY_REPO/.claude/worktrees/writer-12"
}
claude_calls() { cat "$(dirname "$FACTORY_CLAUDE")/calls.log" 2>/dev/null; }
bg_calls() { claude_calls | grep -v ' | agents '; }

setup
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
expect_eq "a claimed MR starts a writer and says so in one line" \
  "writer started !12 at ${head:0:8}: started abc123" "$("$REPO_ROOT/scripts/start-writer.sh" 12)"
expect_pass "the writer runs in its own worktree" sh -c "bg_out=\$(cat '$(dirname "$FACTORY_CLAUDE")/calls.log' | grep -v ' | agents '); case \$bg_out in *'.claude/worktrees/writer-12 | '*) exit 0;; *) exit 1;; esac"
expect_eq "the worktree is at the MR's head" "$head" "$(git -C "$worktree" rev-parse HEAD)"
expect_eq "the worktree is on the MR's branch, so the writer can push it" "feat/x" "$(git -C "$worktree" rev-parse --abbrev-ref HEAD)"
expect_pass "it starts in the background under the run's name" sh -c "grep -q -- '--bg -n writer-12' '$(dirname "$FACTORY_CLAUDE")/calls.log'"
expect_fail "it never resumes or continues a session (ADR-0001)" "fresh" \
  sh -c "grep -Eq -- '--resume|--continue| -c ' '$(dirname "$FACTORY_CLAUDE")/calls.log' && exit 0; echo fresh; exit 1"
expect_pass "the prompt names the MR, its branch and /crq" \
  sh -c "grep -q '!12' '$(dirname "$FACTORY_CLAUDE")/calls.log' && grep -q 'feat/x' '$(dirname "$FACTORY_CLAUDE")/calls.log' && grep -q '/crq' '$(dirname "$FACTORY_CLAUDE")/calls.log'"

setup
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '[]')"
expect_fail "an unclaimed MR is refused" "claim it first" "$REPO_ROOT/scripts/start-writer.sh" 12
expect_eq "a refused start makes no worktree" no "$([ -d "$worktree" ] && echo yes || echo no)"

setup
live "$FACTORY_CLAUDE" writer-12
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
expect_fail "an MR with a live run is refused: one run per MR" "already has a live run" \
  "$REPO_ROOT/scripts/start-writer.sh" 12
expect_eq "the refusal starts nothing" "" "$(bg_calls)"

setup
live "$FACTORY_CLAUDE" writer-3 reviewer-4
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
expect_fail "two live runs on this machine is the limit (playbook §Triggers)" "run limit" \
  "$REPO_ROOT/scripts/start-writer.sh" 12

setup
respond "$FACTORY_GLAB" 1 200 "$(mr 0123456789abcdef0123456789abcdef01234567 '["agent::claimed"]')"
expect_fail "a branch tip that differs from the MR's head is refused" "head" "$REPO_ROOT/scripts/start-writer.sh" 12
expect_eq "no worktree is left behind" no "$([ -d "$worktree" ] && echo yes || echo no)"

setup
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
echo 'Workspace not trusted. Run `claude` in /x once and accept the trust prompt, then retry.' \
  > "$(dirname "$FACTORY_CLAUDE")/bg.out"
echo 1 > "$(dirname "$FACTORY_CLAUDE")/bg.rc"
expect_fail "a run that fails to start says why" "not trusted" "$REPO_ROOT/scripts/start-writer.sh" 12
expect_eq "and its worktree is removed" no "$([ -d "$worktree" ] && echo yes || echo no)"

setup
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
mkdir -p "$worktree" && echo old > "$worktree/left-by-a-dead-run"
"$REPO_ROOT/scripts/start-writer.sh" 12 > /dev/null 2>&1
expect_eq "a worktree left by a dead run is replaced, never reused" no \
  "$([ -f "$worktree/left-by-a-dead-run" ] && echo yes || echo no)"

setup
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
expect_eq "the -p fallback runs in the foreground and says so" "writer finished !12 at ${head:0:8}" \
  "$(FACTORY_RUN_MODE=print "$REPO_ROOT/scripts/start-writer.sh" 12 2>/dev/null)"
expect_pass "the fallback uses claude -p" sh -c "grep -q -- ' -p ' '$(dirname "$FACTORY_CLAUDE")/calls.log'"
expect_eq "the fallback removes its worktree when it exits" no "$([ -d "$worktree" ] && echo yes || echo no)"

expect_fail "FACTORY_REPO must be a git clone" "FACTORY_REPO" env FACTORY_REPO=/nonexistent "$REPO_ROOT/scripts/start-writer.sh" 12

finish
