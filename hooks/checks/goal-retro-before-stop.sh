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
# line that names it and its update: a commit SHA, a PR or issue (`#123`,
# `/pull/` URL or `/issues/` URL), or `task` with the quoted error of a write
# that failed (`write failed: <error>`). A bare task id does not count: a live
# goal (2026-11-06) parked an approved retro update as a task from a stale
# memory note without trying the write. A line that says it made no update ("not
# updated", "no change", "no new edit", "did not", "already covers",
# "skipped", "duplicate") does not count, even if it cites an old commit:
# a live retro once passed with "no new edit ... commit 1fcff84".
#
# **Host-served skills**: the host app serves some skills (for example
# artifact-design from the Claude app) with no source on this Mac, so no
# update or write is possible. A line "<skill>: host-served, no source"
# passes only when no `<name>/SKILL.md` exists in any skills folder:
# `~/.*/skills`, `~/.config/*/skills`, the Claude app's skills folder,
# agentbrew's installed-skills, plugin skills under `~/.claude/plugins`, and
# the session folder's `.claude/skills` and `.agents/skills`. An owned slash
# command is a source too: `<name>.md` in `~/.*/commands`,
# `~/.config/*/commands`, the session folder's `.claude/commands`, or a
# plugin's `commands/` (ship-it is one), at any depth (`commands/team/
# deploy.md` counts for `team:deploy`); plugin symlinks are followed. So is any SKILL.md the session read
# that exists, wherever it is. A goal blocked three Stops on one such skill
# (2026-11-07).
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
# **Waiting on workers** (issue #305): a goal that runs background workers
# ends turns mid-goal while it waits for their notifications. The retro
# belongs at the end, so the hook allows (and does not count a block) while
# a background launch in the transcript has no `<tool-use-id>` completion
# notification yet. A launch is a tool result that says "Async agent
# launched" or "running in background with ID".
#
# **Bypass**: `HOOK_BYPASS_GOAL_RETRO_BEFORE_STOP=1`
#
# **Configuration** (optional):
#   - RUN_GOAL_STATE_DIR: state folder. Default `$HOME/.cache/agentbrew/run-goal`.
#   - RUN_GOAL_SKILL_DIRS: colon-separated skills folders for the host-served
#     check. Replaces the default folders above.

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

# A clock deadline belongs to this session's contract. Only a future numeric
# epoch plus an explicit draft retro defers enforcement; malformed or expired
# deadlines retain the normal final-retro checks below.
CLOCK_EPOCH="$(sed -nE 's/^Clock wrap-up epoch: ([1-9][0-9]{9})$/\1/p' "$CONTRACT")"
case "$CLOCK_EPOCH" in
  "" | *[!0-9]*) ;;
  *)
    if [ "${#CLOCK_EPOCH}" -eq 10 ] && [ "$CLOCK_EPOCH" -gt "$(date +%s)" ] &&
      [ -f "$RETRO" ] && grep -qE '^Goal result: in progress \(clock goal, wrap-up at .+\)$' "$RETRO"; then
      verdict_allow "$HOOK_ID" "clock goal still running; final retro required at deadline $CLOCK_EPOCH"
    fi
    ;;
esac

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
# Skills read from a SKILL.md that exists have a source on disk, even
# outside the searched folders: they can never be host-served.
READ_SKILLS=""
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  while IFS= read -r path; do
    [ -n "$path" ] && [ -f "$path" ] || continue
    path="${path%/SKILL.md}"
    READ_SKILLS="$READ_SKILLS ${path##*/} "
  done <<EOF_READS
