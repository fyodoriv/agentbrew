import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMcpAgentDef } from "./test-utils/mcp-fixtures.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  lstatSync: vi.fn(),
  readlinkSync: vi.fn(),
}));

vi.mock("./state.js", () => {
  const loadState = vi.fn();
  return { loadState, requireState: loadState };
});

vi.mock("./sync/mcp-sync.js", () => ({
  syncMcpServers: vi.fn(),
}));

vi.mock("./sync/rules-sync.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./sync/rules-sync.js")>();
  return {
    CANARY_DELEGATED_AGENTS: real.CANARY_DELEGATED_AGENTS,
    syncRules: vi.fn(),
    dedupeSharedRulesFile: vi.fn(() => ({ content: "", removedCount: 0, removed: [] })),
    loadSharedRules: vi.fn(() => undefined),
    extractManagedSection: vi.fn(() => undefined),
    collectCanaryDelegation: vi.fn(() => new Map()),
  };
});

// Slice 4 of `delegate-commands-to-ai-rules`: mirror the rules-sync
// pattern above for command-sync so healthCheck → checkCommandsDrift's
// slice 4 canary skip sees the real CANARY_DELEGATED_AGENTS but stubs
// the I/O-facing `syncCommands` and `collectCanaryDelegation`
// (otherwise the real `collectCanaryDelegation` tries to spawn
// `ai-rules` against a partial node:fs mock).
vi.mock("./sync/command-sync.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./sync/command-sync.js")>();
  return {
    ...real,
    syncCommands: vi.fn(),
    collectCanaryDelegation: vi.fn((targets: ReadonlyArray<{ agentName: string }>) => {
      const result = new Map<string, Map<string, string>>();
      for (const t of targets) {
        if (real.CANARY_DELEGATED_AGENTS.has(t.agentName)) {
          result.set(t.agentName, new Map());
        }
      }
      return result;
    }),
  };
});

vi.mock("./sync/agents-sync.js", () => ({
  syncAgentDefs: vi.fn(),
  getAgentSources: vi.fn(() => []),
  collectAgentDefs: vi.fn(() => ({ agents: new Map(), bySource: {} })),
  getAgentDefTargets: vi.fn(() => []),
  resolveTargetPath: vi.fn(),
}));

vi.mock("./sync/skills-sync.js", () => ({
  syncSkills: vi.fn(),
  getSkillSources: vi.fn(() => []),
  cleanBrokenSymlinksGlobally: vi.fn(() => 0),
}));

vi.mock("./sync/hooks-sync.js", () => ({
  syncHooks: vi.fn(),
}));

vi.mock("./sync/instructions-sync.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./sync/instructions-sync.js")>();
  return {
    ...real,
    syncInstructions: vi.fn(),
    loadInstructions: vi.fn(() => undefined),
    isInstructionsUpToDate: (deployed: string, instructionsContent: string) =>
      deployed === instructionsContent || deployed.startsWith(instructionsContent.trimEnd()),
  };
});

vi.mock("./skills/validate.js", () => ({
  validateAllSkills: vi.fn(() => ({ total: 0, valid: 0, withErrors: 0, withWarnings: 0, results: [] })),
}));

vi.mock("./mcp/mcp-setup.js", () => ({
  validateMcpEnvVars: vi.fn(() => []),
}));

vi.mock("./mcp/heal-cycle.js", () => ({
  runMcpHealCycle: vi.fn(async () => ({ initial: [], final: [], attempts: [] })),
}));

vi.mock("./core/env-sanitize.js", () => ({
  checkEnvHygiene: vi.fn(() => []),
}));

vi.mock("./manifest.js", () => ({
  loadManifest: vi.fn(() => ({ hashes: {} })),
}));

vi.mock("./sync/auto-repair-health.js", () => ({
  probeAutoRepairHealth: vi.fn(() => ({ backend: "launchagent", state: "not-loaded", loaded: false })),
}));

