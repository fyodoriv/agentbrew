/** learn-project moved to careerbrew (one learning tool, with state across days); it must not come back here. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("learn-project lives in careerbrew", () => {
  it.each([
    "skill-plugins/dev/learn-project",
    "src/learn/stage-learn-sources.ts",
    "scripts/stage-learn-sources.ts",
    "docs/learn-project.md",
  ])("%s is gone", (path) => {
    expect(existsSync(join(ROOT, path))).toBe(false);
  });

  it("the catalog, package scripts, and docs index do not offer it", () => {
    expect(read("src/catalog.yaml")).not.toMatch(/name: learn-project\b/);
    expect(read("package.json")).not.toContain("stage-learn-sources");
    expect(read("docs/README.md")).not.toContain("learn-project.md");
  });

  it("the README points learners to careerbrew", () => {
    expect(read("README.md")).toMatch(/Learning a project moved to careerbrew/);
  });
});
