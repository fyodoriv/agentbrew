/**
 * RED test for `agentbrew team set` — one-team-at-a-time replacement.
 *
 * Pins user story #27 "One team at a time" section.
 *
 * STATUS: RED today.
 * BLOCKED BY: oss-split-implement-team-command.
 */

import { describe, expect, it } from "vitest";

describe("agentbrew team set <new-url> — replaces existing team", () => {
  it("module exists at src/commands/cli-team.ts", async () => {
    const mod = await import("./commands/cli-team.js" as never).catch((error: Error) => error);
    expect(mod, "cli-team module missing — see oss-split-implement-team-command").not.toBeInstanceOf(Error);
  });

  it.todo("second `team set <new-url>` removes all entries with origin: team:<old-label>");
  it.todo("then registers new team's entries with origin: team:<new-label>");
  it.todo("state.team is replaced (not appended) — one team at a time, always");
  it.todo("operator sees a clear message that the existing team was replaced (no silent swap)");
  it.todo("user-added entries with origin: user survive the replacement");
  it.todo("if new URL is the same as existing, treat as no-op (not a replacement)");
});
