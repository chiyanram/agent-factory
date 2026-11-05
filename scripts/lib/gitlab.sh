# The GitLab adapter of the forge seam (ADR-0009, ADR-0010). Source lib/forge.sh, not this file.
# Every GitLab call goes through gl_api, so a test swaps glab for a stub with FACTORY_GLAB and needs no network.
#
#   FACTORY_GLAB        the glab binary (default: glab), logged in as the coordinator's service account (ADR-0006)
#   FACTORY_PROJECT     the GitLab project path, for example aruvii/agent-platform
. "$(dirname "${BASH_SOURCE[0]}")/http.sh"
export GLAB_CHECK_UPDATE=false   # glab prints an update notice once a day

# gl_api ARGS... : one `glab api` request (lib/http.sh).
gl_api() {
  http_api gitlab "${FACTORY_GLAB:-glab}" "$@"
}

# project_ref : FACTORY_PROJECT as the URL-encoded id the REST API takes.
project_ref() {
  [ -n "${FACTORY_PROJECT:-}" ] || { echo "FACTORY_PROJECT is not set (for example aruvii/agent-platform)" >&2; return 1; }
  printf '%s' "$FACTORY_PROJECT" | sed 's|/|%2F|g'
}

# Three of the old fleet's four agents posted with the operator's own token, so their notes and claims looked human
# (ADR-0006; agent-fleet #81). GitLab marks a bot or service account with bot: true.
forge_require_bot() {
  me=$(gl_api user) || return 1
  me_name=$(printf '%s' "$me" | jq -r .username)
  if [ "$(printf '%s' "$me" | jq -r '.bot // false')" != true ]; then
    echo "refused: glab is logged in as $me_name, a human account;" \
      "log it in as the coordinator's service account (ADR-0006)" >&2
    return 1
  fi
}

# The REST answer already has the seam's names; diff_refs stays for forge_line_finding.
forge_pr() {
  gl_api "projects/$(project_ref)/merge_requests/$1"
}

forge_default_branch() {
  project=$(gl_api "projects/$(project_ref)") || return 1
  printf '%s' "$project" | jq -r .default_branch
}

forge_label_add() {
  after=$(gl_api "projects/$(project_ref)/merge_requests/$1" -X PUT -f add_labels="$2") || return 1
  has_label "$after" "$2" || { echo "!$1: GitLab did not keep the label $2" >&2; return 1; }
}

forge_label_remove() {
  gl_api "projects/$(project_ref)/merge_requests/$1" -X PUT -f remove_labels="$2" > /dev/null
}

forge_note() {
  body=$(mktemp "${TMPDIR:-/tmp}/factory-note.XXXXXX")
  jq -cn --arg b "$2" '{body: $b}' > "$body"
  gl_api "projects/$(project_ref)/merge_requests/$1/notes" -X POST --input "$body" > /dev/null; status=$?
  rm -f "$body"; return "$status"
}

# every page: an MR with many notes must not push the reviewer's round notes out of view
forge_notes() {
  notes='[]' page=1
  while :; do
    batch=$(gl_api "projects/$(project_ref)/merge_requests/$1/notes?sort=asc&order_by=created_at&per_page=100&page=$page") \
      || return 1
    notes=$(printf '%s %s' "$notes" "$batch" | jq -cs '.[0] + .[1]')
    [ "$(printf '%s' "$batch" | jq length)" -eq 100 ] || break
    page=$((page + 1))
  done
  printf '%s\n' "$notes"
}

