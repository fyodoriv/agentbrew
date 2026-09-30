import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Devin stdio MCP env inheritance smoke", () => {
  it("proves spawned MCP commands can read vars from the launching shell when config env omits them", () => {
    const previous = process.env.AGENTBREW_DEVIN_INHERITED_SECRET;
    process.env.AGENTBREW_DEVIN_INHERITED_SECRET = "inherited-ok";
    try {
      const output = execFileSync(process.execPath, [
        "-e",
        "process.stdout.write(process.env.AGENTBREW_DEVIN_INHERITED_SECRET ?? '')",
      ]).toString();
      expect(output).toBe("inherited-ok");
    } finally {
      if (previous === undefined) delete process.env.AGENTBREW_DEVIN_INHERITED_SECRET;
      else process.env.AGENTBREW_DEVIN_INHERITED_SECRET = previous;
    }
  });
});
