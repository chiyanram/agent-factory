#!/usr/bin/env bash
# github-app — acts as the factory's GitHub App, the bot a developer's own account owns (ADR-0006, ADR-0010).
#
#   github-app.sh token            prints an installation token for FACTORY_PROJECT, valid for at least 5 minutes
#   github-app.sh slug             prints the App's slug, as GitHub knows it; it posts as <slug>[bot]
#   github-app.sh gh ARGS...       runs gh as the App; the token lives only in that one gh process
#   github-app.sh git-credential get
#                                  answers git's credential protocol, so `git push` runs as the App
#
#   FACTORY_GH_APP_ID    the App's ID (App settings → General); else git config factory.ghAppId
#   FACTORY_GH_APP_KEY   the App's private key file (.pem), mode 600; else git config factory.ghAppKey
#   FACTORY_PROJECT      the repository, owner/name, where the App is installed; else git config factory.project
#   FACTORY_GH_REAL      the real gh binary (default: the first gh on PATH that is not scripts/bin/gh)
#   FACTORY_CURL         the curl binary (default: curl); a test points it at a stub
#
# The git config fallback lets a writer, inside a worktree of the factory's clone, run scripts/bin/gh and git push as
# the App with nothing in its environment (docs/setup/identity.md).
#
# An installation token lasts one hour. It is cached per App and project in ~/.cache/agent-factory (mode 600) and
# minted again 5 minutes before it ends, so no token is ever stored in an environment variable or a config file of gh.
set -u
set -o pipefail

here=$(cd "$(dirname "$0")" && pwd)
setting() { git config --get "factory.$1" 2> /dev/null; }
app=${FACTORY_GH_APP_ID:-$(setting ghAppId)} key=${FACTORY_GH_APP_KEY:-$(setting ghAppKey)}
project=${FACTORY_PROJECT:-$(setting project)}
cache_dir=${FACTORY_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/agent-factory}

fail() { echo "github-app: $*" >&2; exit 1; }

# GNU stat first: BSD stat rejects -c with nothing on stdout, while GNU stat -f prints file-system data before failing
mode() { stat -c %a "$1" 2> /dev/null || stat -f %Lp "$1"; }

check_setup() {
  [ -n "$app" ] || fail "FACTORY_GH_APP_ID is not set (the App's ID)"
  [ -f "$key" ] || fail "FACTORY_GH_APP_KEY must be the App's private key file, got '$key'"
  case $(mode "$key") in
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

# api METHOD PATH AUTH : one GitHub REST call; prints the body of a 2xx answer, else fails with the status. A 401 means
# GitHub refused the App itself: a wrong App ID, a revoked key, or this machine's clock is off.
api() {
  out=$("${FACTORY_CURL:-curl}" -sS -X "$1" -H "Authorization: $3" -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' -w '\n%{http_code}' "https://api.github.com/$2") || fail "cannot reach GitHub"
  code=$(printf '%s' "$out" | tail -n 1)
  said=$(printf '%s' "$out" | sed '$d' | jq -r '.message // empty' 2> /dev/null)
  case $code in
    2??) printf '%s' "$out" | sed '$d' ;;
    401) fail "HTTP 401 on $1 $2: GitHub refused App $app ($said); check the App ID, the key, and this machine's clock" ;;
    404) fail "HTTP 404 on $1 $2: the App $app is not installed on $project, or cannot see it" ;;
    *) fail "HTTP $code on $1 $2: $said" ;;
  esac
}

bearer() {
  check_setup
  j=$(jwt) || exit 1
  printf 'Bearer %s' "$j"
}

token() {
  b=$(bearer) || exit 1
  cache="$cache_dir/$app-$(printf '%s' "$project" | tr '/' '_').json"
  if [ -f "$cache" ] && [ "$(jq -r '.until // 0' "$cache" 2> /dev/null || echo 0)" -gt $(( $(date +%s) + 300 )) ]; then
    jq -r .token "$cache"; return
  fi
  installation=$(api GET "repos/$project/installation" "$b") || exit 1
  minted=$(api POST "app/installations/$(printf '%s' "$installation" | jq -r .id)/access_tokens" "$b") || exit 1
  minted=$(printf '%s' "$minted" | jq -r '.token // empty')
  [ -n "$minted" ] || fail "GitHub gave no token for $project"
  mkdir -p "$cache_dir" && chmod 700 "$cache_dir"
  # a new file, then a rename: a reader never sees half a token
  ( umask 077; jq -n --arg t "$minted" --argjson u $(( $(date +%s) + 3300 )) '{token: $t, until: $u}' > "$cache.new" ) \
    && mv "$cache.new" "$cache"
  printf '%s' "$minted"
}

# the gh to run: never scripts/bin/gh itself, which would call this script again without end
real_gh() {
  [ -z "${FACTORY_GH_REAL:-}" ] || { printf '%s' "$FACTORY_GH_REAL"; return; }
  PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -vxF "$here/bin" | paste -sd: -) command -v gh \
    || fail "no gh on PATH besides $here/bin/gh"
}

case ${1:-} in
  token) token; echo ;;
  slug) b=$(bearer) || exit 1; answer=$(api GET app "$b") || exit 1; printf '%s' "$answer" | jq -r .slug ;;
  gh) shift; t=$(token) || exit 1; gh=$(real_gh) || exit 1; GH_TOKEN=$t exec "$gh" "$@" ;;
  git-credential)
    [ "${2:-}" = get ] || exit 0   # store and erase: the cache above is the only store
    t=$(token) || exit 1
    printf 'username=x-access-token\npassword=%s\n' "$t" ;;
  *) echo "usage: github-app.sh token | slug | gh ARGS... | git-credential get" >&2; exit 2 ;;
esac
