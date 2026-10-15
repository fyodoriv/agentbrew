## Summary

Codex lost its effort setting after each sync. This PR writes `model_reasoning_effort` next to the model. The effort now stays the same.

## Details

- Add `effortPath` for Codex in `src/core/agents.yaml`.
- Add a TOML round-trip test.

## Docs

- README "Agentfile" section.
