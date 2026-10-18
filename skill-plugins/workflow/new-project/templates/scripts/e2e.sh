#!/usr/bin/env bash
# End-to-end tests: one runnable file per user story case in tests/e2e/.
# Each test drives the real program the way a user does, with synthetic data,
# and checks the screen or output, the files, and the log event.
# Every story file tests/e2e/us-*.sh runs (helpers without the us- prefix do not).
# E2E_COLD=1 also re-installs dependencies, like a stranger on a new machine.
set -euo pipefail
cd "$(dirname "$0")/.."

shopt -s nullglob
tests=(tests/e2e/us-*.sh)
[ ${#tests[@]} -gt 0 ] || { echo "e2e: no tests/e2e/us-*.sh yet" >&2; exit 1; }
for t in "${tests[@]}"; do
  echo "e2e: $t"
  bash "$t"
done
echo "e2e: ${#tests[@]} file(s) passed"
