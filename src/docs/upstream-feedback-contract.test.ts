import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf-8");

describe("upstream feedback: every agent offers a safe report", () => {
  it("CONTRIBUTING.md explains the welcome, the safety steps, and the opt-out", () => {
    const text = read("CONTRIBUTING.md").split("## Report problems and ideas")[1]?.split("\n## ")[0] ?? "";
    expect(text).toMatch(/Fyodor, the author of agentbrew, is glad to get every report/);
    expect(text).toMatch(/never posts anything on its own/);
    expect(text).toMatch(/agentbrew report --title/);
    expect(text).toMatch(/Only after your yes/);
    expect(text).toMatch(/second yes/);
    expect(text).toMatch(/agentbrew report --off/);
  });

  it("the always-loaded template tells every agent to offer and to ask first", () => {
    const text = read("templates/AGENTS.md").split("### Report tool problems upstream")[1]?.split("\n### ")[0] ?? "";
    expect(text).toMatch(/offer once to report it/);
    expect(text).toMatch(/post only after the person says yes/);
    expect(text).toMatch(/second\s+yes/);
    expect(text).toMatch(/report-upstream/);
  });

  it("the report-upstream skill ships, is recommended, and keeps its safety rules", () => {
    const skill = read("skill-plugins/workflow/report-upstream/SKILL.md");
    expect(skill).toMatch(/Never post, comment, or open a PR without the person's yes/);
    expect(skill).toMatch(/upstream-feedback\.off/);
    expect(skill).toMatch(/owns that repo/);
    const catalog = read("src/catalog.yaml");
    expect(catalog).toMatch(/- name: report-upstream\n(?:.*\n){3}\s+recommended: true/);
  });

  it("the repo agent guide points forks and clones at the report flow", () => {
    expect(read("AGENTS.md")).toMatch(/CONTRIBUTING\.md#report-problems-and-ideas/);
  });
});
