# Offline completion control (#833)

## Prediction before implementation

Goal: test a local, bounded skill-measurement route without the shared model
server. Question: can one network-denied completion process evaluate the
exact prompt whose token IDs a separate tokenizer produced?

Use the installed `llama3.2:3b` model and this synthetic raw prompt, including
the final two newlines. The model's own BOS setting controls any BOS token.

```text
<|start_header_id|>user<|end_header_id|>

Reply with exactly READY.
<|eot_id|><|start_header_id|>assistant<|end_header_id|>

```

Measurement commands, to be implemented after this registration commits:

```sh
OFFLINE_CONTROL_MODE=mock bash docs/plans/offline-completion-control-833-wrapper.sh
OFFLINE_CONTROL_MODE=local bash docs/plans/offline-completion-control-833-wrapper.sh
```

Run one mock first; run one local control only after the mock and independent
review pass. The wrapper retains the actual exit and combined output in a
private temporary folder and returns that exit. The mock uses synthetic
tokenizer and completion transcripts. It must accept a valid transcript and
reject wrong output, missing tokens, changed token IDs, insufficient context
and an undenied network connection. It must not run a model. All six checks
must pass, or abandon this path without a local control.

For the local control, use the attested `ggml-org/llama.cpp` b12179 macOS
arm64 archive with SHA-256
`1d111ece4db5c74f233d65d77b74681d62f7cec4bbf5cedd604b1348eb3204c8`.
Safely extract a fresh copy. The selected v2 manifest's digest-file SHA-256
must be `50dfbd3f0ab585e4ba92d20a997bd4da1ee69ae7a5b5b376e91a3cdcad413074`.
Verify the content hash and size of every manifest layer and config descriptor,
and require exactly one model layer. Tokenize the exact prompt in a separate
process using the same release and model, with special-token parsing and the
model's BOS setting. Keep the complete token-ID sequence.

Run `llama-completion` once with the exact prompt, no conversation template,
no context shift, context 4096, output limit 16 tokens, temperature 0,
top-k 1, top-p 1, seed 42, two CPU threads and zero GPU layers. Disable warmup
and prompt echo; ask for verbose prompt-token logging. Both tokenizer and
completion run under a profile that denies all network access, with a clean
environment. An owned loopback listener must be reachable before the profile
and denied under it. No model server is contacted, and the prompt contains no
private data. Preserve the profile, prompt, token IDs, completion output,
token log, manifest checks and process exits privately. Do not print model
paths or raw private data.

Success is 1/1 response equal to `READY` after trimming surrounding whitespace
and removing the completion tool's `[end of text]` marker. Enable debug
logging and require its `found an EOG token` line, with the most recent
associated `n_remain` value greater than zero; reject a missing or ambiguous
value, a missing marker, or later exhausted-budget evidence. Require
the complete verbose per-token prompt log and compare every logged token ID
with the separate tokenizer's IDs. The count plus 16 must fit within the actual
logged context. The two programs use the same release's tokenizer; agreement
does not independently establish that tokenizer's correctness. Each child has
a 300-second deadline; the full control has a
600-second wall-clock deadline from entry through cleanup. Owned listener and
child cleanup must finish within five seconds. Any timeout, mismatch, missing
evidence or other error is 0/1 and abandons this measurement path. Do not
retry to seek a pass.

This is one synthetic calibration, not evidence of skill improvement. It uses
a different model and direct process from the failed raw-server control; it
does not validate that control or claim equivalent model behavior. Register
any later skill baseline and comparison separately.

Anchors: [llama.cpp completion source](https://github.com/ggml-org/llama.cpp/blob/b12179/tools/completion/completion.cpp)
and [Goal Question Metric](https://doi.org/10.1002/9780470172669.ch12).

## Mock result and pivot

On 2026-11-06, the single mock exited 1 before its response controls. Its
network-denial child exited 71: the system Python launcher could not start a
developer-tool helper inside the restricted process. The saved evidence does
not establish why that helper could not start. No model was run, and the mock
did not establish network denial or token-log validation. This is 0/1, so the
registered path is abandoned without running the local control.

Private local evidence retains the exact control, wrapper, prompt, profile,
child output and exit records. The scripts are not in this tree, so the
registered commands cannot run from the branch alone. A later approach needs
a new registration; changing the launcher and repeating this mock would not
meet the registered pivot.
