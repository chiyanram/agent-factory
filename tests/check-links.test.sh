#!/usr/bin/env bash
# scripts/check-links.sh fails on a broken relative link and passes on good ones.
. "$(dirname "$0")/lib.sh"

expect_fail "broken relative link fails" "README.md:3: docs/missing.md" \
  "$REPO_ROOT/scripts/check-links.sh" "$(fixture_repo links-broken)"
expect_fail "broken root-absolute link fails" "abs-missing.md" \
  "$REPO_ROOT/scripts/check-links.sh" "$(fixture_repo links-broken)"
expect_fail "broken reference-style link fails" "ref-missing.md" \
  "$REPO_ROOT/scripts/check-links.sh" "$(fixture_repo links-broken)"
expect_fail "broken link in a non-ASCII file name fails" "nope.md" \
  "$REPO_ROOT/scripts/check-links.sh" "$(fixture_repo links-nonascii)"
expect_pass "good links, anchors, web links, code and docs/archive/ pass" \
  "$REPO_ROOT/scripts/check-links.sh" "$(fixture_repo links-ok)"

finish
