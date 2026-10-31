#!/usr/bin/env bash
# poll — one line of facts per open MR, read from GitLab as it is now (docs/playbooks/coordinator.md §Scripts, #36).
#
#   !12 head=1a2b3c4d draft=yes claimed=no approved=yes pipeline=success needs_human=no stop=no asks=0
#   !9 merged claimed=yes
#
# The coordinator decides; poll only reports. It keeps no state between runs, so a restart or a compaction loses
# nothing (ADR-0002; research/37 P3). One GraphQL query per poll, because single calls ran into 429 (research/46 G8).
#
#   approved  yes: the last /approved from a human maintainer is newer than the last description edit
#             stale: it is older than that edit (research/46 G3)    no: there is none
#             Only a note whose first line is exactly /approved counts, from an account that is not a bot, not
#             named FACTORY_AGENT_PREFIX* (default agent-), and at least Maintainer on the project.
#   stop      yes: that maintainer's last /stop is newer than the last /approved
#   pipeline  the head pipeline's status, "stale" when it ran on an older head, "none" when there is none
#   asks      [coordinator] OPEN: notes with no human note after them (research/46 G6)
#   claimed   the MR carries FACTORY_CLAIM_LABEL (default agent::claimed)
set -u
. "$(dirname "$0")/lib/gitlab.sh"

project=${FACTORY_PROJECT:-}
label=${FACTORY_CLAIM_LABEL:-agent::claimed}
printf '%s' "$project" | grep -Eq '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)+$' \
  || { echo "FACTORY_PROJECT must be a GitLab project path such as aruvii/agent-platform, got '$project'" >&2; exit 1; }
printf '%s' "$label" | grep -Eq '^[A-Za-z0-9 ._:-]+$' \
  || { echo "FACTORY_CLAIM_LABEL has characters a label query cannot carry: '$label'" >&2; exit 1; }

query="query { project(fullPath: \"$project\") {
  members: projectMembers(relations: [DIRECT, INHERITED], first: 100) {
    nodes { user { username } accessLevel { integerValue } } }
  open: mergeRequests(state: opened, first: 50) { nodes {
    iid draft diffHeadSha lastEditedAt
    labels { nodes { title } }
    headPipeline { status sha }
    notes(last: 100) { nodes { body createdAt system author { username bot } } } } }
  merged: mergeRequests(state: merged, labels: [\"$label\"], first: 20) { nodes { iid } } } }"

answer=$(gl_api graphql -f query="$query") || exit 1
problem=$(printf '%s' "$answer" | jq -r '(.errors // [])[0].message // empty')
[ -z "$problem" ] || { echo "GraphQL: $problem" >&2; exit 1; }
[ "$(printf '%s' "$answer" | jq '.data.project == null')" = false ] \
  || { echo "no project $project, or glab cannot see it" >&2; exit 1; }

printf '%s' "$answer" | jq -r --arg label "$label" --arg prefix "${FACTORY_AGENT_PREFIX:-agent-}" '
  .data.project as $p
  | ($p.members.nodes | map({key: .user.username, value: .accessLevel.integerValue}) | from_entries) as $level
  | def yn: if . then "yes" else "no" end;
    def command: .body | split("\n")[0] | gsub("^\\s+|\\s+$"; "");
    def maintainer: .author.bot == false and (.author.username | startswith($prefix) | not)
                    and ($level[.author.username] // 0) >= 40;
    def human: .author.bot == false and (.author.username | startswith($prefix) | not);
  [ ( $p.open.nodes[]
    | (.notes.nodes | map(select(.system | not)) | sort_by(.createdAt)) as $notes
    | ([$notes[] | select(maintainer and command == "/approved")] | last) as $approved
    | ([$notes[] | select(maintainer and command == "/stop")] | last) as $stop
    | ([$notes[] | select(human)] | last | .createdAt // "") as $lastHuman
    | [.labels.nodes[].title] as $labels
    | { iid: (.iid | tonumber),
        line: ("!\(.iid) head=\(.diffHeadSha[0:8]) draft=\(.draft | yn)"
          + " claimed=\($labels | index($label) != null | yn)"
          + " approved=\(if $approved == null then "no"
                         elif .lastEditedAt != null and $approved.createdAt <= .lastEditedAt then "stale"
                         else "yes" end)"
          + " pipeline=\(if .headPipeline == null then "none"
                         elif .headPipeline.sha != .diffHeadSha then "stale"
                         else .headPipeline.status | ascii_downcase end)"
          + " needs_human=\($labels | index("needs-human") != null | yn)"
          + " stop=\($stop != null and ($approved == null or $stop.createdAt > $approved.createdAt) | yn)"
          + " asks=\([$notes[] | select((human | not) and (.body | startswith("[coordinator] OPEN:"))
                                       and .createdAt > $lastHuman)] | length)") } ),
    ( $p.merged.nodes[] | {iid: (.iid | tonumber), line: "!\(.iid) merged claimed=yes"} ) ]
  | sort_by(.iid)[].line
'
