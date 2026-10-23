#!/bin/bash
# agentbrew/hooks/checks/perf-record.sh
#
# **Hook**: perf-record (also deployed as perf-record-failure, perf-record-turn,
#           perf-record-attempt, and perf-record-denied)
# **Events**: PostToolUse, PostToolUseFailure, UserPromptSubmit, PreToolUse, PermissionDenied
# **Verdict**: warn (it never blocks and never prints; it only appends a row)
# **Bypass**: HOOK_BYPASS_PERF_RECORD=1
#
# Appends one JSON row per tool call to the agent perf log:
#   ${XDG_STATE_HOME:-$HOME/.local/state}/agentbrew/perf/YYYY-MM.jsonl
# Tool row: {"project","ts","sid","tool","ms","ok","key","id","agent"}
# Attempt row: {"project","ts","sid","ev":"attempt","tool","key","id","agent"} (PreToolUse)
# Tool and attempt rows add "bg":true for an Agent or Task call with run_in_background.
# Denied row: {"project","ts","sid","ev":"denied","tool","key","id","agent"} (PermissionDenied)
# Turn row: {"project","ts","sid","ev":"turn"} (from UserPromptSubmit)
# "id" is the tool_use_id. It pairs an attempt with its completion, so a
# call that never ran (permission prompt, hook block) shows as blocked.
# lib/perf-row.jq builds the row and the step key (see its privacy notes).
#
# Speed: one jq call plus shell builtins that work on macOS bash 3.2.
# Read the log with ~/.config/agentbrew/scripts/agent-perf.mjs.

[ "${HOOK_BYPASS_PERF_RECORD:-0}" = "1" ] && exit 0

HOOK_DIR="${BASH_SOURCE[0]%/*}"
[ "$HOOK_DIR" != "${BASH_SOURCE[0]}" ] || HOOK_DIR="."
ROW_JQ="$HOOK_DIR/lib/perf-row.jq"
[ -f "$ROW_JQ" ] || ROW_JQ="$HOOK_DIR/../lib/perf-row.jq"
[ -f "$ROW_JQ" ] || exit 0

JQ="${DOTFILES_JQ:-}"
[ -n "$JQ" ] || JQ="$(command -v jq 2>/dev/null)"
[ -n "$JQ" ] || { [ -x /opt/homebrew/bin/jq ] && JQ=/opt/homebrew/bin/jq; }
[ -n "$JQ" ] || { [ -x /usr/bin/jq ] && JQ=/usr/bin/jq; }
[ -n "$JQ" ] || exit 0

OUT="$("$JQ" -r -f "$ROW_JQ" 2>/dev/null)" || exit 0
[ -n "$OUT" ] || exit 0

CWD="${OUT%%$'\n'*}"
TAIL="${OUT#*$'\n'}"
[ "$TAIL" != "$OUT" ] || exit 0
MONTH="${TAIL%%$'\n'*}"
REST="${TAIL#*$'\n'}"
[ "$REST" != "$TAIL" ] || exit 0
case "$MONTH" in
[0-9][0-9][0-9][0-9]-[0-9][0-9]) ;;
*) exit 0 ;;
esac

# Project: the git repo name. A linked worktree maps back to its main repo.
PROJECT=""
DIR="$CWD"
while [ -n "$DIR" ] && [ "$DIR" != "/" ]; do
  if [ -d "$DIR/.git" ]; then
    PROJECT="${DIR##*/}"
    break
  fi
  if [ -f "$DIR/.git" ]; then
    LINE=""
    read -r LINE <"$DIR/.git" 2>/dev/null
    GITDIR="${LINE#gitdir: }"
    case "$GITDIR" in
    */.git/worktrees/*)
      MAIN="${GITDIR%%/.git/worktrees/*}"
      PROJECT="${MAIN##*/}"
      ;;
    *) PROJECT="${DIR##*/}" ;;
    esac
    break
  fi
  DIR="${DIR%/*}"
done
[ -n "$PROJECT" ] || PROJECT="${CWD##*/}"
PROJECT="${PROJECT//[^A-Za-z0-9._-]/_}"
[ -n "$PROJECT" ] || PROJECT="unknown"

# Redact a project whose name matches a plugin leak pattern (written by
# `agentbrew sync`, one POSIX ERE per line).
REDACT="${XDG_STATE_HOME:-$HOME/.local/state}/agentbrew/redact-patterns.txt"
if [ -f "$REDACT" ]; then
  shopt -s nocasematch
  while IFS= read -r RE || [ -n "$RE" ]; do
    [ -n "$RE" ] || continue
    if [[ "$PROJECT" =~ $RE ]]; then
      PROJECT="redacted"
      break
    fi
  done <"$REDACT"
  shopt -u nocasematch
fi

PERF_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/agentbrew/perf"
LOG="$PERF_DIR/$MONTH.jsonl"
umask 077
if [ ! -f "$LOG" ]; then
  mkdir -p "$PERF_DIR" 2>/dev/null || exit 0
  # A new month file starts: drop month files older than 180 days.
  /usr/bin/find "$PERF_DIR" -maxdepth 1 -name '*.jsonl' -mtime +180 -delete 2>/dev/null
fi
printf '{"project":"%s",%s\n' "$PROJECT" "$REST" >>"$LOG" 2>/dev/null
exit 0
