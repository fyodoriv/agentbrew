/**
 * RED test for `agentbrew team set <url>` — clone-and-install behavior.
 *
 * Pins user story #27 ("Team overlays") "What `team set` does" section.
 *
 * STATUS: RED today.
 * BLOCKED BY: oss-split-implement-team-command.
 *
 * The dynamic import below intentionally targets a module that does NOT
 * exist yet. Test load fails until `src/commands/cli-team.ts` ships. Once
 * the implementation lands, replace the import with the real exports and
 * convert these `it.todo` scenarios into runnable assertions.
 */

import { describe, expect, it } from "vitest";

describe("agentbrew team set <url> — clone-and-install", () => {
  it("module exists at src/commands/cli-team.ts", async () => {
    // RED: this import fails today with `Cannot find module './commands/cli-team.js'`.
    // GREEN: implementation lands, import resolves.
    const mod = await import("./commands/cli-team.js" as never).catch((error: Error) => error);
    expect(mod, `cli-team module missing — see oss-split-implement-team-command`).not.toBeInstanceOf(Error);
  });

  it.todo("clones overlay repo to ~/.cache/agentbrew/teams/<label>/");
  it.todo("reads overlay's Agentfile.yaml on team set");
  it.todo("derives label from Agentfile `name:` field, fallback to repo basename");
  it.todo("merges Agentfile `mcp:` entries into state with origin: team:<label>");
  it.todo("merges Agentfile `sources:` entries into state with origin: team:<label>");
  it.todo("merges Agentfile `rules:` block into shared-rules with origin tag");
  it.todo("idempotent — re-running team set with same URL is a no-op");
  it.todo("prints operator-readable summary of what was added");
});
