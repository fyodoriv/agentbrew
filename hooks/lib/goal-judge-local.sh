#!/bin/bash
# agentbrew/hooks/lib/goal-judge-local.sh
#
# Runs one goal judge on a local Ollama model, so a goal panel can include a
# judge from a vendor other than Anthropic. goal-judges-before-stop counts a
# verdict from this script only when the Bash call is exactly
# `bash <hook lib dir>/goal-judge-local.sh <contract> <judge id> <model>`, run
# in the foreground, and the printed Prompt-SHA matches the prompt the hook
# rebuilds for the current state.
#
# Usage: bash goal-judge-local.sh <contract path> <judge id> <model> [judge dir]
#        bash goal-judge-local.sh --prompt-sha <contract path> <judge id> [judge dir]
#        bash goal-judge-local.sh --prompt <contract path> <judge id> [judge dir]
#
# The prompt is the goal-judge-prompt.sh prompt with an evidence section added
# before its verdict block: a local model cannot run tools, so the script
# gives it each judged git work tree's diff against its merge base with
# origin/HEAD (origin/main, then main), non-test files first, cut at a fixed
# size. The judge is told it cannot run commands and must mark unchecked
# claims as unverified.
#
# Output: a GOAL-JUDGE-LOCAL header (Judge-Id, Rubric-SHA, Contract-SHA,
# State, Prompt-SHA, Model) and then the model's answer, which ends with the
# GOAL-JUDGE-VERDICT block. The model's thinking is not printed.
#
# The Ollama address is fixed (127.0.0.1:11434) so a caller cannot point the
# script at a server that fakes answers. Exit 2 when the prompt cannot be
# built, Ollama is not reachable, or the model returns no answer.

set -uo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly OLLAMA_URL="http://127.0.0.1:11434/api/chat"
readonly EVIDENCE_BYTES=90000
readonly NUM_CTX=40960

sha16() { if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi | cut -c1-16; }

evidence() { # contract -> evidence text
  local contract="$1" p base files f untracked
  sed -nE 's/^[-*_ ]*Judged paths:[*_ ]*(.*)$/\1/p' "$contract" | head -1 | tr ',' '\n' |
    sed -E 's/^[[:space:]`]+//; s/[[:space:]`]+$//' | sed '/^$/d' | while IFS= read -r p; do
    p="${p/#\~/$HOME}"
    printf '### %s\n\n' "$p"
    if [ -d "$p" ] && git -C "$p" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      base=""
      for ref in origin/HEAD origin/main main; do
        base="$(git -C "$p" merge-base HEAD "$ref" 2>/dev/null)" && [ -n "$base" ] && break
      done
      [ -n "$base" ] || base="$(git -C "$p" rev-parse HEAD 2>/dev/null)"
      printf 'Diff against merge base %s (committed and uncommitted changes):\n\n' "$base"
      git -C "$p" diff --stat=200 "$base" -- . 2>/dev/null
      git -C "$p" ls-files -o --exclude-standard -- . 2>/dev/null | sed 's/^/untracked: /'
      printf '\n'
      # Changed and untracked files, non-test files first; an untracked file
      # shows as a diff from /dev/null so its whole content is evidence.
      untracked="$(git -C "$p" ls-files -o --exclude-standard -- . 2>/dev/null)"
      files="$({ git -C "$p" diff --name-only --relative "$base" -- . 2>/dev/null
        printf '%s\n' "$untracked"; } | LC_ALL=C sort -u)"
      { printf '%s\n' "$files" | grep -vE '(\.test\.|/tests?/|_test\.|\.spec\.)'
        printf '%s\n' "$files" | grep -E '(\.test\.|/tests?/|_test\.|\.spec\.)'; } | sed '/^$/d' |
        while IFS= read -r f; do
          if printf '%s\n' "$untracked" | grep -qxF -- "$f"; then
            (cd "$p" && git diff --no-index -- /dev/null "$f" 2>/dev/null)
          else
            git -C "$p" diff "$base" -- "$f" 2>/dev/null
          fi
        done
    else
      find "$p" -type f -not -path '*/.git/*' 2>/dev/null | LC_ALL=C sort | while IFS= read -r f; do
        printf -- '--- %s\n' "$f"; cat "$f" 2>/dev/null; printf '\n'
      done
    fi
  done | head -c "$EVIDENCE_BYTES"
  printf '\n(Evidence ends here. It is cut at %s bytes.)\n' "$EVIDENCE_BYTES"
}

