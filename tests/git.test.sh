#!/usr/bin/env bash
# scripts/lib/git.sh: host git never runs a hook or program that the repo's own config names (#87; ADR-0012 S12).
# Each case first shows plain git running the planted program, so the case can fail; then hgit does not run it.
. "$(dirname "$0")/lib.sh"
. "$REPO_ROOT/scripts/lib/git.sh"
export GIT_CONFIG_GLOBAL="$TMP_BASE/global.gitconfig" GIT_CONFIG_NOSYSTEM=1   # the operator's config, under test
: > "$GIT_CONFIG_GLOBAL"
commit() { git -C "$1" -c user.name=t -c user.email=t@t commit -q --allow-empty -m "$2"; }

setup() {
  base=$(mktemp -d "$TMP_BASE/git.XXXXXX")
  git init -q --bare "$base/origin.git"
  git init -q "$base/repo" && commit "$base/repo" init
  git -C "$base/repo" remote add origin "$base/origin.git"
  ran="$base/ran"   # every planted program appends its name here
  plant() { printf '#!/bin/sh\necho %s >> "%s"\n' "$1" "$ran" > "$base/$1" && chmod +x "$base/$1"; }
}
effective() { awk '{ a[NR] = $0 } $0 == "" { s = NR } END { for (i = s + 1; i <= NR; i++) print a[i] }'; }  # helpers after the last reset
ran_by() { [ -f "$ran" ] && grep -qx "$1" "$ran" && echo ran || echo "not run"; }

setup
plant fsmonitor
git -C "$base/repo" config core.fsmonitor "$base/fsmonitor"
git -C "$base/repo" status > /dev/null 2>&1
expect_eq "plain git runs a planted core.fsmonitor on status" ran "$(ran_by fsmonitor)"
rm -f "$ran"
hgit -C "$base/repo" status > /dev/null 2>&1
expect_eq "hgit does not" "not run" "$(ran_by fsmonitor)"

setup
plant pre-push && cp "$base/pre-push" "$base/repo/.git/hooks/pre-push"
git -C "$base/repo" push -q origin HEAD:refs/heads/a 2> /dev/null
expect_eq "plain git runs a planted pre-push hook" ran "$(ran_by pre-push)"
rm -f "$ran"
hgit -C "$base/repo" push -q origin HEAD:refs/heads/b 2> /dev/null
expect_eq "hgit pushes without it" "not run" "$(ran_by pre-push)"
expect_pass "and the push still happened" git -C "$base/origin.git" rev-parse --verify -q refs/heads/b

setup
plant hooks-dir && mkdir "$base/hooks" && cp "$base/hooks-dir" "$base/hooks/post-checkout"
git -C "$base/repo" config core.hooksPath "$base/hooks"
hgit -C "$base/repo" checkout -q -b c 2> /dev/null
expect_eq "a planted core.hooksPath is ignored" "not run" "$(ran_by hooks-dir)"

setup
plant smudge
printf '*.txt filter=x\n' > "$base/repo/.gitattributes" && echo hi > "$base/repo/a.txt"
git -C "$base/repo" add -A && commit "$base/repo" files
git -C "$base/repo" config filter.x.smudge "$base/smudge"
rm -f "$base/repo/a.txt" && git -C "$base/repo" checkout -q -- a.txt 2> /dev/null
expect_eq "plain git runs a planted filter driver on checkout" ran "$(ran_by smudge)"
rm -f "$ran" "$base/repo/a.txt"
hgit -C "$base/repo" checkout -q -- a.txt 2> /dev/null
expect_eq "hgit does not" "not run" "$(ran_by smudge)"

setup
plant textconv
printf '*.txt diff=x\n' > "$base/repo/.gitattributes" && echo one > "$base/repo/a.txt"
git -C "$base/repo" add -A && commit "$base/repo" one && echo two > "$base/repo/a.txt"
git -C "$base/repo" config diff.x.textconv "$base/textconv"
out=$(hgit -C "$base/repo" diff 2>&1); status=$?
expect_eq "a planted diff textconv is ignored" "not run" "$(ran_by textconv)"
expect_eq "and the diff still works, in full" "0 +two" "$status $(printf '%s\n' "$out" | grep '^+two')"

setup
git -C "$base/repo" config core.sshCommand "$base/evil-ssh"
git -C "$base/repo" config remote.origin.uploadpack "$base/evil-upload"
plant helper && git -C "$base/repo" config credential.helper "!$base/helper"
printf 'protocol=https\nhost=example.invalid\n\n' | GIT_TERMINAL_PROMPT=0 git -C "$base/repo" credential fill > /dev/null 2>&1
expect_eq "plain git runs a planted credential helper" ran "$(ran_by helper)"
rm -f "$ran"
printf 'protocol=https\nhost=example.invalid\n\n' | hgit -C "$base/repo" credential fill > /dev/null 2>&1
expect_eq "hgit does not" "not run" "$(ran_by helper)"
expect_eq "a planted core.sshCommand reads as plain ssh" ssh "$(hgit -C "$base/repo" config --get core.sshcommand)"
expect_eq "a planted uploadpack reads as git-upload-pack" git-upload-pack \
  "$(hgit -C "$base/repo" config --get remote.origin.uploadpack)"

setup
git config --global credential.helper store-trusted
git -C "$base/repo" config credential.helper "!$base/evil-helper"
expect_eq "the operator's own helper is kept, and only it" store-trusted \
  "$(hgit -C "$base/repo" config --get-all credential.helper | effective)"
: > "$GIT_CONFIG_GLOBAL"