$(hook_jq -r -s '
    [ .[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")
      | select(.name == "Read") | (.input.file_path // "")
      | select(test("/skills/[A-Za-z0-9_:-]+/SKILL\\.md$")) ] | unique | .[]' "$TRANSCRIPT" 2>/dev/null || true)
EOF_READS
fi
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  RUNNING="$(hook_jq -r -s '
    def texts: if type == "string" then . elif type == "array" then map(texts) | join("\n")
      elif type == "object" then ((.text // .content // "") | texts) else "" end;
    [ .[] | select(.type == "user") | .message.content ] as $c
    | ([ $c[] | arrays | .[] | select(.type? == "tool_result")
         | select((.content | texts) | test("Async agent launched|running in background with ID"))
         | .tool_use_id ]) as $launched
    | ([ $c[] | texts | scan("<tool-use-id>([^<]+)</tool-use-id>") | .[0] ]) as $done
    | ($launched - $done) | length' "$TRANSCRIPT" 2>/dev/null || echo 0)"
  case "$RUNNING" in "" | *[!0-9]*) RUNNING=0 ;; esac
  if [ "$RUNNING" -gt 0 ]; then
    verdict_allow "$HOOK_ID" "goal still waiting on $RUNNING background task(s); retro runs at the end"
  fi
fi

case "$SKILLS" in *run-goal*) ;; *) SKILLS="$(printf '%s\nrun-goal' "$SKILLS")" ;; esac

SESSION_CWD="$(json_get "$INPUT" '.cwd')"
# Exit 0 when a local source exists for $1: a SKILL.md in any skills folder,
# a SKILL.md the session read, or an owned slash command (commands/<name>.md,
# also nested as commands/<sub>/<name>.md). Plugin symlinks are followed.
# Exit 0 when commands folder $1 holds $2.md at any depth: nested folders
# (commands/team/deploy.md) serve "team:deploy", counted as "deploy".
# find -L follows symlinks; it detects loops and skips them, and -maxdepth
# bounds the walk.
has_command_file() {
  [ -d "$1" ] || return 1
  [ -n "$(find -L "$1" -maxdepth 6 -type f -name "$2.md" -print -quit 2>/dev/null)" ]
}
has_local_skill() {
  local name="$1" dir
  case "$READ_SKILLS" in *" $name "*) return 0 ;; esac
  if [ -n "${RUN_GOAL_SKILL_DIRS:-}" ]; then
    local IFS=:
    for dir in $RUN_GOAL_SKILL_DIRS; do
      [ -n "$dir" ] && [ -f "$dir/$name/SKILL.md" ] && return 0
    done
    return 1
  fi
  for dir in "$HOME"/.*/skills "$HOME"/.config/*/skills \
    "$HOME/Library/Application Support/Claude/skills" \
    "$HOME/.config/agentbrew/installed-skills"; do
    [ -f "$dir/$name/SKILL.md" ] && return 0
  done
  for dir in "$HOME"/.*/commands "$HOME"/.config/*/commands; do
    has_command_file "$dir" "$name" && return 0
  done
  if [ -n "$SESSION_CWD" ]; then
    for dir in "$SESSION_CWD/.claude/skills" "$SESSION_CWD/.agents/skills"; do
      [ -f "$dir/$name/SKILL.md" ] && return 0
    done
    has_command_file "$SESSION_CWD/.claude/commands" "$name" && return 0
  fi
  [ -d "$HOME/.claude/plugins" ] &&
    [ -n "$(find -L "$HOME/.claude/plugins" -maxdepth 8 \( -path "*/skills/$name/SKILL.md" -o -path "*/commands/$name.md" \) -print -quit 2>/dev/null)" ] &&
    return 0
  return 1
}

MISSING=""
for skill in $SKILLS; do
  [ -n "$skill" ] || continue
  ok=0
  if [ -f "$RETRO" ]; then
    while IFS= read -r line; do
      # The quoted error after "write failed:" is the tool's text, not ours:
      # judge only the part before it for "no update" words and evidence.
      head=$(sed -E 's/[Ww][Rr][Ii][Tt][Ee] [Ff][Aa][Ii][Ll][Ee][Dd]:.*//' <<<"$line")
      # Drop the skill name ("- task-command-center: ..."), so only the
      # update text is judged.
      case "$head" in *:*) head="${head#*:}" ;; esac
      grep -qiE 'not updated|no change|no new|no edit|did not|already cover|skipped|duplicate' <<<"$head" && continue
      # A task citation ("task <id>") is not evidence by itself: its id may
      # hold a date or a number. Judge the rest of the line without it.
      rest=$(sed -E 's/(^|[^A-Za-z])[Tt][Aa][Ss][Kk] +[^ ,;]+/\1/g' <<<"$head")
      if grep -qE '\b[0-9a-f]{7,40}\b|#[0-9]+|/pull/[0-9]+|/issues/[0-9]+' <<<"$rest"; then
        ok=1
      elif grep -qiE '(^|[^A-Za-z])host-served' <<<"$head" && ! has_local_skill "$skill"; then
        # No source on this Mac: nothing to update or write.
        ok=1
      elif [ "$rest" != "$head" ] && grep -qiE 'write failed: *[^ ]' <<<"$line"; then
        # A task is an update only with the error of a write that was tried.
        ok=1
      fi
    done <<EOF_RETRO
$(grep -F -- "$skill" "$RETRO")
EOF_RETRO
  fi
  [ "$ok" = 1 ] && continue
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

verdict_block "$HOOK_ID" "The goal's retro is not done. Update every skill used (run-goal Phase 6), then save the Skills updated list with the Write tool to $RETRO (pre-approved): one line per skill with its commit SHA or PR (#123 or URL); a skill with no local SKILL.md may say <skill>: host-served, no source. A task counts only with the quoted error of a write you tried (task <id>, write failed: <error>): with a standing approval, ship the update instead. Still missing:$MISSING."
