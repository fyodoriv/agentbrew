# Hosted macOS worker ownership experiment

Issue #810's TERM permission error remains unexplained. The no-signal fixture
pivot in [its prediction](inventory-owner-no-signal-prediction.md) remains in
force. This is a separate controlled reproduction, not a replacement for it.

Hypothesis: a fresh GitHub-hosted macOS VM can exercise one fixed, owned
worker/child route and retain enough bounded observations to distinguish a
complete cooperative cleanup from an inconclusive run, without touching the
owner's Mac or signaling an unowned process.

Measurement: after independent source, ownership, failure-path and workflow
reviews, run a dedicated hosted-only macOS job selecting exactly the registered
fixture test. Run the workflow's static guard with its targeted tests before
shipping. The fixture must bind its exact revision and executable bytes, use a
private bounded handshake, and retain a closed receipt without raw process IDs.
The dedicated job runs with no secrets or persisted credentials, minimal
permissions, a fixed timeout, and no self-hosted fallback. No physical fixture
or worker runs locally.

Success: one cooperative positive case and at least four planted malformed,
mismatched, incomplete or interrupted controls produce their expected closed
outcomes; zero unrelated process queries and zero signals to unowned processes
are admitted. The test must establish a new session, a fixed no-fork fixture,
an unreaped direct-child reservation and a reviewed no-unowned-member invariant
before any group signal. The supervisor stays outside the signaled group.
Missing identity, extra membership, lost reservation, unsupported environment,
ambiguous process ownership, timeout, interruption, failed cleanup or missing
receipt makes the case inconclusive. The workflow guard must reject at least
four mutations to the runner, permissions, test selection or credentials.

Pivot: do not run the physical case if the ownership invariant or any error and
Drop path cannot be reviewed. GitHub VM decommission is a containment backstop,
not proof of in-job cleanup. No result establishes historical group membership,
the cause of the earlier error, arbitrary descendant retirement or safety on
the personal Mac. The existing worker and migration gates stay unchanged.

Anchor: [GitHub-hosted runner lifecycle](https://docs.github.com/en/actions/how-tos/manage-runners/github-hosted-runners/use-github-hosted-runners),
[Apple setsid](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/setsid.2.html),
issue #810, and Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017
(preregistration).

## Pre-implementation safety clarification

The controls for interruption are synthetic, at fixed points. A real hard
interruption or missing receipt is inconclusive and is not a passed control.
The extra-membership requirement is an invariant to prove, not a claim that
a snapshot of owned PIDs can enumerate every group member. Its proposed trust
boundary is a fresh dedicated session, fixed no-fork fixture and closed spawn
paths, no untrusted same-session admission, a supervisor outside the child
group, and no competing reaper or automatic reaping. If independent review
cannot establish that boundary, the pivot prevents the physical run.

The worker may signal again during error cleanup and `Drop`. Review every
signal boundary and all normal, timeout, error and `Drop` paths. An outer
preflight alone does not establish the invariant at those later boundaries.
The hosted VM teardown contains the job after it finishes; it does not prove
that in-job cleanup completed. These clarifications precede implementation
and observations; the earlier no-signal pivot and all migration gates remain.

## Compile-only fixture scope

At inventory draft revision `72874cb1`, the guarded fixture has an empty
entry point and no child-mode implementation. Its included worker accepts a
command and can spawn when called; the experiment's signal dispatch refuses.
The hosted guard compiles the fixture but does not execute it. These source
facts do not establish the built binary's identity, runtime behavior, no-fork
enforcement, a closed session or exclusive membership. A future fixed child,
launch and handshake need their own independent source and runtime review;
the default-deny and physical-admission gates remain in force.
