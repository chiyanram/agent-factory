# The GitHub adapter of the forge seam (ADR-0010). Source lib/forge.sh, not this file.
# Every GitHub call goes through gh_api, so a test swaps gh for a stub with FACTORY_GH and needs no network.
#
#   FACTORY_GH           the gh binary that acts as the factory's GitHub App (default: scripts/bin/gh, which mints the
#                        App's token with scripts/github-app.sh); the operator's own gh login is never used (ADR-0006)
#   FACTORY_GH_APP       scripts/github-app.sh (default); a test points it at a stub
#   FACTORY_PROJECT      the repository, owner/name, for example chiyanram/ledger
#
# Only branches in the repository itself are supported: the writer pushes there, and a fork's branch cannot be
# fetched from origin.
. "$(dirname "${BASH_SOURCE[0]}")/http.sh"
. "$(dirname "${BASH_SOURCE[0]}")/git.sh"
export GH_NO_UPDATE_NOTIFIER=1 GH_PROMPT_DISABLED=1

# gh_api ARGS... : one `gh api` request (lib/http.sh).
gh_api() {
  http_api github "${FACTORY_GH:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../bin" && pwd)/gh}" "$@"
}

repo() {
  case ${FACTORY_PROJECT:-} in
    */*) printf '%s' "$FACTORY_PROJECT" ;;
    *) echo "FACTORY_PROJECT must be owner/name (for example chiyanram/ledger), got '${FACTORY_PROJECT:-}'" >&2; return 1 ;;
  esac
}

# gh_post PATH JSON [METHOD] : sends JSON as the request body, so no value is parsed as a gh field.
gh_post() {
  input=$(mktemp "${TMPDIR:-/tmp}/factory-gh.XXXXXX")
  printf '%s' "$2" > "$input"
  gh_api "$1" -X "${3:-POST}" --input "$input"; status=$?
  rm -f "$input"; return "$status"
}

# The bot is a GitHub App that the developer's account owns (#64 Q1, amended 2026-11-05). Only an App's installation
# token can list its installation's repositories; a person's token gets 403 there, so it is refused before any write.
# The App's name comes from GitHub (github-app.sh slug), never from a setting: the reviewer counts its rounds by it.
forge_require_bot() {
  if ! installed=$(gh_api 'installation/repositories?per_page=100'); then
    echo "refused: gh is not acting as the factory's GitHub App, so it may be a person's login;" \
      "point FACTORY_GH at scripts/bin/gh with the App configured (ADR-0006, ADR-0010)" >&2
    return 1
  fi
  [ "$(printf '%s' "$installed" | jq --arg p "${FACTORY_PROJECT:-}" 'any(.repositories[]; .full_name == $p)')" = true ] \
    || { echo "refused: the factory's GitHub App is not installed on ${FACTORY_PROJECT:-}" >&2; return 1; }
  slug=$("${FACTORY_GH_APP:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/github-app.sh}" slug) || return 1
  me_name="$slug[bot]"
}

forge_pr() {
  r=$(repo) || return 1
  pr=$(gh_api "repos/$r/pulls/$1") || return 1
  printf '%s' "$pr" | jq -c '{
    state: (if .merged then "merged" elif .state == "open" then "opened" else "closed" end),
    sha: .head.sha, source_branch: .head.ref, target_branch: .base.ref, labels: [.labels[].name],
    description: (.body // "")}'
}

forge_default_branch() {
  r=$(repo) || return 1
  project=$(gh_api "repos/$r") || return 1
  printf '%s' "$project" | jq -r .default_branch
}

forge_label_add() {
  r=$(repo) || return 1
  after=$(gh_post "repos/$r/issues/$1/labels" "$(jq -cn --arg l "$2" '{labels: [$l]}')") || return 1
  [ "$(printf '%s' "$after" | jq --arg l "$2" 'map(.name) | index($l) != null')" = true ] \
    || { echo "#$1: GitHub did not keep the label $2" >&2; return 1; }
}

# GitHub answers 404 when the label is already gone (a human removed it after the caller looked). That is a release,
# so a failed DELETE counts only when the label is still on the pull request.
forge_label_remove() {
  r=$(repo) || return 1
  gh_api "repos/$r/issues/$1/labels/$(printf '%s' "$2" | jq -sRr @uri)" -X DELETE > /dev/null 2>&1 && return 0
  after=$(forge_pr "$1") || return 1
  ! has_label "$after" "$2" || { echo "#$1: GitHub did not remove the label $2" >&2; return 1; }
}

forge_note() {
  r=$(repo) || return 1
  gh_post "repos/$r/issues/$1/comments" "$(jq -cn --arg b "$2" '{body: $b}')" > /dev/null
}

# every page, oldest first, in the seam's shape
forge_notes() {
  r=$(repo) || return 1
  notes='[]' page=1
  while :; do
    batch=$(gh_api "repos/$r/issues/$1/comments?per_page=100&page=$page") || return 1
    notes=$(printf '%s %s' "$notes" "$batch" | jq -cs '.[0] + (.[1] | map({body, author: {username: .user.login}}))')
    [ "$(printf '%s' "$batch" | jq length)" -eq 100 ] || break
    page=$((page + 1))
  done
  printf '%s\n' "$notes"
}

# GitHub anchors a review comment only to a line in the diff; otherwise the finding goes out as a plain comment that
# names file:line. The file:line goes after the seat prefix, so the note still starts "[reviewer] " and reads as the
# factory's own under the developer's login (#128).
forge_line_finding() {
  line_note='. as $x | ($x.file) as $f | ($x.line) as $l | {body: ($b | if test("^\\[[a-z]+\\] ") then sub("^(?<p>\\[[a-z]+\\] )"; "\(.p)`\($f):\($l)` ") else "`\($f):\($l)` " + . end)}'
  r=$(repo) || return 1
  comment=$(printf '%s' "$3" | jq -c --arg b "$4" --arg sha "$(printf '%s' "$2" | jq -r .sha)" \
    '{body: $b, commit_id: $sha, path: .file, line: .line, side: "RIGHT"}')
  gh_post "repos/$r/pulls/$1/comments" "$comment" > /dev/null 2>&1 && return 0
  gh_post "repos/$r/issues/$1/comments" "$(printf '%s' "$3" | jq -c --arg b "$4" "$line_note")" \
    > /dev/null
}

# A writer runs as the person's OS user, so its session could reach the person's own gh and git logins. Two calls keep
# it to the App's identity (ADR-0010):
#   forge_writer_ready       the clone pushes over https, with the App's credential helper first and alone, and
#                            commits under the bot's email
#   forge_writer_setup PATH  the worktree's .claude/settings.local.json gives the session an empty GH_CONFIG_DIR and no
#                            system or global git config, so plain gh has no login and git asks only the App's helper
forge_writer_ready() {
  refuse() { echo "refused: FACTORY_REPO $*; see GUIDE.md, Set up the bot, GitHub step 5" >&2; return 1; }
  case $(hgit -C "$FACTORY_REPO" remote get-url --push origin 2> /dev/null) in
    https://github.com/*) ;;
    *) refuse "does not push to https://github.com/, so git would not ask the App's credential helper"; return 1 ;;
  esac
  helpers=$(hgit -C "$FACTORY_REPO" config --local --get-all credential.https://github.com.helper)
  [ "$(printf '%s\n' "$helpers" | sed -n 1p)" = "" ] && [ "$(printf '%s\n' "$helpers" | wc -l | tr -d ' ')" = 2 ] \
    && case $(printf '%s\n' "$helpers" | sed -n 2p) in *github-app.sh*git-credential*) true ;; *) false ;; esac \
    || { refuse "would let another credential helper answer before the App's: set an empty helper, then the App's"; return 1; }
  case $(hgit -C "$FACTORY_REPO" config --local --get user.email) in
    *'[bot]@users.noreply.github.com') ;;
    *) refuse "would commit under a person's email: set user.email to the bot's noreply address"; return 1 ;;
  esac
}

# forge_writer_setup DIR : needs writer_settings from lib/runs.sh.
forge_writer_setup() {
  empty="$FACTORY_REPO/.claude/runs/gh-no-login"
  mkdir -p "$empty" || return 1
  writer_settings "$1" "$(jq -cn --arg gh "$empty" '{env: {GH_CONFIG_DIR: $gh, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null"}}')" \
    || return 1
  echo "For every GitHub call use $(cd "$(dirname "${BASH_SOURCE[0]}")/../bin" && pwd)/gh: it acts as the factory's GitHub App. Plain gh has no login in this session."
}

# gh_graphql QUERY LABEL : the query's data.repository, or a failure that names the GraphQL error.
gh_graphql() {
  r=$(repo) || return 1
  answer=$(gh_api graphql -f query="$1" -f owner="${r%%/*}" -f name="${r#*/}" -f label="$2") || return 1
  problem=$(printf '%s' "$answer" | jq -r '(.errors // [])[0].message // empty')
  [ -z "$problem" ] || { echo "GraphQL: $problem" >&2; return 1; }
  [ "$(printf '%s' "$answer" | jq '.data.repository == null')" = false ] \
    || { echo "no repository $r, or gh cannot see it" >&2; return 1; }
  printf '%s' "$answer" | jq -c .data.repository
}

