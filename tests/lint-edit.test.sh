#!/usr/bin/env bash
# scripts/lint-edit.sh: the writer's PostToolUse hook lints each file it edits (ADR-0011 D17).
. "$(dirname "$0")/lib.sh"
root=$(mktemp -d "$TMP_BASE/work.XXXXXX")
printf 'good\n' > "$root/ok.txt"; printf 'BAD\n' > "$root/bad.txt"
lint='! grep -n BAD'   # a lint that fails on a line holding BAD
edit() { printf '{"tool_name":"Edit","tool_input":{"file_path":"%s"}}' "$1"; }
hook() { edit "$1" | CLAUDE_PROJECT_DIR="$root" "$REPO_ROOT/scripts/lint-edit.sh" "$lint"; }

expect_eq "a clean file passes in silence" "0:" "$(out=$(hook "$root/ok.txt" 2>&1); echo "$?:$out")"
expect_eq "a failing lint exits 2, so Claude Code shows the writer what it said" 2 \
  "$(hook "$root/bad.txt" > /dev/null 2>&1; echo $?)"
expect_pass "and the message names the file, the command and the lint's output" \
  sh -c "out=\$(printf '%s' '$(edit "$root/bad.txt")' | CLAUDE_PROJECT_DIR='$root' '$REPO_ROOT/scripts/lint-edit.sh' '$lint' 2>&1); case \$out in *'lint failed on $root/bad.txt (! grep -n BAD)'*'1:BAD'*) exit 0;; *) exit 1;; esac"
expect_eq "a file that is gone is skipped" 0 "$(hook "$root/gone.txt" > /dev/null 2>&1; echo $?)"
expect_eq "a file outside the session's folder is skipped" 0 \
  "$(printf 'BAD\n' > "$TMP_BASE/out.txt"; hook "$TMP_BASE/out.txt" > /dev/null 2>&1; echo $?)"
expect_eq "a tool call with no file is skipped" 0 \
  "$(printf '{"tool_input":{}}' | "$REPO_ROOT/scripts/lint-edit.sh" "$lint" > /dev/null 2>&1; echo $?)"
printf 'BAD\n' > "$root/a b.txt"
expect_eq "a path with a space reaches the lint as one word" 2 "$(hook "$root/a b.txt" > /dev/null 2>&1; echo $?)"
expect_fail "no lint command is refused" "usage" sh -c "printf '{}' | '$REPO_ROOT/scripts/lint-edit.sh'"

finish
