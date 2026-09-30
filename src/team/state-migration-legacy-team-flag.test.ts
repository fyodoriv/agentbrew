/**
 * RED test for state migration: legacy organization flag → state.team.
 *
 * Pins the upgrade path called out in oss-split-implement-team-command:
 *   When an upgraded user's state.yaml has `organization: true`, the migration
 *   sets `state.team = { label: "organization", url: <team-url> }`, drops
 *   the legacy field on next save, and prints a one-time hint.
 *
 * STATUS: RED today.
 * BLOCKED BY: oss-split-implement-team-command (state-migrations.ts upgrade).
 */

import { describe, expect, it } from "vitest";
import type { AgentBrewState } from "../types.js";

describe("state migration: organization → team", () => {
  it("state.team field is declared on AgentBrewState", async () => {
    // GREEN: state.team is now declared on AgentBrewState as an optional field.
    // Verify it's part of the type by creating a state object with it.
    const state: AgentBrewState = {
      schemaVersion: 1,
      agents: [],
      catalogVersion: "0.1.0",
      team: {
        label: "test",
        url: "git@github.com:test/repo.git",
        cachedAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString(),
      },
    };
    expect(state.team).toBeDefined();
    expect(state.team?.label).toBe("test");
  });

  it.todo("on load, state.organization === true → state.team = { label: 'organization', url: <team-url> }");
  it.todo("on load, state.organization === false → state.team is undefined (no migration noise)");
  it.todo("on load, state.organization absent → state.team is undefined");
  it.todo("the migration prints a one-time hint pointing at `agentbrew team status`");
  it.todo("on next save after migration, the legacy organization field is dropped");
  it.todo("migration is idempotent — re-running on a migrated state is a no-op");
});
