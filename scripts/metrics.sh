#!/usr/bin/env bash
# Print the agentbrew metrics table: value, goal, and pivot for each metric.
#
# Usage: bash scripts/metrics.sh
#
# A metric with no data prints "(stub)", never 0, so a missing log is never
# read as a real zero. Definitions, goals, pivots, and commands: docs/metrics.md.
# Sources: git (source lines), the content-free event log
# (AGENTBREW_EVENTS_FILE, default ~/.local/share/agentbrew/logs/events.jsonl),
# and the gate timings (.metrics/gate-timings.jsonl).
# Runs under macOS /bin/bash 3.2.
# <!-- scope: human-approved task meet-new-project-requirements (TASKS.md); this file closes step 2 -->
set -u

root="$(cd "$(dirname "$0")/.." && pwd)"
events="${AGENTBREW_EVENTS_FILE:-$HOME/.local/share/agentbrew/logs/events.jsonl}"
timings="${AGENTBREW_GATE_TIMINGS:-$root/.metrics/gate-timings.jsonl}"

row() { printf '%-24s %-14s %-14s %s\n' "$1" "$2" "$3" "$4"; }

source_lines="$(cd "$root" && git ls-files 'src/*.ts' 2>/dev/null | grep -v '\.test\.ts$' | xargs cat 2>/dev/null | wc -l | tr -d ' ')"
case "$source_lines" in '' | 0 | *[!0-9]*) source_lines="(stub)" ;; esac

# jsonl_stats <file> <kind>: prints one line of values for the metric kind,
# each "(stub)" when the file is missing or holds no matching events.
jsonl_stats() {
  node -e '
const fs = require("fs");
const [file, kind] = process.argv.slice(1);
let lines = [];
try { lines = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean); } catch {}
const ev = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const median = (xs) => { if (!xs.length) return "(stub)"; const s = xs.slice().sort((a, b) => a - b); return String(s[Math.floor(s.length / 2)]); };
const rate = (xs) => xs.length ? Math.round((100 * xs.filter((e) => !e.ok).length) / xs.length) + "%" : "(stub)";
const since = Date.now() - 30 * 86400e3;
if (kind === "sync") {
  const s = ev.filter((e) => e.event === "sync" && Number.isFinite(e.ms));
  console.log(median(s.slice(-20).map((e) => e.ms)), rate(s));
} else if (kind === "repair") {
  console.log(rate(ev.filter((e) => e.event === "repair")));
} else if (kind === "stories") {
  const by = {};
  for (const e of ev) if (e.story && Date.parse(e.ts) >= since) (by[e.story] ||= []).push(e);
  const parts = Object.keys(by).sort().map((k) => k + "=" + rate(by[k]));
  console.log(parts.length ? parts.join(",") : "(stub)");
} else if (kind === "gate") {
  // Worktrees share the step cache, so most gates have a cached step. Count a
  // cached step at its last uncached time; drop a gate with a step never seen uncached.
  const lastUncached = {};
  const est = [];
  for (const e of ev) {
    if (e.event === "step" && !e.cached && e.ok && Number.isFinite(e.ms)) lastUncached[e.step] = e.ms;
    if (e.event !== "gate" || e.mode !== "full" || !e.ok || !Number.isFinite(e.ms)) continue;
    const cached = ev.filter((x) => x.event === "step" && x.ts === e.ts && x.cached);
    if (cached.some((x) => !Number.isFinite(lastUncached[x.step]))) continue;
    est.push(e.ms + cached.reduce((a, x) => a + lastUncached[x.step] - (Number.isFinite(x.ms) ? x.ms : 0), 0));
  }
  console.log(median(est.slice(-10)));
}
' "$1" "$2"
}

read -r sync_ms sync_fail <<EOF
$(jsonl_stats "$events" sync)
EOF
repair_fail="$(jsonl_stats "$events" repair)"
stories="$(jsonl_stats "$events" stories)"
gate_ms="$(jsonl_stats "$timings" gate)"

row "metric" "value" "goal" "pivot"
row "source_lines" "$source_lines" "<= 20000" "> 30000"
row "sync_ms" "${sync_ms:-(stub)}" "<= 2000" "> 10000"
row "sync_fail_rate" "${sync_fail:-(stub)}" "<= 5%" "> 20%"
row "repair_fail_rate" "${repair_fail:-(stub)}" "<= 5%" "> 20%"
row "story_fail_rate" "${stories:-(stub)}" "<= 5% each" "> 20% for one"
# Time to configured from the install receipt (scripts/install.sh run);
# (stub) without a receipt or when the last run did not finish.
receipt="${AGENTBREW_INSTALL_RECEIPT:-${XDG_STATE_HOME:-$HOME/.local/state}/agentbrew/install-receipt.json}"
zero_s="$(node -e '
try {
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8"));
  console.log(r.run && r.run.ok && Number.isFinite(r.run.seconds) ? r.run.seconds : "(stub)");
} catch { console.log("(stub)"); }' "$receipt" 2>/dev/null)"
row "zero_to_configured_s" "${zero_s:-(stub)}" "<= 120" "> 300"
row "gate_ms" "${gate_ms:-(stub)}" "<= 300000" "> 600000"
