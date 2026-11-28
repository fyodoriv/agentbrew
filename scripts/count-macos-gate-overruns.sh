#!/bin/bash
set -euo pipefail

repo=fyodoriv/agentbrew
created="${CREATED:->=${SINCE:-2026-11-25}}"
runs="$(gh run list --repo "github.com/$repo" --workflow CI --limit 50 \
  --created "$created" --json databaseId --jq '.[].databaseId')"
missing=0

while IFS= read -r run; do
  [ -n "$run" ] || continue
  base="repos/$repo/actions/runs/$run"
  attempts="$(gh api "$base/jobs?filter=all&per_page=100" --hostname github.com --paginate --jq '
    .jobs[]
    | select(.name == "verify (macos-latest)" and .started_at and .completed_at)
    | select(((.completed_at | fromdate) - (.started_at | fromdate)) > 2400)
    | .run_attempt')"
  [ -n "$attempts" ] || continue

  artifacts="$(gh api "$base/artifacts?per_page=100" --hostname github.com --paginate --jq '
    .artifacts[].name')"
  while IFS= read -r attempt; do
    if ! grep -Fxq "gate-log-macos-latest-attempt-$attempt" <<< "$artifacts"; then
      missing=$((missing + 1))
      break
    fi
  done <<< "$attempts"
done <<< "$runs"

printf '%s\n' "$missing"
