#!/usr/bin/env bash
# poll — one line of facts per open MR, read from GitLab as it is now (docs/playbooks/coordinator.md §Scripts, #36).
#
#   !12 head=1a2b3c4d draft=yes claimed=no approved=yes pipeline=success needs_human=no stop=no asks=0
#   !9 merged claimed=yes
#
# The coordinator decides; poll only reports. It keeps no state between runs, so a restart or a compaction loses
# nothing (ADR-0002; docs/archive/research/37 P3). One GraphQL query per poll, because single calls ran into 429 (docs/archive/research/46 G8).
#
#   approved  yes: the last /approved from a human maintainer is newer than the last description edit by a human
#             (the activity note GitLab writes with action "description"; the writer's own edits do not count, #56)
#             stale: it is older than that edit (docs/archive/research/46 G3)    no: there is none
#             Only a note whose first line is exactly /approved counts, from an account that is not a bot, not
#             named FACTORY_AGENT_PREFIX* (default agent-), and at least Maintainer on the project.
#   stop      yes: that maintainer's last /stop is newer than the last /approved
#   pipeline  the status of the pipeline for the current head; GitLab returns none for an older head ("none")
#   asks      [coordinator] OPEN: notes with no note from a human project member after them (docs/archive/research/46 G6)
#   claimed   the MR carries FACTORY_CLAIM_LABEL (default agent::claimed)
set -u
. "$(dirname "$0")/lib/gitlab.sh"

project=${FACTORY_PROJECT:-}
label=${FACTORY_CLAIM_LABEL:-agent::claimed}
[ -n "$project" ] || { echo "FACTORY_PROJECT is not set (for example aruvii/agent-platform)" >&2; exit 1; }

# Values go in as GraphQL variables, never into the query text, so no project path or label can change the query.
# Each is one plain string: glab rejects a bracketed field name (labels[]) in a GraphQL body.
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

answer=$(gl_api graphql -f query="$query" -f project="$project" -f label="$label") || exit 1
problem=$(printf '%s' "$answer" | jq -r '(.errors // [])[0].message // empty')
[ -z "$problem" ] || { echo "GraphQL: $problem" >&2; exit 1; }
[ "$(printf '%s' "$answer" | jq '.data.project == null')" = false ] \
  || { echo "no project $project, or glab cannot see it" >&2; exit 1; }

printf '%s' "$answer" | jq -r --arg label "$label" --arg prefix "${FACTORY_AGENT_PREFIX:-agent-}" '
  .data.project as $p
  | ($p.members.nodes | map(select(.user != null) | {key: .user.username, value: .accessLevel.integerValue})
     | from_entries) as $level
  | def yn: if . then "yes" else "no" end;
    def command: .body | split("\n")[0] | gsub("^\\s+|\\s+$"; "");
    def human: .author.bot == false and (.author.username | startswith($prefix) | not);
    def member: human and ($level[.author.username] // 0) > 0;
    def maintainer: human and ($level[.author.username] // 0) >= 40;
  [ ( $p.open.nodes[]
    | (.comments.nodes | sort_by(.createdAt)) as $notes
    | (.activity.nodes | sort_by(.createdAt)) as $activity
    | ([$notes[] | select(maintainer and command == "/approved")] | last) as $approved
    | ([$notes[] | select(maintainer and command == "/stop")] | last) as $stop
    | ([$notes[] | select(member)] | last | .createdAt // "") as $lastMember
    # an edit makes an /approved stale unless it is provably by the writer (a bot or agent- account), since the
    # writer rewrites the body in its done phase (#56 A); an edit with no author counts
    | ([$activity[] | select(.systemNoteMetadata.action == "description" and (.author == null or human))] | last | .createdAt // "") as $edited
    # a full activity window that starts after the approval may hide an edit: count that as stale, never as fresh
    | (($activity | length) >= 100 and $approved != null and $approved.createdAt < $activity[0].createdAt) as $unknown
    | [.labels.nodes[].title] as $labels
    | { iid: (.iid | tonumber),
        line: ("!\(.iid) head=\(.diffHeadSha[0:8]) draft=\(.draft | yn)"
          + " claimed=\($labels | index($label) != null | yn)"
          + " approved=\(if $approved == null then "no"
                         elif $unknown or ($edited != "" and $approved.createdAt <= $edited) then "stale"
                         else "yes" end)"
          + " pipeline=\(.headPipeline.status // "none" | ascii_downcase)"
          + " needs_human=\($labels | index("needs-human") != null | yn)"
          + " stop=\($stop != null and ($approved == null or $stop.createdAt > $approved.createdAt) | yn)"
          + " asks=\([$notes[] | select((human | not) and (.body | startswith("[coordinator] OPEN:"))
                                       and .createdAt > $lastMember)] | length)") } ),
    ( $p.merged.nodes[] | {iid: (.iid | tonumber), line: "!\(.iid) merged claimed=yes"} ) ]
  | sort_by(.iid)[].line
'
