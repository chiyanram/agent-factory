# One HTTP call through a forge CLI (glab or gh), with retries on a rate limit (ADR-0010). Source it; do not run it.
#
#   FACTORY_MAX_TRIES   calls per request while the forge answers with a rate limit (default: 4)
#   FACTORY_SLEEP       the command that waits between tries (default: sleep)

# http_wait HEADERS : the seconds to wait before the next try. Retry-After wins; else GitHub's rate-limit reset
# time; else 60.
http_wait() {
  after=$(printf '%s\n' "$1" | sed -n 's/^[Rr]etry-[Aa]fter: *\([0-9][0-9]*\).*/\1/p')
  reset=$(printf '%s\n' "$1" | sed -n 's/^[Xx]-[Rr]ate[Ll]imit-[Rr]eset: *\([0-9][0-9]*\).*/\1/p')
  if [ -n "$after" ]; then echo "$after"
  elif [ -n "$reset" ]; then echo $(( reset > $(date +%s) ? reset - $(date +%s) : 1 ))
  else echo 60; fi
}

# http_limited CODE HEADERS : succeeds when the answer is a rate limit. GitLab answers 429; GitHub answers 429, or 403
# with Retry-After or with no requests left (x-ratelimit-remaining: 0).
http_limited() {
  case $1 in
    429) return 0 ;;
    403) printf '%s\n' "$2" | grep -Eiq '^(retry-after:|x-ratelimit-remaining: *0$)' ;;
    *) return 1 ;;
  esac
}

# http_api NAME BINARY ARGS... : one `BINARY api --include ARGS` request. Prints the body of a 2xx answer. On a rate
# limit it waits and tries again, because 43 single-issue calls in a week ran into 429 (docs/archive/research/46 G8). Any other
# status fails, and the message starts with NAME.
http_api() {
  name=$1 bin=$2; shift 2
  tries=0
  max=${FACTORY_MAX_TRIES:-4}
  while :; do
    tries=$((tries + 1))
    # stderr stays out of the answer: a CLI prints an update notice there
    errors=$(mktemp "${TMPDIR:-/tmp}/http_api.XXXXXX")
    answer=$("$bin" api --include "$@" 2>"$errors")
    said=$(head -n 1 "$errors"); rm -f "$errors"
    code=$(printf '%s\n' "$answer" | head -n 1 | tr -d '\r' | sed -n 's/^HTTP\/[0-9.]* \([0-9][0-9][0-9]\).*/\1/p')
    headers=$(printf '%s\n' "$answer" | tr -d '\r' | sed '/^$/q')
    body=$(printf '%s\n' "$answer" | tr -d '\r' | sed '1,/^$/d')
    if [ -z "$code" ]; then
      echo "$name: no HTTP status from $(basename "$bin"): ${said:-$(printf '%s\n' "$answer" | head -n 1)}" >&2
      return 1
    fi
    case $code in 2??) printf '%s\n' "$body"; return 0 ;; esac
    if ! http_limited "$code" "$headers"; then
      echo "$name: HTTP $code on $*: $(printf '%s' "$body" | head -c 200)" >&2
      return 1
    fi
    if [ "$tries" -ge "$max" ]; then
      echo "$name: HTTP $code after $max tries: $*" >&2
      return 1
    fi
    wait=$(http_wait "$headers")
    echo "$name: HTTP $code, rate limited, retrying in ${wait}s" >&2
    ${FACTORY_SLEEP:-sleep} "$wait"
  done
}
