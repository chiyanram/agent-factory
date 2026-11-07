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

# The REST answer already has the seam's names.
forge_pr() {
  gl_api "projects/$(project_ref)/merge_requests/$1"
}

# The writer reaches GitLab through the glab and git logins of the service account on this machine (ADR-0006).
forge_writer_ready() { :; }
forge_writer_setup() { :; }
