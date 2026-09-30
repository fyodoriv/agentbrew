#!/bin/bash
# agentbrew/hooks/checks/memory-sync-projects-session-end.sh
#
# **Hook**: memory-sync-projects-session-end
# **Event**: SessionEnd
# **Verdict**: allow (non-blocking background sync)
#
# Claude Code keeps project memory files under ~/.claude/projects. Schedule a
# bounded shared-memory ingest when a session ends, but never delay or fail
# Claude's shutdown. The daily Dotfiles LaunchAgent remains the recovery path.

set -euo pipefail
unset BASH_ENV ENV

AGENTBREW_BIN="${AGENTBREW_MEMORY_BIN:-${DOTFILES_MEMORY_AGENTBREW_BIN:-agentbrew}}"

utc_timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

write_receipt() {
  local receipt_path="$1"
  local scheduled_at="$2"
  local started_at="$3"
  local completed_at="$4"
  local elapsed_ms="$5"
  local outcome="$6"
  local stores="$7"
  local synced="$8"
  local skipped="$9"
  local unchanged="${10}"
  local receipt_dir tmp started_json completed_json

  receipt_dir="$(dirname "$receipt_path")"
  mkdir -p "$receipt_dir" || return 1
  started_json="null"
  completed_json="null"
  [ -n "$started_at" ] && started_json="\"$started_at\""
  [ -n "$completed_at" ] && completed_json="\"$completed_at\""
  umask 077
  tmp="$(mktemp "${receipt_path}.XXXXXX")" || return 1
  cat >"$tmp" <<EOF
{
  "version": 1,
  "scheduledAt": "$scheduled_at",
  "startedAt": $started_json,
  "completedAt": $completed_json,
  "elapsedMs": $elapsed_ms,
  "outcome": "$outcome",
  "stores": $stores,
  "synced": $synced,
  "skipped": $skipped,
  "unchanged": $unchanged
}
EOF
  mv -f "$tmp" "$receipt_path"
}

write_last_success() {
  local last_success_path="$1"
  local now_epoch="$2"
  local tmp

  umask 077
  tmp="$(mktemp "${last_success_path}.XXXXXX")" || return 1
  printf '%s\n' "$now_epoch" >"$tmp"
  mv -f "$tmp" "$last_success_path"
}

