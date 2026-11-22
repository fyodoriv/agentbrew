#!/bin/bash
# agentbrew/hooks/checks/detached-start-needs-watch.sh
#
# **Hook**: detached-start-needs-watch
# **Event**: PreToolUse on Bash
# **Verdict**: block
# **Source rule**: shared-rules.md "Fast, safe iterations": every long or background start has a working watch.
#
# A process started with `nohup`, `setsid`, `disown` or a trailing `&` inside a foreground call
# leaves no watch: nothing tells the agent when it ends, or that it never started. On 2026-11-22
# one agent reported 9 background gift refills as running; a single-run lock had refused 8.
#
# Allowed: `run_in_background: true` (the harness reports the exit), a command that checks the
# child in the same call (`kill -0 $!`, `wait`, `pgrep`), and every command with no detach.
# Bypass: HOOK_BYPASS_DETACHED_START_NEEDS_WATCH=1.
# Test: bash detached-start-needs-watch.test.sh

set -euo pipefail
__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="detached-start-needs-watch"
if [ "${HOOK_BYPASS_DETACHED_START_NEEDS_WATCH:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_DETACHED_START_NEEDS_WATCH=1"
fi

INPUT="$(read_hook_stdin)"
[ "$(json_get "$INPUT" '.tool_name')" = "Bash" ] || verdict_bypass "$HOOK_ID" "not Bash"
[ "$(json_get "$INPUT" '.tool_input.run_in_background')" = "true" ] && verdict_allow "$HOOK_ID" "harness tracks it"
CMD="$(json_get "$INPUT" '.tool_input.command')"

# Drop `&&`, `2>&1`, `&>` and `>&` so only a real detaching `&` is left.
# Heredoc bodies and quoted strings are text, not commands: drop them first.
CODE="$(perl -0777 -pe 's/<<-?\s*([\x27"]?)(\w+)\1[^\n]*\n.*?\n\s*\2[ \t]*(\n|\z)/\n/sg; s/\x27[^\x27]*\x27//g; s/"(?:\\.|[^"\\])*"//g' <<<"$CMD")"
STRIPPED="$(sed -E 's/&&//g; s/[0-9]?>&[0-9]?//g; s/&>//g' <<<"$CODE")"
if ! grep -qE '(^|[^[:alnum:]_-])(nohup|setsid|disown)([^[:alnum:]_-]|$)|&' <<<"$STRIPPED"; then
  verdict_allow "$HOOK_ID" "no detach"
fi
if grep -qE 'kill -0|(^|[;&|[:space:]])wait([[:space:]]|$|;)|pgrep' <<<"$CMD"; then
  verdict_allow "$HOOK_ID" "checks the child in the same call"
fi
verdict_block "$HOOK_ID" "this starts a detached process with no watch, so a refused or dead start looks like success. Do one of: (1) drop nohup/& and run the command with run_in_background: true, so the harness tells you when it exits; or (2) keep the detach and check it in the same call, e.g. \`cmd >\"\$LOG\" 2>&1 & pid=\$!; sleep 3; kill -0 \$pid && tail -5 \"\$LOG\"\`. Then confirm a pid, lock or log line before you report it as started."
