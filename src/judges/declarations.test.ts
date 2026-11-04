import { describe, expect, it } from "vitest";
import { parseAgentfile } from "../agentfile.js";

describe("Agentfile judge declarations", () => {
  it("keeps explicit relative Markdown judge paths in declaration order", () => {
    expect(parseAgentfile("judges: [./judges/clarity.md, judges/reality.md]")).toHaveProperty("judges", [
      "judges/clarity.md",
      "judges/reality.md",
    ]);
  });

  it.each([
    ["scalar", "judges: judges/clarity.md"],
    ["non-string entry", "judges: [false]"],
    ["absolute path", "judges: [/judges/clarity.md]"],
    ["parent traversal", "judges: [../judges/clarity.md]"],
    ["duplicate path", "judges: [./judges/clarity.md, judges/clarity.md]"],
  ])("refuses %s", (_name, yaml) => {
    expect(() => parseAgentfile(yaml)).toThrow("Invalid judges declaration");
  });
});
