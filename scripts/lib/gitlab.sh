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
    # the file:line goes after the seat prefix, so the note still starts "[reviewer] " (#128)
    printf '%s' "$3" | jq -c --arg b "$4" '. as $x | ($x.file) as $f | ($x.line) as $l | {body: ($b | if test("^\\[[a-z]+\\] ") then sub("^(?<p>\\[[a-z]+\\] )"; "\(.p)`\($f):\($l)` ") else "`\($f):\($l)` " + . end)}' > "$thread"
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

# The writer reaches GitLab through the glab and git logins of the service account on this machine (ADR-0006).
forge_writer_ready() { :; }
forge_writer_setup() { :; }
