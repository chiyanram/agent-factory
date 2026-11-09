# Host-side git, hardened against a planted hook or repo config (#87; ADR-0012 S12). Source it; do not run it.
# The TypeScript package has the same rules in src/core/git.ts (hostGit); keep the two in step.
#
# A branch or a writer can write the repo's own config (.git/config, a worktree's config.worktree, a file they
# include) or a hook. Plain git on the host would then run that program as the operator, outside any box:
# core.fsmonitor on `git status`, a pre-push hook on push, a filter driver on checkout. hgit runs git so that every
# such key comes from trusted config only.
#
#   trusted   the system (unless GIT_CONFIG_NOSYSTEM) and global config, and -c on the command line: the operator's own
#   untrusted the repo's local and worktree config, and what it includes: a branch or a writer may have written it
#
# Each key below gets its last trusted value or a neutral one, passed as GIT_CONFIG_COUNT entries (command scope,
# after any the caller set), as Sandcastle's src/hostGitConfig.ts does (study on #83, section 3.3):
#   always             core.fsmonitor false · core.hookspath /dev/null · core.pager cat · core.editor and
#                      sequence.editor true · gpg programs · protocol.ext.allow never · submodule.recurse and
#                      fetch.recursesubmodules false
#   when the repo sets core.sshcommand ssh · core.askpass, core.alternaterefscommand, gpg.ssh.defaultkeycommand,
#                      core.gitproxy and filter.<n>.clean/smudge/process "" (git then runs none) · filter.<n>.required
#                      false · diff.<n>.textconv cat · remote.<n>.uploadpack/receivepack the plain programs
#   credential helpers each helper key the repo sets is blanked, then its trusted helpers are added back; no repo
#                      helper is kept.
# hgit refuses, and runs nothing, when the repo sets a key that has no safe neutral value and no trusted one:
# diff.external, diff.<n>.command and merge.<n>.driver (git dies on an empty one); url.<x>.insteadof and
# url.<x>.pushinsteadof (they send a fetch or a push elsewhere); and http.[<url>.]proxy, remote.<n>.proxy, sslverify and
# curloptresolve (they send traffic through, or let answer, a host the operator did not choose). Other http keys,
# such as the extraheader GitHub's checkout writes or a corporate sslcainfo, cannot redirect and are left alone.
# git and every program it starts are found only on the trusted PATH (absolute entries outside FACTORY_REPO), and git
# runs with GIT_TERMINAL_PROMPT=0, so a planted `git`, `ssh` or helper in the worktree never runs and a missing login
# fails instead of asking. The repo's remote URL itself is the box's to protect: .git/config is read-only there (#110).
# Hardening system or global config is out of scope: the operator owns it.

# hgit [-C DIR] ARGS... : git ARGS in the repo at DIR, hardened as above. Without -C, git runs outside any repo (from
# /), so a command that needs none (hash-object --stdin, patch-id) never reads the config of the current folder.
hgit() {
  if [ "${1:-}" = -C ]; then hg_dir=$2; shift 2; else hg_dir=/; fi
  hg_n=${GIT_CONFIG_COUNT:-0}
  case $hg_n in
    '' | *[!0-9]*) echo "hgit: refused: GIT_CONFIG_COUNT is not a whole number ('$hg_n'); nothing run" >&2; return 1 ;;
  esac
  hg_path=$(hg_trusted_path) || return 1
  # a plain assignment, not a PATH=… prefix: bash 3.2 answers a prefixed `command -v` from its cache of where git was
  # last found, which may be a PATH entry hgit does not trust; assigning PATH empties that cache
  hg_git=$(PATH=$hg_path && command -v git) || { echo "hgit: no git on a trusted PATH entry" >&2; return 1; }
  hg_file=$(mktemp "${TMPDIR:-/tmp}/hgit.XXXXXX") || return 1
  hg_overrides "$hg_dir" > "$hg_file" || { rm -f "$hg_file"; return 1; }
  set -- "$hg_git" -C "$hg_dir" "$@"
  hg_env=''
  while IFS= read -r -d '' hg_key && IFS= read -r -d '' hg_value; do   # NUL-separated: a key may hold "=" or a tab
    hg_env="$hg_env GIT_CONFIG_KEY_$hg_n=$(printf '%q' "$hg_key") GIT_CONFIG_VALUE_$hg_n=$(printf '%q' "$hg_value")"
    hg_n=$((hg_n + 1))
  done < "$hg_file"
  rm -f "$hg_file"
  eval "env PATH=$(printf '%q' "$hg_path") GIT_CONFIG_COUNT=$hg_n $hg_env GIT_TERMINAL_PROMPT=0 \"\$@\""
}

