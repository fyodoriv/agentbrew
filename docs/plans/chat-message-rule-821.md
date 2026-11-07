# Chat message rule: decision test registration

Issue #821 asks for a rule that combines consecutive messages in one chat
place. A rule-presence assertion alone cannot measure an agent decision.

Goal: reduce duplicate follow-up posts without deleting messages without
permission. Question: does the candidate rule change a local model's choices
on a fixed four-case synthetic decision set? The cases cover the same author
under 24 hours (edit), the same author after 24 hours (post), a different
author intervening (post), and an unavailable edit without deletion approval
(hold). The rule applies to the same channel or thread only.

Measurement: `heavy-run node scripts/eval-chat-message-rule-821.mjs --baseline /tmp/chat-rule-821-baseline.json`, followed by `heavy-run node scripts/eval-chat-message-rule-821.mjs --candidate /tmp/chat-rule-821-baseline.json <recorded-sha256>`, using
local Ollama model `qwen3:4b`, temperature 0, no tools, no real messages, and
exact EDIT/POST/HOLD output. First ship the harness and its synthetic transport
controls as preparation, then capture the no-rule baseline before editing the
rule. Run the same four cases with the candidate. Success is all four correct
and at least one fewer wrong choice than baseline. Any incorrect candidate
choice, unavailable model, or no improvement pivots away from this approach;
do not claim the policy works across agents or real chat products.

The harness must report each case and both counts, fail closed for timeouts or
unparseable output, and test its grading with a local fake transport. It must
not send, edit, delete, or read real chat messages. The preparation delivers
instrumentation only; a later PR changes the rule.

Anchor: Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et
al. (2017), preregistration.

Before model measurement, bind the no-rule sample to an exclusive-create
local receipt. The receipt stores the fixed cases, expected and actual choices,
model and temperature. Its SHA-256 is recorded before the candidate exists.
The candidate run must verify that hash and the frozen case/model identity,
then compare with that exact receipt; it must not rerun baseline. A missing or
changed receipt fails closed. The boundary case of exactly 24 hours and other
threads are outside this four-case measurement.

Harness controls: `node --test scripts/eval-chat-message-rule-821.test.mjs`.

The receipt also binds the harness bytes and resolved model digest. The digest
is checked before and after each cohort. A tag that changes away and back
between those checks remains outside this measurement.

## Baseline reservation controls

Independent review found that the draft currently requests and prints all four
baseline choices before exclusive receipt creation. An existing receipt is
therefore detected too late, and a failed partial run leaves no attempt
record. No model baseline has been run.

Goal: prevent selective baseline reruns at the registered receipt path.
Question: does an exclusive, fail-closed reservation stop a second attempt
at that path before any model request and retain interrupted attempts? Predict **4/4** synthetic controls pass:

1. An existing receipt is unchanged and causes zero model requests.
2. An interrupted or failed attempt leaves an incomplete reservation; a retry
   makes zero requests and emits no choices.
3. Two concurrent attempts for one path admit exactly one and never overwrite
   each other.
4. A successful attempt makes exactly four synthetic generation requests and
   two metadata requests, writes the complete receipt before reporting, and
   preserves receipt hash validation.

A model request means either metadata (`/api/tags`) or generation
(`/api/chat`). Existing receipts and incomplete retries must make zero of both.
The controls run the real CLI orchestration with an injected fake transport;
no real Ollama listener is contacted. They also verify private file permissions
and that candidate mode rejects an incomplete reservation before generation.

The reservation is created exclusively with private permissions before model
requests. A failure or interruption before receipt finalization leaves an
incomplete or invalid reservation that blocks reuse; it is never deleted
automatically. A crash after finalization may leave a complete, unreported
receipt. Do not rerun the baseline: independently hash and record that same
complete receipt before any candidate. Only a complete validated receipt may
be used for a candidate. A different path is a different reservation and does
not authorize another baseline under the original experiment. Tests use a fake model and private scratch files, never a live
model or real chat. The result remains preparation, not a behavioral baseline.

Commit this prediction before writing tests or changing the harness. Add a
named test for the existing-receipt case and confirm it fails for an observed
model request against the current code. Setup failure is inconclusive:

