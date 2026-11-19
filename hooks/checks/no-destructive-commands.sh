#!/bin/bash
set -euo pipefail

hook_dir="${BASH_SOURCE[0]%/*}"
[[ "${BASH_SOURCE[0]}" == */* ]] || hook_dir=.
hook_dir="$(CDPATH='' cd -- "${hook_dir:-/}" && pwd)"
if [ -d "$hook_dir/lib" ]; then lib="$hook_dir/lib"; else lib="$hook_dir/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$lib/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$lib/verdict.sh"

readonly HOOK_ID="no-destructive-commands"
input="$(read_hook_stdin)"
export HOOK_EVENT_NAME HOOK_TOOL_NAME
HOOK_EVENT_NAME="$(json_get "$input" '.hook_event_name')"
HOOK_TOOL_NAME="$(json_get "$input" '.tool_name')"
[ "$HOOK_TOOL_NAME" = Bash ] || verdict_bypass "$HOOK_ID" "tool is not Bash"

command_text="$(json_get "$input" '.tool_input.command')"
# Screen only for possible matches. Pass the original words to the lexer.
screen="${command_text//\'/}"
screen="${screen//\"/}"
screen="${screen//\\/}"
case "$screen" in
  *stash*drop*|*stash*clear*) ;;
  *) verdict_allow "$HOOK_ID" "no stash discard to check" ;;
esac

if ! decision="$(printf '%s' "$command_text" | hook_python -S "$lib/destructive-command.py" 2>/dev/null)"; then
  verdict_block "$HOOK_ID" "The stash command could not be checked. Inspect the stash without deleting it."
fi
case "$decision" in
  block) verdict_block "$HOOK_ID" "Git stashes are shared across worktrees. Ask the owner before discarding one." ;;
  allow) verdict_allow "$HOOK_ID" "no direct stash discard detected" ;;
  *) verdict_block "$HOOK_ID" "The stash command could not be checked. Inspect the stash without deleting it." ;;
esac
