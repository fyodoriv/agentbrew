#!/bin/bash
# agentbrew/hooks/lib/ci-watch-fail-fast.sh
#
# Watch a CI run or a PR's checks and report the FIRST failed job at once.
# It never cancels the run, so the other jobs keep going.
#
# The loop it supports:
#   1. Default mode: exit 1 on the first failed job, with its failed log lines.
#   2. Fix that failure locally (do not push yet).
#   3. `--rest` mode on the same target: wait for the remaining jobs, then
#      print every failure in one list. Fold them into the same fix, then push.
#
# Usage:
#   ci-watch-fail-fast.sh [--repo OWNER/REPO] [--interval S] [--timeout S] [--rest] <run-id|pr-number|pr-url>
#   A number with 6 or more digits is a run ID; a shorter number or a PR URL is a PR.
#
# Exit codes: 0 every check passed; 1 a check failed; 124 timeout; 3 gh error.
# On success in run mode it prints "Run <workflow> (<id>) completed with 'success'",
# the same line `gh run watch --exit-status` prints, so verify-before-completion
# accepts it as hosted proof.
#
# Runs under macOS /bin/bash 3.2. Test: bash ci-watch-fail-fast.test.sh

set -uo pipefail

REPO=""
INTERVAL="${CI_WATCH_INTERVAL:-20}"
TIMEOUT=2700
REST=0
TARGET=""
LOG_LINES=40

usage() { sed -n '13,15p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 3; }

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="${2:-}"; shift 2 ;;
    --repo=*) REPO="${1#--repo=}"; shift ;;
    --interval) INTERVAL="${2:-}"; shift 2 ;;
    --interval=*) INTERVAL="${1#--interval=}"; shift ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;;
    --timeout=*) TIMEOUT="${1#--timeout=}"; shift ;;
    --rest) REST=1; shift ;;
    -h|--help) usage ;;
    -*) echo "ci-watch-fail-fast: unknown flag $1" >&2; usage ;;
    *) TARGET="$1"; shift ;;
  esac
done
[ -n "$TARGET" ] || usage
case "$INTERVAL$TIMEOUT" in *[!0-9]*) echo "ci-watch-fail-fast: --interval and --timeout take whole seconds" >&2; exit 3 ;; esac

MODE="pr"
if [[ "$TARGET" =~ ^[0-9]{6,}$ ]]; then MODE=run
elif [[ "$TARGET" =~ /pull/([0-9]+) ]]; then TARGET="${BASH_REMATCH[1]}"
elif ! [[ "$TARGET" =~ ^[0-9]+$ ]]; then echo "ci-watch-fail-fast: target must be a run ID, PR number or PR URL" >&2; exit 3
fi

if [ -z "$REPO" ]; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)" || true
  [ -n "$REPO" ] || { echo "ci-watch-fail-fast: pass --repo OWNER/REPO" >&2; exit 3; }
fi

