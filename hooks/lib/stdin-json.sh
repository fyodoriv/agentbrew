#!/bin/bash
# shellcheck shell=bash
# agentbrew/hooks/lib/stdin-json.sh
#
# Helpers for parsing the Claude Code hook stdin JSON.
#
# Claude Code passes hook input as JSON on stdin. Shape (per Anthropic spec):
#   { "session_id": "...",
#     "transcript_path": "...",
#     "hook_event_name": "PreToolUse" | "PostToolUse" | ...,
#     "tool_name": "Edit" | "Write" | "Bash" | "mcp__github__...",
#     "tool_input": { ... event-specific shape ... } }
#
# Common usage:
#   #!/bin/bash
#   source "$(dirname "$0")/../lib/stdin-json.sh"
#   INPUT=$(read_hook_stdin)
#   TOOL=$(json_get "$INPUT" '.tool_name')
#   FP=$(json_get "$INPUT" '.tool_input.file_path')
#
# Why bash + jq instead of node: hooks fire on every tool call; node startup
# (~80ms) compounds. jq is single-binary, sub-10ms cold start. The
# hot-path stays bash.
#
# Dependencies: jq via bootstrap-endpoint-path.sh (dotfiles/bin shim on sandbox PATH).

set -euo pipefail

__STDIN_JSON_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./bootstrap-endpoint-path.sh
source "$__STDIN_JSON_LIB_DIR/bootstrap-endpoint-path.sh"

# Resolve jq after endpoint PATH bootstrap (sandbox hooks lack dotfiles/bin).
hook_jq() {
  local jq_bin="${DOTFILES_JQ:-}"
  if [ -z "$jq_bin" ]; then
    jq_bin="$(command -v jq 2>/dev/null || true)"
  fi
  if [ -z "$jq_bin" ]; then
    return 127
  fi
  "$jq_bin" "$@"
}

# Read the full stdin into a variable. Hook callers should source this and
# call read_hook_stdin at the top of their script.
read_hook_stdin() {
  local input
  input="$(cat)"
  printf '%s' "$input"
}

# Extract a value from the hook JSON via jq path expression.
# Returns the raw value (no quotes for strings). Returns empty string on
# missing path or invalid input — hooks should treat empty as "no match,
# allow" rather than failing.
#
# Usage: json_get "$INPUT" '.tool_input.file_path'
json_get() {
  local input="$1"
  local path="$2"
  hook_jq -r "$path // empty" <<<"$input" 2>/dev/null || printf ''
}

# Extract a value from the hook JSON, defaulting to the second arg if
# missing. Useful when you want to branch on a value that should always
# have a fallback.
#
# Usage: json_get_default "$INPUT" '.tool_input.file_path' '/dev/null'
json_get_default() {
  local input="$1"
  local path="$2"
  local default="$3"
  local val
  val="$(json_get "$input" "$path")"
  if [ -z "$val" ]; then
    printf '%s' "$default"
  else
    printf '%s' "$val"
  fi
}

# Check whether a jq path resolves to a non-empty value. Useful for
# "should this hook even run" gates at the top of a script.
#
# Usage: if json_has "$INPUT" '.tool_input.command'; then ... fi
json_has() {
  local input="$1"
  local path="$2"
  local val
  val="$(hook_jq -r "$path // empty" <<<"$input" 2>/dev/null || true)"
  [ -n "$val" ]
}
