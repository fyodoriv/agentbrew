/**
 * RED test for `agentbrew team unset` — symmetric removal.
 *
 * Pins user story #27 "What `team unset` does" section.
 *
 * STATUS: RED today.
 * BLOCKED BY: oss-split-implement-team-command.
 */

import { describe, expect, it } from "vitest";

describe("agentbrew team unset — symmetric removal", () => {
  it("module exists at src/commands/cli-team.ts", async () => {
    const mod = await import("./commands/cli-team.js" as never).catch((error: Error) => error);
    expect(mod, "cli-team module missing — see oss-split-implement-team-command").not.toBeInstanceOf(Error);
  });

  it.todo("removes every state entry tagged origin: team:<label>");
  it.todo("user-added entries (origin: user) survive untouched");
  it.todo("globally-defined entries (origin: global) survive untouched");
  it.todo("state.team is cleared (undefined / absent after unset)");
  it.todo(
    "already-installed overlay skills stay deployed in ~/.*/skills (team unset controls catalog, not on-disk content)",
  );
  it.todo("operator-readable summary prints what was removed and what survived");
  it.todo("idempotent — running unset with no team set is a no-op (not an error)");
});
