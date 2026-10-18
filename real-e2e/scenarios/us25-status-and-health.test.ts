import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  copyFixtureDirectories,
  runScenarioCli,
  runWithScenarioSandbox,
  seedScenarioState,
} from "../../src/real-e2e/scenario-fixture.js";

// US25: `agentbrew status` says what is configured and what is drifting, and
// every drift item names its fix. Sync events land in the content-free log.

describe("us25 status and health", () => {
  it("reports a clean sync in the event log, then names the fix for each drift item", async () => {
    await runWithScenarioSandbox("us25-status-and-health", async ({ fixtureDir, rootDir }) => {
      const homeDir = join(rootDir, "home");
      const projectDir = join(rootDir, "project");
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const eventsFile = join(rootDir, "events.jsonl");
      const extraEnv = { AGENTBREW_EVENTS: "1", AGENTBREW_EVENTS_FILE: eventsFile };

      copyFixtureDirectories(fixtureDir, [
        { from: "home", to: homeDir },
        { from: "project", to: projectDir },
      ]);
      await seedScenarioState(homeDir, repoRoot);

      // Happy path: a sync deploys the server and logs one content-free event.
      await runScenarioCli({
        repoRoot,
        homeDir,
        extraEnv,
        args: ["sync", "--only", "mcp", "--sequential", "--agentfile", join(projectDir, "Agentfile.yaml")],
      });
      const kiroConfig = join(homeDir, ".kiro", "settings", "mcp.json");
      expect(readFileSync(kiroConfig, "utf-8")).toContain("team-api");

      expect(existsSync(eventsFile)).toBe(true);
      const log = readFileSync(eventsFile, "utf-8");
      const events = log
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { event: string; story: string; ok: boolean });
      // `sync --agentfile` serves US23 (cross-repo discovery).
      expect(events).toContainEqual(expect.objectContaining({ event: "sync", story: "US23", ok: true }));
      // Content-free: no server name, path, or home folder in the log.
      expect(log).not.toContain("team-api");
      expect(log).not.toContain(homeDir);

      // Error path: remove the server by hand; status --ci fails and names the fix.
      writeFileSync(kiroConfig, '{"mcpServers":{}}\n', "utf-8");
      const failed = await runScenarioCli({ repoRoot, homeDir, extraEnv, args: ["status", "--ci"] }).then(
        () => undefined,
        (error: { code?: number; stderr?: string }) => error,
      );
      expect(failed?.code).toBe(1);
      expect(failed?.stderr).toContain("status=failed");
      expect(failed?.stderr).toContain("kiro [mcp] missing server: team-api — fix: agentbrew sync --only mcp");

      // The failed check is logged against its story, still content-free.
      const after = readFileSync(eventsFile, "utf-8");
      expect(after).toContain('"event":"command","story":"US25","ok":false');
      expect(after).not.toContain("team-api");
    });
  }, 60_000);
});
