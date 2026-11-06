#!/usr/bin/env bash
# lint-edit '<lint command>' — the writer's PostToolUse hook: lints the file an Edit or Write just changed (ADR-0011 D17).
#
# Claude Code passes the tool call as JSON on stdin; the file is .tool_input.file_path. The command comes from the
# project's docs/agents/commands.md ("lint-file: <command>"), read by start-writer.sh, and gets the file as its last
# word. A file that is gone, or outside the session's folder, is skipped. On a lint failure the hook exits 2 with the
# lint's last 40 lines on stderr, which Claude Code shows the writer; otherwise it exits 0 and prints nothing.
set -u
command=${1:-}
[ -n "$command" ] || { echo "usage: lint-edit.sh '<lint command>'" >&2; exit 1; }
file=$(jq -r '.tool_input.file_path // empty' 2> /dev/null) || exit 0
[ -n "$file" ] && [ -f "$file" ] || exit 0
root=${CLAUDE_PROJECT_DIR:-$PWD}
case $file in "$root"/*) ;; /*) exit 0 ;; esac
out=$(cd "$root" && sh -c "$command \"\$1\"" lint-edit "$file" 2>&1) && exit 0
{ echo "lint failed on $file ($command):"; printf '%s\n' "$out" | tail -n 40; } >&2
exit 2
