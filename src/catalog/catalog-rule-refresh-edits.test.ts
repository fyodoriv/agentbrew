import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addRuleToSharedRules, refreshRecommendedCatalogRules } from "./install-other.js";
import type { CatalogRule } from "./types.js";

const rule = (content: string): CatalogRule => ({
  name: "load-project-context",
  description: "Load context",
  category: "workflow",
  recommended: true,
  content,
});

let home: string;
let rulesPath: string;
let savedHome: string | undefined;

const read = (): string => readFileSync(rulesPath, "utf-8");
const count = (text: string, needle: string): number => text.split(needle).length - 1;

beforeEach(() => {
  savedHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "agentbrew-rule-refresh-"));
  process.env.HOME = home;
  mkdirSync(join(home, ".config", "agentbrew"), { recursive: true });
  rulesPath = join(home, ".config", "agentbrew", "shared-rules.md");
  writeFileSync(rulesPath, "# Shared rules\n\n## Pull/fetch latest workflow\n", "utf-8");
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

describe("catalog rule refresh protects user edits", () => {
  it("replaces an untouched catalog block exactly once, then is a no-op", () => {
    addRuleToSharedRules(rule("Old bulky body.\nSecond line."));
    const first = refreshRecommendedCatalogRules([rule("Short body.")]);
    expect(first.refreshed).toEqual(["load-project-context"]);
    expect(count(read(), "<!-- rule: load-project-context -->")).toBe(1);
    expect(read()).toContain("Short body.");
    expect(read()).not.toContain("Old bulky body.");

    const second = refreshRecommendedCatalogRules([rule("Short body.")]);
    expect(second.refreshed).toEqual([]);
    expect(second.unchanged).toBe(1);
  });

  it("preserves a block the user edited after install", () => {
    addRuleToSharedRules(rule("Old body."));
    writeFileSync(rulesPath, read().replace("Old body.", "Old body. My own tweak."), "utf-8");

    const result = refreshRecommendedCatalogRules([rule("Short body.")]);
    expect(result.refreshed).toEqual([]);
    expect(result.preserved).toEqual(["load-project-context"]);
    expect(read()).toContain("My own tweak.");
  });

  it("preserves a marker with no recorded catalog hash, and replaces it with force", () => {
    writeFileSync(rulesPath, `${read()}\n<!-- rule: load-project-context -->\nHand written.\n`, "utf-8");

    const safe = refreshRecommendedCatalogRules([rule("Short body.")]);
    expect(safe.preserved).toEqual(["load-project-context"]);
    expect(read()).toContain("Hand written.");

    const forced = refreshRecommendedCatalogRules([rule("Short body.")], { force: true });
    expect(forced.refreshed).toEqual(["load-project-context"]);
    expect(read()).not.toContain("Hand written.");
    expect(count(read(), "<!-- rule: load-project-context -->")).toBe(1);
  });

  it("dry run reports the diff and writes nothing", () => {
    addRuleToSharedRules(rule("Old body."));
    const before = read();
    const result = refreshRecommendedCatalogRules([rule("Short body.")], { dryRun: true });
    expect(result.refreshed).toEqual([]);
    expect(result.wouldRefresh).toEqual([{ name: "load-project-context", before: "Old body.", after: "Short body." }]);
    expect(read()).toBe(before);
  });
});