# hg_trusted_path : PATH without relative entries and without entries inside FACTORY_REPO.
hg_trusted_path() {
  hg_out='' hg_old_ifs=$IFS; IFS=:
  for hg_p in $PATH; do
    case $hg_p in /*) ;; *) continue ;; esac
    case $hg_p in "${FACTORY_REPO:-/nonexistent}" | "${FACTORY_REPO:-/nonexistent}"/*) continue ;; esac
    hg_out=${hg_out:+$hg_out:}$hg_p
  done
  IFS=$hg_old_ifs
  [ -n "$hg_out" ] || { echo "hgit: no trusted PATH entry" >&2; return 1; }
  printf '%s' "$hg_out"
}

# hg_trusted KEY : the trusted values of KEY (system, then global), one per line, oldest first. Reads hg_tr, the
# system and global config listed once per call of hgit.
hg_trusted() {
  printf '%s\n' "$hg_tr" | awk -v k="$1" 'index($0, k "=") == 1 { print substr($0, length(k) + 2) }'
}

# hg_pair KEY VALUE : one override, as KEY NUL VALUE NUL.
hg_pair() { printf '%s\0%s\0' "$1" "$2"; }

# hg_set KEY NEUTRAL : KEY with its last trusted value, else NEUTRAL.
hg_set() {
  hg_last=$(hg_trusted "$1" | tail -n 1)
  hg_pair "$1" "${hg_last:-$2}"
}

# hg_refuse KEY : fails, naming KEY, unless KEY has a trusted value (which hg_set then passes).
hg_refuse() {
  [ -n "$(hg_trusted "$1")" ] && { hg_set "$1" ''; return 0; }
  echo "hgit: refused: the repo's own config sets $1, which would run a program or redirect git; remove it" >&2
  return 1
}

# hg_nosystem : true when GIT_CONFIG_NOSYSTEM is a true value. git then skips the system config, but an explicit
# --system reads it anyway, so hgit must skip it too or it adds back a value the operator turned off (#167).
hg_nosystem() {
  case $(printf '%s' "${GIT_CONFIG_NOSYSTEM:-}" | tr '[:upper:]' '[:lower:]') in '' | 0 | false | no | off) return 1 ;; esac
}

# hg_overrides DIR : the overrides for the repo at DIR, NUL-separated. Fails when hg_refuse refuses.
hg_overrides() {
  hg_tr=$({ hg_nosystem || "$hg_git" config --system --list; "$hg_git" config --global --list; } 2> /dev/null)
  for hg_kv in core.fsmonitor=false core.hookspath=/dev/null core.pager=cat core.editor=true sequence.editor=true \
      gpg.program=gpg gpg.openpgp.program=gpg gpg.x509.program=gpgsm gpg.ssh.program=ssh-keygen \
      protocol.ext.allow=never submodule.recurse=false fetch.recursesubmodules=false; do
    hg_set "${hg_kv%%=*}" "${hg_kv#*=}"
  done
  # keys the repo itself sets: local and worktree scope, and what those files include. A read that fails would leave
  # every repo key unchecked, so it refuses instead (git before 2.26 has no --show-scope).
  hg_scoped=$("$hg_git" -C "$1" config --show-scope --name-only --list 2> /dev/null) || {
    echo "hgit: refused: cannot list the repo's own config keys (git 2.26 or later is needed); nothing run" >&2
    return 1
  }
  hg_repo=$(printf '%s\n' "$hg_scoped" \
    | awk -F '\t' '$1 == "local" || $1 == "worktree" { print substr($0, index($0, "\t") + 1) }' | sort -u)
  while IFS= read -r hg_key; do
    case $hg_key in
      '') ;;
      core.sshcommand) hg_set "$hg_key" ssh ;;
      core.askpass | core.alternaterefscommand | gpg.ssh.defaultkeycommand) hg_set "$hg_key" '' ;;
      core.gitproxy) hg_set "$hg_key" ''; hg_pair protocol.git.allow never ;;
      filter.*.required) hg_set "$hg_key" false ;;
      filter.*.clean | filter.*.smudge | filter.*.process) hg_set "$hg_key" '' ;;
      diff.*.textconv) hg_set "$hg_key" cat ;;
      remote.*.uploadpack) hg_set "$hg_key" git-upload-pack ;;
      remote.*.receivepack) hg_set "$hg_key" git-receive-pack ;;
      diff.external | diff.*.command | merge.*.driver | url.*.insteadof | url.*.pushinsteadof | \
      http.proxy | http.*.proxy | http.sslverify | http.*.sslverify | http.curloptresolve | http.*.curloptresolve | \
      remote.*.proxy)
        hg_refuse "$hg_key" || return 1 ;;
      credential.helper | credential.*.helper)
        hg_pair "$hg_key" ''                                         # an empty helper clears the list so far
        hg_trusted "$hg_key" | while IFS= read -r hg_h; do hg_pair "$hg_key" "$hg_h"; done ;;
    esac
  done <<LIST
$hg_repo
LIST
  return 0
}
