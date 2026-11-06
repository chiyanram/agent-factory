#!/usr/bin/env bash
# The GitHub adapter of the forge seam (ADR-0010): the same scripts, the same lines, with # for a pull request.
. "$(dirname "$0")/lib.sh"
export FACTORY_FORGE=github FACTORY_PROJECT=chiyanram/ledger FACTORY_SLEEP=true
FACTORY_GH_APP="$TMP_BASE/github-app"   # the App's own name comes from GitHub (github-app.sh slug)
printf '#!/bin/sh\n[ "$1" = slug ] && echo ledger-factory\n' > "$FACTORY_GH_APP" && chmod +x "$FACTORY_GH_APP"
export FACTORY_GH_APP
bot='{"total_count":1,"repositories":[{"full_name":"chiyanram/ledger"}]}'   # only an App's token can list these
pr() { printf '{"number":12,"state":"%s","merged":%s,"head":{"sha":"aaaa1111","ref":"feat/1-x"},"base":{"ref":"main"},"labels":%s}' "$1" "$2" "$3"; }
log() { dirname "$FACTORY_GH"; }

expect_fail "an unknown forge is refused" "FACTORY_FORGE must be gitlab or github" \
  env FACTORY_FORGE=bitbucket "$REPO_ROOT/scripts/claim.sh" 12

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 200 "$bot"
respond "$FACTORY_GH" 2 200 "$(pr open false '[]')"
respond "$FACTORY_GH" 3 200 '[{"name":"agent::claimed"}]'
expect_eq "claim adds the label to the pull request" "claimed #12" "$("$REPO_ROOT/scripts/claim.sh" 12)"
expect_pass "claim reads the pull request" grep -q '^api --include repos/chiyanram/ledger/pulls/12 ' "$(log)/calls.log"
expect_eq "the label goes in the request body, not as a gh field" '{"labels":["agent::claimed"]}' "$(cat "$(log)/inputs.log")"

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 403 '{"message":"You must authenticate with an installation access token"}'
expect_fail "a person's token is refused before any write (ADR-0006)" "not acting as the factory's GitHub App" \
  "$REPO_ROOT/scripts/claim.sh" 12
FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 200 '{"total_count":1,"repositories":[{"full_name":"chiyanram/other"}]}'
expect_fail "an App installed elsewhere, not on the project, is refused" "not installed on chiyanram/ledger" \
  "$REPO_ROOT/scripts/claim.sh" 12

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 403 '{"message":"You must authenticate with an installation access token"}'
expect_fail "the refusal shows GitHub's own reason too" "You must authenticate with an installation access token" \
  "$REPO_ROOT/scripts/claim.sh" 12
expect_pass "the bot check asks for the App's installation repositories" \
  grep -q '^api --include installation/repositories?per_page=1' "$(log)/calls.log"
expect_eq "the refusal writes nothing" 1 "$(calls "$FACTORY_GH" | wc -l | tr -d ' ')"

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 200 "$bot"
respond "$FACTORY_GH" 2 200 "$(pr closed true '[]')"
expect_fail "a merged pull request is not claimed" "#12 is merged" \
  "$REPO_ROOT/scripts/claim.sh" 12

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 200 "$bot"
respond "$FACTORY_GH" 2 200 "$(pr closed false '[{"name":"agent::claimed"}]')"
respond "$FACTORY_GH" 3 200 '[]'
expect_eq "release removes the label from a closed pull request" "released #12" "$("$REPO_ROOT/scripts/release.sh" 12)"
expect_pass "the label is URL-encoded in the DELETE path" \
  grep -q '^api --include repos/chiyanram/ledger/issues/12/labels/agent%3A%3Aclaimed -X DELETE' "$(log)/calls.log"

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 200 "$bot"
respond "$FACTORY_GH" 2 200 "$(pr open false '[{"name":"agent::claimed"}]')"
respond "$FACTORY_GH" 3 404 '{"message":"Label does not exist"}'
respond "$FACTORY_GH" 4 200 "$(pr open false '[]')"
expect_eq "a label a human removed meanwhile (404) still counts as released" "released #12" \
  "$("$REPO_ROOT/scripts/release.sh" 12)"

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 200 "$bot"
respond "$FACTORY_GH" 2 200 "$(pr open false '[{"name":"agent::claimed"}]')"
respond "$FACTORY_GH" 3 500 '{"message":"Server Error"}'
respond "$FACTORY_GH" 4 200 "$(pr open false '[{"name":"agent::claimed"}]')"
expect_fail "a failed DELETE with the label still there fails" "did not remove the label" \
  "$REPO_ROOT/scripts/release.sh" 12

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 200 "$bot"
respond "$FACTORY_GH" 2 200 "$(pr open false '[]')"
respond "$FACTORY_GH" 3 201 '{"id":1}'
expect_eq "status posts a comment at the run's head" "posted #12 at aaaa1111" \
  "$("$REPO_ROOT/scripts/status.sh" 12 aaaa1111 "writer started")"
