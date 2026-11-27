#!/bin/bash
set -euo pipefail

repo=fyodoriv/agentbrew
runs="$(gh run list --repo "$repo" --workflow CI --limit 50 \
  --created ">=${SINCE:-2026-11-25}" --json databaseId --jq '.[].databaseId')"
missing=0

while IFS= read -r run; do
  [ -n "$run" ] || continue
  base="repos/$repo/actions/runs/$run"
  attempts="$(gh api "$base/jobs?filter=all&per_page=100" --paginate --jq '
    .jobs[]
    | select(.name == "verify (macos-latest)" and .started_at and .completed_at)
    | select(((.completed_at | fromdate) - (.started_at | fromdate)) > 2400)
    | .run_attempt')"
  [ -n "$attempts" ] || continue

  artifacts="$(gh api "$base/artifacts?per_page=100" --paginate --jq '
    .artifacts[] | select(.expired == false) | .name')"
  while IFS= read -r attempt; do
    if ! grep -Fxq "gate-log-macos-latest-attempt-$attempt" <<< "$artifacts"; then
      missing=$((missing + 1))
      break
    fi
  done <<< "$attempts"
done <<< "$runs"

printf '%s\n' "$missing"