receipt_outcome() {
  local receipt_path="$1"
  [ -s "$receipt_path" ] || return 1
  if command -v node >/dev/null 2>&1 \
    && node -e '
      const fs = require("node:fs");
      try {
        const outcome = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).outcome;
        if (!["none", "ok", "degraded", "error", "scheduled"].includes(outcome)) process.exit(1);
        process.stdout.write(outcome);
      } catch {
        process.exit(1);
      }
    ' "$receipt_path"; then
    return 0
  fi

  # The compatibility path covers a CLI shim whose runtime is not on PATH.
  # It handles minified or reordered JSON without assuming a field position.
  awk '
    /"outcome"[[:space:]]*:/ {
      value = $0
      sub(/.*"outcome"[[:space:]]*:[[:space:]]*"/, "", value)
      sub(/".*/, "", value)
      if (value == "none" || value == "ok" || value == "degraded" || value == "error" || value == "scheduled") {
        print value
        found = 1
        exit
      }
    }
    END { if (!found) exit 1 }
  ' "$receipt_path"
}

run_background_sync() {
  LOCK_DIR_FOR_BACKGROUND="$1"
  RECEIPT_FOR_BACKGROUND="$2"
  LAST_SUCCESS_FOR_BACKGROUND="$3"
  SCHEDULED_AT_FOR_BACKGROUND="$4"
  STARTED_AT_FOR_BACKGROUND="$(utc_timestamp)"
  STARTED_EPOCH_FOR_BACKGROUND="$(date +%s)"
  SYNC_STATUS=1
  trap 'rmdir "$LOCK_DIR_FOR_BACKGROUND" 2>/dev/null || true' EXIT

  if command -v "$AGENTBREW_BIN" >/dev/null 2>&1; then
    set +e
    AGENTBREW_MEMORY_SYNC_RECEIPT_PATH="$RECEIPT_FOR_BACKGROUND" \
      AGENTBREW_MEMORY_SYNC_SCHEDULED_AT="$SCHEDULED_AT_FOR_BACKGROUND" \
      AGENTBREW_MEMORY_SYNC_STARTED_AT="$STARTED_AT_FOR_BACKGROUND" \
      "$AGENTBREW_BIN" memory sync-projects --quiet --json >/dev/null 2>&1
    SYNC_STATUS=$?
    set -e
  elif [ -n "${AGENTBREW_REPO_ROOT:-}" ] && [ -x "${AGENTBREW_REPO_ROOT}/dist/cli.js" ]; then
    set +e
    AGENTBREW_MEMORY_SYNC_RECEIPT_PATH="$RECEIPT_FOR_BACKGROUND" \
      AGENTBREW_MEMORY_SYNC_SCHEDULED_AT="$SCHEDULED_AT_FOR_BACKGROUND" \
      AGENTBREW_MEMORY_SYNC_STARTED_AT="$STARTED_AT_FOR_BACKGROUND" \
      node "${AGENTBREW_REPO_ROOT}/dist/cli.js" memory sync-projects --quiet --json >/dev/null 2>&1
    SYNC_STATUS=$?
    set -e
  fi

  COMPLETED_AT_FOR_BACKGROUND="$(utc_timestamp)"
  COMPLETED_EPOCH_FOR_BACKGROUND="$(date +%s)"
  ELAPSED_MS_FOR_BACKGROUND=$(( (COMPLETED_EPOCH_FOR_BACKGROUND - STARTED_EPOCH_FOR_BACKGROUND) * 1000 ))
  OUTCOME="$(receipt_outcome "$RECEIPT_FOR_BACKGROUND" 2>/dev/null || true)"
  if [ "$SYNC_STATUS" -eq 0 ]; then
    case "$OUTCOME" in
    ok | none)
      write_last_success "$LAST_SUCCESS_FOR_BACKGROUND" "$COMPLETED_EPOCH_FOR_BACKGROUND" || true
      ;;
    degraded | error)
      # The best-effort CLI deliberately exits zero when the daemon is
      # unavailable. Keep its receipt and leave the debounce unset for retry.
      ;;
    *)
      write_receipt \
        "$RECEIPT_FOR_BACKGROUND" \
        "$SCHEDULED_AT_FOR_BACKGROUND" \
        "$STARTED_AT_FOR_BACKGROUND" \
        "$COMPLETED_AT_FOR_BACKGROUND" \
        "$ELAPSED_MS_FOR_BACKGROUND" \
        "error" \
        0 0 0 0 || true
      ;;
    esac
    return 0
  fi

  case "$OUTCOME" in
  degraded | error)
    # Preserve the CLI's bounded per-run counts and make the next SessionEnd
    # retry rather than treating the last success as a fresh schedule.
    ;;
  *)
    write_receipt \
      "$RECEIPT_FOR_BACKGROUND" \
      "$SCHEDULED_AT_FOR_BACKGROUND" \
      "$STARTED_AT_FOR_BACKGROUND" \
      "$COMPLETED_AT_FOR_BACKGROUND" \
      "$ELAPSED_MS_FOR_BACKGROUND" \
      "error" \
      0 0 0 0 || true
    ;;
  esac
}

if [ "${1:-}" = "--run-background" ]; then
  run_background_sync \
    "${2:?missing lock directory}" \
    "${3:?missing receipt path}" \
    "${4:?missing last-success path}" \
    "${5:?missing scheduled timestamp}"
  exit 0
fi

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
# shellcheck disable=SC1091
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
# shellcheck disable=SC1091
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="memory-sync-projects-session-end"
readonly DEBOUNCE_SECONDS=180
readonly LOCK_STALE_SECONDS=900
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/agentbrew"
LOCK_DIR="$CACHE_DIR/memory-sync-projects.lock"
LAST_SUCCESS_FILE="$CACHE_DIR/memory-sync-projects.last-success"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/agentbrew"
RECEIPT_FILE="$STATE_DIR/memory-sync-projects-scheduler.json"

