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

# glab_stub : print the path of a fake glab. Each call appends its arguments to calls.log in the same folder and
# answers with the next file r1, r2, … (see respond). A call with no file left fails, so an extra call is caught.
glab_stub() {
  dir=$(mktemp -d "$TMP_BASE/glab.XXXXXX")
  cat > "$dir/glab" <<'STUB'
#!/usr/bin/env bash
dir=$(cd "$(dirname "$0")" && pwd)
n=$(( $(cat "$dir/n" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$dir/n"
printf '%s\n' "$*" | tr '\n' ' ' >> "$dir/calls.log"
echo >> "$dir/calls.log"
[ -f "$dir/e$n" ] && cat "$dir/e$n" >&2
[ -f "$dir/r$n" ] || { echo "glab stub: no response for call $n: $*" >&2; exit 3; }
cat "$dir/r$n"
STUB
  chmod +x "$dir/glab"
  echo "$dir/glab"
}

# respond STUB N STATUS [BODY] [HEADER...] : write the stub's answer to call N as an HTTP response (glab api --include).
respond() {
  stub=$1 n=$2 code=$3 body=${4:-'{}'}
  shift 3; [ $# -gt 0 ] && shift
  {
    printf 'HTTP/2.0 %s\r\n' "$code"
    printf 'Content-Type: application/json\r\n'
    for header in "$@"; do printf '%s\r\n' "$header"; done
    printf '\r\n%s\n' "$body"
  } > "$(dirname "$stub")/r$n"
}

# calls STUB : the arguments of every call the stub received, one line each.
calls() {
  cat "$(dirname "$1")/calls.log" 2>/dev/null
}

# expect_eq NAME EXPECTED ACTUAL
expect_eq() {
  if [ "$2" = "$3" ]; then
    echo "ok   $1"
  else
    printf 'FAIL %s:\n  expected: %s\n  actual:   %s\n' "$1" "$2" "$3"
    FAILURES=$((FAILURES + 1))
  fi
}
