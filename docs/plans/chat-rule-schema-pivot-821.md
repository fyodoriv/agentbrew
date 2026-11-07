# Chat decision schema: a separate preparation pivot

The original #821 baseline stopped on Nov 7, 2026, at its first case with
`Invalid response for recent own message`. Its exclusive receipt is empty
and retained. The cause is unknown. Do not retry it, inspect raw output, or
claim that another result replaces it.

Goal: prepare a distinct structured-output transport for later evaluation.
Question: can a fake transport accept the three permitted decision values and
refuse invalid envelopes without leaking response text? Predict 10/10 named
synthetic controls pass, with zero network or model requests, no response
text in errors or logs, and the exact request counts below. This is an output
format experiment, not evidence of better decisions or of the cause of the
original failure.

The proposed local chat request uses Ollama's `format` schema: an object
with one required string `action`, enum `EDIT`, `POST`, or `HOLD`, and
`additionalProperties: false`. Keep `stream: false` and temperature zero.
Pin the whole request as `model: "qwen3:4b"`, `stream: false`, `think: false`,
`options: {temperature: 0}`, `format` as above, and exactly one user message
whose content is the caller's synthetic prompt. No other fields are allowed.
The parser must accept exactly one JSON object with one such key; reject
empty, malformed, trailing or multiple JSON values, duplicates, missing or
extra keys, wrong types and values. Use the existing `jsonc-parser` dependency
with duplicate-key visibility; explicitly reject comments and trailing commas.
Inject fake transport; do not fall back to a real transport.
Return only a fixed safe error on any refusal. Do not alter the existing
receipt, model baseline, evaluation cases, or finalization implementation.

Commit this prediction before adding the following controls. The first
`valid enum decisions` control must fail with `schema protocol unimplemented`
when run against the unimplemented adapter. No setup failure counts as red.
The ten ordered controls in `scripts/chat-rule-schema-protocol.test.mjs` are:

1. `valid enum decisions` — three calls, one for each allowed value.
2. `exact request schema` — one call and exact request fields.
3. `malformed JSON refused` — six calls: truncated JSON, empty input, a
   comment, a trailing comma, trailing text and two top-level values. Each
   has its own fixed-error and no-marker assertion.
4. `missing key refused` — one call, fixed error and no marker output.
5. `extra key refused` — one call, fixed error and no marker output.
6. `unknown enum refused` — one call, fixed error and no marker output.
7. `non-string refused` — one call, fixed error and no marker output.
8. `duplicate key refused` — one call, fixed error and no marker output.
9. `HTTP failure refused` — one call, fixed error and no marker output.
10. `transport failure refused` — one call, fixed error and no marker output.

The complete suite makes exactly 17 fake requests: three valid, one schema,
six malformed and one for each of the other seven refusals.

The fake transport counts calls and records request bytes. Fail-closed
sentinels on global fetch, socket connections and HTTP/HTTPS request entry
points count any real network attempt and must remain at zero. A canary proves
that a raw synthetic marker is detected in each captured stdout, stderr,
console and thrown-error channel. Put independent markers in malformed body,
HTTP error body and thrown transport error. Each refusal checks all captured
channels for its marker. No model, socket, real message or owner data is used.
Keep the existing 16 receipt controls unchanged and run them too. Before and
after implementation, record the old receipt's byte size and SHA-256 read-only;
do not publish its content. The semantic-red placeholder is not evidence of
the original failure.

Before the adapter exists, run the named first control and require the exact
`not ok` line, nonzero exit and diagnostic. After implementation, run all
ten controls and require each unique ordered TAP pass, no skipped or todo
cases, plus the existing 16 receipt controls:

```sh
bash <<'BASH'
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
heavy-run node --test --test-reporter=tap --test-name-pattern='^valid enum decisions$' scripts/chat-rule-schema-protocol.test.mjs >"$log" 2>&1
status=$?
[ "$status" -ne 0 ] && grep -Fxq 'not ok 1 - valid enum decisions' "$log" && grep -Fq 'schema protocol unimplemented' "$log"
BASH
```

```sh
bash <<'BASH'
set -o pipefail
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
heavy-run node --test --test-reporter=tap scripts/chat-rule-schema-protocol.test.mjs | tee "$log" || exit 1
grep -Fxq '1..10' "$log" || exit 2
names=('valid enum decisions' 'exact request schema' 'malformed JSON refused' 'missing key refused' 'extra key refused' 'unknown enum refused' 'non-string refused' 'duplicate key refused' 'HTTP failure refused' 'transport failure refused')
for i in "${!names[@]}"; do grep -Fxq "ok $((i + 1)) - ${names[$i]}" "$log" || exit 2; done
grep -Fxq '# pass 10' "$log" && grep -Fxq '# fail 0' "$log" && grep -Fxq '# skipped 0' "$log" && grep -Fxq '# todo 0' "$log" || exit 2
JOBS=1 heavy-run bash scripts/run-chat-rule-controls.sh
BASH
```

Success is all ten named controls and the existing receipt controls passing,
zero marker disclosure, zero real transport calls and independent review.
Any accepted invalid envelope, missed valid value, extra request, disclosure,
receipt regression or incomplete control rejects this protocol. Run the
ordinary full gate on the final tree before delivery.

A later separately registered experiment must freeze independently selected
new cases and expectations, model and schema digests, harness identity, one
new exclusive receipt and numeric decision thresholds before any model call
or candidate rule. Do not tune against the exposed original first case.
Any invalid or interrupted new baseline remains failed; no retry. Schema
validity does not establish decision quality or real-chat performance.

Anchors: [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs);
Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al.
(2017), preregistration.
