# Rust literal syntax slice prediction

Registered before implementation on 2026-11-13. The P03 span probe established
one parser fixture, not writer authority. This slice prepares a bounded parser
that can report syntax observed in a source buffer. It does not change
discovery, validation, source coverage, or acceptance.

- **Hypothesis:** A narrow internal parser can identify the exact function and
  `::std::fs::write` call syntax and literal spans in frozen P01, P02 and P03
  without treating matching text in comments or strings as a call.
- **Measurement:** Add one exact test and run `JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_syntax_slice::frozen_syntax_controls -- --exact --test-threads=1`. It binds the original fixture bytes and corpus hash before parsing, compares each extracted function-owner range, site and literal value/range against the frozen native witnesses (including P03 original BOM offsets), tests comment and raw-string decoys, checks the 2,097,152-byte source limit at the boundary and one byte over, verifies malformed and over-limit input return closed refusals with no partial observations, and checks one shifted site fails the same comparator. Run the existing observer test and normal non-test library check too.
- **Success:** Exactly 1 selected test passes; all four frozen P01/P02/P03
  writer occurrences match independently frozen site, function and literal
  values and ranges; both decoys produce zero occurrences; the exact-limit input is accepted for parsing and malformed or one-byte-over input are closed refusals with no observations; the shifted witness is rejected.
  Existing full legacy projections remain identical. No locked dependency
  identity or checksum changes.
- **Pivot:** Any mismatch, missed source limit, parser panic, ambiguous owner,
  or wrong selected count stops this technique before discovery integration.
  Preserve the original assertions; register a corrected method before another
  result.
- **Anchor:** `rust-literal-adapter-registration-proposal-20261105.md`, frozen
  P01–P03 and N15 controls, `rust-span-probe-prediction.md`, Basili et al.
  1994 (GQM), and Munafò et al. 2017 (preregistration).

The parser is test-only at this stage. It accepts in-memory synthetic text,
never executes it, performs no filesystem or process access, and records only
syntactic observations. An unqualified or unsupported expression cannot be
used as semantic proof of std authority, coverage, module resolution, or an
accepted writer. C02, N04, N18 and all other frozen negative and resource
cases remain open. Source and AST state have one parse invocation scope.