if [ "${HOOK_BYPASS_MEMORY_SYNC_PROJECTS:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_MEMORY_SYNC_PROJECTS=1"
fi

INPUT="$(read_hook_stdin || true)"
HOOK_EVENT_NAME="$(json_get "${INPUT:-{}}" '.hook_event_name')"
if [ -n "$HOOK_EVENT_NAME" ] && [ "$HOOK_EVENT_NAME" != "SessionEnd" ]; then
  verdict_bypass "$HOOK_ID" "event $HOOK_EVENT_NAME is not SessionEnd"
fi

if ! command -v "$AGENTBREW_BIN" >/dev/null 2>&1 \
  && { [ -z "${AGENTBREW_REPO_ROOT:-}" ] || [ ! -x "${AGENTBREW_REPO_ROOT}/dist/cli.js" ]; }; then
  verdict_bypass "$HOOK_ID" "agentbrew CLI not available"
fi

if ! mkdir -p "$CACHE_DIR" "$STATE_DIR"; then
  verdict_bypass "$HOOK_ID" "cannot create agentbrew sync state directories"
fi

NOW="$(date +%s)"
LAST_SUCCESS="$(cat "$LAST_SUCCESS_FILE" 2>/dev/null || true)"
LAST_OUTCOME="$(receipt_outcome "$RECEIPT_FILE" 2>/dev/null || true)"
case "$LAST_OUTCOME" in
error | degraded | scheduled)
  # A daily run or an interrupted child can fail independently of the last
  # SessionEnd success. Let the next event recover it immediately.
  ;;
*)
  if [[ "$LAST_SUCCESS" =~ ^[0-9]+$ ]] && [ "$LAST_SUCCESS" -le "$NOW" ] && [ $((NOW - LAST_SUCCESS)) -lt "$DEBOUNCE_SECONDS" ]; then
    verdict_bypass "$HOOK_ID" "sync debounced"
  fi
  ;;
esac

lock_mtime() {
  stat -f %m "$LOCK_DIR" 2>/dev/null || stat -c %Y "$LOCK_DIR" 2>/dev/null || true
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  LOCK_MTIME="$(lock_mtime)"
  if [[ "$LOCK_MTIME" =~ ^[0-9]+$ ]] && [ "$LOCK_MTIME" -le "$NOW" ] && [ $((NOW - LOCK_MTIME)) -ge "$LOCK_STALE_SECONDS" ]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    verdict_bypass "$HOOK_ID" "sync already running"
  fi
fi

SCHEDULED_AT="$(utc_timestamp)"
if ! write_receipt "$RECEIPT_FILE" "$SCHEDULED_AT" "" "" 0 "scheduled" 0 0 0 0; then
  rmdir "$LOCK_DIR" 2>/dev/null || true
  verdict_bypass "$HOOK_ID" "cannot record sync schedule receipt"
fi

if ! command -v nohup >/dev/null 2>&1; then
  write_receipt "$RECEIPT_FILE" "$SCHEDULED_AT" "" "$(utc_timestamp)" 0 "error" 0 0 0 0 || true
  rmdir "$LOCK_DIR" 2>/dev/null || true
  verdict_bypass "$HOOK_ID" "nohup is not available"
fi

set +e
nohup bash "$0" --run-background "$LOCK_DIR" "$RECEIPT_FILE" "$LAST_SUCCESS_FILE" "$SCHEDULED_AT" >/dev/null 2>&1 &
SCHEDULE_STATUS=$?
set -e
if [ "$SCHEDULE_STATUS" -ne 0 ]; then
  write_receipt "$RECEIPT_FILE" "$SCHEDULED_AT" "" "$(utc_timestamp)" 0 "error" 0 0 0 0 || true
  rmdir "$LOCK_DIR" 2>/dev/null || true
  verdict_bypass "$HOOK_ID" "could not schedule background sync"
fi

disown >/dev/null 2>&1 || true

verdict_allow "$HOOK_ID" "scheduled background project-memory sync"
