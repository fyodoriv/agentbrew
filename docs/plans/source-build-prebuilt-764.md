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

## Mutable source-build receipt lifecycle

The source-artifact store and successful receipt are Cargo-target-directory
scoped, under `rust/checkup-run/target/aarch64-apple-darwin/release`. Every
source compilation uses a verified copy of the fixed Rust inputs and a new
private Cargo target. It never seeds that target from mutable cached outputs.
The real source root must still match the frozen inputs before publication.

Read the produced fixed pair once into bounded buffers. Validate the pair,
stage it with the source receipt privately, then rename the two cache files
and receipt last. Source-store parents and artifact outputs reject ambiguous
links/types before compilation and again before publication. A previous
receipt symlink can be replaced by rename without following its target.

This store is a nontransactional cache, not the installed CLI transaction.
Compiler or staging failure preserves an existing valid cache before any
publication. A partial cache publication can make it unusable; mixed bytes
fail receipt hashes before preparation or execution. Input or artifact
mismatch also invalidates it. Cleaning the target directory deletes it.
The installed CLI still uses the existing Rust atomic publisher.

Private source copies, compiler targets, pending files and verified stage
buffers belong to one build invocation. Normal success/failure removes only
its owned private directories. A changed directory identity is retained with
a warning. A failed compiler never selects the prebuilt route or replaces
the installed CLI.

A source archive with no root `.git` entry records `sourceRevision: null`
for the local source-build recipe only. It still binds every source input
and artifact digest. Present but broken Git metadata fails; Git metadata
from a parent checkout is never used. Carried prebuilts always require their
40-character source revision and cannot use the archive exception.

## Source-cache attestation prediction

Fresh review identified a separate trust question after the frozen full and
N04 gates passed: a successful Cargo invocation can reuse a newer substituted
executable in its mutable target cache. Source hashes alone cannot attest
that Cargo compiled the output bytes. This is a hypothesis until the actual
compiler control below reproduces it; previous results remain tied to tree
`47d789fdbe9eef0cb1f92bb7e869f685e0039a80`.

**Hypothesis (GQM):** compiling in a new private target directory per source
build reduces acceptance of one planted newer valid Mach-O recorder from one
to zero. The source receipt must bind outputs from that invocation, rather
than grant provenance to previously mutable cache bytes. Preserve the existing
atomic CLI publisher and all compiler-error refusal outcomes.

**Measurement:** before production changes, build the exact native source
with actual installed Cargo in a private fixture. Replace only the recorder
output with the reviewed publisher bytes, advance its modification time, and
run the same source-build entry again. The test requires restored recorder
bytes and a matching source receipt. It uses no mock compiler, downloads,
tool installation, canonical dependency writes or private payloads.

```sh
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/source-build-capability.test.ts -t 'actual Cargo cache'
```

**Success:** one planted-cache control changes from failure to pass, with
zero substituted executable admissions; all existing refusal, source-archive,
compiler-error and predecessor-preservation controls still pass. A fresh
private source target is build-invocation scoped and is deleted on success
or failure. Only bounded, validated executable buffers and their receipt may
reach the existing source-artifact store and staged CLI publisher.

**Pivot:** any surviving substituted output, compiler-error fallback, unsafe
source-store replacement, predecessor mutation, unbounded resource use or
missing exact-tree qualification rejects this route. Stop before publication
and revise the ownership boundary; do not add Cargo fingerprint parsing or
weaken receipt checks.

Budget two real source compilations in the control, at most 600 seconds and
2 GiB of target storage per invocation, one compiler worker. Preserve failed
and prior-tree receipts privately. Root reviews the reproduced failure and
source-store publication plan before production changes. Repeat the source
cohort, bound artifact rebuild and required composed-tree gates after the fix.

**Anchor:** Cargo's [official freshness and fingerprint documentation](https://doc.rust-lang.org/stable/nightly-rustc/cargo/compiler/fingerprint/index.html)
explains its output/source modification-time checks and their limits;
Basili et al. (1994), GQM, supplies the acceptance framing.

### Producer-cache variant registered before measurement

The first actual-Cargo top-level-output control passed: Cargo restored the
correct recorder rather than attesting the substituted final copy. This does
not prove the review's cache concern. Preserve that positive result. Before
another measurement, extend the same control to the identical recorder
executable in Cargo's fixed `release/deps` cache as well as its final copy;
select the cached recorder by equality to its original digest, not a new
manifest path. Do not modify the publisher, libraries, source or fingerprints.
Advance the selected outputs' modification times and require the original
recorder bytes after the next successful build. Prediction: this producer-cache
variant exposes one unsafe admission before the fresh-target fix and zero
after it. If it also passes, do not implement this fix based on the unsupported
review hypothesis. The command, limits, zero-admission threshold and compiler
error/publication safeguards above are unchanged.

### Functional producer oracle registered before candidate measurement

No candidate run has occurred. The private source snapshot intentionally
changes Cargo package/source paths, which may change executable bytes even
for the same source. Preserve the original exact-byte positive and RED
controls, including the adjusted direct-Cargo legacy-cache baseline. Do not
select another expected executable hash or change compiler flags to match it.

Before the first candidate measurement, register this same stronger producer
oracle for both old bootstrap and candidate, on both existing substitution
variants. The tested source-build entry must succeed; its source receipt must
validate and bind the actual recorder digest. That executable must perform
synthetic native `show` (missing), `record` (recorded), and `show` (present)
with the exact timestamp/result/fixture commit and unchanged record digest.
The admitted recorder must not equal the substituted publisher digest.
Report original-byte identity separately as a diagnostic; it supplies no
replacement expected hash or successful behavior claim. This tests native
producer behavior, not merely a different Mach-O file.

Use the same actual-Cargo command and two-compilation fixture above. Require
both complete functional workflows to pass on the candidate, with zero
publisher admissions. The old producer-cache variant must fail this same
oracle while the final-copy recovery case passes. Any admitted publisher,
incorrect stored payload or mismatched receipt rejects the fix. Also pin
source-store parent/artifact link preservation and mixed-cache refusal; these
are fail-closed store controls, not installed-output transaction claims.

The candidate's separately reported byte identity matched the original recorder
in both variants. Keep the original digest-equality assertion in addition to
all functional producer and receipt checks. Its expected bytes were fixed by
the first actual compilation before cache substitution; no replacement hash
or compiler flag is introduced. Preserve the earlier failing byte-oracle
baseline and passing final-copy recovery evidence.
