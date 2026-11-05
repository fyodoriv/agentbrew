# Agentbrew #764: self-contained fake-compiler SDK ports

Registration prepared before fixture changes while source head 00e5767e49f76e38f36d416e41ca4678db8e7ecc,
tree b7412b3f187612263c69b278284a4c28ed4447f2, is under its final full gate.
Do not edit that worktree or cancel the gate before its actual terminal result.
Root reviews this plan first. Then commit its documentation before changing
or measuring the fixture. Preserve the current gate and all earlier receipts.

## Goal, question and prediction

Goal: portable source-build adapter fixtures must not require a real host Mac SDK.
Question: can the existing fake Cargo/rustc controls run when underlying host
clang/xcrun calls are unavailable, without mocking any real native qualification?
Prediction: one selected valid fake-Cargo control changes from one missing-SDK
failure to zero; both unrecognized SDK command controls remain refused (2/2).
The source, native digest and functional producer oracles stay unchanged.

## Evidence and closed scope

The CI node job in .github/workflows/ci.yml uses ubuntu-latest and npm test.
The unguarded fake-Cargo case named "finds an installed Cargo outside PATH and
supplies its adjacent compiler" invokes the real production toolchain reader,
which calls /usr/bin/clang and /usr/bin/xcrun. The current fixture fakes Cargo
and rustc only. This is a fixture dependency gap, not a Linux native-capacity
claim or a production SDK fallback.

Only src/source-build-capability.test.ts and its registration/docs may change.
Add exact fixture responses for these three child_process.execFileSync ports:
- /usr/bin/clang [--version] -> clang fixture.
- /usr/bin/xcrun [--sdk, macosx, --show-sdk-version] -> sdk fixture.
- /usr/bin/xcrun [--sdk, macosx, ld, -version_details] -> JSON version ld fixture.
The fake Cargo/rustc version strings remain cargo fixture and rustc fixture.
Require the representative source receipt to contain that exact toolchain map.
The underlying host SDK execution path throws ENOENT on every host; unknown
argument arrays cannot fall through to an installed Mac tool. Keep existing
no-Cargo filesystem hiding and every existing behavior/digest assertion.

The adapter's mutable builtin override belongs to one generated fixture Node
child process and ends when that child exits. Its loader file belongs to the
private fixture root and existing afterEach cleanup. Real Cargo/native tests
already invoke the real Node binary outside this wrapper; keep them and N04
outside the adapter. No production script, flag, asset, expected hash, provider,
installation, machine configuration or runtime path override changes.

## Fixed controls and exact commands

S1: existing fake-Cargo discovery/source-receipt positive with underlying SDK
execution forced ENOENT. Baseline must fail at the unavailable SDK, not setup,
missing Cargo, or a changed source assertion. Candidate must succeed and its
receipt must bind the exact five synthetic toolchain fields.
S2/S3: unrecognized clang and xcrun argument arrays each fail with ENOENT;
no broad fake success or host execution is allowed.
S4: every existing source-build capability test still passes in its supported
host scope, including both real-Cargo original-digest plus native show/write/
read workflows. Mac-only executions remain explicitly Mac-only.
S5: prebuilt verifier and approved production script/artifact hashes remain
unchanged. Actual Ubuntu CI remains required; simulation is not Linux proof.

```sh
JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/source-build-capability.test.ts -t 'finds an installed Cargo outside PATH|unrecognized host SDK'
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/source-build-capability.test.ts src/install-script.test.ts src/cli-build-health.test.ts src/build-pipeline-guard.test.ts src/install-e2e-trigger.test.ts
node scripts/native-build-tools.mjs verify-prebuilt
```

Run the same representative positive/negative assertions before and after the
metadata adapter. Record the baseline host-unavailable failure privately,
then apply only the exact metadata response adapter. Compose current public
main (current approved base 649196de80ef2c8568db218cbad614333cec5fe6) normally after the existing full ends.
Run applicable focused/changed/full repository gates on that final tree as root
requires. Do not rebuild carried artifacts unless bound production inputs change.

## Success, pivot, resource cost and anchor

Success: S1 false fixture failures 1 -> 0, S2/S3 refusals 2/2, zero changed
production hashes or weakened native/source assertions, all scoped controls
and required final-tree gates pass. No actual host SDK command in fake cases.
Pivot: any setup-only RED, remaining host SDK dependency, unknown-command
success, real-native interception, altered producer oracle or production
change rejects this test-only route. Stop and revise rather than skip the
portable fixture families or lower their requirements.

Budget: one compiler worker for the existing real native controls, existing
600-second/2-GiB per-invocation bounds; no new native compile for the synthetic
SDK controls. All heavy runs use the normal queue. No tool installation or GUI app launch.

Anchor: Basili, Caldiera and Rombach (1994), Goal-Question-Metric;
Munafò et al. (2017), preregistration; Node child_process.execFileSync interface
https://nodejs.org/api/child_process.html#child_processexecfilesyncfile-args-options.

## Recorded focused result

The host-unavailable baseline failed the existing compiler-discovery positive
and passed both unknown-command refusals. Its captured call was the clang
version request, so the failure is attributable to the host SDK dependency.
With the exact three response ports, all three controls passed and the
positive receipt matched every synthetic toolchain field. The full focused
source/build cohort then passed 95 tests, including both original recorder
digest and native show/write/read workflows; seven legacy observation cases
were not selected. Real compiler receipts additionally reject fixture SDK
version values. Required final-tree and hosted validation remain separate.

## S4 compiler-only response scope, registered before guard measurement

The real Cargo tests bypass the fixture Node wrapper. The real Cargo-free
bundle keeps that wrapper for absence simulation. Its current code makes
no SDK calls, but synthetic replies must not hide a future SDK dependency
without the fake compiler. This clarifies the earlier bypass description.

Before changing the reply guard, add one known clang-version request without
calling installedCargoFixture. Require ENOENT and nonzero status. Prediction:
one false fixture permit becomes zero when SDK replies require the private
fake Cargo executable created by that factory. The three exact version ports
still work for fake Cargo; both unknown-command refusals stay in force.

```sh
JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/source-build-capability.test.ts -t 'finds an installed Cargo outside PATH|unrecognized host SDK|SDK unavailable without a fake compiler'
```

Success: all four scoped controls pass; zero SDK replies without a fake
compiler; every original native digest and functional oracle remains intact.
Pivot on any remaining false permit, unknown-command success, metadata
regression or intercepted real compiler result. This strengthens existing S4;
no source, artifact, hash, timeout, compiler flag or platform claim changes.
Anchor: Basili et al.(1994), GQM; Munafò et al.(2017), preregistration;
the original zero-real-interception S4 requirement.

The supplemental S4 baseline returned success for the known SDK request
without the fake compiler. After requiring that factory-created executable
before a synthetic reply, the same request returned ENOENT; all four selected
controls passed. Unknown SDK commands still refuse. Production source,
artifact bindings and expected native digests are unchanged. The earlier full
and native qualifications remain recorded separately from final-tree checks.
