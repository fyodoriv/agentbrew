#!/bin/bash
set -euo pipefail

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$hook_dir/lib" ]; then lib="$hook_dir/lib"; else lib="$hook_dir/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$lib/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$lib/verdict.sh"

readonly HOOK_ID=judge-pr-delivery
input="$(read_hook_stdin)"
[ "$(json_get "$input" '.tool_name')" = "Bash" ] || exit 0
command_text="$(json_get "$input" '.tool_input.command')"
parsed="$(printf '%s' "$command_text" | python3 -B "$lib/pr-command-target.py" --judge-command)" ||
  verdict_block "$HOOK_ID" "Could not verify literal PR arguments."
events=()
if [ "$(json_get "$parsed" '.events | index("pr-create") != null')" = true ]; then events+=(pr-create); fi
if [ "$(json_get "$parsed" '.events | index("pr-ready") != null')" = true ]; then events+=(pr-ready); fi
[ "${#events[@]}" -gt 0 ] || exit 0

cwd="$(json_get "$input" '.tool_input.workdir // .cwd')"
argv="$(printf '%s' "$parsed" | hook_jq -c '.argv')"
for event in "${events[@]}"; do
  if ! (cd -- "${cwd:-.}" && printf '%s\n' "$argv" | agentbrew judge gate-pr "$event") >/dev/null; then
    verdict_block "$HOOK_ID" "Review the exact PR body with agentbrew judge run before delivery."
  fi
done
verdict_allow "$HOOK_ID" "PR receipt check passed."
