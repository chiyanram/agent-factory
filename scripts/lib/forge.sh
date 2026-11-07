# The forge seam for the bash scripts not yet ported, start-writer.sh and tokens.sh (ADR-0010). Source it; do not run
# it. The TypeScript seam in src/core/forge/ has every call; this file goes when its last bash caller is ported (#138).
# FACTORY_FORGE picks the adapter for the project: gitlab (default, lib/gitlab.sh) or github (lib/github.sh).
# Every adapter defines the same calls, and each call answers in the same shape:
#
#   forge_pr N                  {state: opened|merged|closed, sha, source_branch, target_branch, labels: [name],
#                                description}
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