import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { fix, healthCheck } from "./health.js";
import { runMcpHealCycle } from "./mcp/heal-cycle.js";
import { validateMcpEnvVars } from "./mcp/mcp-setup.js";
import { validateAllSkills } from "./skills/validate.js";
import { loadState } from "./state.js";
import { loadInstructions } from "./sync/instructions-sync.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockLstatSync = vi.mocked(lstatSync);
const mockReadlinkSync = vi.mocked(readlinkSync);
const mockLoadState = vi.mocked(loadState);
const mockValidateAllSkills = vi.mocked(validateAllSkills);
const mockLoadInstructions = vi.mocked(loadInstructions);
const mockValidateMcpEnvVars = vi.mocked(validateMcpEnvVars);
const claudeCodePermissionDefaults = JSON.stringify({
  permissions: { defaultMode: "bypassPermissions" },
  skipAutoPermissionPrompt: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = undefined;
});

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    agents: [],
    sources: [],
    mcpServers: [],
    catalogVersion: "0.1.0",
    ...overrides,
  };
}

describe("healthCheck", () => {
  it("returns early when not initialized", async () => {
    mockLoadState.mockReturnValue(undefined);
    await healthCheck();
    expect(process.exitCode).toBe(1);
  });

  it("reports clean when no drift", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);
    await healthCheck();
    expect(process.exitCode).toBe(0);
  });

  it("auto-fixes MCP drift when autoFix is true", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [makeMcpAgentDef("kiro", { skillsDir: "x", mcpConfig: "/tmp/mcp.json" })],
        mcpServers: [{ name: "missing-server", command: "npx", args: [], env: {}, source: "user" }],
      }),
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"mcpServers":{}}');

    await healthCheck({ autoFix: true });
    // Auto-fix calls fix() which re-syncs — no exit code 1
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("auto-repairing"));
  });

  it("reports drift without fixing when autoFix is false", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [makeMcpAgentDef("kiro", { skillsDir: "x", mcpConfig: "/tmp/mcp.json" })],
        mcpServers: [{ name: "missing-server", command: "npx", args: [], env: {}, source: "user" }],
      }),
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"mcpServers":{}}');

    await healthCheck({ autoFix: false });
    expect(process.exitCode).toBe(1);
  });

  // Slice 4: canaries skip drift without ai-rules; target a carve-out
  // (augment) so the "no managed section" path still fires for rulesFile.
  // `sync-and-drift-honor-detected-agents`: also seed augment as detected
  // — checkRulesDrift now filters by detection.
  it("detects rules drift without auto-fix", async () => {
    mockLoadState.mockReturnValue(makeState({ agents: [{ name: "augment", detected: true }] }));
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.includes("shared-rules") || path.includes("augment/guidelines");
    });
    mockReadFileSync.mockReturnValue("# Just content, no markers");

    await healthCheck({ autoFix: false });
    expect(process.exitCode).toBe(1);
  });

  it("handles unreadable MCP config", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [makeMcpAgentDef("kiro", { skillsDir: "x", mcpConfig: "/tmp/mcp.json" })],
        mcpServers: [{ name: "srv", command: "npx", args: [], env: {}, source: "user" }],
      }),
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not json");

    await healthCheck({ autoFix: false });
    expect(process.exitCode).toBe(1);
  });

  it("detects skills drift when skill missing from agent", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [{ name: "claude-code", detected: true, skillsDir: "/tmp/skills", mcpConfig: undefined }],
        sources: [{ url: "user/repo", type: "local", skillsInstalled: ["my-skill"], availableItems: [], addedAt: "" }],
      }),
    );
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes(".claude/settings.json")) return true;
      if (path.includes("SKILL.md")) return false;
      return false;
    });
    mockReadFileSync.mockReturnValue(claudeCodePermissionDefaults);

    await healthCheck({ autoFix: false });
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("missing skill: my-skill"));
  });

  it("reports clean when all skills are deployed", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [{ name: "claude-code", detected: true, skillsDir: "/tmp/skills", mcpConfig: undefined }],
        sources: [{ url: "user/repo", type: "local", skillsInstalled: ["my-skill"], availableItems: [], addedAt: "" }],
      }),
    );
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes(".claude/settings.json")) return true;
      if (path.includes("my-skill/SKILL.md")) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(claudeCodePermissionDefaults);

    await healthCheck({ autoFix: false });
    expect(process.exitCode).toBe(0);
  });

  it("skips skills drift when no skills installed", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [{ name: "claude-code", detected: true, skillsDir: "/tmp/skills", mcpConfig: undefined }],
        sources: [{ url: "user/repo", type: "github", skillsInstalled: [], availableItems: [], addedAt: "" }],
      }),
    );
    mockExistsSync.mockImplementation((p) => String(p).includes(".claude/settings.json"));
    mockReadFileSync.mockReturnValue(claudeCodePermissionDefaults);

    await healthCheck({ autoFix: false });
    expect(process.exitCode).toBe(0);
  });
});

