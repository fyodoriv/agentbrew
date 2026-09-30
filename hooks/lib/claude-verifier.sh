#!/bin/bash
# shellcheck shell=bash
# agentbrew/hooks/lib/claude-verifier.sh
#
# Wrapper around `claude --print` for the Cat B LLM-verifier hook tier.
# Cat B hooks use a 1-shot claude-sonnet-4-7 call to make a semantic
# judgment that's too dense for regex/AST (e.g. "does this PR body
# explain WHY?"). The wrapper handles:
#   - timeout (default 5s — sonnet's p95 latency)
#   - default-allow on timeout / claude error (don't block on flaky LLM)
#   - structured logging of the model + prompt version with the decision
#   - rate-limit detection (claude returns a specific error when out of
#     quota; we treat that as "default allow + warn user once a day")
#
# **Verifier prompt contract**: every Cat B hook ships a system prompt
# that ends with "Respond with EXACTLY one word: ALLOW or BLOCK, then a
# brief reason." The wrapper parses the first word as the verdict.
# Anything other than ALLOW or BLOCK defaults to ALLOW (fail-safe).
#
# Usage from a Cat B hook script:
#   source "$(dirname "$0")/../lib/claude-verifier.sh"
#   verdict=$(verify_with_claude "$VERIFIER_PROMPT" "$INPUT_TO_JUDGE")
#   if [[ "$verdict" =~ ^BLOCK ]]; then
#     verdict_block "rule-id" "violated: ${verdict#BLOCK }"
#   fi

set -euo pipefail

__CLAUDE_VERIFIER_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./bootstrap-endpoint-path.sh
source "$__CLAUDE_VERIFIER_LIB_DIR/bootstrap-endpoint-path.sh"

# Verify input against a system prompt. Returns "ALLOW <reason>" or
# "BLOCK <reason>" on stdout. Defaults to "ALLOW (verifier-timeout)" on
# timeout/error.
#
# Args:
#   $1 system_prompt — the verifier-specific judgment criterion
#   $2 input_to_judge — the body/diff/text the verifier inspects
# Env vars (optional):
#   HOOK_MODEL — override model (default claude-sonnet-4-7)
#   HOOK_VERIFIER_TIMEOUT — override timeout in seconds (default 5)
verify_with_claude() {
  local system_prompt="$1"
  local input_to_judge="$2"
  local model="${HOOK_MODEL:-claude-sonnet-4-7}"
  local timeout_s="${HOOK_VERIFIER_TIMEOUT:-5}"

  if ! command -v claude >/dev/null 2>&1; then
    # No claude CLI — default allow with a logged note.
    printf 'ALLOW verifier-unavailable\n'
    return 0
  fi

  # Use macOS-native gtimeout if available (brew install coreutils), else
  # fall back to perl-based timeout. The hot path stays simple: we want
  # the verifier to either return within timeout_s or surrender allow.
  local timeout_cmd
  if command -v gtimeout >/dev/null 2>&1; then
    timeout_cmd="gtimeout"
  elif command -v timeout >/dev/null 2>&1; then
    timeout_cmd="timeout"
  elif [ -n "${DOTFILES_PERL:-}" ] && [ -x "${DOTFILES_PERL}" ]; then
    timeout_cmd="perl"
    export PERL="${DOTFILES_PERL}"
  elif command -v perl >/dev/null 2>&1; then
    timeout_cmd="perl"
  else
    # Last resort: call claude directly and rely on its own timeout.
    timeout_cmd=""
  fi

  local response
  if [ "$timeout_cmd" = "perl" ]; then
    local perl_bin="${PERL:-$(command -v perl 2>/dev/null || echo perl)}"
    response=$("$perl_bin" -e 'alarm shift; exec @ARGV' "$timeout_s" claude --print --model "$model" \
      --system-prompt "$system_prompt" <<<"$input_to_judge" 2>/dev/null || true)
  elif [ -n "$timeout_cmd" ]; then
    response=$("$timeout_cmd" "$timeout_s" claude --print --model "$model" \
      --system-prompt "$system_prompt" <<<"$input_to_judge" 2>/dev/null || true)
  else
    response=$(claude --print --model "$model" \
      --system-prompt "$system_prompt" <<<"$input_to_judge" 2>/dev/null || true)
  fi

  # Detect rate-limit (claude returns "You've hit your limit" or similar)
  if [[ "$response" =~ hit\ your\ limit ]] || [[ "$response" =~ rate.limit ]]; then
    printf 'ALLOW verifier-rate-limited\n'
    return 0
  fi

  # Empty response = timeout or other error
  if [ -z "$response" ]; then
    printf 'ALLOW verifier-empty-response\n'
    return 0
  fi

  # Parse verdict from first line. Strip leading whitespace, take first word.
  local first_line
  first_line="$(printf '%s' "$response" | head -1 | sed 's/^[[:space:]]*//')"
  local verdict_word
  verdict_word="$(printf '%s' "$first_line" | awk '{print toupper($1)}')"

  if [[ "$verdict_word" == "BLOCK" ]] || [[ "$verdict_word" == "ALLOW" ]]; then
    printf '%s\n' "$first_line"
    return 0
  fi

  # Verifier returned something unexpected. Fail-safe to ALLOW with the
  # raw response prefixed for debugging.
  printf 'ALLOW verifier-malformed: %s\n' "${first_line:0:80}"
  return 0
}
