# Hosted receipt publication prediction

The receipt encoder produces an in-memory structural frame. It does not prove
that a hosted run completed, identify the tested executable, or retain evidence.
The worker remains disabled while those claims are unproven.

- **Hypothesis:** A separate collector can retain one complete bounded frame
  and bind it to independently supplied run and build identities without
  treating a partial or unbound frame as a completed observation.
- **Measurement:** Run isolated collector and decoder controls, followed by
  hosted checks that do not execute the worker or send signals.
- **Success:** At least ten controls cover exact frame, truncated frame,
  trailing bytes, duplicate frame, invalid classification, read failure,
  interrupted publication, absent identity, mismatched identity, and retained
  byte verification. Also cover delayed extra bytes, missing EOF, oversized
  frames, replay, substituted paths, failure at each publication stage,
  failed readback, and private canaries. All incomplete or unbound cases
  remain inconclusive.
- **Pivot:** If a worker can block indefinitely publishing, a valid prefix can
  count as complete, or the tested process alone supplies its own identity,
  retain default deny and stop this design. No control proves cleanup.
- **Anchor:** `inventory-hosted-export-prediction.md`, issue #810, and the
  independent receipt review on 2026-11-13.

## Required boundary

Treat the runner, collector, and worker as separate roles. The runner supplies
the trusted run, revision, fixture, source, lock and toolchain identity; the
collector binds and retains the exact bytes it receives. A fixture-generated
digest is not independent authentication. The transport must bound both
storage and waiting, and classify timeout, crash, partial write, missing frame,
or uncertain retention as inconclusive. A normal file write is not inherently
nonblocking. Publication and its controls must not weaken the independent
closed-session ownership proof or enable physical execution.

The runner retains expected identities before launch and supplies them to the
verifier through a separate trusted channel. Exact identity comparisons must
reject replay and substitution. The launch-to-endpoint binding requires its
own review; a producer or collector digest alone does not establish it. This
design does not defend against a compromised runner or same-user adversary.

The collector accepts exactly one bounded frame and requires definitive stream
closure by a deadline. A full frame without closure, delayed trailing bytes,
or a crashed writer is inconclusive. It stages privately, publishes without
overwriting another record, and verifies retained bytes. An interruption at
any step is inconclusive until a reviewed recovery process proves otherwise.
Tests model timeouts and failures with synthetic I/O, without worker execution
or signals. Diagnostics use fixed categories, not raw identifiers or logs.

File operations and scheduling can stall. No bounded-completion claim holds
without a stated and verified filesystem and scheduler boundary. Host failure
or an unknown writer remains inconclusive; no unowned process is terminated.

The first pure capture keeps at most 263 bytes, rejects overflow and failures,
and classifies only after a caller-supplied clean EOF. It does not read or
publish a stream. The flag is not evidence of a clean producer, an owned
endpoint, or a retained frame; those require the separate boundaries above.