describe("healthCheck --ci mode", () => {
  it("outputs plain text and exits 0 when clean", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [{ name: "cursor", detected: true, skillsDir: "x", mcpConfig: undefined }],
      }),
    );
    mockExistsSync.mockReturnValue(false);

    await healthCheck({ autoFix: false, ci: true });
    expect(process.exitCode).toBe(0);
    expect(console.log).toHaveBeenCalledWith("drift=0 status=clean");
  });

  it("outputs plain text and exits 1 on drift", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [makeMcpAgentDef("kiro", { skillsDir: "x", mcpConfig: "/tmp/mcp.json" })],
        mcpServers: [{ name: "missing-server", command: "npx", args: [], env: {}, source: "user" }],
      }),
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"mcpServers":{}}');

    await healthCheck({ autoFix: false, ci: true });
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("status=failed"));
  });

  it("lists drift items without color in CI mode", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [makeMcpAgentDef("kiro", { skillsDir: "x", mcpConfig: "/tmp/mcp.json" })],
        mcpServers: [{ name: "srv1", command: "npx", args: [], env: {}, source: "user" }],
      }),
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"mcpServers":{}}');

    await healthCheck({ autoFix: false, ci: true });
    expect(console.error).toHaveBeenCalledWith("  kiro [mcp] missing server: srv1");
  });

  it("includes agent/server/source counts", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [
          { name: "cursor", detected: true, skillsDir: "x", mcpConfig: undefined },
          { name: "claude-code", detected: true, skillsDir: "y", mcpConfig: undefined },
        ],
        mcpServers: [{ name: "s1", command: "npx", args: [], env: {}, source: "user" }],
        sources: [{ url: "u/r", type: "github", skillsInstalled: [], availableItems: [], addedAt: "" }],
      }),
    );
    mockExistsSync.mockReturnValue(false);

    await healthCheck({ autoFix: false, ci: true });
    expect(console.log).toHaveBeenCalledWith("agents=2 servers=1 sources=1");
  });

  it("never calls auto-fix even when drift found", async () => {
    const { syncMcpServers } = await import("./sync/mcp-sync.js");
    const mockSync = vi.mocked(syncMcpServers);

    mockLoadState.mockReturnValue(
      makeState({
        agents: [makeMcpAgentDef("kiro", { skillsDir: "x", mcpConfig: "/tmp/mcp.json" })],
        mcpServers: [{ name: "srv", command: "npx", args: [], env: {}, source: "user" }],
      }),
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"mcpServers":{}}');

    await healthCheck({ autoFix: false, ci: true });
    expect(mockSync).not.toHaveBeenCalled();
  });
});

describe("checkBrokenSymlinks", () => {
  it("detects broken symlinks in agent skills dirs", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("skills") && !path.includes("SKILL.md") && !path.includes("broken-target")) return true;
      if (path === "broken-target") return false;
      return false;
    });
    mockReaddirSync.mockImplementation((() => ["my-skill"]) as unknown as typeof readdirSync);
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => true } as ReturnType<typeof lstatSync>);
    mockReadlinkSync.mockReturnValue("broken-target" as unknown as ReturnType<typeof readlinkSync>);

    await healthCheck({ autoFix: false });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("broken symlink"));
  });
});

