import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkClaudePluginDrift } from "./catalog/claude-plugin.js";

function fixture() {
  const plugins = join(homedir(), ".claude/plugins");
  const source = join(mkdtempSync(join(homedir(), "mod-source-")), "mods");
  mkdirSync(join(source, ".claude-plugin"), { recursive: true });
  mkdirSync(plugins, { recursive: true });
  writeFileSync(join(source, ".claude-plugin/marketplace.json"), JSON.stringify({ plugins: [] }));
  writeFileSync(
    join(plugins, "known_marketplaces.json"),
    JSON.stringify({
      "agentbrew-mods": { source: { source: "directory", path: source } },
    }),
  );
  const registry = join(plugins, "installed_plugins.json");
  const content = JSON.stringify({
    version: 2,
    plugins: {
      "work-pane@agentbrew-mods": [{ scope: "user" }],
      "personal@other-market": [{ scope: "user" }],
    },
  });
  writeFileSync(registry, content);
  return { registry, content, source };
}

describe("retired installed mods", () => {
  it("reports a retired user mod with its uninstall command without changing the registry", () => {
    const f = fixture();
    const drift = checkClaudePluginDrift([]);
    expect(drift).toHaveLength(1);
    expect(drift[0].detail).toContain("claude plugin uninstall work-pane@agentbrew-mods --scope user");
    expect(readFileSync(f.registry, "utf-8")).toBe(f.content);
  });

  it("keeps a mod whose listed source still exists", () => {
    const f = fixture();
    mkdirSync(join(f.source, "work-pane"));
    writeFileSync(
      join(f.source, ".claude-plugin/marketplace.json"),
      JSON.stringify({
        plugins: [{ name: "work-pane", source: "./work-pane" }],
      }),
    );
    expect(checkClaudePluginDrift([])).toEqual([]);
  });

  it("reports an installed mod whose still-listed source folder disappeared", () => {
    const f = fixture();
    writeFileSync(
      join(f.source, ".claude-plugin/marketplace.json"),
      JSON.stringify({
        plugins: [{ name: "work-pane", source: "./work-pane" }],
      }),
    );
    expect(checkClaudePluginDrift([])).toHaveLength(1);
  });

  it("leaves project-scope installations alone", () => {
    const f = fixture();
    writeFileSync(
      f.registry,
      JSON.stringify({
        version: 2,
        plugins: {
          "work-pane@agentbrew-mods": [{ scope: "project" }],
        },
      }),
    );
    expect(checkClaudePluginDrift([])).toEqual([]);
  });

  it("does not infer retirement from unavailable marketplace metadata", () => {
    fixture();
    writeFileSync(join(homedir(), ".claude/plugins/known_marketplaces.json"), "{}");
    expect(checkClaudePluginDrift([])).toEqual([]);
  });
});
