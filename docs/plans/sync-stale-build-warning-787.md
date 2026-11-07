# Sync stale-build warning experiment

Issue: #787

## Prediction

Goal: prevent a sync from silently running an outdated CLI. Question: does
checking the existing build-health result at sync entry warn before any sync
work? Metric: a stale-build fixture emits its rebuild guidance before the
first sync operation in 1 of 1 cases; a current-build fixture emits no stale
warning in 1 of 1 cases. The sync still runs in both cases. Cover normal,
dry-run, pull, and rollback paths, and reuse the existing real Git build-health
tests to verify the underlying stale/current classification.

## Measurement and decision

Run `npm exec vitest run src/cli-sync-build-health.test.ts src/cli-build-health.test.ts`.
Keep the approach only if every case passes, the warning precedes sync work,
and the existing classification tests pass. Abandon it if any case fails or
the warning changes sync behavior. This change only helps builds that contain
the warning; an older already-built CLI cannot warn until it is rebuilt.

## Anchor

Basili, Caldiera, and Rombach (1994), Goal Question Metric approach.

## Initialized-user ordering supplement

Independent review found that the original fixtures did not exercise an
initialized user's root command hook. That hook can print a status line and
write state before the current sync-entry warning. This is a newly identified
boundary; the earlier passing fixtures do not measure it.

Goal: warn before any root-hook output or write on a stale sync. Question: does
placing the existing build-health check before the root hook preserve the
warning and sync behavior? Predict **4/4** stale normal, dry-run, pull, and
rollback controls warn once before the first hook output or state write;
**1/1** current-build control stays quiet and continues. A non-sync command
must not receive an extra build-health check. Preserve the original build-health
classification and no automatic rebuild.

After this prediction is committed, add an initialized-state ordering
reproduction. Run the real root `preSubcommand` and MOTD functions with
synthetic initialized state and mocked external side effects. Observe the
first hook output, `touchLastSeen`, and repair-log clearing. Keep the original
focused assertions unchanged. The named normal-sync red control must fail
with its fixed late-warning assertion; setup or compilation failures are
inconclusive:

```sh
bash <<'BASH'
set -o pipefail
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
JOBS=1 heavy-run npm exec -- vitest run src/cli-sync-build-health.test.ts -t 'initialized normal warns before root-hook output and writes' --maxWorkers=1 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
[ "$status" -ne 0 ] && grep -Fq 'initialized normal warns before root-hook output and writes' "$log" && grep -Eq 'Tests[[:space:]]+1 failed' "$log" && grep -Fq 'warning came after hook side effects' "$log"
BASH
```

Then implement the new placement. Measure with:

```sh
JOBS=1 heavy-run npm exec -- vitest run src/cli-sync-build-health.test.ts src/cli-build-health.test.ts --maxWorkers=1
```

Success requires all five ordering controls, the non-sync control, the
original focused cases and the normal full repository gate. A missing, late or
duplicated warning, a new non-sync health check, changed sync behavior or a
failed gate rejects this placement. Do not relax the existing tests or alter
the stale/current classifier. The test uses synthetic state and mocks external
work; it does not inspect the owner's configuration.

Anchor: issue #787's before-write requirement; Basili, Caldiera and Rombach
(1994), Goal Question Metric; Munafò et al. (2017), preregistration.

## Parsed-command placement experiment

The first ordering placement moved the check into the root hook. Its 20 focused
checks passed, but independent review found that Commander invokes that hook
before processing sync help or invalid options. The placement would therefore
run the health check for those non-executing commands. Reject that placement;
the focused pass did not cover this behavior.

Goal: make the warning precede sync writes without inspecting build health for
help or invalid input. Question: can sync defer its status hook until after
successful parsing, then warn before that hook? Predict **4/4** initialized
stale sync paths warn once before hook output and writes; **1/1** current path
stays quiet and runs; and **2/2** help and invalid-option paths make zero build
health checks and zero status-hook writes. The help and invalid paths will
intentionally stop running the status hook; this removes their current status
output and writes. Non-sync commands retain their existing hook behavior.

