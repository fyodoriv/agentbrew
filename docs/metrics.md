# Metrics

How we know agentbrew works. Each metric is an outcome, not a count of tests
or commits. Each row has a goal, a pivot (the value at which we change the
approach, not only the change), and the exact command that measures it.

Print every value with:

```bash
bash scripts/metrics.sh
```

A metric with no data prints `(stub)`, never `0`. A missing log or an empty
history is not a real zero.

## Table

| Metric | Story | Goal | Pivot | Command |
|---|---|---|---|---|
| `source_lines`: non-test TypeScript lines under `src/` | all | ≤ 20000 by 2027-01-01 | > 30000 at a quarterly review: run the keep-or-kill review in [`VISION.md` § Kill criteria](VISION.md#kill-criteria) | `git ls-files 'src/*.ts' \| grep -v '\.test\.ts$' \| xargs cat \| wc -l` |
| `sync_ms`: median wall time of the last 20 `agentbrew sync` runs | US08 | ≤ 2000 ms | > 10000 ms: profile the slowest sync module and delegate or cut it | `bash scripts/metrics.sh` (reads `sync` events from the [event log](observability.md#events)) |
| `sync_fail_rate`: share of `agentbrew sync` runs that end with an error | US08 | ≤ 5% | > 20%: stop new sync features until the top error is fixed | `bash scripts/metrics.sh` (reads `sync` events) |
| `repair_fail_rate`: share of scheduled repairs (`agentbrew fix`) that leave drift or fail | US06 | ≤ 5% | > 20%: move the drift types that never clear out of the repair loop | `bash scripts/metrics.sh` (reads `repair` events) |
| `story_fail_rate`: failed events per story, last 30 days | each story | ≤ 5% per story | > 20% for one story: that story's next task becomes P0 | `bash scripts/metrics.sh` (groups `sync`, `command`, `repair`, and `error` events by `story`) |
| `zero_to_configured_s`: cold one-step install to a clean `agentbrew status --ci` | US01 | ≤ 120 s | > 300 s: cut install steps or delegate them | `time E2E_COLD=1 npm run test:install-e2e` (no run is recorded yet, so `metrics.sh` prints `(stub)`) |
| `gate_ms`: median wall time of the last 10 passing, fully uncached `npm run verify` runs | contributor | ≤ 300000 ms | > 600000 ms: split the slowest step or cache it | `bash scripts/metrics.sh` (reads `.metrics/gate-timings.jsonl`) |

## Notes

- Events are content-free: counts, times, and enum names only. The format and
  the privacy rules are in [`observability.md`](observability.md).
- `source_lines` uses the same rule as the 30K-line kill trigger: every tracked
  `src/**/*.ts` file except `*.test.ts`.
- Record what you predicted and what you observed for each change in
  [`learnings.md`](learnings.md).
