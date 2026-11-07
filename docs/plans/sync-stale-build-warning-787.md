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