# One snapshot as TSV lines: name <TAB> state <TAB> job-id <TAB> link.
# state is pass | fail | pending | skip.
snapshot() {
  if [ "$MODE" = run ]; then
    gh run view "$TARGET" --repo "$REPO" --json jobs -q '.jobs[] |
      [.name,
       (if .status != "completed" then "pending"
        elif (.conclusion == "success") then "pass"
        elif (.conclusion == "skipped" or .conclusion == "neutral") then "skip"
        else "fail" end),
       (.databaseId|tostring), .url] | @tsv'
  else
    gh pr checks "$TARGET" --repo "$REPO" --json name,bucket,link -q '.[] |
      [.name,
       (if .bucket == "pass" then "pass" elif .bucket == "pending" then "pending"
        elif .bucket == "skipping" then "skip" else "fail" end),
       ((.link // "") | capture("/job/(?<id>[0-9]+)").id // ""), (.link // "")] | @tsv'
  fi
}

# Print the failed log lines of one job, trimmed to the errors.
print_failure() {
  local name="$1" job="$2" link="$3" log hits
  echo "FAILED: $name"
  [ -n "$link" ] && echo "  $link"
  if [ -z "$job" ]; then echo "  (no job log: open the link)"; return; fi
  # The jobs log endpoint works while the rest of the run goes on.
  log="$(gh api --allow-escape-sequences "repos/$REPO/actions/jobs/$job/logs" 2>/dev/null | tr -d '\033\r' |
    sed -E 's/\[[0-9;]*m//g; s/^[^0-9]*[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z //')" || log=""
  if [ -z "$log" ]; then echo "  (log not ready: gh run view --job $job --repo $REPO --log-failed)"; return; fi
  # Strict error lines first; broader words only when none match. Drop repeats.
  hits="$(grep -E '##\[error\]|^ *FAIL |AssertionError|Traceback|^not ok|^ *× ' <<<"$log" | awk '!seen[$0]++' | head -n "$LOG_LINES")"
  [ -n "$hits" ] || hits="$(grep -E 'Error:|FAIL|✗|[Ee]xpected|exit code [1-9]' <<<"$log" | awk '!seen[$0]++' | head -n "$LOG_LINES")"
  [ -n "$hits" ] || hits="$(tail -n 30 <<<"$log")"
  while IFS= read -r l; do echo "  $l"; done <<<"$hits"
}

# Receipt: the target this watcher actually resolved.
if [ "$MODE" = run ]; then
  RECEIPT="run=$TARGET $(gh run view "$TARGET" --repo "$REPO" --json workflowName,headSha,attempt -q '"workflow=\(.workflowName) head=\(.headSha) attempt=\(.attempt)"' 2>/dev/null)"
else
  RECEIPT="pr=$TARGET head=$(gh pr view "$TARGET" --repo "$REPO" --json headRefOid -q .headRefOid 2>/dev/null)"
fi
echo "ci-watch-fail-fast: repo=$REPO $RECEIPT mode=$([ "$REST" = 1 ] && echo rest || echo first-failure)"

START=$SECONDS
ERRORS=0
LAST_ALL_PASS=""
while :; do
  if ! SNAP="$(snapshot 2>&1)"; then
    ERRORS=$((ERRORS + 1))
    if [ "$ERRORS" -ge 3 ]; then echo "ci-watch-fail-fast: gh failed 3 times in a row: $SNAP" >&2; exit 3; fi
  else
    ERRORS=0
    total=0; pending=0; failed=""
    while IFS=$'\t' read -r name state job link; do
      [ -n "$name" ] || continue
      total=$((total + 1))
      case "$state" in
        pending) pending=$((pending + 1)) ;;
        fail) failed="$failed$name"$'\t'"$job"$'\t'"$link"$'\n' ;;
      esac
    done <<<"$SNAP"

    if [ -n "$failed" ] && [ "$REST" = 0 ]; then
      IFS=$'\t' read -r name job link <<<"$(head -n 1 <<<"$failed")"
      print_failure "$name" "$job" "$link"
      n=$(grep -c . <<<"$failed")
      [ "$n" -gt 1 ] && echo "($((n - 1)) more failed already; --rest lists them.)"
      echo "The run keeps going ($pending job(s) still running). Fix this failure, then run the same command with --rest to collect the other failures before you push."
      exit 1
    fi

    if [ "$total" -gt 0 ] && [ "$pending" = 0 ]; then
      if [ -n "$failed" ]; then
        echo "All jobs finished. $(grep -c . <<<"$failed") failed:"
        while IFS=$'\t' read -r name job link; do
          [ -n "$name" ] && print_failure "$name" "$job" "$link"
        done <<<"$failed"
        echo "Fold every failure above into one fix, then push once."
        exit 1
      fi
      # A PR can list only fast checks right after a push: require two
      # all-pass reads with the same check count before calling it green.
      if [ "$MODE" = run ] || [ "$LAST_ALL_PASS" = "$total" ]; then
        if [ "$MODE" = run ]; then
          wf="$(gh run view "$TARGET" --repo "$REPO" --json workflowName -q .workflowName 2>/dev/null)"
          echo "Run ${wf:-CI} ($TARGET) completed with 'success'"
        else
          echo "All $total checks on PR $TARGET passed."
        fi
        exit 0
      fi
      LAST_ALL_PASS="$total"
    else
      LAST_ALL_PASS=""
    fi
  fi
  if [ $((SECONDS - START)) -ge "$TIMEOUT" ]; then
    echo "ci-watch-fail-fast: timed out after ${TIMEOUT}s; the run is still going. Re-read it, then start a new watch." >&2
    exit 124
  fi
  sleep "$INTERVAL"
done
