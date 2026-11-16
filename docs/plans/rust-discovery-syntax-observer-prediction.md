# Rust discovery syntax observation prediction

Registered before implementation on 2026-11-13. The test-only syntax sampler
recognizes a narrow source shape, but has not received actual discovery input.
This one bridge checks that wiring. It is not a production adapter, namespace
authority, a coverage decision or qualification of a frozen Rust positive.

- **Hypothesis:** Per-invocation test observation can record bounded Rust
  syntax sites from discovery's real physical-source worklist and preserve
  every existing discovery and validation field.
- **Measurement:** Run `JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_discovery_syntax::observes_real_discovery_sources -- --exact --test-threads=1` and repeat the exact existing syntax sampler and legacy observer tests. Compare real discovery input paths, owner/call/literal spans with frozen P01–P03 data; plant a wrong path and shifted range. Exercise observer absence, reuse, a source-closure restart, malformed and oversized input, generated-body refusal, record-count overflow, and retained-path-byte overflow. Compare complete B0 discovery and report projections with observation both off and on. Compile a normal non-test library build.
- **Success:** Each of the three selected tests executes once and passes;
  four frozen writer occurrences have matching physical-source syntax
  observations. Wrong or shifted witnesses fail; unqualified, generated,
  malformed, oversized or overflowing traces never count as complete. The
  C01/P01/N02a complete legacy projections and input metadata remain equal
  to retained B0. Host observations remain unchanged, and observer reuse has
  no earlier invocation or discarded closure-round records.
- **Pivot:** Any changed legacy field, fabricated witness, unbounded
  collection, partial trace presented as complete, stale round, test-build
  panic or mismatch stops this method. Preserve frozen input and expected
  results; register a correction before another semantic result.
- **Anchor:** `rust-discovery-observer-prediction.md`,
  `rust-syntax-slice-prediction.md`, the frozen P01–P03 corpus, Basili et al.
  1994 (GQM), and Munafò et al. 2017 (preregistration).

The sampler must stop collecting before more than 256 syntax records are
allocated and return an inconclusive result on overflow. The Rust observer
retains at most 256 total records and 65,536 path bytes across its invocation;
overflow or unknown source status invalidates its trace without changing the
legacy result. No literal body text is retained in the observer. Trace state
belongs to one discovery invocation and only the final closure round survives.
Graph-pass resets of host observations must not erase Rust observations.
The sampler currently cannot distinguish unsupported valid syntax from no
matching site. Add an explicit closed qualification status; never infer a
complete trace from an empty result. Invalid UTF-8 Rust entries skipped during
root collection and Rust sources rejected by the earlier source-size gate
must mark the trace inconclusive. The B0 N02a result remains comparable but
its Rust trace is inconclusive. Generated Rust bodies are explicitly
unqualified until their physical/body projection is proven. Parse errors and unsupported paths cannot suppress the
existing registry-required diagnostic. No source, worker, filesystem reader,
or process signal runs. The old manual N02b job stays pinned to its earlier
harness and must not be rerun or silently repinned for this revision. Input
and record caps do not establish parser memory or wall-time bounds.

For this bridge, even a syntactically matching source produces only a partial
sample. The observer does not offer a complete Rust trace. A separate explicit
invalid state hides partial records after parse, limit, generated-source or
overflow failures. This avoids claiming completeness for source forms the
sampler skips. Matching P01–P03 records are partial observations only.

## Result (2026-11-13)

The exact discovery observation, sampler and legacy observer tests each passed
with zero failures. The observation test was repeated after adding the
unsupported-syntax control; its latest run selected one test. The normal non-test library check passed. Complete
C01/P01/N02a projections and input metadata matched the retained B0 hashes.
Independent review verified the baseline envelopes and bounded wiring. The
generated-source and overflow controls exercise the shared observer method;
they do not establish end-to-end generated-source routing. The hosted guard
selects the exact test; the workflow guard passed 28 cases. These are partial test-only syntax samples, not native
writer authority, Rust coverage, worker qualification or a performance result.
