/**
 * RED test for `agentbrew team status` — state report.
 *
 * Pins user story #27 "What `team status` shows" section.
 *
 * STATUS: RED today.
 * BLOCKED BY: oss-split-implement-team-command.
 */

import { describe, expect, it } from "vitest";

describe("agentbrew team status — state report", () => {
  it("module exists at src/commands/cli-team.ts", async () => {
    const mod = await import("./commands/cli-team.js" as never).catch((error: Error) => error);
    expect(mod, "cli-team module missing — see oss-split-implement-team-command").not.toBeInstanceOf(Error);
  });

  it.todo("when state.team is set: prints label, URL, lastSyncedAt, counts of sources/MCP/catalog entries");
  it.todo("when no team set: prints 'No team overlay set.' + hint to run team set");
  it.todo("lastSyncedAt is human-readable relative time (e.g. '12 min ago', '3 days ago')");
  it.todo("exit code 0 either way — status is informational, not a check");
  it.todo("--json flag emits structured output for programmatic consumption");
});
