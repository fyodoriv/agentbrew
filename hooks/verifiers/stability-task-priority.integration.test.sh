#!/bin/bash
set -uo pipefail
if [ "${AGENTBREW_RUN_LLM_TESTS:-0}" != "1" ]; then
  echo "stability-task-priority.integration.test.sh: skipped (set AGENTBREW_RUN_LLM_TESTS=1)"
  exit 0
fi
SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/stability-task-priority.sh"
CORPUS="$(dirname "$SCRIPT")/corpora/stability-task-priority.json"
source "$(dirname "$SCRIPT")/_cat-b-fixture-lib.sh"
source "$(dirname "$SCRIPT")/_cat-b-corpus-lib.sh"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
mkdir -p "$TMPDIR/home"
cat_b_run_live_corpus_file "$SCRIPT" "$CORPUS" 95
