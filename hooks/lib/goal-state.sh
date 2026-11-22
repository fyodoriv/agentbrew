#!/bin/bash
# agentbrew/hooks/lib/goal-state.sh
#
# Prints the state token a goal judge verdict must carry, for example
# `gs1-3f9a0c41d2e8b7a6`. goal-judges-before-stop recomputes it at Stop, so a
# verdict counts only for the exact state it judged.
#
# Usage: bash goal-state.sh <contract path> [judge dir]
#
# The token is a SHA-256 over:
#   - the contract file (so its `Judges:` and `Judged paths:` lines are frozen),
#   - each contract judge's rubric: its file up to the `## Calibration`
#     heading (calibration notes may be added at any time),
#   - each judged path: for a git work tree, HEAD, `git status`, the diff
#     against HEAD, and the untracked files' contents; for a plain file or
#     folder, its files' contents.
# Any edit to the work (Edit tool, Bash, a subagent) changes the token.
#
# Contract lines it reads:
#   Judges: <id>, <id>, <id>
#   Judged paths: <path>, <path>     (`~` expands to $HOME)
#
# Exit 2 with a message on stderr when the contract lacks either line, a judge
# file is missing, or a judged path does not exist.

set -uo pipefail

CONTRACT="${1:-}"
JUDGE_DIR="${2:-${RUN_GOAL_JUDGE_DIR:-$HOME/.config/agentbrew/goal-judges}}"
[ -f "$CONTRACT" ] || { echo "goal-state: no contract file: $CONTRACT" >&2; exit 2; }

sha() { if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi | cut -c1-64; }
field() { # contract field value: "Judges" -> "a, b, c"
  sed -nE "s/^[-*_ ]*$1:[*_ ]*(.*)$/\\1/p" "$CONTRACT" | head -1
}
split() { tr ',' '\n' | sed -E 's/^[[:space:]`]+//; s/[[:space:]`]+$//' | sed '/^$/d'; }

JUDGES="$(field Judges | split)"
PATHS="$(field 'Judged paths' | split)"
[ -n "$JUDGES" ] || { echo "goal-state: contract has no 'Judges: <id>, <id>, <id>' line" >&2; exit 2; }
[ -n "$PATHS" ] || { echo "goal-state: contract has no 'Judged paths: <path>, ...' line" >&2; exit 2; }

while IFS= read -r id; do
  case "$id" in *[!a-z0-9-]* | "") echo "goal-state: bad judge id '$id' (use a-z, 0-9, -)" >&2; exit 2 ;; esac
  [ -f "$JUDGE_DIR/$id.md" ] || { echo "goal-state: judge file missing: $JUDGE_DIR/$id.md" >&2; exit 2; }
done <<<"$JUDGES"
while IFS= read -r p; do
  [ -e "${p/#\~/$HOME}" ] || { echo "goal-state: judged path missing: ${p/#\~/$HOME}" >&2; exit 2; }
done <<<"$PATHS"

{
  printf 'contract\n'; cat "$CONTRACT"
  while IFS= read -r id; do
    f="$JUDGE_DIR/$id.md"
    printf '\njudge %s\n' "$id"
    awk '/^## Calibration/{exit} {print}' "$f"
  done <<<"$JUDGES"
  while IFS= read -r p; do
    p="${p/#\~/$HOME}"
    printf '\npath %s\n' "$p"
    if [ -d "$p" ] && git -C "$p" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      git -C "$p" rev-parse HEAD 2>/dev/null
      git -C "$p" status --porcelain=v1 -uall . 2>/dev/null
      git -C "$p" diff HEAD --binary -- . 2>/dev/null | sha
      git -C "$p" ls-files -o --exclude-standard -z -- . 2>/dev/null |
        (cd "$p" && xargs -0 shasum -a 256 2>/dev/null)
    else
      find "$p" -type f -not -path '*/.git/*' 2>/dev/null | LC_ALL=C sort |
        while IFS= read -r f; do printf '%s ' "$f"; sha <"$f"; done
    fi
  done <<<"$PATHS"
} | sha | cut -c1-16 | sed 's/^/gs1-/'
