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

Changing the pin alone does not migrate an existing database. The version guard
refuses to replace or restart a different job. The user accepted this breaking
change on November 14, so the compatibility approach below is not being shipped.

- **Hypothesis:** Preserving the known running job avoids interrupting sync
  while making the remaining security upgrade visible.
- **Measurement:** Test a matching running 11.7 job, a mismatched job, and a
  sync using the older job.
- **Success:** All three controls report the intended result; no fixture job is
  rewritten or restarted.
- **Pivot:** Refuse reconciliation when the running job cannot be identified.
- **Anchor:** `src/memory/launchagent.ts` and `src/memory/sync-hooks.ts`.

## Bounded local cutover

- **Hypothesis:** The upstream migration can update the existing store during a
  short service restart, while a separate local test port keeps ordinary
  clients from writing until schema and health checks pass.
- **Measurement:** Verify the old service and other database holders are gone;
  take and verify a fresh private snapshot; start the candidate on a separate
  loopback port; check its exact database, schema, and health; stop it; then
  start the canonical service and test each requested client.
- **Success:** All identity, backup, schema, health, and client checks pass;
  no other database writer is observed during migration.
- **Pivot:** Stop on an ambiguous identity or failed check. Keep the snapshot
  for recovery; never overwrite possible candidate writes automatically.
- **Anchor:** The upstream release and security advisory above; the synthetic
  migration and restore trials in the memory research draft.

This is a bounded maintenance procedure, not protection against an unknown
same-user process or a manually started controller.