describe("checkSkillsValidity", () => {
  it("detects invalid skills via validation", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    mockValidateAllSkills.mockReturnValue({
      total: 1,
      valid: 0,
      withErrors: 1,
      withWarnings: 0,
      results: [
        {
          name: "bad-skill",
          directory: "/tmp/bad-skill",
          sourceLabel: "agentbrew",
          issues: [{ severity: "error", message: "SKILL.md not found" }],
          valid: false,
        },
      ],
    });

    await healthCheck({ autoFix: false });
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("SKILL.md not found"));
  });

  it("ignores warnings in health check", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    mockValidateAllSkills.mockReturnValue({
      total: 1,
      valid: 1,
      withErrors: 0,
      withWarnings: 1,
      results: [
        {
          name: "ok-skill",
          directory: "/tmp/ok-skill",
          sourceLabel: "agentbrew",
          issues: [{ severity: "warning", message: "description too short" }],
          valid: true,
        },
      ],
    });

    await healthCheck({ autoFix: false });
    expect(process.exitCode).toBe(0);
  });

  it("handles validation errors gracefully", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    mockValidateAllSkills.mockImplementation(() => {
      throw new Error("scan failed");
    });

    await healthCheck({ autoFix: false });
    expect(process.exitCode).toBe(0);
  });
});

describe("checkCommandsDrift", () => {
  it("detects missing commands in agent dir", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [{ name: "cursor", detected: true, skillsDir: "x", commandsDir: "~/.cursor/commands" }],
      }),
    );
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("agentbrew/commands")) return true;
      if (path.includes(".cursor")) return true;
      return false;
    });
    mockReaddirSync.mockImplementation(((p: string) => {
      if (String(p).includes("agentbrew/commands")) return ["my-cmd.md"];
      return []; // agent dir is empty — missing command
    }) as unknown as typeof readdirSync);

    await healthCheck({ autoFix: false });
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("missing command");
  });

  it("reports clean when no source commands exist", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockImplementation((p) => {
      if (String(p).includes("agentbrew/commands")) return true;
      return false;
    });
    mockReaddirSync.mockImplementation((() => []) as unknown as typeof readdirSync);

    await healthCheck({ autoFix: false });
    expect(process.exitCode).toBe(0);
  });
});

describe("checkInstructionsDrift", () => {
  it("detects instructions not deployed", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [{ name: "claude-code", detected: true, skillsDir: "x", rulesFile: "~/.claude/CLAUDE.md" }],
      }),
    );
    mockLoadInstructions.mockReturnValue("# AGENTS.md content");
    mockExistsSync.mockReturnValue(false);

    await healthCheck({ autoFix: false });
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("instructions not deployed");
    expect(process.exitCode).toBe(1);
  });

  it("detects instructions out of date", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [{ name: "claude-code", detected: true, skillsDir: "x", rulesFile: "~/.claude/CLAUDE.md" }],
      }),
    );
    mockLoadInstructions.mockReturnValue("# New AGENTS.md content");
    mockExistsSync.mockImplementation((p) => {
      if (String(p).includes("shared-rules")) return false;
      if (String(p).includes("agentbrew/commands")) return false;
      return true;
    });
    mockReadFileSync.mockReturnValue("# Old content");

    await healthCheck({ autoFix: false });
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("instructions out of date");
    expect(process.exitCode).toBe(1);
  });

  it("reports clean when instructions match exactly", async () => {
    const content = "# AGENTS.md content";
    mockLoadState.mockReturnValue(makeState());
    mockLoadInstructions.mockReturnValue(content);
    // All files exist except shared-rules (to avoid rules drift check interference)
    mockExistsSync.mockImplementation((p) => {
      if (String(p).includes("shared-rules")) return false;
      if (String(p).includes("agentbrew/commands")) return false;
      return true;
    });
    mockReadFileSync.mockReturnValue(content);

    await healthCheck({ autoFix: false });
    expect(process.exitCode).toBe(0);
  });

  it("reports clean when file has instructions plus appended managed rules section", async () => {
    const content = "# AGENTS.md content";
    const withManagedSection = `${content}\n\n<!-- agentbrew:start -->\n# Shared Rules\n<!-- agentbrew:end -->\n`;
    mockLoadState.mockReturnValue(makeState());
    mockLoadInstructions.mockReturnValue(content);
    mockExistsSync.mockImplementation((p) => {
      if (String(p).includes("shared-rules")) return false;
      if (String(p).includes("agentbrew/commands")) return false;
      return true;
    });
    mockReadFileSync.mockReturnValue(withManagedSection);

    await healthCheck({ autoFix: false });
    expect(process.exitCode).toBe(0);
  });

  it("skips when no AGENTS.md source exists", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadInstructions.mockReturnValue(undefined);
    mockExistsSync.mockReturnValue(false);

    await healthCheck({ autoFix: false });
    expect(process.exitCode).toBe(0);
  });
});

