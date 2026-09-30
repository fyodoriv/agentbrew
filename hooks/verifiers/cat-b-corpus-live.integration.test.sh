#!/bin/bash
# Live Haiku corpus accuracy gate for all Cat B verifiers (optional CI/dev run).

set -uo pipefail

if [ "${AGENTBREW_RUN_LLM_TESTS:-0}" != "1" ]; then
  echo "cat-b-corpus-live.integration.test.sh: skipped (set AGENTBREW_RUN_LLM_TESTS=1)"
  exit 0
fi

VERIFIERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORPORA_DIR="$VERIFIERS_DIR/corpora"
source "$VERIFIERS_DIR/_cat-b-fixture-lib.sh"
source "$VERIFIERS_DIR/_cat-b-corpus-lib.sh"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
mkdir -p "$TMPDIR/home"

HOOK_IDS=(
  stability-task-priority
  pr-body-explains-why
  pr-body-diff-consistency
  codify-repeated-work
  ask-action-not-treasure-map
  rule-skill-location
  browser-errors-before-done
  fix-errors-never-silence
  comment-proportionality-verifier
)

FAIL=0
for hook_id in "${HOOK_IDS[@]}"; do
  script="$VERIFIERS_DIR/${hook_id}.sh"
  corpus="$CORPORA_DIR/${hook_id}.json"
  if [ "$hook_id" = "comment-proportionality-verifier" ]; then
    script="$VERIFIERS_DIR/comment-proportionality.sh"
  fi
  if ! cat_b_run_live_corpus_file "$script" "$corpus" 95; then
    FAIL=$((FAIL + 1))
  fi
done

if [ "$FAIL" -gt 0 ]; then
  echo "cat-b-corpus-live.integration.test.sh: $FAIL hook corpora below accuracy threshold" >&2
  exit 1
fi

echo "cat-b-corpus-live.integration.test.sh: all corpora passed live accuracy gate"
