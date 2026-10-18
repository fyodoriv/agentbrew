#!/usr/bin/env bash

set -euo pipefail

repo_root="${1:-}"

if [[ -z "$repo_root" ]]; then
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

# Coverage gate: every hooks/checks/<id>.sh needs a sibling <id>.test.sh.
missing=()
if [[ -d "$repo_root/hooks/checks" ]]; then
  while IFS= read -r script; do
    [[ -n "$script" ]] || continue
    [[ -f "${script%.sh}.test.sh" ]] || missing+=("${script#"$repo_root"/}")
  done < <(/usr/bin/find "$repo_root/hooks/checks" -maxdepth 1 -type f -name '*.sh' ! -name '*.test.sh' | sort)
fi
if ((${#missing[@]} > 0)); then
  echo "Hook fixture coverage: these check scripts have no fixture test:" >&2
  for script in "${missing[@]}"; do
    echo "  ✗ $script (add ${script%.sh}.test.sh)" >&2
  done
  exit 1
fi

fixtures_dir="$repo_root/hooks/checks"
fixtures=""
if [[ -d "$fixtures_dir" ]]; then
  fixtures="$(/usr/bin/find "$fixtures_dir" -maxdepth 1 -type f -name '*.test.sh' | sort)"
fi

if [[ -z "$fixtures" ]]; then
  echo "Hook fixture tests: no fixtures found"
  exit 0
fi

# Keep fixture decisions out of the real ~/.cache/agentbrew log.
fixture_log_dir="$(mktemp -d "${TMPDIR:-/tmp}/hook-fixtures.XXXXXX")"
trap 'rm -rf "$fixture_log_dir"' EXIT
export HOOK_DECISIONS_LOG="$fixture_log_dir/hook-decisions.jsonl"

echo "Hook fixture tests:"
while IFS= read -r fixture; do
  [[ -n "$fixture" ]] || continue
  rel="${fixture#"$repo_root"/}"
  echo "  → $rel"
  bash "$fixture"
  echo "  ✓ $rel"
done <<<"$fixtures"

echo "Hook fixture tests: all passed"
