#!/usr/bin/env bash
# start-reviewer <mr> — one review round on a claimed MR: pack → find → verify → post (#22; #39 PR 3).
#
#   1 Rounds so far are this account's "[reviewer] round N · head …" notes. After 3 the MR goes to the human (#22 Q5).
#   2 The context pack (scripts/pack.sh) for the head; from round 2, the interdiff since the last reviewed head.
#     When the patch-id equals the last round's, the verdict is reused: one line, no model run (#22 Q2).
#   3 FIND: one fresh `claude -p` on Sonnet. VERIFY: one fresh `claude -p` per kind, rule findings on Sonnet and
#     logic findings on Opus (#22 Q4). Every run has Read, Grep and Glob only, in a folder that holds the pack and a
#     copy of the code at the head with every CLAUDE.md, AGENTS.md, .claude/ and .agents/ removed: Claude loads a
#     CLAUDE.md from any folder it can read, and the MR must not choose its own rules (ADR-0004).
#   4 Before posting, the MR's head must still be the reviewed head; else MOVED, nothing posted (research/46 G7).
#   5 One summary note, then one diff thread per Act on and Consider finding at its file:line (#22 Q2).
#
#   FACTORY_REVIEW_FIND / FACTORY_REVIEW_VERIFY   the instructions (default prompts/review-*.md, #39 Q4)
#   FACTORY_FIND_MODEL, FACTORY_RULE_MODEL, FACTORY_LOGIC_MODEL   default sonnet, sonnet, opus
#
# Prints one line. Exits 0 when a verdict was posted or reused, 3 on MOVED, 1 otherwise.
set -u
set -o pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib/gitlab.sh"
. "$here/lib/runs.sh"
iid=${1:-}
label=${FACTORY_CLAIM_LABEL:-agent::claimed}
find_prompt=${FACTORY_REVIEW_FIND:-$here/../prompts/review-find.md}
verify_prompt=${FACTORY_REVIEW_VERIFY:-$here/../prompts/review-verify.md}
valid_iid "$iid" || exit 1
require_repo || exit 1
[ -f "$find_prompt" ] && [ -f "$verify_prompt" ] \
  || { echo "the review instructions are missing: $find_prompt, $verify_prompt" >&2; exit 1; }
require_bot || exit 1
reviewer=$(printf '%s' "$me" | jq -r .username)
ref=$(project_ref) || exit 1

mr=$(mr_get "$iid") || exit 1
[ "$(printf '%s' "$mr" | jq -r .state)" = opened ] || { echo "!$iid is not open" >&2; exit 1; }
[ "$(printf '%s' "$mr" | jq --arg l "$label" '.labels | index($l) != null')" = true ] \
  || { echo "!$iid is not claimed; claim it first, so it gets one run at a time" >&2; exit 1; }
sha=$(printf '%s' "$mr" | jq -r .sha)

runs=$(live_runs) || exit 1
if printf '%s\n' "$runs" | grep -Eqx "(writer|reviewer)-$iid"; then
  echo "!$iid already has a live run: $(printf '%s\n' "$runs" | grep -Ex "(writer|reviewer)-$iid")" >&2; exit 1
fi
count=$(printf '%s\n' "$runs" | grep -c . || true)
[ "$count" -lt "${FACTORY_MAX_RUNS:-2}" ] \
  || { echo "this machine is at its run limit: $count live runs (FACTORY_MAX_RUNS=${FACTORY_MAX_RUNS:-2})" >&2; exit 1; }

