# The forge seam for the coordinator scripts (ADR-0010). Source it; do not run it.
# FACTORY_FORGE picks the adapter for the project: gitlab (default, lib/gitlab.sh) or github (lib/github.sh).
# Every adapter defines the same calls, and each call answers in the same shape:
#
#   forge_require_bot           fails unless the CLI acts as the coordinator's bot; sets me_name (ADR-0006)
#   forge_pr N                  {state: opened|merged|closed, sha, source_branch, target_branch, labels: [name]}
#   forge_default_branch        the project's default branch
#   forge_label_add N LABEL     fails unless the forge kept the label
#   forge_label_remove N LABEL
#   forge_note N BODY           one comment on the change
#   forge_notes N               every comment, oldest first: [{body, author: {username}}]
#   forge_line_finding N CHANGE FINDING TEXT
#                               one comment at FINDING's file:line ({file, line}) on the head of CHANGE, the forge_pr
#                               answer; unanchored, naming
#                               file:line, when the forge refuses that line
#   forge_claimed STATE LABEL   the numbers of the changes in STATE (opened or merged) that carry LABEL, one per line
#   forge_changes LABEL         the open and merged changes, in the shape scripts/poll.sh decides on
#   forge_writer_ready          fails unless a writer in FACTORY_REPO would push and commit as the bot
#   forge_writer_setup PATH     keeps the writer's session in worktree PATH to the bot's identity; prints any extra
#                               line the writer's prompt needs
#
# mark is the change's prefix in every line a script prints: ! on GitLab, # on GitHub.

case ${FACTORY_FORGE:-gitlab} in
  gitlab) . "$(dirname "${BASH_SOURCE[0]}")/gitlab.sh"; mark='!' ;;
  github) . "$(dirname "${BASH_SOURCE[0]}")/github.sh"; mark='#' ;;
  *) echo "FACTORY_FORGE must be gitlab or github, got '$FACTORY_FORGE'" >&2; exit 1 ;;
esac

# FACTORY_DRY_RUN=1 (ADR-0011 D14): every forge write of the coordinator's own scripts (poll, claim, release, status,
# ask, block, reconcile) is printed on stderr instead of made, and their one-line answer ends in " (dry run)". Reads
# still go to the forge, so a pilot can check the scripts' decisions against a real project without changing it.
# start-writer and start-reviewer refuse a dry run: a writer pushes and a reviewer spends.
dry=
if [ "${FACTORY_DRY_RUN:-}" = 1 ]; then
  dry=' (dry run)'
  forge_label_add() { echo "DRY RUN: add the label $2 to $mark$1" >&2; }
  forge_label_remove() { echo "DRY RUN: remove the label $2 from $mark$1" >&2; }
  forge_note() { echo "DRY RUN: note on $mark$1: $(printf '%s' "$2" | head -n 1)" >&2; }
  forge_line_finding() { echo "DRY RUN: finding on $mark$1 at $(printf '%s' "$3" | jq -r '"\(.file):\(.line)"')" >&2; }
fi

# valid_iid VALUE : fails unless VALUE is a change number.
valid_iid() {
  case $1 in
    '' | *[!0-9]*) echo "not a merge request number: '$1'" >&2; return 1 ;;
  esac
}

# has_label CHANGE LABEL : succeeds when the forge_pr answer CHANGE carries LABEL.
has_label() {
  [ "$(printf '%s' "$1" | jq --arg l "$2" '.labels | index($l) != null')" = true ]
}
