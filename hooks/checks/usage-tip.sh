#!/bin/bash
# agentbrew/hooks/checks/usage-tip.sh
#
# **Hook**: usage-tip
# **Event**: Stop
# **Verdict**: allow (prints one tip as a systemMessage; never blocks)
# **Source rule**: docs/usage-tips.md
#
# Ends each agent turn with one short tip on using the agent better. The tip
# fits the last prompt when a trigger matches (a terse prompt, a correction,
# a pasted-error-free failure report, a long session), else it rotates the
# least-shown general tip. Tips live in `lib/usage-tips.tsv`.
#
# **Measurement**: every shown tip appends a `shown` row to the log. On later
# Stops in the same session, a prompt that matches a shown tip's adopt regex
# appends one `adopted` row. `scripts/usage-tips-report.sh` prints the
# adoption rate per tip, so weak tips get rewritten or deleted.
#
# **Bypass**: `HOOK_BYPASS_USAGE_TIP=1`
#
# **Configuration** (optional):
#   - USAGE_TIPS_DIR: log folder. Default `$HOME/.cache/agentbrew/usage-tips`.
#   - USAGE_TIPS_FILE: tips catalog. Default `lib/usage-tips.tsv`.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"

[ "${HOOK_BYPASS_USAGE_TIP:-}" = "1" ] && exit 0

TIPS="${USAGE_TIPS_FILE:-$__HOOK_LIB_DIR/usage-tips.tsv}"
LOG_DIR="${USAGE_TIPS_DIR:-$HOME/.cache/agentbrew/usage-tips}"
LOG="$LOG_DIR/log.jsonl"
[ -f "$TIPS" ] || exit 0
mkdir -p "$LOG_DIR" 2>/dev/null || exit 0
touch "$LOG" 2>/dev/null || exit 0

INPUT=$(read_hook_stdin)
SESSION=$(json_get "$INPUT" '.session_id')
TX=$(json_get "$INPUT" '.transcript_path')
# A Stop that a hook already blocked once is a continuation, not a new answer.
[ "$(json_get "$INPUT" '.stop_hook_active')" = "true" ] && exit 0

# Real user prompts only: string content, or text blocks without tool results.
PROMPTS=""
TX_LINES=0
if [ -n "$TX" ] && [ -f "$TX" ]; then
  PROMPTS=$(jq -r 'select(.type=="user") | .message.content
    | if type=="string" then . else ([.[]? | select(.type=="text") | .text] | join(" ")) end
    | select(length>0) | gsub("\n";" ")' "$TX" 2>/dev/null || true)
  TX_LINES=$(wc -l <"$TX" | tr -d ' ')
fi
LAST=$(printf '%s\n' "$PROMPTS" | tail -n 1)

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log_row() { jq -cn --arg ts "$(now)" --arg s "$SESSION" --arg t "$1" --arg e "$2" '{ts:$ts,session:$s,tip:$t,event:$e}' >>"$LOG"; }

# Adoption: a tip shown earlier in this session whose regex matches the last prompt.
SHOWN=$(jq -r --arg s "$SESSION" 'select(.session==$s and .event=="shown") | .tip' "$LOG" 2>/dev/null | sort -u)
ADOPTED=$(jq -r --arg s "$SESSION" 'select(.session==$s and .event=="adopted") | .tip' "$LOG" 2>/dev/null | sort -u)
while IFS=$'\t' read -r id _trigger adopt _text; do
  case "$id" in '#'*|'') continue ;; esac
  [ "$adopt" = "-" ] && continue
  grep -qxF "$id" <<<"$SHOWN" || continue
  grep -qxF "$id" <<<"$ADOPTED" && continue
  grep -qE -- "$adopt" <<<"$LAST" && log_row "$id" adopted
done <"$TIPS"

# Which triggers fire for the last prompt.
lower=$(printf '%s' "$LAST" | tr '[:upper:]' '[:lower:]')
fired="any"
case "$lower" in /*) ;; *)
  [ "${#LAST}" -gt 0 ] && [ "${#LAST}" -lt 40 ] && fired="$fired short"
  grep -qE "^(no[ ,.]|nope|wrong|that's not|that is not|still (broken|fail|not)|doesn't work|didn't work)" <<<"$lower" && fired="$fired correction"
  if grep -qE "(fail|broke|crash|error)" <<<"$lower" && ! grep -qE '(Error|error:|Traceback|FAILED|exit code)' <<<"$LAST"; then fired="$fired error"; fi
  ;; esac
[ "$TX_LINES" -gt 400 ] && fired="$fired long"

# Pick: a matching specific trigger first, then the least-shown tip; never the
# tip shown on the previous Stop, never an already adopted tip.
LAST_TIP=$(jq -r --arg s "$SESSION" 'select(.session==$s and .event=="shown") | .tip' "$LOG" 2>/dev/null | tail -n 1)
best="" best_text="" best_rank=999999
while IFS=$'\t' read -r id trigger _adopt text; do
  case "$id" in '#'*|'') continue ;; esac
  case " $fired " in *" $trigger "*) ;; *) continue ;; esac
  [ "$id" = "$LAST_TIP" ] && continue
  grep -qxF "$id" <<<"$ADOPTED" && continue
  count=$(grep -c "\"tip\":\"$id\",\"event\":\"shown\"" "$LOG" || true)
  rank=$count
  [ "$trigger" != "any" ] && rank=$((count - 100000))
  if [ "$rank" -lt "$best_rank" ]; then best="$id" best_text="$text" best_rank=$rank; fi
done <"$TIPS"

[ -n "$best" ] || exit 0
log_row "$best" shown
jq -cn --arg m "💡 $best_text" '{systemMessage:$m}'
exit 0
