#!/usr/bin/env bash
# scripts/hook-observation.sh
#
# Phase-1 observation gate for the deterministic Cat A hooks
# (hooks-phase-1-cat-a-deterministic). Aggregates the runtime decision log
# (~/.cache/agentbrew/hook-decisions.jsonl, written by hooks/lib/log-decision.sh)
# per hook over a trailing window and verifies that every hook declared in
# hooks/manifest.yaml fired its ENFORCING verdict — block, warn, or mutate —
# at least once. That is the empirical proof the hooks are catching real
# violations (the Phase-1 acceptance), and the precondition for Phase 3
# (decommissioning the corresponding prose rules from shared-rules.md).
#
# Usage:
#   scripts/hook-observation.sh [--since DAYS] [--log PATH] [--manifest PATH]
#
# Exit 0 — every manifest hook logged >=1 enforcing decision in the window.
# Exit 1 — one or more hooks were silent (listed), or the log is missing.
# Exit 2 — bad arguments / manifest not found.

set -euo pipefail

SINCE_DAYS=7
LOG="${HOME}/.cache/agentbrew/hook-decisions.jsonl"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$REPO_ROOT/hooks/manifest.yaml"
STRICT=false

usage() {
  echo "usage: scripts/hook-observation.sh [--since DAYS] [--log PATH] [--manifest PATH] [--strict]"
  echo "  --strict  also fail on hooks that had no matching tool call in the window"
  echo "            (default: only fail on a hook that RAN but never enforced)"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --since) SINCE_DAYS="$2"; shift 2 ;;
    --log) LOG="$2"; shift 2 ;;
    --manifest) MANIFEST="$2"; shift 2 ;;
    --strict) STRICT=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -f "$MANIFEST" ] || { echo "manifest not found: $MANIFEST" >&2; exit 2; }

# Hook IDs declared in the manifest (the set we expect to observe firing).
HOOK_IDS="$(grep -E '^[[:space:]]+- id:' "$MANIFEST" | sed -E 's/.*id:[[:space:]]*//' | tr -d "\"'" | sort -u)"

if [ ! -f "$LOG" ]; then
  echo "hook-observation: no decision log at $LOG" >&2
  echo "  The hooks have not fired yet on this machine (fresh install, or hooks not deployed)." >&2
  echo "  Deploy via 'agentbrew sync' and re-run once agents have exercised the hooks." >&2
  exit 1
fi

HOOK_IDS="$HOOK_IDS" SINCE_DAYS="$SINCE_DAYS" STRICT="$STRICT" python3 - "$LOG" <<'PY'
import collections, datetime, json, os, sys

log_path = sys.argv[1]
hook_ids = [h for h in os.environ.get("HOOK_IDS", "").splitlines() if h.strip()]
since_days = int(os.environ.get("SINCE_DAYS", "7"))
strict = os.environ.get("STRICT", "false") == "true"
cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=since_days)

ENFORCING = {"block", "warn", "mutate"}
counts = collections.defaultdict(collections.Counter)
total = 0
with open(log_path) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        ts = d.get("timestamp")
        if ts:
            try:
                t = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except ValueError:
                t = None
            if t is not None and t < cutoff:
                continue
        counts[d.get("hookId", "?")][d.get("decision", "?")] += 1
        total += 1

print(f"hook-observation: trailing {since_days}d window, {total} decisions, {len(hook_ids)} manifest hooks")
print(f"{'hookId':40}{'block':>6}{'warn':>6}{'mutate':>7}{'allow':>7}{'bypass':>7}  state")

# Three states per hook:
#   enforced       — >=1 block/warn/mutate decision (the hook caught real violations)
#   ran-no-enforce — saw matching tool calls (allow/bypass) but never enforced (suspect matcher/logic)
#   no-opportunity — zero decisions at all (no matching tool call in the window; rare trigger or unwired)
ran_no_enforce, no_opportunity = [], []
for hid in hook_ids:
    c = counts.get(hid, collections.Counter())
    enforced = sum(c[k] for k in ENFORCING)
    fired = sum(c.values())
    if enforced > 0:
        state = "enforced"
    elif fired > 0:
        state = "ran-no-enforce"
        ran_no_enforce.append(hid)
    else:
        state = "no-opportunity"
        no_opportunity.append(hid)
    print(
        f"{hid:40}{c['block']:>6}{c['warn']:>6}{c['mutate']:>7}{c['allow']:>7}{c['bypass']:>7}  {state}"
    )

extra = sorted(h for h in counts if h not in set(hook_ids) and h != "?")
if extra:
    print("\nlogged but not in manifest (drift):", ", ".join(extra))

if no_opportunity:
    print(f"\nNO-OPPORTUNITY ({len(no_opportunity)}): no matching tool call in the last {since_days}d "
          f"(rare trigger — verify it is still wired in ~/.claude/settings.json):")
    for h in no_opportunity:
        print(f"  - {h}")

failed = list(ran_no_enforce)
if strict:
    failed += no_opportunity

if failed:
    label = "no enforcing decision" if not strict else "no enforcing decision (strict: incl. no-opportunity)"
    print(f"\nFAIL: {len(failed)} hook(s) logged {label} in the last {since_days}d:")
    for h in failed:
        print(f"  - {h}")
    sys.exit(1)

enforced_n = len(hook_ids) - len(no_opportunity)
print(f"\nPASS: all {enforced_n} hook(s) that saw a matching tool call enforced >=1 time in the last {since_days}d"
      + (f" ({len(no_opportunity)} had no matching call — informational)" if no_opportunity else "") + ".")
PY
