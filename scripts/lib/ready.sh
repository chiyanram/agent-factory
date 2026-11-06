# The ready check: the pull request's evidence, run again at its head by a script (ADR-0011 D12; rulebook crq VB3,
# VB5). Source it after forge.sh and runs.sh; do not run it.
#
#   FACTORY_READY_COMMANDS   the programs an evidence command may start (default: make ./gradlew ./mvnw)
#   FACTORY_READY_CHECK      off skips the check, for a project whose required CI job already proves VB3 at the head
#   FACTORY_READY_ENV        the variables a command keeps (default: PATH LANG JAVA_HOME); all others are dropped
#   FACTORY_READY_TIMEOUT    seconds a command may run before it is stopped and counts as failed (default: 1800)
#
# The evidence is a line "Evidence at <sha>" in the description, then a table: | criterion | command | result |.
# Each command whose program is listed in FACTORY_READY_COMMANDS runs again in a fresh worktree at the head, with no
# shell: quotes group words and do nothing else, so ; | && $( ) are plain text. A command it may not run, such as a
# curl call to the running app (VB4), is left to the reviewer. At least one command must run.
# A command runs the MR's own build files, so it gets none of this machine's logins: a fresh HOME, an empty
# GH_CONFIG_DIR, no system or global git config, and only the variables FACTORY_READY_ENV names.

# run_isolated DIR SECONDS LOG COMMAND... : runs COMMAND in DIR with no login of this machine, stopped after SECONDS.
run_isolated() {
  i_dir=$1 i_secs=$2 i_log=$3; shift 3
  i_home=$(mktemp -d "${TMPDIR:-/tmp}/factory-ready.XXXXXX")
  mkdir "$i_home/gh"
  set -- GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null HOME="$i_home" GH_CONFIG_DIR="$i_home/gh" TMPDIR="$i_home" "$@"
  for v in ${FACTORY_READY_ENV:-PATH LANG JAVA_HOME}; do
    case $v in [A-Za-z_]*) ;; *) continue ;; esac
    case $v in *[!A-Za-z0-9_]*) continue ;; esac
    eval "[ -z \"\${$v+x}\" ] || set -- \"\$v=\$$v\" \"\$@\""
  done
  set -m   # the command gets its own process group, so a timeout stops everything it started
  (cd "$i_dir" && exec env -i "$@") >> "$i_log" 2>&1 < /dev/null &
  i_pid=$!
  set +m
  (sleep "$i_secs" && kill -TERM -- "-$i_pid" 2> /dev/null && echo "stopped after ${i_secs}s" >> "$i_log") \
    > /dev/null 2>&1 &
  i_watch=$!
  wait "$i_pid"; i_code=$?
  kill "$i_watch" 2> /dev/null; wait "$i_watch" 2> /dev/null
  rm -rf "$i_home"
  return "$i_code"
}

# evidence_sha DESCRIPTION : the commit the evidence names, or nothing.
evidence_sha() {
  printf '%s\n' "$1" | sed -n 's/^[[:space:]#*]*[Ee]vidence at[[:space:]`]*\([0-9a-f]\{7,40\}\).*/\1/p' | head -n 1
}

