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

## Source audit

This source-only audit describes the draft implementation at revision `144008f2`;
it is not a claim that a Cargo invocation was observed or that the worker is
safe to run. All unavailable fields remain unknown, not absent.

| Required input | Current producer and trust boundary | Gap or refusal |
| --- | --- | --- |
| Repository snapshot and source bytes | `rust/src/snapshot.rs` defines entries with path, mode, blob and bytes, plus untracked paths and ignored metadata. `HeldRoot::open` holds a selected directory; `read_held` checks working bytes against Git objects and rechecks the index and path lists. This trusts the selected root, Git metadata adapter and bounded observation. | These boundary checks do not prove continuous identity between observations or completeness beyond the adapter's contract. Ignored payloads are not read. |
| Invocation directory and selected Cargo manifest | `rust/src/lib.rs::check_repository` receives a root and an inventory manifest path, reads that entry and passes the snapshot to discovery and validation. | The inventory manifest path is not an observed Cargo manifest selection. No actual or hypothetical Cargo invocation directory and manifest binding is carried in `Snapshot`. |
| Cargo configuration, environment, flags and wrappers | Tracked repository files may appear as snapshot entries; untracked and ignored paths are listed as described above. The test-only root shadow refuses two exact root Cargo config names in either compared snapshot. | No effective ancestor or Cargo-home configuration, CLI overrides, environment flags or wrapper identity is captured. Presence in a snapshot alone does not establish effective selection. |
| Compiler, sysroot, target and standard library | `Snapshot` has only entries, untracked and ignored metadata; the `check_repository` handoff provides no compiler context. | These identities and the binding to an invocation are unavailable. A manifest edition or a synthetic assumption cannot establish them. |
| Build scripts and namespace exclusions | The test-only shadow refuses a tracked root `build.rs` and unknown untracked/ignored lists; reviewed-source handling in `rust/src/discovery.rs` emits `reviewed-source-registry-required` for unsupported source lacking a reviewed record. | Snapshot-relative exclusions do not prove all effective build scripts, aliases or namespace resolution. Unsupported Rust remains registry-required; the shadow is not semantic authority. |

A next contract needs a named, independently reviewed provider that binds a
specific source snapshot to the invocation and toolchain facts it actually
observes, states its trust and lifetime limits, and makes missing or conflicting
facts unknown by default. A consumer must not accept a manifest claim or bare
caller boolean as authority. The frozen corpus in
`rust-literal-adapter-registration-proposal-20261105.md` intentionally uses
synthetic snapshots and forbids ambient lookups, discovery-time compiler runs
and a native worker; do not treat fixture results as proof of a real provider.
Design and independently review that bridge before adding production admission.
