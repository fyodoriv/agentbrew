#!/usr/bin/env bash
# Inner-loop lint: Biome on the files this branch changed, not the whole tree.
#
# It checks committed, staged, unstaged, and new (untracked) files under
# src/, scripts/, and real-e2e/ against the merge base with origin/main.
# Biome's own `--changed` sees only committed files, so it misses work in
# progress. It calls the local node_modules/.bin/biome: without a local
# install, `npx biome` fetches and runs an unrelated npm package named
# "biome". The full gate (`npm run verify`) still checks the whole tree.
#
# Usage: npm run lint:changed [-- <biome check args>]
#   e.g. npm run lint:changed -- --write
# LINT_CHANGED_BASE overrides the base ref (default origin/main).
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
biome="node_modules/.bin/biome"
if [[ ! -x "$biome" ]]; then
  echo "lint:changed: $biome is missing; run bash scripts/worktree-deps.sh" >&2
  exit 1
fi
base="$(git merge-base HEAD "${LINT_CHANGED_BASE:-origin/main}")"

files=()
while IFS= read -r f; do
  [[ -f "$f" ]] && files+=("$f")
done < <(
  {
    git diff --name-only "$base"
    git ls-files --others --exclude-standard
  } | grep -E '^(src|scripts|real-e2e)/.*\.(ts|tsx|js|jsx|mjs|cjs)$' | LC_ALL=C sort -u
)
if [[ "${#files[@]}" == 0 ]]; then
  echo "lint:changed: no changed source files"
  exit 0
fi
exec "$biome" check --error-on-warnings "$@" "${files[@]}"
