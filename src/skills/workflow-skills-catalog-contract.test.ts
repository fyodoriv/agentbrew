import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

interface CatalogSkill {
  name: string;
  source: string;
  recommended?: boolean;
}

const repoRoot = process.cwd();
const workflowRoot = join(repoRoot, "skill-plugins", "workflow");
const catalog = yaml.load(readFileSync(join(repoRoot, "src", "catalog.yaml"), "utf-8")) as { skills: CatalogSkill[] };
const workflowSkills = readdirSync(workflowRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(workflowRoot, entry.name, "SKILL.md")))
  .map((entry) => entry.name)
  .sort();

describe("skill-plugins/workflow catalog contract", () => {
  it("holds the workflow skills absorbed from the former dev-skills repo", () => {
    expect(workflowSkills).toEqual(
      expect.arrayContaining(["grind", "iterate", "sweep", "task-command-center", "writing-plans"]),
    );
  });

  it("gives every workflow skill a catalog entry sourced from fyodoriv/agentbrew", () => {
    const byName = new Map(catalog.skills.map((skill) => [skill.name, skill]));
    for (const name of workflowSkills) {
      expect(byName.get(name)?.source, name).toBe("fyodoriv/agentbrew");
    }
  });

  it("points every fyodoriv/agentbrew catalog skill at a workflow skill directory", () => {
    const agentbrewSourced = catalog.skills.filter((skill) => skill.source === "fyodoriv/agentbrew").map((s) => s.name);
    expect(agentbrewSourced.sort()).toEqual(workflowSkills);
  });

  it("leaves no catalog entry on the retired dev-skills repo", () => {
    expect(catalog.skills.filter((skill) => skill.source === "fyodoriv/dev-skills")).toEqual([]);
  });

  it("ships an evals file for every workflow skill", () => {
    for (const name of workflowSkills) {
      expect(existsSync(join(workflowRoot, name, "evals", "evals.json")), name).toBe(true);
    }
  });
});
