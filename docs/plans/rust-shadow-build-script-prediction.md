# Test-only root build-script refusal prediction

Register before implementation or execution. Cargo can discover a package-root
`build.rs` without a manifest `build` key. The current shadow does not check it.

- **Hypothesis:** A snapshot-relative build-script refusal removes this false
  shadow candidate while preserving all production decisions and B0 reports.
- **Measurement:** From the repository root, run the exact shadow and retained
  routed controls, then the normal non-test library check:

  ```sh
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_discovery_syntax::shadows_root_namespace -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_discovery_syntax::witnesses_p04_routed_buffers -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo check --locked --offline --manifest-path rust/Cargo.toml --lib
  ```

- **Success:** Each exact selector runs one test with zero failures or skips.
  The existing absent-build-script P01–P03 controls still produce their shadow
  candidates. A tracked root `build.rs`, an untracked root `build.rs`, and an
  ignored root `build.rs` each produce no candidate. Nonempty untracked or
  ignored lists also refuse, including unrelated or ambiguous entries. Include
  actual-only and expected-only `build.rs`, and actual-only and expected-only
  nonempty untracked and ignored lists, plus absent-in-both success. All
  controls use independently retained expected snapshots and preserve
  actual routed root bytes. The existing N04 and P04 refusals remain. Complete
  C01/P01/N02a B0 projections and validation reports remain unchanged, and
  non-test compilation succeeds.
- **Pivot:** Stop if any listed build script or unknown untracked/ignored entry
  yields a candidate, if a required routed visit is absent, or if discovery,
  diagnostics or validation change. A missing selector or setup/build failure
  is inconclusive.
- **Anchor:** [Cargo build scripts](https://doc.rust-lang.org/cargo/reference/build-scripts.html),
  [root namespace shadow](rust-root-namespace-shadow-prediction.md), and
  Basili et al. (1994), Goal Question Metric.

The shadow remains `cfg(test)` only. Check the same independently retained
expected snapshot and actual snapshot; a nonempty untracked/ignored list in
either refuses without interpreting its contents. Check both entry maps for
the exact root path and refuse any `build.rs` entry regardless of mode. This is
conservative and snapshot-relative: it does not prove that collection found
every file, or establish ancestor workspace/configuration, Cargo home,
compiler flags, wrappers, target, sysroot or toolchain identity. It does not
authorize a Rust writer or worker. No analyzed source is executed.

## Focused result

The exact shadow control passed with 15 actual/expected/both mutations for
tracked, untracked, ignored and unrelated entries. Each still routed the root
and matched ordinary discovery and validation. The retained routed test and
non-test library check passed. Independent review checked both-snapshot
refusal and the snapshot-relative limit; this is not Cargo authority.
