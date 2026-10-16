# Observability

How to see what the program did, what broke, and how fast it is, without
reading user data. Built in from the first commit, not added later.

## Logs

- One JSON object per line, appended to `.metrics/events.jsonl` (never committed).
- Fields: `ts`, `event` (`component.action`, for example `setup.done`), `story`
  (the user story id, such as `US-01`, when the event belongs to one), `ok`,
  `seconds`, and ids or counts only.
- Content-free: never log user text, file contents, or secrets. Log a hash or a
  count instead. An error message that could quote user content is dropped.

| Event | When | Fields |
|---|---|---|
| `check.step` | each step of `scripts/check.sh` | `name`, `seconds`, `ok` |
| FILL: `component.action` | FILL: when it fires | FILL: fields |

## Errors

- Every caught error writes an event with `ok: false`, the `story` it breaks, and an error code.
- External error reporting (for example Sentry) sits behind one adapter and is
  off unless `ERROR_REPORTER` is set in `.env`. Local file first.
- A failure that maps to a user story is a broken story: fix it before new work.
{{ERRORS_EXTRA}}

## Metrics

Each metric has a goal and a pivot (the value at which we change approach).
Show missing data as `(stub)`, never as a silent zero.

| Metric | Goal | Pivot | Command |
|---|---|---|---|
| Success metric (see `docs/VISION.md`) | FILL | FILL | FILL: command |
| Errors per day, by story | 0 broken stories | any story failing 2 days running | FILL: command over `.metrics/events.jsonl` |
| Speed of the main action (p50, p95) | FILL | FILL | FILL: command |
| Gate time (`scripts/check.sh`) | under the gate budget | 2x the budget | `scripts/metrics.sh` |
| Cost per run (tokens or money), if it calls paid services | FILL | FILL | FILL: command, or "none" |

Compare the main metrics with the closest competitor in `docs/VISION.md` → Prior art.

## Health check

`scripts/doctor.sh` prints one `ok` or `FAIL` line per check, each with its fix.
Add a check for every new dependency and for each way the main story can break.

## Checkup and caching

`scripts/checkup.sh` is the one repo-wide checkup. `scripts/check.sh` skips a
step that passed while the repo's inputs are unchanged (an input hash, like the
nx cache), so a checkup on a quiet day takes seconds and any change re-runs
everything. Cache hits log `"cached":true`. Use `NO_CACHE=1` after a tool
upgrade. For big suites, add affected-only test selection per stack
(`references/stacks.md` in the new-project skill).

## Speed review

Each week (`RECURRING.md`), run `scripts/metrics.sh`. If a step got slower or
the gate is over its budget, file a task to make it faster.

- **Gate budget**: `scripts/check.sh` finishes in under 120 seconds on this machine.