build() { # contract, judge, [judge dir] -> full local prompt
  local base
  base="$(bash "$LIB/goal-judge-prompt.sh" "$1" "$2" ${3:+"$3"})" || return 2
  # ENVIRON, not -v: awk -v would turn backslashes in the diff into escapes.
  printf '%s\n' "$base" | GOAL_JUDGE_EVIDENCE="$(evidence "$1")" awk '
    /^End your answer with this block/ && !done {
      print "You run on a local model with no tools: you cannot run commands, open files, or reproduce defects. Judge from the evidence below, which goal-judge-local.sh generated from the judged paths (the runner did not write it). Mark every claim you cannot check from it as unverified, and say which rubric lines that limits."
      print ""; print "Evidence:"; print ""; print ENVIRON["GOAL_JUDGE_EVIDENCE"]; print ""; done = 1 }
    { print }'
}

case "${1:-}" in
  --prompt-sha) shift; build "${1:-}" "${2:-}" ${3:+"$3"} | sha16; exit "${PIPESTATUS[0]}" ;;
  --prompt) shift; build "${1:-}" "${2:-}" ${3:+"$3"}; exit $? ;;
esac

CONTRACT="${1:-}"
ID="${2:-}"
MODEL="${3:-}"
case "$MODEL" in "" | *[!A-Za-z0-9._:/-]*) echo "goal-judge-local: give an Ollama model name, for example qwen3:14b" >&2; exit 2 ;; esac
TMP="$(mktemp -d "${TMPDIR:-/tmp}/goal-judge-local.XXXXXX")" || exit 2
trap 'rm -rf "$TMP"' EXIT
build "$CONTRACT" "$ID" ${4:+"$4"} >"$TMP/prompt.txt" || exit 2
head16() { sed -nE "s/^$1:[[:space:]]*(.*)$/\\1/p" "$TMP/prompt.txt" | head -1; }

jq -n --arg m "$MODEL" --rawfile p "$TMP/prompt.txt" --argjson ctx "$NUM_CTX" \
  '{model: $m, stream: false, think: true, options: {temperature: 0, num_ctx: $ctx},
    messages: [{role: "user", content: $p}]}' >"$TMP/req.json" || exit 2
curl -sS --max-time 560 -H 'Content-Type: application/json' --data-binary "@$TMP/req.json" \
  "$OLLAMA_URL" >"$TMP/resp.json" 2>"$TMP/err.txt" ||
  { echo "goal-judge-local: Ollama at $OLLAMA_URL did not answer: $(head -c 300 "$TMP/err.txt")" >&2; exit 2; }
ANSWER="$(jq -r '.message.content // empty' "$TMP/resp.json" 2>/dev/null)"
[ -n "$ANSWER" ] ||
  { echo "goal-judge-local: no answer from $MODEL: $(head -c 300 "$TMP/resp.json")" >&2; exit 2; }

printf 'GOAL-JUDGE-LOCAL v1\nJudge-Id: %s\nRubric-SHA: %s\nContract-SHA: %s\nState: %s\nPrompt-SHA: %s\nModel: %s\n\n%s\n' \
  "$(head16 Judge-Id)" "$(head16 Rubric-SHA)" "$(head16 Contract-SHA)" "$(head16 State)" \
  "$(sha16 <"$TMP/prompt.txt")" "$MODEL" "$ANSWER"
