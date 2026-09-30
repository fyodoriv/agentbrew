#!/bin/bash
# shellcheck shell=bash
# agentbrew/hooks/lib/verdict.sh
#
# Helpers for emitting the canonical Claude Code hook verdict shape.
#
# Claude Code interprets hook outcomes by exit code + stderr + stdout JSON:
#   exit 0 + empty stdout         → allow (hook didn't fire / passed)
#   exit 2 + stderr message       → block (stderr shown to agent)
#   exit 0 + stdout JSON          → mutate / advise (PostToolUse only;
#                                   {"decision": "approve", "rewrite": {...}})
#
# Discipline: every hook calls verdict_allow / verdict_block / verdict_mutate
# instead of `exit` directly, so we get consistent telemetry logging.
# The log_decision call writes a JSON line to ~/.cache/agentbrew/hook-decisions.jsonl
# (event-source-of-truth for what hooks fired + their outcomes).

set -euo pipefail

# Resolve the log-decision lib once at source time. Hook scripts source this
# file from .../hooks/lib/verdict.sh, so __VERDICT_LIB_DIR is the lib dir.
__VERDICT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./log-decision.sh
source "$__VERDICT_LIB_DIR/log-decision.sh"

# Allow the tool call. Logs the decision then exits 0.
#
# Usage: verdict_allow "hookId" "reason (optional)"
verdict_allow() {
  local hook_id="$1"
  local reason="${2:-allowed}"
  log_decision "$hook_id" "allow" "$reason"
  exit 0
}

# Block the tool call. Logs the decision, prints a human-readable message
# to stderr (which Claude Code surfaces to the agent), exits 2.
#
# Convention: stderr message format is "<hook id>: <rule violation> — <fix>".
# Multi-line OK; agent sees the whole message.
#
# Usage: verdict_block "hookId" "violation message + how to fix"
verdict_block() {
  local hook_id="$1"
  local message="$2"
  log_decision "$hook_id" "block" "$message"
  echo "[hook $hook_id] $message" >&2
  exit 2
}

# Emit a warning (stderr) without blocking. Logs the decision, prints
# stderr, exits 0. Use this when you want to surface a hint but not
# stop the agent.
#
# Usage: verdict_warn "hookId" "warning message"
verdict_warn() {
  local hook_id="$1"
  local message="$2"
  log_decision "$hook_id" "warn" "$message"
  echo "[hook $hook_id WARN] $message" >&2
  exit 0
}

# Mutate the tool input (PostToolUse only). Writes the canonical JSON
# decision to stdout for Claude Code to interpret. The new_value must
# match the tool_input shape Claude Code expects.
#
# Usage: verdict_mutate "hookId" "reason" '<json-rewrite-payload>'
#   echo '{"decision":"approve","rewrite":{"new_string":"..."}}' | verdict_mutate
verdict_mutate() {
  local hook_id="$1"
  local reason="$2"
  local rewrite_json="$3"
  log_decision "$hook_id" "mutate" "$reason"
  printf '%s\n' "$rewrite_json"
  exit 0
}

# Bypass the hook entirely (env var said skip, or matcher didn't apply).
# Logs the decision with a documented reason then exits 0. Useful at the
# top of a script when guarding against irrelevant tool calls.
#
# Usage: verdict_bypass "hookId" "reason (e.g. tool not gh pr create)"
verdict_bypass() {
  local hook_id="$1"
  local reason="$2"
  log_decision "$hook_id" "bypass" "$reason"
  exit 0
}
