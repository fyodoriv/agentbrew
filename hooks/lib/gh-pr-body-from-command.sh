#!/bin/bash
# shellcheck shell=bash
# agentbrew/hooks/lib/gh-pr-body-from-command.sh
#
# Shared helpers for hooks that check `gh pr ...` shell commands.

# gh_in_command_position COMMAND SUBCOMMAND_ERE
# Succeeds when `gh <subcommand>` runs as a command: at a line start, or after
# ; & | ( or $(, with optional VAR=value prefixes. A mention inside quoted text
# (an echo, a Python string) does not match.
# Example: gh_in_command_position "$COMMAND" 'pr[[:space:]]+(create|edit)'
gh_in_command_position() {
  local command="$1"
  local subcommand="$2"
  grep -qE "(^|[;&|(]|\\\$\\()[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*gh[[:space:]]+${subcommand}\\b" <<<"$command"
}

# gh_pr_body_from_command COMMAND
# Prints the inline --body text, with literal \n turned into newlines. A
# multi-line --body (for example a heredoc) defeats the one-line parse, so it
# then prints the whole command, which holds the body verbatim.
gh_pr_body_from_command() {
  local command="$1"
  local body
  body="$(printf '%s' "$command" | sed -nE 's/.*--body[[:space:]]+"([^"]*)".*/\1/p' | head -1)"
  if [ -z "$body" ]; then
    body="$(printf '%s' "$command" | sed -nE "s/.*--body[[:space:]]+'([^']*)'.*/\1/p" | head -1)"
  fi
  if [ -z "$body" ] && [[ "$command" == *$'\n'* ]] && grep -qE -- '--body([[:space:]]|=)' <<<"$command"; then
    body="$command"
  fi
  if [ -z "$body" ]; then
    return 1
  fi
  printf '%s' "$body" | sed 's/\\n/\n/g'
}

# gh_pr_body_text COMMAND REPO_DIR
# Prints the PR body: a readable --body-file (relative paths resolve against
# REPO_DIR), else the inline --body, else (for a multi-line --body such as a
# heredoc) the whole command. It prints the text raw; the caller expands \n.
gh_pr_body_text() {
  local command="$1"
  local repo_dir="$2"
  local file body=""
  file="$(printf '%s' "$command" | sed -nE "s/.*--body-file(=|[[:space:]]+)\"([^\"]*)\".*/\2/p" | head -1)"
  if [ -z "$file" ]; then
    file="$(printf '%s' "$command" | sed -nE "s/.*--body-file(=|[[:space:]]+)'([^']*)'.*/\2/p" | head -1)"
  fi
  if [ -z "$file" ]; then
    file="$(printf '%s' "$command" | sed -nE "s/.*--body-file(=|[[:space:]]+)([^[:space:]]+).*/\2/p" | head -1)"
  fi
  if [ -n "$file" ] && [ "$file" != "-" ]; then
    if [ "${file#/}" = "$file" ]; then
      file="$repo_dir/$file"
    fi
    if [ -f "$file" ]; then
      cat "$file"
      return 0
    fi
  fi

  body=$(printf '%s' "$command" | sed -nE "s/.*--body[[:space:]]+\"([^\"]*)\".*/\1/p" | head -1)
  if [ -z "$body" ]; then
    body=$(printf '%s' "$command" | sed -nE "s/.*--body[[:space:]]+'([^']*)'.*/\1/p" | head -1)
  fi
  if [ -z "$body" ] && grep -qE -- '--body([[:space:]]|=)' <<<"$command"; then
    body="$command"
  fi
  if [ -z "$body" ]; then
    return 1
  fi
  printf '%s' "$body"
}
