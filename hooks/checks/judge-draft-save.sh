#!/bin/bash
set -euo pipefail

configured_tool="${AGENTBREW_JUDGE_DRAFT_TOOL:-}"
[ -n "$configured_tool" ] || exit 0

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$hook_dir/lib" ]; then lib="$hook_dir/lib"; else lib="$hook_dir/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$lib/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$lib/verdict.sh"

readonly HOOK_ID=judge-draft-save
input="$(read_hook_stdin)"
[ "$(json_get "$input" '.tool_name')" = "$configured_tool" ] || exit 0
field="${AGENTBREW_JUDGE_DRAFT_FIELD:-}"
[ -n "$field" ] || verdict_block "$HOOK_ID" "Configure the exact draft message field."
if ! message="$(printf '%s' "$input" | hook_jq -c --arg field "$field" '.tool_input[$field]')"; then
  verdict_block "$HOOK_ID" "Could not read the configured draft message field."
fi
if ! printf '%s\n' "$message" | agentbrew judge gate-draft >/dev/null; then
  verdict_block "$HOOK_ID" "Review the exact draft with agentbrew judge run before saving it."
fi
verdict_allow "$HOOK_ID" "Draft receipt check passed."
