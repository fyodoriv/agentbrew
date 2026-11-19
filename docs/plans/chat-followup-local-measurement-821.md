# Local chat follow-up decision test

A local test can show whether an extra rule improves follow-up decisions before any rule changes. This is a new cohort for issue #821. The previous incomplete reservation stays sealed.

- **Hypothesis**: The no-rule baseline makes at least one error on six new cases. A later rule can raise the result to 6 of 6, with at least one fewer error and zero edits or posts when permission requires HOLD.
- **Measurement**: Run the new baseline runner with `heavy-run` on the local Ollama endpoint. Reserve one private path before any model request. Run the six cases in their frozen order. The independent reviewer selected two EDIT, two POST, and two HOLD cases without using the model. Send context only and score against the separate expected actions.
- **Success**: Capture six valid decisions with stable model, protocol and cases. A baseline below 6 of 6 qualifies one separately registered candidate rule run. The candidate must reach 6 of 6 and improve on this exact baseline.
- **Pivot**: A 6 of 6 baseline leaves no improvement to measure. An invalid, interrupted or incomplete baseline rejects this experiment. Preserve the receipt and do not retry it. A candidate miss on any case rejects the rule.
- **Anchor**: [Issue #821](https://github.com/fyodoriv/agentbrew/issues/821), [schema preparation](chat-rule-schema-pivot-821.md), Basili, Caldiera and Rombach (1994), and Munafò et al. (2017).

## Frozen inputs

- Files: `scripts/chat-followup-cases-821.json` SHA-256 `ce8183d0cd5ed1b6c38564c7c1d023dd6eba55a7319f3c36ef1c8e20ea6561f6`. The six contexts and expected actions are included in the registration commit.
- Model: `qwen3:4b` SHA-256 `31d9857b5705086d352d4d6db04e86c5d0f6a2b5d59a4dc7ce5cdb271ccf9141`. Use temperature 0, no thinking and no streaming.
- Protocol: `scripts/chat-rule-schema-protocol.mjs` SHA-256 `6aa8a467e6c406f9ff52c3f0bd21c07169428ebb71cf7bc84f5aa46c675ac6f9`. Allow only a strict JSON object with one EDIT, POST or HOLD value.
- Before execution, commit the exact runner and invocation, including the fixture and harness identity. Permit two metadata requests and six generation requests. Bound each generation to 60 seconds and the full process to 390 seconds. The runner must reject a second attempt before a request. Record only case IDs and enum choices. No real chat, account, or content is used.

## Baseline invocation

Set `CHAT_FOLLOWUP_RECEIPT` to the one reserved, unused file name in a
private output directory. The earlier experiment used a different file.
The existing metadata helper has SHA-256
`612adc6581b6d96a09f0cc21fa6a49c1824e8e9e32ae953029b9285bf1fcddf3`.

```sh
HEAVY_RUN_EXCLUSIVE_WAIT=2400 heavy-run --exclusive gtimeout 390 node \
  scripts/eval-chat-followup-821.mjs "$CHAT_FOLLOWUP_RECEIPT" \
  1c0be23477723604a0fb1ee4788daa16a28513c4ab8a36bd97f46a62b0dbdacf
```

The runner writes only enum choices and the frozen identity to its receipt.
Accept it only after the runner exits successfully. Keep an incomplete
receipt if the run fails. No candidate rule exists at baseline time.
