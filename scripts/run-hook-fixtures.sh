#!/usr/bin/env bash

set -euo pipefail

repo_root="${1:-}"

if [[ -z "$repo_root" ]]; then
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

fixtures="$(
  for dir in "$repo_root/hooks/checks" "$repo_root/hooks/verifiers"; do
    if [[ -d "$dir" ]]; then
      /usr/bin/find "$dir" -maxdepth 1 -type f -name '*.test.sh'
    fi
  done | sort
)"

if [[ -z "$fixtures" ]]; then
  echo "Hook fixture tests: no fixtures found"
  exit 0
fi

echo "Hook fixture tests:"
while IFS= read -r fixture; do
  [[ -n "$fixture" ]] || continue
  rel="${fixture#"$repo_root"/}"
  echo "  → $rel"
  bash "$fixture"
  echo "  ✓ $rel"
done <<<"$fixtures"

echo "Hook fixture tests: all passed"
