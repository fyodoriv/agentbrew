# Refresh a managed cache after an upstream rewrite

**Hypothesis:** A clean managed cache at the prior origin tip currently stays
stale after an unrelated origin history replaces it. The explicit pull can
advance the cache and its revision receipt using the origin update observed
during that same pull. In three consecutive updates after the rewrite, stale
reads should drop from three to zero.

**Measurement:** Run the real local Git fixtures in hosted CI with
`npx vitest run src/sync/pull-source-caches.test.ts`. The rewrite fixture
compares the checked-out commit, reported receipt and skill contents with the
new origin tip. It also checks that a salvage ref preserves the prior revision.

**Success:** Three of three explicit updates read the new tip and publish an
exact receipt. The first reports the rewrite once. The second and third stay
at the same verified tip. Existing dirty, detached, wrong-origin and
concurrency controls retain their expected outcomes.

**Pivot:** If one fixture ever publishes a false revision, changes a dirty
cache, or discards a local branch tip, abandon automatic realignment and
retain the explicit refusal until a safe transition is proven.

**Anchor:** [Agentbrew issue #987](https://github.com/fyodoriv/agentbrew/issues/987)
records a cache that stayed stale after an upstream history replacement.
[The explicit-pull contract](sync-pull-source-caches-concurrency-780.md)
defines the checkout identity, concurrency and receipt controls.

## Boundaries

Use the existing checkout lease and validate cache ownership and origin
before the pull. A fresh remote result must confirm the configured tracking
branch. An earlier attempted refresh may have moved its tracking ref
already. In that case, the same ref's history must identify the unchanged
cache tip. Preserve that tip and use the ordinary post-operation receipt
check.

Repeat the three-read measurement with two origin updates fetched before
the explicit pull. Require the same receipts. Also require zero changes
to ignored files that would collide with incoming tracked paths, and zero
checkout changes when the exact upstream branch disappears.
