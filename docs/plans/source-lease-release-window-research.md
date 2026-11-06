# Controlled source-lease release-window research

Commit this separate prediction before probe code or measurement. The closed
[real-failure cohort](source-lease-failure-observation.md#closed-cohort-result)
remains UNVERIFIED after ten passes. Its acceptance is unchanged. The earlier
incident's cause remains UNKNOWN throughout this proposal.

## Question and scope

Can a controlled physical schedule distinguish a typed busy refusal from a
raw filesystem error during lease inspection? Inspection suggests that a
previous owner could remove the lease directory after a contender receives
EEXIST but before that contender inspects it. This is a hypothesis, not an
observed mechanism or an explanation of the earlier incident.

Use the unchanged `withSourceCheckoutLeases` API and shared safe child-error
classification already qualified by PR803. Keep actual private scratch
filesystems, a real owner child and a separate contender child. Do not edit
product modules, add a production test hook, alter lease deadlines or retry
policy, invent a filesystem error or introduce unlocked fallback.

## Minimal physical controls

Admit each control once, sequentially, in the initial cohort. The separate
pre-measurement amendment below registers one later verification cohort of
the same immutable controls. The combined maximum is six physical admissions:
three initial and three verification. No replacement admission or extra retry
is permitted.

| Control | Required physical order | Predicted contender result | Work and cleanup guard |
| --- | --- | --- | --- |
| owner held | Owner's real lease is acquired before contender starts; release only after contender terminates | Existing deadline yields kind lease-refusal, errno OTHER; exit one | No work entered; owner then releases normally and both children are reaped |
| owner released before contender | Owner acquires and releases; verify actual terminal success and lease absence before starting contender | Leased acquisition succeeds; no failure enum; exit zero | Work enters exactly once only after `assertSourceCheckoutLease`; contender releases normally; both children reaped |
| release between EEXIST and inspection | Owner acquired; contender's real mkdir reports EEXIST; pause before the following real lstat; release owner and verify terminal success plus lease absence; resume the real lstat | Actual filesystem result is kind other, errno ENOENT; exit one | No work entered; one scheduled inspection window; both children reaped |

Keep outcome records separate from the real-incident cohort. Expected failed
children are controlled research evidence; their parent tests pass only when
the exact class and physical milestones match this matrix.

## Proposed child-local scheduling seam

The contender may wrap only its process's built-in `mkdirSync` and
`lstatSync`, using the documented `syncBuiltinESMExports` route to update ESM
bindings. The owner and test-parent processes remain unmodified. Match only
the exact fixture lease path derived from the scratch HOME and real checkout
identity. Forward every argument unchanged to the real filesystem function;
all other paths are transparent pass-through.

Use the same transparent wrappers in every control. Only the third control
may pause: after a real mkdir error whose code is EEXIST and immediately
before the corresponding real lstat. Signal an owned barrier, wait for the
parent's release acknowledgment, and then call the original lstat. Never
throw a fabricated ENOENT or substitute a filesystem result.

The parent must observe the owner child's actual successful termination and
physical lease absence before acknowledging resume. Use explicit milestones,
not sleeps as ordering proof. Keep the production lease deadline at its
existing 5,000 ms. Bound each fixture barrier and cleanup handshake at
10,000 ms and the owner's emergency hold at 15,000 ms. Keep the parent test's
existing 30,000 ms limit. Expiry invalidates the probe; it does not permit a
timeout increase or a different interpretation of the outcome.

Wrapper ownership is contender-process invocation scope. Save the original
functions, restore them and resynchronize named exports in `finally`. The
scope ends on restoration and verified contender termination. If capability
or cleanup cannot be verified, retain the private evidence and stop.

The official Node documentation supports this export-update method, but its
availability and transparent behavior in the installed loader remain
unverified until the registered controls. Do not upgrade Node or introduce a
different seam to make an unsupported probe look successful.

## Evidence and privacy

Record source revision and hashes, accepted process handles, real exits and
complete private logs. Evidence must identify the real EEXIST milestone,
owner-held/released state, actual owner termination, real inspection resume,
work entry, final lease cleanup and reaping. Report milestone booleans and
the existing allowed error enums; do not publish raw messages, stacks,
causes, paths, owner tokens or arbitrary error fields.

The positive control must call `assertSourceCheckoutLease` inside its work
callback. Any callback entered without a verified lease rejects the probe.
All writes stay inside the invocation's private scratch HOME and control
directory. Do not touch owner caches, source files or unrelated children.
Unknown termination is not reaping. Preserve all invalid outcomes rather than
delete them or fabricate a successful cleanup receipt.

## Hypothesis and thresholds

Goal → Question → Metric: determine whether this controlled release order
produces a distinct physical error class without changing lease policy.
Predict the held control yields typed refusal, the pre-released control
yields verified leased acquisition, and the inspection-window control yields
an actual raw ENOENT. Require every control to match in each registered cohort, zero
unclassified outcomes, zero private-error disclosures, zero unlocked work and
verified termination of every child.

Success qualifies this controlled mechanism only. It does not satisfy the
original cohort's real-failure criterion, establish the earlier incident's
cause or prove a product repair. Any different outcome, missing physical
ordering proof, unsupported seam, unsafe output or cleanup gap rejects this
representation. Stop and separately register another method; do not change
the predicted class, retry until green or weaken an assertion.

## Proposed commands and delivery

The describe block does not exist yet. After this prediction is committed,
add it only in `src/sync/pull-source-caches.test.ts`, then run:

```sh
rg -q 'controlled source-lease release windows' src/sync/pull-source-caches.test.ts
JOBS=1 heavy-run npm exec -- vitest run src/sync/pull-source-caches.test.ts -t 'controlled source-lease release windows' --maxWorkers=1 --reporter=default --silent=false
```

Every matrix row must execute. Missing code, all-skipped execution or missing
terminal evidence cannot qualify. The one full gate below is the only
registered physical replay for delivery qualification. Do not run additional
affected cohorts or repeat the full gate under this registration. A later
product change needs its own committed hypothesis and decisive reproduction;
this proposal contains neither a product patch nor permission to reopen the
closed natural cohort.

## Pre-measurement verification amendment

This amendment was prepared after prediction `d640854`, implementation and
static preflight, but before any physical outcome. No initial control had
been admitted. Commit this amendment before either physical cohort. Preserve
the earlier unexecuted source freeze as provenance, then freeze the committed
amended plan and exact probe/source bytes before the first admission.

The initial cohort and full-gate verification cohort are distinct. This
resolves the fact that an unrestricted full gate would execute the physical
controls again. It does not relax a predicted class, privacy guard, work
guard, reaping condition or bound.

| Cohort | Admission ordinal | Immutable control ID | Required prediction |
| --- | --- | --- | --- |
| initial | 1 | 1: owner held | lease-refusal / OTHER; no work; child exit one |
| initial | 2 | 2: owner released before contender | valid leased acquisition; child exit zero |
| initial | 3 | 3: release between EEXIST and inspection | other / ENOENT; no work; child exit one |
| verification | 4 | 1: owner held | Same frozen prediction |
| verification | 5 | 2: owner released before contender | Same frozen prediction |
| verification | 6 | 3: release between EEXIST and inspection | Same frozen prediction |

Admit initial controls separately in the prescribed order, preserving each
real command, accepted handle, actual log, child records and terminal status
before deciding whether the next is permitted. Any unexpected or invalid
result stops initial admissions and makes verification ineligible. Do not
relabel a failed or cancelled admission as unused capacity.

Verification is eligible only after all initial controls match and the root
reviews their evidence. It uses the same frozen source/probe bytes in one
uncached full gate. Preserve the same three control IDs and every actual
child record. No probe or product change is allowed between cohorts under
this registration.

Before either cohort, add an invocation-scoped fail-stop latch only to the
probe describe block. Arm it before starting a physical control and clear it
only after every original milestone, class, privacy, work and reaping
assertion passes. If it remains armed, later probe cases skip before creating
children or touching the fixture. Keep the first unexpected result failed;
later skipped controls are unadmitted and unverified, never successful.
The latch belongs to the test-file invocation and is discarded when that
invocation ends. The initial-cohort controller separately refuses another
command after any unexpected or unknown result.

Implement and statically check this latch only after the amendment commit,
before freezing the final source for either physical cohort. It changes
scheduling, not a prediction or assertion. The existing gate's plain
`npx vitest run` does not expose a configured global bail option; do not claim
that an environment variable supplies one. The local fail-stop guard is the
registered way to prevent later physical admissions within that full run.

The single verification command, after that review:

```sh
JOBS=1 CARGO_BUILD_JOBS=1 VITEST_MAX_WORKERS=1 LOCKFILE_SYNC_NPM=npm@10.9.2 NO_CACHE=1 heavy-run npm run verify
```

Before admission, verify that the immutable physical cases execute in their
registered order and that the local fail-stop latch blocks later physical
work after an invalid case. If that scheduling cannot be established,
verification is unavailable; stop before running it. Ordinary unrelated gate
tests need not be changed, and a full gate that fails elsewhere does not
qualify research even when its physical controls match.

Count physical admissions across both cohorts, with a ceiling of six. There
is no automatic full-gate retry even if it fails in an unrelated step before
or after the controls. Preserve the actual executed/pending control states;
do not infer successful verification from the initial cohort. A failed gate,
source change, unknown termination or invalid control needs new registration
before further physical execution.

Both cohorts matching their unchanged matrix and a successful qualifying
gate are required for research qualification. The closed ten-invocation
natural cohort remains closed and UNVERIFIED; no controlled result replaces
its historical acceptance or resolves the earlier UNKNOWN cause.

## Method sources

- [Musuvathi et al., OSDI 2008: Finding and Reproducing Heisenbugs in
  Concurrent Programs](https://www.usenix.org/conference/osdi-08/finding-and-reproducing-heisenbugs-concurrent-programs)
  motivates deliberate scheduling to study concurrency outcomes.
- [Official Node 24 built-in module export guidance](https://nodejs.org/download/release/v24.22.1/docs/api/esm.html#built-in-modules)
  documents updating named built-in exports through `syncBuiltinESMExports`.
- Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al.
  (2017), preregistration and reproducibility.

The literature guides the proposed method. It is not evidence that these
unimplemented probes execute or reproduce the original incident.
