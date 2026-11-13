# Oversized source-set witness prediction

The first early-refusal attempt failed the frozen N02b oracle: the test requires
100,001 program records as well as a `source-worklist-limit` diagnostic. That
attempt was reverted without running N02b. This is a new prediction, before
implementing the replacement or running the large case.

- **Hypothesis:** Building the initial root facts and program records, then
  refusing an oversized initial set before draining its queue, preserves the
  frozen source-count witness without parsing that oversized queue.
- **Measurement:** Run isolated small-limit controls and compare the retained
  C01, P01 and N02a reports. After independent resource and workflow review,
  run the exact frozen N02b test in a disposable hosted Linux job:

  ```sh
  CARGO_BUILD_JOBS=1 cargo +1.97.0 test --locked --offline --manifest-path rust/Cargo.toml --lib rust_family_tests::n02b -- --exact --test-threads=1
  ```

- **Success:** At least eight focused controls cover empty, below, exact and
  over-limit inputs, prior evidence, initial registry promotion, later
  promotion and the final non-clean report. At a small limit, all initial
  program and fact mappings, including collision precedence, match the old
  initial construction exactly, and no source-closure parsing begins above it.
  Admitted reports and the three retained reports match exactly. Hosted N02b
  selects exactly one test, passes its unchanged 100,001-program assertion
  and required `source-worklist-limit` witness, and exits within 30 minutes.
- **Pivot:** Stop if the diagnostic can be lost, any frozen assertion changes,
  an admitted report differs, or closure parsing begins above the limit. A
  timeout, OOM, missing job, changed fixture or setup failure is inconclusive;
  inspect it before any retry. No local N02b run is authorized by this plan.
- **Anchor:** Frozen `rust_family_tests::n02b` and its corpus, the prior
  [pivot](rust-inventory-initial-source-limit-prediction.md), and Basili,
  Caldiera and Rombach (1994), Goal Question Metric.

## Boundaries

Preserve prior upstream, registry and package evidence. The limit check applies
once to initial roots after their program facts are constructed; later
promotions retain the existing path. Above the limit, later source diagnostics
are incomplete and must not be interpreted as a complete audit. The limit does
not bound snapshot construction, initial collection, the required fact maps,
or manifest validation. Review those allocations and remaining loops before
admitting N02b. The hosted job uses only frozen synthetic data and runs no
worker, analyzed source, or process signal. Cargo compilation may run normal
dependency build scripts. The test runner, CI isolation and job timeout are
explicit trust boundaries, not proof of a general memory or time bound.
The N02b test asserts the discovery program count, not independent materialized
entry count. Do not call that count a complete input receipt. Before admission,
review peak coexistence of expanded manifest and entry JSON, self-description,
snapshot, roots, fact/program maps, validator indexes and diagnostics, plus
case-specific loops. Pin the frozen corpus and tested revision. The hosted job
must require exact one-test selection, no skip, read-only credentials and
pipefail. Diagnose timeout or OOM before any retry.

The case-specific source review found no remaining component-by-file scan
after the membership index, but found several large JSON, snapshot, manifest,
fact and index structures that can coexist. It did not measure peak memory.
The candidate must check the root count before cloning the source map or
building the queue. A single disposable hosted attempt may follow the code,
parity and workflow reviews; its capacity is not assumed.

Proposed admission mechanism: a separate Linux job in the existing CI workflow
is disabled for ordinary pushes and pull requests. An explicit
`workflow_dispatch` boolean input defaults to false. Only a manually requested
run with that input true can start N02b. The job checks the checkout revision
against the event revision, verifies the frozen corpus hash and uses the exact
test selector. A second invocation is not automatic recovery from failure.
Review the actual workflow and its guard before the first dispatch.

The dispatch must use the typed Boolean input, a separately supplied reviewed
full commit SHA, and a distinct per-run concurrency group. The job checks the
event and checkout against that SHA, verifies the corpus and harness hashes,
and rejects a run attempt other than the first. Record the run ID and compare
its actual commit, workflow and attempt independently before accepting it.
An explicit second dispatch is still possible; the operator must not do so
without diagnosis and a new decision. The existing workflow's ordinary jobs
also run on dispatch. No job uses persisted checkout credentials or secrets.

## Focused result

Ten exact source-limit controls passed, including collision precedence and a
shell input that proves closure parsing is skipped above the small test limit.
The complete C01, P01 and N02a reports match the retained 3,328-byte baseline.
Independent review checked the implementation and manual workflow boundaries.
The workflow guard passed 28 focused checks. None of these results is the
frozen N02b run or a measurement of its peak memory.

## Hosted resource result

On 2026-11-13, [hosted run 43509141738](https://github.com/fyodoriv/agentbrew/actions/runs/43509141738)
used reviewed commit `e487616c80c83f56d0258133d06d89664a835174`. The first
attempt's identity checks passed. The exact frozen N02b test passed once with
zero failures or skips; its test time was 8.55 seconds. Its unchanged harness
asserts 100,001 program entries, a non-clean report and the pathless
`source-worklist-limit` diagnostic. Independent review checked the job log,
input hashes, commit and attempt.

This result covers that synthetic Linux case. It is not an independent count
of every materialized input, a complete diagnostic set, a peak-memory or
general runtime bound, a macOS result, or worker-ownership evidence. Ordinary
jobs in the same workflow dispatch remain separate checks.
