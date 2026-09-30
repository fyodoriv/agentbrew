/**
 * RED test for the 3-tier Agentfile merge: global → team → project.
 *
 * Pins user story #27 "3-tier Agentfile merge" section.
 *
 * STATUS: RED today.
 * BLOCKED BY: oss-split-implement-team-command (3-tier merge logic).
 */

import { describe, expect, it } from "vitest";

describe("Agentfile merge: global → team → project", () => {
  it("module exists at src/commands/cli-team.ts", async () => {
    const mod = await import("./commands/cli-team.js" as never).catch((error: Error) => error);
    expect(mod, "cli-team module missing — see oss-split-implement-team-command").not.toBeInstanceOf(Error);
  });

  it.todo("global Agentfile (~/.config/agentbrew/Agentfile.yaml) loaded first with origin: global");
  it.todo("team Agentfile (~/.cache/agentbrew/teams/<label>/Agentfile.yaml) loaded second with origin: team:<label>");
  it.todo("project Agentfile (<repo>/Agentfile.yaml) loaded third with origin: project");
  it.todo("list fields (mcp, sources, rules) union in scope order — global → team → project");
  it.todo("scalar fields (e.g. mcpFormat) use most-specific-wins — project beats team beats global");
  it.todo("removal is symmetric per scope — unsetting one scope removes only that scope's entries");
  it.todo(
    "user-added entries (origin: user) live alongside the three Agentfile-sourced scopes — survive all scope unsets",
  );
  it.todo("when no team is set, merge falls back to just global → project (no team scope)");
});
