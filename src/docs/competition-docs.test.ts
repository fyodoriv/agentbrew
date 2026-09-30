import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyGeneratedSection,
  type CompetitionSnapshot,
  findCompetitionNarrativeDrift,
  README_TABLE_ROWS,
  renderCompetitionFreshnessTracker,
  renderCompetitionReadmeTable,
  syncCompetitionDocs,
} from "./competition-docs.js";

const snapshot: CompetitionSnapshot = {
  lastRefreshed: "2026-04-11",
  summary: "monthly refresh — skills CLI 13.7K stars, 50+ agents, still no MCP/rules sync or drift detection.",
  freshness: [
    {
      tool: "skills CLI (Vercel)",
      lastResearched: "2026-04-11",
      stars: "13.7K",
      status: "Stars 13.6K→13.7K. Still no MCP sync, no rules sync, no drift detection.",
    },
    {
      tool: "MCPM (mcpm.sh)",
      lastResearched: "2026-04-11",
      stars: "926",
      status: "Stars 925→926. No feature changes.",
    },
  ],
  readmeComparison: [
    {
      name: "AgentBrew",
      skillsSync: "50+ agents",
      mcpSync: "15+ agents",
      rulesSync: "8 agents",
      commandsSync: "7 agents",
      hooksSync: "1 agent",
      driftDetection: "Auto (30 min)",
      autoRepair: "Yes",
      catalog: "150+ items",
      declarativeConfig: "Agentfile",
      lockFile: "SHA tracking",
      exportImport: "Yes",
    },
    {
      name: "[skills CLI](https://github.com/vercel-labs/skills)",
      skillsSync: "50+ agents",
      mcpSync: "—",
      rulesSync: "—",
      commandsSync: "—",
      hooksSync: "—",
      driftDetection: "—",
      autoRepair: "—",
      catalog: "skills.sh",
      declarativeConfig: "—",
      lockFile: "Yes (v3)",
      exportImport: "—",
    },
  ],
};

describe("renderCompetitionFreshnessTracker", () => {
  it("renders the shared freshness tracker markdown", () => {
    expect(renderCompetitionFreshnessTracker(snapshot)).toContain("| skills CLI (Vercel) | 2026-04-11 | 13.7K |");
  });
});

describe("renderCompetitionReadmeTable", () => {
  it("renders the README comparison table from the snapshot", () => {
    expect(renderCompetitionReadmeTable(snapshot)).toContain("| Skills sync | 50+ agents | 50+ agents |");
  });

  it("renders one row per README_TABLE_ROWS entry in declaration order", () => {
    const rendered = renderCompetitionReadmeTable(snapshot);
    const labels = README_TABLE_ROWS.map((r) => r.label);
    // Every declared label appears exactly once.
    for (const label of labels) {
      expect(rendered).toContain(`| ${label} |`);
    }
    // The render order matches the declaration order — each label's index
    // in the output string must be monotonically increasing.
    const indexes = labels.map((label) => rendered.indexOf(`| ${label} |`));
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });
});

describe("README_TABLE_ROWS snapshot coverage", () => {
  it("every snapshot entry populates every declared row key", () => {
    // This is the guard that used to be missing: before
    // `competition-table-row-decoupling` landed, an entry could silently
    // forget to set `lockFile` or `exportImport` because TypeScript would
    // not complain about JSON input shapes. Now the test walks the
    // declarative array and asserts every field is present on every entry.
    for (const entry of snapshot.readmeComparison) {
      for (const { key } of README_TABLE_ROWS) {
        expect(entry[key], `${entry.name} is missing ${key}`).toBeDefined();
      }
    }
  });

  it("every production snapshot entry populates every declared row key", () => {
    // Same guard, but against the real on-disk snapshot so a contributor
    // who adds a new row but forgets to update docs/competition-snapshot.json
    // fails CI here.
    const productionPath = join(__dirname, "..", "..", "docs", "competition-snapshot.json");
    const production = JSON.parse(readFileSync(productionPath, "utf-8")) as CompetitionSnapshot;
    for (const entry of production.readmeComparison) {
      for (const { key } of README_TABLE_ROWS) {
        expect(entry[key], `${entry.name} is missing ${key}`).toBeDefined();
      }
    }
  });
});

describe("applyGeneratedSection", () => {
  it("replaces only the content inside a generated section marker", () => {
    const markdown = [
      "before",
      "<!-- competition-snapshot:start -->",
      "old",
      "<!-- competition-snapshot:end -->",
      "after",
    ].join("\n");

    expect(applyGeneratedSection(markdown, "competition-snapshot", "new content")).toContain("new content");
  });
});

describe("findCompetitionNarrativeDrift", () => {
  it("flags stale tracked counts that remain in handwritten competition sections", () => {
    const markdown = [
      "# Competition",
      "",
      "<!-- competition-freshness:start -->",
      renderCompetitionFreshnessTracker(snapshot),
      "<!-- competition-freshness:end -->",
      "",
      "- skills CLI remains a threat at 13.6K stars.",
      "- anthropics/skills keeps growing at 115.5K stars.",
    ].join("\n");

    expect(findCompetitionNarrativeDrift(markdown, snapshot)).toEqual([
      'Stale count for "skills CLI (Vercel)": found "13.6K" outside generated sections; expected "13.7K".',
    ]);
  });
});

describe("syncCompetitionDocs", () => {
  it("fails before rewriting docs when handwritten narrative counts drift from the snapshot", () => {
    const directory = mkdtempSync(join(tmpdir(), "competition-docs-"));
    const snapshotPath = join(directory, "competition-snapshot.json");
    const readmePath = join(directory, "README.md");
    const competitionDocPath = join(directory, "COMPETITION.md");
    const readme = [
      "# README",
      "",
      "<!-- competition-readme-table:start -->",
      "stale table",
      "<!-- competition-readme-table:end -->",
    ].join("\n");
    const competitionDoc = [
      "# Competition",
      "",
      "<!-- competition-freshness:start -->",
      "stale tracker",
      "<!-- competition-freshness:end -->",
      "",
      "- skills CLI remains a threat at 13.6K stars.",
    ].join("\n");

    writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");
    writeFileSync(readmePath, readme, "utf8");
    writeFileSync(competitionDocPath, competitionDoc, "utf8");

    expect(() => syncCompetitionDocs(snapshotPath, readmePath, competitionDocPath)).toThrowError(
      /Competition doc narrative drift detected outside generated sections/u,
    );
    expect(readFileSync(readmePath, "utf8")).toBe(readme);
    expect(readFileSync(competitionDocPath, "utf8")).toBe(competitionDoc);
  });
});
