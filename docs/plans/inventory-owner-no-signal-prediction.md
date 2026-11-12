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
