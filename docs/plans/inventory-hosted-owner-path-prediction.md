# Hosted worker cleanup path prediction

The registered [hosted ownership experiment](inventory-hosted-owner-prediction.md)
requires a reviewed closed-session invariant before any group signal. The
compile-only default-deny guard cannot admit one. No physical fixture has run.

Source review found that normal successful cleanup begins after the direct child
is terminal. A group signal may return not-found, which the worker treats as a
successful cleanup operation. That outcome does not establish that the kernel
accepted a signal for a live group. A controlled cancellation may begin cleanup while a fixed child is
live, but the operation is correctly reported as stopped.

Hypothesis: a separately reviewed hosted-only fixture can distinguish those two
paths without changing ordinary production behavior or signaling an unowned
process. It can record attempted, syscall accepted, already absent, denied and error outcomes
as distinct closed observations, with no raw process identifiers in output.

Measurement: after source, isolation, sink and all signal-path reviews, run
only the dedicated pinned macOS hosted fixture and its named controls. Record
both the cooperative terminal case and the controlled cancellation case. The
existing compile-only guard must keep denying until a separate admission policy
has passed review. Do not run a physical fixture on the personal Mac.

Success: exactly one cooperative terminal case and one controlled cancellation
case yield complete receipts with their actual outcomes. The cancellation case
must record the child live at the signal boundary and a syscall-accepted
outcome; a race or already-absent group is inconclusive for that case. This
snapshot and syscall result do not prove delivery or action by a particular
child. At least four planted identity, sink, incomplete and synthetic
controlled-interruption cases are rejected or marked inconclusive. Zero unowned signals, raw IDs in public output or changes
to normal production decisions are admitted. A cancellation is never reported
as successful work. Do not infer delivery or require a successful signal when the cooperative
case has an already-absent group.

Pivot: stop before signaling if the closed-session invariant, unreaped child,
fixed no-fork executable, guard, or any error/Drop path is uncertain. Missing,
partial, overflowing or failed receipts, real interruption, unknown reaping or
unproved membership make the case inconclusive. The sink must be bounded and
nonblocking. Sink failure must refuse further fixture signals and must not
change the ordinary production build or be reported as successful cleanup. VM
teardown is a containment backstop, not in-job cleanup proof. This test cannot
explain the historical permission error or establish production-Mac safety.

Anchor: `rust/src/worker_owner.rs`, issue #810, [hosted ownership prediction](inventory-hosted-owner-prediction.md),
[GitHub runner lifecycle](https://docs.github.com/en/actions/how-tos/manage-runners/github-hosted-runners/use-github-hosted-runners),
Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (preregistration).
