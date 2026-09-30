import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { DEPLOYED_RULES_FILE_CHAR_BUDGET, projectedDeployedRulesSize } from "../rules-hygiene.js";
import type { Catalog } from "./types.js";

function loadFixtureCatalog(): Catalog {
  return yaml.load(readFileSync(join(import.meta.dirname, "..", "catalog.yaml"), "utf-8")) as Catalog;
}

function loadInstructionsTemplate(): string {
  return readFileSync(join(import.meta.dirname, "..", "..", "templates", "AGENTS.md"), "utf-8");
}

function recommendedRulesContent(catalog: Catalog): string {
  return catalog.rules
    .filter((rule) => rule.recommended)
    .map((rule) => `<!-- rule: ${rule.name} -->\n${rule.content.trim()}`)
    .join("\n\n");
}

describe("recommended catalog rules budget", () => {
  it("keeps generated instruction files under the deployed rules budget", () => {
    const projectedSize = projectedDeployedRulesSize(
      loadInstructionsTemplate(),
      recommendedRulesContent(loadFixtureCatalog()),
    );

    expect(projectedSize).toBeLessThanOrEqual(DEPLOYED_RULES_FILE_CHAR_BUDGET);
  });
});
