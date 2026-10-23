import { describe, expect, it } from "vitest";
import type { Source } from "../types.js";
import { installedSkillClashes, installedSkillOwners } from "./skill-owners.js";

function source(url: string, skillsInstalled: string[]): Source {
  return { url, type: "github", skillsInstalled, availableItems: [], addedAt: "2026-01-01" };
}

describe("installed skill owners", () => {
  const sources = [
    source("obra/superpowers", ["writing-plans", "tdd"]),
    source("other/repo", ["solo"]),
    source("fyodoriv/agentbrew", ["writing-plans"]),
  ];

  it("gives a name shipped by two sources to the source listed later", () => {
    const owners = installedSkillOwners(sources);
    expect(owners.get("writing-plans")).toBe("fyodoriv/agentbrew");
    expect(owners.get("tdd")).toBe("obra/superpowers");
  });

  it("lists each clash with its owner and the skipped sources", () => {
    expect(installedSkillClashes(sources)).toEqual([
      { skill: "writing-plans", owner: "fyodoriv/agentbrew", skipped: ["obra/superpowers"] },
    ]);
  });

  it("leaves local sources out, since they deploy from their own folder", () => {
    const withLocal = [
      source("org/remote", ["shared"]),
      { ...source("/Users/me/skills", ["shared"]), type: "local" as const },
    ];
    expect(installedSkillOwners(withLocal).get("shared")).toBe("org/remote");
    expect(installedSkillClashes(withLocal)).toEqual([]);
  });

  it("skips a source that cannot supply the skill", () => {
    const owners = installedSkillOwners(sources, (s) => s.url !== "fyodoriv/agentbrew");
    expect(owners.get("writing-plans")).toBe("obra/superpowers");
  });
});
