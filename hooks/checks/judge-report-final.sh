#!/bin/bash
set -euo pipefail

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$hook_dir/lib" ]; then lib="$hook_dir/lib"; else lib="$hook_dir/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$lib/stdin-json.sh"

input="$(read_hook_stdin)"
message="$(printf '%s' "$input" | hook_jq -c '.last_assistant_message | strings | select(length > 0)')"
[ -n "$message" ] || exit 0
if ! printf '%s\n' "$message" | agentbrew judge gate-report >/dev/null 2>&1; then
  printf '%s\n' '{"systemMessage":"The final report has no verified fresh judge verdict."}'
fi