```sh
bash <<'BASH'
set -o pipefail
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
heavy-run node --test --test-reporter=tap --test-name-pattern='^existing receipt blocks model requests$' scripts/eval-chat-message-rule-821.test.mjs 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
[ "$status" -ne 0 ] && grep -Eq '^not ok [0-9]+ - existing receipt blocks model requests$' "$log" && grep -Fq '# fail 1' "$log" && grep -Fq 'existing receipt made model requests' "$log"
BASH
```

Then implement the reservation. The green measurement requires the six
original controls and these four named entrypoint controls:

```sh
bash <<'BASH'
set -o pipefail
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
heavy-run node --test --test-reporter=tap scripts/eval-chat-message-rule-821.test.mjs 2>&1 | tee "$log" || exit 1
grep -Fxq '# tests 10' "$log" && grep -Fxq '# pass 10' "$log" && grep -Fxq '# fail 0' "$log" || exit 2
for name in 'existing receipt blocks model requests' 'interrupted attempt blocks retry' 'concurrent attempts admit one' 'complete receipt precedes report'; do
  grep -Eq "^ok [0-9]+ - $name$" "$log" || exit 2
done
BASH
```

Success requires all four new controls and the six original controls, no model
request before reservation, no overwrite or lost incomplete state, and the
normal full repository gate. Any repeated admission, request before reservation,
missing incomplete record, false complete receipt or failed gate rejects this
approach. Do not reset or replace a baseline attempt after seeing model output.
A real baseline remains separately gated by the original four-case protocol.

Anchor: the original exclusive-receipt registration; Basili, Caldiera and
Rombach (1994), Goal Question Metric; Munafò et al. (2017), preregistration.

## Atomic receipt finalization supplement

The reservation candidate passed its ten synthetic controls, but independent
review found an untested boundary: a failed receipt sync could leave complete
JSON at the reserved path before finalization. Candidate mode could then accept
it. Reject that candidate. The retained harness and tests have SHA-256
`37cbd00ae9ddb1aa5f0a16fcdd09b410f456bbcce8b826d83f653052e67932f2` and
`8d5016144c2ead8a480870e5f82eb0d6b49c600175c2760484d2e1c28253bced`.
Restore and verify those exact bytes before appending controls.

Goal: publish a complete baseline only after its data is synced. Question: can
candidate mode distinguish an in-flight or failed reservation from a finalized
receipt? Predict **4/4** new fake-transport entrypoint controls pass, while all
ten prior controls remain intact:

1. A synthetic sync failure after the receipt bytes are written leaves no
   finalized receipt; candidate mode reaches and reports the fixed unfinalized
   rejection before generation.
2. A candidate racing a paused pre-finalization write gets the same rejection;
   it cannot observe a partially published completion.
3. A process interruption or reporting failure after finalization leaves one
   hash-verifiable completed receipt, and a retry makes zero new model requests.
4. A pre-existing orphan finalization marker is detected after reservation and
   before any metadata or generation request; preserve both it and the new
   incomplete reservation.

Use a private, hash-bound finalization marker published atomically only after
the receipt bytes have synced. Exclusive reservation stays at the original
path. Candidate mode must verify the marker and receipt before accepting the
baseline. A missing, malformed or mismatched marker is unfinalized. Never
overwrite an existing marker; incomplete and orphaned attempts remain evidence,
not automatic retry permission. Temporary marker files contain only the receipt
hash and are removed only when owned by this attempt. Marker bytes are complete,
synced, and mode 600 before linking. Check for an orphan marker before any model
request. The publication point is the successful atomic marker link; a process
interruption after it may leave a valid, unreported receipt. Power-loss and
machine-crash durability are outside this experiment. The sync-failure control
must prove complete receipt bytes were written and the injected sync failed;
the racing control must prove candidate execution occurred while publication
was paused. Both require the fixed unfinalized diagnostic and zero candidate
generation. The tests inject failures and barriers into a child process
with fake transport and private scratch data; they never contact a model.

Commit this prediction before adding controls or changing the candidate.
Restore the retained files, append the named sync-failure control and confirm
its fixed `candidate accepted unsynced receipt` assertion fails against the
retained candidate. Setup failure is inconclusive:

