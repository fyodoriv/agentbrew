/** Capability model, step 5 of #208: deny by default. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { assertCapabilities, CapabilityError, checkCapabilities } from "./capabilities.js";
import type { PluginManifest } from "./manifest.js";

function plugin(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "plugin-caps-"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

function manifest(capabilities: PluginManifest["capabilities"], contributes: Record<string, unknown>): PluginManifest {
  return { schema: 1, name: "acme", version: "1.0.0", capabilities, contributes };
}

const HOOKS = JSON.stringify({
  hooks: {
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo" }] }],
    Stop: [{ hooks: [{ type: "command", command: "echo" }] }],
  },
});

describe("checkCapabilities", () => {
  it("passes when every contribution is declared", () => {
    const dir = plugin({
      "rules/a.md": "---\nagents: [claude]\n---\nrule",
      "rules/b.md": "plain rule",
      "hooks/hooks.json": HOOKS,
      "mcp/servers.yaml": yaml.dump([{ name: "acme-jira" }]),
      "commands/hi.md": "say hi",
    });
    const m = manifest(
      { agents: ["claude", "codex"], hooks: ["PreToolUse:Bash", "Stop"], mcp_servers: ["acme-jira"] },
      { rules: "rules/", hooks: "hooks/hooks.json", mcp_servers: "mcp/servers.yaml", commands: "commands/" },
    );
    expect(checkCapabilities(dir, m)).toEqual([]);
  });

  it("refuses rules when no agents are declared", () => {
    const dir = plugin({ "rules/a.md": "rule" });
    expect(checkCapabilities(dir, manifest({}, { rules: "rules/" }))).toEqual([
      "capability not declared: agents * (plugin acme)",
    ]);
  });

  it("refuses a rule that targets an undeclared agent", () => {
    const dir = plugin({ "rules/a.md": "---\nagents: [claude, codex]\n---\nrule" });
    expect(checkCapabilities(dir, manifest({ agents: ["claude"] }, { rules: "rules/" }))).toEqual([
      "capability not declared: agents codex (plugin acme)",
    ]);
  });

  it("refuses an undeclared hook event", () => {
    const dir = plugin({ "hooks/hooks.json": HOOKS });
    expect(checkCapabilities(dir, manifest({ hooks: ["Stop"] }, { hooks: "hooks/hooks.json" }))).toEqual([
      "capability not declared: hook PreToolUse:Bash (plugin acme)",
    ]);
  });

  it("refuses an undeclared MCP server (list or map form)", () => {
    const list = plugin({ "mcp/s.yaml": yaml.dump([{ name: "acme-docs" }]) });
    const map = plugin({ "mcp/s.yaml": yaml.dump({ "acme-docs": { command: "x" } }) });
    for (const dir of [list, map]) {
      expect(checkCapabilities(dir, manifest({ mcp_servers: [] }, { mcp_servers: "mcp/s.yaml" }))).toEqual([
        "capability not declared: mcp_server acme-docs (plugin acme)",
      ]);
    }
  });

  it("refuses a shell-running command unless commands_exec is true", () => {
    const dir = plugin({
      "commands/run.md": "---\nallowed-tools: Bash(git status)\n---\nrun",
      "commands/inline.md": "Status: !`git status`",
    });
    expect(checkCapabilities(dir, manifest({}, { commands: "commands/" }))).toEqual([
      "capability not declared: commands_exec inline.md (plugin acme)",
      "capability not declared: commands_exec run.md (plugin acme)",
    ]);
    expect(checkCapabilities(dir, manifest({ commands_exec: true }, { commands: "commands/" }))).toEqual([]);
  });

  it("assertCapabilities throws a CapabilityError with exit code 3", () => {
    const dir = plugin({ "rules/a.md": "rule" });
    let error: unknown;
    try {
      assertCapabilities(dir, manifest({}, { rules: "rules/" }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CapabilityError);
    expect((error as CapabilityError).exitCode).toBe(3);
    expect((error as Error).message).toContain("capability not declared: agents * (plugin acme)");
  });
});
