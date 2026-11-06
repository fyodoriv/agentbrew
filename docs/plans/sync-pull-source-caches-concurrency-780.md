# Explicit source pull concurrency prediction (#780)

## Goal, question and hypothesis

Preserve independent source progress during explicit pulls without weakening
checkout identity or revision receipts. Does a blocked checkout prevent another
checkout from finishing? The current explicit route uses blocking pulls in a
loop, unlike the existing bounded async prefetch route.

Hypothesis: asynchronous Git operations restore independent progress from zero
observed async overlap to at least two active operations, while never exceeding
the existing per-invocation cap of eight. A blocked source A cannot prevent
independent source B from completing. This is a progress/state comparison, not
a latency benchmark.

## Frozen controls and measurement

Before implementation, add deterministic callback-gated controls at the existing
Git child-process boundary, using synthetic checkout identities. Hold A's
callback, complete B, and require B's operation to finish before releasing A.
Use more distinct checkouts than the cap to measure `2 <= max_active <= 8`.
Repeated registrations of one actual checkout must have `same_path_active <= 1`.
Overlapping explicit invocations must also serialize one checkout, then perform
their own refresh instead of sharing an earlier freshness outcome. Include fresh
clones so a synchronous clone cannot stall the pool. Retain per-source output
order and origin validation for conflicting aliases. Preserve the existing
fifteen real-Git safety cases, including both fixture-owned dirtying hooks.

```sh
PATH=/opt/homebrew/opt/rust/bin:$PATH:/opt/homebrew/bin heavy-run npx vitest run src/sync/pull-source-caches.test.ts src/catalog/index-source.test.ts src/update.test.ts src/lock.test.ts src/cli-sync-agentfile.test.ts src/integration.test.ts
PATH=/opt/homebrew/opt/rust/bin:$PATH:/opt/homebrew/bin heavy-run npx tsc --noEmit
PATH=/opt/homebrew/opt/rust/bin:$PATH:/opt/homebrew/bin heavy-run env NO_CACHE=1 npm run verify
```

Record semantic RED before changing the refresh code. Success requires all
progress, cap, duplicate-serialization and existing safety assertions to pass,
with the required full gate green. Pivot on any blocked independent progress,
cap breach, overlapping same-checkout write, reused invocation outcome, false
revision, unsafe mutation or safety regression. No threshold is relaxed.

## Implementation boundary

Reuse the existing `execFile` asynchronous Git boundary, `getGitTimeout`, and
bounded worker-loop shape. Keep the cap per invocation. A source-module-owned
per-checkout promise tail serializes overlapping invocations and is deleted
after its last waiter. It never stores or reuses freshness outcomes. Keep
ordinary source reads and their fetched memo unchanged. Validate each source
identity, preserve Git hooks and post-operation clean receipts, and do not use
realignment or a sequential fallback to make the controls pass.

No new dependencies, generic worker framework, unsafe APIs, owner cache writes,
owner configuration changes or public publication are part of this experiment.
The source and existing tests remain owned by TASKS ID
`sync-pull-source-caches-780`.

Anchor: Basili, Caldiera and Rombach (1994), GQM; Node.js `child_process.execFile`
asynchronous API; Git checkout/ref locking and fast-forward identity contracts.
