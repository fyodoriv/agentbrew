#!/bin/bash
# agentbrew/hooks/checks/background-suite-fail-fast.sh
#
# **Hook**: background-suite-fail-fast
# **Event**: PreToolUse on Bash
# **Verdict**: block
# **Source rule**: shared-rules.md "Fast, safe iterations": a stuck or unwatched run gets a lasting fix.
#
# A background test run reports only when it ends. A broken setup (a stale build, stale goldens)
# then fails every test for hours before anyone looks: one full suite ran 1h52m with 4847 failures
# from one cause. This hook blocks a backgrounded test suite that has no fail-fast limit.
#
# Allowed: `pytest --maxfail=N`, `pytest -x`, `--bail`, `--fail-fast`, `--max-failures`, or an env
# var whose name has FAIL_FAST or STORM (a repo's own early stop), and every foreground run.
# Bypass: HOOK_BYPASS_BACKGROUND_SUITE_FAIL_FAST=1.
# Test: bash background-suite-fail-fast.test.sh

set -euo pipefail
__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="background-suite-fail-fast"
if [ "${HOOK_BYPASS_BACKGROUND_SUITE_FAIL_FAST:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_BACKGROUND_SUITE_FAIL_FAST=1"
fi

INPUT="$(read_hook_stdin)"
[ "$(json_get "$INPUT" '.tool_name')" = "Bash" ] || verdict_bypass "$HOOK_ID" "not Bash"
[ "$(json_get "$INPUT" '.tool_input.run_in_background')" = "true" ] || verdict_allow "$HOOK_ID" "foreground"
CMD="$(json_get "$INPUT" '.tool_input.command')"

if ! grep -qE '(^|[^[:alnum:]_-])(pytest|vitest|jest|bats)([^[:alnum:]_-]|$)|(npm|pnpm|yarn) (run )?test|cargo (nextest|test)' <<<"$CMD"; then
  verdict_allow "$HOOK_ID" "no test suite"
fi
if grep -qE -- '--maxfail|(^|[[:space:]])-x([[:space:]]|$)|--exitfirst|--bail|--fail-fast|--max-failures|[A-Z_]*(FAIL_FAST|STORM)[A-Z_]*=' <<<"$CMD"; then
  verdict_allow "$HOOK_ID" "has a fail-fast limit"
fi
verdict_block "$HOOK_ID" "a background test suite needs a fail-fast limit, or a broken setup fails every test for hours unseen — add --maxfail=50 (pytest), --bail=50 (vitest/jest) or the repo's early-stop env var, then run it again."
