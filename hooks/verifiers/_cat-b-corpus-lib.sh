#!/bin/bash
# Shared corpus runner for Cat B verifier fixture + integration tests.

cat_b_corpus_mock_response() {
  local expected="$1"
  case "$expected" in
    ALLOW) printf '%s' "ALLOW corpus case" ;;
    BLOCK) printf '%s' "BLOCK corpus case" ;;
    *) printf '%s' "ALLOW unknown expected verdict" ;;
  esac
}

cat_b_corpus_expect_warn() {
  local expected="$1"
  [ "$expected" = "BLOCK" ]
}

cat_b_materialize_corpus_input() {
  local case_json="$1"
  local transcript_lines
  transcript_lines="$(jq -r '.transcriptLines[]? // empty' <<<"$case_json")"
  if [ -z "$transcript_lines" ]; then
    jq -c '.input' <<<"$case_json"
    return 0
  fi

  local transcript_file="$TMPDIR/transcript-$(jq -r '.label' <<<"$case_json").jsonl"
  : >"$transcript_file"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    printf '%s\n' "$line" >>"$transcript_file"
  done <<<"$transcript_lines"

  jq -c --arg path "$transcript_file" '.input + {transcript_path: $path}' <<<"$case_json"
}

cat_b_run_mock_corpus_case() {
  local script="$1"
  local label="$2"
  local expected="$3"
  local case_json="$4"
  local warn_pattern="${5:-.}"
  local input
  input="$(cat_b_materialize_corpus_input "$case_json")"

  cat_b_run_hook "corpus_${label}" "$input" MOCK_CLAUDE_RESPONSE="$(cat_b_corpus_mock_response "$expected")"
  cat_b_assert_exit_code "corpus $label exit" 0 "$(cat "$TMPDIR/corpus_${label}.code")"
  if cat_b_corpus_expect_warn "$expected"; then
    cat_b_assert_stderr_contains "corpus $label warn" "$warn_pattern" "$TMPDIR/corpus_${label}.err"
  else
    cat_b_assert_stderr_empty "corpus $label silent" "$TMPDIR/corpus_${label}.err"
  fi
}

cat_b_run_mock_corpus_file() {
  local script="$1"
  local corpus_file="$2"
  local warn_pattern="${3:-.}"

  if [ ! -f "$corpus_file" ]; then
    echo "Missing corpus file: $corpus_file" >&2
    exit 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required for Cat B corpus tests" >&2
    exit 1
  fi

  local allow_count=0
  local block_count=0
  while IFS= read -r case_json; do
    [ -n "$case_json" ] || continue
    local label expected
    label="$(jq -r '.label' <<<"$case_json")"
    expected="$(jq -r '.expectedVerdict' <<<"$case_json")"
    case "$expected" in
      ALLOW) allow_count=$((allow_count + 1)) ;;
      BLOCK) block_count=$((block_count + 1)) ;;
      *)
        echo "Invalid expectedVerdict in $corpus_file case $label" >&2
        exit 1
        ;;
    esac
    cat_b_run_mock_corpus_case "$script" "$label" "$expected" "$case_json" "$warn_pattern"
  done < <(jq -c '.[]' "$corpus_file")

  if [ "$allow_count" -lt 10 ] || [ "$block_count" -lt 10 ]; then
    echo "Corpus $corpus_file must have >=10 ALLOW and >=10 BLOCK cases (got $allow_count ALLOW, $block_count BLOCK)" >&2
    exit 1
  fi
}

cat_b_run_live_corpus_file() {
  local script="$1"
  local corpus_file="$2"
  local min_accuracy="${3:-95}"

  if [ "${AGENTBREW_RUN_LLM_TESTS:-0}" != "1" ]; then
    echo "$(basename "$script"): skipped live corpus (set AGENTBREW_RUN_LLM_TESTS=1)"
    return 0
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required for live Cat B corpus tests" >&2
    return 1
  fi
  if ! command -v claude >/dev/null 2>&1; then
    echo "$(basename "$script"): skipped live corpus (claude CLI unavailable)"
    return 0
  fi

  local total=0
  local matches=0
  while IFS= read -r case_json; do
    [ -n "$case_json" ] || continue
    total=$((total + 1))
    local label expected input err_file
    label="$(jq -r '.label' <<<"$case_json")"
    expected="$(jq -r '.expectedVerdict' <<<"$case_json")"
    input="$(cat_b_materialize_corpus_input "$case_json")"
    err_file="$TMPDIR/live_${label}.err"
    HOME="$TMPDIR/home" HOOK_VERIFIER_TIMEOUT="${HOOK_VERIFIER_TIMEOUT:-10}" bash "$script" >"$TMPDIR/live_${label}.out" 2>"$err_file" <<<"$input"
    local got_warn=0
    if [ -s "$err_file" ]; then
      got_warn=1
    fi
    local expect_warn=0
    if cat_b_corpus_expect_warn "$expected"; then
      expect_warn=1
    fi
    if [ "$got_warn" -eq "$expect_warn" ]; then
      matches=$((matches + 1))
    else
      echo "  live corpus mismatch: $label expected ${expected}, got_warn=$got_warn" >&2
    fi
  done < <(jq -c '.[]' "$corpus_file")

  if [ "$total" -eq 0 ]; then
    echo "Empty corpus: $corpus_file" >&2
    return 1
  fi

  local accuracy=$((matches * 100 / total))
  echo "$(basename "$script"): live corpus accuracy ${accuracy}% (${matches}/${total})"
  if [ "$accuracy" -lt "$min_accuracy" ]; then
    echo "Live corpus accuracy below ${min_accuracy}% threshold" >&2
    return 1
  fi
}
