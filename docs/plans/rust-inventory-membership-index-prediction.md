# Inventory membership index prediction

The Rust-family resource control N02b contains 100,001 source records. The
validator currently scans every component for each file when checking file
membership. At equal file and component counts this alone implies
10,000,200,001 path comparisons. That is a source-level count, not a measured
runtime. The full N02b control remains unqualified and must not run yet.

- **Hypothesis:** Building one per-validation membership index preserves the
  exact ordered diagnostics while replacing repeated full component scans with
  one component pass and indexed lookups.
- **Measurement:** Run focused synthetic comparison tests between the existing
  definition and the indexed result. Count visits for a fixed 2,000-file,
  2,000-component corpus. Run the relevant existing validator controls and
  hosted CI. Review every other N02b path before admitting that full case.
- **Success:** At least eight planted controls cover matching and mismatching
  membership, duplicate component IDs, duplicate listed IDs, absent and empty
  paths, invalid paths, duplicate IDs across paths, repeated file records,
  and diagnostic order. The two definitions
  agree exactly in every control. The fixed corpus falls from 4,000,000
  component visits to 2,000 index insertions and 2,000 file lookups; no mutable
  state survives the validation invocation.
- **Pivot:** Stop if output order, duplicate handling, error classification,
  or the resource bound changes. Do not call the full N02b case qualified from
  a membership-only improvement. A build or setup error is not a parity result.
- **Anchor:** `rust/src/validation.rs` membership loop,
  `rust-literal-staged-measurement-proposal-20261105.md` N02b restriction,
  and Basili, Caldiera and Rombach (1994), Goal Question Metric.

An index may hold references to the current manifest only. It must preserve
set semantics for duplicate component IDs and the existing duplicate-listed-ID
check. Compare error sequence as well as decisions. Additional quadratic work,
memory costs and resource limits must be reviewed independently before the
original 100,001-record control is attempted. No worker or analyzed source
program runs in this preparation.

## Focused result

The two index controls passed. On the fixed synthetic corpus, they counted
4,000,000 old component visits, 2,000 index insertions and 2,000 file lookups.
Those counts do not measure tree comparisons, allocations or wall time.
The complete legacy output for C01, P01 and N02a also matched the previously
captured 3,328-byte record exactly. This is full-report parity for those three
fixtures, not qualification of N02b or the full corpus.

## Remaining resource boundary

Source inspection found another cost: discovery constructs facts and drains
the initial source queue before checking `SOURCE_COUNT`. The N02b fixture has
100,001 Rust sources, so the check does not prevent that initial work. The
current validator also has edge and registry searches whose cost depends on
fixture shape. An early refusal could change retained facts and diagnostics;
it needs a separate prediction and exact behavior review. Do not run N02b or
claim bounded whole-checker resources from the membership index alone.
