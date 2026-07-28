#!/usr/bin/env bash
#
# Verify that every relative Markdown link in the repo points at something that exists.
#
#   scripts/check-links.sh
#
# Exits non-zero and lists the offenders if any link is broken. Catches the rot that
# follows a file move, which is the usual way these break.
#
# Scope: relative links only — ./foo and ../foo, to files or directories. Absolute URLs
# are not checked, and neither are #anchors within a page.

set -euo pipefail

cd "$(dirname "$0")/.."

broken=0

while IFS= read -r file; do
  dir=$(dirname "$file")

  while IFS= read -r link; do
    [ -z "$link" ] && continue

    target="${link%%#*}"          # drop any trailing #anchor
    [ -z "$target" ] && continue  # link was an anchor alone

    if [ ! -e "$dir/$target" ]; then
      printf '  %s\n    -> %s\n' "$file" "$link"
      broken=$((broken + 1))
    fi
  done < <(grep -o '](\.\{1,2\}/[^)]*)' "$file" | sed 's/^](//; s/)$//')

done < <(find . -name '*.md' -not -path './.git/*' -not -path './node_modules/*' | sort)

if [ "$broken" -gt 0 ]; then
  printf '\n%d broken link(s).\n' "$broken" >&2
  exit 1
fi

echo "All relative links resolve."
