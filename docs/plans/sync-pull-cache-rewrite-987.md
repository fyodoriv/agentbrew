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
before the pull. Realign only when that pull updated the configured tracking
ref to an unrelated history and the clean checked-out branch still points
to the previous tracked commit. Preserve the previous revision and use the
ordinary post-operation receipt check. A failed network call, a local
divergence, or an ambiguous tracking state retains the existing refusal.
