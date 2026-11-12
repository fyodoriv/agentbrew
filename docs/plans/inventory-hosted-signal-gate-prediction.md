# Hosted worker signal gate prediction

The [hosted ownership experiment](inventory-hosted-owner-prediction.md) needs
one fail-closed boundary for every worker group signal. The existing detached
receipt fixture is not on that path. No physical worker or fixture may run in
this step.

Hypothesis: an experiment-only, default-deny guard immediately before the
shared group-signal dispatch can refuse every tested TERM, KILL and cleanup
retry without changing the ordinary production compilation path.

Measurement: target-scoped guarded compilation and focused injected-dispatch
controls, plus an ordinary production build and independent source review.
The exact fixture build uses `cargo rustc --locked --offline --manifest-path
rust/Cargo.toml --bin owner-hosted-fixture -- --cfg owner_hosted_experiment
--check-cfg 'cfg(owner_hosted_experiment)'`; queue build commands with
`heavy-run`. No fixture or worker executable is run. The focused controls must
use an injected fake syscall, never a real signal. The dedicated binary must
fail to compile without its cfg. No package-wide feature or RUSTFLAGS may
activate it.

Success: zero fake syscall calls across all denied TERM, KILL and Drop-equivalent
paths; a distinct refusal cannot look like success or the historical EPERM;
at least two bypass or cfg-removal mutations are rejected; ordinary production
compilation excludes the experiment guard. Pivot: do not run or ship the
physical fixture if any dispatch bypasses the guard, denial is ambiguous,
production behavior changes, or the controls require a real signal. A
compile-time variant is not proof of the production binary, group ownership,
continuous membership, cleanup, or the cause of issue #810.

Anchor: [hosted ownership prediction](inventory-hosted-owner-prediction.md),
`rust/src/worker_owner.rs` and `rust/src/transport.rs`; Basili, Caldiera and
Rombach 1994 (GQM); Munafò et al. 2017 (preregistration).
