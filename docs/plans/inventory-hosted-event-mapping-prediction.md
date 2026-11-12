# Hosted worker event mapping prediction

The current bounded receipt collapses worker observations into one event. Its
internal consistency check accepts an empty sequence; that is not proof of
cleanup. The dispatcher remains default-deny and no physical worker may run.

- **Hypothesis:** Closed outcome categories and sequence validation make the
  experiment receipt interpretable without exposing process identifiers or
  changing production behavior.
- **Measurement:** Run pure receipt and mapping tests with fabricated inputs,
  the source-boundary mutation checks, and the hosted guarded compile job.
  Record test counts and the tested revision.
- **Success:** At least eight controls cover category mapping, empty and
  incomplete sequences, contradictory order, refused attempts, and sticky
  invalidation. At least two planted boundary bypasses fail. Guarded and
  normal builds pass, and zero fixture processes or group signals are run.
- **Pivot:** If any incomplete or contradictory sequence qualifies, if the
  mapping requires extra process queries or stores raw identifiers or errno,
  or if it changes normal behavior, retain default deny and stop this design.
  A syscall accepted event never claims delivery. Publication, ownership,
  executable provenance, and interruption handling need separate review.
- **Anchor:** `rust/src/worker_owner.rs`, `rust/src/owner_hosted_receipt.rs`,
  `docs/plans/inventory-hosted-receipt-prediction.md`, and issue #810.
