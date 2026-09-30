import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("scripts/measure-context-budget.sh", () => {
  it("delegates to agentbrew measure context", () => {
    const script = readFileSync(join(process.cwd(), "scripts/measure-context-budget.sh"), "utf-8");
    expect(script).toContain("agentbrew measure context");
    expect(script).toContain("dist/cli.js measure context");
  });
});
