import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { copyFixtureDirectories, runScenarioCli, runWithScenarioSandbox } from "../../src/real-e2e/scenario-fixture.js";

// US24: `agentbrew catalog` shows what can be installed, and a search or a
// detail view for a missing item says so and points back to the catalog.

describe("us24 browse the catalog", () => {
  it("lists and searches catalog items, and explains a missing one", async () => {
    await runWithScenarioSandbox("us24-browse-catalog", async ({ fixtureDir, rootDir }) => {
      const homeDir = join(rootDir, "home");
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      copyFixtureDirectories(fixtureDir, [{ from: "home", to: homeDir }]);

      const search = await runScenarioCli({
        repoRoot,
        homeDir,
        args: ["catalog", "--search", "find-skills", "--json"],
      });
      const found = JSON.parse(search.stdout) as { skills: { name: string; source: string }[] };
      expect(found.skills).toContainEqual(
        expect.objectContaining({ name: "find-skills", source: "vercel-labs/skills" }),
      );

      const missing = await runScenarioCli({ repoRoot, homeDir, args: ["catalog", "show", "no-such-item-xyz"] });
      expect(`${missing.stdout}${missing.stderr}`).toContain("'no-such-item-xyz' not found in catalog or sources.");
      expect(`${missing.stdout}${missing.stderr}`).toContain("Run `agentbrew catalog` to see available items.");
    });
  }, 60_000);
});
