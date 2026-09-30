#!/usr/bin/env bash
# Optional repo token-tree audit via Repomix (GET, don't build).
# Gracefully skips when repomix is not installed.
set -euo pipefail

ROOT="${1:-.}"

if ! command -v repomix >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1; then
  echo "repomix not available — install with: npm i -g repomix (optional audit tool)" >&2
  exit 0
fi

run_repomix() {
  if command -v repomix >/dev/null 2>&1; then
    repomix "$@"
  else
    npx -y repomix "$@"
  fi
}

echo "Repomix token-count tree for: $ROOT"
run_repomix --token-count-tree "$ROOT"
