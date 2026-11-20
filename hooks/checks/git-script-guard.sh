#!/bin/bash
set -euo pipefail

if [[ "${CLAUDE_ENV_FILE:-}" != /* || -L "$CLAUDE_ENV_FILE" ]]; then
  exit 0
fi

hook_dir="$(CDPATH='' cd -- "${BASH_SOURCE[0]%/*}" && pwd)"
if [[ -d "$hook_dir/lib" ]]; then
  lib_dir="$hook_dir/lib"
else
  lib_dir="$(CDPATH='' cd -- "$hook_dir/../lib" && pwd)"
fi
[[ -x "$lib_dir/git" ]] || exit 0

source "$lib_dir/stdin-json.sh"
input="$(read_hook_stdin)"
[[ "$(json_get "$input" '.hook_event_name')" == SessionStart ]] || exit 0

printf 'export AGENTBREW_SESSION_GIT_GUARD=%q\n' "$lib_dir/git" >> "$CLAUDE_ENV_FILE"
printf 'case "${PATH:-}:" in %q:*) ;; *) export PATH=%q:"${PATH:-}" ;; esac\n' \
  "$lib_dir" "$lib_dir" >> "$CLAUDE_ENV_FILE"
