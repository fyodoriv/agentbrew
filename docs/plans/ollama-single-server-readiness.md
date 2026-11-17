# Detect competing Ollama servers before OpenCode setup

- Hypothesis: the normal setup detects one planted state with competing Ollama servers, and the alert names the managed loopback endpoint.
- Measurement: hosted OpenCode bootstrap fixtures model zero, one, conflicting and unverified process ownership without starting services. On the Mac, verify the existing endpoint and repeat three default-config OpenCode smoke runs under the timing queue.
- Success: the controlled conflict produces one clear failure, an observed single healthy server is reused, no service outside Agentbrew is stopped, and each live smoke run finishes within 120 seconds.
- Pivot: report the listener and process count when ownership is incomplete. Preserve the existing service and avoid a new launch in that state.
- Anchor: the duplicate desktop and Agentbrew service finding in `ollama-single-server-readiness`.
