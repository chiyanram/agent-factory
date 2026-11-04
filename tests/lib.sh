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
prev=""
for arg in "$@"; do [ "$prev" = --input ] && jq -c . "$arg" >> "$dir/inputs.log"; prev=$arg; done
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

# claude_stub : print the path of a fake claude. Each call appends "cwd | args" to calls.log in its folder.
# `agents --json` prints agents.json (default []). The Nth other call prints pN when it exists (a -p answer), else
# bg.out (default "started abc123") and exits with the code in bg.rc (default 0). Each -p call also logs any rule
# file it can see under its working folder to rules-seen.log, and "pack" to pack-seen.log when ./pack.md is there.
claude_stub() {
  dir=$(mktemp -d "$TMP_BASE/claude.XXXXXX")
  echo '[]' > "$dir/agents.json"
  cat > "$dir/claude" <<'STUB'
#!/usr/bin/env bash
dir=$(cd "$(dirname "$0")" && pwd)
printf '%s | %s\n' "$PWD" "$*" | tr '\n' ' ' >> "$dir/calls.log"
echo >> "$dir/calls.log"
if [ "${1:-}" = agents ]; then cat "$dir/agents.json"; exit 0; fi
n=$(( $(cat "$dir/n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$dir/n"
if [ -f "$dir/p$n" ]; then
  find . \( -name CLAUDE.md -o -name AGENTS.md -o -name .claude -o -name .agents \) >> "$dir/rules-seen.log"
  [ -f pack.md ] && echo pack >> "$dir/pack-seen.log"
  [ -d code ] && find code -type f | sort >> "$dir/files-seen.log"
  [ -d code ] && [ ! -d "$dir/code-seen" ] && cp -R code "$dir/code-seen"
  cat "$dir/p$n"; exit 0
fi
cat "$dir/bg.out" 2>/dev/null || echo "started abc123"
exit "$(cat "$dir/bg.rc" 2>/dev/null || echo 0)"
STUB
  chmod +x "$dir/claude"
  echo "$dir/claude"
}

# live STUB NAME... : make the fake claude list a live session for each NAME.
live() {
  stub=$1; shift
  printf '%s\n' "$@" | jq -R '{name: ., kind: "background", status: "busy"}' | jq -s . > "$(dirname "$stub")/agents.json"
}

# project_clone BRANCH : a bare origin with BRANCH pushed, and a clone of it; prints the clone's path.
# The tip of BRANCH is in the file head next to the clone.
project_clone() {
  base=$(mktemp -d "$TMP_BASE/project.XXXXXX")
  git init -q --bare "$base/origin.git"
  git clone -q "$base/origin.git" "$base/clone" 2> /dev/null
  (
    cd "$base/clone" || exit 1
    git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
    git push -q origin HEAD:refs/heads/main 2> /dev/null
    git checkout -q -b "$1"
    echo change > change.txt && git add change.txt
    git -c user.name=t -c user.email=t@t commit -q -m change
    git push -q origin "$1" 2> /dev/null
    git rev-parse HEAD > "$base/head"
    git checkout -q main 2> /dev/null || git checkout -q -b main origin/main
  )
  echo "$base/clone"
}
