#!/usr/bin/env bash
# scripts/check-size.sh fails when the root AGENTS.md reaches 200 lines (ADR-0003).
. "$(dirname "$0")/lib.sh"

expect_fail "root AGENTS.md of 200 lines fails" "AGENTS.md: 200 lines" \
  "$REPO_ROOT/scripts/check-size.sh" "$(fixture_repo size-over)"
expect_pass "root AGENTS.md of 199 lines passes" \
  "$REPO_ROOT/scripts/check-size.sh" "$(fixture_repo size-ok)"

finish
