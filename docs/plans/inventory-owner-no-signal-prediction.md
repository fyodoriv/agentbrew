# Fresh owner fixture: no-signal prediction

The earlier TERM permission error has no proven physical cause. A closed
receipt fixture and source review cannot establish a live group relationship.
This experiment observes a freshly owned fixture only; it does not run the
inventory worker, reproduce the historical error, or send a signal.

Hypothesis: one fixed no-fork child in a newly created session can report its
own process, parent, process-group and session relationships over private
inherited descriptors while its parent holds the unreaped child handle. A
cooperative release lets that child exit and be reaped without a signal.

Measurement: after independent source, ownership and failure-path review,
`heavy-run cargo test --locked --offline --manifest-path rust/Cargo.toml --test owner_no_signal -- --test-threads=1`.
Use only synthetic data and retain no process identifiers in public output.
The test must use bounded messages and deadlines and must not launch the
inventory worker, call a group signal, or inspect unrelated processes.

Success: the dedicated fixture confirms all four relationships, cooperative
release and one direct-child reap, and every planted malformed or mismatched
handshake is rejected; zero signal calls and zero unrelated process queries.
Pivot: if identity, isolation, cleanup, output bounds or termination cannot be
proved on any path, stop and report inconclusive. A snapshot cannot prove
continuous group exclusivity or absence of same-user interference. No test
may signal a process, even on timeout or failure; parent death and interrupted
runs need separately reviewed handling. Do not claim group retirement, native
worker safety, or a fix for issue #810 from this fixture.

Anchor: issue #810, [owner receipt preparation](owner-success-receipt-810.md),
[cleanup seam](inventory-cleanup-seam-prediction.md), and Basili, Caldiera and
Rombach 1994 (GQM); Munafò et al. 2017 (preregistration).

## Source-only safety review (2026-11-12)

A candidate child could create its own session, send a bounded identity
handshake, and exit on release, disconnect or its own deadline. The parent
would hold the unreaped direct-child handle and compare each reported
relationship before release. This would be evidence for that fixture only.

Independent review found that this no-signal method cannot establish bounded
termination on every failure path: a stopped child, scheduler starvation,
kernel stall or parent death can leave cleanup unproved. A timeout cannot be
reported as complete until the child is reaped. The registered pivot therefore
applies to this design. No fixture was built or run, and no process was
signaled. Reopen only with a separately reviewed containment and cleanup
method; do not weaken the registered requirement or infer the historical
permission error's cause.

## XPC lead (2026-11-14)

[Apple's XPC overview](https://developer.apple.com/documentation/xpc) describes
an app- or framework-bundled service process per client that exits when its
client exits. Apple's [background-process guidance](https://developer.apple.com/documentation/appkit/managing-ongoing-background-processes-in-your-mac)
suggests XPC services for app-managed work and separately asks apps to ensure
directly launched processes terminate. These sources describe the service
lifetime; they do not establish recursive cleanup of arbitrary descendants, a
hard deadline, or a waitable completion receipt for this inventory worker.

An in-process service is only a possible design lead. The existing inventory
uses the owner's Git wrapper, which may launch external processes. Replacing it
with an in-process implementation is not established as equivalent. CLI bundle
integration, signing, permissions, restart/interruption semantics, identity,
all failure paths and completion would need a separate reviewed design. A
no-spawn claim would need its own proof. The default-deny and cleanup pivot
remain unchanged. This was documentation research and independent review only;
no service or worker was run. It does not establish that no other API exists.
