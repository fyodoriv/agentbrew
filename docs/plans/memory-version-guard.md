# Memory version guard prediction

- **Hypothesis:** The installed controller will refuse to replace or restart a
  memory service when its version cannot be verified as the configured version.
- **Measurement:** Run focused LaunchAgent, memory enable and sync tests with
  matching, changed, missing and unreadable service definitions.
- **Success:** All four controls report the correct state, with zero writes or
  restarts in refusal cases. Matching versions continue to work.
- **Pivot:** If the loaded service identity cannot be verified, fail closed and
  leave the current service running.
- **Anchor:** `src/memory/launchagent.ts`, `src/memory/sync-hooks.ts`, and the
  memory upgrade draft's preregistered guard and regression tests.
