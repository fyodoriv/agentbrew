# Owner-success receipt preparation: issue 810

The historical RootPrefix result is `worker-nonzero`, exit 15 and reason 15
(`TermKillPermission`). A separate fixture recorded terminal success before
TERM returned EPERM; it cannot prove the historical RootPrefix state. Keep
issue #810 and draft #767 open. Do not reinterpret EPERM as ESRCH, skip TERM
or KILL, change cleanup order, or signal an unowned identity.

Pin the observation source to #767 commit
`6e32d628009ea839fb9f09e65ba18c621653fab5`:
`rust/src/worker_owner.rs` Git blob `c2d2c1b9e58bc60d0c193356e90e3672b0d0c7ab`
and `rust/tests/lifecycle.rs` Git blob
`8d96947a9197b4adc85defe4cc77c3586e7b0731`. Recheck source, fixture and
cleanup ownership before any later physical admission. The existing lifecycle
test loops over three cases; it is not an isolated owner-success observation.

## Synthetic receipt prediction

Goal: prevent incomplete or private evidence from becoming an apparent
owner-success observation. Question: can a closed-enum receipt format report
qualification without changing the worker's decision? Predict eight of eight
synthetic cases pass, with zero accepted incomplete records, zero raw private
fields, and identical injected cleanup outcomes. This is a test-only format;
it neither launches nor signals a fixture and cannot prove process ownership.

Before implementation, independently review and commit this prediction.
A future `rust/tests/owner_success_receipt.rs` runs only pure encode/validate
functions and injected synthetic records. Bind fields for terminal state,
leader reservation, target ownership, group ownership, owner-identity
comparison, actual TERM result/errno class, and cleanup outcome. Each field
has a closed explicit unknown state. Neither matching a PID nor a single-slot
Darwin query establishes group absence. A complete observation may report a
recorded EPERM; it must not classify that outcome as a successful cleanup.
Keep qualification status separate from the unchanged cleanup outcome.

The eight named tests are: `complete_record_accepted`,
`missing_field_refused`, `unknown_terminal_unqualified`,
`unknown_reservation_unqualified`, `unknown_ownership_unqualified`,
`invalid_enum_refused`, `private_fields_refused`, and
`cleanup_outcome_unchanged`. The missing-field test removes each required
field in turn. The ownership test separately checks target, group and owner
identity unknowns. The cleanup test includes unknown TERM result/errno and
unknown cleanup outcome, each unqualified. The privacy test plants fake PID, command,
environment and payload markers and verifies none appear in the encoded
receipt or diagnostic. The cleanup test checks injected success, EPERM and
unknown outcomes remain unchanged, with no decision callback or process
launch. Unknowns never become a complete record.

Before implementing the format, the first `complete_record_accepted` control
must fail against an explicit placeholder with the fixed diagnostic
`owner receipt unimplemented`. A missing test, compilation error or other
failure is inconclusive. Run only that named pure control:

```sh
bash <<'BASH'
set -o pipefail
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
test -f rust/tests/owner_success_receipt.rs || exit 2
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --offline --manifest-path rust/Cargo.toml --test owner_success_receipt complete_record_accepted -- --test-threads=1 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
[ "$status" -ne 0 ] && grep -Fq 'owner receipt unimplemented' "$log" && grep -Eq 'test result: FAILED\. 0 passed; 1 failed;' "$log"
BASH
```

Run only the dedicated test, not the old lifecycle cohort:

```sh
bash <<'BASH'
set -o pipefail
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
test -f rust/tests/owner_success_receipt.rs || exit 2
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --offline --manifest-path rust/Cargo.toml --test owner_success_receipt -- --test-threads=1 2>&1 | tee "$log" || exit 1
names='complete_record_accepted missing_field_refused unknown_terminal_unqualified unknown_reservation_unqualified unknown_ownership_unqualified invalid_enum_refused private_fields_refused cleanup_outcome_unchanged'
for name in $names; do [ "$(grep -Ec "^test $name \.\.\. ok$" "$log")" -eq 1 ] || exit 2; done
grep -Eq '^test result: ok\. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out' "$log"
BASH
```

Success requires 8/8 named cases, no private output, no process-launch path
in the tested format, unchanged cleanup decisions and independent review.
Any incomplete record accepted as complete, disclosure or changed decision
rejects the format. A setup or compilation failure is inconclusive. The test
result does not qualify the worker, the fixture, group retirement or a fix.

## Later physical admission

Only after the synthetic format lands and source ownership is independently
qualified, register a separate exact live command, receipt path and one
`owner-success` admission. Keep the leader reserved and unreaped through the
existing cleanup sequence; preserve actual status, errno and all existing
bounds. Do not run the three-case lifecycle test to substitute for the isolated
case. If ownership or cleanup cannot be verified, retain an explicit unknown.
No new admission is authorized by this plan.

Anchors: issue #810 and draft #767's lifecycle plan; Basili, Caldiera and
Rombach (1994), Goal Question Metric; Munafò et al. (2017), preregistration.

## Rejected format and compatibility pivot

The first pure format passed its eight tests, but independent review found it
would mark an EPERM result with `cleanup: success` complete. This violates the
registered safety requirement. Reject that format. Its private retained source
has SHA-256 `169f90ddb19a816f1f8cb39846aa87a47f019e59ed7c7e30a0ac5fb0d239d83b`.
No worker, lifecycle fixture or signal ran.

Before changing the retained format, register a distinct compatibility check.
Predict nine of nine pure tests pass: preserve the original eight and add
`eperm_success_conflict_unqualified`. The new case must keep the supplied
`cleanup: success` value intact while marking both `permission_denied` and
`other_error` TERM combinations unqualified. This is evidence-completeness
classification only; it does not
declare any physical cleanup safe. Any contradictory combination marked
complete, changed injected outcome, privacy leak or prior-control regression
rejects this approach.

After committing this pivot, add the named test against the retained first
format. Its fixed assertion message is `conflicting EPERM marked complete`.
The red command must see exactly that one failed test and diagnostic:

```sh
bash <<'BASH'
set -o pipefail
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --offline --manifest-path rust/Cargo.toml --test owner_success_receipt eperm_success_conflict_unqualified -- --test-threads=1 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
[ "$status" -ne 0 ] && grep -Fq 'test eperm_success_conflict_unqualified ... FAILED' "$log" && grep -Fq 'conflicting EPERM marked complete' "$log" && grep -Eq 'test result: FAILED\. 0 passed; 1 failed;' "$log"
BASH
```

Then implement the compatibility rule and run:

```sh
bash <<'BASH'
set -o pipefail
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --offline --manifest-path rust/Cargo.toml --test owner_success_receipt -- --test-threads=1 2>&1 | tee "$log" || exit 1
names='complete_record_accepted missing_field_refused unknown_terminal_unqualified unknown_reservation_unqualified unknown_ownership_unqualified invalid_enum_refused private_fields_refused cleanup_outcome_unchanged eperm_success_conflict_unqualified'
for name in $names; do [ "$(grep -Ec "^test $name \.\.\. ok$" "$log")" -eq 1 ] || exit 2; done
grep -Eq '^test result: ok\. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out' "$log"
BASH
```

Require no skips or filtered tests and independent review. No physical
admission follows. Anchors: the same issue, source and GQM/preregistration
references above.


The prediction and compatibility pivot were committed first in the Dotfiles
coordination draft. The pivot's named red control reproduced the contradictory
EPERM classification; the revised pure target passed all nine named controls.
Independent review confirmed the synthetic scope and preserved cleanup value.
No worker, lifecycle fixture or process signal ran.
