# Shared helpers for tests/*.test.sh. Source it; do not run it.

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
FAILURES=0
TMP_BASE=$(mktemp -d)
trap 'rm -rf "$TMP_BASE"' EXIT

# Copy a fixture into a fresh git repo and print the repo's path.
fixture_repo() {
  dir=$(mktemp -d "$TMP_BASE/repo.XXXXXX")
  cp -R "$REPO_ROOT/tests/fixtures/$1/." "$dir/"
  git -C "$dir" init -q
  git -C "$dir" add -A
  echo "$dir"
}

# expect_fail NAME OUTPUT_PATTERN CMD... : CMD must exit non-zero and print OUTPUT_PATTERN.
expect_fail() {
  name=$1 pattern=$2
  shift 2
  if out=$("$@" 2>&1); then
    echo "FAIL $name: expected a non-zero exit, got 0"
    FAILURES=$((FAILURES + 1))
  elif ! printf '%s\n' "$out" | grep -q -- "$pattern"; then
    echo "FAIL $name: output does not name '$pattern':"
    printf '%s\n' "$out"
    FAILURES=$((FAILURES + 1))
  else
    echo "ok   $name"
  fi
}

# expect_pass NAME CMD... : CMD must exit 0.
expect_pass() {
  name=$1
  shift
  if out=$("$@" 2>&1); then
    echo "ok   $name"
  else
    echo "FAIL $name: expected exit 0:"
    printf '%s\n' "$out"
    FAILURES=$((FAILURES + 1))
  fi
}

finish() {
  [ "$FAILURES" -eq 0 ]
}