```sh
bash <<'BASH'
set -o pipefail
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
heavy-run node --test --test-reporter=tap --test-name-pattern='^sync failure cannot finalize receipt$' scripts/eval-chat-message-rule-821.test.mjs 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
[ "$status" -ne 0 ] && grep -Eq '^not ok [0-9]+ - sync failure cannot finalize receipt$' "$log" && grep -Fq '# fail 1' "$log" && grep -Fq 'candidate accepted unsynced receipt' "$log"
BASH
```

Then implement atomic finalization and require all fourteen tests, the four
named new controls, and the normal full gate:

```sh
bash <<'BASH'
set -o pipefail
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
heavy-run node --test --test-reporter=tap scripts/eval-chat-message-rule-821.test.mjs 2>&1 | tee "$log" || exit 1
grep -Fxq '# tests 14' "$log" && grep -Fxq '# pass 14' "$log" && grep -Fxq '# fail 0' "$log" || exit 2
for name in 'sync failure cannot finalize receipt' 'inflight receipt stays unfinalized' 'finalized receipt survives lost report' 'orphan marker blocks model requests'; do
  grep -Eq "^ok [0-9]+ - $name$" "$log" || exit 2
done
BASH
```

Success requires 14/14 controls, zero false completion or overwritten marker,
and zero generation on unfinalized candidate input. Any false complete receipt,
lost reservation, unverified marker, repeated model admission or failed gate
rejects this method. Preserve actual failures and do not alter the original
four-case model baseline. Anchor: issue #821's preregistered baseline binding;
Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al.
(2017), preregistration.

## Finalization coverage supplement

The fourteen registered synthetic controls passed. Independent review found
that they did not prove candidate acceptance of a valid recovered receipt,
marker permissions, rejection of malformed or mismatched markers, or bounded
cleanup of the paused test child. Treat the fourteen-control run as incomplete
qualification. The retained harness and tests have SHA-256
`612adc6581b6d96a09f0cc21fa6a49c1824e8e9e32ae953029b9285bf1fcddf3` and
`66e33d298576fc00043e68f76d64386b82334e67510114605c9f0256cf7bc1c5`.
Restore and verify those bytes before extending controls.

Goal: prove the marker boundary in both directions. Predict **2/2** additional
entrypoint controls reject malformed and mismatched markers with the fixed
unfinalized diagnostic and zero generation. The recovered-finalized control
must also show the real candidate path accepts the receipt, completes all four
fake candidate generation requests and passes the threshold: the fake baseline
chooses POST in all cases (2/4), and the fake candidate chooses
EDIT, POST, POST, HOLD (4/4). The marker must have mode 600 and exact hash plus
newline. All
fourteen prior controls remain intact. Use a synthetic catalog and fake model;
no live model or real chat is accessed. Bound the fake child's wait and the
parent's owned-child wait, and release and reap the child on every test path.
The paused-race control also runs a synthetic no-release subcase and proves its
owned child reaches a terminal state and is reaped within five seconds.

Commit this prediction before extending the tests. Run the complete suite:

```sh
bash <<'BASH'
set -o pipefail
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
heavy-run node --test --test-reporter=tap scripts/eval-chat-message-rule-821.test.mjs 2>&1 | tee "$log" || exit 1
grep -Fxq '# tests 16' "$log" && grep -Fxq '# pass 16' "$log" && grep -Fxq '# fail 0' "$log" || exit 2
for name in 'malformed marker rejected' 'mismatched marker rejected' 'finalized receipt survives lost report'; do
  grep -Eq "^ok [0-9]+ - $name$" "$log" || exit 2
done
BASH
```

Success requires all 16 controls, correct private marker bytes, bounded child
cleanup and the normal full gate. Any accepted bad marker, refused valid
receipt, leaked generation on rejection, unowned child or failed gate rejects
this method. No power-loss durability or global cross-path retry guarantee is
claimed. Anchor: the original receipt-binding experiment; Basili, Caldiera and
Rombach (1994), Goal Question Metric.

## Regression coverage limit

The sixteen fake-transport controls passed separately. The normal Vitest gate
does not discover `scripts/*.test.mjs`; a normal full-gate pass alone does not
run or replace them. Run the explicit Node command as a separate required
check. Durable automatic discovery remains open for the later rule work. No
live-model baseline has been recorded.
