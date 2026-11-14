# Test-only inline-module observation prediction

Register before changing or running the observer. The current observer emits
partial top-level samples and does not establish Rust writer authority.

- **Hypothesis:** A bounded syntax walk can attach lexical inline-module names
  to sampled function and call spans, including frozen P05, without changing
  discovery or validation results.
- **Measurement:** Run each command from the repository root:

  ```sh
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_discovery_syntax::observes_inline_modules -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_discovery_syntax::observes_real_discovery_sources -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_syntax_slice::frozen_syntax_controls -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo check --locked --offline --manifest-path rust/Cargo.toml --lib
  ```

  Run the existing hosted workflow guard on the changed workflow if needed.
- **Success:** Each exact test selects one test and passes. Frozen P05 matches
  its independently recorded physical path, `crate::inner`, owner, call and
  literal byte ranges. Root controls P01–P03 remain correct. At least two
  synthetic controls distinguish nested modules and same-named functions in
  different modules. Wrong module, path and shifted ranges fail comparison.
  Controls cover BOM/CRLF, malformed source, generated input, reuse and
  restart, record overflow, and exact-limit and one-over nesting, module-name
  and retained-module-byte limits. Complete
  C01, P01 and N02a projections and reports stay byte-identical to the
  existing retained baseline; normal non-test library compilation succeeds.
- **Pivot:** Stop if any admitted byte range or retained report differs, a
  limit is crossed without an explicit incomplete result, an unsupported
  construct is presented as complete, or the observer changes the existing
  registry-required diagnostic. A setup or build failure is inconclusive.
- **Anchor:** Frozen P05 in
  [the Rust literal corpus](rust-literal-adapter-corpus-proposal-20261105.md),
  existing `rust_discovery_syntax` and `rust_syntax_slice` tests, and Basili,
  Caldiera and Rombach (1994), Goal Question Metric.

Only inline modules with literal identifiers and no module attributes are in
the proposed sample. Out-of-line modules, attributes, macro expansion,
`include!`, nested functions and other unsupported ownership are not covered.
Samples are always partial; an empty sample is not evidence of absence. Cap
inline depth at 16, each identifier at 256 bytes, and aggregate retained module
text across the entire observer invocation at 65,536 bytes. Test the aggregate
at exactly the limit and one byte over. Exceeding any cap invalidates the whole
partial trace and makes it explicitly inconclusive. Keep the existing 256-record
and 65,536 path-byte limits, and check limits before cloning or appending
records. The source parser's existing
input bound still applies. Preserve original byte offsets. Reset on a new
source-closure round, while retaining samples across host-graph passes inside
that round. The result is lexical,
not proof of crate resolution, standard-library identity, coverage, or safe
writer admission. It adds no production acceptance, worker, source execution,
or physical process control.

## Focused result

The three exact selected tests passed once each after the comparator correction,
and the normal library check passed. The P05 record matched its frozen lexical
module and byte witnesses. Independent review identified a missing wrong-module
comparison; the corrected shared comparator rejects that mutation. The limits
bound retained samples, not the parser's temporary memory or total source
coverage. Hosted verification remains separate.
The hosted guard's exact-script pin rejected the added command until updated;
after that correction its 28 focused controls passed. Independent review found
no actionable issue in the added exact selection or the guard's failure checks.
