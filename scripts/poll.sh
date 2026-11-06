#!/usr/bin/env bash
# poll — one line of facts per open MR, read from GitLab as it is now (GUIDE.md §Scripts, #36).
#
#   !12 head=1a2b3c4d draft=yes claimed=no approved=yes pipeline=success needs_human=no stop=no asks=0
#   !9 merged claimed=yes
#
# The coordinator decides; poll only reports. It keeps no state between runs, so a restart or a compaction loses
# nothing (ADR-0002; docs/archive/research/37 P3). The forge adapter reads (forge_changes, one query); this file decides, the same
# way on every forge (ADR-0010). On GitHub the lines start with # and a maintainer is a collaborator with write access.
#
#   approved  yes: the last /approved from a human maintainer is newer than the last description edit by a human
#             (the activity note GitLab writes with action "description"; the writer's own edits do not count, #56)
#             stale: it is older than that edit (docs/archive/research/46 G3)    no: there is none
#             Only a note whose first line is exactly /approved counts, from an account that is not a bot, not
#             named FACTORY_AGENT_PREFIX* (default agent-), and at least Maintainer on the project.
#   stop      yes: that maintainer's last /stop is newer than the last /approved
#   pipeline  the status of the pipeline for the current head; GitLab returns none for an older head ("none")
#   asks      [coordinator] OPEN: and [writer] OPEN: notes with no note from a human project member after them
#             (docs/archive/research/46 G6; ADR-0011 D10)
#   claimed   the MR carries FACTORY_CLAIM_LABEL (default agent::claimed)
set -u
. "$(dirname "$0")/lib/forge.sh"
label=${FACTORY_CLAIM_LABEL:-agent::claimed}
changes=$(forge_changes "$label") || exit 1

printf '%s' "$changes" | jq -r --arg mark "$mark" --arg label "$label" --arg prefix "${FACTORY_AGENT_PREFIX:-agent-}" '
  .members as $level
  | def yn: if . then "yes" else "no" end;
    def command: .body | split("\n")[0] | gsub("^\\s+|\\s+$"; "");
    def human: . != null and .bot == false and (.name | startswith($prefix) | not);
    def member: (.author | human) and $level[.author.name] != null;
    def maintainer: (.author | human) and $level[.author.name] == "maintainer";
  [ ( .open[]
    | (.comments | sort_by(.at)) as $notes
    | ([$notes[] | select(maintainer and command == "/approved")] | last) as $approved
    | ([$notes[] | select(maintainer and command == "/stop")] | last) as $stop
    | ([$notes[] | select(member)] | last | .at // "") as $lastMember
    # an edit makes an /approved stale unless it is provably by the writer (a bot or agent- account), since the
    # writer rewrites the body in its done phase (#56 A); an edit with no author counts
    | ([.edits | sort_by(.at)[] | select(.author == null or (.author | human))] | last | .at // "") as $edited
    # a full edit window that starts after the approval may hide an edit: count that as stale, never as fresh
    | (.window != null and $approved != null and $approved.at < .window) as $unknown
    | { number,
        line: ("\($mark)\(.number) head=\(.head[0:8]) draft=\(.draft | yn)"
          + " claimed=\(.labels | index($label) != null | yn)"
          + " approved=\(if $approved == null then "no"
                         elif $unknown or ($edited != "" and $approved.at <= $edited) then "stale"
                         else "yes" end)"
          + " pipeline=\(.pipeline)"
          + " needs_human=\(.labels | index("needs-human") != null | yn)"
          + " stop=\($stop != null and ($approved == null or $stop.at > $approved.at) | yn)"
          + " asks=\([$notes[] | select((.author | human | not) and (.body | startswith("[coordinator] OPEN:") or startswith("[writer] OPEN:"))
                                       and .at > $lastMember)] | length)") } ),
    ( .merged[] | {number: ., line: "\($mark)\(.) merged claimed=yes"} ) ]
  | sort_by(.number)[].line
'
