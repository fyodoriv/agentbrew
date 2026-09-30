import yaml from "js-yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "./types.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

import { existsSync, readdirSync, statSync } from "node:fs";
import { detectAgents, discoverAllSkills } from "./agents.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockStatSync = vi.mocked(statSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("detectAgents", () => {
  it("returns all agent definitions", () => {
    mockExistsSync.mockReturnValue(false);
    const agents = detectAgents();
    expect(agents.length).toBeGreaterThanOrEqual(6);
  });

  it("marks agents as detected when parent dir exists", () => {
    mockExistsSync.mockReturnValue(true);
    const agents = detectAgents();
    const detected = agents.filter((a) => a.detected);
    expect(detected.length).toBeGreaterThan(0);
  });

  it("marks agents as not detected when parent dir missing", () => {
    mockExistsSync.mockReturnValue(false);
    const agents = detectAgents();
    const notDetected = agents.filter((a) => !a.detected);
    expect(notDetected.length).toBe(agents.length);
  });
  it("includes claude-desktop with correct MCP config path", () => {
    mockExistsSync.mockReturnValue(true);
    const agents = detectAgents();
    const desktop = agents.find((a) => a.name === "claude-desktop");
    expect(desktop).toBeDefined();
    expect(desktop?.mcpConfig).toBe("~/Library/Application Support/Claude/claude_desktop_config.json");
    expect(desktop?.skillsDir).toBe("~/Library/Application Support/Claude/skills");
  });

  it("agents with commandTransform have function values (runtime only)", () => {
    mockExistsSync.mockReturnValue(true);
    const agents = detectAgents();
    const cursor = agents.find((a) => a.name === "cursor");
    const windsurf = agents.find((a) => a.name === "windsurf");
    const gemini = agents.find((a) => a.name === "gemini-cli");
    expect(typeof cursor?.commandTransform).toBe("function");
    expect(typeof windsurf?.commandTransform).toBe("function");
    expect(typeof gemini?.commandTransform).toBe("function");
  });

  it("agents can be safely serialized after stripping commandTransform", () => {
    mockExistsSync.mockReturnValue(true);
    const agents = detectAgents();
    const stripped = agents.map(({ commandTransform, ...rest }) => rest);
    // Must not throw — this is the exact pattern used in init.ts
    expect(() => yaml.dump(stripped)).not.toThrow();
    const serialized = yaml.dump(stripped);
    expect(serialized).not.toContain("commandTransform");
    // All agents should still be present
    for (const agent of agents) {
      expect(serialized).toContain(agent.name);
    }
  });

  it("raw detectAgents() output would crash yaml.dump without sanitization", () => {
    mockExistsSync.mockReturnValue(true);
    const agents = detectAgents();
    const hasTransform = agents.some((a) => a.commandTransform !== undefined);
    expect(hasTransform).toBe(true);
    // Without sanitization, yaml.dump throws on function values
    expect(() => yaml.dump(agents)).toThrow(/unacceptable kind of an object to dump/);
  });
});

// All single-agent skill-discovery edge cases ride through `discoverAllSkills([agent])`
// so the tests pin the public API surface that callers (src/init.ts) actually use.
// Same shape as PR #922 (`resolveUserName` migrated through `resolveTemplateVars`):
// the per-agent helper stayed alive only because tests imported it directly.
describe("discoverAllSkills — single-agent edge cases", () => {
  const agent: AgentConfig = {
    name: "claude-code",
    detected: true,
    skillsDir: "/tmp/skills",
  };

  it("returns empty map when skills dir missing", () => {
    mockExistsSync.mockReturnValue(false);
    expect(discoverAllSkills([agent]).size).toBe(0);
  });

  it("discovers skill directories with SKILL.md", () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/tmp/skills") return true;
      if (path === "/tmp/skills/my-skill/SKILL.md") return true;
      return false;
    });
    mockReaddirSync.mockReturnValue(["my-skill"] as unknown as ReturnType<typeof readdirSync>);
    mockStatSync.mockReturnValue({
      isDirectory: () => true,
      isSymbolicLink: () => false,
      isFile: () => false,
    } as unknown as ReturnType<typeof statSync>);

    const skills = discoverAllSkills([agent]);
    expect(skills.size).toBe(1);
    expect(skills.has("my-skill")).toBe(true);
  });

  it("discovers root SKILL.md", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["SKILL.md"] as unknown as ReturnType<typeof readdirSync>);
    mockStatSync.mockReturnValue({
      isDirectory: () => false,
      isSymbolicLink: () => false,
      isFile: () => true,
    } as unknown as ReturnType<typeof statSync>);

    const skills = discoverAllSkills([agent]);
    expect(skills.size).toBe(1);
    expect(skills.has("root")).toBe(true);
  });

  it("handles unreadable directory", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation(() => {
      throw new Error("EACCES");
    });
    expect(discoverAllSkills([agent]).size).toBe(0);
  });

  it("skips entries with no stat", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["orphan"] as unknown as ReturnType<typeof readdirSync>);
    mockStatSync.mockReturnValue(undefined as unknown as ReturnType<typeof statSync>);
    expect(discoverAllSkills([agent]).size).toBe(0);
  });
});

describe("discoverAllSkills", () => {
  it("returns empty map when no agents detected", () => {
    const agents: AgentConfig[] = [{ name: "cursor", detected: false, skillsDir: "/x" }];
    expect(discoverAllSkills(agents).size).toBe(0);
  });

  it("deduplicates skills across agents", () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.includes("skills") || path.includes("SKILL.md");
    });
    mockReaddirSync.mockReturnValue(["shared-skill"] as unknown as ReturnType<typeof readdirSync>);
    mockStatSync.mockReturnValue({
      isDirectory: () => true,
      isSymbolicLink: () => false,
      isFile: () => false,
    } as unknown as ReturnType<typeof statSync>);

    const agents: AgentConfig[] = [
      { name: "a", detected: true, skillsDir: "/a/skills" },
      { name: "b", detected: true, skillsDir: "/b/skills" },
    ];
    const skills = discoverAllSkills(agents);
    expect(skills.size).toBe(1);
  });
});
