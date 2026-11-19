#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export LC_ALL=C
shopt -s nullglob
shopt -u nocasematch

fail=0
for file in docs/*.[mM][dD]; do
  [ -f "$file" ] || continue
  name="$(basename "$file")"
  case "$name" in
    README.md|VISION.md) continue ;;
    [Rr][Ee][Aa][Dd][Mm][Ee].[Mm][Dd]) expected="README.md" ;;
    [Vv][Ii][Ss][Ii][Oo][Nn].[Mm][Dd]) expected="VISION.md" ;;
    *)
      if [[ "$name" =~ ^[a-z0-9]+(-[a-z0-9]+)*\.md$ ]]; then continue; fi
      expected="a lowercase kebab-case Markdown filename"
      ;;
  esac
  printf 'filename-case: %s needs %s.\n' "$file" "$expected" >&2
  fail=1
done

if [ "$fail" = 0 ]; then printf 'filename-case: docs filenames passed.\n'; fi
exit "$fail"
