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

forge_pr() {
  r=$(repo) || return 1
  pr=$(gh_api "repos/$r/pulls/$1") || return 1
  printf '%s' "$pr" | jq -c '{
    state: (if .merged then "merged" elif .state == "open" then "opened" else "closed" end),
    sha: .head.sha, source_branch: .head.ref, target_branch: .base.ref, labels: [.labels[].name],
    description: (.body // "")}'
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
