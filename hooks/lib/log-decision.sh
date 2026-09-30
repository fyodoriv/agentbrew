#!/bin/bash
# shellcheck shell=bash
# agentbrew/hooks/lib/log-decision.sh
#
# Telemetry primitive for the hooks layer. Every hook decision (allow /
# block / warn / mutate / bypass) gets logged as a JSON line to
# ~/.cache/agentbrew/hook-decisions.jsonl. This is the event-source-of-
# truth for:
#   - Phase 3 rule decommissioning: a hook with zero block events in 7
#     days probably isn't firing on real violations — investigate before
#     removing its corresponding rule from shared-rules.md.
#   - Cron auto-heal: read the snapshot to know which hooks are unhealthy.
#   - User self-audit: `tail -f ~/.cache/agentbrew/hook-decisions.jsonl |
#     jq` shows what the agent is doing in real-time.
#
# Log shape (one JSON object per line):
#   { "timestamp": ISO-8601 with millisecond precision,
#     "hookId": "code-no-timestamps",
#     "decision": "allow|block|warn|mutate|bypass",
#     "reason": "...",
#     "toolName": "Edit" | "Bash" | ... (when available),
#     "event": "PreToolUse" | ... (when available),
#     "latencyMs": int (when measurable),
#     "model": "claude-sonnet-4-7" (Cat B only),
#     "promptVersion": int (Cat B only) }
#
# The log is append-only and bounded by a daily rotation: at the start of
# each day the previous file is moved to hook-decisions.<date>.jsonl.
# Use `find ~/.cache/agentbrew/ -name "hook-decisions.*.jsonl" -mtime +30 -delete`
# to garbage-collect old logs (or let the cron heal do it).

set -euo pipefail

__LOG_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./bootstrap-endpoint-path.sh
source "$__LOG_LIB_DIR/bootstrap-endpoint-path.sh"

__LOG_DIR="${HOME}/.cache/agentbrew"
__LOG_FILE="${__LOG_DIR}/hook-decisions.jsonl"

# Ensure the log dir exists. Done lazily on the first call.
__ensure_log_dir() {
  if [ ! -d "$__LOG_DIR" ]; then
    mkdir -p "$__LOG_DIR" 2>/dev/null || true
  fi
}

# Append a decision to the log. All fields except hookId, decision, and
# reason are optional; populated from env vars set by the calling hook
# script (HOOK_TOOL_NAME, HOOK_EVENT_NAME, HOOK_LATENCY_MS, HOOK_MODEL,
# HOOK_PROMPT_VERSION).
#
# Usage: log_decision "hookId" "decision" "reason"
log_decision() {
  __ensure_log_dir
  local hook_id="$1"
  local decision="$2"
  local reason="${3:-}"

  # ISO-8601 timestamp with millisecond precision. date(1) on macOS doesn't
  # support %N, so fall back to seconds-precision if needed.
  local timestamp
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")"

  # Build the JSON line via jq -nc (compact, single-line, escaped). Falling
  # back to printf if jq isn't available — log lines may be ugly but the
  # hook itself stays functional.
  local jq_bin="${DOTFILES_JQ:-$(command -v jq 2>/dev/null || true)}"
  if [ -n "$jq_bin" ]; then
    "$jq_bin" -nc \
      --arg timestamp "$timestamp" \
      --arg hookId "$hook_id" \
      --arg decision "$decision" \
      --arg reason "$reason" \
      --arg toolName "${HOOK_TOOL_NAME:-}" \
      --arg event "${HOOK_EVENT_NAME:-}" \
      --arg latencyMs "${HOOK_LATENCY_MS:-}" \
      --arg model "${HOOK_MODEL:-}" \
      --arg promptVersion "${HOOK_PROMPT_VERSION:-}" \
      '{
        timestamp: $timestamp,
        hookId: $hookId,
        decision: $decision,
        reason: $reason
      }
      + (if $toolName != "" then { toolName: $toolName } else {} end)
      + (if $event != "" then { event: $event } else {} end)
      + (if $latencyMs != "" then { latencyMs: ($latencyMs | tonumber) } else {} end)
      + (if $model != "" then { model: $model } else {} end)
      + (if $promptVersion != "" then { promptVersion: ($promptVersion | tonumber) } else {} end)' >> "$__LOG_FILE" 2>/dev/null || true
  else
    # jq missing — write a minimal line. Better some data than none.
    printf '{"timestamp":"%s","hookId":"%s","decision":"%s","reason":"%s"}\n' \
      "$timestamp" "$hook_id" "$decision" "${reason//\"/\\\"}" >> "$__LOG_FILE" 2>/dev/null || true
  fi
}
