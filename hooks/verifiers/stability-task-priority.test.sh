#!/bin/bash

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/stability-task-priority.sh"
source "$(dirname "$SCRIPT")/_cat-b-fixture-lib.sh"
cat_b_fixture_setup "$SCRIPT" "HOOK_BYPASS_STABILITY_TASK_PRIORITY"

TASK='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/TASKS.md","content":"## P3\\n- [ ] Add k8s probe regression test\\n  - **ID**: probe-gap\\n  - **Tags**: probe, ci-gate"}}'

cat_b_run_hook "block_warns" "$TASK" MOCK_CLAUDE_RESPONSE="BLOCK stability below P0"
cat_b_assert_exit_code "BLOCK warns" 0 "$(cat "$TMPDIR/block_warns.code")"
cat_b_assert_stderr_contains "BLOCK warning" "below P0" "$TMPDIR/block_warns.err"

cat_b_run_hook "allow_silent" "$TASK" MOCK_CLAUDE_RESPONSE="ALLOW ok"
cat_b_assert_exit_code "ALLOW" 0 "$(cat "$TMPDIR/allow_silent.code")"
cat_b_assert_stderr_empty "ALLOW silent" "$TMPDIR/allow_silent.err"

cat_b_finish "stability-task-priority.sh"
