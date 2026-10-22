#!/bin/bash
# Prints shown, adopted, and adoption rate per usage tip from the usage-tip hook log.
# A tip with many shows and a low rate is a candidate to rewrite or delete
# (hooks/lib/usage-tips.tsv). Tips with adopt regex "-" always show 0%.
# Usage: bash scripts/usage-tips-report.sh [log.jsonl]
set -euo pipefail
LOG="${1:-${USAGE_TIPS_DIR:-$HOME/.cache/agentbrew/usage-tips}/log.jsonl}"
[ -f "$LOG" ] || { echo "no usage-tip log at $LOG"; exit 0; }
jq -rs '
  group_by(.tip) | map({tip: .[0].tip,
    shown: map(select(.event=="shown")) | length,
    adopted: map(select(.event=="adopted")) | length})
  | sort_by(-.shown) | .[]
  | [.tip, .shown, .adopted, (if .shown>0 then (100*.adopted/.shown|floor|tostring)+"%" else "-" end)] | @tsv
' "$LOG" | { printf 'tip\tshown\tadopted\trate\n'; cat; }
