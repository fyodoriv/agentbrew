# Rust discovery observer prediction

The six frozen Rust positives require an actual function and module witness.
The current test harness deliberately reports that witness as unqualified;
it cannot be replaced by an inferred or fabricated value. The retained B0
capture contains complete legacy discovery and validation output for C01,
P01 and N02a before an observer existed.

- **Hypothesis:** A test-only, per-discovery observer can retain actual native
  observations without changing the production API or the three complete
  legacy reports. It will provide a reviewed path for later Rust owner and
  module evidence, but will not claim Rust support on its own.
- **Measurement:** Add one exact observer test under the existing frozen
  harness and run:

  ```sh
  CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::rust_observer_tests::observer_preserves_legacy -- --exact --nocapture --test-threads=1
  ```

  Compare the full C01, P01 and N02a legacy projection to the retained B0
  bytes and verify observations against the independent frozen witnesses.
- **Success:** Exactly one selected test passes; observer-disabled and enabled
  runs each match the independently retained 3,328-byte B0 capture and frozen
  input metadata. C01's actual TypeScript native call has its frozen path and
  byte range, and P01/N02a produce no invented Rust owner or module witness.
  At least six controls prove an absent observer yields no records, empty input
  yields none, enabled observation reaches the hook, a planted wrong path or
  range fails the real comparator, closure restart discards old records, and
  bounded-buffer overflow is inconclusive.
- **Pivot:** Stop if observation changes a legacy field, emits a Rust owner
  not produced by actual analysis, needs a process-global override, or cannot
  share the production discovery path. Do not alter frozen source, expected
  receipts or the unqualified markers to obtain a pass.
- **Anchor:** `rust-legacy-baseline-capture-20261106.md`, frozen corpus
  `rust-literal-adapter-corpus-proposal-20261105.md`, and the Rust literal
  registration's per-invocation trace boundary.

Observer state belongs to one discovery invocation and ends when it returns.
It is compiled only for tests and has no CLI, environment, file or public
runtime input. It must observe the real native analysis boundary, not a copy
of expected fixture data. The later Rust adapter must supply its own real
function and module facts through that boundary. Emit at the actual native
analysis boundary after source/body projection, with explicit origin so a
reviewed producer cannot impersonate parser output. Discovery can restart
source closure after a promotion; observations from discarded rounds must not
be reported as final. Include a planted restart control and compare the final
observation set, not a cumulative trace. Cap test-observer storage at 256
records and 65,536 total bytes of recorded path, body and API text; overflow
makes its evidence inconclusive without changing the legacy report. An
overflow fixture must compare the full observed and unobserved outputs.
Within a closure round, retain only the last graph pass, not earlier passes
over a smaller module set. A synthetic generated-body case must prove at
least two actual graph passes; a planted sequence through the same reset seam
must prove a first-pass-only record is discarded. Compare complete observed
and unobserved reports for both record-count and text-byte overflow. Use only
synthetic inputs. Review the cfg-only wiring and unchanged
public signature, and compile a normal non-test build. No source program, worker or
process signal is run. Normal test compilation may run dependency build
scripts. Passing this preparation does not qualify the six Rust positives,
the 50 negatives, the worker, or the full inventory.

This first observer covers host-graph parser events only. It does not claim to
observe shell or Rust analysis, and it excludes reviewed-producer injection.
To reuse the B0 projector, only the visibility of its discovery, report,
input-metadata and canonicalization helpers may become `pub(super)` in test
code. Their logic and the original capture test remain unchanged; review that
diff and repeat the retained-byte comparison before accepting the observer.
