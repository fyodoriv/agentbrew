# Cargo producer layout prediction

The hosted test assumes `release/deps`. Cargo documents a second internal
layout under `release/build/<package>/<unit>/out`. Hosted diagnostics show
the latter's parent exists, but do not yet prove the producer location.

- **Hypothesis:** Checking both bounded layouts against the actual built
  executable preserves the producer-tampering test across Cargo layouts.
- **Measurement:** Run focused synthetic layout controls and the two real
  macOS producer cases; run hosted CI on the changed revision.
- **Success:** At least eight controls cover both layouts, no match, wrong
  bytes, unexpected names, multiple matches, symlinks and excessive entries.
  The real producer case must find and overwrite at least one matching
  intermediate, then verify a rebuilt trusted executable. Both hosted OS
  gates pass; no missing or ambiguous producer is converted to a pass.
- **Pivot:** If the hosted producer cannot be identified by a contained,
  non-symlink path and matching bytes, retain the failing test. Do not infer
  the actual Cargo version or claim a root cause from directory names alone.
- **Anchor:** `src/source-build-capability.test.ts`, hosted run 43326712765,
  [Cargo build cache](https://github.com/rust-lang/cargo/blob/master/doc/book/src/reference/build-cache.md)
  and [Cargo layout source](https://doc.rust-lang.org/stable/nightly-rustc/src/cargo/compiler/layout.rs.html).
