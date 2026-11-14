# Test-only Cargo configuration refusal prediction

Register before implementation or execution. Cargo configuration can affect
compiler settings; the snapshot-relative test shadow does not yet refuse the
repository-root configuration names.

- **Hypothesis:** Refusing tracked `.cargo/config` and `.cargo/config.toml` in
  either snapshot removes these ambiguous candidates without changing ordinary
  discovery or validation.
- **Measurement:** Run the exact `shadows_root_namespace` and
  `witnesses_p04_routed_buffers` controls with one Cargo worker and test thread
  under `heavy-run`, plus an offline non-test library check, as in
  [the build-script prediction](rust-shadow-build-script-prediction.md).
- **Success:** Both selectors run one test with zero failures or skips. For
  each name, actual-only, expected-only and both-snapshot entries refuse; absent
  in both retains the existing candidate. Each mutation retains the routed root
  and full observed-versus-unobserved discovery and validation parity. The
  original C01/P01/N02a B0 projections stay unchanged on their original inputs.
  The non-test library builds.
- **Pivot:** Stop if any listed entry produces a candidate, a routed visit is
  absent, ordinary discovery or validation changes, or an exact selector does
  not run. A build or setup failure is inconclusive.
- **Anchor:** [Cargo configuration](https://doc.rust-lang.org/cargo/reference/config.html),
  [root namespace shadow](rust-root-namespace-shadow-prediction.md), and
  Basili et al. (1994), Goal Question Metric.

The check is test-only and snapshot-relative. It does not establish Cargo home,
ancestor configuration, invocation flags, wrappers, toolchain, sysroot, or
standard-library authority. It does not authorize a production writer or worker.
No analyzed source is executed. The production inventory still needs a reviewed
real-input authority contract; these refusals do not replace it.