// Slice 4 of `delegate-rules-to-ai-rules`: canaries skip drift when
// delegation is empty; target a carve-out (augment) so the unreadable
// code path is still exercised.
describe("checkRulesDrift hardening", () => {
  // `sync-and-drift-honor-detected-agents`: seed augment as detected so
  // checkRulesDrift's detection filter doesn't skip it before exercising
  // the unreadable-file code path.
  it("reports drift when rules file is unreadable", async () => {
    mockLoadState.mockReturnValue(makeState({ agents: [{ name: "augment", detected: true }] }));
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.includes("shared-rules") || path.includes("augment/guidelines");
    });
    mockReadFileSync.mockImplementation(() => {
      throw new Error("EACCES");
    });

    await healthCheck({ autoFix: false });
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("unreadable");
    expect(process.exitCode).toBe(1);
  });
});

describe("healthCheck --json", () => {
  it("outputs valid JSON with clean status", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);
    await healthCheck({ json: true });
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const data = JSON.parse(output);
    expect(data.status).toBe("clean");
    expect(data.driftCount).toBe(0);
    expect(data.drift).toEqual([]);
    expect(data.autoRepair).toEqual({ backend: "launchagent", state: "not-loaded", loaded: false });
    expect(process.exitCode).toBe(0);
  });

  it("outputs valid JSON with drift items", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [makeMcpAgentDef("kiro", { skillsDir: "x", mcpConfig: "/tmp/mcp.json" })],
        mcpServers: [{ name: "missing-server", command: "npx", args: [], env: {}, source: "user" }],
      }),
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"mcpServers":{}}');

    await healthCheck({ autoFix: false, json: true });
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const data = JSON.parse(output);
    expect(data.status).toBe("drift");
    expect(data.driftCount).toBeGreaterThan(0);
    expect(data.drift[0]).toHaveProperty("agent");
    expect(data.drift[0]).toHaveProperty("type");
    expect(data.drift[0]).toHaveProperty("detail");
    expect(process.exitCode).toBe(1);
  });
});

describe("checkMcpEnvVarsDrift", () => {
  it("shows missing env vars in health check output", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);
    mockValidateMcpEnvVars.mockReturnValue([{ serverName: "splunk", missingVars: ["SPLUNK_MCP_URL", "SPLUNK_TOKEN"] }]);

    await healthCheck({ autoFix: false });
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("splunk");
    expect(calls).toContain("SPLUNK_MCP_URL");
    expect(calls).toContain("agentbrew setup");
    expect(process.exitCode).toBe(1);
  });

  it("includes env var drift in JSON output", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);
    mockValidateMcpEnvVars.mockReturnValue([{ serverName: "github", missingVars: ["GITHUB_TOKEN"] }]);

    await healthCheck({ json: true });
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const data = JSON.parse(output);
    expect(data.status).toBe("drift");
    expect(data.drift.some((d: { type: string }) => d.type === "mcp-env-vars")).toBe(true);
  });

  it("includes env var drift in CI output", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);
    mockValidateMcpEnvVars.mockReturnValue([{ serverName: "sentry", missingVars: ["SENTRY_AUTH_TOKEN"] }]);

    await healthCheck({ autoFix: false, ci: true });
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("sentry");
    expect(calls).toContain("mcp-env-vars");
    expect(process.exitCode).toBe(1);
  });

  it("reports clean when no env var drift", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);
    mockValidateMcpEnvVars.mockReturnValue([]);

    await healthCheck({ autoFix: false });
    expect(process.exitCode).toBe(0);
  });
});

