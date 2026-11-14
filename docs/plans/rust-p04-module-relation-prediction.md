# Test-only P04 module relation prediction

Register before implementation or execution. A standalone source sample's
`crate` label is not evidence of its actual module membership.

- **Hypothesis:** A deliberately narrow snapshot-only relation can derive
  frozen P04's `crate::emit` source path from its crate-root declaration and
  match the recorded lexical spans without changing discovery or validation.
- **Measurement:** From the repository root, run the new exact control and
  the retained discovery control, then check the normal library:

  ```sh
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_module_relation::frozen_p04_relation -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_discovery_syntax::observes_real_discovery_sources -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_discovery_syntax::observes_inline_modules -- --exact --test-threads=1
  heavy-run env CARGO_BUILD_JOBS=1 cargo check --locked --offline --manifest-path rust/Cargo.toml --lib
  ```

- **Success:** Each exact selector runs one test with no skips. P04's physical
  path, module, function, call and literal ranges match its frozen witness;
  mutated path, module and span fail comparison. At least eight controls make
  both candidates, neither, symlink, invalid UTF-8, root ambiguity, module
  attributes, duplicate declarations and unsupported nested/include/cycle
  shapes inconclusive, never an empty success. Test exact 2 MiB and one byte
  over for both root and selected source, identifier and site limits. For
  combined text, test 65,536 bytes and the smallest reachable over-limit
  relation, 65,540 bytes, before allocation of an additional returned site.
  Separately test the one-byte arithmetic boundary in the shared limit check.
  Existing P01–P03/P05 behavior, host observation and
  retained C01/P01/N02a reports remain unchanged; normal compilation succeeds.
- **Pivot:** Stop if an ambiguous or unsupported case produces an admitted
  relation, a frozen assertion or retained report changes, a limit is exceeded
  without refusal, or the registry-required diagnostic changes. A missing
  selector, setup or build failure is inconclusive, not a pass.
- **Anchor:** Frozen P04 in
  [the literal corpus](rust-literal-adapter-corpus-proposal-20261105.md),
  the test-only syntax sampler, and Basili et al. (1994), Goal Question Metric.

This test-only probe may examine only an indexed synthetic `src/lib.rs` root
and its two conventional candidates for one literal, un-attributed
out-of-line module. Admit exactly one regular UTF-8 candidate; do not follow
symlinks. Bound root and selected source to 2 MiB each and inspect at most two
candidate paths with no recursive traversal. Refuse identifier names over 256
bytes, returned sites over 256, or combined retained path and module text over
65,536 bytes. Refuse additional root items or
unsupported ownership constructs rather than inferring coverage. Derive the
logical name from the declaration, never from the expected witness. No ambient
filesystem, Cargo/compiler execution of analyzed source, worker, or production
acceptance is involved. This is a partial lexical relation, not proof of Cargo
root authority, full module resolution, standard-library identity, all writers,
or permission to admit a Rust adapter.
