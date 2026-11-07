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
