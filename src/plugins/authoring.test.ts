/** Plugin authoring tools — `plugin new`, `plugin test`, `plugin migrate` (#208 step 11). */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { migrateOverlay, scaffoldPlugin, testPlugin } from "./authoring.js";
import { validateManifest } from "./manifest.js";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "plugin-author-"));
}

describe("plugin new", () => {
  it("scaffolds a plugin that passes plugin test", () => {
    const dir = join(scratch(), "acme-plugin");
    scaffoldPlugin(dir, "acme");

    const manifest = yaml.load(readFileSync(join(dir, "agentbrew-plugin.yaml"), "utf-8"));
    expect(validateManifest(manifest).ok).toBe(true);
    for (const f of ["rules/example.md", "skills/example/SKILL.md", "leak-patterns.yaml", ".gitignore", "README.md"]) {
      expect(existsSync(join(dir, f))).toBe(true);
    }
    expect(testPlugin(dir)).toEqual([]);
  });

  it("refuses a non-empty directory and a bad name", () => {
    const dir = scratch();
    writeFileSync(join(dir, "x"), "x");
    expect(() => scaffoldPlugin(dir, "acme")).toThrow(/not empty/);
    expect(() => scaffoldPlugin(join(scratch(), "p"), "Acme Corp")).toThrow(/name/);
  });
});

describe("plugin test", () => {
  it("reports schema, capability, MCP, and leak-pattern problems together", () => {
    const dir = join(scratch(), "bad");
    scaffoldPlugin(dir, "acme");
    const manifestPath = join(dir, "agentbrew-plugin.yaml");
    const m = yaml.load(readFileSync(manifestPath, "utf-8")) as Record<string, any>;
    m.contributes.mcp_servers = "mcp/servers.yaml";
    m.contributes.hooks = "hooks/hooks.json";
    writeFileSync(manifestPath, yaml.dump(m));
    mkdirSync(join(dir, "mcp"));
    writeFileSync(
      join(dir, "mcp", "servers.yaml"),
      yaml.dump([{ name: "x", command: "npx", args: ["-y", "x@latest"] }]),
    );
    mkdirSync(join(dir, "hooks"));
    writeFileSync(join(dir, "hooks", "hooks.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [] }] } }));
    writeFileSync(join(dir, "leak-patterns.yaml"), yaml.dump({ patterns: ["(bad"] }));

    const problems = testPlugin(dir);

    expect(problems).toEqual(
      expect.arrayContaining([
        "capability not declared: hook Stop (plugin acme)",
        "capability not declared: mcp_server x (plugin acme)",
        "x: npx package x@latest is not pinned to an exact version",
        expect.stringMatching(/invalid leak pattern/),
      ]),
    );
  });

  it("reports an invalid manifest instead of throwing", () => {
    const dir = scratch();
    writeFileSync(join(dir, "agentbrew-plugin.yaml"), yaml.dump({ schema: 1, name: "acme" }));
    expect(testPlugin(dir)[0]).toMatch(/manifest/i);
  });
});

describe("plugin migrate", () => {
  it("drafts a manifest from an overlay and lists what it could not map", () => {
    const overlay = scratch();
    writeFileSync(
      join(overlay, "Agentfile.yaml"),
      yaml.dump({
        name: "acme",
        sources: ["./skill-plugins/dev", "git@git.example.com:acme/skills.git"],
        commands: ["./commands"],
        memoryPacks: ["./packs/team"],
        catalogOverlay: "./catalog-overlay.yaml",
        mcp: [{ name: "acme-jira", command: "node" }],
        adapters: ["./adapters/desktop"],
        detect: "./bin/detect.js",
      }),
    );

    const { manifest, unmapped } = migrateOverlay(overlay);

    expect(validateManifest(manifest).ok).toBe(true);
    expect(manifest).toMatchObject({
      name: "acme",
      capabilities: { mcp_servers: ["acme-jira"], repos: { include: [] } },
      contributes: {
        skills: "skill-plugins/dev",
        commands: "commands",
        memory_packs: "packs/team",
        catalog: "catalog-overlay.yaml",
      },
    });
    expect(unmapped).toEqual([
      "sources: git@git.example.com:acme/skills.git (remote source; add it to the catalog instead)",
      "mcp: acme-jira (write mcp/servers.yaml with secret references and a pinned version)",
      "adapters: ./adapters/desktop (executable adapters are not allowed; needs a declarative mapping)",
      "detect: ./bin/detect.js (detect scripts are not run; use declarative signals)",
    ]);
  });
});
