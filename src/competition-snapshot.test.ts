import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  findCompetitionNarrativeDrift,
  loadCompetitionSnapshot,
  renderCompetitionFreshnessTracker,
  renderCompetitionReadmeTable,
} from "./docs/competition-docs.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const readmePath = path.join(repositoryRoot, "README.md");
const competitionDocPath = path.join(repositoryRoot, "docs", "COMPETITION.md");
const snapshotPath = path.join(repositoryRoot, "docs", "competition-snapshot.json");

function readGeneratedSection(markdown: string, marker: string): string {
  const match = markdown.match(new RegExp(`<!-- ${marker}:start -->\\n([\\s\\S]*?)\\n<!-- ${marker}:end -->`, "u"));
  expect(match?.[1]).toBeDefined();
  return match![1];
}

describe("competition snapshot", () => {
  it("keeps the README comparison table generated from the tracked snapshot", () => {
    const snapshot = loadCompetitionSnapshot(snapshotPath);
    const readme = readFileSync(readmePath, "utf8");

    expect(readGeneratedSection(readme, "competition-readme-table")).toBe(renderCompetitionReadmeTable(snapshot));
  });

  it("keeps the COMPETITION freshness tracker generated from the tracked snapshot", () => {
    const snapshot = loadCompetitionSnapshot(snapshotPath);
    const competitionDoc = readFileSync(competitionDocPath, "utf8");

    expect(readGeneratedSection(competitionDoc, "competition-freshness")).toBe(
      renderCompetitionFreshnessTracker(snapshot),
    );
  });

  it("keeps handwritten COMPETITION narrative counts aligned with the tracked snapshot", () => {
    const snapshot = loadCompetitionSnapshot(snapshotPath);
    const competitionDoc = readFileSync(competitionDocPath, "utf8");

    expect(findCompetitionNarrativeDrift(competitionDoc, snapshot)).toEqual([]);
  });
});
