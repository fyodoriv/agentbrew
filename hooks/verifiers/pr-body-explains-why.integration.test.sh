#!/bin/bash
set -uo pipefail
if [ "${AGENTBREW_RUN_LLM_TESTS:-0}" != "1" ]; then
  echo "pr-body-explains-why.integration.test.sh: skipped (set AGENTBREW_RUN_LLM_TESTS=1)"
  exit 0
fi
SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/pr-body-explains-why.sh"
INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"## Summary\\nFixes the widget because users could not save.\""}}'
HOME="$(mktemp -d)/home" HOOK_VERIFIER_TIMEOUT=10 bash "$SCRIPT" <<<"$INPUT"
echo "pr-body-explains-why.integration.test.sh: live verifier returned exit $?"
