import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lint.js", () => ({
  lint: vi.fn().mockReturnValue(true),
  validateConfig: vi.fn().mockReturnValue({ errors: 0, warnings: 0, details: [] }),
}));

vi.mock("../status.js", () => ({
  collectStatusData: vi.fn().mockReturnValue({
    agents: [
      { name: "cursor", detected: true },
      { name: "claude-code", detected: true },
    ],
    mcpServers: [{ name: "github", source: "catalog" }],
    skills: [{ source: "dev", names: ["context-budget", "next-task"] }],
    commands: { count: 3, deployedTo: 2, totalTargets: 5 },
  }),
}));

import {
  buildContextBudgetSnapshot,
  CONTEXT_BUDGET_SCHEMA_VERSION,
  measureContextBudget,
  writeContextBudgetSnapshot,
} from "./context-budget.js";

describe("context-budget snapshot", () => {
  let tempHome: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.HOME;
    tempHome = mkdtempSync(join(tmpdir(), "agentbrew-metrics-"));
    process.env.HOME = tempHome;

    const configDir = join(tempHome, ".config", "agentbrew");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "shared-rules.md"), `## Big section\n\n${"word ".repeat(2000)}`, "utf-8");
    writeFileSync(join(configDir, "AGENTS.md"), "# Instructions\n\nShort body.\n", "utf-8");
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  });

  it("builds a schema-versioned snapshot with static and inventory fields", () => {
    const snapshot = buildContextBudgetSnapshot({ skipCcusage: true, quiet: true });
    expect(snapshot.schemaVersion).toBe(CONTEXT_BUDGET_SCHEMA_VERSION);
    expect(snapshot.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot.static.projectedDeployedTokens).toBeGreaterThan(0);
    expect(snapshot.static.topSections.length).toBeGreaterThan(0);
    expect(snapshot.inventory.detectedAgentCount).toBe(2);
    expect(snapshot.inventory.skillCount).toBe(2);
    expect(snapshot.runtime.ccusage.available).toBe(false);
    expect(snapshot.alerts).toEqual([]);
    expect(snapshot.cursorRing.automated).toBe(false);
    expect(snapshot.sources).toContain("agentbrew lint + rules-hygiene (static projected tokens)");
  });

  it("writes dated and latest JSON under ~/.config/agentbrew/metrics", () => {
    const snapshot = buildContextBudgetSnapshot({ skipCcusage: true, quiet: true });
    const paths = writeContextBudgetSnapshot(snapshot);
    expect(paths).toHaveLength(2);
    for (const filePath of paths) {
      expect(existsSync(filePath)).toBe(true);
      const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as { schemaVersion: number };
      expect(parsed.schemaVersion).toBe(CONTEXT_BUDGET_SCHEMA_VERSION);
    }
    expect(paths[1]).toContain("latest.json");
  });

  it("dry-run skips writes", () => {
    const result = measureContextBudget({ dryRun: true, skipCcusage: true, quiet: true });
    expect(result.writtenPaths).toEqual([]);
    expect(result.snapshot?.static.lintPassed).toBe(true);
    expect(existsSync(join(tempHome, ".config", "agentbrew", "metrics", "latest.json"))).toBe(false);
  });

  it("ifStaleMs skips capture when latest.json is fresh", () => {
    const snapshot = buildContextBudgetSnapshot({ skipCcusage: true, quiet: true });
    writeContextBudgetSnapshot(snapshot);
    const result = measureContextBudget({
      dryRun: true,
      skipCcusage: true,
      quiet: true,
      ifStaleMs: 6 * 60 * 60 * 1000,
    });
    expect(result.skipped).toBe(true);
    expect(result.snapshot).toBeUndefined();
  });
});
