#!/usr/bin/env bash
# Report the repo's own speed from .metrics/*.jsonl (written by scripts/check.sh
# and scripts/e2e.sh). Use it in the weekly review (RECURRING.md) to find the
# slowest step and make it faster.
set -euo pipefail
cd "$(dirname "$0")/.."

shopt -s nullglob
files=(.metrics/*.jsonl)
if [ ${#files[@]} -eq 0 ]; then echo "metrics: no data yet; run scripts/check.sh"; exit 0; fi

# Each line: {"ts":"...","event":"step","name":"test","seconds":12,"ok":true}
printf '%-14s %6s %8s %8s %6s\n' step runs avg_s max_s fails
cat "${files[@]}" | awk -F'"' '
  { name=""; secs=""; okv="";
    for (i = 1; i < NF; i++) {
      if ($i == "name") name = $(i + 2);
      if ($i == "seconds") { s = $(i + 1); gsub(/[^0-9.]/, "", s); secs = s }
      if ($i == "ok") { o = $(i + 1); okv = (o ~ /true/) }
    }
    if (name == "") next;
    n[name]++; sum[name] += secs; if (secs > max[name]) max[name] = secs; if (!okv) bad[name]++
  }
  END {
    for (k in n) printf "%-14s %6d %8.1f %8.1f %6d\n", k, n[k], sum[k] / n[k], max[k], bad[k];
  }' | sort -k3 -nr
