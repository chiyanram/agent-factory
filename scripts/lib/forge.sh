# What tokens.sh, the last bash script that names a change, still needs of the forge seam (ADR-0010): the change's
# prefix and the number check. It calls no forge; the seam itself is src/core/forge/. Source it; do not run it. It
# goes when #131's usage command replaces tokens.sh (#138).
#
# FACTORY_FORGE names the project's forge: gitlab (default) or github.
# mark is the change's prefix in every line a script prints: ! on GitLab, # on GitHub.

case ${FACTORY_FORGE:-gitlab} in
  gitlab) mark='!' ;;
  github) mark='#' ;;
  *) echo "FACTORY_FORGE must be gitlab or github, got '$FACTORY_FORGE'" >&2; exit 1 ;;
esac

# valid_iid VALUE : fails unless VALUE is a change number.
valid_iid() {
  case $1 in
    '' | *[!0-9]*) echo "not a merge request number: '$1'" >&2; return 1 ;;
  esac
}
