import { describe, expect, it } from "vitest";
import { findBundle, missingBundleMembers } from "./bundles.js";
import { type Catalog, loadBaseCatalog } from "./types.js";

const tiny: Catalog = {
  skills: [{ name: "tdd", description: "", source: "x/y", category: "dev", recommended: false }],
  mcp_servers: [{ name: "docs-mcp", description: "", category: "dev", recommended: false, command: "npx", args: [] }],
  rules: [{ name: "a-rule", description: "", category: "dev", recommended: false, content: "x" }],
  bundles: [
    { name: "good", description: "", members: ["tdd", "docs-mcp", "a-rule"] },
    { name: "bad", description: "", members: ["tdd", "no-such-item"] },
  ],
};

describe("catalog bundles", () => {
  it("resolves a bundle whose members are a skill, an MCP server, and a rule", () => {
    const bundle = findBundle(tiny, "good");
    expect(bundle?.members).toEqual(["tdd", "docs-mcp", "a-rule"]);
    expect(missingBundleMembers(tiny, bundle as NonNullable<typeof bundle>)).toEqual([]);
  });

  it("reports a missing member", () => {
    const bundle = findBundle(tiny, "bad");
    expect(missingBundleMembers(tiny, bundle as NonNullable<typeof bundle>)).toEqual(["no-such-item"]);
  });

  it("keeps the shipped bundles valid: every member exists and no bundle shadows an item", () => {
    const catalog = loadBaseCatalog();
    const bundles = catalog.bundles ?? [];
    expect(bundles.length).toBeGreaterThan(0);
    const itemNames = new Set(
      [...catalog.skills, ...catalog.mcp_servers, ...catalog.rules, ...(catalog.cli_tools ?? [])].map((i) => i.name),
    );
    for (const bundle of bundles) {
      expect(missingBundleMembers(catalog, bundle), bundle.name).toEqual([]);
      expect(itemNames.has(bundle.name), `${bundle.name} shadows a catalog item`).toBe(false);
      expect(new Set(bundle.members).size, `${bundle.name} repeats a member`).toBe(bundle.members.length);
    }
  });
});
