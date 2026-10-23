/** The recommended "default to these repos" rule from #442. */
import { describe, expect, it } from "vitest";
import { loadCatalog } from "./types.js";

describe("default-to-these-repos rule (#442)", () => {
  it("is a recommended catalog rule that says to extend an installed source before writing a local copy", () => {
    const rule = loadCatalog().rules.find((r) => r.name === "default-to-these-repos");
    expect(rule?.recommended).toBe(true);
    expect(rule?.content).toMatch(/search the installed sources/i);
    expect(rule?.content).toMatch(/~\/\.claude/);
    expect(rule?.content).toMatch(/issue or a PR/i);
  });
});
