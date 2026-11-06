#!/usr/bin/env bash
# scripts/github-app.sh: the factory's GitHub App mints its own short token; no person's login is used (ADR-0006).
. "$(dirname "$0")/lib.sh"
app="$REPO_ROOT/scripts/github-app.sh"
key="$TMP_BASE/app.pem"
openssl genrsa -out "$key" 2048 2> /dev/null && chmod 600 "$key"
export FACTORY_GH_APP_ID=12345 FACTORY_GH_APP_KEY="$key" FACTORY_PROJECT=chiyanram/ledger

# curl_stub : a fake curl; call N logs its arguments and prints file rN (a body, then a line with the HTTP code)
curl_stub() {
  dir=$(mktemp -d "$TMP_BASE/curl.XXXXXX")
  cat > "$dir/curl" <<'STUB'
#!/usr/bin/env bash
dir=$(cd "$(dirname "$0")" && pwd)
n=$(( $(cat "$dir/n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$dir/n"
printf '%s\n' "$*" >> "$dir/calls.log"
[ -f "$dir/r$n" ] || { echo "curl stub: no response for call $n" >&2; exit 7; }
cat "$dir/r$n"
STUB
  chmod +x "$dir/curl"; echo "$dir/curl"
}
answer() { printf '%s\n%s' "$3" "$2" > "$(dirname "$1")/r$4"; }   # answer STUB CODE BODY N

export FACTORY_CACHE="$TMP_BASE/cache1"
FACTORY_CURL=$(curl_stub); export FACTORY_CURL
answer "$FACTORY_CURL" 200 '{"id":777}' 1
answer "$FACTORY_CURL" 201 '{"token":"ghs_abc","expires_at":"2026-11-05T10:00:00Z"}' 2
expect_eq "a token is minted for the App's installation on the project" ghs_abc "$("$app" token)"
expect_pass "the installation is looked up for the project" \
  grep -q 'https://api.github.com/repos/chiyanram/ledger/installation' "$(dirname "$FACTORY_CURL")/calls.log"
expect_pass "the token is minted for that installation" \
  grep -q 'POST .*app/installations/777/access_tokens' "$(dirname "$FACTORY_CURL")/calls.log"
jwt=$(sed -n 1p "$(dirname "$FACTORY_CURL")/calls.log" | sed -n 's/.*Authorization: Bearer \([^ ]*\).*/\1/p')
expect_eq "the JWT names the App as its issuer" 12345 \
  "$(printf '%s' "$jwt" | cut -d. -f2 | tr '_-' '/+' | awk '{ while (length($0) % 4) $0 = $0 "="; print }' \
    | openssl base64 -d -A | jq -r .iss)"
expect_pass "the JWT verifies with the App's public key" sh -c '
  printf "%s" "$1" | cut -d. -f1,2 | tr -d "\n" > "$2/signed"
  printf "%s" "$1" | cut -d. -f3 | tr "_-" "/+" | awk "{ while (length(\$0) % 4) \$0 = \$0 \"=\"; print }" \
    | openssl base64 -d -A > "$2/sig"
  openssl rsa -in "$3" -pubout -out "$2/pub.pem" 2>/dev/null
  openssl dgst -sha256 -verify "$2/pub.pem" -signature "$2/sig" "$2/signed" > /dev/null' _ "$jwt" "$TMP_BASE" "$key"
expect_eq "a second call reuses the cached token: no new call" ghs_abc "$("$app" token)"
expect_eq "so curl ran twice in all" 2 "$(wc -l < "$(dirname "$FACTORY_CURL")/calls.log" | tr -d ' ')"
expect_eq "the cache is readable by its owner only" 600 \
  "$(stat -c %a "$FACTORY_CACHE/12345-chiyanram_ledger.json" 2>/dev/null || stat -f %Lp "$FACTORY_CACHE/12345-chiyanram_ledger.json")"
expect_eq "git gets the token through its credential protocol" "username=x-access-token
password=ghs_abc" "$("$app" git-credential get)"
expect_eq "git's store and erase are ignored" "" "$(printf 'x' | "$app" git-credential store)"

jq '.until = 0' "$FACTORY_CACHE/12345-chiyanram_ledger.json" > "$TMP_BASE/c" && cat "$TMP_BASE/c" > "$FACTORY_CACHE/12345-chiyanram_ledger.json"
FACTORY_CURL=$(curl_stub); export FACTORY_CURL
answer "$FACTORY_CURL" 200 '{"id":777}' 1
answer "$FACTORY_CURL" 201 '{"token":"ghs_new"}' 2
expect_eq "a token near its end is minted again" ghs_new "$("$app" token)"

export FACTORY_CACHE="$TMP_BASE/cache2"
FACTORY_CURL=$(curl_stub); export FACTORY_CURL
answer "$FACTORY_CURL" 404 '{"message":"Not Found"}' 1
expect_fail "an App not installed on the project fails and says so" "the App 12345 is not installed on chiyanram/ledger" \
  "$app" token

chmod 644 "$key"
expect_fail "a private key others can read is refused" "readable by its owner only" "$app" token
chmod 600 "$key"
expect_fail "no App ID is refused" "FACTORY_GH_APP_ID is not set" sh -c 'cd "$1" && env -u FACTORY_GH_APP_ID "$2" token' _ "$TMP_BASE" "$app"
expect_fail "a project that is not owner/name is refused" "must be owner/name" env FACTORY_PROJECT=ledger "$app" token

# a writer in a worktree of the factory's clone has no FACTORY_* settings: the clone's git config carries them
clone="$TMP_BASE/clone"; git init -q "$clone"
git -C "$clone" config factory.ghAppId 12345
git -C "$clone" config factory.ghAppKey "$key"
git -C "$clone" config factory.project chiyanram/ledger
export FACTORY_CACHE="$TMP_BASE/cache3"
FACTORY_CURL=$(curl_stub); export FACTORY_CURL
answer "$FACTORY_CURL" 200 '{"id":777}' 1
answer "$FACTORY_CURL" 201 '{"token":"ghs_git"}' 2
expect_eq "with no environment, the clone's git config names the App, its key and the project" ghs_git \
  "$(cd "$clone" && env -u FACTORY_GH_APP_ID -u FACTORY_GH_APP_KEY -u FACTORY_PROJECT "$app" token)"

export FACTORY_CACHE="$TMP_BASE/cache4"
FACTORY_CURL=$(curl_stub); export FACTORY_CURL
answer "$FACTORY_CURL" 401 '{"message":"A JSON web token could not be decoded"}' 1
expect_fail "a 401 names the App ID, the key and the clock, not a missing install" "check the App ID, the key, and this machine's clock" \
  "$app" token

FACTORY_CURL=$(curl_stub); export FACTORY_CURL
answer "$FACTORY_CURL" 200 '{"id":12345,"slug":"ledger-factory"}' 1
expect_eq "slug is the App's name as GitHub knows it" ledger-factory "$("$app" slug)"
expect_pass "asked with the App's JWT" grep -q 'GET -H Authorization: Bearer .* https://api.github.com/app$' "$(dirname "$FACTORY_CURL")/calls.log"

FACTORY_CURL=$(curl_stub); export FACTORY_CURL
answer "$FACTORY_CURL" 200 '{"id":777}' 1
answer "$FACTORY_CURL" 201 '{"token":"ghs_gh"}' 2
real="$TMP_BASE/realgh"; mkdir -p "$real"
printf '#!/bin/sh\necho "real gh: $GH_TOKEN $*"\n' > "$real/gh" && chmod +x "$real/gh"
expect_eq "gh runs the real gh with the App's token, even with scripts/bin first on PATH" "real gh: ghs_gh pr list" \
  "$(PATH="$REPO_ROOT/scripts/bin:$real:$PATH" "$REPO_ROOT/scripts/bin/gh" pr list)"

finish
