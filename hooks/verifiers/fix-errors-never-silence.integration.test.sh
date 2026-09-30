#!/bin/bash

set -uo pipefail

if [ "${AGENTBREW_RUN_LLM_TESTS:-0}" != "1" ]; then
  echo "fix-errors-never-silence.integration.test.sh: skipped (set AGENTBREW_RUN_LLM_TESTS=1)"
  exit 0
fi

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/fix-errors-never-silence.sh"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

INPUT='{"hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"/repo/src/errors.ts","new_string":"export const retryPolicy = { skipRetryForStatusCodes: [404] };\nthrow new Error(\"missing token\");"}}'
ERR="$TMPDIR/stderr.txt"

HOME="$TMPDIR/home" HOOK_VERIFIER_TIMEOUT="${HOOK_VERIFIER_TIMEOUT:-10}" bash "$SCRIPT" >"$TMPDIR/stdout.txt" 2>"$ERR" <<<"$INPUT"
CODE=$?

if [ "$CODE" != "0" ]; then
  echo "fix-errors-never-silence.integration.test.sh: expected exit 0, got $CODE"
  cat "$ERR"
  exit 1
fi

echo "fix-errors-never-silence.integration.test.sh: live verifier returned exit 0"
