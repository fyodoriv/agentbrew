# Oversized source-set witness prediction

The first early-refusal attempt failed the frozen N02b oracle: the test requires
100,001 program records as well as a `source-worklist-limit` diagnostic. That
attempt was reverted without running N02b. This is a new prediction, before
implementing the replacement or running the large case.

- **Hypothesis:** Building the initial root facts and program records, then
  refusing an oversized initial set before draining its queue, preserves the
  frozen source-count witness without parsing that oversized queue.
- **Measurement:** Run isolated small-limit controls and compare the retained
  C01, P01 and N02a reports. After independent resource and workflow review,
  run the exact frozen N02b test in a disposable hosted Linux job:

  ```sh
  CARGO_BUILD_JOBS=1 cargo +1.97.0 test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::n02b -- --exact --test-threads=1
  ```

- **Success:** At least eight focused controls cover empty, below, exact and
  over-limit inputs, prior evidence, initial registry promotion, later
  promotion and the final non-clean report. At a small limit, all initial
  program and fact mappings, including collision precedence, match the old
  initial construction exactly, and no source-closure parsing begins above it.
  Admitted reports and the three retained reports match exactly. Hosted N02b
  selects exactly one test, passes its unchanged 100,001-program assertion
  and required `source-worklist-limit` witness, and exits within 30 minutes.
- **Pivot:** Stop if the diagnostic can be lost, any frozen assertion changes,
  an admitted report differs, or closure parsing begins above the limit. A
  timeout, OOM, missing job, changed fixture or setup failure is inconclusive;
  inspect it before any retry. No local N02b run is authorized by this plan.
- **Anchor:** Frozen `rust_family_tests::n02b` and its corpus, the prior
  [pivot](rust-inventory-initial-source-limit-prediction.md), and Basili,
  Caldiera and Rombach (1994), Goal Question Metric.

## Boundaries

Preserve prior upstream, registry and package evidence. The limit check applies
once to initial roots after their program facts are constructed; later
promotions retain the existing path. Above the limit, later source diagnostics
are incomplete and must not be interpreted as a complete audit. The limit does
not bound snapshot construction, initial collection, the required fact maps,
or manifest validation. Review those allocations and remaining loops before
admitting N02b. The hosted job uses only frozen synthetic data and runs no
worker, analyzed source, or process signal. Cargo compilation may run normal
dependency build scripts. The test runner, CI isolation and job timeout are
explicit trust boundaries, not proof of a general memory or time bound.
The N02b test asserts the discovery program count, not independent materialized
entry count. Do not call that count a complete input receipt. Before admission,
review peak coexistence of expanded manifest and entry JSON, self-description,
snapshot, roots, fact/program maps, validator indexes and diagnostics, plus
case-specific loops. Pin the frozen corpus and tested revision. The hosted job
must require exact one-test selection, no skip, read-only credentials and
pipefail. Diagnose timeout or OOM before any retry.
