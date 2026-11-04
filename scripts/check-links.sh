#!/usr/bin/env bash
# Usage: scripts/check-links.sh [ROOT]
# Fails when a relative link in a tracked .md file under ROOT points at no file.
# Skips http(s), mailto and pure #anchor links; checks only the path of path#anchor.
# Skips links inside code fences and inline code.
# Skips tests/fixtures/ (bad input on purpose) and docs/archive/ (frozen history whose links point at old paths).
set -eu

root=${1:-.}
broken=0

links() {
  awk '
    /^[[:space:]]*(```|~~~)/ { fence = !fence; next }
    fence { next }
    {
      line = $0
      gsub(/`[^`]*`/, "", line)
      while (match(line, /\]\([^)]*\)/)) {
        print FNR "\t" substr(line, RSTART + 2, RLENGTH - 3)
        line = substr(line, RSTART + RLENGTH)
      }
      if (match(line, /^[[:space:]]*\[[^]]+\]:[[:space:]]+[^[:space:]]+/)) {
        sub(/^[[:space:]]*\[[^]]+\]:[[:space:]]+/, "", line)
        sub(/[[:space:]].*$/, "", line)
        print FNR "\t" line
      }
    }
  ' "$1"
}

files=$(git -c core.quotePath=false -C "$root" ls-files -- '*.md' ':(exclude)tests/fixtures/' ':(exclude)docs/archive/')
while IFS= read -r file; do
  [ -n "$file" ] || continue
  dir=$(dirname "$file")
  if ! found=$(links "$root/$file"); then
    echo "check-links: cannot read $file"
    exit 1
  fi
  while IFS="$(printf '\t')" read -r lineno target; do
    target=${target#<}
    target=${target%%>*}
    target=${target%% *}
    case $target in
      '' | '#'* | http://* | https://* | mailto:*) continue ;;
    esac
    path=${target%%#*}
    path=${path%%\?*}
    path=$(printf '%s' "$path" | sed 's/%20/ /g')
    case $path in
      /*) resolved="$root$path" ;;
      *) resolved="$root/$dir/$path" ;;
    esac
    if [ ! -e "$resolved" ]; then
      echo "broken link: $file:$lineno: $target"
      broken=$((broken + 1))
    fi
  done <<LINKS
$found
LINKS
done <<FILES
$files
FILES

if [ "$broken" -gt 0 ]; then
  echo "check-links: $broken broken relative link(s)"
  exit 1
fi
