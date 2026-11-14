# Rust authority input audit prediction

Register before the audit. The test-only shadow cannot prove an effective
Cargo invocation or authorize Rust writer discovery.

- **Hypothesis:** A source-traced matrix will distinguish inputs the current
  inventory supplies from invocation facts it cannot establish, without
  assuming unobserved inputs are absent.
- **Measurement:** Inspect the current snapshot producer, discovery and
  validation handoff, and frozen corpus constraints; record exact source paths
  and independently review the matrix. Do not execute analyzed source or a
  physical worker.
- **Success:** Five of five rows name their actual producer and trust boundary
  or say unavailable: repository snapshot; invocation and manifest selection;
  Cargo config, environment and flags; compiler, sysroot, target and standard
  library; build scripts and namespace exclusions. Zero unknown inputs become
  assumed absent. Review identifies an actionable, unknown-by-default next
  contract without claiming a real invocation has been observed.
- **Pivot:** If code cannot support a row, mark it unavailable and retain
  `reviewed-source-registry-required`. Do not invent a caller assertion as
  authority or change production admission.
- **Anchor:** `rust/src/snapshot.rs`, `rust/src/lib.rs`, `rust/src/discovery.rs`,
  `docs/plans/rust-root-namespace-shadow-prediction.md`, and Basili et al. (1994),
  Goal Question Metric.
