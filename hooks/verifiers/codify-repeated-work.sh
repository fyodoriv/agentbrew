#!/bin/bash
# agentbrew/hooks/verifiers/codify-repeated-work.sh
#
# **Hook**: codify-repeated-work
# **Event**: UserPromptSubmit
# **Verdict**: warn (Cat B verifier observation mode)
# **Source rule**: shared-rules.md:187 "Codify before continuing — write skill"
# **Bypass**: `HOOK_BYPASS_CODIFY_REPEATED_WORK=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"
source "$__HOOK_LIB_DIR/claude-verifier.sh"

readonly HOOK_ID="codify-repeated-work"
export HOOK_MODEL="${HOOK_MODEL:-claude-haiku-4-5}"
export HOOK_VERIFIER_TIMEOUT="${HOOK_VERIFIER_TIMEOUT:-2}"
export HOOK_PROMPT_VERSION="1"

if [ "${HOOK_BYPASS_CODIFY_REPEATED_WORK:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_CODIFY_REPEATED_WORK=1"
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
  tail -n 120 "$path" 2>/dev/null | head -c 12000 || printf '%s\n' "(transcript unavailable)"
}

TRANSCRIPT_PATH="$(json_get "$INPUT" '.transcript_path')"
TRANSCRIPT_EXCERPT="$(collect_transcript_excerpt "$TRANSCRIPT_PATH")"

VERIFIER_PROMPT='You are a strict repeated-work codification verifier. Decide whether the current user prompt asks the agent to continue work that the recent transcript shows has already been repeated at least twice and should be turned into a reusable skill before continuing. BLOCK only when repetition is clear, the work is cross-repo or recurring, and no existing/updated skill is visible in the transcript. ALLOW one-off work, ambiguous repetition, or cases where a skill already exists or is being created. Respond with EXACTLY one word: ALLOW or BLOCK, then a brief reason.'

VERDICT="$(verify_with_claude "$VERIFIER_PROMPT" "$(cat <<EOF
Current user prompt:
$PROMPT

Recent transcript excerpt:
$TRANSCRIPT_EXCERPT
EOF
)")"

if [[ "$VERDICT" =~ ^BLOCK ]]; then
  verdict_warn "$HOOK_ID" "This looks like repeated work that should be codified into a skill before continuing. Search existing skills first, then extend or create the right skill before proceeding. Verifier: ${VERDICT#BLOCK }"
fi

verdict_allow "$HOOK_ID" "prompt is not clearly repeated-work debt or verifier default-allowed: $VERDICT"
