#!/bin/bash
# Runs mocked Cat B verifier corpora (>=10 ALLOW + >=10 BLOCK per hook).

set -uo pipefail

VERIFIERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORPORA_DIR="$VERIFIERS_DIR/corpora"
source "$VERIFIERS_DIR/_cat-b-fixture-lib.sh"
source "$VERIFIERS_DIR/_cat-b-corpus-lib.sh"

cat_b_warn_pattern() {
  case "$1" in
    stability-task-priority) printf '%s' "below P0" ;;
    pr-body-explains-why) printf '%s' "may not explain WHY" ;;
    pr-body-diff-consistency) printf '%s' "stale" ;;
    codify-repeated-work) printf '%s' "repeated work" ;;
    ask-action-not-treasure-map) printf '%s' "treasure map" ;;
    rule-skill-location) printf '%s' "routing matrix" ;;
    browser-errors-before-done) printf '%s' "browser console" ;;
    fix-errors-never-silence) printf '%s' "silence or suppress" ;;
    comment-proportionality-verifier) printf '%s' "disproportionate" ;;
    *) printf '%s' "." ;;
  esac
}

HOOK_IDS="
stability-task-priority
pr-body-explains-why
pr-body-diff-consistency
codify-repeated-work
ask-action-not-treasure-map
rule-skill-location
browser-errors-before-done
fix-errors-never-silence
comment-proportionality-verifier
"

while IFS= read -r hook_id; do
  [ -n "$hook_id" ] || continue
  script="$VERIFIERS_DIR/${hook_id}.sh"
  corpus="$CORPORA_DIR/${hook_id}.json"
  if [ "$hook_id" = "comment-proportionality-verifier" ]; then
    script="$VERIFIERS_DIR/comment-proportionality.sh"
  fi
  cat_b_fixture_setup "$script" "HOOK_BYPASS_$(printf '%s' "$hook_id" | tr 'a-z-' 'A-Z_')"
  cat_b_run_mock_corpus_file "$script" "$corpus" "$(cat_b_warn_pattern "$hook_id")"
done <<<"$HOOK_IDS"

echo ""
echo "cat-b-corpus-mock.test.sh: all 9 corpora passed"
