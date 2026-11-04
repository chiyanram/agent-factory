#!/usr/bin/env bash
# scripts/status.sh: one [coordinator] note, never against a head that moved since the run started (research/46 G7).
. "$(dirname "$0")/lib.sh"
export FACTORY_PROJECT=aruvii/agent-platform FACTORY_SLEEP=true
bot='{"username":"agent-coordinator","bot":true}'
mr() { printf '{"iid":12,"state":"opened","sha":"%s","labels":[]}' "$1"; }

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 "$(mr aaaa1111bbbb2222)"
respond "$FACTORY_GLAB" 3 201 '{"id":7}'
expect_eq "a note at the run's head is posted" "posted !12 at aaaa1111" \
  "$("$REPO_ROOT/scripts/status.sh" 12 aaaa1111 "writer started")"
expect_pass "the note body starts with the seat" \
  grep -q 'merge_requests/12/notes -X POST -f body=\[coordinator\] writer started' "$(dirname "$FACTORY_GLAB")/calls.log"

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 "$(mr cccc3333dddd4444)"
expect_fail "a note against a head that moved is refused" "head moved" \
  "$REPO_ROOT/scripts/status.sh" 12 aaaa1111 "review clean"
expect_eq "the refused note is never posted" 2 "$(calls "$FACTORY_GLAB" | wc -l | tr -d ' ')"

expect_fail "a SHA shorter than 7 characters is refused" "at least 7" "$REPO_ROOT/scripts/status.sh" 12 aaa "x"
expect_fail "a note of more than one line is refused" "one line" "$REPO_ROOT/scripts/status.sh" 12 aaaa1111 "$(printf 'a\nb')"
expect_fail "an empty note is refused" "one line" "$REPO_ROOT/scripts/status.sh" 12 aaaa1111 ""

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 '{"username":"ann","bot":false}'
expect_fail "a human login is refused before any write (ADR-0006)" "a human account" \
  "$REPO_ROOT/scripts/status.sh" 12 aaaa1111 "ready"

finish
