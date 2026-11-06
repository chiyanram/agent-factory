#!/usr/bin/env bash
# scripts/block.sh: a failed, capped or silent run leaves a visible reason (ADR-0011 D14).
. "$(dirname "$0")/lib.sh"
export FACTORY_PROJECT=aruvii/agent-platform FACTORY_SLEEP=true
bot='{"username":"agent-coordinator","bot":true}'
mr() { printf '{"iid":12,"state":"opened","sha":"aaaa1111","labels":%s}' "$1"; }

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 "$(mr '["agent::claimed"]')"
respond "$FACTORY_GLAB" 3 200 "$(mr '["agent::claimed","needs-human"]')"
respond "$FACTORY_GLAB" 4 201 '{"id":7}'
respond "$FACTORY_GLAB" 5 200 "$(mr '["needs-human"]')"
expect_eq "a blocked MR says so in one line" "blocked !12" \
  "$("$REPO_ROOT/scripts/block.sh" 12 "writer hit the 45-minute cap" .claude/runs/writer-12.log)"
gl=$(dirname "$FACTORY_GLAB")
expect_pass "the label goes on before the note" sh -c \
  "sed -n 3p '$gl/calls.log' | grep -q 'add_labels=needs-human' && sed -n 4p '$gl/calls.log' | grep -q '/notes'"
expect_eq "the note gives the reason and the log" "[coordinator] blocked: writer hit the 45-minute cap · log: .claude/runs/writer-12.log" \
  "$(jq -r .body "$gl/inputs.log")"
expect_pass "the claim is released" grep -q 'remove_labels=agent::claimed' "$gl/calls.log"

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 "$(mr '["agent::claimed"]')"
respond "$FACTORY_GLAB" 3 500 '{"message":"Server Error"}'
expect_fail "a failed label posts no note and keeps the claim" "" "$REPO_ROOT/scripts/block.sh" 12 "silent"
expect_eq "nothing was posted" 3 "$(calls "$FACTORY_GLAB" | wc -l | tr -d ' ')"

expect_fail "a block needs a reason" "say why" "$REPO_ROOT/scripts/block.sh" 12 ""
expect_fail "a two-line reason is refused" "one line" "$REPO_ROOT/scripts/block.sh" 12 "$(printf 'a\nb')"

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 '{"username":"ann","bot":false}'
expect_fail "a human login is refused before any write (ADR-0006)" "a human account" "$REPO_ROOT/scripts/block.sh" 12 "x"

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 "$(mr '[]')"
respond "$FACTORY_GLAB" 3 200 "$(mr '["needs-human"]')"
respond "$FACTORY_GLAB" 4 201 '{"id":8}'
expect_eq "an MR with no claim is blocked too" "blocked !12" "$("$REPO_ROOT/scripts/block.sh" 12 "silent")"
expect_pass "and no claim is removed" sh -c "! grep -q remove_labels '$(dirname "$FACTORY_GLAB")/calls.log'"

finish