# 1 · rounds so far: only this account's notes count
notes=$(gl_api "projects/$ref/merge_requests/$iid/notes?sort=asc&order_by=created_at&per_page=100") || exit 1
mine=$(printf '%s' "$notes" | jq -r --arg me "$reviewer" '.[] | select(.author.username == $me) | .body | split("\n")[0]
  | select(startswith("[reviewer] round "))')
rounds=$(printf '%s\n' "$mine" | grep -Ec '^\[reviewer\] round [0-9]+ · head' || true)
[ "$rounds" -lt 3 ] || { echo "!$iid has had 3 review rounds; it goes to the human (label needs-human)" >&2; exit 1; }
round=$((rounds + 1))
last=$(printf '%s\n' "$mine" | grep -E '^\[reviewer\] round [0-9]+( reused)? · head [0-9a-f]{40} · patch-id [0-9a-f]+' | tail -n 1)
last_round=$(printf '%s' "$last" | sed -n 's/^\[reviewer\] round \([0-9]*\).*/\1/p')
last_head=$(printf '%s' "$last" | sed -n 's/.* · head \([0-9a-f]\{40\}\) · .*/\1/p')
last_pid=$(printf '%s' "$last" | sed -n 's/.* · patch-id \([0-9a-f]*\).*/\1/p')

# 2 · the pack, and verdict reuse
packed=$("$here/pack.sh" "$iid" ${last_head:+"$last_head"}) || exit 1
pack=${packed##*: }; pack=${pack% (reused)}
pid=$(sed -n 's/^- patch-id: \([0-9a-f]*\)$/\1/p' "$pack")

moved() {  # fails, with MOVED, when the MR's head is no longer the reviewed one
  now=$(mr_get "$iid" | jq -r .sha) || exit 1
  [ "$now" = "$sha" ] && return 0
  echo "MOVED: !$iid moved from ${sha:0:8} to ${now:0:8} during the review; nothing posted" >&2
  exit 3
}
post_note() {
  body=$(mktemp "${TMPDIR:-/tmp}/factory-note.XXXXXX")
  jq -cn --arg b "$1" '{body: $b}' > "$body"
  gl_api "projects/$ref/merge_requests/$iid/notes" -X POST --input "$body" > /dev/null; status=$?
  rm -f "$body"; return "$status"
}

if [ -n "$last_pid" ] && [ "$last_pid" = "$pid" ]; then
  moved
  post_note "[reviewer] round $last_round reused · head $sha · patch-id $pid" || exit 1
  echo "review !$iid at ${sha:0:8}: verdict of round $last_round reused"
  exit 0
fi

# 3 · find and verify, in a folder the MR's rules cannot reach
name=reviewer-$iid
pidfile="$FACTORY_REPO/.claude/runs/$name.pid"
run=$(mktemp -d "${TMPDIR:-/tmp}/factory-review.XXXXXX")
mkdir -p "$(dirname "$pidfile")" && echo $$ > "$pidfile"
trap 'rm -rf "$run"; rm -f "$pidfile"' EXIT
mkdir "$run/code"
git -C "$FACTORY_REPO" archive "$sha" | tar -x -C "$run/code" || { echo "cannot copy the code at ${sha:0:8}" >&2; exit 1; }
find "$run/code" \( -name CLAUDE.md -o -name CLAUDE.local.md -o -name AGENTS.md \) -type f -exec rm -f {} +
find "$run/code" \( -name .claude -o -name .agents \) -type d -prune -exec rm -rf {} +
cp "$pack" "$run/pack.md"

finding='{"type":"object","required":["id","axis","kind","file","line","rule","severity","finding","fix"],"properties":{
  "id":{"type":"string"},"axis":{"enum":["standards","spec"]},"kind":{"enum":["rule","logic"]},
  "file":{"type":"string"},"line":{"type":"integer"},"rule":{"type":"string"},
  "severity":{"enum":["blocker","warning","nit"]},"finding":{"type":"string"},"fix":{"type":"string"}}}'
find_schema="{\"type\":\"object\",\"required\":[\"findings\"],\"properties\":{\"findings\":{\"type\":\"array\",\"items\":$finding}}}"
verify_schema='{"type":"object","required":["verdicts"],"properties":{"verdicts":{"type":"array","items":{"type":"object",
  "required":["id","bucket","why"],"properties":{"id":{"type":"string"},
  "bucket":{"enum":["act_on","consider","noted","dismissed"]},"why":{"type":"string"}}}}}}'
echo 0 > "$run/cost"   # a file, because each review runs in a subshell
review() {  # review MODEL SCHEMA PROMPT-FILE PASS : one fresh read-only run; prints its structured output
  answer=$(cd "$run" && "${FACTORY_CLAUDE:-claude}" -p -n "$name" --model "$1" --tools Read,Grep,Glob \
    --output-format json --json-schema "$2" "$(cat "$3")") \
    && [ "$(printf '%s' "$answer" | jq -r '.is_error')" = false ] \
    && printf '%s' "$answer" | jq -e '.structured_output' > /dev/null \
    || { echo "!$iid: the $4 pass failed: $(printf '%s' "$answer" | jq -r '.result // empty' 2> /dev/null | head -c 200)" >&2; return 1; }
  printf '%s %s' "$(cat "$run/cost")" "$(printf '%s' "$answer" | jq -r '.total_cost_usd // 0')" \
    | awk '{printf "%.2f\n", $1 + $2}' > "$run/cost.new" && mv "$run/cost.new" "$run/cost"
  printf '%s' "$answer" | jq -c .structured_output
}

