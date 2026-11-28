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
# CI waits have the same flaw. `gh run watch` and `gh pr checks --watch` return only when the whole
# run ends, so the agent sees a failed job minutes late (17 failed agentbrew CI runs: median 84 s,
# p90 582 s; scripts/ci-first-failure-lag.sh). This hook blocks those waits, foreground or
# background, and names lib/ci-watch-fail-fast.sh: it exits on the first failed job with its log
# lines, keeps the run going, and its --rest mode lists every other failure for one combined fix.
#
# Allowed: `pytest --maxfail=N`, `pytest -x`, `--bail`, `--fail-fast`, `--max-failures`, or an env
# var whose name has FAIL_FAST or STORM (a repo's own early stop), and every foreground run.
# Allowed CI reads: one-shot `gh pr checks`, `gh run view`, and the watcher itself.
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
CMD="$(json_get "$INPUT" '.tool_input.command')"

# A full-run CI wait, foreground or background, hides the first failed job until the last job ends.
WATCHER="$__HOOK_LIB_DIR/ci-watch-fail-fast.sh"
# Match shell code only, so a commit message or heredoc that names gh run watch is not a wait.
CODE="$(printf '%s' "$CMD" | perl "$__HOOK_LIB_DIR/shell-code-only.pl" 2>/dev/null)" || CODE="$CMD"
if ! grep -qE 'ci-watch-fail-fast' <<<"$CODE" &&
  grep -qE '(^|[^[:alnum:]_-])gh[[:space:]]+(run[[:space:]]+watch|pr[[:space:]]+checks([[:space:]]+[^;&|]*)?[[:space:]]--watch)([^[:alnum:]_-]|$)' <<<"$CODE"; then
  verdict_block "$HOOK_ID" "this CI wait returns only when the whole run ends, so a failed job stays unseen for minutes. Use the fail-fast watcher (run_in_background: true): bash $WATCHER <run-id|pr-number> --repo OWNER/REPO. It exits on the first failed job with its log lines and never cancels the run. Fix that failure, then run the same command with --rest: it waits for the other jobs and lists every failure, so one push fixes them all. It exits 0 only when every check passed."
fi

[ "$(json_get "$INPUT" '.tool_input.run_in_background')" = "true" ] || verdict_allow "$HOOK_ID" "foreground"

if ! grep -qE '(^|[^[:alnum:]_-])(pytest|vitest|jest|bats)([^[:alnum:]_-]|$)|(npm|pnpm|yarn) (run )?test|cargo (nextest|test)' <<<"$CMD"; then
  verdict_allow "$HOOK_ID" "no test suite"
fi
if grep -qE -- '--maxfail|(^|[[:space:]])-x([[:space:]]|$)|--exitfirst|--bail|--fail-fast|--max-failures|[A-Z_]*(FAIL_FAST|STORM)[A-Z_]*=' <<<"$CMD"; then
  verdict_allow "$HOOK_ID" "has a fail-fast limit"
fi
verdict_block "$HOOK_ID" "a background test suite needs a fail-fast limit, or a broken setup fails every test for hours unseen — add --maxfail=50 (pytest), --bail=50 (vitest/jest) or the repo's early-stop env var, then run it again. On the first failure: fix it, then rerun the suite once with a higher limit to list the rest, and fold them into the same fix."
