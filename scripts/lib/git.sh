# Host-side git, hardened against a planted hook or repo config (#87; ADR-0012 S12). Source it; do not run it.
#
# A branch or a writer can write the repo's own config (.git/config, a worktree's config.worktree) or a hook. Plain
# git on the host would then run that program as the operator, outside any box: core.fsmonitor on `git status`, a
# pre-push hook on push, a filter driver on checkout. hgit runs git with every such key set from trusted config only.
#
#   trusted   the system and global config, and -c on the command line: the operator's own
#   untrusted the repo's local and worktree config, and any file it includes: a branch or a writer may have written it
#
# Each key below gets its last trusted value, or a neutral one, passed as GIT_CONFIG_COUNT entries (command scope,
# after any the caller already set), as Sandcastle's src/hostGitConfig.ts does (study on #83, section 3.3):
#   always             core.fsmonitor false · core.hookspath /dev/null · core.pager cat · core.editor and
#                      sequence.editor true · diff.external "" · gpg programs · protocol.ext.allow never ·
#                      submodule.recurse and fetch.recursesubmodules false
#   when the repo sets core.sshcommand, core.askpass, core.alternaterefscommand, gpg.ssh.defaultkeycommand,
#                      core.gitproxy, filter.<n>.*, diff.<n>.command/textconv, merge.<n>.driver,
#                      remote.<n>.uploadpack/receivepack
#   credential helpers each helper key the repo sets is blanked, then its trusted helpers are added back. The one
#                      repo helper kept is this factory's own App helper (GUIDE §Set up identity, GitHub step 5).
# git itself is found once on the trusted PATH (relative and in-repo entries dropped) and run by absolute path, with
# GIT_TERMINAL_PROMPT=0, so a planted `git` in the worktree is never run and a missing login fails instead of asking.
# Hardening system or global config is out of scope: the operator owns it.

# hgit [-C DIR] ARGS... : git ARGS in DIR (default: the current folder), hardened as above.
hgit() {
  if [ "${1:-}" = -C ]; then hg_dir=$2; shift 2; else hg_dir=.; fi
  hg_git=$(hg_git_path) || return 1
  hg_list=$(hg_overrides "$hg_dir") || return 1
  hg_n=${GIT_CONFIG_COUNT:-0}
  set -- "$hg_git" -C "$hg_dir" "$@"
  hg_env=''
  while IFS= read -r hg_line; do
    [ -n "$hg_line" ] || continue
    hg_key=${hg_line%%=*} hg_value=${hg_line#*=}
    hg_env="$hg_env GIT_CONFIG_KEY_$hg_n=$(printf '%q' "$hg_key") GIT_CONFIG_VALUE_$hg_n=$(printf '%q' "$hg_value")"
    hg_n=$((hg_n + 1))
  done <<EOF
$hg_list
EOF
  eval "env GIT_CONFIG_COUNT=$hg_n $hg_env GIT_TERMINAL_PROMPT=0 \"\$@\""
}

# hg_git_path : the absolute path of git, from PATH entries that are absolute and not inside FACTORY_REPO.
hg_git_path() {
  hg_old_ifs=$IFS; IFS=:
  for hg_p in $PATH; do
    IFS=$hg_old_ifs
    case $hg_p in /*) ;; *) continue ;; esac
    case $hg_p in "${FACTORY_REPO:-/nonexistent}" | "${FACTORY_REPO:-/nonexistent}"/*) continue ;; esac
    [ -x "$hg_p/git" ] && [ ! -d "$hg_p/git" ] && { printf '%s/git' "$hg_p"; return 0; }
  done
  IFS=$hg_old_ifs
  echo "hgit: no git on a trusted PATH entry" >&2; return 1
}

# hg_trusted KEY : the trusted values of KEY (system, then global), one per line, oldest first. Reads hg_tr, the
# system and global config listed once per call of hgit.
hg_trusted() {
  printf '%s\n' "$hg_tr" | awk -v k="$1" 'index($0, k "=") == 1 { print substr($0, length(k) + 2) }'
}

# hg_set KEY NEUTRAL : one override line, KEY=<the last trusted value, else NEUTRAL>.
hg_set() {
  hg_last=$(hg_trusted "$1" | tail -n 1)
  printf '%s=%s\n' "$1" "${hg_last:-$2}"
}

# hg_overrides DIR : the override lines for the repo at DIR, one KEY=VALUE per line.
hg_overrides() {
  hg_tr=$({ "$hg_git" config --system --list; "$hg_git" config --global --list; } 2> /dev/null)
  for hg_pair in core.fsmonitor=false core.hookspath=/dev/null core.pager=cat core.editor=true sequence.editor=true \
      diff.external= gpg.program=gpg gpg.openpgp.program=gpg gpg.x509.program=gpgsm gpg.ssh.program=ssh-keygen \
      protocol.ext.allow=never submodule.recurse=false fetch.recursesubmodules=false; do
    hg_set "${hg_pair%%=*}" "${hg_pair#*=}"
  done
  # keys the repo itself sets: local and worktree scope, and what those files include
  hg_repo=$("$hg_git" -C "$1" config --show-scope --name-only --list 2> /dev/null \
    | awk -F '\t' '$1 == "local" || $1 == "worktree" { print $2 }' | sort -u)
  printf '%s\n' "$hg_repo" | while IFS= read -r hg_key; do
    case $hg_key in
      core.sshcommand) hg_set "$hg_key" ssh ;;
      core.askpass | core.alternaterefscommand | gpg.ssh.defaultkeycommand) hg_set "$hg_key" '' ;;
      core.gitproxy) hg_set "$hg_key" ''; echo 'protocol.git.allow=never' ;;
      filter.*.required) hg_set "$hg_key" false ;;
      filter.*.clean | filter.*.smudge | filter.*.process) hg_set "$hg_key" '' ;;
      diff.*.command | diff.*.textconv | merge.*.driver) hg_set "$hg_key" '' ;;
      remote.*.uploadpack) hg_set "$hg_key" git-upload-pack ;;
      remote.*.receivepack) hg_set "$hg_key" git-receive-pack ;;
      credential.helper | credential.*.helper)
        echo "$hg_key="                                             # an empty helper clears the list so far
        hg_trusted "$hg_key" | while IFS= read -r hg_h; do echo "$hg_key=$hg_h"; done
        hg_own="!$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/github-app.sh git-credential"
        "$hg_git" -C "$1" config --local --get-all "$hg_key" 2> /dev/null | grep -qxF "$hg_own" \
          && echo "$hg_key=$hg_own" ;;
    esac
  done
}
