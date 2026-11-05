#!/usr/bin/env bash
# scripts/poll.sh: one batched query (G8) → one line of facts per open MR, from current state only (docs/archive/research/37 P3).
. "$(dirname "$0")/lib.sh"
export FACTORY_PROJECT=aruvii/agent-platform FACTORY_SLEEP=true

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 "$(cat "$REPO_ROOT/tests/fixtures/poll/graphql.json")"
out=$("$REPO_ROOT/scripts/poll.sh")
line() { printf '%s\n' "$out" | grep "^!$1 "; }

expect_eq "a human maintainer's /approved after the last edit counts" \
  "!1 head=aaaa1111 draft=yes claimed=no approved=yes pipeline=success needs_human=no stop=no asks=0" "$(line 1)"
expect_eq "an /approved older than the last description edit is stale (G3)" \
  "!2 head=bbbb2222 draft=yes claimed=no approved=stale pipeline=none needs_human=no stop=no asks=0" "$(line 2)"
expect_eq "an /approved from a bot, a developer or inside a sentence does not count" \
  "!3 head=cccc3333 draft=yes claimed=no approved=no pipeline=none needs_human=no stop=no asks=0" "$(line 3)"
expect_eq "claim, needs-human, and asks a non-member's note does not close (G6)" \
  "!4 head=dddd4444 draft=no claimed=yes approved=yes pipeline=none needs_human=yes stop=no asks=2" "$(line 4)"
expect_eq "a human /stop after /approved stops; an answered ask is closed" \
  "!5 head=eeee5555 draft=yes claimed=no approved=yes pipeline=running needs_human=no stop=yes asks=0" "$(line 5)"
expect_eq "a full activity window that starts after the /approved counts as stale, never fresh" \
  "!6 head=ffff6666 draft=yes claimed=no approved=stale pipeline=success needs_human=no stop=no asks=0" "$(line 6)"
expect_eq "a description edit by the writer (a bot or agent- account) leaves /approved fresh (#56 A)" \
  "!7 head=7777aaaa draft=no claimed=no approved=yes pipeline=success needs_human=no stop=no asks=0" "$(line 7)"
expect_eq "a description edit with no author still makes /approved stale: never fails open" \
  "!8 head=8888aaaa draft=no claimed=no approved=stale pipeline=none needs_human=no stop=no asks=0" "$(line 8)"
expect_eq "a merged MR that still carries the claim is listed for the sweep" "!9 merged claimed=yes" "$(line 9)"
expect_eq "one call per poll" 1 "$(calls "$FACTORY_GLAB" | wc -l | tr -d ' ')"
expect_pass "the project and the label go in as GraphQL variables, not into the query text" \
  grep -qF -- '-f project=aruvii/agent-platform -f label=agent::claimed' "$(dirname "$FACTORY_GLAB")/calls.log"
expect_fail "no -f field name carries a bracket, which glab rejects in a GraphQL body" "no bracket" \
  sh -c 'grep -Eo -- "-f [A-Za-z_]+\[" "$1" && exit 0; echo "no bracket"; exit 1' _ "$(dirname "$FACTORY_GLAB")/calls.log"

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 '{"errors":[{"message":"Field must have selections"}]}'
expect_fail "a GraphQL error fails and prints no MR line" "GraphQL: Field must have selections" "$REPO_ROOT/scripts/poll.sh"

FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
respond "$FACTORY_GLAB" 1 200 '{"data":{"project":null}}'
expect_fail "an unknown project fails" "no project aruvii/agent-platform" "$REPO_ROOT/scripts/poll.sh"

expect_fail "no project set is refused" "FACTORY_PROJECT is not set" env FACTORY_PROJECT= "$REPO_ROOT/scripts/poll.sh"

finish
