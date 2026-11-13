# Initial inventory source-limit prediction

Discovery checks `SOURCE_COUNT` after it drains the initial source queue. The
frozen N02b case starts with 100,001 Rust sources. A membership index removes
one repeated scan, but it does not prevent that queue from being processed.

- **Hypothesis:** Refusing an oversized initial root set before constructing
  source facts or draining the queue limits that particular work, preserves
  behavior at or below the threshold, and cannot produce a clean report.
- **Measurement:** Run isolated discovery and validation controls with a
  test-scoped limit of two. Compare complete retained reports below the limit;
  test exactly two and three initial roots. Run the existing legacy report
  comparison and hosted CI. Do not run the original 100,001-source case until
  its whole-checker resource and output obligations are separately reviewed.
- **Success:** The limit and below-limit controls preserve full reports; the
  three-root case produces `source-worklist-limit`, zero closure-generated
  root/program facts, and a non-clean validation report. At least eight
  controls cover an empty set, exact limit, one over, unsupported source,
  prior diagnostic, prior upstream fact, initial collection promotion and
  later closure promotion. Production continues to use 100,000; no process or source
  program runs in the controls.
- **Pivot:** Stop if refusal can yield a clean report, if the limit or smaller
  cases change, or if partial facts appear without an explicit incomplete
  diagnostic. Do not claim whole-checker time, memory or N02b qualification.
- **Anchor:** `rust/src/discovery.rs`,
  `rust-inventory-membership-index-prediction.md`, frozen N02b, and Basili,
  Caldiera and Rombach (1994), Goal Question Metric.

Focused command, registered before its first result:

```sh
CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --offline --manifest-path rust/Cargo.toml --lib discovery::tests::initial_limit_ -- --test-threads=1
```

The check would run after existing initial source and package/registry
collection and before the first source-closure round. It is not a bound on
snapshot construction, the collection phase, or validation. Above the limit,
it intentionally omits facts and later per-source diagnostics: the explicit
incomplete diagnostic must remain in the final report. Preserve facts and
other evidence already gathered by upstream and registry inspection. Check
initial roots once only; later closure promotions retain their current path.
A small test-only limit must
be an invocation argument, never a process-global setting or runtime option.
Compare unchanged behavior for admitted inputs and independently review the
meaning of the new incomplete report before any full resource run.

## Pivot: frozen source-count witness

The proposed refusal passed eight small controls and preserved three retained
reports, but source review found a conflicting frozen N02b assertion:
`rust/src/rust_family_tests.rs` requires 100,001 program records. The proposed
refusal creates none. The small controls therefore did not establish fidelity
to that resource oracle. The code and its hosted test additions were reverted;
N02b was not run. A later design must preserve the original witness and review
the work and memory needed to construct it. Do not weaken the frozen assertion.
