#!/usr/bin/env bash
# scripts/claim.sh and scripts/release.sh: the claim label on the MR is the claim (ADR-0002; docs/archive/research/37 P1).
. "$(dirname "$0")/lib.sh"
export FACTORY_PROJECT=aruvii/agent-platform FACTORY_SLEEP=true
bot='{"username":"agent-coordinator","bot":true}'
mr() { printf '{"iid":12,"state":"%s","sha":"aaaa1111","labels":%s}' "$1" "$2"; }

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 "$(mr opened '["needs-review"]')"
respond "$FACTORY_GLAB" 3 200 "$(mr opened '["needs-review","agent::claimed"]')"
expect_eq "claim adds the label and says so in one line" "claimed !12" "$("$REPO_ROOT/scripts/claim.sh" 12)"
expect_pass "claim adds the label with one PUT" \
  grep -q 'merge_requests/12 -X PUT -f add_labels=agent::claimed' "$(dirname "$FACTORY_GLAB")/calls.log"

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 "$(mr opened '["agent::claimed"]')"
expect_fail "an MR already claimed is refused, so it never gets a second run" "!12 is already claimed" \
  "$REPO_ROOT/scripts/claim.sh" 12
expect_eq "a refused claim writes nothing" 2 "$(calls "$FACTORY_GLAB" | wc -l | tr -d ' ')"

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 "$(mr merged '[]')"
expect_fail "a merged MR cannot be claimed" "!12 is merged" "$REPO_ROOT/scripts/claim.sh" 12

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 '{"username":"ann","bot":false}'
expect_fail "a human login is refused before any write (ADR-0006)" "a human account" "$REPO_ROOT/scripts/claim.sh" 12
expect_eq "the refusal writes nothing" 1 "$(calls "$FACTORY_GLAB" | wc -l | tr -d ' ')"

expect_fail "a non-number is refused" "not a merge request number" "$REPO_ROOT/scripts/claim.sh" '12;rm'

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 "$(mr merged '["agent::claimed"]')"
respond "$FACTORY_GLAB" 3 200 "$(mr merged '[]')"
expect_eq "release removes the label, also on a merged MR" "released !12" "$("$REPO_ROOT/scripts/release.sh" 12)"
expect_pass "release removes the label with one PUT" \
  grep -q 'merge_requests/12 -X PUT -f remove_labels=agent::claimed' "$(dirname "$FACTORY_GLAB")/calls.log"

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 "$bot"
respond "$FACTORY_GLAB" 2 200 "$(mr opened '[]')"
expect_eq "releasing an unclaimed MR is a no-op that says so" "!12 was not claimed" "$("$REPO_ROOT/scripts/release.sh" 12)"

finish
