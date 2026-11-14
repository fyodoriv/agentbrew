# Update the upstream memory service

## Prediction

- **Hypothesis:** Pinning upstream MCP Memory Service 12.9.0 makes new managed
  installations reject untrusted browser origins while preserving the existing
  shared-memory interface.
- **Measurement:** Run the version and launch-agent guard checks. Reuse the
  isolated 11.7-to-12.9 migration, restore, origin, and client trials recorded
  in the memory research draft. Verify the live service separately after a
  controlled cutover.
- **Success:** The version check fails before the change and passes afterward;
  all affected tests pass. Existing jobs on another version are left untouched.
- **Pivot:** Keep the existing service and report the gap if the checks or
  controlled cutover fail. Do not overwrite newer writes with an old snapshot.
- **Anchor:** [Upstream security advisory](https://github.com/doobidoo/mcp-memory-service/security/advisories/GHSA-8p26-g7wp-65jw),
  [12.9.0 release](https://github.com/doobidoo/mcp-memory-service/releases/tag/v12.9.0),
  and the isolated trials in the memory research draft.

Changing the pin alone does not migrate an existing database. A verified,
running 11.7 job should remain untouched and allow sync with an upgrade warning.
A stopped, modified, or unknown-version job must still be refused.

- **Hypothesis:** Preserving the known running job avoids interrupting sync
  while making the remaining security upgrade visible.
- **Measurement:** Test a matching running 11.7 job, a mismatched job, and a
  sync using the older job.
- **Success:** All three controls report the intended result; no fixture job is
  rewritten or restarted.
- **Pivot:** Refuse reconciliation when the running job cannot be identified.
- **Anchor:** `src/memory/launchagent.ts` and `src/memory/sync-hooks.ts`.
