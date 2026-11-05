# Source builds without Cargo: registered prebuilt experiment (#764)

## Outcome and scope

A supported Apple Silicon source build must produce a fresh ordinary CLI and
working native checkup records even when Cargo is absent. Keep the existing
Rust checkup owner and atomic `publish-dist` owner. Do not replace directory
exchange with sequential renames, change the Node floor, install a toolchain,
download executable code at build time or mutate canonical dependencies.

Source baseline: `b699a17e61c1cafd104f8ae477da1281e4cd9035`.
The current prebuild calls Cargo unconditionally. The source publisher and
native recorder also require its output. The installer rejects absent Cargo.
Existing local target binaries are not qualified artifacts: they have no
closed source/lock/builder receipt and contain home-path strings. No previous
native build receipt is a result for this experiment.

## Closed artifact boundary

Carry only `checkup-run`, `publish-dist` and a strict JSON manifest under
`native/checkup-run/darwin-arm64/`. No executable path, target, download URL or
verification bypass comes from environment variables, user configuration or
the manifest. The verifier owns the exact filenames and source allowlist.

The manifest binds its schema and recipe version, `aarch64-apple-darwin`,
minimum macOS contract, each fixed native source path and SHA-256, Cargo.toml,
Cargo.lock, the builder script SHA-256, sanitized recipe digest, compiler and
linker version receipts, and each artifact's exact size and SHA-256. Source
revision is provenance, not a substitute for matching current source bytes.
Reject unknown fields, missing source rows and duplicates. Hash all native
package Rust sources and its lock; do not trust a manifest-selected subset.

Use Node built-ins for source/receipt validation, not another dependency or
bootstrap installer. This is a thin eligible bootstrap component for later
Rust migration, not a language exception. Read artifacts without following links and reject
nonregular, truncated, wrong-target or mismatched files before execution.
Write the verified byte buffers to exclusive files in an invocation-private
stage, then use that pair for copying and publication. No previously built
mutable Cargo target file can substitute for the verified pair.

When installed Cargo exists, resolve it through the normal PATH or ordinary
Rustup/Homebrew locations, expose its adjacent compiler directory to its
child, and compile fresh. An available compiler failure propagates; it never
selects the prebuilt fallback. When Cargo is genuinely absent, verify and use
the fixed pair without compilation. Keep existing staged CLI validation,
checkup qualification and atomic directory exchange in both cases. The
installer must accept that qualified capability and explain a refusal. Source
health inputs must include the verifier, manifest, artifacts and builder.
Unsupported platforms retain their current behavior.

## Prediction and frozen decision controls

**Hypothesis (GQM):** unsafe or unavailable source-build decisions caused by
missing Cargo fall from a predicted failing ordinary build to zero, while
all required controls below agree, all native contract checks stay intact,
and zero stale/tampered artifacts execute. Baseline is unmeasured at this
registration. Read-only source inspection is not a passing baseline.

| ID | Frozen condition | Required decision |
| --- | --- | --- |
| C01 | Cargo and compiler on normal PATH | Compile fresh and retain atomic publication |
| C02 | Cargo installed in an ordinary location but absent from PATH | Discover it and compile fresh |
| C03 | Cargo found outside PATH, adjacent compiler absent from child PATH | Supply that directory; do not misclassify as absent Cargo |
| C04 | Cargo genuinely absent, valid fixed prebuilt pair | Fresh CLI version, no false build drift, native show/record works |
| C05 | Cold scratch source has no Cargo target output | Same successful prebuilt route; no runtime compile/download |
| C06 | Available Cargo or compiler reports an error | Fail; no fallback and no predecessor mutation |
| C07 | TypeScript compilation fails on the no-Cargo route | Preserve the usable predecessor byte identities |
| C08 | Publisher or recorder bytes changed | Reject each variant before execution/publication |
| C09 | Native source, lock, builder or recipe differs | Reject each stale receipt variant |
| C10 | Missing artifact, wrong target, malformed manifest, missing/duplicate source row | Reject each variant; no manufactured capability |
| C11 | Symlink, nonregular, truncated or wrong-architecture artifact | Reject each variant before execution |
| C12 | Existing predecessor/concurrent publication guards | Preserve every existing atomic ownership/refusal decision |
| C13 | Independent sanitized rebuilds from the same snapshot | Both artifact digests match exactly |
| C14 | Binary privacy, target, minimum OS and linked-library scan | Zero private/home/temp path strings; preserve supported ABI contract |
| C15 | Built, cold-source and packed native CLI controls | Same fixed native asset contract without Cargo at runtime |

Freeze the source-build fixture before observing its baseline. First drive
existing build entry points with a controlled Cargo-free environment; observe
semantic failure rather than treating missing future APIs as a regression.
After adding the verifier, exercise the remaining artifact variants against
that real adapter. Preserve baseline logs and inputs. Setup failures are
inconclusive, never semantic red. Do not alter expected outcomes after seeing
results. A focused fixture pass cannot replace real built/cold/packed proof.

