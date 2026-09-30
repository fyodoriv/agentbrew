#!/bin/bash
# agentbrew/hooks/verifiers/ask-action-not-treasure-map.sh
#
# **Hook**: ask-action-not-treasure-map
# **Event**: UserPromptSubmit
# **Verdict**: warn (Cat B verifier observation mode)
# **Source rule**: templates/AGENTS.md:181 "Ask With An Action, Not A Treasure Map"
# **Bypass**: `HOOK_BYPASS_ASK_ACTION_NOT_TREASURE_MAP=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"
source "$__HOOK_LIB_DIR/claude-verifier.sh"

readonly HOOK_ID="ask-action-not-treasure-map"
export HOOK_MODEL="${HOOK_MODEL:-claude-haiku-4-5}"
export HOOK_VERIFIER_TIMEOUT="${HOOK_VERIFIER_TIMEOUT:-2}"
export HOOK_PROMPT_VERSION="1"

if [ "${HOOK_BYPASS_ASK_ACTION_NOT_TREASURE_MAP:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_ASK_ACTION_NOT_TREASURE_MAP=1"
fi

INPUT="$(read_hook_stdin)"
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"
if [ "$HOOK_EVENT_NAME" != "UserPromptSubmit" ]; then
  verdict_bypass "$HOOK_ID" "event $HOOK_EVENT_NAME is not UserPromptSubmit"
fi

PROMPT="$(json_get "$INPUT" '.prompt')"
if [ -z "$PROMPT" ]; then PROMPT="$(json_get "$INPUT" '.user_prompt')"; fi
if [ -z "$PROMPT" ]; then PROMPT="$(json_get "$INPUT" '.message')"; fi
if [ -z "$PROMPT" ]; then PROMPT="$(json_get "$INPUT" '.tool_input.prompt')"; fi
if [ -z "$PROMPT" ]; then
  verdict_bypass "$HOOK_ID" "no prompt"
fi

collect_transcript_excerpt() {
  local path="$1"
  if [ -z "$path" ] || [ ! -f "$path" ]; then
    printf '%s\n' "(no transcript available)"
    return 0
  fi
  tail -n 80 "$path" 2>/dev/null | head -c 10000 || printf '%s\n' "(transcript unavailable)"
}

TRANSCRIPT_PATH="$(json_get "$INPUT" '.transcript_path')"
TRANSCRIPT_EXCERPT="$(collect_transcript_excerpt "$TRANSCRIPT_PATH")"

VERIFIER_PROMPT='You are a strict assistant-response verifier for "ask with an action, not a treasure map". Inspect the recent transcript, especially the assistant response immediately before the current user prompt. BLOCK only when that assistant response asked the user to inspect files, docs, logs, dashboards, or paths without giving a concrete action, command, or direct next step the user can take. ALLOW if the assistant already took the action, gave a command/button/action, asked a focused question, or the previous response is unavailable/ambiguous. Respond with EXACTLY one word: ALLOW or BLOCK, then a brief reason.'

VERDICT="$(verify_with_claude "$VERIFIER_PROMPT" "$(cat <<EOF
Current user prompt:
$PROMPT

Recent transcript excerpt:
$TRANSCRIPT_EXCERPT
EOF
)")"

if [[ "$VERDICT" =~ ^BLOCK ]]; then
  verdict_warn "$HOOK_ID" "Previous response looked like a treasure map. Give the user a direct action, command, or focused question instead of pointing them at files or breadcrumbs. Verifier: ${VERDICT#BLOCK }"
fi

verdict_allow "$HOOK_ID" "previous response is actionable or verifier default-allowed: $VERDICT"
