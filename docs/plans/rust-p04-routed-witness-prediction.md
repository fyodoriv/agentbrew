# Narrow P04 routed witness prediction

Register before implementation or execution. The broader
[discovery join](rust-p04-discovery-join-prediction.md) pivoted because its
negative routing fixtures were not demonstrated.

- **Hypothesis:** The final admitted discovery round visits both P04 physical
  buffers, and a test-only comparison to independently retained expected
  bytes can bind those visits to the existing partial lexical relation.
- **Measurement:** From the repository root, run the new exact control and
  the retained discovery and relation controls, then the non-test library:

  ```sh
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_discovery_syntax::witnesses_p04_routed_buffers -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_discovery_syntax::observes_real_discovery_sources -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_module_relation::frozen_p04_relation -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo check --locked --offline --manifest-path rust/Cargo.toml --lib
  ```

- **Success:** Each selector runs one test without skips or failures. Frozen
  P04 records both actual physical visits and matches its path, module and
  byte-range witness. Separate expected copies with one changed root or module
  byte yield inconclusive, as does whole-join source-count refusal after
  reusing a previously successful observer. Use a test-only initial-limit
  seam and report it as such. Wrong
  witness path/module/span fails comparison. A real host-promotion fixture
  shows a source-closure restart and a final-round P04 match, without claiming
  a discriminating stale-only P04 fixture. Observed and unobserved discovery
  and validation match retained B0 controls; normal library compilation passes.
- **Pivot:** Stop if either P04 visit is absent, any mismatched expectation or
  refused source-count case yields a match, a duplicate/overflow is accepted,
  a retained report or registry-required diagnostic changes, or the real
  restart is not observed. Missing selectors and setup failures are
  inconclusive. Do not substitute synthetic observer events for routing.
- **Anchor:** The prior pivot, frozen P04 corpus and discovery observer;
  Basili et al. (1994), Goal Question Metric.

The comparison uses independently retained expected bytes, not a claim that
discovery transforms them. Any test-only expected copy is at most 2 MiB per
source, checked before copying; the join retains no raw source. Bind the
relation and both comparisons to the same independently retained expected
snapshot. Bound total retained path/module text
to 65,536 bytes and sites to 256 before allocating additional join state.
Duplicate, generated, mismatched, missing, unsupported and overflow states are
inconclusive; direct helper tests of these states must be labeled as such.
Reset evidence per source-closure round, not per host-graph pass. Keep the
join and its state behind `cfg(test)` and out of discovery decisions. This is
a partial lexical and routing witness only. It does not prove Cargo root or
module authority, standard-library identity, full coverage, a stale-only
restart case, or worker/adapter admission.

## Reviewed implementation boundary

Derive the target from the successful relation on the same expected snapshot,
not from the frozen witness. Refuse a root/target alias, differing relation
paths, invalid entry modes or key/path identities, and inputs over 2 MiB.
Pass the expected snapshot by immutable borrow to the test-only route; compare
source bytes directly there and retain only bounded flags and round count.
Publish only final-round evidence. A source-worklist or parser limit, early
return, exhausted loop, duplicate, generated selected source or mismatch is
inconclusive even if an existing observer's completion flag was set. Review
the actual boundary wiring before accepting a result.
