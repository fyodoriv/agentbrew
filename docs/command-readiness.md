# Command deployment readiness

Run `agentbrew commands list --json` to inspect deployment without executing a command or model turn. The normal text listing remains the default.

The result has `version: 1` and a `commands` array. Each command has its `filename`, absolute winning `sourcePath`, and detected-host `targets`. Each target has `agent`, `path`, `ready`, and `status`:

| Status | Meaning |
|---|---|
| `ready` | Every required artifact matches the existing sync verifier. |
| `missing` | A required deployment leaf or directory is absent. |
| `stale` | An unchanged managed artifact needs its newer source. |
| `kept` | An existing artifact differs from its last managed version. Owner content remains untouched. |
| `unavailable` | The target cannot be read or its required renderer inventory is unavailable. |

Codex readiness checks the native command wrapper, original command reference and explicit invocation policy. It uses the same naming and verification code as sync, including long or mixed-case filenames. Legacy prompt compatibility does not replace the native check. Claude uses preferred delegated content or its supported native Markdown fallback.

An integration must match the exact winning source path and require every client it expects. Missing commands, missing target rows, unknown versions and invalid JSON are not readiness proof. A filename match alone does not prove that the requested source won a collision. A zero sync exit does not prove that an owner-preserved output matches the request.

The result contains paths and outcomes, never command bodies or credentials. Keep private path inventories local. Readiness inspection preserves owner files; resolve a `kept` result through review instead of deleting an owner artifact automatically.

Regression coverage is in `src/sync/command-readiness.test.ts`. Freeze repo writers before running tests: the isolation guard correctly rejects a test run whose repo inventory changes concurrently.
