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

readonly HOOK_ID="pr-merge-preflight"
input="$(read_hook_stdin)"
export HOOK_EVENT_NAME HOOK_TOOL_NAME
HOOK_EVENT_NAME="$(json_get "$input" '.hook_event_name')"
HOOK_TOOL_NAME="$(json_get "$input" '.tool_name')"
[ "$HOOK_EVENT_NAME" = PreToolUse ] && [ "$HOOK_TOOL_NAME" = Bash ] ||
  verdict_bypass "$HOOK_ID" "not a Bash pre-tool event"

command_text="$(json_get "$input" '.tool_input.command')"
screen="${command_text//\'/}"
screen="${screen//\"/}"
screen="${screen//\\/}"
case "$screen" in
  *gh*pr*merge*) ;;
  *) verdict_allow "$HOOK_ID" "no pull request merge to check" ;;
esac

if ! decision="$(printf '%s' "$command_text" |
  hook_python -S "$lib/pr-command-target.py" --merge-preflight 2>/dev/null)"; then
  decision=unavailable
fi

case "$decision" in
  ready) verdict_allow "$HOOK_ID" "the exact pull request head has completed its checks" ;;
  irrelevant) verdict_allow "$HOOK_ID" "no pull request merge to check" ;;
  unsupported) verdict_block "$HOOK_ID" "Use one direct merge with a PR number and repository or a PR URL, plus the full expected head commit." ;;
  changed-head) verdict_block "$HOOK_ID" "The pull request head changed. Check the current commit and its checks before merging." ;;
  not-ready) verdict_block "$HOOK_ID" "The pull request is not ready to merge. Check its open state, review and base branch." ;;
  checks-not-ready) verdict_block "$HOOK_ID" "The pull request has missing, pending or failed checks. Check GitHub before merging." ;;
  *) verdict_block "$HOOK_ID" "Pull request readiness could not be verified. Check GitHub before merging." ;;
esac
