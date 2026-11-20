#!/usr/bin/env bash
# Inner-loop lint: Biome on the files this branch changed, not the whole tree.
#
# It checks committed, staged, unstaged, and new (untracked) files under
# src/, scripts/, and real-e2e/ against the merge base with origin/main.
# Biome's own `--changed` sees only committed files, so it misses work in
# progress. It calls the local node_modules/.bin/biome: without a local
# install, `npx biome` fetches and runs an unrelated npm package named
# "biome". The full gate (`npm run verify`) still checks the whole tree.
# Check relative named imports in JavaScript tests when source changes.
#
# Usage: npm run lint:changed [-- <biome check args>]
#   e.g. npm run lint:changed -- --write
# LINT_CHANGED_BASE overrides the base ref (default origin/main).
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$(git rev-parse --show-toplevel)"
biome="node_modules/.bin/biome"
if [[ ! -x "$biome" ]]; then
  echo "lint:changed: $biome is missing; run bash scripts/worktree-deps.sh" >&2
  exit 1
fi
base="$(git merge-base HEAD "${LINT_CHANGED_BASE:-origin/main}")"

files=()
has_source_changes=false
while IFS= read -r f; do
  has_source_changes=true
  [[ -f "$f" ]] && files+=("$f")
done < <(
  {
    git diff --name-only "$base"
    git ls-files --others --exclude-standard
  } | grep -E '^(src|scripts|real-e2e)/.*\.(ts|tsx|js|jsx|mjs|cjs)$' | LC_ALL=C sort -u
)
if "$has_source_changes"; then
  node "$script_dir/check-orphan-tests.mjs"
fi
if [[ "${#files[@]}" == 0 ]]; then
  echo "lint:changed: no changed source files"
  exit 0
fi
exec "$biome" check --error-on-warnings "$@" "${files[@]}"
