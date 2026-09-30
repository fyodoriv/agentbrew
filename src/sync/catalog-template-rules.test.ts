import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadManifest } from "../manifest.js";
import {
  CATALOG_OWNED_RULE_FILES,
  findAgentbrewRepoRoot,
  refreshCatalogTemplateRules,
} from "./catalog-template-rules.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const temporaryRoots: string[] = [];

function temporaryDir(): string {
  const root = mkdtempSync(join(tmpdir(), "agentbrew-catalog-rules-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("findAgentbrewRepoRoot", () => {
  it("finds the agentbrew repo from compiled test location", () => {
    expect(findAgentbrewRepoRoot()).toBe(REPO_ROOT);
  });
});

describe("refreshCatalogTemplateRules", () => {
  it("copies catalog-owned templates into ~/.config/agentbrew/rules", () => {
    const home = temporaryDir();
    const repoRoot = REPO_ROOT;
    const rulesDir = join(home, ".config", "agentbrew", "rules");
    mkdirSync(rulesDir, { recursive: true });

    // Stale deployed copy with broad glob (regression we are fixing).
    writeFileSync(join(rulesDir, "browser-tasks.mdc"), `---\nglobs: ["**/TASKS.md", "**/*.md"]\n---\n# stale\n`);

    const manifest = loadManifest();
    const result = refreshCatalogTemplateRules({
      repoRoot,
      rulesDir,
      manifest,
      dryRun: false,
    });

    expect(result.errors).toBe(0);
    expect(result.synced).toBeGreaterThan(0);

    const refreshed = readFileSync(join(rulesDir, "browser-tasks.mdc"), "utf-8");
    expect(refreshed).toMatch(/globs:\s*\["\*\*\/TASKS\.md"\]/);
    expect(refreshed).not.toMatch(/\*\*\/\*\.md/);
    expect(refreshed).toMatch(/9223/);
  });

  it("only refreshes files listed in CATALOG_OWNED_RULE_FILES", () => {
    expect(CATALOG_OWNED_RULE_FILES).toContain("agentbrew-session-protocol.mdc");
    expect(CATALOG_OWNED_RULE_FILES).toContain("browser-tasks.mdc");
    expect(CATALOG_OWNED_RULE_FILES).toContain("sso-background-work.mdc");
    expect(CATALOG_OWNED_RULE_FILES).toContain("code-style.mdc");
    expect(CATALOG_OWNED_RULE_FILES).toContain("gdoc-editing.mdc");
    expect(CATALOG_OWNED_RULE_FILES).toContain("plain-language-output.mdc");
    expect(CATALOG_OWNED_RULE_FILES).toContain("research-pull-latest.mdc");
    for (const file of CATALOG_OWNED_RULE_FILES) {
      expect(readFileSync(join(REPO_ROOT, "templates", "rules", file), "utf-8").length).toBeGreaterThan(20);
    }
  });

  it("ships the default plain-language rule as always applied", () => {
    const rule = readFileSync(join(REPO_ROOT, "templates", "rules", "plain-language-output.mdc"), "utf-8");

    expect(rule).toMatch(/alwaysApply:\s*true/);
    expect(rule).toMatch(/ASD-STE100-style plain\s+English/);
    expect(rule).toMatch(/Always write agent-authored natural-language\s+text for an ADHD audience/i);
    expect(rule).toMatch(/This rule is always active/);
    expect(rule).toMatch(/code comments/i);
  });

  it("requires an every-page browser screenshot sweep after GDoc edits", () => {
    const gdocRule = readFileSync(join(REPO_ROOT, "templates", "rules", "gdoc-editing.mdc"), "utf-8");

    expect(gdocRule).toContain("browser screenshot of every rendered page");
    expect(gdocRule).toContain("restart the full screenshot sweep from page 1");
    expect(gdocRule).toContain("fix every safe formatting or presentation issue");
    expect(gdocRule).toContain("Only then tell the user the document is ready for review");
  });
});
