#!/bin/bash

set -uo pipefail

if [ "${AGENTBREW_RUN_LLM_TESTS:-0}" != "1" ]; then
  echo "browser-errors-before-done.integration.test.sh: skipped (set AGENTBREW_RUN_LLM_TESTS=1)"
  exit 0
fi

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/browser-errors-before-done.sh"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

TRANSCRIPT="$TMPDIR/transcript.jsonl"
cat > "$TRANSCRIPT" <<'JSONL'
{"message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/repo/src/App.tsx"}},{"type":"tool_use","name":"Bash","input":{"command":"bash ~/.claude/skills/page-zero-errors/scripts/check-page-errors.sh http://localhost:3000"}}]}}
JSONL

INPUT=$(printf '{"hook_event_name":"Stop","transcript_path":"%s"}' "$TRANSCRIPT")
ERR="$TMPDIR/stderr.txt"

HOME="$TMPDIR/home" HOOK_VERIFIER_TIMEOUT="${HOOK_VERIFIER_TIMEOUT:-10}" bash "$SCRIPT" >"$TMPDIR/stdout.txt" 2>"$ERR" <<<"$INPUT"
CODE=$?

if [ "$CODE" != "0" ]; then
  echo "browser-errors-before-done.integration.test.sh: expected exit 0, got $CODE"
  cat "$ERR"
  exit 1
fi

echo "browser-errors-before-done.integration.test.sh: live verifier returned exit 0"
