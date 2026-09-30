import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../types.js", () => ({
  AGENT_DEFINITIONS: [{ name: "cursor", rulesDir: "~/.cursor/rules" }],
}));

import { collectCursorMdcInventory } from "./cursor-mdc-inventory.js";

describe("collectCursorMdcInventory", () => {
  let tempHome: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.HOME;
    tempHome = mkdtempSync(join(tmpdir(), "cursor-mdc-"));
    process.env.HOME = tempHome;
    const rulesDir = join(tempHome, ".cursor", "rules");
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, "always.mdc"), "---\nalwaysApply: true\n---\nbody\n", "utf-8");
    writeFileSync(
      join(rulesDir, "scoped.mdc"),
      '---\nglobs: ["**/example-plugin/**"]\nalwaysApply: false\n---\nbody\n',
      "utf-8",
    );
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  });

  it("totals bytes and splits always-applied vs scoped rules", () => {
    const inventory = collectCursorMdcInventory();
    expect(inventory?.files).toHaveLength(2);
    expect(inventory?.alwaysAppliedBytes).toBeGreaterThan(0);
    expect(inventory!.totalBytes).toBeGreaterThan(inventory!.alwaysAppliedBytes);
  });
});
