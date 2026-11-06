#!/usr/bin/env bash
# scripts/tokens.sh: the tokens one ticket spent, by phase, from the records kept per head (ADR-0011 D16).
. "$(dirname "$0")/lib.sh"
FACTORY_REPO=$(mktemp -d "$TMP_BASE/repo.XXXXXX"); git init -q "$FACTORY_REPO"; export FACTORY_REPO
export CLAUDE_CONFIG_DIR="$TMP_BASE/claude-config"
live=$CLAUDE_CONFIG_DIR/projects/$(printf '%s' "$(cd "$FACTORY_REPO" && pwd -P)/.claude/worktrees/writer-7" | sed 's/[^A-Za-z0-9-]/-/g')
a() { printf '{"type":"assistant","message":{"id":"%s","usage":{"input_tokens":%s,"cache_creation_input_tokens":1,"cache_read_input_tokens":2,"output_tokens":3}}}\n' "$1" "$2"; }
r() { printf '{"type":"result","usage":{"input_tokens":%s,"output_tokens":0}}\n' "$1"; }
h1="$FACTORY_REPO/.claude/runs/7/aaaa"; h2="$FACTORY_REPO/.claude/runs/7/bbbb"
mkdir -p "$h1" "$h2" "$live"

expect_eq "a ticket with no records spent nothing" "tokens !7: writer 0 · find 0 · verify 0 · total 0 (0 heads)" \
  "$("$REPO_ROOT/scripts/tokens.sh" 7 2>&1)"
{ a w1 100; a w1 100; } > "$h1/writer-s1.jsonl"
r 50 > "$h1/reviewer-find.json"; r 20 > "$h1/reviewer-verify-rule.json"; r 5 > "$h1/reviewer-verify-logic.json"
a w2 10 > "$h2/writer-s2.jsonl"; r 40 > "$h2/reviewer-find.json"
expect_eq "each phase is summed over every head: input, cache writes, cache reads and output" \
  "tokens !7: writer 122 · find 90 · verify 25 · total 237 (2 heads)" "$("$REPO_ROOT/scripts/tokens.sh" 7)"
cp "$h1/writer-s1.jsonl" "$live/s1.jsonl"; a w3 1000 > "$live/s3.jsonl"
expect_eq "a live session no head has kept yet counts as writer; a kept one never twice" \
  "tokens !7: writer 1128 · find 90 · verify 25 · total 1243 (2 heads)" "$("$REPO_ROOT/scripts/tokens.sh" 7)"
echo 'not json' >> "$h2/writer-s2.jsonl"
expect_eq "a line that is not JSON is skipped" \
  "tokens !7: writer 1128 · find 90 · verify 25 · total 1243 (2 heads)" "$("$REPO_ROOT/scripts/tokens.sh" 7)"
expect_eq "it calls no forge and runs no model" "" "$(ls "$TMP_BASE" | grep -E '^(glab|claude)\.' || true)"
expect_fail "an MR number is required" "" "$REPO_ROOT/scripts/tokens.sh"
expect_fail "FACTORY_REPO must be a git clone" "FACTORY_REPO" env FACTORY_REPO=/nonexistent "$REPO_ROOT/scripts/tokens.sh" 7

finish
