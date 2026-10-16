#!/usr/bin/env bash
# The one gate. Agents run it before they say a change is done.
#   scripts/check.sh        full gate: docs, lint, types, unit tests, e2e (once per PR)
#   scripts/check.sh fast   skips e2e (each commit; keep it under 10 seconds)
# Each step's time goes to .metrics/events.jsonl; scripts/metrics.sh reports it.
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-full}"
mkdir -p .metrics

step() {
  # step <name> <command...>: run, time, and log one gate step.
  name="$1"; shift
  start=$(date +%s)
  if "$@"; then okv=true; else okv=false; fi
  secs=$(( $(date +%s) - start ))
  printf '{"ts":"%s","event":"check.step","name":"%s","seconds":%s,"ok":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" "$secs" "$okv" >> .metrics/events.jsonl
  [ "$okv" = true ] || { echo "check.sh: step '$name' failed" >&2; exit 1; }
}

step docs scripts/check-docs.sh
if command -v gitleaks >/dev/null 2>&1 && git rev-parse -q --verify HEAD >/dev/null; then
  step secrets gitleaks git --no-banner --redact -l warn --log-opts=-20
fi
if [ -f TASKS.md ] && command -v npx >/dev/null 2>&1; then
  if npx --no-install @tasks-md/lint --help >/dev/null 2>&1 || npm view @tasks-md/lint version >/dev/null 2>&1; then
    step tasks npx -y @tasks-md/lint TASKS.md
  else
    echo "check.sh: tasks lint skipped (offline and not cached)"
  fi
fi

if [ -f package.json ]; then
  pm=npm; [ -f pnpm-lock.yaml ] && pm=pnpm
  step lint "$pm" run --if-present lint
  step types "$pm" run --if-present typecheck
  step unit "$pm" test
fi
if [ -f pyproject.toml ]; then
  step format uv run ruff format --check .
  step lint uv run ruff check .
  if uv run --quiet pyright --version >/dev/null 2>&1; then step types uv run pyright; fi
  step unit uv run pytest -q
fi
if [ -f Cargo.toml ]; then
  step format cargo fmt --all --check
  step lint cargo clippy --all-targets -- -D warnings
  step unit cargo test --all
fi

if [ "$mode" != fast ]; then step e2e scripts/e2e.sh; fi
if [ "${CHECK_EVALS:-0}" = 1 ]; then
  [ -x evals/run.sh ] || { echo "check.sh: CHECK_EVALS=1 but evals/run.sh is missing" >&2; exit 1; }
  step evals evals/run.sh
fi
echo "check.sh: $mode gate passed"