setup
own="!$REPO_ROOT/scripts/github-app.sh git-credential"
git -C "$base/repo" config --add credential.https://github.com.helper ""
git -C "$base/repo" config --add credential.https://github.com.helper "$own"
git -C "$base/repo" config --add credential.https://github.com.helper "!$base/elsewhere/github-app.sh git-credential"
expect_eq "this factory's own App helper is the one repo helper kept; a look-alike path is not" "$own" \
  "$(hgit -C "$base/repo" config --get-all credential.https://github.com.helper | effective)"

setup
git config --global core.pager trusted-pager
git -C "$base/repo" config core.pager "$base/evil-pager"
expect_eq "an always-set key takes the operator's own value when there is one" trusted-pager \
  "$(hgit -C "$base/repo" config --get core.pager)"
: > "$GIT_CONFIG_GLOBAL"

setup
plant git && mkdir "$base/repo/bin" && cp "$base/git" "$base/repo/bin/git"
(cd "$base/repo" && PATH="bin:$base/repo/bin:$PATH" FACTORY_REPO="$base/repo" hgit status > /dev/null 2>&1)
expect_eq "a git planted in a relative or in-repo PATH entry is never run" "not run" "$(ran_by git)"

setup
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotepath GIT_CONFIG_VALUE_0=false
expect_eq "a caller's own GIT_CONFIG_COUNT entries are kept" false "$(hgit -C "$base/repo" config --get core.quotepath)"
unset GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0

setup
mkdir "$base/fakebin" && printf '#!/bin/sh\ncase "$*" in *config*) exit 0 ;; esac\necho "prompt=$GIT_TERMINAL_PROMPT"\n' \
  > "$base/fakebin/git" && chmod +x "$base/fakebin/git"
expect_eq "git runs with GIT_TERMINAL_PROMPT=0, so a missing login fails and never asks" prompt=0 \
  "$(PATH="$base/fakebin:$PATH" GIT_TERMINAL_PROMPT=1 hgit -C "$base/repo" fetch)"
expect_pass "a value with spaces and quotes reaches git as one value" bash -c \
  "git config --global core.editor \"vi -c 'set x'\"; . '$REPO_ROOT/scripts/lib/git.sh'; [ \"\$(hgit -C '$base/repo' config --get core.editor)\" = \"vi -c 'set x'\" ]"
: > "$GIT_CONFIG_GLOBAL"

setup
plant eq-smudge
printf '*.txt filter=a=b diff=c=d\n' > "$base/repo/.gitattributes" && echo hi > "$base/repo/a.txt"
git -C "$base/repo" add -A && commit "$base/repo" files
git -C "$base/repo" config 'filter.a=b.smudge' "$base/eq-smudge"
git -C "$base/repo" config 'diff.c=d.textconv' "$base/eq-smudge"
rm -f "$base/repo/a.txt"; hgit -C "$base/repo" checkout -q -- a.txt 2> /dev/null
echo bye > "$base/repo/a.txt"; hgit -C "$base/repo" diff > /dev/null 2>&1
expect_eq "a driver whose name holds = is still neutralised" "not run" "$(ran_by eq-smudge)"
git -C "$base/repo" config 'credential.https://u=v@host.example.helper' "!$base/evil"
expect_pass "a helper key that holds = does not stop hgit" hgit -C "$base/repo" status

setup
plant ssh && mkdir "$base/repo/bin" && cp "$base/ssh" "$base/repo/bin/ssh"
git -C "$base/repo" remote set-url origin "ssh://git@example.invalid/x.git"
(cd "$base/repo" && PATH="bin:$base/repo/bin:$PATH" FACTORY_REPO="$base/repo" hgit fetch -q origin > /dev/null 2>&1)
expect_eq "git's own child programs never come from a relative or in-repo PATH entry" "not run" "$(ran_by ssh)"

for key in diff.external diff.x.command merge.x.driver 'url.file:///bad/.insteadOf' http.proxy \
    'http.https://github.com/.proxy' http.sslVerify http.curloptResolve remote.origin.proxy; do
  setup
  git -C "$base/repo" config "$key" "$base/evil"
  expect_fail "a repo-set $key is refused, with nothing run" "refused: the repo's own config sets" hgit -C "$base/repo" status
done
setup
git config --global http.proxy http://proxy.example:3128
git -C "$base/repo" config http.proxy http://evil.example
expect_eq "a refused key the operator also sets takes the operator's value" http://proxy.example:3128 \
  "$(hgit -C "$base/repo" config --get http.proxy)"
: > "$GIT_CONFIG_GLOBAL"

setup
git -C "$base/repo" config credential.zzz.helper "!$base/evil"
expect_pass "a repo whose last key is a foreign helper still runs" hgit -C "$base/repo" status

setup
git -C "$base/repo" config 'http.https://github.com/.extraheader' 'AUTHORIZATION: basic x'
git -C "$base/repo" config http.sslCAInfo /etc/ssl/corp-ca.pem
expect_pass "http keys that cannot redirect (GitHub checkout's extraheader, a corporate CA) are left alone" \
  hgit -C "$base/repo" status
mkdir -p "$base/repo/sub" && git -C "$base/repo" config diff.external "$base/evil"
expect_eq "without -C, git runs outside any repo: the current folder's config is never read" \
  "$(printf x | git hash-object --stdin)" "$(cd "$base/repo/sub" && printf x | hgit hash-object --stdin)"

# every host-side git call in scripts/ goes through hgit (check-links.sh reads this repo, not a project's)
raw=$(grep -rnE '(^|[^a-z_h-])git (-C|-c|fetch|push|worktree|status|checkout|diff|show|rev-parse|patch-id|hash-object)' \
  "$REPO_ROOT/scripts" | grep -v '/check-links.sh:' | grep -vE ':[0-9]+:\s*#' | grep -v 'git rev-parse HEAD' || true)
expect_eq "no script calls git directly on a project's repo" "" "$raw"

finish
