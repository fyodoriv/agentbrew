# Rust namespace screen prediction

Registered before code on 2026-11-13. Exact writer syntax does not establish
that a path resolves to Rust's standard library. This test-only screen will
reject obvious namespace ambiguity; passing it is not authority or a coverage
decision. No discovery or validation result will change.

- **Hypothesis:** A conservative screen can admit the synthetic P01–P03
  contexts while refusing the six frozen N04 namespace cases and selected
  shadowing, macro and configuration mutations.
- **Measurement:** Run `JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_namespace_screen::frozen_namespace_controls -- --exact --test-threads=1`. Independently hash the frozen source and manifest bytes, including the N04f dependency alias. Test P01–P03 and N04a–N04f, and plant local `std`, macro, conditional attribute, missing edition, workspace inheritance and dependency-table variants. Exercise each input at its byte limit and one byte above, plus invalid UTF-8 and malformed TOML and Rust; all invalid cases must refuse. Apply each planted mutation to a passing baseline and assert its unchanged paired control passes. Repeat the legacy observer test and normal non-test build.
- **Success:** Exactly one selected test passes; 3/3 intended baseline
  contexts pass the screen, 6/6 frozen namespace cases and all six planted
  ambiguity controls refuse, with zero unexpected passes. The existing legacy
  projections remain equal.
- **Pivot:** Any unexpected admission or refusal, unbounded input, parser
  failure interpreted as acceptance, or change to discovery stops the method.
  Do not use the screen as semantic authority. Register a correction before
  another result.
- **Anchor:** `rust-literal-adapter-registration-proposal-20261105.md`, frozen
  P01–P03 and N04, `rust-syntax-slice-prediction.md`, Basili et al. 1994
  (GQM), and Munafò et al. 2017 (preregistration).

The screen takes only in-memory synthetic manifest and source bytes. It runs
no program, compiler, Cargo or filesystem operation on analyzed input. The
source and manifest each have a 2,097,152-byte limit; invalid UTF-8 and parse
errors refuse. Its output is deliberately insufficient to establish std
authority: nested module/include contexts, macros, attributes, aliases,
Cargo workspace/dependency resolution and all other frozen cases remain
separate obligations. An empty or passing screen is never permission to emit
a writer or suppress a diagnostic. Parser state has one invocation scope.

## Result (2026-11-13)

The exact test passed: 1 passed, 0 failed, 158 filtered. Three frozen
baselines passed; six frozen cases and six paired mutations refused. Both
input limits, malformed inputs and invalid UTF-8 were checked. The existing
observer and normal non-test library checks also passed. Independent review
confirmed the test-only scope and controls. The hosted guard selects the exact
test. This screen is not a complete Cargo or Rust namespace validator and
does not qualify writer authority. Its input limits do not bound parser
memory or time.
