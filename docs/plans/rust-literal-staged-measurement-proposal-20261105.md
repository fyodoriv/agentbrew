# Staged Rust literal-writer measurement supplement

Status: proposed, not committed. Root review and a normal docs-only commit
must precede the next harness revision or run. Original prediction:
`4b040d8ba6e9a9e8c6835c39252e9cd35d5e00cd`; its docs-only cherry-pick in the
preserved draft is `cb560eec0eb8dac103b718126cdb4cab49c2adbd`.

## Overall goal and vision

Obtain a trustworthy unchanged-API baseline without turning fixture setup
failures into missing-feature results or running an unbounded resource case.
Preserve the original six positives, fifty negatives in eighteen groups,
two preservation cases and all older inventory acceptance requirements.

This supplement registers measurement order and a harness correction. It does
not replace the original corpus or authorize an adapter, native worker,
producer injection API, production guard or inventory activation.

## Evidence and current state

| Claim | Source | Status |
| --- | --- | --- |
| Original frozen input was committed before harness code | registration commit 4b040d8; source cherry-pick cb560eec | fact |
| A setup-only run compiled and failed before product APIs | private `rust-family-materialization-01.log`, exit 101 | fact |
| Failure was reference expansion, not Rust feature behavior | failed harness line 130 expected bytes_concat binding `$BODY`, received its expanded value | fact |
| No discovery/validation call ran in that selected setup test | sole selected `corpus_materialization_is_exact` only constructs data | fact |
| File membership validation scans all components per file | ed65c092 `rust/src/validation.rs:346-355` | fact |
| N02b would induce about 100001 squared membership comparisons | fixed resource manifest plus that loop | inference |
| Staged setup and small actual-API controls can isolate missing Rust evidence | method below | proposed |

The failed setup harness is preserved privately as
`rust_family_tests-materialization-01.rs`, SHA256
`001fe0de162be0682bb40d5522b24cf2659b049e7120bd19e52f16ea6042d00f`.
The source worktree was returned clean to cb560eec after preserving it.
No failed-source checkpoint was committed or pushed. The one setup failure
is explicitly not semantic RED and not a byte-decoder result. It occurred
under the original prediction; this supplement does not pretend its new
ordering was committed before that observation.

## Decision and alternatives

Keep all frozen source bytes, manifests, expected receipts and diagnostic
witnesses. Separate reference-bearing entry metadata from literal-value
substitution: expand finite entry-repeat paths while preserving bytes_concat
binding references, then resolve those references only inside the byte reader.
Apply `$BODY` replacement to manifest/receipt literal values deliberately.
Do not change the frozen corpus to accommodate the loader.

Use boolean equality assertions with bounded messages for whole manifest or
body comparisons. Do not dump a resource body or full manifest on assertion
failure. Retain exact lengths/hashes/case IDs and the actual exit instead.

Run one selected case at a time. Materialize a Case, check it, then drop its
Snapshot, parsed Manifest, expanded JSON, source buffers and body bindings
before the next case. Do not retain a Vec of all materialized resource Cases.
The immutable compiled corpus text has test-process scope. Mutable buffers
and facts have one test-invocation scope. No RSS or speed result is claimed.

Do not run N02b through the current full validator. Do not add ignored tests,
change its oracle, or report its refusal as qualified. A later separately
registered bounded membership index or fatal-resource short-circuit needs
source review, unchanged error semantics and the original complete fixture.

## Pre-registered stage contracts

### Stage A: correct and qualify materialization only

- **Hypothesis:** the observed setup failure falls from 1/1 to 0/1; one setup
  control changes from 0/1 to 1/1 and checks all 58 records plus all four exact
  resource descriptions. The source bytes and expected manifests stay fixed.
- **Measurement:**

  ```sh
  JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml --lib rust_family_tests::corpus_materialization_is_exact -- --exact --test-threads=1
  ```

- **Success:** exactly 1/1 setup test passes, all 58 records materialize and
  all four resource hashes/lengths/spans/receipts are consistent; zero calls
  to discovery, validation, a snapshot reader, compiler-as-analyzed-source,
  Git, a worker or an analyzed source program. Normal Cargo compilation of
  the test harness is allowed and is not a product measurement.
- **Pivot:** any bookkeeping mismatch or missing resource check stops Stage B.
  Revise the loader/measurement method before another run; do not edit the
  expected source or ledger to obtain a pass.

### Stage B: prove available native control, then missing Rust behavior

After Stage A passes and root reads the exact harness, run these commands in
order on unchanged production discovery and validation:

```sh
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml --lib rust_family_tests::c01 -- --exact --nocapture --test-threads=1
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml --lib rust_family_tests::p0 -- --nocapture --test-threads=1
```

- **Hypothesis:** C01 is 1/1 passing with real native TS call/body/output
  evidence and an empty validation diagnostic set. The six Rust cases have
  0/6 fully bound results and 6/6 semantic failures at missing native evidence
  with the actual source-specific registry-required diagnostic.
- **Success for baseline preparation only:** exactly one C01 executes and
  passes; exactly six p01–p06 execute and reach actual public discover/validate.
  Their failures must identify missing frozen Rust call/body/output facts,
  not a missing target, compiler error, bookkeeping defect or unconditional
  helper stub. Preserve Cargo's actual failing exit for the six expected
  product failures. Do not turn it into exit zero or claim an adapter passed.
- **Pivot:** if C01 fails, any primary does not reach the real API, or a
  setup/oracle issue explains a failure, the baseline remains unqualified.
  Stop before any production adapter or seam. If native facts unexpectedly
  exist, inspect them and correct the source diagnosis before implementation.

**Anchors:** Basili, Caldiera and Rombach (1994), GQM; Munafò et al. (2017),
preregistration. These preparation commands do not replace the original full
corpus measurement or its final acceptance threshold.

## Remaining acceptance and rollout

All 50 original negatives and all four resource obligations remain required.
No negative is newly called safe from this staged baseline. In particular,
N16/N17 still require a real native witness, N18 needs the reviewed private
composition seam and real native evidence, and N02b needs a separately
registered bounded validation method. Function/module ownership trace remains
an explicit witness requirement before any primary can count fully bound.

Root must approve the exact private harness before Stage B. The test-only
unit module may then be copied into the preserved draft; no public test
feature, runtime selector, production API or behavior change is authorized.
The supplemental byte-literal proposal has a separate review, registration,
run and denominator. It does not qualify through C02.

Keep owner queue limits, one compiler worker and one test thread. Record
actual command, source/index/lock identities, selected test counts, exits and
bounded diagnostics. Keep the draft source uncommitted while newly added
expected-failing product tests remain red. Source implementation requires
separate root approval after this valid baseline.
