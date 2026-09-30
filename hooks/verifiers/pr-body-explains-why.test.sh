#!/bin/bash

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/pr-body-explains-why.sh"
source "$(dirname "$SCRIPT")/_cat-b-fixture-lib.sh"
cat_b_fixture_setup "$SCRIPT" "HOOK_BYPASS_PR_BODY_EXPLAINS_WHY"

CREATE='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --title \"fix foo\" --body \"## Summary\\nShip the widget refactor\""}}'

cat_b_run_hook "block_warns" "$CREATE" MOCK_CLAUDE_RESPONSE="BLOCK no why"
cat_b_assert_exit_code "BLOCK warns" 0 "$(cat "$TMPDIR/block_warns.code")"
cat_b_assert_stderr_contains "BLOCK warning" "may not explain WHY" "$TMPDIR/block_warns.err"

cat_b_run_hook "allow_silent" "$CREATE" MOCK_CLAUDE_RESPONSE="ALLOW explains why"
cat_b_assert_exit_code "ALLOW exits 0" 0 "$(cat "$TMPDIR/allow_silent.code")"
cat_b_assert_stderr_empty "ALLOW silent" "$TMPDIR/allow_silent.err"

cat_b_run_hook "bypass" "$CREATE" MOCK_CLAUDE_RESPONSE="BLOCK skip" HOOK_BYPASS_PR_BODY_EXPLAINS_WHY=1
cat_b_assert_exit_code "bypass" 0 "$(cat "$TMPDIR/bypass.code")"
cat_b_assert_stderr_empty "bypass silent" "$TMPDIR/bypass.err"

IRRELEVANT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hello"}}'
cat_b_run_hook "irrelevant" "$IRRELEVANT"
cat_b_assert_exit_code "irrelevant" 0 "$(cat "$TMPDIR/irrelevant.code")"

cat_b_finish "pr-body-explains-why.sh"
