#!/bin/bash
# agentbrew/hooks/checks/goal-retro-before-stop.sh
#
# **Hook**: goal-retro-before-stop
# **Event**: Stop
# **Verdict**: block (gives up after three blocks per goal)
# **Source rule**: skill-plugins/workflow/run-goal/SKILL.md Phase 6 "Update every one of those skills"
#
# run-goal ends every goal with a retro that updates every skill used. Live
# unattended runs fixed the task skill but skipped run-goal itself in one of
# two runs, even with the skill text and the /goal context asking for it.
# This hook holds the end of a goal session until the retro file lists every
# skill used, each with its update.
#
# **Skills used**: every `Skill` tool call in the transcript, plus every Read
# of a `.../skills/<name>/SKILL.md` file. Both are early in a session, so the
# transcript's write lag does not hide them at stop time.
#
# **Retro file**: `<state dir>/<session_id>.retro.md`. Each skill used needs a
# line that names it and its update: a commit SHA, a PR (`#123` or a
# `/pull/` URL), or `task`. A line that says it made no update ("not
# updated", "no change", "no new edit", "did not", "already covers",
# "skipped", "duplicate") does not count, even if it cites an old commit:
# a live retro once passed with "no new edit ... commit 1fcff84".
#
# **State** (session-file scope, shared with goal-set-loads-run-goal and
# goal-contract-before-edit): the hook acts only while
# `<session_id>.contract.md` exists (a goal with a saved contract). It counts
# its blocks in `<session_id>.stopblocks`. On success it clears the counter;
# after three blocks it leaves the counter at the limit and allows. It never
# deletes the contract: a retro often passes mid-goal, and a later skill must
# still be listed. goal-set-loads-run-goal replaces both files on the next
# /goal and deletes files older than seven days.
#
# **Bypass**: `HOOK_BYPASS_GOAL_RETRO_BEFORE_STOP=1`
#
# **Configuration** (optional):
#   - RUN_GOAL_STATE_DIR: state folder. Default `$HOME/.cache/agentbrew/run-goal`.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="goal-retro-before-stop"
readonly MAX_BLOCKS=3

if [ "${HOOK_BYPASS_GOAL_RETRO_BEFORE_STOP:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_GOAL_RETRO_BEFORE_STOP=1"
fi

INPUT="$(read_hook_stdin)"
SESSION_ID="$(json_get "$INPUT" '.session_id')"
case "$SESSION_ID" in
  "" | *[!A-Za-z0-9_-]*) verdict_allow "$HOOK_ID" "no usable session id" ;;
esac

STATE_DIR="${RUN_GOAL_STATE_DIR:-$HOME/.cache/agentbrew/run-goal}"
CONTRACT="$STATE_DIR/$SESSION_ID.contract.md"
RETRO="$STATE_DIR/$SESSION_ID.retro.md"
COUNTER="$STATE_DIR/$SESSION_ID.stopblocks"
if [ ! -f "$CONTRACT" ]; then
  verdict_allow "$HOOK_ID" "no active goal contract"
fi

# Never delete the contract here: a retro often passes mid-goal, and the
# contract is the goal's record for the rest of the run (it is replaced by the
# next /goal and aged out after seven days by goal-set-loads-run-goal).


TRANSCRIPT="$(json_get "$INPUT" '.transcript_path')"
SKILLS=""
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  SKILLS="$(hook_jq -r -s '
    [ .[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")
      | if .name == "Skill" then (.input.skill // empty)
        elif .name == "Read" then ((.input.file_path // "") | (capture("/skills/(?<n>[A-Za-z0-9_:-]+)/SKILL\\.md$").n)? // empty)
        else empty end ]
    | map(sub("^[^:]+:"; "")) | unique | .[]' "$TRANSCRIPT" 2>/dev/null || true)"
fi
case "$SKILLS" in *run-goal*) ;; *) SKILLS="$(printf '%s\nrun-goal' "$SKILLS")" ;; esac

MISSING=""
for skill in $SKILLS; do
  [ -n "$skill" ] || continue
  if [ -f "$RETRO" ] && grep -F -- "$skill" "$RETRO" | grep -viE 'not updated|no change|no new|no edit|did not|already cover|skipped|duplicate' |
    grep -qE '\b[0-9a-f]{7,40}\b|#[0-9]+|/pull/[0-9]+|\btask\b'; then
    continue
  fi
  MISSING="$MISSING $skill"
done

if [ -z "$MISSING" ]; then
  rm -f "$COUNTER"
  verdict_allow "$HOOK_ID" "retro lists every skill used"
fi

blocks=0
[ -f "$COUNTER" ] && blocks="$(cat "$COUNTER" 2>/dev/null || echo 0)"
case "$blocks" in "" | *[!0-9]*) blocks=0 ;; esac
if [ "$blocks" -ge "$MAX_BLOCKS" ]; then
  # The counter stays at the limit, so later Stops in this goal allow too.
  verdict_allow "$HOOK_ID" "gave up after $MAX_BLOCKS blocks; missing:$MISSING"
fi
echo $((blocks + 1)) >"$COUNTER"

verdict_block "$HOOK_ID" "The goal's retro is not done. Update every skill used (run-goal Phase 6), then save the Skills updated list with the Write tool to $RETRO (pre-approved): one line per skill with its commit SHA, PR (#123 or URL), or task id. Still missing:$MISSING."
