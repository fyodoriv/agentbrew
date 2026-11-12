# Inventory cleanup observation prediction

Registered before implementation on 2026-11-12 for draft PR #767 and issue
#810. The observed TERM permission error is real; its cause and the production
RootPrefix worker's terminal state remain unknown.

Hypothesis: a closed, pure observation schema can preserve terminal state,
reservation, child-handle identity, group-request and optional identity-query
outcomes, actual signal-error class and cleanup outcome without converting an
unknown into an ownership claim or exposing process identifiers.

Measurement: run only named, pure unit tests on hosted Linux and macOS. Plant
known, unknown and contradictory combinations, permission/not-found/other
errors, unknown fields and a private canary. Assert that cleanup decisions are
unchanged. This step starts no worker, sends no signal and captures no live
process. A physical observation needs a separate registration and review.

Success: all registered pure cases pass on both hosted platforms; zero unknown
or contradictory input becomes an owned verdict; zero raw identifiers or
canaries appear in the serialized receipt; zero cleanup decisions change.
Pivot: any ambiguous identity, receipt leak or changed decision stops the
instrumentation. Keep the worker and issue open; do not treat a fixture receipt
as evidence for the production RootPrefix route.

Anchor: issue #810, draft PR #767, Basili, Caldiera and Rombach 1994 (GQM),
and Munafò et al. 2017 (pre-registration).