forge_claimed() {
  case $1 in
    opened) state=OPEN ;;
    merged) state=MERGED ;;
    *) echo "forge_claimed: state must be opened or merged, got '$1'" >&2; return 1 ;;
  esac
  query='query($owner: String!, $name: String!, $label: String!) { repository(owner: $owner, name: $name) {
  pullRequests(states: ['"$state"'], labels: [$label], first: 100) { nodes { number } } } }'
  repository=$(gh_graphql "$query" "$2") || return 1
  printf '%s' "$repository" | jq -r '.pullRequests.nodes[].number'
}

# forge_changes LABEL : the open PRs and the merged PRs that carry LABEL, in the shape scripts/poll.sh decides on.
# One GraphQL query. Values go in as GraphQL variables, never into the query text.
#
#   members   {login: "maintainer" (write access or more) | "member" (any other collaborator)}
#   edits     the PR body's newest 100 edits (userContentEdits lists the newest first)
#   pipeline  the head commit's checks (statusCheckRollup), in poll's words: success, failed, running or none
#   window    the oldest edit when the last-100 window is full, so an older edit may be out of view; else null
forge_changes() {
  query='query($owner: String!, $name: String!, $label: String!) { repository(owner: $owner, name: $name) {
  collaborators(first: 100) { edges { permission node { login } } }
  open: pullRequests(states: [OPEN], first: 50) { nodes {
    number isDraft headRefOid
    labels(first: 50) { nodes { name } }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    comments(last: 100) { nodes { body createdAt author { login __typename } } }
    userContentEdits(first: 100) { nodes { editedAt editor { login __typename } } } } }
  merged: pullRequests(states: [MERGED], labels: [$label], first: 20) { nodes { number } } } }'
  repository=$(gh_graphql "$query" "$1") || return 1
  printf '%s' "$repository" | jq -c '
    def who: if . == null then null else {name: .login, bot: (.__typename == "Bot")} end;
    def pipeline: {SUCCESS: "success", FAILURE: "failed", ERROR: "failed", PENDING: "running", EXPECTED: "running"}[.]
      // "none";
    { members: (.collaborators.edges | map({key: .node.login,
        value: (if .permission == "WRITE" or .permission == "MAINTAIN" or .permission == "ADMIN"
                then "maintainer" else "member" end)}) | from_entries),
      open: [ .open.nodes[] | (.userContentEdits.nodes | sort_by(.editedAt)) as $edits | {
        number, draft: .isDraft, head: .headRefOid, labels: [.labels.nodes[].name],
        pipeline: (.commits.nodes[0].commit.statusCheckRollup.state // "" | pipeline),
        comments: [.comments.nodes[] | {body, at: .createdAt, author: (.author | who)}],
        edits: [$edits[] | {at: .editedAt, author: (.editor | who)}],
        window: (if ($edits | length) >= 100 then $edits[0].editedAt else null end) } ],
      merged: [ .merged.nodes[].number ] }'
}
