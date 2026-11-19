#!/bin/bash
# agentbrew/hooks/checks/retry-failed-before-stop.sh
#
# **Hook**: retry-failed-before-stop
# **Event**: Stop
# **Verdict**: block (once per turn)
# **Bypass**: HOOK_BYPASS_RETRY_FAILED_BEFORE_STOP=1
#
# Reads the transcript and finds tool calls in this turn (since the last real
# user message) that failed: `is_error: true`, or a known failure text such as
# "not connected" or "timed out". A later success or denial resolves the same
# tool and input. The reminder names only the tools and asks the agent to check
# the outcome before retrying safe, authorized actions. `stop_hook_active`
# allows the stop after the one reminder.

set -uo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
# shellcheck disable=SC1091
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
# shellcheck disable=SC1091
source "$__HOOK_LIB_DIR/verdict.sh"
set +e

readonly HOOK_ID="retry-failed-before-stop"

[ "${HOOK_BYPASS_RETRY_FAILED_BEFORE_STOP:-0}" = "1" ] && verdict_bypass "$HOOK_ID" "HOOK_BYPASS_RETRY_FAILED_BEFORE_STOP=1"

INPUT="$(read_hook_stdin)"
[ "$(json_get "${INPUT:-{\}}" '.stop_hook_active')" = "true" ] && verdict_bypass "$HOOK_ID" "stop_hook_active"
TRANSCRIPT="$(json_get "${INPUT:-{\}}" '.transcript_path')"
[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] || verdict_bypass "$HOOK_ID" "no transcript"

# shellcheck disable=SC2016
# Only the tail matters; a long session transcript can be large.
REASON="$(tail -n 2000 "$TRANSCRIPT" | hook_jq -rs '
  def text: if type == "string" then . elif type == "array" then map(.text? // "") | join(" ") else "" end;
  def safe_name:
    (strings | select(test("^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$"))) // "unnamed tool";
  [ .[] | select(type == "object") ] as $rows
  | ([ $rows | to_entries[]
       | select(.value.type == "user" and (.value.isMeta // false | not))
       | select((.value.message.content | type) == "string"
           or ([.value.message.content[]? | select(.type == "text")] | length > 0
               and ([.value.message.content[]? | select(.type == "tool_result")] | length == 0)))
       | .key ] | last // -1) as $start
  | select($start >= 0)
  | [ $rows[($start + 1):][] | .message.content? | arrays | .[] ] as $blocks
  | [ $blocks[] | select(.type == "tool_use") ] as $calls
  | [ $blocks[] | select(.type == "tool_result")
      | . as $r | ($r.content | text) as $t
      | { id: $r.tool_use_id,
          denied: ($t | test("doesn.t want to proceed|tool use was rejected|permission.*denied|user denied"; "i")),
          failed: (($r.is_error // false) or ($t | test("not connected|timed out|ECONNREFUSED|connection refused"; "i"))) } ] as $results
  | [ $calls | to_entries[] | .key as $i | .value as $c
      | ($results | map(select(.id == $c.id)) | first) as $r
      | select($r != null) | { i: $i, name: $c.name, input: $c.input, failed: $r.failed, denied: $r.denied } ] as $done
  | [ $done[] | select(.failed and (.denied | not)) | . as $f
      | select(any($done[];
          .i > $f.i and .name == $f.name and .input == $f.input
          and (.denied or (.failed | not))) | not) ]
  | if length == 0 then empty else
      "Unresolved tool failures this turn: "
      + (map(.name | safe_name) | unique | join(", "))
      + ". Retry only authorized actions that are safe to repeat. "
      + "Verify an uncertain outcome first, or report what is unresolved."
    end
' 2>/dev/null)"
[ -n "$REASON" ] || verdict_allow "$HOOK_ID" "no unretried failures"

# shellcheck disable=SC2016
hook_jq -nc --arg reason "$REASON" '{decision: "block", reason: $reason}' || exit 0
log_decision "$HOOK_ID" "block" "asked to check unresolved tool failures"
exit 0
