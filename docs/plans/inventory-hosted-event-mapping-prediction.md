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

## Independent review: required cases

- The two terminal fields describe one observation. A missing field is not an
  exit code. Stop and terminal facts can both be true.
- Record an attempt at the shared dispatch only. The earlier diagnostic is
  not a second attempt. Drop can retry even when no main attempt occurred.
- Record reaping only after a successful wait, including in Drop. Several early
  returns and the Drop wait lack observations today; leave them inconclusive
  until instrumented. Finalize only after Drop finishes.
- Require a fixture identity, final marker, paired attempts and outcomes, and
  proven reaping for a complete physical record. Missing or unknown facts,
  overflow, and pending attempts remain inconclusive. A refusal diagnostic
  cannot establish successful cleanup or an accepted signal.
- Test terminal with already-reaped Drop, early failure with Drop retries,
  overlapping stop and terminal, missing final or reap, duplicate results,
  result without attempt, overflow, and invalidation across Drop. No fixture
  runs in this phase.

## Proposed closed categories

Use setup failure, work failure, context, terminal, stop, reaped, intent, and
ownership unknown. Record terminal and reaped once at their typed success
branches, rather than inferring two events from code and signal fields. Record
the first stop transition. Context is not proof of a stop cause; intent is not
an attempt. Record Drop's successful wait separately, and mark failed waits or
unreserved signal paths unknown. The existing guard still refuses dispatch.

A narrow refusal diagnostic needs one spawn, at least one paired refusal,
one Drop, a proven reap, and finalization after Drop. An early failure, missing
reap, pending event, overflow, or unknown ownership remains inconclusive.
This diagnostic cannot prove physical ownership, signal delivery, or cleanup.
Finalization needs a wrapper around every return path; adding it only on the
normal return would be misleading. The initial categories and typed terminal,
stop, and reap observations are wired behind the experiment guard. The
finalization wrapper and refusal-sequence validator are implemented and await
isolated and hosted checks. A closed refusal diagnostic is not physical
ownership, signal delivery, or cleanup proof.
The source check for calls that bypass the wrapper is textual, not a Rust
visibility boundary. The in-memory final marker is not authenticated run
evidence. Panic, interruption, overflow, or a missing marker is inconclusive.
The mapping harness extracts and tests the actual mapping without compiling or
running the worker. It does not prove runtime event order or physical cleanup.
Its compiler and pure test run are trusted hosted build processes: captured
output is buffered, and a timeout can signal the direct process. This is not a
proof of descendant cleanup.
