# Test-only Rust root and namespace shadow prediction

Register before implementation or execution. Literal syntax and routed bytes
alone do not establish Cargo ownership or standard-library identity.

- **Hypothesis:** A bounded test-only shadow can combine the existing narrow
  manifest/namespace screen with final-round physical Rust visits for P01–P03,
  while retaining all existing discovery and validation decisions.
- **Measurement:** From the repository root, run the new exact shadow control,
  the existing routed and namespace controls, and a non-test library check:

  ```sh
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_discovery_syntax::shadows_root_namespace -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_discovery_syntax::witnesses_p04_routed_buffers -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_namespace_screen::frozen_namespace_controls -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo check --locked --offline --manifest-path rust/Cargo.toml --lib
  ```

- **Success:** Each exact selector runs one test without failures or skips.
  P01–P03 yield a shadow candidate only after the matching physical root
  buffer is visited in the final admitted round. P04 and N04a–N04f remain
  inconclusive and retain the registry-required decision. Planted edition,
  root, workspace, dependency named `std`, local `std`, extern/alias/glob,
  attributes/macros, symlink, invalid UTF-8 and oversized-input mutations
  all yield zero candidates. A wrong or absent routed buffer, duplicate, early
  stop or overflow is inconclusive. The routed/unrouted C01/P01/N02a B0
  projections and complete reports remain identical; non-test compilation
  succeeds. A synthetic reset control must not treat earlier-round state as
  final; label it helper-level unless a discriminating actual-route fixture is
  demonstrated. Label screen-only mutations separately from routed controls.
- **Pivot:** Stop if unsupported input produces a candidate, any report or
  registry-required diagnostic changes, a bound is crossed without refusal,
  or required route evidence is absent. Missing selectors, setup or build
  failures are inconclusive.
- **Anchor:** [P04 routed witness](rust-p04-routed-witness-prediction.md),
  the frozen literal corpus and existing namespace screen; Basili et al.
  (1994), Goal Question Metric.

Keep the shadow and its per-invocation final-round state behind `cfg(test)`;
it cannot change production decisions. Compare actual routed Rust bytes with
an independently retained expected snapshot. `Cargo.toml` is snapshot-only
evidence: discovery does not route it as Rust. Require the explicit minimal
2021 `[lib]` root and reject workspace inheritance, unsupported manifest
keys and unsupported syntax. Bound each source and manifest at 2 MiB, records
at 256 and aggregate retained text at 65,536 bytes before extra allocations;
retain no raw source in the trace. P04's out-of-line root is deliberately
inconclusive in this slice. Do not infer a complete Cargo environment from a
manifest: ancestor workspaces, Cargo configuration, build scripts, toolchain
and external inputs remain unproved. This shadow candidate is not semantic
authority, complete writer coverage, producer-conflict resolution, or worker
and adapter admission.

P01–P03 need a separately scoped single-root route; the existing P04 observer
requires two distinct paths and cannot stand in for it. Bind the candidate,
expected manifest and root bytes to one independent snapshot. Compare the
actual physical path and bytes, publish only after final-round completion, and
invalidate on early return, worklist limit, duplicate or overflow. Clear prior
evidence before an observer is reused. A helper-level reset test is not proof
of a real stale-only restart.

## Focused result

The exact shadow control, retained routed and namespace tests, normal library
check and 28 workflow controls passed. Independent review found two false
candidate paths in the first version: a swapped expected manifest and a writer
from another file. The corrected test binds the manifest to the same snapshot
and requires a root-specific routed record; both planted cases were refused.
Screen-only mutations and helper-level reset remain labeled as such. This is
not Cargo or standard-library authority or approval to admit a writer.
