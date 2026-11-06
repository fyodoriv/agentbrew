# Rust legacy discovery baseline capture

Prospective instrumentation preparation, Nov 6, 2026. Commit this prediction
before adding or executing the exporter. This is not a product fix, observer
qualification, passing Rust corpus, completed inventory or measured migration.

## Scope and current evidence

Source HEAD is b5f69ebe9435a3daa90af5284121190a2ef97fda. Unchanged Rust discovery
fails all six frozen Rust positive cases on missing call facts; C01 passes.
Existing logs omit complete legacy output and cannot prove later instrumentation
preserves it. Original 6-positive/50-negative/2-control corpus SHA256 is
`b500bf9c8ade0e5cbe7dc70e26c2ef019e5d230da04576af198fc018bf2dd527`.
Reviewed test-only loader SHA256 is
`8260ef71dec3133c2746a8151990395337b005daae8635bdd6c20d26cedf22c0`.
Preserve original case functions, assertions, markers, corpus, Cargo files and
product code.

Only add `rust/src/rust_legacy_baseline_tests.rs` and its nested module declaration
at the end of rust_family_tests.rs. The parent remains cfg(test). Reuse its private
materialize function; do not expose a loader publicly. The sole test
capture_legacy_fields materializes exactly C01, P01, N02a in that order. No other
case is run or materialized, especially the quadratic N02b source-count case.
No source program, worker, Git command or filesystem snapshot reader runs.

## Prediction and measurement

GQM goal: establish complete independent pre-observer output for exact comparison.
Question: can unchanged discover and validate produce three complete lossless
legacy records without product or original harness semantic changes? Missing
baseline records are currently three. Predict three to zero after capture;
zero omitted fields, reordered native vectors, altered inputs or product changes.

Exact command after exporter review:

```sh
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_legacy_baseline_tests::capture_legacy_fields -- --exact --nocapture --test-threads=1
```

Use the qualified Rust toolchain and one-worker settings from Stage A/B. Run once
as a descriptive capture, not RED/GREEN or a gate retry. Select exactly one test.
Per input: public discover(&snapshot), project that Discovery by immutable borrow,
then pass the SAME Discovery to public validate(&snapshot, "rust/inventory.json",
&manifest, discovery). Project its complete CheckReport. Emit one
LEGACY_BASELINE_JSON= line containing the ordered three input IDs and records.
Each record has exactly discovery and report. Assert selection and projection
completeness, not predicted product behavior. P01 may retain missing-call diagnostics.

Root preserves raw log, actual exit/count, selected input manifest/source hashes,
all tracked Rust source/Cargo hashes, exporter/loader hashes and tool versions.
Extract the one prefixed object into compact recursively key-sorted UTF-8 JSON
plus LF. Preserve array order and duplicates. Freeze these bytes/hash before any
observer candidate exists. No expected baseline bytes/hash is invented here.
Pause for review after capture.

Success: actual exit zero; one selected test; three ordered complete records;
missing baseline records zero; zero omitted field or changed product, source
input, original case assertion or dependency. A compiler/setup/extraction failure,
missing/duplicate output, wrong selection or incomplete projection leaves B0
unqualified. Pivot on any such result: preserve failure and review capture before
another admission. Never modify original behavior/oracles or call a setup error
a Rust semantic result.

Anchors: Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al.
(2017), preregistration; actual Discovery, CheckReport and nested source types.

## Projection version 1

Every manually projected struct uses exhaustive destructuring without `..`.
Every manually projected enum uses exhaustive matches. Added source fields must
cause a compiler error. Already-Serialize types may use their actual serialization,
preserving existing tag spelling and skip-none behavior. No Debug/display values,
normalization, truncation, array sorting, deduplication or candidate-derived oracle.

- Discovery: upstream, facts, diagnostics, boundaries, programs, required_targets,
  registry_edges, package_entries, package_programs, reviewed_sources,
  reviewed_producers.
- Fact: id/path/language/form/start/end/parent. Boundary: id/site/form/bodies/
  receipts/targets. Body: form/language/value. RequiredTarget: explicit
  Owned/Inline/External/Input/Output variant and lossless payload.
- ProgramEvidence: path/git_blob/language/owner/migration_slice/program/entry/
  data_regions. DataEvidence: id/source/callee/spelling/identity/kind/inputs/
  outputs/consumer. DataKind labels: DataFileRead/ParseData/DataOutput.
- Reviewed producer Evidence: full Event (site/operation/api/arguments/owner),
  owner/migration_slice/environment_inputs/executable_mode. Package Entry: id/target.
- Upstream Evidence: files/consumer/facts/edges. Ownership labels:
  Upstream/MixedCode/OwnedCode/OwnedData. Consumer: dependency/call/owned_include/
  conditions/library/build_script/owned_source.
- CheckReport: schema_version/checked_files/classified_components/checked_edges/
  unresolved_frozen/diagnostics. Diagnostic: code/path/transport.

Option policy: manual Site always includes body, including explicit JSON null.
Manual Diagnostic always includes transport, including null; present Unix
TransportContext uses actual serde spelling/skip-none semantics. Datum and
Operation use existing serde directly; a Site nested inside Datum thus follows
existing serde skip-none body behavior. CallReceipt uses manual Site, actual
Operation serialization and actual Datum serialization for every argument.
Use the same policy for every record and later comparison. This test projection
is not the public JSON wire format.

Only three synthetic snapshots exist in test-invocation memory. Projection state
and buffers belong to that invocation and end on test exit. Preserve source
mode/content and manifest values. No source execution, credentials, private
snapshots or owner data enter this exporter. Keep captured synthetic data local.

## Estimate and continuation

Active low/likely/high: 20/35/60 minutes for exporter, independent field review and
capture. Capture elapsed estimate is under one minute after compilation. A setup
correction needs separately reviewed admission rather than silent retry. Compare
actual elapsed with this estimate after capture.

B0 enables separately registered observer preparation with unchanged legacy-byte
comparison. It does not authorize the Rust adapter, marker removal, N18 producer
seam, N02b resource experiment, seven byte cases or all-family execution. Broader
task acceptance remains open.