Commit this prediction before adding tests or changing the placement. The
initialized-state test file is retained locally in the rejected candidate
stash, SHA-256
`b55fb0f74000e7c645eaa4ae3933387e7d93276d904f3bebadc49ccb48c05e6f`.
Restore and verify those exact bytes first, then append controls without
changing its existing cases. Preserve the original focused cases. Add named
synthetic help and invalid-option controls; run the help control against the
existing action-level candidate and require a named failing test, one-failed
summary and the fixed `sync help ran status hook` assertion. A setup failure is
inconclusive:

```sh
bash <<'BASH'
set -o pipefail
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
JOBS=1 heavy-run npm exec -- vitest run src/cli-sync-build-health.test.ts -t 'sync help skips build health and status hook' --maxWorkers=1 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
[ "$status" -ne 0 ] && grep -Fq 'sync help skips build health and status hook' "$log" && grep -Eq 'Tests[[:space:]]+1 failed' "$log" && grep -Fq 'sync help ran status hook' "$log"
BASH
```

Then implement the parsed-command placement and run:

```sh
JOBS=1 heavy-run npm exec -- vitest run src/cli-sync-build-health.test.ts src/cli-build-health.test.ts --maxWorkers=1
```

Keep the change only if every control and the full normal repository gate pass.
Any late or duplicated warning, help/invalid health check or status-hook write,
changed non-sync behavior, or failed gate rejects this placement. Do not alter
the build-health classifier or automatically rebuild. Tests use synthetic
state and mock external work. Anchor: issue #787's before-write requirement;
Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al. (2017),
preregistration.

## Command timing preservation supplement

The parsed-action placement passed 22 focused checks. Independent source
review found an unmeasured timing change: the root `preAction` starts the
command event before the moved status hook. Reject that placement until the
original timing boundary is preserved. The retained test file has SHA-256
`dc270004eaa7317a50005f93e24c0ce20608cfa4263444263c6c20d49f2d56fa`;
restore and verify its exact bytes before appending the timing control.

Goal: preserve the command event's original timing boundary. Question: can the
parsed sync warning and status hook run before the event timer starts?
Predict **1/1** synthetic clock control reports exactly 20 ms of command work,
excluding 1,000 ms spent in the mocked status hook. The test supplies a known
synthetic story and requires exactly one `event: command` record with `ms: 20`;
the rejected placement must record 1,020 ms in the red control. It does not
confuse that record with the separate `sync` event. All four stale paths,
current, help, invalid and non-sync controls must remain correct. This is a
clock-controlled ordering test, not a latency measurement.

Commit this prediction before changing code or adding the timing test. Restore
the retained test and parsed-action candidate, then run the named red control
below. It must fail with the fixed timing assertion; a setup failure is
inconclusive:

```sh
bash <<'BASH'
set -o pipefail
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
JOBS=1 heavy-run npm exec -- vitest run src/cli-sync-build-health.test.ts -t 'sync command timing excludes status hook' --maxWorkers=1 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
[ "$status" -ne 0 ] && grep -Fq 'sync command timing excludes status hook' "$log" && grep -Eq 'Tests[[:space:]]+1 failed' "$log" && grep -Fq 'sync command timing included status hook' "$log" && grep -Fq '1020' "$log"
BASH
```

Then run the warning and status hook in the parsed sync `preAction` boundary
before the command event timer starts. The existing `preSubcommand` hook stays
unchanged for non-sync commands. Re-run the full focused command from the
parsed-command experiment and the normal full repository gate. A timing
mismatch, late warning, unwanted help/invalid side effect, non-sync regression,
or failed gate rejects this placement. Preserve the classifier and do not
automatically rebuild. Anchor: issue #787; the existing `recordCommandEvents`
boundary; Basili, Caldiera and Rombach (1994), Goal Question Metric.
