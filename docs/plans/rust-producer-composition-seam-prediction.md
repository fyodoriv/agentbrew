# Test-only producer composition seam prediction

Register before implementation or execution. The existing composition rejects
an inspected producer whose path is also a parsed host module; it has no Rust
native coverage comparator. Frozen N15 and N18 therefore remain unqualified.

- **Hypothesis:** A bounded, per-invocation test-only producer value can reach
  the existing private composition path and exercise its host-path conflict
  without changing the no-injection discovery or validation reports.
- **Measurement:** Run the exact new test, retained discovery baseline and
  non-test library check from the repository root:

  ```sh
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_producer_composition::synthetic_host_conflict -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_discovery_syntax::observes_real_discovery_sources -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo check --locked --offline --manifest-path rust/Cargo.toml --lib
  ```

- **Success:** Each exact selector runs one test with no failures or skips.
  One synthetic independently specified producer on an actually parsed host
  path produces `reviewed-native-contradiction` at that exact path and no
  injected event. One existing non-host source path admits its synthetic event
  into the real composition; that source is in the current worklist. At least
  four controls cover wrong or absent source, mismatched site, failed
  inspection, and consecutive invocation isolation. Identify whether the
  inspector-failure fixture is real or a separately labeled error seam.
  No-injection C01/P01/N02a projections and full reports remain
  byte-identical to retained B0. A helper-level nonempty inspector result
  retains its original record when the synthetic record is appended and when
  input is rejected. Test the 2 MiB source boundary and the largest reachable
  combined text total at or below 65,536 and the smallest above it. Normal
  non-test compilation succeeds.
- **Pivot:** Stop if failed inspection is replaced, injected data can reach
  a normal invocation, an absent or mismatched source yields an event, a
  conflict is silently admitted, or no-injection reports change. Missing
  selectors, fixture setup or build failures are inconclusive.
- **Anchor:** `reviewed_producers::inspect`, `discover_inner` composition,
  the frozen corpus and Basili et al. (1994), Goal Question Metric.

The seam exists only under `cfg(test)`, takes a borrowed per-call value, has
no CLI, environment, file, or process-global input, and may be used only after
the actual inspector returns successfully. Append one validated test value to
the successful inspector result; preserve every inspected value. On inspector
error, preserve the error and inject nothing. It cannot change normal execution.
Before injection, the test-only seam checks source presence, regular mode,
bounded UTF-8, matching site path, range and UTF-8 boundaries, and an
independently expected source slice. These are seam checks, not properties of
the existing conflict loop. Test values are constructed from fixed
independent fixture bytes and explicit constants, never from ledger claims.
Bound supplied evidence to one record, its source to 2 MiB and retained text
to 65,536 bytes, including nested evidence strings and spans, before copying.
Invalid or unsupported data is inconclusive.
No source or worker is executed. This host-only seam is not proof of compiled
record inspection, Rust coverage, `native-fact-mismatch`, N15/N18 qualification,
or adapter and worker admission. Those require a separately reviewed real Rust
evidence and conflict path.

## Reviewed input shape

Use one borrowed fixed-shape test input: source path and independently supplied
complete bytes, call/output/body ranges, and expected literal values. The
builder fixes operation, API, labels, mode, empty environment inputs, call and
literal spellings and decoded values. It does not accept arbitrary recursive
`Evidence` or `Datum`. Before allocating
owned strings or vectors, verify the regular indexed source, UTF-8, full byte
equality, each ordered in-bounds character-boundary range and expected source
slice, and the aggregate size of every retained string and nested site. The
source must actually be in the current worklist. Test one parsed `.ts` path
for conflict and one non-host `.rs` worklist path for insertion; the latter
is synthetic composition, not a Rust writer witness. A separately labeled
pure synthetic inspector-error helper cannot claim the real inspector failed.
Independent review must check the actual implementation and all error paths
before accepting the controls.

## Focused result

The exact synthetic host conflict and non-host insertion control passed. The
seam checks refused invalid source/site and boundary cases; a labeled synthetic
inspector-error helper retained the error, and a nonempty successful result
retained its existing record. The retained discovery test, normal library check
and 28 workflow controls passed. Independent review checked the fixed input,
pre-copy bounds, preservation controls and exact hosted selector. This is not
evidence of a real inspector failure, Rust N15/N18 qualification or worker
admission.
