import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findSkillDirInCache } from "./index-source.js";
import { loadBaseCatalog } from "./types.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const name = "modern-web-guidance";

describe("Modern Web Guidance catalog routing", () => {
  it("registers one provider and discovers its managed installation source", () => {
    const catalog = loadBaseCatalog();
    expect(catalog.skills.filter((entry) => entry.name === name)).toEqual([
      expect.objectContaining({ recommended: true, preserveExisting: true, source: "fyodoriv/agentbrew" }),
    ]);
    expect(catalog.skills.some((entry) => ["web-design-guidelines", "chrome-extensions"].includes(entry.name))).toBe(
      false,
    );
    expect(catalog.repo_sources?.some((entry) => entry.source.toLowerCase().includes(name)) ?? false).toBe(false);
    expect(catalog.claude_plugins?.some((entry) => entry.repo.toLowerCase().includes(name)) ?? false).toBe(false);
    expect(findSkillDirInCache(root, name)).toBe(join(root, "skills", name));
    for (const path of ["commands/agentbrew.md", "skill-plugins/dev/agentbrew-status/SKILL.md"]) {
      expect(readFileSync(join(root, path), "utf8")).toContain(`agentbrew install ${name}`);
    }
  });

  it("keeps one default route for implementation, visual direction, and broad audits", () => {
    const catalog = loadBaseCatalog();
    const bundle = catalog.bundles?.find((entry) => entry.name === "frontend-kit");
    expect(bundle?.members).toEqual([
      "hallmark",
      "shadcn",
      name,
      "ui-ux-rankings",
      "playwright-best-practices",
      "playwright",
      "chrome-devtools",
    ]);
    for (const alternative of ["frontend-design", "effective-ui-design", "web-quality-audit"]) {
      expect(catalog.skills.find((entry) => entry.name === alternative)?.recommended).toBe(false);
    }
  });

  it("keeps the CLI and extension references fixed and covers the seven routes", () => {
    const folder = join(root, "skills", name);
    const skill = readFileSync(join(folder, "SKILL.md"), "utf8");
    const executions = [...skill.matchAll(/npx --yes modern-web-guidance@(\S+)\s/g)];
    expect(executions.map((match) => match[1])).toEqual(["1.0.1", "1.0.1", "1.0.1"]);
    expect(skill).toContain("/blob/64a6d708f5a43f2cd3fde5d4d7db3905ba1bdf65/skills/chrome-extensions/SKILL.md");
    const cases = JSON.parse(readFileSync(join(folder, "evals", "evals.json"), "utf8"));
    expect(cases.evals.map((entry: { id: number }) => entry.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
