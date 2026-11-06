#!/usr/bin/env bash
# scripts/ask.sh: the writer's open question, one [writer] OPEN: note, never against a moved head (ADR-0011 D10).
. "$(dirname "$0")/lib.sh"
export FACTORY_PROJECT=aruvii/agent-platform FACTORY_SLEEP=true
bot='{"username":"agent-coordinator","bot":true}'
mr() { printf '{"iid":12,"state":"opened","sha":"%s","labels":[]}' "$1"; }

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 "$(mr aaaa1111bbbb2222)"
respond "$FACTORY_GLAB" 3 201 '{"id":7}'
expect_eq "a question at the run's head is posted" "asked !12 at aaaa1111" \
  "$("$REPO_ROOT/scripts/ask.sh" 12 aaaa1111 "should listing be paged?")"
expect_pass "the note is a [writer] OPEN: note, which poll counts as an ask" \
  sh -c "jq -r .body '$(dirname "$FACTORY_GLAB")/inputs.log' | grep -qx '\[writer\] OPEN: should listing be paged?'"

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 "$(mr cccc3333dddd4444)"
expect_fail "a question against a head that moved is refused" "head moved" \
  "$REPO_ROOT/scripts/ask.sh" 12 aaaa1111 "paged?"
expect_eq "the refused question is never posted" 2 "$(calls "$FACTORY_GLAB" | wc -l | tr -d ' ')"

expect_fail "a SHA shorter than 7 characters is refused" "at least 7" "$REPO_ROOT/scripts/ask.sh" 12 aaa "x"
expect_fail "a question of more than one line is refused" "one line" "$REPO_ROOT/scripts/ask.sh" 12 aaaa1111 "$(printf 'a\nb')"
expect_fail "an empty question is refused" "one line" "$REPO_ROOT/scripts/ask.sh" 12 aaaa1111 ""

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 '{"username":"ann","bot":false}'
expect_fail "a human login is refused before any write (ADR-0006)" "a human account" \
  "$REPO_ROOT/scripts/ask.sh" 12 aaaa1111 "paged?"

finish