expect_eq "the comment is the seat and the line" "[coordinator] writer started" "$(jq -r .body "$(log)/inputs.log")"

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 200 "$bot"
respond "$FACTORY_GH" 2 200 "$(pr open false '[]')"
respond "$FACTORY_GH" 3 201 '{"id":2}'
expect_eq "ask posts the writer's question at its head on GitHub" "asked #12 at aaaa1111" \
  "$("$REPO_ROOT/scripts/ask.sh" 12 aaaa1111 'is $PATH a "literal" here?')"
expect_eq "the question arrives as written, quotes and dollar sign kept" '[writer] OPEN: is $PATH a "literal" here?' \
  "$(jq -r .body "$(log)/inputs.log")"

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 403 '{"message":"API rate limit exceeded"}' 'x-ratelimit-remaining: 0' 'x-ratelimit-reset: 1'
respond "$FACTORY_GH" 2 200 "$bot"
respond "$FACTORY_GH" 3 200 "$(pr open false '[{"name":"agent::claimed"}]')"
expect_fail "a 403 rate limit is retried, then the real answer decides" "#12 is already claimed" \
  "$REPO_ROOT/scripts/claim.sh" 12

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 200 "$bot"
respond "$FACTORY_GH" 2 403 '{"message":"Resource not accessible by integration"}'
expect_fail "a 403 that is not a rate limit fails at once" "github: HTTP 403" "$REPO_ROOT/scripts/claim.sh" 12
expect_eq "and is not retried" 2 "$(calls "$FACTORY_GH" | wc -l | tr -d ' ')"

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 200 "$bot"
respond "$FACTORY_GH" 2 502 '{"message":"Bad Gateway"}'
expect_fail "a failed read of the pull request fails release, never reads as not claimed" "github: HTTP 502" \
  "$REPO_ROOT/scripts/release.sh" 12

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 200 "$bot"
respond "$FACTORY_GH" 2 502 '{"message":"Bad Gateway"}'
expect_fail "a failed list of claims fails reconcile, never reads as nothing to reconcile" "github: HTTP 502" \
  env FACTORY_REPO="$(fixture_repo poll)" FACTORY_CLAUDE="$(claude_stub)" "$REPO_ROOT/scripts/reconcile.sh"

# poll: the same decisions as on GitLab, from GitHub's own data
c() { printf '{"body":"%s","createdAt":"%s","author":{"login":"%s","__typename":"%s"}}' "$1" "$2" "$3" "${4:-User}"; }
e() { printf '{"editedAt":"%s","editor":{"login":"%s","__typename":"%s"}}' "$1" "$2" "${3:-User}"; }
p() {  # p NUMBER DRAFT ROLLUP LABELS COMMENTS EDITS
  printf '{"number":%s,"isDraft":%s,"headRefOid":"%s","labels":{"nodes":%s},"commits":{"nodes":[{"commit":{"statusCheckRollup":%s}}]},"comments":{"nodes":[%s]},"userContentEdits":{"nodes":[%s]}}' \
    "$1" "$2" "$(printf '%s' "$1" | sed 's/./&&&&/;s/^\(.\{8\}\).*/\1/')abcdefgh" "$4" "$3" "$5" "$6"
}
graphql=$(cat <<JSON
{"data":{"repository":{
 "collaborators":{"edges":[{"permission":"ADMIN","node":{"login":"chiyanram"}},{"permission":"TRIAGE","node":{"login":"ann"}},
   {"permission":"WRITE","node":{"login":"dev2"}}]},
 "open":{"nodes":[
  $(p 1 true '{"state":"SUCCESS"}' '[]' "$(c /approved 2026-11-02T10:00:00Z chiyanram)" "$(e 2026-11-01T10:00:00Z chiyanram)"),
  $(p 2 true '{"state":"FAILURE"}' '[]' "$(c /approved 2026-11-02T10:00:00Z chiyanram)" "$(e 2026-11-03T10:00:00Z chiyanram)"),
  $(p 3 true null '[]' "$(c /approved 2026-11-02T10:00:00Z ann),$(c /approved 2026-11-02T11:00:00Z factory Bot)" ""),
  $(p 4 false '{"state":"PENDING"}' '[{"name":"agent::claimed"},{"name":"needs-human"}]' "$(c /approved 2026-11-02T10:00:00Z chiyanram),$(c '[coordinator] OPEN: which port?' 2026-11-02T12:00:00Z ledger-factory Bot)" "$(e 2026-11-03T10:00:00Z ledger-factory Bot)"),
  $(p 5 true '{"state":"SUCCESS"}' '[]' "$(c /approved 2026-11-02T10:00:00Z chiyanram),$(c /stop 2026-11-02T11:00:00Z chiyanram)" ""),
  $(p 6 true '{"state":"SUCCESS"}' '[]' "$(c /approved 2026-11-02T10:00:00Z chiyanram)" "$(e 2026-11-03T10:00:00Z chiyanram)$(for i in $(seq 1 99); do printf ',%s' "$(e 2026-11-02T09:00:00Z ledger-factory Bot)"; done)")
 ]},
 "merged":{"nodes":[{"number":9}]}}}}
JSON
)
FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 200 "$graphql"
out=$("$REPO_ROOT/scripts/poll.sh")
line() { printf '%s\n' "$out" | grep "^#$1 "; }
expect_eq "an admin's /approved after the last body edit counts" \
  "#1 head=1111abcd draft=yes claimed=no approved=yes pipeline=success needs_human=no stop=no asks=0" "$(line 1)"