**Success:** every required decision agrees; zero unsafe accepts, stale helper
executions, predecessor mutations on failure, new source-health regressions,
private binary strings or protected dependency changes. Both independent
builds must produce identical SHA-256 for each artifact. The normal source
and installed-package gates must pass. No skipped family supplies acceptance.

**Pivot:** any unsafe accept, compiler-error fallback, atomic publication
regression, dependency-policy change, native behavior loss, private string,
rebuild mismatch or missing evidence rejects the route. Stop publication,
retain private evidence and revise the boundary. Do not weaken the cohort or
reuse the old canonical binaries as qualified replacements.

**Anchor:** Basili, Caldiera and Rombach (1994), Goal-Question-Metric;
Munafò et al. (2017), preregistration; the existing
[checkup native and publication contract](checkup-run-records.md#first-native-host-gate).

## Proposed implementation and measurement commands

Commit this registration before fixture measurements, new code or new native
builds. Root reviews the final boundary before implementation. Future commands
below are the frozen measurement entry points, not passing harness evidence:

```sh
JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/source-build-capability.test.ts src/install-script.test.ts src/cli-build-health.test.ts src/build-pipeline-guard.test.ts
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run node scripts/build-native-prebuilt.mjs --verify-reproducible
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/checkup-run/Cargo.toml --target aarch64-apple-darwin -- --test-threads=1
JOBS=1 heavy-run npx vitest run --maxWorkers=1 --config vitest.real-e2e.config.ts real-e2e/scenarios/us01-one-step-install.test.ts
JOBS=1 E2E_COLD=1 heavy-run npx vitest run --maxWorkers=1 --config vitest.real-e2e.config.ts real-e2e/scenarios/us01-one-step-install.test.ts
JOBS=1 heavy-run npx vitest run --maxWorkers=1 --config vitest.real-e2e.config.ts real-e2e/scenarios/us01-us21-npm-package-hooks.test.ts
JOBS=1 CARGO_BUILD_JOBS=1 NO_CACHE=1 heavy-run npm run verify
```

The builder uses a closed environment, existing pinned tools and a private
source/cache copy. It must not copy credentials or user configuration into
the build. Remap source, registry and scratch prefixes to fixed synthetic
paths; disable debug data and nondeterministic linker UUIDs. Capture only
allowlisted version/target/recipe receipts, never live environment values.
Compare independent clean target builds before copying either artifact into
the source tree. Explicitly scan raw bytes and printable strings for private
patterns and home/temp paths. Reconstruct the receipt from current source,
recipe and artifacts, and run the normal pre-push privacy gate. No bypass or
allowlist is authorized. Validate the existing macOS minimum and system-only
linked library contract before accepting a result.

Expected resource cost is the existing pair's approximate size, not a speed
claim. Budget at most 2 MiB of committed native artifacts, independent builds
with one compiler worker each, at most 2 GiB of target storage per build, and
at most 600 seconds of execution per build, excluding queue wait. Enforce the
limits inside the queued builder. Exceeding a limit is a resource pivot;
retain the result privately and do not publish it. Keep Cargo target caches
and timing/diagnostic receipts outside committed paths.

Agent artifact test exemption for this initial commit: registration only;
no deployed instructions, executable behavior or artifact is changed. The
existing docs/task gate validates the preparation. No issue-resolution or
successful build claim is made by this plan.

## Recipe pivot before publication

The first sanitized candidate matched across clean target directories and
passed the byte-path/architecture checks, but its publisher failed the actual
native execution control: dyld exited 134 because `-no_uuid` removed the
required LC_UUID command. That recipe is rejected. Those assets are not
publication candidates. The duplicate-key manifest control separately exposed
an unsafe accept; a later duplicate `schemaVersion` could hide its first value.

Before another build, register this narrower recipe: keep the required UUID
and use the installed Apple linker's `-reproducible` mode. Apple's
[linker manual](https://github.com/apple-oss-distributions/ld64/blob/main/doc/man/man1/ld-classic.1)
describes content-derived UUIDs as the default. Require the Mach-O UUID and
code-signature commands before admitting either asset, then execute the real
native controls. Predicted loader failures across the fixed pair: zero.
The existing resource limits, exact-match threshold and all refusal outcomes
remain unchanged. Pivot again on any loader failure or differing digest.

Use independent source, Cargo cache and target roots for the repeated builds,
not only separate target directories sharing source/cache paths. Canonical
builder JSON is part of the closed manifest encoding; duplicate keys must
reject rather than being overwritten by JSON parsing. Repeat the same focused
entry command and reproducible builder command above. The final built/cold/pack
controls remain mandatory. This records a rejected candidate and the next
prediction, not success or permission to weaken a control.
