#!/usr/bin/env bash
# The repo-wide checkup (`npm run checkup`): open PRs and branches, health, the
# cached gate, metrics, the gate speed review, open P0 tasks, and the monthly
# requirements audit,
# then at most three questions for the owner.
#
# Run it monthly (RECURRING.md `monthly-checkup`) or after a burst of work.
# It writes only .metrics/ (gate timings and cache). Exit 1 when the doctor or
# the gate fails. Runs under macOS /bin/bash 3.2.
# <!-- scope: human-approved task meet-new-project-requirements (TASKS.md); this file closes step 6 -->
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1
skill="${NEW_PROJECT_SKILL:-$HOME/.claude/skills/new-project}"
timings="${AGENTBREW_METRICS_DIR:-.metrics}/gate-timings.jsonl"
questions=""
status=0

section() { printf '\n## %s\n\n' "$1"; }
ask() { questions="$questions
$1"; }

section "0. Open work (your PRs, unmerged branches, uncommitted files)"
if ! bash skill-plugins/workflow/wrap-up/scripts/open-work.sh .; then
  ask "Open work is listed above. Finish it first (wrap-up skill, \"Continue open work\": conflicts, red checks, reviews, then merge)?"
fi

section "1. Health (agentbrew status --ci, the doctor)"
if ! npx tsx src/cli.ts status --ci; then
  status=1
  ask "The doctor reports drift (each line above names its fix). Run the fixes now, or file a P0?"
fi

section "2. Gate (npm run verify, cached)"
if [ "${CHECKUP_SKIP_GATE:-0}" = 1 ]; then
  echo "(skipped: CHECKUP_SKIP_GATE=1)"
else
  gate_log="$(mktemp "${TMPDIR:-/tmp}/agentbrew-checkup.XXXXXX")"
  bash scripts/verify.sh >"$gate_log" 2>&1
  gate_rc=$?
  grep -E '^--- |^verify: ' "$gate_log"
  if [ "$gate_rc" != 0 ]; then
    status=1
    ask "The gate failed (log: $gate_log). Fix it before new work?"
  else
    rm -f "$gate_log"
  fi
fi

section "3. Metrics (scripts/metrics.sh; goals and pivots in docs/metrics.md)"
bash scripts/metrics.sh

section "4. Speed review (uncached gate steps, last 30 days)"
if [ -f "$timings" ]; then
  node -e '
const lines = require("fs").readFileSync(process.argv[1], "utf-8").split("\n").filter(Boolean);
const since = Date.now() - 30 * 86400e3;
const steps = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((e) => e && e.event === "step" && !e.cached && Date.parse(e.ts) >= since);
const by = {};
for (const e of steps) (by[e.step] ||= []).push(e.ms);
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const rows = Object.entries(by).map(([step, xs]) => [step, median(xs), xs.length]).sort((a, b) => b[1] - a[1]);
if (!rows.length) { console.log("(stub) no uncached gate steps in the last 30 days"); process.exit(0); }
console.log("step                   median_ms  runs");
for (const [step, ms, n] of rows) console.log(step.padEnd(22) + String(ms).padStart(10) + String(n).padStart(6));
console.log("\nSlowest step: " + rows[0][0] + ". Goal and pivot: docs/metrics.md (gate_ms). Log what you change in docs/learnings.md.");
' "$timings"
else
  echo "(stub) no $timings yet; run npm run verify"
fi

section "5. Open P0 tasks (TASKS.md)"
p0="$(awk '/^## P0/{f=1; next} /^## /{f=0} f && /^- \[ \]/' TASKS.md)"
if [ -n "$p0" ]; then
  echo "$p0"
  ask "There are $(printf '%s\n' "$p0" | grep -c .) open P0 task(s). Are they still the top priority?"
else
  echo "none"
fi

section "6. Monthly requirements audit (new-project skill)"
if [ -x "$skill/scripts/audit-due.sh" ] || [ -f "$skill/scripts/audit-due.sh" ]; then
  if due="$(bash "$skill/scripts/audit-due.sh" .)"; then
    echo "$due"
    bash "$skill/scripts/check-setup.sh" . --profile tool | grep -vE '^PASS '
    echo "Next: re-read every map and waiver in .agents/requirements.yaml, then: bash $skill/scripts/audit-due.sh . --record"
  else
    echo "$due"
  fi
else
  echo "(skipped) the new-project skill is not installed at $skill (set NEW_PROJECT_SKILL)"
fi

section "Questions for the owner"
if [ -n "$questions" ]; then
  printf '%s\n' "$questions" | sed '/^$/d' | head -3 | nl -w1 -s'. '
else
  echo "none"
fi

exit "$status"
