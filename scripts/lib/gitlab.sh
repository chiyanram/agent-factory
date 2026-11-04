# The one GitLab seam for the coordinator scripts (ADR-0009, #36). Source it; do not run it.
# Every GitLab call goes through gl_api, so a test swaps glab for a stub with FACTORY_GLAB and needs no network.
#
#   FACTORY_GLAB        the glab binary (default: glab), logged in as the coordinator's service account (ADR-0006)
#   FACTORY_PROJECT     the GitLab project path, for example aruvii/agent-platform
#   FACTORY_MAX_TRIES   calls per request while GitLab answers 429 (default: 4)
#   FACTORY_SLEEP       the command that waits between tries (default: sleep)

# gl_api ARGS... : one `glab api` request. Prints the body of a 2xx answer. On 429 it waits the Retry-After seconds
# and tries again, because 43 single-issue calls in a week ran into 429 (docs/archive/research/46 G8). Any other status fails.
gl_api() {
  tries=0
  max=${FACTORY_MAX_TRIES:-4}
  while :; do
    tries=$((tries + 1))
    # stderr stays out of the answer: glab prints an update notice there once a day (GLAB_CHECK_UPDATE)
    errors=$(mktemp "${TMPDIR:-/tmp}/gl_api.XXXXXX")
    answer=$(GLAB_CHECK_UPDATE=false "${FACTORY_GLAB:-glab}" api --include "$@" 2>"$errors")
    said=$(head -n 1 "$errors"); rm -f "$errors"
    code=$(printf '%s\n' "$answer" | head -n 1 | tr -d '\r' | sed -n 's/^HTTP\/[0-9.]* \([0-9][0-9][0-9]\).*/\1/p')
    body=$(printf '%s\n' "$answer" | tr -d '\r' | sed '1,/^$/d')
    case $code in
      2??) printf '%s\n' "$body"; return 0 ;;
      429)
        if [ "$tries" -ge "$max" ]; then
          echo "gitlab: HTTP 429 after $max tries: $*" >&2
          return 1
        fi
        wait=$(printf '%s\n' "$answer" | tr -d '\r' | sed '/^$/q' | sed -n 's/^[Rr]etry-[Aa]fter: *\([0-9][0-9]*\).*/\1/p')
        echo "gitlab: HTTP 429, retrying in ${wait:-60}s" >&2
        ${FACTORY_SLEEP:-sleep} "${wait:-60}"
        ;;
      "")
        echo "gitlab: no HTTP status from glab: ${said:-$(printf '%s\n' "$answer" | head -n 1)}" >&2
        return 1
        ;;
      *)
        echo "gitlab: HTTP $code on $*: $(printf '%s' "$body" | head -c 200)" >&2
        return 1
        ;;
    esac
  done
}

# project_ref : FACTORY_PROJECT as the URL-encoded id the REST API takes.
project_ref() {
  [ -n "${FACTORY_PROJECT:-}" ] || { echo "FACTORY_PROJECT is not set (for example aruvii/agent-platform)" >&2; return 1; }
  printf '%s' "$FACTORY_PROJECT" | sed 's|/|%2F|g'
}

# require_bot : fails unless glab acts as a bot or service account. Three of the old fleet's four agents posted
# with the operator's own token, so their notes and claims looked human (ADR-0006; agent-fleet #81).
require_bot() {
  me=$(gl_api user) || return 1
  if [ "$(printf '%s' "$me" | jq -r '.bot // false')" != true ]; then
    echo "refused: glab is logged in as $(printf '%s' "$me" | jq -r .username), a human account;" \
      "log it in as the coordinator's service account (ADR-0006)" >&2
    return 1
  fi
}

# mr_get IID : the merge request as the REST API returns it.
mr_get() {
  gl_api "projects/$(project_ref)/merge_requests/$1"
}

# valid_iid VALUE : fails unless VALUE is a merge request number.
valid_iid() {
  case $1 in
    '' | *[!0-9]*) echo "not a merge request number: '$1'" >&2; return 1 ;;
  esac
}
