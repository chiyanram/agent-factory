#!/usr/bin/env bash
# start-writer [--test-first] <mr> — starts a fresh writer for a claimed MR, in its own worktree at the MR's head (#39).
#
# Every run is fresh: it never resumes or continues a session, because a resumed worker drops instructions and its
# context rots (ADR-0001). The writer runs in the background as `claude --bg -n writer-<mr>`; FACTORY_RUN_MODE=print
# falls back to a foreground `claude -p` that removes its worktree when it exits. Refuses an MR that is not claimed or
# already has a live run, and refuses when this machine is at FACTORY_MAX_RUNS. Prints one line.
#
# The prompt only points at /crq: how to build lives in the project's /crq, not here (#39 Q2).
#
# --test-first, for a bug: a separate run that writes only the failing test from the bug spec, commits and pushes it,
# and stops. The fix writer starts after that commit, so the test and the fix never share one misreading (ADR-0011
# D12; rulebook crq VB7).
set -u
. "$(dirname "$0")/lib/forge.sh"
. "$(dirname "$0")/lib/runs.sh"
mode=build
[ "${1:-}" != --test-first ] || { mode=test-first; shift; }
iid=${1:-}
[ $# -le 1 ] || { echo "usage: start-writer.sh [--test-first] <mr>" >&2; exit 1; }
label=${FACTORY_CLAIM_LABEL:-agent::claimed}
valid_iid "$iid" || exit 1
[ "${FACTORY_DRY_RUN:-}" != 1 ] || { echo "refused: FACTORY_DRY_RUN is set, and a writer pushes to the MR branch; run it without the dry run" >&2; exit 1; }
require_repo || exit 1
forge_writer_ready || exit 1

mr=$(forge_pr "$iid") || exit 1
state=$(printf '%s' "$mr" | jq -r .state)
[ "$state" = opened ] || { echo "$mark$iid is $state; a writer runs only on an open MR" >&2; exit 1; }
has_label "$mr" "$label" \
  || { echo "$mark$iid is not claimed; claim it first, so it gets one run at a time" >&2; exit 1; }
branch=$(printf '%s' "$mr" | jq -r .source_branch)
sha=$(printf '%s' "$mr" | jq -r .sha)

runs=$(live_runs) || exit 1
if printf '%s\n' "$runs" | grep -Eqx "(writer|reviewer)-$iid"; then
  echo "$mark$iid already has a live run: $(printf '%s\n' "$runs" | grep -Ex "(writer|reviewer)-$iid")" >&2
  exit 1
fi
count=$(printf '%s\n' "$runs" | grep -c . || true)
[ "$count" -lt "${FACTORY_MAX_RUNS:-2}" ] \
  || { echo "this machine is at its run limit: $count live runs (FACTORY_MAX_RUNS=${FACTORY_MAX_RUNS:-2})" >&2; exit 1; }

hgit -C "$FACTORY_REPO" fetch -q origin "+refs/heads/$branch:refs/remotes/origin/$branch" \
  || { echo "cannot fetch $branch" >&2; exit 1; }
tip=$(hgit -C "$FACTORY_REPO" rev-parse "origin/$branch")
[ "$tip" = "$sha" ] || { echo "$mark$iid: the tip of $branch is ${tip:0:8}, but the MR's head is ${sha:0:8}; not started" >&2; exit 1; }

name=writer-$iid
path=$(worktree_path "$name")
[ ! -e "$path" ] || remove_worktree "$path"   # left by a dead run: never reuse it
mkdir -p "$(dirname "$path")"
hgit -C "$FACTORY_REPO" worktree add -q --track -B "$branch" "$path" "origin/$branch" \
  || { echo "cannot make the worktree $path" >&2; exit 1; }
note=$(forge_writer_setup "$path") || { remove_worktree "$path"; exit 1; }

# the project's writer tools (ADR-0011 D17): docs/agents/commands.md holds "lint-file: <command>", run on each file
# the writer edits, and "test-touched: <command>", its quick command for the tests it touched. It is read from the
# MR's target branch, never from the MR, because a hook runs with no permission prompt (ADR-0004).
target=$(printf '%s' "$mr" | jq -r '.target_branch // empty')
commands=''
[ -z "$target" ] || ! hgit -C "$FACTORY_REPO" fetch -q origin "+refs/heads/$target:refs/factory/target" 2> /dev/null \
  || commands=$(hgit -C "$FACTORY_REPO" show refs/factory/target:docs/agents/commands.md 2> /dev/null | tr -d '\r')
# the package's own CLI (npm run build), run by an absolute node: ask and the lint hook are TypeScript now (#138)
cli="$(printf '%q' "$(command -v node)") $(printf '%q' "$(cd "$(dirname "$0")/.." && pwd)/dist/cli.js")"
tool() { printf '%s\n' "$commands" | sed -n "s/^$1:[[:space:]]*//p" | head -n 1 | sed 's/^`\(.*\)`[[:space:]]*$/\1/; s/[[:space:]]*$//'; }
lint=$(tool lint-file)
quick=$(tool test-touched)
if [ -n "$lint" ]; then
  hook="$cli lint-edit $(printf '%q' "$lint")"
  writer_settings "$path" "$(jq -cn --arg c "$hook" \
    '{hooks: {PostToolUse: [{matcher: "Edit|MultiEdit|Write", hooks: [{type: "command", command: $c}]}]}}')" \
    || { remove_worktree "$path"; exit 1; }
fi
tools=''
[ -z "$lint" ] || tools="Each file you edit is linted at once with: $lint. Fix what it reports before you go on."
[ -z "$quick" ] || tools="${tools:+$tools
}Run the tests you touched with: $quick. Run the full check only before you push."

