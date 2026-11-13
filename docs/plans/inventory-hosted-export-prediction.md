# Hosted receipt export prediction

The current receipt exists only in one supervisor's memory. A closed refusal
diagnostic is not evidence of physical ownership or successful cleanup.

- **Hypothesis:** A versioned closed encoding into a caller-owned fixed buffer
  preserves the diagnostic sequence without raw identifiers, arbitrary text,
  allocation, I/O, or partial-success claims.
- **Measurement:** Run pure encoding and independent decoding controls plus
  compile-only hosted checks. Do not execute the worker or admit signals.
- **Success:** At least eight controls cover maximum capacity, exact fit,
  one-byte-short output, empty, unknown, overflow, pending, and malformed or
  reordered sequences. Zero incomplete inputs are classified closed; zero
  private canary bytes appear in output.
- **Pivot:** If a valid prefix can be reported as complete after truncation,
  or if encoding changes worker decisions or needs unbounded memory or I/O,
  retain default deny and stop this approach. An in-memory encoding is not a
  retained or authenticated physical receipt.
- **Anchor:** `inventory-hosted-event-mapping-prediction.md`, issue #810,
  and independent review on 2026-11-13.

Publication is a separate phase. It needs bounded nonblocking framing,
inconclusive outcomes for partial writes, timeout and crash, and independent
binding to the run, revision, fixture executable, source, lock and toolchain.
A digest made by the fixture alone does not authenticate its own evidence.

The standalone encoder and independent reader are preparation only. The
encoder currently accepts a caller-supplied classification and is not wired
to a receipt. It must derive that classification from the claimed receipt's
sticky validity state before it can be used as a receipt export.