# evidence_commands DESCRIPTION : the command cell of each row of the table after the "Evidence at" line, one per
# line, without its backticks. A "\|" in a cell is a "|"; the header and the separator row are skipped.
evidence_commands() {
  printf '%s\n' "$1" | tr -d '\r' | awk '
    !seen { if ($0 ~ /^[[:space:]#*]*[Ee]vidence at/) seen = 1; next }
    /^[[:space:]]*\|/ { rows = 1
      line = $0; gsub(/\\\|/, "\001", line); n = split(line, cell, "|")
      if (n < 4) next
      c = cell[3]; gsub(/^[[:space:]`]+|[[:space:]`]+$/, "", c); gsub("\001", "|", c)
      h = cell[2]; gsub(/^[[:space:]]+|[[:space:]]+$/, "", h)
      if (tolower(h) == "criterion" || c ~ /^[-:]+$/ || c == "") next
      print c; next }
    rows { exit }'
}

# ready_check IID SHA BRANCH DESCRIPTION NOTES ME : succeeds when the evidence holds at SHA. Otherwise it posts one
# "[coordinator] not ready at SHA · description HASH: …" note and returns 1. The same head with the same description
# is not run again; a description edited after the note is, since a fix to the table needs no new commit. Returns 2, with nothing posted, when it
# cannot run the check at all.
ready_check() {
  r_iid=$1 r_sha=$2 r_branch=$3 r_desc=$4 r_notes=$5 r_me=$6
  [ "${FACTORY_READY_CHECK:-on}" != off ] || return 0
  r_hash=$(printf '%s' "$r_desc" | git hash-object --stdin | cut -c1-12)
  r_head="[coordinator] not ready at $r_sha · description $r_hash"
  if printf '%s' "$r_notes" | jq -e --arg me "$r_me" --arg h "$r_head" \
       'any(.[]; .author.username == $me and (.body | startswith($h)))' > /dev/null; then
    echo "$mark$r_iid is not ready at ${r_sha:0:8} with this description; the writer was told, so nothing runs again" >&2
    return 1
  fi
  allowed=" ${FACTORY_READY_COMMANDS:-make ./gradlew ./mvnw} "
  r_log="$FACTORY_REPO/.claude/ready/$r_iid-${r_sha:0:8}.log"
  failed='' ran=0 left=0
  at=$(evidence_sha "$r_desc")
  commands=$(evidence_commands "$r_desc")
  if [ -z "$at" ] || [ -z "$commands" ]; then
    failed="- the description has no evidence table: a line \"Evidence at <head>\", then | criterion | command | result | (rulebook crq VB5)"
  elif [ "${r_sha#"$at"}" = "$r_sha" ]; then
    failed="- the evidence is at $at, but the head is $r_sha (rulebook crq VB3)"
  else
    git -C "$FACTORY_REPO" fetch -q origin "+refs/heads/$r_branch:refs/factory/mr-$r_iid" \
      && [ "$(git -C "$FACTORY_REPO" rev-parse "refs/factory/mr-$r_iid")" = "$r_sha" ] \
      || { echo "$mark$r_iid: cannot fetch $r_branch at ${r_sha:0:8} for the ready check" >&2; return 2; }
    tree=$(worktree_path "ready-$r_iid")
    [ ! -e "$tree" ] || remove_worktree "$tree"
    mkdir -p "$(dirname "$tree")" "$(dirname "$r_log")" && : > "$r_log"
    git -C "$FACTORY_REPO" worktree add -q --detach "$tree" "$r_sha" \
      || { echo "$mark$r_iid: cannot make the worktree $tree" >&2; return 2; }
    while IFS= read -r command; do
      shown=$(printf '%s' "$command" | tr '`' "'")
      words=$(printf '%s\n' "$command" | xargs printf '%s\n' 2> /dev/null) \
        || { failed="$failed
- \`$shown\` cannot be read: an unmatched quote"; continue; }
      set --
      while IFS= read -r word; do set -- "$@" "$word"; done <<EOF
$words
EOF
      case $allowed in *" $1 "*) ;; *) left=$((left + 1)); continue ;; esac
      ran=$((ran + 1))
      printf '$ %s\n' "$command" >> "$r_log"
      run_isolated "$tree" "${FACTORY_READY_TIMEOUT:-1800}" "$r_log" "$@"
      code=$?
      [ "$code" -eq 0 ] || failed="$failed
- \`$shown\` exited $code"
    done <<EOF
$commands
EOF
    remove_worktree "$tree"
    [ "$ran" -gt 0 ] || [ -n "$failed" ] \
      || failed="- no evidence command starts a program this machine runs (FACTORY_READY_COMMANDS:$allowed)"
    failed=${failed#
}
  fi
  if [ -z "$failed" ]; then
    echo "ready $mark$r_iid at ${r_sha:0:8}: $ran evidence command(s) passed, $left left to the reviewer" >&2
    return 0
  fi
  [ ! -s "$r_log" ] || failed="$failed
- log: $r_log"
  forge_note "$r_iid" "$r_head: the review waits until this holds at the head

$failed" || return 2
  echo "$mark$r_iid is not ready at ${r_sha:0:8}: $(printf '%s\n' "$failed" | head -n 1 | sed 's/^- //')" >&2
  return 1
}
