import { describe, expect, it } from "vitest";
import { makeMcpAgentDef } from "./mcp-fixtures.js";

describe("makeMcpAgentDef", () => {
  it("defaults to a detected kiro carve-out with paths from AGENT_DEFINITIONS", () => {
    const agent = makeMcpAgentDef();
    expect(agent.name).toBe("kiro");
    expect(agent.detected).toBe(true);
    expect(agent.skillsDir).toBe("~/.kiro/skills");
    expect(agent.mcpConfig).toBe("~/.kiro/settings/mcp.json");
  });

  it("resolves paths for a named carve-out (amp)", () => {
    const agent = makeMcpAgentDef("amp");
    expect(agent.name).toBe("amp");
    expect(agent.skillsDir).toBe("~/.config/amp/skills");
    expect(agent.mcpConfig).toBe("~/.config/amp/settings.json");
  });

  it("respects explicit detected=false", () => {
    const agent = makeMcpAgentDef("kiro", { detected: false });
    expect(agent.detected).toBe(false);
    expect(agent.name).toBe("kiro");
  });

  it("overrides skillsDir when provided", () => {
    const agent = makeMcpAgentDef("kiro", { skillsDir: "x" });
    expect(agent.skillsDir).toBe("x");
    expect(agent.mcpConfig).toBe("~/.kiro/settings/mcp.json");
  });

  it("overrides mcpConfig when provided", () => {
    const agent = makeMcpAgentDef("kiro", { mcpConfig: "/tmp/custom-mcp.json" });
    expect(agent.mcpConfig).toBe("/tmp/custom-mcp.json");
  });

  it("falls back to placeholder skillsDir for unknown agent names", () => {
    const agent = makeMcpAgentDef("not-a-real-agent");
    expect(agent.skillsDir).toBe("x");
    expect(agent.mcpConfig).toBeUndefined();
  });

  it("preserves optional mcpKey/mcpFormat/rulesFile/rulesDir/commandsDir overrides", () => {
    const agent = makeMcpAgentDef("overlay-desktop", {
      mcpKey: "mcpServers",
      mcpFormat: "overlay-desktop",
      rulesFile: "~/.overlay-desktop/rules.md",
      rulesDir: "~/.overlay-desktop/rules/",
      commandsDir: "~/.overlay-desktop/commands/",
    });
    expect(agent.mcpKey).toBe("mcpServers");
    expect(agent.mcpFormat).toBe("overlay-desktop");
    expect(agent.rulesFile).toBe("~/.overlay-desktop/rules.md");
    expect(agent.rulesDir).toBe("~/.overlay-desktop/rules/");
    expect(agent.commandsDir).toBe("~/.overlay-desktop/commands/");
  });

  it("omits optional fields when not requested", () => {
    const agent = makeMcpAgentDef("kiro");
    expect(agent.mcpKey).toBeUndefined();
    expect(agent.mcpFormat).toBeUndefined();
    expect(agent.rulesFile).toBeUndefined();
    expect(agent.rulesDir).toBeUndefined();
    expect(agent.commandsDir).toBeUndefined();
  });
});
