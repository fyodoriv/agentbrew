# OpenCode shared-memory lifecycle

## Prediction

- **Hypothesis:** Naming OpenCode in the shared-memory instructions makes the
  required bootstrap, recall, and session-save lifecycle discoverable to its
  agents when shared memory is configured.
- **Measurement:** Run the shared instruction contract and instruction-sync
  tests before and after the change. Check that the new contract fails first.
- **Success:** The new contract fails before the change; 100% of affected checks
  pass after it. Existing privacy and failure rules remain intact.
- **Pivot:** Do not deploy if the client cannot use the existing lifecycle or
  an affected check fails.
- **Anchor:** `templates/AGENTS.md`, `src/core/agents.yaml`, and the earlier
  isolated OpenCode/Kimi lifecycle trial in the memory-upgrade draft.

This instruction change does not prove that every OpenCode session calls the
memory tools or that the upstream memory upgrade is safe.