found=$(review "${FACTORY_FIND_MODEL:-sonnet}" "$find_schema" "$find_prompt" find) || exit 1
verdicts='[]'
for kind in rule logic; do
  subset=$(printf '%s' "$found" | jq -c --arg k "$kind" '[.findings[] | select(.kind == $k)]')
  [ "$subset" != '[]' ] || continue
  printf '%s' "$subset" > "$run/findings.json"
  model=${FACTORY_RULE_MODEL:-sonnet}; [ "$kind" = rule ] || model=${FACTORY_LOGIC_MODEL:-opus}
  checked=$(review "$model" "$verify_schema" "$verify_prompt" "verify ($kind)") || exit 1
  verdicts=$(printf '%s %s' "$verdicts" "$checked" | jq -cs '.[0] + .[1].verdicts')
done
# every finding gets a bucket: one the verify pass skipped is kept as Consider, never dropped
sorted=$(jq -cn --argjson f "$found" --argjson v "$verdicts" '[$f.findings[] | . as $x
  | ([$v[] | select(.id == $x.id)] | first) as $m
  | $x + {bucket: ($m.bucket // "consider"), why: ($m.why // "the verify pass gave no verdict")}]')

# 4 · never post against a head that moved
moved

# 5 · one summary note, one thread per Act on and Consider
n() { printf '%s' "$sorted" | jq --arg b "$1" '[.[] | select(.bucket == $b)] | length'; }
counts="Act on $(n act_on) · Consider $(n consider) · Noted $(n noted) · Dismissed $(n dismissed)"
lists=$(printf '%s' "$sorted" | jq -r '
  def bucket_name: {act_on: "Act on", consider: "Consider", noted: "Noted", dismissed: "Dismissed"}[.bucket];
  def line: "- \(bucket_name) \(.id) `\(.file):\(.line)` \(.rule): \(.finding) (\(.why))";
  "Standards", ([.[] | select(.axis == "standards") | line] | if length == 0 then ["- none"] else . end | .[]),
  "", "Spec", ([.[] | select(.axis == "spec") | line] | if length == 0 then ["- none"] else . end | .[])')
post_note "[reviewer] round $round · head $sha · patch-id $pid · $counts

$lists" || exit 1

refs=$(printf '%s' "$mr" | jq -c .diff_refs)
printf '%s' "$sorted" | jq -c '.[] | select(.bucket == "act_on" or .bucket == "consider")' | while IFS= read -r f; do
  text=$(printf '%s' "$f" | jq -r '"[reviewer] \(if .bucket == "act_on" then "Act on" else "Consider" end) \(.id) (\(.severity), \(.rule)): \(.finding)\n\nFix: \(.fix)"')
  thread=$(mktemp "${TMPDIR:-/tmp}/factory-thread.XXXXXX")
  printf '%s' "$f" | jq -c --arg b "$text" --argjson r "$refs" '{body: $b, position: {position_type: "text",
    base_sha: $r.base_sha, start_sha: $r.start_sha, head_sha: $r.head_sha, new_path: .file, new_line: .line}}' > "$thread"
  if ! gl_api "projects/$ref/merge_requests/$iid/discussions" -X POST --input "$thread" > /dev/null 2>&1; then
    # GitLab anchors a thread only to a line in the diff; otherwise it opens unanchored and names file:line
    printf '%s' "$f" | jq -c --arg b "$text" '{body: ("`\(.file):\(.line)` " + $b)}' > "$thread"
    gl_api "projects/$ref/merge_requests/$iid/discussions" -X POST --input "$thread" > /dev/null || { rm -f "$thread"; exit 1; }
  fi
  rm -f "$thread"
done || exit 1

echo "review !$iid round $round at ${sha:0:8}: $counts (\$$(cat "$run/cost"))"