describe("fix", () => {
  it("returns early when not initialized", async () => {
    mockLoadState.mockReturnValue(undefined);
    await fix();
  });

  it("runs sync and reports success when clean after", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);
    await fix();
    expect(console.log).toHaveBeenCalled();
  });

  it("runs the MCP heal cycle from the cron fix entrypoint", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);
    await fix();
    expect(runMcpHealCycle).toHaveBeenCalledOnce();
  });

  it("calls syncInstructions before syncRules to preserve the managed section", async () => {
    const { syncInstructions } = await import("./sync/instructions-sync.js");
    const { syncRules } = await import("./sync/rules-sync.js");
    const mockSyncInstructions = vi.mocked(syncInstructions);
    const mockSyncRules = vi.mocked(syncRules);

    const callOrder: string[] = [];
    mockSyncInstructions.mockImplementation(async () => {
      callOrder.push("syncInstructions");
      return { agentsUpdated: 0, contextFilesGenerated: 0 };
    });
    mockSyncRules.mockImplementation(async () => {
      callOrder.push("syncRules");
    });

    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);
    await fix();

    const instructionsIdx = callOrder.indexOf("syncInstructions");
    const rulesIdx = callOrder.indexOf("syncRules");
    expect(instructionsIdx).toBeGreaterThanOrEqual(0);
    expect(rulesIdx).toBeGreaterThanOrEqual(0);
    expect(instructionsIdx).toBeLessThan(rulesIdx);
  });
});

describe("skill-validity drift isolation", () => {
  it("shows skill-validity issues in a separate section, not as auto-fixable drift", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    mockValidateAllSkills.mockReturnValue({
      total: 1,
      valid: 0,
      withErrors: 1,
      withWarnings: 0,
      results: [
        {
          name: "broken-skill",
          directory: "/tmp/broken-skill",
          sourceLabel: "catalog-installed",
          issues: [{ severity: "error", message: "Missing YAML frontmatter (must start with ---)" }],
          valid: false,
        },
      ],
    });

    await healthCheck({ autoFix: false });
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    // Displayed in the skill validation section
    expect(calls).toContain("broken-skill");
    expect(calls).toContain("Missing YAML frontmatter");
    // NOT displayed as auto-repairable drift
    expect(calls).not.toContain("auto-repairing");
    expect(process.exitCode).toBe(1);
  });

  it("does not trigger auto-fix when only skill-validity drift exists", async () => {
    const { syncMcpServers } = await import("./sync/mcp-sync.js");
    const mockSync = vi.mocked(syncMcpServers);

    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    mockValidateAllSkills.mockReturnValue({
      total: 1,
      valid: 0,
      withErrors: 1,
      withWarnings: 0,
      results: [
        {
          name: "bad-skill",
          directory: "/tmp/bad-skill",
          sourceLabel: "catalog-installed",
          issues: [{ severity: "error", message: "SKILL.md not found" }],
          valid: false,
        },
      ],
    });

    // autoFix defaults to false; even with autoFix: true, skill-validity
    // drift does not trigger fix() — only actionable drift types do.
    await healthCheck();
    // syncMcpServers is only called from fix() — it must NOT be called
    expect(mockSync).not.toHaveBeenCalled();
  });
});

