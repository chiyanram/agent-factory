#!/usr/bin/env bash
# scripts/lib/gitlab.sh: the one GitLab seam retries 429 after Retry-After and fails loudly on any other error (G8).
. "$(dirname "$0")/lib.sh"
. "$REPO_ROOT/scripts/lib/gitlab.sh"

slept="$TMP_BASE/slept"
fake_sleep() { echo "$1" >> "$slept"; }
export FACTORY_SLEEP=fake_sleep

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 '{"iid":12}'
expect_eq "a 200 prints the body" '{"iid":12}' "$(gl_api projects/1/merge_requests/12)"
expect_eq "a 200 takes one call" 1 "$(calls "$FACTORY_GLAB" | wc -l | tr -d ' ')"

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 429 '{"message":"429 Too Many Requests"}' 'Retry-After: 7'
respond "$FACTORY_GLAB" 2 200 '{"iid":12}'
expect_eq "a 429 then a 200 prints the body" '{"iid":12}' "$(gl_api projects/1/merge_requests/12 2>/dev/null)"
expect_eq "a 429 waits the Retry-After seconds" 7 "$(cat "$slept")"

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
for n in 1 2 3 4; do respond "$FACTORY_GLAB" "$n" 429 '{}' 'retry-after: 1'; done
expect_fail "four 429s in a row fail" "HTTP 429 after 4 tries" gl_api projects/1/merge_requests/12

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 404 '{"message":"404 Not Found"}'
expect_fail "a 404 fails and names the status" "HTTP 404" gl_api projects/1/merge_requests/99

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 '{"iid":12}'
printf '[glab] Update available: 1.80.0 -> 1.81.0\n' > "$(dirname "$FACTORY_GLAB")/e1"
expect_eq "glab's update notice on stderr stays out of the body" '{"iid":12}' "$(gl_api projects/1/merge_requests/12)"

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
printf 'glab: not logged in\n' > "$(dirname "$FACTORY_GLAB")/e1"
: > "$(dirname "$FACTORY_GLAB")/r1"
expect_fail "output with no HTTP status fails" "no HTTP status" gl_api projects/1/merge_requests/12

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
export FACTORY_PROJECT=o/r
respond "$FACTORY_GLAB" 1 400 '{"message":"400 Bad request - line_code can not be blank"}'
respond "$FACTORY_GLAB" 2 201 '{"id":"d2"}'
forge_line_finding 12 '{"diff_refs":{"base_sha":"b","start_sha":"s","head_sha":"h"}}' \
  '{"file":"src/A.java","line":400}' "[reviewer] Act on F1"
expect_eq "a line outside the diff opens an unanchored thread that keeps the seat prefix first (#128)" \
  '[reviewer] `src/A.java:400` Act on F1' "$(sed -n 2p "$(dirname "$FACTORY_GLAB")/inputs.log" | jq -r .body)"

finish
