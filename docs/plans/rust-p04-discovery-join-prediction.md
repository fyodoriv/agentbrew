# Test-only P04 discovery join prediction

Register before implementation or execution. Calling the P04 relation on a
snapshot alone does not show which buffers discovery actually visited.

- **Hypothesis:** A final-source-closure-round, test-only join can bind the
  narrow P04 relation to both physical source buffers actually seen by
  discovery, without changing discovery or validation decisions.
- **Measurement:** From the repository root, run the exact new control and
  retained observation controls, then check the non-test library:

  ```sh
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_discovery_syntax::joins_p04_discovery_buffers -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_discovery_syntax::observes_real_discovery_sources -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_module_relation::frozen_p04_relation -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo check --locked --offline --manifest-path rust/Cargo.toml --lib
  ```

- **Success:** Each exact selector runs one test with zero failures or skips.
  Frozen P04 joins only after both physical root and selected module buffers
  were observed and byte-equal to independently retained snapshot entries;
  its path, module and function/call/literal spans match the frozen witness.
  At least six controls reject an unvisited module, changed module or root
  bytes, wrong path, generated body, overflow, and unsupported relation; a
  shifted witness fails comparison. Unvisited, changed, generated and restart
  cases exercise actual discovery routing and the final join; direct helper
  calls alone do not satisfy them. Restart discards earlier-round evidence.
  Observed/unobserved discovery and validation remain identical to retained
  B0 controls, and normal non-test compilation succeeds.
- **Pivot:** Stop if an unvisited, changed, ambiguous or generated buffer
  yields an admitted relation; if a prior round survives restart; if a cap is
  exceeded without inconclusive status; or if a discovery result, report or
  registry-required diagnostic changes. Missing tests, setup or build failure
  are inconclusive.
- **Anchor:** [P04 relation prediction](rust-p04-module-relation-prediction.md),
  the existing discovery observer, and Basili et al. (1994), Goal Question
  Metric.

Keep all join state per invocation and behind `cfg(test)`. Record only bounded
closed evidence for exact physical paths, source length and equality against
the snapshot at observation time; never retain raw source in the trace. Cap
the root and selected source at 2 MiB each, returned sites at 256, and total
retained path and module text at 65,536 bytes. A generated source, missing or
unvisited buffer, duplicate or conflicting observation, mismatch, unsupported
shape or overflow invalidates the whole join. Enforce limits before allocating
additional join state or temporary copies; existing discovery allocations are
not bounded by this probe. Reset it on source-closure restart, but not merely on host-graph
passes. This joins a partial lexical relation to visited bytes; it does not
prove Cargo root authority, general module resolution, standard-library
identity, full coverage or writer admission. It cannot authorize a worker.

## Pre-implementation pivot

Independent routing review found that discovery makes each recognized,
valid-UTF-8 non-symlink Rust entry a physical root from the same snapshot
bytes. When admitted, queued keys are processed at most once per closure round;
the source-count or per-source limits can prevent processing. The review did
not identify a real producer of generated Rust bodies. The
registered selective-unvisited, changed-buffer and generated-route controls
therefore have no demonstrated fixture. A source-count refusal can leave the
whole join unvisited, and an independently retained mismatched expectation can
test a comparison, but neither is the promised selective route. An existing
promotion fixture restarts closure; its unchanged Rust roots alone do not prove
stale-only evidence is discarded.

Do not implement this prediction by injecting observer-only events or calling
helper-level controls actual routing. No bridge or registered control ran.
Keep this prediction inconclusive. A narrower claim requires a separate
prediction and real routing fixtures, or evidence of an actual generated Rust
producer and a discriminating restart case. This pivot leaves production
discovery, adapter admission and worker safety unchanged.
