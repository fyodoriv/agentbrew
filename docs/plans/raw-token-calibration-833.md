# Raw prompt token calibration (#833)

## Prediction before implementation

Goal: find a bounded local measurement for a short skill prompt without
repeating the failed oversized-context control. Question: does an independent
tokenizer count the exact raw prompt the same way as the selected server?

Use this exact synthetic prompt, including the final newline:

```text
<|im_start|>user
Reply with exactly READY.
<|im_end|>
<|im_start|>assistant
<think>

</think>

```

The measurement commands, to be implemented after this registration commits,
are run from the repository root:

```sh
RAW_CALIBRATION_MODE=mock bash docs/plans/raw-token-calibration-833-wrapper.sh
RAW_CALIBRATION_MODE=local bash docs/plans/raw-token-calibration-833-wrapper.sh
```

The wrapper runs the previously registered Python command once, saves its
combined output and actual exit code in a fresh private temporary directory,
prints that directory, and returns the same exit code. It does not retry.

Run the mock once first; run the local command once only if mock controls and
independent review pass. The mock must use a synthetic loopback listener and
exercise valid output, wrong output, missing count, unequal count, insufficient
context and denial of a second listener. All six checks must pass. It must not
call the local model server. A failure is 0/1 and abandons this path.

The local command may send one empty-prompt load request followed by one raw
synthetic generation request to `127.0.0.1:11434`. Before loading, it must
confirm that no model is loaded, to avoid evicting another session's model.
If any model is already loaded, stop without a request. Use `qwen3:4b`, server
version `0.40.14`, `num_ctx: 4096`, `num_predict: 16`, `temperature: 0`,
`top_k: 1`, `top_p: 1`, `seed: 42`, `repeat_penalty: 1`, `repeat_last_n: 0`,
`truncate: false`, `shift: false`, `raw: true`, non-streaming output and stop
strings `<|im_end|>` and `<|endoftext|>`. The load expires after five minutes;
do not send an unload request. Each HTTP exchange has a 180-second socket
timeout. The full process has a 600-second wall-clock deadline, measured from
entry into the control through completed cleanup. All owned listener and
handler cleanup must finish within five seconds from cleanup start. The mock
uses a three-second socket timeout and the same full and cleanup deadlines.

The client must restrict outbound traffic to the selected local port, prove
that a different owned local listener was reachable before restriction and
denied afterwards, and use no proxies. This restricts the client only; the
separate model server is not confined by it. The only prompt is the synthetic
text above. Retain the exact prompt, request, response, status, token IDs,
manifest and layer checks, effective context, profile and wrapper exit in a
private local folder. Do not print model paths or private data.

Use the selected v2 manifest, not the legacy manifest. Its digest as reported
by the server must produce digest-file SHA-256
`ae216e3fca9221a5b914c28fd530d1702329fdf66661acd5bdda41aa9cbeb350`.
Verify that the v2 manifest bytes match the server digest, that `/api/show`
points to its sole model layer, and that the actual model blob matches that
layer's SHA-256. For the selected v2 manifest, verify the content SHA-256 of
every referenced layer and config descriptor against its declared digest;
reject missing, malformed or ambiguous descriptors. Before and
after generation, the selected loaded model must report that digest and an
effective context of at least 4096. Check the server version before and after.
Reported identity and token counts are conditional on trusting the server;
they are not cryptographic attestation of what it evaluated.

Independently tokenize the exact raw prompt with `llama-tokenize --stdin
--ids --no-bos`, with special-token parsing enabled and networking denied.
Use the attested `ggml-org/llama.cpp` b12179 macOS arm64 release archive,
whose SHA-256 is
`1d111ece4db5c74f233d65d77b74681d62f7cec4bbf5cedd604b1348eb3204c8`.
Extract a fresh copy with safe archive handling; do not trust an existing
extracted executable. Pin the archive and validate the selected model blob
before running it. Reject missing, malformed or empty token output.

Success is one complete response exactly `READY`, with `prompt_eval_count`
equal to the independent token count and that count plus 16 no greater than
the reported effective context. All identity, isolation, deadline and
cleanup checks must pass. Any mismatch, timeout or other error is 0/1 and
abandons this measurement path; do not retry it to seek a pass. This single
calibration does not establish skill improvement or validate the earlier
chat-mode runner. Register any later skill baseline and comparison separately.

Anchors: [Ollama generate API](https://docs.ollama.com/api/generate),
[Ollama v0.40.14 prompt counts](https://github.com/ollama/ollama/blob/v0.40.14/llm/llama_server.go),
and [Goal Question Metric](https://doi.org/10.1002/9780470172669.ch12).

## Results and pivot

On 2026-11-06, the one mock run exited zero. The saved result records a valid
response, four rejected negative cases and a permission-denied result for the
other listener. The individual negative outcomes and cleanup are supported by
the saved runner reaching success, not by separate raw records. The mock does
not establish real tokenizer or server behavior.

The one local calibration exited 1. The server returned HTTP 200 and
`done: true`, but stopped at the output limit after explanatory text rather
than the required `READY`. The response reported 17 prompt tokens, matching
the independent tokenizer's 17 IDs. The pre-request checks completed, but
their loaded-context value was not retained separately; validation stopped
before the post-request context and identity checks. The result is 0/1, so
this measurement path is abandoned. It does not prove why the model answered
that way, or establish a valid skill baseline.

Private local evidence retains both runners and wrappers, prompts, mock wire
data, token IDs, server response, checks and wrapper exits. The extracted
tokenizer copy is omitted; the pinned release archive can be verified again.
The scripts are not in this tree, so the registered commands cannot run from
the branch alone. The client restriction did not confine the model server.
