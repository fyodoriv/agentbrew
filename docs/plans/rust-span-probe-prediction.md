# Rust span probe prediction

Registered before adding or running the probe on 2026-11-13. The frozen P03
case includes a UTF-8 byte-order mark, CRLF, multibyte text and a raw string.
The adapter proposal requires exact original byte offsets. A parser-only check
can test this prerequisite without claiming a discovered writer or a safe
namespace.

- **Hypothesis:** With the already locked `proc-macro2` 1.0.107 exposed as a
  dev dependency with `span-locations`, replacing the three BOM bytes with
  three spaces keeps Syn token byte ranges aligned with the original P03
  source. The function start and full function range, complete writer-call range,
  and two literal ranges match the independently frozen witnesses.
- **Measurement:** Run exactly `JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_span_probe::p03_original_byte_ranges -- --exact --test-threads=1` after adding only this selected probe. Check original fixture bytes and their recorded hash before replacement.
  Compare full original source slices, token/delimiter-derived call and
  function ranges, and decoded literals against frozen P03 data; check a
  planted shifted range is rejected by the same comparator. Confirm the
  existing Syn features expose every used API. Keep the corpus unchanged.
- **Success:** One selected test passes, all four ranges, the function-start offset, and both literal values
  match, the shifted offset fails the comparator, and no locked package identity
  or checksum changes. The lockfile may add the root dependency edge only;
  inspect that minimal delta before the locked run. A normal non-test library
  build must also pass.
- **Pivot:** Any parse error, shifted or unavailable span, checksum change,
  wrong decoded value, or unmatched selected test makes the technique
  inconclusive. Do not integrate it into discovery until a corrected method is
  separately registered and reviewed.
- **Anchor:** `rust-literal-adapter-registration-proposal-20261105.md`, frozen
  corpus P03, `proc-macro2` 1.0.107 `Span::byte_range` source contract, Basili
  et al. 1994 (GQM), and Munafò et al. 2017 (preregistration).

This probe parses synthetic fixture bytes only. It does not execute them,
establish namespace or module authority, qualify the six Rust positives,
change discovery or validation, run the worker, or establish general Unicode and CRLF handling or the other frozen cases. Test data and parser state have one test-invocation scope.

## Result (2026-11-13)

The exact selected probe passed: 1 passed, 0 failed, 156 filtered. The normal
non-test library check passed. The existing observer test passed again with the
new test dependency, and the workflow guard passed 28 cases. The lockfile changed only by adding the root
dependency edge; no package identity or checksum changed. Independent review
checked the frozen-byte comparisons before execution. The hosted compile guard
selects this same one test for continued verification. This is one synthetic
parser fixture, not qualification of Rust discovery, namespace authority, the
worker, or the remaining corpus.
