# Detect competing Ollama servers before OpenCode setup

- Hypothesis: the normal setup detects one planted state with competing Ollama servers, and the alert names the managed loopback endpoint.
- Measurement: hosted OpenCode bootstrap fixtures model zero, one, conflicting and unverified process ownership without starting services. On the Mac, verify the existing endpoint and repeat three default-config OpenCode smoke runs under the timing queue.
- Success: the controlled conflict produces one clear failure, an observed single healthy server is reused, no service outside Agentbrew is stopped, and each live smoke run finishes within 120 seconds.
- Pivot: report the listener and process count when ownership is incomplete. Preserve the existing service and avoid a new launch in that state.
- Anchor: the duplicate desktop and Agentbrew service finding in `ollama-single-server-readiness`.

## Local qualification result

The Mac reported one verified server and the setup dry run reused it. The
three default-config, no-model-override OpenCode 2.3.0 attempts returned:
120 seconds and timeout, 112 seconds and success, 39 seconds and success.
All three logged rejection of the independent legacy hook bridge.
The task's three-pass target was missed, so the change stays in draft.

An isolated provider-only comparison also timed out without the legacy
bridge. The next scratch process replied in 41 seconds with the bridge
present and rejected by OpenCode. These results do not attribute the
startup timeout to either the bridge or competing server ownership.

## Warm-model diagnostic

The three default-config results did not record whether the model was
already loaded at each invocation. The next bounded comparison measures
only the already-loaded model. Query the managed endpoint before each
run. If the configured default is absent from the loaded model list,
mark that case unobserved without preloading the model. Run three fresh
default-config sessions, each capped at 120 seconds, under the shared
exclusive queue. Every run must preserve the configured model selection
and reply successfully.

Predict three warm replies within 120 seconds. A failed or missing reply
rejects this warm hypothesis. Keep all earlier failed runs in the record.
A warm result cannot establish reliable cold startup.
