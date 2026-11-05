#!/usr/bin/env bash
# github-app — acts as the factory's GitHub App, the bot a developer's own account owns (ADR-0006, ADR-0010).
#
#   github-app.sh token            prints an installation token for FACTORY_PROJECT, valid for at least 5 minutes
#   github-app.sh gh ARGS...       runs gh as the App; the token lives only in that one gh process
#   github-app.sh git-credential get
#                                  answers git's credential protocol, so `git push` runs as the App
#
#   FACTORY_GH_APP_ID    the App's ID (App settings → General); else git config factory.ghAppId
#   FACTORY_GH_APP_KEY   the App's private key file (.pem), mode 600; else git config factory.ghAppKey
#   FACTORY_PROJECT      the repository, owner/name, where the App is installed; else git config factory.project
#
# The git config fallback lets a writer, inside a worktree of the factory's clone, run scripts/bin/gh and git push as
# the App with nothing in its environment (docs/setup/identity.md).
#   FACTORY_GH_REAL      the real gh binary (default: gh)
#   FACTORY_CURL         the curl binary (default: curl); a test points it at a stub
#
# An installation token lasts one hour. It is cached in ~/.cache/agent-factory (mode 600) and minted again 5 minutes
# before it ends, so no token is ever stored in an environment variable or a config file of gh.
set -u
set -o pipefail

setting() { git config --get "factory.$1" 2> /dev/null; }
app=${FACTORY_GH_APP_ID:-$(setting ghAppId)} key=${FACTORY_GH_APP_KEY:-$(setting ghAppKey)}
project=${FACTORY_PROJECT:-$(setting project)}
cache_dir=${FACTORY_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/agent-factory}

fail() { echo "github-app: $*" >&2; exit 1; }

check_setup() {
  [ -n "$app" ] || fail "FACTORY_GH_APP_ID is not set (the App's ID)"
  [ -f "$key" ] || fail "FACTORY_GH_APP_KEY must be the App's private key file, got '$key'"
  case $(stat -f %Lp "$key" 2> /dev/null || stat -c %a "$key") in
    600 | 400) ;;
    *) fail "the private key $key must be readable by its owner only: chmod 600 $key" ;;
  esac
  case $project in */*) ;; *) fail "FACTORY_PROJECT must be owner/name, got '$project'" ;; esac
}

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# a JSON Web Token signed with the App's key, valid 9 minutes (GitHub allows 10), back-dated 60s for clock skew
jwt() {
  now=$(date +%s)
  head=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
  body=$(printf '{"iat":%s,"exp":%s,"iss":"%s"}' $((now - 60)) $((now + 540)) "$app" | b64url)
  sig=$(printf '%s.%s' "$head" "$body" | openssl dgst -sha256 -sign "$key" | b64url) || fail "cannot sign with $key"
  printf '%s.%s.%s' "$head" "$body" "$sig"
}

# api METHOD PATH AUTH : one GitHub REST call; prints the body of a 2xx answer, else fails with the status
api() {
  out=$("${FACTORY_CURL:-curl}" -sS -X "$1" -H "Authorization: $3" -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' -w '\n%{http_code}' "https://api.github.com/$2") || fail "cannot reach GitHub"
  code=$(printf '%s' "$out" | tail -n 1)
  case $code in
    2??) printf '%s' "$out" | sed '$d' ;;
    *) fail "HTTP $code on $1 $2: $(printf '%s' "$out" | sed '$d' | jq -r '.message // empty' 2> /dev/null)" ;;
  esac
}

token() {
  check_setup
  cache="$cache_dir/$(printf '%s' "$project" | tr '/' '_').json"
  if [ -f "$cache" ] && [ "$(jq -r '.until' "$cache")" -gt $(( $(date +%s) + 300 )) ]; then
    jq -r .token "$cache"; return
  fi
  bearer="Bearer $(jwt)"
  installation=$(api GET "repos/$project/installation" "$bearer" | jq -r .id) \
    || fail "the App $app is not installed on $project"
  minted=$(api POST "app/installations/$installation/access_tokens" "$bearer" | jq -r .token)
  [ -n "$minted" ] && [ "$minted" != null ] || fail "GitHub gave no token for $project"
  mkdir -p "$cache_dir" && chmod 700 "$cache_dir"
  ( umask 077; jq -n --arg t "$minted" --argjson u $(( $(date +%s) + 3300 )) '{token: $t, until: $u}' > "$cache" )
  printf '%s' "$minted"
}

case ${1:-} in
  token) token; echo ;;
  gh) shift; t=$(token) || exit 1; GH_TOKEN=$t exec "${FACTORY_GH_REAL:-gh}" "$@" ;;
  git-credential)
    [ "${2:-}" = get ] || exit 0   # store and erase: the cache above is the only store
    t=$(token) || exit 1
    printf 'username=x-access-token\npassword=%s\n' "$t" ;;
  *) echo "usage: github-app.sh token | gh ARGS... | git-credential get" >&2; exit 2 ;;
esac
