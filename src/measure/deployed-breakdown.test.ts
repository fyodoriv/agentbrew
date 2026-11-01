import { describe, expect, it } from "vitest";
import { breakdownDeployedRules } from "./deployed-breakdown.js";

const FIXTURE = [
  "<!-- agentbrew:instructions:start -->",
  "# Global Agent Context",
  "Use plain English in every reply you write for the user.",
  "<!-- agentbrew:instructions:end -->",
  "",
  "# Personal rules",
  "Use plain English in every reply you write for the user.",
  "",
  "<!-- agentbrew:start -->",
  "# agentbrew",
  "Shared rule text that every session loads.",
  "",
  "<!-- rule: conventional-commits -->",
  "Use conventional commits.",
  "",
  "## Shared section after a rule",
  "More shared text.",
  "",
  "<!-- agentfile-rules: agentbrew -->",
  "Team rule text.",
  "<!-- /agentfile-rules: agentbrew -->",
  "<!-- agentbrew:end -->",
].join("\n");

describe("breakdownDeployedRules (#518)", () => {
  const result = breakdownDeployedRules(FIXTURE);
  const source = (name: string) => result.sources.find((s) => s.source === name);

  it("splits the file into its sources by marker", () => {
    expect(result.sources.map((s) => s.source).sort()).toEqual([
      "agentbrew instructions",
      "catalog rules",
      "personal (outside markers)",
      "shared rules",
      "team rules",
    ]);
    expect(source("catalog rules")?.blocks).toEqual(["conventional-commits"]);
    expect(source("team rules")?.blocks).toEqual(["agentbrew"]);
  });

  it("ends a catalog rule at the next heading, so shared text after it is not counted as the rule", () => {
    expect(source("catalog rules")?.chars).toBe("Use conventional commits.".length + 1);
    expect(source("shared rules")?.chars).toBeGreaterThan("Shared rule text that every session loads.".length);
  });

  it("gives each source a share that sums to 100", () => {
    const total = result.sources.reduce((sum, s) => sum + s.sharePct, 0);
    expect(Math.round(total)).toBe(100);
    expect(result.totalChars).toBe(result.sources.reduce((sum, s) => sum + s.chars, 0));
  });

  it("lists a long line found in two sources as a duplicate", () => {
    expect(result.duplicates).toEqual([
      {
        text: "Use plain English in every reply you write for the user.",
        sources: ["agentbrew instructions", "personal (outside markers)"],
      },
    ]);
  });

  it("returns no sources for an empty file", () => {
    expect(breakdownDeployedRules("").sources).toEqual([]);
  });
});
