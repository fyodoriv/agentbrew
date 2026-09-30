#!/bin/bash
# agentbrew/hooks/verifiers/stability-task-priority.sh
#
# **Hook**: stability-task-priority
# **Event**: PreToolUse on Write|Edit to TASKS.md
# **Verdict**: warn (Cat B verifier observation mode)
# **Source rule**: templates/AGENTS.md stability / deployment infra P0 discipline
# **Bypass**: `HOOK_BYPASS_STABILITY_TASK_PRIORITY=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"
source "$__HOOK_LIB_DIR/claude-verifier.sh"

readonly HOOK_ID="stability-task-priority"
export HOOK_MODEL="${HOOK_MODEL:-claude-haiku-4-5}"
export HOOK_VERIFIER_TIMEOUT="${HOOK_VERIFIER_TIMEOUT:-2}"
export HOOK_PROMPT_VERSION="1"

if [ "${HOOK_BYPASS_STABILITY_TASK_PRIORITY:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_STABILITY_TASK_PRIORITY=1"
fi

INPUT="$(read_hook_stdin)"
TOOL_NAME="$(json_get "$INPUT" '.tool_name')"
case "$TOOL_NAME" in
  Write|Edit|MultiEdit) ;;
  *) verdict_bypass "$HOOK_ID" "tool $TOOL_NAME is not Write/Edit/MultiEdit" ;;
esac

FILE_PATH="$(json_get "$INPUT" '.tool_input.file_path')"
case "$FILE_PATH" in
  *TASKS.md|*tasks.md) ;;
  *) verdict_bypass "$HOOK_ID" "$FILE_PATH is not a task queue file" ;;
esac

CONTENT="$(json_get "$INPUT" '.tool_input.content')"
if [ -z "$CONTENT" ]; then CONTENT="$(json_get "$INPUT" '.tool_input.new_string')"; fi
if [ -z "$CONTENT" ]; then
  verdict_bypass "$HOOK_ID" "no task content"
fi
CONTENT_EXCERPT="$(printf '%s' "$CONTENT" | head -c 12000)"

VERIFIER_PROMPT='You are a strict task-priority verifier. Stability, regression-catching, observability, deployment-infra, auth-path, data-integrity, CI-gate, probe, health-check, k8s manifest, env-var, drift-guard, and leak-prevention work MUST be filed as P0 unless the repo explicitly documents otherwise. Inspect the proposed TASKS.md edit. ALLOW when the task is P0/P1, is not stability-class work, or the priority matches the work class. BLOCK only when a clearly stability/deployment/infra/regression task is filed below P0 (P2/P3). Default to ALLOW for ambiguity. Respond with EXACTLY one word: ALLOW or BLOCK, then a brief reason.'

VERDICT="$(verify_with_claude "$VERIFIER_PROMPT" "$(cat <<EOF
File path:
$FILE_PATH

Proposed task excerpt:
$CONTENT_EXCERPT
EOF
)")"

if [[ "$VERDICT" =~ ^BLOCK ]]; then
  verdict_warn "$HOOK_ID" "This task looks like stability/deployment/infra work filed below P0. Move it to ## P0 (or P1 when appropriate) before continuing. Verifier: ${VERDICT#BLOCK }"
fi

verdict_allow "$HOOK_ID" "task priority matches work class or verifier default-allowed: $VERDICT"
