# Hosted worker receipt prediction

The existing worker receipt can block and ignores write failures. The hosted
ownership experiment needs bounded observations across normal and `Drop`
signal paths before it can admit a physical case.

Hypothesis: an experiment-only fixed-capacity receipt owned by one supervisor
invocation can be wired to the actual shared worker signal path. Receipt
operations and pure tests use no I/O, allocation, process queries or signals;
the worker itself does use them. Its sticky failure state refuses later
experiment signals, including cleanup retries. This phase compile- and
source-checks integration; it does not execute the worker or fixture. Ordinary
production behavior remains unchanged.

Measurement: compile the guarded fixture with the target-scoped command in
[the signal-gate prediction](inventory-hosted-signal-gate-prediction.md); run
`heavy-run rustc --test rust/src/owner_hosted_receipt.rs -o <private-test>`
and the resulting pure test under `heavy-run`. Add source-wiring mutation
controls and run the hosted compile-only job. No fixture or worker is executed.

Success: at least six pure controls pass for exact capacity, overflow,
permanent refusal, missing result, illegal transition and cleanup retry;
zero fake calls occur after invalidation; at least two bypass mutations fail;
the guarded fixture compiles and the unguarded fixture fails as registered;
normal production compilation and affected hosted checks pass. No raw process
IDs or errno integers enter the receipt.

Before any future admitted syscall, reserve two event slots. Overflow, an
incomplete attempt or a missing result permanently invalidates the receipt;
Drop must recheck the same state. A denied attempt is distinct from a fake or
real syscall. The experiment path must not call the existing blocking file
observer. Source-wiring checks and injected helper tests do not dynamically
exercise `Leader` or `Drop`.

Pivot: if the receipt cannot be reached by every experiment signal and Drop
path without mutable aliasing, blocking, allocation, unbounded output, or a
change to ordinary production behavior, retain the default-deny gate and stop.
Overflow, incomplete events, real interruption, or missing publication remain
inconclusive. In-memory data does not survive process death and is not a
retained physical receipt. A separately reviewed publication method and the
closed-session ownership proof remain required before any physical run.

Anchor: [hosted cleanup paths](inventory-hosted-owner-path-prediction.md),
[signal gate](inventory-hosted-signal-gate-prediction.md), issue #810;
Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (preregistration).
