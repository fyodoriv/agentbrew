#!/bin/bash
# Measure how long a full-run CI wait hides the first failure.
#
# For each recent failed run, lag = (last job end) - (first failed job end).
# A `gh run watch` wait sees the failure only at the last job end.
# hooks/lib/ci-watch-fail-fast.sh sees it within one poll interval (20 s).
#
# Usage: bash scripts/ci-first-failure-lag.sh [--repo OWNER/REPO] [--workflow NAME] [--limit N]
# Prints one TSV row per run, then median and p90 lag in seconds.

set -euo pipefail
REPO="fyodoriv/agentbrew"
WORKFLOW="CI"
LIMIT=20
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --workflow) WORKFLOW="$2"; shift 2 ;;
    --limit) LIMIT="$2"; shift 2 ;;
    *) echo "usage: $0 [--repo OWNER/REPO] [--workflow NAME] [--limit N]" >&2; exit 2 ;;
  esac
done

lags=""
printf 'run\tfirst_failure\tlast_job_end\tlag_s\n'
for id in $(gh run list --repo "$REPO" --workflow "$WORKFLOW" --status failure --limit "$LIMIT" --json databaseId -q '.[].databaseId'); do
  # shellcheck disable=SC2016 # jq variables, not shell ones
  row="$(gh run view "$id" --repo "$REPO" --json jobs -q '
    [.jobs[] | select(.completedAt != null and (.completedAt | startswith("0001")) == false)] as $done
    | ([$done[] | select(.conclusion == "failure") | .completedAt] | min) as $first
    | ($done | map(.completedAt) | max) as $last
    | select($first != null)
    | [$first, $last, (($last | fromdateiso8601) - ($first | fromdateiso8601))] | @tsv')" || continue
  [ -n "$row" ] || continue
  printf '%s\t%s\n' "$id" "$row"
  lags="$lags$(cut -f3 <<<"$row")"$'\n'
done

sorted="$(grep . <<<"$lags" | sort -n)" || { echo "no failed runs with job times"; exit 0; }
n=$(grep -c . <<<"$sorted")
median=$(sed -n "$(( (n + 1) / 2 ))p" <<<"$sorted")
p90=$(sed -n "$(( (n * 9 + 9) / 10 ))p" <<<"$sorted")
echo "runs=$n median_lag_s=$median p90_lag_s=$p90 fail_fast_lag_s<=20"
