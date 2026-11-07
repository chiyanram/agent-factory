#!/usr/bin/env bash
# scripts/lib/github.sh: the GitHub calls the bash scripts still make (start-writer.sh, #138), with gh as a stub.
. "$(dirname "$0")/lib.sh"
export FACTORY_FORGE=github FACTORY_PROJECT=chiyanram/ledger FACTORY_SLEEP=true
pr() { printf '{"number":12,"state":"%s","merged":%s,"head":{"sha":"aaaa1111","ref":"feat/1-x"},"base":{"ref":"main"},"labels":%s,"body":%s}' "$1" "$2" "$3" "$4"; }
log() { dirname "$FACTORY_GH"; }

expect_fail "an unknown forge is refused" "FACTORY_FORGE must be gitlab or github" \
  env FACTORY_FORGE=bitbucket bash -c ". '$REPO_ROOT/scripts/lib/forge.sh'"

. "$REPO_ROOT/scripts/lib/forge.sh"
FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 200 "$(pr open false '[{"name":"agent::claimed"}]' '"AC1: it works."')"
expect_eq "forge_pr reads the pull request in the seam's shape" \
  '{"state":"opened","sha":"aaaa1111","source_branch":"feat/1-x","target_branch":"main","labels":["agent::claimed"],"description":"AC1: it works."}' \
  "$(forge_pr 12)"
expect_pass "from the repository's pulls" grep -q '^api --include repos/chiyanram/ledger/pulls/12 ' "$(log)/calls.log"

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 200 "$(pr closed true '[]' null)"
expect_eq "a merged pull request is merged, and an empty body an empty description" "merged " \
  "$(forge_pr 12 | jq -r '"\(.state) \(.description)"')"

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 403 '{"message":"API rate limit exceeded"}' 'x-ratelimit-remaining: 0' 'x-ratelimit-reset: 1'
respond "$FACTORY_GH" 2 200 "$(pr open false '[]' null)"
expect_eq "a 403 rate limit is retried, then the real answer is read" opened "$(forge_pr 12 2> /dev/null | jq -r .state)"

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 403 '{"message":"Resource not accessible by integration"}'
expect_fail "a 403 that is not a rate limit fails at once" "github: HTTP 403" forge_pr 12
expect_eq "and is not retried" 1 "$(calls "$FACTORY_GH" | wc -l | tr -d ' ')"

FACTORY_GH=$(glab_stub); export FACTORY_GH
respond "$FACTORY_GH" 1 502 '{"message":"Bad Gateway"}'
expect_fail "a failed read fails, never reads as an empty pull request" "github: HTTP 502" forge_pr 12

finish