describe("combined MCP drift + skill-validity drift", () => {
  /** Set up an agent with a missing MCP server so checkMcpDrift() returns a drift item. */
  function stateWithMcpDrift() {
    return makeState({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x", mcpConfig: "/tmp/mcp.json" })],
      mcpServers: [{ name: "missing-server", command: "npx", args: [], env: {}, source: "user" }],
    });
  }

  /** Make validateAllSkills return one invalid skill so checkSkillsValidity() emits a drift item. */
  function mockOneInvalidSkill() {
    mockValidateAllSkills.mockReturnValue({
      total: 1,
      valid: 0,
      withErrors: 1,
      withWarnings: 0,
      results: [
        {
          name: "broken-skill",
          directory: "/tmp/broken-skill",
          sourceLabel: "catalog-installed",
          issues: [{ severity: "error" as const, message: "Missing YAML frontmatter (must start with ---)" }],
          valid: false,
        },
      ],
    });
  }

  it("sets exit code 1 when both MCP drift and skill-validity errors exist", async () => {
    mockLoadState.mockReturnValue(stateWithMcpDrift());
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"mcpServers":{}}');
    mockOneInvalidSkill();

    await healthCheck({ autoFix: false });
    expect(process.exitCode).toBe(1);
  });

  it("JSON output drift array contains items from both syncDrift and skillValidity", async () => {
    mockLoadState.mockReturnValue(stateWithMcpDrift());
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"mcpServers":{}}');
    mockOneInvalidSkill();

    await healthCheck({ autoFix: false, json: true });
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const data = JSON.parse(output) as { status: string; driftCount: number; drift: Array<{ type: string }> };

    expect(data.status).toBe("drift");
    expect(data.driftCount).toBeGreaterThanOrEqual(2);
    expect(data.drift.some((d) => d.type === "mcp")).toBe(true);
    expect(data.drift.some((d) => d.type === "skill-validity")).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it("auto-fix is attempted for MCP drift but not for skill-validity drift", async () => {
    const { syncMcpServers } = await import("./sync/mcp-sync.js");
    const mockSync = vi.mocked(syncMcpServers);

    mockLoadState.mockReturnValue(stateWithMcpDrift());
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"mcpServers":{}}');
    mockOneInvalidSkill();

    // autoFix defaults to true
    await healthCheck({ autoFix: true });

    // fix() calls syncMcpServers for MCP drift — must have been called
    expect(mockSync).toHaveBeenCalled();
    // Note: the function returns early after auto-fix without setting exitCode=1,
    // so skill-validity drift does not prevent a 0/undefined exit here.
    // The combined-drift exit code is verified in the autoFix:false test above.
  });
});

describe("user additions are not drift", () => {
  /**
   * Build a scenario where the only "drift" is a user-added MCP server —
   * the agent's config file contains a server that is NOT in agentbrew's
   * state, so `checkUserAddedMcpServers` flags it as a user addition.
   * Broad filesystem mocks may trip other real drift checks too — our
   * assertions focus on the userAdditions partition, not on a zero drift
   * count.
   */
  function setupUserAddedMcp(): ReturnType<typeof makeState> {
    // Simulate: cursor's mcp.json has "my-custom-server" but state has no MCP servers.
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ mcpServers: { "my-custom-server": { command: "node", args: [] } } }),
    );
    return makeState({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x", mcpConfig: "/tmp/mcp.json" })],
      mcpServers: [],
    });
  }

  it("JSON output exposes user additions in a separate field, not the drift array", async () => {
    mockLoadState.mockReturnValue(setupUserAddedMcp());

    await healthCheck({ autoFix: false, json: true });
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const data = JSON.parse(output) as {
      driftCount: number;
      status: string;
      drift: Array<{ type: string }>;
      userAdditions: Array<{ type: string }>;
    };

    // The user-added server appears in userAdditions, not drift — that's the core contract.
    expect(data.userAdditions).toBeDefined();
    expect(data.userAdditions.some((d) => d.type === "mcp-user-added")).toBe(true);
    // No user-added drift types leak into the `drift` array
    expect(data.drift.every((d) => !d.type.endsWith("-user-added"))).toBe(true);
  });

  it("CI output reports user-additions separately from the drift count", async () => {
    mockLoadState.mockReturnValue(setupUserAddedMcp());

    await healthCheck({ autoFix: false, ci: true });
    const stdout = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join("\n");

    // `user-additions=N` appears as its own line regardless of whether real drift exists
    expect(stdout).toMatch(/user-additions=\d+/);
  });
});
