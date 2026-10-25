import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requireTerms, type SkillEval, scenarioText } from "./skill-contract-test-helpers.js";

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf-8");
const SETUP_SKILLS = [
  "agentbrew-add-skill",
  "agentbrew-add-mcp",
  "agentbrew-add-command",
  "agentbrew-add-catalog-source",
];
const EVAL_SKILLS = ["agentbrew-add-skill", "agentbrew-add-mcp"];

describe("every tool setup starts with a duplicate and conflict preflight", () => {
  it("shared rules: a tool setup checks duplicates and conflicts, proves it works, and pins versions", () => {
    const rule = read("docs", "shared-rules.md").split("## Tool setup preflight")[1]?.split("\n## ")[0] ?? "";
    requireTerms(rule, [
      /duplicates and conflicts/,
      /hooks, the status line, MCP servers, skills, LaunchAgents, and plugins/,
      /scratch HOME/,
      /pin/i,
    ]);
  });

  for (const skill of SETUP_SKILLS) {
    it(`${skill}: has the preflight step before any install`, () => {
      const text = read("skill-plugins", "dev", skill, "SKILL.md");
      requireTerms(text, ["Preflight: duplicates, conflicts, pins", "scratch HOME", "LaunchAgents"]);
      const preflight = text.indexOf("Preflight: duplicates, conflicts, pins");
      const install = text.search(/agentbrew (install|sync|mcp add)/);
      expect(preflight, "preflight comes before the first install or sync command").toBeLessThan(install);
    });
  }

  for (const skill of EVAL_SKILLS) {
    it(`${skill}: an eval covers the preflight`, () => {
      const evals = (JSON.parse(read("skill-plugins", "dev", skill, "evals", "evals.json")) as { evals: SkillEval[] })
        .evals;
      const hit = evals.find((e) => /duplicate/i.test(scenarioText(e)) && /scratch HOME/.test(scenarioText(e)));
      expect(hit, "an eval asks for the duplicate/conflict check in a scratch HOME").toBeDefined();
    });
  }
});
