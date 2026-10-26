#!/usr/bin/env bash
# scripts/check-links.sh fails on a broken relative link and passes on good ones.
. "$(dirname "$0")/lib.sh"

expect_fail "broken relative link fails" "README.md:3: docs/missing.md" \
  "$REPO_ROOT/scripts/check-links.sh" "$(fixture_repo links-broken)"
expect_pass "good links, anchors, web links and code pass" \
  "$REPO_ROOT/scripts/check-links.sh" "$(fixture_repo links-ok)"

finish
