# Stale overlay provenance experiment

## Hypothesis

Goal: removed checkouts do not leave managed rule headings or memory-pack
paths in the user's configuration. Question: can sync prune only source-owned
artifacts while preserving unknown legacy content? Metric: stale owned rules
and pack paths drop to zero in scratch fixtures; unknown rules and unowned
memory paths remain unchanged.

## Measurement

`npx vitest run src/sync/stale-agentfile-artifacts.test.ts`, then the required
full gate when integrated with the lifecycle batch.

## Success

All provenance, absent-owner, live-owner, legacy-content and dry-run fixtures
pass. No unknown user data is deleted and required gates exit 0.

## Pivot

Keep artifacts whose owner cannot be proved. Legacy cleanup removes only
managed blocks containing an empty Team Rules heading and no substantive text.
A pack path is removed only if its recorded owning checkout is absent, never
merely because a pack directory is missing.

## Anchor

Basili et al. (1994), Goal Question Metric. Source provenance narrows the
cleanup decision to verifiable ownership instead of folder-name guessing.
