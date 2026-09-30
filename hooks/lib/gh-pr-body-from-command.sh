#!/bin/bash
# shellcheck shell=bash
# agentbrew/hooks/lib/gh-pr-body-from-command.sh
#
# Shared helper: extract --body text from a gh pr create/edit shell command.

gh_pr_body_from_command() {
  local command="$1"
  local command_oneline body
  command_oneline="$(printf '%s' "$command" | tr '\n' ' ')"
  body="$(printf '%s' "$command_oneline" | sed -nE 's/.*--body[[:space:]]+"([^"]*)".*/\1/p' | head -1)"
  if [ -z "$body" ]; then
    body="$(printf '%s' "$command_oneline" | sed -nE "s/.*--body[[:space:]]+'([^']*)'.*/\1/p" | head -1)"
  fi
  if [ -z "$body" ]; then
    return 1
  fi
  printf '%s' "$body" | sed 's/\\n/\n/g'
}
