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

readonly HOOK_ID="always-on-watch-stop"
export HOOK_EVENT_NAME=Stop

[ "${ALWAYS_ON_STOP_GUARD:-}" = off ] && verdict_bypass "$HOOK_ID" "disabled"
[ -n "${ALWAYS_ON_DIR:-}" ] && [ -n "${ALWAYS_ON_PROJECTS:-}" ] || verdict_bypass "$HOOK_ID" "not enrolled"

if ! decision="$(hook_python -S "$lib/always-on-watch-stop.py" 2>/dev/null)"; then
  verdict_bypass "$HOOK_ID" "watch evidence unavailable"
fi
case "$decision" in
  block) verdict_block "$HOOK_ID" "This watcher session has no live watch. Verify the watch before ending this turn." ;;
  *) verdict_allow "$HOOK_ID" "stop allowed" ;;
esac
