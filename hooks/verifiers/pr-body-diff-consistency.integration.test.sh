#!/bin/bash

set -uo pipefail

if [ "${AGENTBREW_RUN_LLM_TESTS:-0}" != "1" ]; then
  echo "pr-body-diff-consistency.integration.test.sh: skipped (set AGENTBREW_RUN_LLM_TESTS=1)"
  exit 0
fi

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/pr-body-diff-consistency.sh"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr edit 42 --body \"## Summary\\nUpdate hook fixture discovery because verifier fixtures now live under hooks/verifiers.\""}}'
ERR="$TMPDIR/stderr.txt"

HOME="$TMPDIR/home" HOOK_VERIFIER_TIMEOUT="${HOOK_VERIFIER_TIMEOUT:-10}" bash "$SCRIPT" >"$TMPDIR/stdout.txt" 2>"$ERR"
CODE=$?

if [ "$CODE" != "0" ]; then
  echo "pr-body-diff-consistency.integration.test.sh: expected exit 0, got $CODE"
  cat "$ERR"
  exit 1
fi

echo "pr-body-diff-consistency.integration.test.sh: live verifier returned exit 0"
