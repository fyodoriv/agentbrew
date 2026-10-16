#!/usr/bin/env bash
# The one gate: format check, lint, type check, and tests for whatever stack
# this repo has. Agents run it before they say a change is done.
set -euo pipefail
cd "$(dirname "$0")/.."

ran=0
if [ -f package.json ]; then
  ran=1
  pm=npm; [ -f pnpm-lock.yaml ] && pm=pnpm
  "$pm" run --if-present lint
  "$pm" run --if-present typecheck
  "$pm" test
fi
if [ -f pyproject.toml ]; then
  ran=1
  uv run ruff format --check .
  uv run ruff check .
  if uv run --quiet pyright --version >/dev/null 2>&1; then uv run pyright; fi
  uv run pytest -q
fi
if [ -f Cargo.toml ]; then
  ran=1
  cargo fmt --all --check
  cargo clippy --all-targets -- -D warnings
  cargo test --all
fi
if [ -f TASKS.md ] && command -v npx >/dev/null 2>&1; then
  npx -y @tasks-md/lint TASKS.md
fi
if [ "${CHECK_EVALS:-0}" = 1 ]; then
  [ -x evals/run.sh ] || { echo "check.sh: CHECK_EVALS=1 but evals/run.sh is missing" >&2; exit 1; }
  evals/run.sh
fi
[ "$ran" = 1 ] || echo "check.sh: no package.json, pyproject.toml, or Cargo.toml yet; nothing to test."
