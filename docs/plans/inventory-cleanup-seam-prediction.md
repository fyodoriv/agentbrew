# Worker cleanup shadow seam prediction

Registered on 2026-11-12 before implementation, for issue #810 and draft
PR #767. The RootPrefix TERM permission failure still has no proven cause.

Hypothesis: a pure, test-only adapter can translate facts already available
at the first TERM boundary into the closed observation format without
changing cleanup decisions or sending a signal. Unknown group and owner
identity remain unknown unless a separately reviewed observation supplies
them. Consistent fields do not prove ownership.

Measurement: the nine selected `owner_success_receipt` tests with injected
terminal, reservation, child-handle and group-request facts, missing or
failing sinks, every TERM outcome and cleanup result, and private canaries.
`cargo test --locked --offline --manifest-path rust/Cargo.toml --test
owner_success_receipt -- --test-threads=1` selects the pure tests. Hosted
Linux and macOS run the same target. No worker or lifecycle fixture runs.

Success: 100% of planted closed cases retain their input outcomes; zero
cleanup decisions change; zero signals or new process-inspection calls occur;
zero identifiers or canaries enter serialized observations. Pivot: if the
seam needs a new query, signal, changed branch or ambiguous identity, stop
and retain the existing behavior. A physical `owner-success` capture needs
a separate prediction, ownership and lifecycle review before any admission.

Anchor: issue #810; the [observation prediction](inventory-cleanup-observation-prediction.md);
Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration).

The preparation adapter is not connected to the worker. A generic test sink
can block, panic or have side effects, so its successful pure tests do not
prove live cleanup behavior. Before instrumentation, design and review a
bounded nonblocking sink and its failure policy, then prove decision and error
parity on injected worker paths.

A later source-only review narrowed issue #810's recorded TERM reason. The
worker maps `EPERM` from its group signal to reason 15 after the reservation
and non-error `WNOWAIT` checks. The pinned rustix 1.1.4 crate archive matched
`Cargo.lock`; its libc source calls `kill` with the negated group ID, and an
independent review checked that source. The [Apple kill manual](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html)
describes group signaling and permission errors. This does not establish the
historical binary or backend, group membership, target credentials, kernel
decision or physical cause. Drop may attempt cleanup again; the receipt does
not prove those attempts ended or succeeded. No process was signaled in this
review.
