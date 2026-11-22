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

# Heredoc bodies and quoted strings are text, so drop them before the detach match: this
# keeps a PR body or commit message that mentions `nohup … &` from being blocked.
# The rest of a `<<EOF` line stays code. A quote opens only at a word start ("don't" is no quote).
TEXTLESS="$(perl -0777 -pe 's/<<-?[ \t]*([\x27"]?)(\w+)\1([^\n]*\n)(?:.*?\n)??[ \t]*\2[ \t]*(?=\n|\z)/$3/sg; s/(?<![\w\\])\x27[^\x27]*\x27//g; s/(?<![\w\\])"(?:\\.|[^"\\])*"//g' <<<"$CMD")"
# Fail closed: a program that may run that text as code (a shell, an interpreter, a wrapper),
# anywhere outside the text, or any $( ) or backtick, keeps the whole command as code.
RUNNER='(^|[^[:alnum:]_-])(([[:alnum:]_.-]*/)*((ba|z|da|k|fi|c|tc|a)?sh|python[0-9.]*|node|deno|bun|perl|ruby|php|lua|r?awk|gawk|eval|exec|source|ssh|docker|podman|kubectl|xargs|find|watch|tmux|screen|script|timeout|time|sudo|doas|env|nice|parallel|osascript)([^[:alnum:]_-]|$))|(^|[;&|(])[[:space:]]*\.[[:space:]]'
if grep -qE "$RUNNER" <<<"$TEXTLESS" || grep -qE '\$\(|`' <<<"$CMD"; then
  CODE="$CMD"
else
  CODE="$TEXTLESS"
fi
# Drop `&&`, `2>&1`, `&>` and `>&` so only a real detaching `&` is left.
STRIPPED="$(sed -E 's/&&//g; s/[0-9]?>&[0-9]?//g; s/&>//g' <<<"$CODE")"
if ! grep -qE '(^|[^[:alnum:]_-])(nohup|setsid|disown)([^[:alnum:]_-]|$)|&' <<<"$STRIPPED"; then
  verdict_allow "$HOOK_ID" "no detach"
fi
if grep -qE 'kill -0|(^|[;&|[:space:]])wait([[:space:]]|$|;)|pgrep' <<<"$CMD"; then
  verdict_allow "$HOOK_ID" "checks the child in the same call"
fi
verdict_block "$HOOK_ID" "this starts a detached process with no watch, so a refused or dead start looks like success. Do one of: (1) drop nohup/& and run the command with run_in_background: true, so the harness tells you when it exits; or (2) keep the detach and check it in the same call, e.g. \`cmd >\"\$LOG\" 2>&1 & pid=\$!; sleep 3; kill -0 \$pid && tail -5 \"\$LOG\"\`. Then confirm a pid, lock or log line before you report it as started."
