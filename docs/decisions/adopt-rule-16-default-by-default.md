# Decision: adopt rule 16 as a flag audit plus a lint, flip no flag today

- **Task**: `adopt-rule-16-default-by-default`
- **Date**: 2026-10-16
- **Status**: decided — audit and lint shipped; no flag flipped

## Context

Minsky's rule 16 says: make a new behavior the default at once, keep an
opt-out only for debugging, and answer "why is this not the default?" for
every opt-in. The task asked for a check in `npm run verify`, a PR template
field, an audit of every existing flag, and at least one flag flipped to the
default.

## What shipped

- [`docs/cli-flags-audit.md`](../cli-flags-audit.md): one row per long CLI
  flag under `src/`, with a category (`opt-out`, `debug`, `knob`,
  `disruptive`) and the reason it is not the default.
- `scripts/check-rule-16-defaults.mjs`: fails `npm run verify` when a flag has
  no row, a row names a flag that no longer exists, or a row has an unknown
  category. `--json` prints `unjustified_flags`, `stale_rows`, and `bad_rows`.
- The PR template asks why each new flag is not the default.

The task's check was to read the PR body. `npm run verify` runs locally and
never sees a PR body, so the check reads the audit doc instead. The PR
template field covers the PR side.

## Why no flag was flipped

The audit found no candidate:

- The `opt-out` flags (`--no-prune`, `--no-recommended`, `--skip-*`) already
  follow rule 16: the behavior is on by default.
- `debug` flags (`--dry-run`, `--verbose`, `--sequential`, ...) are the
  debug-only exit hatches that rule 16 allows.
- `knob` flags take an input or pick a scope or output format. There is no
  single right default.
- `disruptive` flags delete, overwrite, skip a prompt, or do slow network
  work (`--confirm`, `--replace`, `--yes`, `--pull`, `--deep`). Making them
  the default would cause harm.

Flipping a flag only to meet the acceptance count would break rule 16's own
burden of proof. The lint makes the question visible for every new flag,
which is where the rule pays off.

## Review

Re-run the audit when a flag is added. If a `debug` or `knob` row starts to
read like "everyone passes this", flip it then, with a measurement.