# the ask command carries its own settings, so it works whatever the writer's session inherits (ADR-0011 D10)
ask="FACTORY_FORGE=${FACTORY_FORGE:-gitlab} FACTORY_PROJECT=$(printf '%q' "$FACTORY_PROJECT")"
absolute() { case $1 in */*) (cd "$(dirname "$1")" && printf '%s/%s' "$(pwd)" "$(basename "$1")") ;; *) printf '%s' "$1" ;; esac; }
[ -z "${FACTORY_GLAB:-}" ] || ask="$ask FACTORY_GLAB=$(printf '%q' "$(absolute "$FACTORY_GLAB")")"
# on GitHub the writer's session has no gh login: the ask goes through the App's gh, as lib/github.sh's own calls do
ask="$ask FACTORY_GH=$(printf '%q' "$(absolute "${FACTORY_GH:-$(cd "$(dirname "$0")/bin" && pwd)/gh}")")"
ask="$ask $cli ask $iid \"\$(git rev-parse HEAD)\" '<the question in one line>'"
asking="When the contract does not settle a question, never guess: push your commits, then run
$ask
with the question in single quotes (write each ' inside it as '\\''), and stop without marking the MR ready.
If you cannot finish, push what you have and ask the same way, saying what blocks you."
if [ "$mode" = test-first ]; then
  prompt="You are the test writer for the bug in merge request $mark$iid in $FACTORY_PROJECT, on branch $branch at
head $sha. Write only the test that reproduces the bug as the MR description states it: its inputs and the result it
expects (rulebook crq VB7). Change no production code. Run the test and see it fail for the reason the bug states.
Commit only the test, with a message that starts \"test: failing test for\" and a line \"Written by a separate
test-first run (VB7).\", push it, and stop. Never fix the bug and never mark the MR ready.
$asking If the description names no inputs and expected result a test can check, ask the same way.
Push only this branch.${tools:+
$tools}${note:+
$note}"
else
  prompt="You are the writer for merge request $mark$iid in $FACTORY_PROJECT, on branch $branch at head $sha.
Run /crq from the build phase for this MR. The MR description is your contract: the intent, the acceptance criteria
and the design link. If a separate run committed a failing test for this bug, make it pass without changing it.
$asking
Before you mark the MR ready, put the evidence in its description (rulebook crq VB5): a line \"Evidence at <your
pushed head>\", then a table | criterion | command | result |. The review starts only after each command runs
again at the head, with no shell, so write each as one plain command: no pipe, no &&, no redirect.
Push only this branch; after a rebase use --force-with-lease.${tools:+
$tools}${note:+
$note}"
fi
who=writer; [ "$mode" = build ] || who="test writer"
set --
[ -z "${FACTORY_WRITER_MODEL:-}" ] || set -- --model "$FACTORY_WRITER_MODEL"

if [ "${FACTORY_RUN_MODE:-bg}" = print ]; then
  pidfile="$FACTORY_REPO/.claude/runs/$name.pid"
  mkdir -p "$(dirname "$pidfile")" && echo $$ > "$pidfile"   # a -p run is not in claude agents: this marks it live
  trap 'rm -f "$pidfile"; remove_worktree "$path"' EXIT
  # FACTORY_MAX_USD caps the run's spend (ADR-0011 D14); the CLI honours it in print mode only, not for --bg
  (cd "$path" && "${FACTORY_CLAUDE:-claude}" -p -n "$name" ${FACTORY_MAX_USD:+--max-budget-usd "$FACTORY_MAX_USD"} "$@" \
    "$prompt") >&2
  status=$?
  if [ "$status" -eq 0 ]; then echo "$who finished $mark$iid at ${sha:0:8}"
  else echo "$who failed $mark$iid at ${sha:0:8} (exit $status)"; fi
  exit "$status"
fi

if ! started=$(cd "$path" && "${FACTORY_CLAUDE:-claude}" --bg -n "$name" "$@" "$prompt" 2>&1); then
  remove_worktree "$path"
  echo "the $who for $mark$iid did not start: $started" >&2
  exit 1
fi
echo "$who started $mark$iid at ${sha:0:8}: $(printf '%s\n' "$started" | head -n 1)"
