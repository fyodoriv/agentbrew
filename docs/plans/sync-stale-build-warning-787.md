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
