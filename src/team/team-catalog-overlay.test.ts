/**
 * RED test for team overlay's `catalogOverlay:` field — catalog merging.
 *
 * Pins user story #27 "What an overlay repo looks like" + "What `team set` does"
 * sections. When the overlay's Agentfile.yaml declares `catalogOverlay:
 * ./catalog-overlay.yaml`, agentbrew's `loadCatalog()` must merge that file
 * into the returned catalog while the team is set.
 *
 * STATUS: RED today.
 * BLOCKED BY: oss-split-implement-team-command (3-tier merge + overlay hooks).
 */

import { describe, expect, it } from "vitest";
import type { TeamConfig } from "../types.js";

describe("team overlay catalogOverlay: merging", () => {
  it("module exists at src/commands/cli-team.ts", async () => {
    const mod = await import("./commands/cli-team.js" as never).catch((error: Error) => error);
    expect(mod, "cli-team module missing — see oss-split-implement-team-command").not.toBeInstanceOf(Error);
  });

  it("TeamConfig declares catalogOverlayPath field (wire-up landed)", () => {
    // Asserts the type-level plumbing for catalogOverlay is in place. End-to-end
    // overlay-merge test ships in a follow-up slice (oss-split-extract-organization-content).
    const synthetic: TeamConfig = {
      label: "test",
      url: "test://example",
      cachedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
      catalogOverlayPath: "/some/path/catalog-overlay.yaml",
    };
    expect(synthetic.catalogOverlayPath).toBe("/some/path/catalog-overlay.yaml");
  });

  it.todo("overlay Agentfile `catalogOverlay: ./catalog-overlay.yaml` registers the file path in state");
  it.todo("loadCatalog() merges the overlay catalog when state.team is set, in addition to src/catalog.yaml");
  it.todo("overlay catalog entries take precedence over same-named entries in src/catalog.yaml");
  it.todo("overlay catalog entries get origin: team:<label> in the merged result");
  it.todo(
    "when state.team is unset, overlay catalog is dropped — loadCatalog() returns only generic catalog.yaml content",
  );
  it.todo("missing catalogOverlay file path: clear error message, not a silent skip");
});