expect_eq "a human body edit after /approved makes it stale; a failed check reads failed" \
  "#2 head=2222abcd draft=yes claimed=no approved=stale pipeline=failed needs_human=no stop=no asks=0" "$(line 2)"
expect_eq "an /approved from a collaborator without write access, or from a bot, does not count" \
  "#3 head=3333abcd draft=yes claimed=no approved=no pipeline=none needs_human=no stop=no asks=0" "$(line 3)"
expect_eq "the App's own body edit leaves /approved fresh; its open ask is counted" \
  "#4 head=4444abcd draft=no claimed=yes approved=yes pipeline=running needs_human=yes stop=no asks=1" "$(line 4)"
expect_eq "a /stop after /approved stops" \
  "#5 head=5555abcd draft=yes claimed=no approved=yes pipeline=success needs_human=no stop=yes asks=0" "$(line 5)"
expect_eq "with 100 edits in view, the newest human edit still makes /approved stale" \
  "#6 head=6666abcd draft=yes claimed=no approved=stale pipeline=success needs_human=no stop=no asks=0" "$(line 6)"
expect_eq "a merged pull request that still carries the claim is listed" "#9 merged claimed=yes" "$(line 9)"
expect_eq "one call per poll" 1 "$(calls "$FACTORY_GH" | wc -l | tr -d ' ')"
expect_pass "the query asks for the newest 100 edits (GitHub lists edits newest first)" \
  grep -q 'userContentEdits(first: 100)' "$(log)/calls.log"
expect_pass "owner, name and label go in as GraphQL variables" \
  grep -qF -- '-f owner=chiyanram -f name=ledger -f label=agent::claimed' "$(log)/calls.log"

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 200 '{"data":{"repository":null},"errors":[{"message":"Could not resolve to a Repository"}]}'
expect_fail "a GraphQL error fails" "GraphQL: Could not resolve to a Repository" "$REPO_ROOT/scripts/poll.sh"
expect_fail "a project that is not owner/name is refused" "must be owner/name" \
  env FACTORY_PROJECT=ledger "$REPO_ROOT/scripts/poll.sh"

# the seam calls the scripts above do not reach
. "$REPO_ROOT/scripts/lib/forge.sh"
FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 200 '{"data":{"repository":{"pullRequests":{"nodes":[{"number":3},{"number":7}]}}}}'
expect_eq "forge_claimed lists the numbers" "3 7" "$(forge_claimed merged agent::claimed | tr '\n' ' ' | sed 's/ $//')"
expect_pass "merged means the MERGED state" grep -q 'states: \[MERGED\]' "$(log)/calls.log"

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 201 '{"id":1}'
forge_line_finding 12 '{"sha":"aaaa1111"}' '{"file":"src/A.java","line":4}' "[reviewer] Act on F1"
expect_eq "a finding is a review comment on the head, at file and line" \
  '{"body":"[reviewer] Act on F1","commit_id":"aaaa1111","path":"src/A.java","line":4,"side":"RIGHT"}' \
  "$(cat "$(log)/inputs.log")"

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 422 '{"message":"Validation Failed"}'
respond "$FACTORY_GH" 2 201 '{"id":2}'
forge_line_finding 12 '{"sha":"aaaa1111"}' '{"file":"src/A.java","line":400}' "[reviewer] Act on F1"
expect_eq "a line outside the diff goes out as a plain comment that names file:line" \
  '`src/A.java:400` [reviewer] Act on F1' "$(sed -n 2p "$(log)/inputs.log" | jq -r .body)"
expect_pass "on the conversation, not the diff" grep -q '^api --include repos/chiyanram/ledger/issues/12/comments ' "$(log)/calls.log"

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 200 '[{"body":"a","user":{"login":"ledger-factory[bot]"}}]'
expect_eq "forge_notes gives every comment in the seam's shape" '[{"body":"a","author":{"username":"ledger-factory[bot]"}}]' \
  "$(forge_notes 12)"

finish
