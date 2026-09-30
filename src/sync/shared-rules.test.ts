import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

describe("shared delivery rules", () => {
  const sharedRules = readFileSync(join(REPO_ROOT, "docs", "shared-rules.md"), "utf-8");

  it("does not name user-private commands", () => {
    expect(sharedRules).toMatch(/## User-private commands/);
    expect(sharedRules).not.toMatch(/ship-it/i);
  });

  it("requires a current base before implementation", () => {
    expect(sharedRules).toMatch(/Rebase an owned feature branch onto `origin\/<default>`/);
  });
});
