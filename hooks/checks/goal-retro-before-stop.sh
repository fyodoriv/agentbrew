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
# its blocks in `<session_id>.stopblocks`. On success, or after three blocks,
# it deletes the contract and the counter so the session can end. The retro
# file stays for review; goal-set-loads-run-goal deletes retro files older
# than seven days.
#
# **run-goal ships**: when run-goal's source repo is known (an agentbrew
# checkout with a GitHub origin, or RUN_GOAL_SOURCE_REPO=owner/repo), its line
# must cite a PR that `gh pr view` reports as MERGED. RUN_GOAL_GH overrides
# the gh binary (tests use a stub).
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

finish() {
  rm -f "$CONTRACT" "$COUNTER"
  verdict_allow "$HOOK_ID" "$1"
}

TRANSCRIPT="$(json_get "$INPUT" '.transcript_path')"
SKILLS=""
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  SKILLS="$(hook_jq -r -s '
    [ .[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")
      | if .name == "Skill" then (.input.skill // empty)
        elif .name == "Read" then ((.input.file_path // "") | capture("/skills/(?<n>[A-Za-z0-9_:-]+)/SKILL\\.md$")?.n // empty)
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

# run-goal's own update must ship, not park: live runs committed it and then
# parked the PR (2 of 3) or ended at "I'll merge when green". When run-goal's
# source repo is known, its line must cite a PR that gh reports as MERGED.
# Without gh, or when gh fails, the SHA or PR line above is enough (fail open).
RG_REPO="${RUN_GOAL_SOURCE_REPO:-}"
if [ -z "$RG_REPO" ]; then
  for base in "$HOME"/apps/*/agentbrew "$HOME/apps/agentbrew" "$HOME/src/agentbrew"; do
    if [ -f "$base/skill-plugins/workflow/run-goal/SKILL.md" ]; then
      RG_REPO="$(git -C "$base" remote get-url origin 2>/dev/null | sed -nE 's#.*github\.com[:/]([^/]+/[^/.]+)(\.git)?$#\1#p')"
      break
    fi
  done
fi
case " $MISSING " in *" run-goal "*) RG_REPO="" ;; esac
GH_BIN="${RUN_GOAL_GH:-gh}"
if [ -n "$RG_REPO" ] && command -v "$GH_BIN" >/dev/null 2>&1; then
  RG_LINE="$(grep -F -- "run-goal" "$RETRO" 2>/dev/null | grep -viE 'not updated|no change|no new|no edit|did not|already cover|skipped|duplicate' | head -1)"
  RG_PR="$(printf '%s' "$RG_LINE" | grep -oE '/pull/[0-9]+|#[0-9]+' | head -1 | grep -oE '[0-9]+' || true)"
  if [ -z "$RG_PR" ]; then
    MISSING="$MISSING run-goal(cite its merged PR in $RG_REPO, not only a commit)"
  else
    RG_STATE="$("$GH_BIN" pr view "$RG_PR" -R "$RG_REPO" --json state -q .state 2>/dev/null || echo UNKNOWN)"
    case "$RG_STATE" in
      MERGED | UNKNOWN) ;;
      *) MISSING="$MISSING run-goal(PR #$RG_PR is $RG_STATE: run the repo gate, then merge it)" ;;
    esac
  fi
fi

if [ -z "$MISSING" ]; then
  finish "retro lists every skill used"
fi

blocks=0
[ -f "$COUNTER" ] && blocks="$(cat "$COUNTER" 2>/dev/null || echo 0)"
case "$blocks" in "" | *[!0-9]*) blocks=0 ;; esac
if [ "$blocks" -ge "$MAX_BLOCKS" ]; then
  finish "gave up after $MAX_BLOCKS blocks; missing:$MISSING"
fi
echo $((blocks + 1)) >"$COUNTER"

verdict_block "$HOOK_ID" "The goal's retro is not done. Update every skill used (run-goal Phase 6), then save the Skills updated list with the Write tool to $RETRO (pre-approved): one line per skill with its commit SHA, PR (#123 or URL), or task id. Still missing:$MISSING."
