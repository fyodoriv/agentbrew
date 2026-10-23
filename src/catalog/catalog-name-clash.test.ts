/** No catalog rule, MCP server, or CLI tool may take a built-in skill's name. */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "./types.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

/** Shared names that stay, each with the reason. */
const ALLOWED: Record<string, string> = {
  "load-project-context":
    "the rule tells agents to run the skill's script; `agentbrew install` installs the rule and says the skill shares the name",
};

describe("catalog names vs built-in skills", () => {
  it("only allowlisted rules, MCP servers, or CLI tools share a built-in skill's name", () => {
    const devDir = join(REPO_ROOT, "skill-plugins", "dev");
    const builtIn = new Set(readdirSync(devDir).filter((n) => existsSync(join(devDir, n, "SKILL.md"))));
    const catalog = loadCatalog();
    const others = [
      ...catalog.rules.map((r) => r.name),
      ...catalog.mcp_servers.map((s) => s.name),
      ...(catalog.cli_tools ?? []).map((t) => t.name),
    ];
    const shared = [...new Set(others.filter((n) => builtIn.has(n)))].sort();
    expect(shared).toEqual(Object.keys(ALLOWED).sort());
  });
});