# forge_line_finding N CHANGE FINDING TEXT : CHANGE is the forge_pr answer, whose diff_refs anchor the thread.
# GitLab anchors a thread only to a line in the diff; otherwise it opens unanchored and names file:line.
forge_line_finding() {
  thread=$(mktemp "${TMPDIR:-/tmp}/factory-thread.XXXXXX")
  printf '%s' "$3" | jq -c --arg b "$4" --argjson r "$(printf '%s' "$2" | jq -c .diff_refs)" '{body: $b,
    position: {position_type: "text", base_sha: $r.base_sha, start_sha: $r.start_sha, head_sha: $r.head_sha,
    new_path: .file, new_line: .line}}' > "$thread"
  if ! gl_api "projects/$(project_ref)/merge_requests/$1/discussions" -X POST --input "$thread" > /dev/null 2>&1; then
    printf '%s' "$3" | jq -c --arg b "$4" '{body: ("`\(.file):\(.line)` " + $b)}' > "$thread"
    gl_api "projects/$(project_ref)/merge_requests/$1/discussions" -X POST --input "$thread" > /dev/null \
      || { rm -f "$thread"; return 1; }
  fi
  rm -f "$thread"
}

forge_claimed() {
  answer=$(gl_api "projects/$(project_ref)/merge_requests?state=$1&labels=$(printf '%s' "$2" | jq -sRr @uri)&per_page=100") \
    || return 1
  printf '%s' "$answer" | jq -r '.[].iid'
}

# forge_changes LABEL : the open MRs and the merged MRs that carry LABEL, in the shape scripts/poll.sh decides on.
# One GraphQL query, because single calls ran into 429 (research/46 G8). Values go in as GraphQL variables, never
# into the query text, so no project path or label can change the query. Each is one plain string: glab rejects a
# bracketed field name (labels[]) in a GraphQL body.
#
#   members   {username: "maintainer" (Maintainer or higher) | "member"}
#   edits     the description edits: the activity notes GitLab writes with action "description"
#   window    the first activity note when the last-100 window is full, so an older edit may be out of view; else null
forge_changes() {
  [ -n "${FACTORY_PROJECT:-}" ] || { echo "FACTORY_PROJECT is not set (for example aruvii/agent-platform)" >&2; return 1; }
  query='query($project: ID!, $label: String!) { project(fullPath: $project) {
  members: projectMembers(relations: [DIRECT, INHERITED], first: 100) {
    nodes { user { username } accessLevel { integerValue } } }
  open: mergeRequests(state: opened, first: 50) { nodes {
    iid draft diffHeadSha
    labels { nodes { title } }
    headPipeline { status }
    comments: notes(filter: ONLY_COMMENTS, last: 100) { nodes { body createdAt author { username bot } } }
    activity: notes(filter: ONLY_ACTIVITY, last: 100) { nodes { createdAt author { username bot } systemNoteMetadata { action } } } } }
  merged: mergeRequests(state: merged, labels: [$label], first: 20) { nodes { iid } } } }'
  answer=$(gl_api graphql -f query="$query" -f project="$FACTORY_PROJECT" -f label="$1") || return 1
  problem=$(printf '%s' "$answer" | jq -r '(.errors // [])[0].message // empty')
  [ -z "$problem" ] || { echo "GraphQL: $problem" >&2; return 1; }
  [ "$(printf '%s' "$answer" | jq '.data.project == null')" = false ] \
    || { echo "no project $FACTORY_PROJECT, or glab cannot see it" >&2; return 1; }
  printf '%s' "$answer" | jq -c '.data.project as $p
    | def who: if . == null then null else {name: .username, bot: .bot} end;
    { members: ($p.members.nodes | map(select(.user != null and .accessLevel.integerValue > 0)
        | {key: .user.username, value: (if .accessLevel.integerValue >= 40 then "maintainer" else "member" end)})
        | from_entries),
      open: [ $p.open.nodes[] | (.activity.nodes | sort_by(.createdAt)) as $activity | {
        number: (.iid | tonumber), draft, head: .diffHeadSha, labels: [.labels.nodes[].title],
        pipeline: (.headPipeline.status // "none" | ascii_downcase),
        comments: [.comments.nodes[] | {body, at: .createdAt, author: (.author | who)}],
        edits: [$activity[] | select(.systemNoteMetadata.action == "description") | {at: .createdAt, author: (.author | who)}],
        window: (if ($activity | length) >= 100 then $activity[0].createdAt else null end) } ],
      merged: [ $p.merged.nodes[].iid | tonumber ] }'
}
