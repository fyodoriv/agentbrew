# Plan: mcp-heal-loop-known-failure-taxonomy

## Goal

Stop the 30-minute MCP heal cycle from re-running ineffective heal actions for catalog-documented known failures while still reporting those failures in MCP health/status.

## Why

`agentbrew fix` currently treats launcher/protocol failures such as `init_timeout` and `tools_list_timeout` as generically healable by `agentbrew-sync-mcp`. For MCPs whose catalog metadata already documents known upstream breakage or user-action setup requirements, repeated scheduler ticks can keep launching the same broken process and appending heal history without changing state. This weakens VISION G5 because auto-repair should reduce drift noise, not create churn.

## Scope (in)

- Add a catalog-level way to mark MCP probe failures as suppressed/user-actionable for scheduler heal decisions.
- Classify suppressed failures before selecting a heal action.
- Record suppression reason and retry policy in the health snapshot.
- Keep suppressed failures visible to `agentbrew status` and follow-up task generation.
- Preserve existing auth/config/sync heal behavior for failures that are not marked suppressed.
- Add focused regression tests for repeat scheduler ticks.

## Scope (out)

- No HTTP/SSE probe implementation.
- No live probes against real `ask-human`, `tasks-mcp`, or GitHub MCP servers.
- No changes to interactive `agentbrew mcp probe --deep` behavior.
- No public upstream issues or package publishes.

## Implementation steps

1. Extend `CatalogMcpServer` with optional `probeSuppression` metadata:
   - `statuses?: ProbeStatus[]` — suppress only these failure statuses; omitted means any non-skipped failure for that server.
   - `reason: string` — user-facing explanation copied into the health snapshot.
   - `retryPolicy: "probe-every-tick-no-heal-until-catalog-change"` — explicit policy: keep probing each scheduler run, but do not run a heal action until catalog metadata changes. This avoids masking upstream recovery because an `ok` probe still clears the failure.
2. Add suppression metadata to `ask-human` for its documented upstream stdio launcher failure. Do not suppress `tasks-mcp` or `github` in this PR unless their catalog entries first gain equally deterministic metadata; the task mentions them as observed churn, but only `ask-human` currently has a catalog-documented known upstream failure.
3. Add `buildSchedulerProbeSuppressionMap()` next to `buildSchedulerDeepSmokeMap()` in `src/mcp/catalog-smoke.ts`; it returns a `ReadonlyMap<string, McpProbeSuppression>`.
4. Thread suppression metadata into `runMcpHealCycle` through a new optional `suppressionByServer` option defaulting to `buildSchedulerProbeSuppressionMap()`.
5. In `runMcpHealCycle`, keep the current failure flow but insert this ordering per failure:
   - if the failure status matches catalog suppression metadata, record `suppressedByKey` and skip heal-action lookup entirely;
   - otherwise call `categorizeProbeResult()`;
   - then select and run the heal action as today.
6. Keep `McpHealAttempt` for real heal attempts only. Add snapshot-only `McpHealthSuppression` metadata to `McpHealthEntry` instead of appending fake suppressed attempts to `healHistory`.
7. Extend `saveMcpHealthSnapshot()` / `buildMcpHealthSnapshot()` with an optional suppression map keyed by `agent:name`; entries whose current result is suppressed receive `suppression: { reason, retryPolicy }`, and healthy entries clear prior suppression.
8. Keep final unresolved failures feeding `writeFollowups()` unchanged. Existing follow-up IDs dedupe per agent/server, and suppressed failures must remain visible to `agentbrew status` rather than silently disappearing.
9. Add tests that two consecutive heal cycles for an unchanged suppressed `ask-human` failure call no sync/auth heal action, write snapshot suppression metadata, and do not grow `healHistory`.
10. Add tests that an unsuppressed sync/auth failure still runs its registered heal action.

## Risks and mitigations

- **Risk**: Suppression could hide a real upstream recovery. **Mitigation**: store an explicit retry policy and keep the status unhealthy; this PR uses metadata only to suppress scheduler heal actions, not probe visibility.
- **Risk**: Broad name-based suppression could mask unrelated failures. **Mitigation**: tie suppression to catalog metadata and concrete statuses instead of suppressing every failure for a server.
- **Risk**: Snapshot schema drift could break old cache reads. **Mitigation**: add optional fields only and keep existing guards tolerant.
- **Risk**: Follow-up generation might duplicate tasks for suppressed failures. **Mitigation**: existing follow-up IDs are stable per agent/server and already dedupe by ID.

## Acceptance criteria

- `agentbrew fix` classifies catalog-documented known-broken servers as suppressed/user-actionable instead of healable.
- `~/.cache/agentbrew/mcp-health.json` entries can record the suppressed reason and next retry policy.
- Two consecutive heal cycles with unchanged suppressed failures add no generic sync/auth heal attempts.
- Existing auth/config/sync heal actions still run for genuinely healable failures.
- `agentbrew status` still surfaces suppressed unhealthy MCP entries.

## Reviewer verdict

- **Verdict**: needs-revision
- **Reviewer**: reviewer
- **Date**: 2026-06-10
- **Concerns**:
  - Step ordering, suppression schema, snapshot representation, suppression-map API, follow-up behavior, and per-server scope needed to be specified before implementation.

## Reviewer verdict

- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-10
- **Concerns**:
