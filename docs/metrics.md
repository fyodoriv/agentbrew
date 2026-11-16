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
| `zero_to_configured_s`: cold one-step install to a clean `agentbrew status --ci` | US01 | ≤ 120 s | > 300 s: cut install steps or delegate them | `bash scripts/metrics.sh` (reads `run.seconds` from the install receipt that `scripts/install.sh run` saves; `(stub)` without a finished run) |
| `gate_ms`: median wall time of the last 10 passing `npm run verify` runs, each cached step counted at its last uncached time (a run with a step never seen uncached is left out) | contributor | ≤ 300000 ms | > 600000 ms: split the slowest step or cache it | `bash scripts/metrics.sh` (reads `.metrics/gate-timings.jsonl`) |

## Current state (2026-11-16)

Checked values, not goals. Re-measure before you quote them.

| Item | Value | How it was checked |
|---|---|---|
| Hosted CI time per job, median of the last 5 green `main` CI runs (2026-11-16) | `verify (ubuntu-24.04)`: 439 s (~7.3 min, range 418-540); `verify (macos-latest)`: 1117 s (~18.6 min, range 1000-1255) | `gh run list --branch main --workflow CI --status success --limit 5`, then the jobs API `completed_at - started_at` per job |
| npm cache keep/drop check | Baseline with the npm cache, macOS `setup-node` + `Install` steps: median 38 s (n=5, the runs above). The cache was removed in #1029 ([table](ci.md)). **Success**: median ≤ 30 s over the next 5 green `main` runs. **Pivot**: median > 45 s, restore `cache: npm` | the same jobs API, summing the `actions/setup-node` and `Install` step times of the macOS job |
| Telemetry last send | `agentbrew telemetry send` exited 0 and sent 166 events on 2026-11-16; `agentbrew telemetry status` shows last send 2026-11-16 | `agentbrew telemetry status` |
| Rust migration | Closed out 2026-11-16 (#1031): 0 open port tasks, 6 steps recorded as exceptions with reopen triggers; only `checkup-run` ships. A test checks that every native crate input is in `BUILD_INPUTS` | [`plans/rust-migration.md`](plans/rust-migration.md) |
| Tests | Run on hosted CI only; the opt-in `block-local-tests` hook blocks them in a checkout | [`ci.md`](ci.md#tests-run-on-hosted-ci-only) |

## Notes

- The README `## Proof` section is generated. `npm run docs:proof` saves the
  numbers to `docs/proof/metrics.json` (value, date, data kind, command, and a
  history per metric) and rewrites the section. `npm run docs:proof -- --render`
  rewrites the section only. `src/docs/proof.test.ts` fails when they drift.
- Headline Proof rows are field outcomes from the local event log only. Gate
  and code counts sit under "Engineering health". Each machine is named by a
  salted hash (the salt stays in `~/.local/state/agentbrew/proof-salt`).
  Nothing is uploaded; how a second machine's totals reach the repo is open.

- Events are content-free: counts, times, and enum names only. The format and
  the privacy rules are in [`observability.md`](observability.md).
- `source_lines` uses the same rule as the 30K-line kill trigger: every tracked
  `src/**/*.ts` file except `*.test.ts`.
- Record what you predicted and what you observed for each change in
  [`learnings.md`](learnings.md).
