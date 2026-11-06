# Chat message rule: decision test registration

Issue #821 asks for a rule that combines consecutive messages in one chat
place. A rule-presence assertion alone cannot measure an agent decision.

Goal: reduce duplicate follow-up posts without deleting messages without
permission. Question: does the candidate rule change a local model's choices
on a fixed four-case synthetic decision set? The cases cover the same author
under 24 hours (edit), the same author after 24 hours (post), a different
author intervening (post), and an unavailable edit without deletion approval
(hold). The rule applies to the same channel or thread only.

Measurement: `heavy-run node scripts/eval-chat-message-rule-821.mjs` using
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
