import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig, McpServer, SkillSourceDir, Source } from "../types.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(actual.existsSync),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
  };
});

vi.mock("write-file-atomic", () => ({
  sync: vi.fn(),
}));

vi.mock("../state.js", () => {
  const loadState = vi.fn();
  return { loadState, requireState: loadState, saveState: vi.fn() };
});

vi.mock("../sync/mcp-sync.js", () => ({
  addMcpServer: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  confirm: vi.fn(),
  checkbox: vi.fn(),
}));

// Mock resolveEnvVar to only check process.env (no external fallbacks like
// gh-auth or Keychain) so tests are deterministic across environments.
vi.mock("./env-vars.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./env-vars.js")>();
  return {
    ...original,
    resolveEnvVar: (varName: string) => {
      const v = process.env[varName];
      return v !== undefined && v !== "" ? v : undefined;
    },
  };
});

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { ExitPromptError } from "@inquirer/core";
import { checkbox, confirm, input } from "@inquirer/prompts";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { loadState } from "../state.js";
import { addMcpServer } from "../sync/mcp-sync.js";
import {
  extractEnvVars,
  isEnvVarResolved,
  type McpServerStatus,
  type McpValidationWarning,
  printValidationWarnings,
  runMcpSetup,
  showMcpStatus,
  validateMcpEnvVars,
} from "./mcp-setup.js";
import { getInstalledMcpStatus, getMcpStatus, getSetupInstructions } from "./mcp-status.js";

const mockLoadState = vi.mocked(loadState);
const mockInput = vi.mocked(input);
const mockConfirm = vi.mocked(confirm);
const mockCheckbox = vi.mocked(checkbox);
const mockAddMcpServer = vi.mocked(addMcpServer);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileAtomicSync);
const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);

// Store real fs implementations so we can restore after tests that override them
let realReadFileSync: typeof readFileSync;
let realExistsSync: typeof existsSync;

beforeAll(async () => {
  const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
  realReadFileSync = actualFs.readFileSync;
  realExistsSync = actualFs.existsSync;
});

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    agents: [] as AgentConfig[],
    sources: [] as Source[],
    mcpServers: [] as McpServer[],
    catalogVersion: "0.1.0",
    skillSourceDirs: [] as SkillSourceDir[],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  // Restore fs pass-through so loadCatalog can read catalog.yaml
  mockReadFileSync.mockImplementation(realReadFileSync);
  mockExistsSync.mockImplementation(realExistsSync);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const SHELL_CONFIG_NAMES = [".zshenv.secrets", ".bashenv.secrets", ".profile.secrets", "secrets.fish"];
function isShellConfigPath(path: unknown): boolean {
  const p = String(path);
  return SHELL_CONFIG_NAMES.some((name) => p.includes(name));
}

/** Mock fs for shell config operations without breaking catalog.yaml reads. */
function mockShellConfigFs(options: { exists: boolean; content?: string }): void {
  const prevExists = mockExistsSync.getMockImplementation() ?? realExistsSync;
  mockExistsSync.mockImplementation((...args: Parameters<typeof existsSync>) => {
    if (isShellConfigPath(args[0])) return options.exists;
    return prevExists(...args);
  });

  if (options.content !== undefined) {
    const prevRead = mockReadFileSync.getMockImplementation() ?? realReadFileSync;
    mockReadFileSync.mockImplementation((...args: Parameters<typeof readFileSync>) => {
      if (isShellConfigPath(args[0])) return options.content as ReturnType<typeof readFileSync>;
      return prevRead(...args);
    });
  }
}

describe("extractEnvVars", () => {
  it("extracts vars from args", () => {
    const vars = extractEnvVars({ args: ["-y", "mcp-remote", "${SPLUNK_MCP_URL}"] });
    expect(vars).toEqual(["SPLUNK_MCP_URL"]);
  });

  it("extracts vars from env values", () => {
    const vars = extractEnvVars({ env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" } });
    expect(vars).toEqual(["GITHUB_TOKEN"]);
  });

  it("extracts vars from url", () => {
    const vars = extractEnvVars({ url: "https://${SPLUNK_HOST}:8089/services/mcp" });
    expect(vars).toEqual(["SPLUNK_HOST"]);
  });

  it("extracts vars from headers", () => {
    const vars = extractEnvVars({ headers: { Authorization: "Bearer ${MY_TOKEN}" } });
    expect(vars).toEqual(["MY_TOKEN"]);
  });

  it("extracts multiple vars from mixed sources", () => {
    const vars = extractEnvVars({
      args: ["-y", "mcp-remote", "${URL}"],
      env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      headers: { Authorization: "Bearer ${TOKEN}" },
    });
    expect(vars).toContain("URL");
    expect(vars).toContain("TOKEN");
    expect(vars).toHaveLength(2);
  });

  it("deduplicates vars", () => {
    const vars = extractEnvVars({
      args: ["${TOKEN}"],
      env: { X: "${TOKEN}" },
    });
    expect(vars).toEqual(["TOKEN"]);
  });

  it("returns empty for no vars", () => {
    const vars = extractEnvVars({ args: ["-y", "some-package"], env: { KEY: "literal" } });
    expect(vars).toEqual([]);
  });

  it("handles undefined fields", () => {
    const vars = extractEnvVars({});
    expect(vars).toEqual([]);
  });
});

describe("isEnvVarResolved", () => {
  it("returns true for HOME", () => {
    expect(isEnvVarResolved("HOME")).toBe(true);
  });

  it("returns true for PATH", () => {
    expect(isEnvVarResolved("PATH")).toBe(true);
  });

  it("returns true when env var is set", () => {
    process.env.TEST_MCP_VAR = "value";
    expect(isEnvVarResolved("TEST_MCP_VAR")).toBe(true);
    delete process.env.TEST_MCP_VAR;
  });

  it("returns false when env var is not set", () => {
    delete process.env.NONEXISTENT_VAR_XYZ;
    expect(isEnvVarResolved("NONEXISTENT_VAR_XYZ")).toBe(false);
  });

  it("returns false when env var is empty string", () => {
    process.env.EMPTY_VAR = "";
    expect(isEnvVarResolved("EMPTY_VAR")).toBe(false);
    delete process.env.EMPTY_VAR;
  });
});

describe("getMcpStatus", () => {
  it("marks installed servers", () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          { name: "context7", command: "npx", args: ["-y", "@upstash/context7-mcp@latest"], env: {}, source: "user" },
        ],
      }),
    );
    const statuses = getMcpStatus();
    const context7 = statuses.find((s) => s.name === "context7");
    expect(context7?.installed).toBe(true);
  });

  it("marks servers without env vars as ready when installed", () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          { name: "context7", command: "npx", args: ["-y", "@upstash/context7-mcp@latest"], env: {}, source: "user" },
        ],
      }),
    );
    const statuses = getMcpStatus();
    const context7 = statuses.find((s) => s.name === "context7");
    expect(context7?.ready).toBe(true);
    expect(context7?.missingVars).toEqual([]);
  });

  it("detects missing env vars for installed servers", () => {
    delete process.env.GITHUB_TOKEN;
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );
    const statuses = getMcpStatus();
    const github = statuses.find((s) => s.name === "github");
    expect(github?.installed).toBe(true);
    expect(github?.missingVars).toContain("GITHUB_TOKEN");
    expect(github?.ready).toBe(false);
  });

  it("marks uninstalled servers as not ready", () => {
    mockLoadState.mockReturnValue(makeState());
    const statuses = getMcpStatus();
    const github = statuses.find((s) => s.name === "github");
    expect(github?.installed).toBe(false);
    expect(github?.ready).toBe(false);
  });

  it("returns all catalog servers", () => {
    mockLoadState.mockReturnValue(makeState());
    const statuses = getMcpStatus();
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.some((s) => s.name === "context7")).toBe(true);
    expect(statuses.some((s) => s.name === "jenkins")).toBe(true);
  });
});

describe("getInstalledMcpStatus", () => {
  it("returns only installed servers", () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [{ name: "my-server", command: "npx", args: [], env: {}, source: "user" }],
      }),
    );
    const statuses = getInstalledMcpStatus();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].name).toBe("my-server");
    expect(statuses[0].installed).toBe(true);
  });

  it("returns empty when no state", () => {
    mockLoadState.mockReturnValue(undefined);
    const statuses = getInstalledMcpStatus();
    expect(statuses).toEqual([]);
  });
});

describe("validateMcpEnvVars", () => {
  it("returns no warnings when all vars resolved", () => {
    const servers: McpServer[] = [{ name: "test", command: "npx", args: ["-y", "pkg"], env: {}, source: "user" }];
    const warnings = validateMcpEnvVars(servers);
    expect(warnings).toEqual([]);
  });

  it("returns warnings for missing vars", () => {
    delete process.env.MISSING_TOKEN;
    const servers: McpServer[] = [
      { name: "test", command: "npx", args: [], env: { TOKEN: "${MISSING_TOKEN}" }, source: "user" },
    ];
    const warnings = validateMcpEnvVars(servers);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].serverName).toBe("test");
    expect(warnings[0].missingVars).toContain("MISSING_TOKEN");
  });

  it("uses state servers when none provided", () => {
    delete process.env.SOME_KEY;
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [{ name: "srv", command: "npx", args: [], env: { X: "${SOME_KEY}" }, source: "user" }],
      }),
    );
    const warnings = validateMcpEnvVars();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].serverName).toBe("srv");
  });

  it("skips always-available vars like HOME", () => {
    const servers: McpServer[] = [
      { name: "fs", command: "npx", args: ["-y", "pkg", "${HOME}"], env: {}, source: "user" },
    ];
    const warnings = validateMcpEnvVars(servers);
    expect(warnings).toEqual([]);
  });
});

describe("printValidationWarnings", () => {
  it("returns false when no warnings", () => {
    const result = printValidationWarnings([]);
    expect(result).toBe(false);
  });

  it("returns true and prints when warnings exist", () => {
    const warnings: McpValidationWarning[] = [{ serverName: "github", missingVars: ["GITHUB_TOKEN"] }];
    const result = printValidationWarnings(warnings);
    expect(result).toBe(true);
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("github");
    expect(output).toContain("GITHUB_TOKEN");
    expect(output).toContain("agentbrew setup");
  });

  it("handles multiple warnings", () => {
    const warnings: McpValidationWarning[] = [
      { serverName: "github", missingVars: ["GITHUB_TOKEN"] },
      { serverName: "jenkins", missingVars: ["JENKINS_URL", "JENKINS_API_TOKEN"] },
    ];
    const result = printValidationWarnings(warnings);
    expect(result).toBe(true);
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("2 MCP server(s)");
  });
});

describe("showMcpStatus", () => {
  it("shows installed servers", () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          { name: "context7", command: "npx", args: ["-y", "@upstash/context7-mcp@latest"], env: {}, source: "user" },
        ],
      }),
    );
    showMcpStatus();
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("context7");
    expect(output).toContain("ready");
  });

  it("shows missing env vars as warnings", () => {
    delete process.env.GITHUB_TOKEN;
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );
    showMcpStatus();
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("github");
    expect(output).toContain("GITHUB_TOKEN");
    expect(output).toContain("need configuration");
  });

  it("shows all-ready message when everything is configured", () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          { name: "context7", command: "npx", args: ["-y", "@upstash/context7-mcp@latest"], env: {}, source: "user" },
        ],
      }),
    );
    showMcpStatus();
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("ready");
  });

  it("shows hint when no servers installed", () => {
    mockLoadState.mockReturnValue(makeState());
    showMcpStatus();
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("No MCP servers installed");
  });

  it("outputs JSON when --json flag set", () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          { name: "context7", command: "npx", args: ["-y", "@upstash/context7-mcp@latest"], env: {}, source: "user" },
        ],
      }),
    );
    showMcpStatus({ json: true });
    const output = String((console.log as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((s: McpServerStatus) => s.name === "context7")).toBe(true);
  });

  it("shows available servers when --all flag set", () => {
    mockLoadState.mockReturnValue(makeState());
    showMcpStatus({ all: true });
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("Available");
  });
});

describe("getSetupInstructions", () => {
  beforeEach(() => {
    mockLoadState.mockReturnValue(makeState());
  });

  it("returns setup instructions for github", () => {
    const instructions = getSetupInstructions("github");
    expect(instructions.GITHUB_TOKEN).toBeDefined();
    expect(instructions.GITHUB_TOKEN.description).toContain("token");
    expect(instructions.GITHUB_TOKEN.link).toContain("github.com");
    expect(instructions.GITHUB_TOKEN.steps).toBeDefined();
    expect(instructions.GITHUB_TOKEN.steps!.length).toBeGreaterThan(0);
  });

  it("returns setup instructions for jenkins with multiple vars", () => {
    const instructions = getSetupInstructions("jenkins");
    expect(instructions.JENKINS_URL).toBeDefined();
    expect(instructions.JENKINS_USER).toBeDefined();
    expect(instructions.JENKINS_API_TOKEN).toBeDefined();
    expect(instructions.JENKINS_URL.description).toContain("Jenkins");
    expect(instructions.JENKINS_API_TOKEN.steps!.length).toBeGreaterThan(0);
  });

  it("returns setup instructions for splunk with multiple vars", () => {
    const instructions = getSetupInstructions("splunk");
    expect(instructions.SPLUNK_MCP_URL).toBeDefined();
    expect(instructions.SPLUNK_TOKEN).toBeDefined();
    expect(instructions.SPLUNK_MCP_URL.link).toContain("splunkbase.splunk.com");
    expect(instructions.SPLUNK_MCP_URL.steps!.length).toBeGreaterThan(0);
  });

  it("returns setup instructions for sentry", () => {
    const instructions = getSetupInstructions("sentry");
    expect(instructions.SENTRY_AUTH_TOKEN).toBeDefined();
    expect(instructions.SENTRY_AUTH_TOKEN.link).toContain("sentry.io");
  });

  it("returns setup instructions for brave-search", () => {
    const instructions = getSetupInstructions("brave-search");
    expect(instructions.BRAVE_API_KEY).toBeDefined();
    expect(instructions.BRAVE_API_KEY.link).toContain("brave.com");
  });

  it("returns setup instructions for composio", () => {
    const instructions = getSetupInstructions("composio");
    expect(instructions.COMPOSIO_CONSUMER_API_KEY).toBeDefined();
    expect(instructions.COMPOSIO_CONSUMER_API_KEY.link).toContain("composio.dev");
  });

  it("returns setup instructions for openviking", () => {
    const instructions = getSetupInstructions("openviking");
    expect(instructions.OPENAI_API_KEY).toBeDefined();
    expect(instructions.OPENAI_API_KEY.link).toContain("openai.com");
  });

  it("returns empty for servers without setup instructions", () => {
    const instructions = getSetupInstructions("context7");
    expect(instructions).toEqual({});
  });

  it("returns empty for unknown servers", () => {
    const instructions = getSetupInstructions("nonexistent-server");
    expect(instructions).toEqual({});
  });
});

// ── Wizard: runMcpSetup ───────────────────────────────────────────────────────

describe("runMcpSetup", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.JENKINS_URL = process.env.JENKINS_URL;
    savedEnv.JENKINS_USER = process.env.JENKINS_USER;
    savedEnv.JENKINS_API_TOKEN = process.env.JENKINS_API_TOKEN;
    savedEnv.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    delete process.env.JENKINS_URL;
    delete process.env.JENKINS_USER;
    delete process.env.JENKINS_API_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it("returns early when state is unavailable", async () => {
    mockLoadState.mockReturnValue(undefined);
    await runMcpSetup();
    expect(mockInput).not.toHaveBeenCalled();
  });

  it("prints not found for unknown server", async () => {
    mockLoadState.mockReturnValue(makeState());
    await runMcpSetup({ server: "nonexistent" });
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("not found");
  });

  it("shows suggestion for a close server name typo", async () => {
    mockLoadState.mockReturnValue(makeState());
    await runMcpSetup({ server: "githu" });
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("not found");
    expect(output).toContain("Did you mean");
  });

  it("shows fallback hint when no close suggestion found", async () => {
    mockLoadState.mockReturnValue(makeState());
    await runMcpSetup({ server: "zzzzzzzzz" });
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("not found");
    expect(output).toContain("agentbrew status");
  });

  it("shows already configured for server with no missing vars", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          { name: "context7", command: "npx", args: ["-y", "@upstash/context7-mcp@latest"], env: {}, source: "user" },
        ],
      }),
    );
    await runMcpSetup({ server: "context7" });
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("All env vars are configured");
  });

  it("offers to install uninstalled server", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockConfirm.mockResolvedValueOnce(false);
    await runMcpSetup({ server: "jenkins" });
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("not installed") }),
    );
  });

  it("completes full setup for a single server with all vars", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "jenkins",
            command: "npx",
            args: ["-y", "@ashwinighuge/jenkins-mcp-server"],
            env: {
              JENKINS_URL: "${JENKINS_URL}",
              JENKINS_USER: "${JENKINS_USER}",
              JENKINS_API_TOKEN: "${JENKINS_API_TOKEN}",
            },
            source: "user",
          },
        ],
      }),
    );

    // Phase 1: input prompts for each var
    mockInput
      .mockResolvedValueOnce("https://jenkins.example.com")
      .mockResolvedValueOnce("myusername")
      .mockResolvedValueOnce("my-api-token-12345");
    // Phase 2: confirm save to shell
    mockConfirm.mockResolvedValueOnce(true);
    // Mock fs — shell config doesn't exist, but catalog.yaml still readable
    mockShellConfigFs({ exists: false });

    await runMcpSetup({ server: "jenkins" });

    // Should have set process.env
    expect(process.env.JENKINS_URL).toBe("https://jenkins.example.com");
    expect(process.env.JENKINS_USER).toBe("myusername");
    expect(process.env.JENKINS_API_TOKEN).toBe("my-api-token-12345");
    // Should have written to shell config
    expect(mockWriteFileSync).toHaveBeenCalled();
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("configured");
  });

  it("does not write to shell config when user declines", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "jenkins",
            command: "npx",
            args: ["-y", "@ashwinighuge/jenkins-mcp-server"],
            env: {
              JENKINS_URL: "${JENKINS_URL}",
              JENKINS_USER: "${JENKINS_USER}",
              JENKINS_API_TOKEN: "${JENKINS_API_TOKEN}",
            },
            source: "user",
          },
        ],
      }),
    );

    mockInput
      .mockResolvedValueOnce("https://jenkins.example.com")
      .mockResolvedValueOnce("myusername")
      .mockResolvedValueOnce("token123");
    mockConfirm.mockResolvedValueOnce(false);

    await runMcpSetup({ server: "jenkins" });

    expect(process.env.JENKINS_USER).toBe("myusername");
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("session only");
  });

  it("cancels during input — no side effects", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "jenkins",
            command: "npx",
            args: ["-y", "@ashwinighuge/jenkins-mcp-server"],
            env: {
              JENKINS_URL: "${JENKINS_URL}",
              JENKINS_USER: "${JENKINS_USER}",
              JENKINS_API_TOKEN: "${JENKINS_API_TOKEN}",
            },
            source: "user",
          },
        ],
      }),
    );

    mockInput.mockResolvedValueOnce("https://jenkins.example.com").mockRejectedValueOnce(new ExitPromptError());

    await runMcpSetup({ server: "jenkins" });

    expect(process.env.JENKINS_USER).toBeUndefined();
    expect(process.env.JENKINS_API_TOKEN).toBeUndefined();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("cancelled");
  });

  it("cancels during confirm — no side effects", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "jenkins",
            command: "npx",
            args: ["-y", "@ashwinighuge/jenkins-mcp-server"],
            env: {
              JENKINS_URL: "${JENKINS_URL}",
              JENKINS_USER: "${JENKINS_USER}",
              JENKINS_API_TOKEN: "${JENKINS_API_TOKEN}",
            },
            source: "user",
          },
        ],
      }),
    );

    mockInput
      .mockResolvedValueOnce("https://jenkins.example.com")
      .mockResolvedValueOnce("myusername")
      .mockResolvedValueOnce("token");
    mockConfirm.mockRejectedValueOnce(new ExitPromptError());

    await runMcpSetup({ server: "jenkins" });

    expect(process.env.JENKINS_USER).toBeUndefined();
    expect(process.env.JENKINS_API_TOKEN).toBeUndefined();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("cancelled");
  });

  it("re-throws non-cancel errors", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "jenkins",
            command: "npx",
            args: ["-y", "@ashwinighuge/jenkins-mcp-server"],
            env: {
              JENKINS_URL: "${JENKINS_URL}",
              JENKINS_USER: "${JENKINS_USER}",
              JENKINS_API_TOKEN: "${JENKINS_API_TOKEN}",
            },
            source: "user",
          },
        ],
      }),
    );

    mockInput.mockRejectedValueOnce(new Error("unexpected"));

    await expect(runMcpSetup({ server: "jenkins" })).rejects.toThrow("unexpected");
  });

  it("re-throws non-cancel errors in default wizard path", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );

    mockConfirm.mockRejectedValueOnce(new Error("wizard boom"));

    await expect(runMcpSetup()).rejects.toThrow("wizard boom");
  });

  it("prompts for ALL required vars when partial config exists", async () => {
    process.env.JENKINS_USER = "existing-user";
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "jenkins",
            command: "npx",
            args: ["-y", "@ashwinighuge/jenkins-mcp-server"],
            env: {
              JENKINS_URL: "${JENKINS_URL}",
              JENKINS_USER: "${JENKINS_USER}",
              JENKINS_API_TOKEN: "${JENKINS_API_TOKEN}",
            },
            source: "user",
          },
        ],
      }),
    );

    // Should prompt for ALL vars even though JENKINS_USER is set
    mockInput
      .mockResolvedValueOnce("https://jenkins.example.com") // JENKINS_URL
      .mockResolvedValueOnce("existing-user") // pre-filled, user keeps
      .mockResolvedValueOnce("new-token"); // missing, user provides
    mockConfirm.mockResolvedValueOnce(true);
    mockShellConfigFs({ exists: false });

    await runMcpSetup({ server: "jenkins" });

    // All input calls made (for all vars)
    expect(mockInput).toHaveBeenCalledTimes(3);
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("Already set");
    expect(output).toContain("Missing");
    expect(output).toContain("configured");
  });

  it("multi-server wizard — configures installed servers with missing vars", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          { name: "context7", command: "npx", args: ["-y", "@upstash/context7-mcp@latest"], env: {}, source: "user" },
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );

    // Confirm configure existing
    mockConfirm
      .mockResolvedValueOnce(true) // yes, configure missing
      .mockResolvedValueOnce(true) // save to shell
      .mockResolvedValueOnce(false); // don't install new servers
    mockInput.mockResolvedValueOnce("ghp_test123");
    mockShellConfigFs({ exists: false });

    await runMcpSetup({ installMissing: true });

    expect(process.env.GITHUB_TOKEN).toBe("ghp_test123");
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("Setup complete");
  });

  it("multi-server wizard — skips configuration when user declines", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );

    mockConfirm
      .mockResolvedValueOnce(false) // no, don't configure
      .mockResolvedValueOnce(false); // don't install new

    await runMcpSetup();

    expect(mockInput).not.toHaveBeenCalled();
    expect(process.env.GITHUB_TOKEN).toBeUndefined();
  });

  it("multi-server wizard — all servers configured shows green message", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          { name: "context7", command: "npx", args: ["-y", "@upstash/context7-mcp@latest"], env: {}, source: "user" },
        ],
      }),
    );

    mockConfirm.mockResolvedValueOnce(false); // don't install new

    await runMcpSetup();

    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("servers are ready");
  });

  it("multi-server wizard — cancel at top-level confirm exits cleanly", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );

    mockConfirm.mockRejectedValueOnce(new ExitPromptError());

    await runMcpSetup();

    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("cancelled");
  });

  it("multi-server wizard — install and setup new servers", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [],
      }),
    );

    mockConfirm
      .mockResolvedValueOnce(true) // yes, browse and install
      .mockResolvedValueOnce(true); // save to shell for context7 (no env vars, so skips to install)
    mockCheckbox.mockResolvedValueOnce(["context7"]);

    await runMcpSetup();

    expect(mockAddMcpServer).toHaveBeenCalled();
  });

  it("installs and sets up server with env vars", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [],
      }),
    );

    // Top-level: browse and install
    mockConfirm.mockResolvedValueOnce(true);
    mockCheckbox.mockResolvedValueOnce(["github"]);
    // Setup env vars for github
    mockInput.mockResolvedValueOnce("ghp_install_token");
    mockConfirm.mockResolvedValueOnce(true); // save to shell
    mockShellConfigFs({ exists: false });

    await runMcpSetup();

    expect(process.env.GITHUB_TOKEN).toBe("ghp_install_token");
    expect(mockAddMcpServer).toHaveBeenCalled();
  });

  it("cancels install when env var setup is cancelled", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [],
      }),
    );

    mockConfirm.mockResolvedValueOnce(false); // don't install (not installed, single server path)
    await runMcpSetup({ server: "github" });

    expect(mockAddMcpServer).not.toHaveBeenCalled();
  });
});

// ── Shell config writes (tested via wizard commit phase) ─────────────────────

describe("shell config writes via wizard", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.SHELL = process.env.SHELL;
    savedEnv.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    process.env.SHELL = "/bin/zsh";
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it("appends export with header to new shell config", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );

    mockInput.mockResolvedValueOnce("ghp_test");
    mockConfirm.mockResolvedValueOnce(true);
    mockShellConfigFs({ exists: false });

    await runMcpSetup({ server: "github" });

    expect(mockMkdirSync).toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalled();
    const written = String(mockWriteFileSync.mock.calls[0][1]);
    expect(written).toContain("# agentbrew MCP server secrets — DO NOT commit this file");
    expect(written).toContain('export GITHUB_TOKEN="ghp_test"');
  });

  it("appends without header when header already exists", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );

    mockInput.mockResolvedValueOnce("ghp_test2");
    mockConfirm.mockResolvedValueOnce(true);
    mockShellConfigFs({ exists: true, content: "# agentbrew MCP server env vars\nexport OTHER=val\n" });

    await runMcpSetup({ server: "github" });

    const written = String(mockWriteFileSync.mock.calls[0][1]);
    expect(written).not.toMatch(/# agentbrew MCP server env vars.*# agentbrew MCP server env vars/s);
    expect(written).toContain('export GITHUB_TOKEN="ghp_test2"');
  });

  it("updates existing export in place", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );

    mockInput.mockResolvedValueOnce("ghp_updated");
    mockConfirm.mockResolvedValueOnce(true);
    mockShellConfigFs({ exists: true, content: '# agentbrew MCP server env vars\nexport GITHUB_TOKEN="ghp_old"\n' });

    await runMcpSetup({ server: "github" });

    const written = String(mockWriteFileSync.mock.calls[0][1]);
    expect(written).toContain('export GITHUB_TOKEN="ghp_updated"');
    expect(written).not.toContain("ghp_old");
  });

  it("uses fish syntax when SHELL is fish", async () => {
    process.env.SHELL = "/usr/bin/fish";
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );

    mockInput.mockResolvedValueOnce("ghp_fish");
    mockConfirm.mockResolvedValueOnce(true);
    mockShellConfigFs({ exists: false });

    await runMcpSetup({ server: "github" });

    const written = String(mockWriteFileSync.mock.calls[0][1]);
    expect(written).toContain('set -gx GITHUB_TOKEN "ghp_fish"');
  });

  it("uses bash config path when SHELL is bash", async () => {
    process.env.SHELL = "/bin/bash";
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );

    mockInput.mockResolvedValueOnce("ghp_bash");
    mockConfirm.mockResolvedValueOnce(true);
    mockShellConfigFs({ exists: false });

    await runMcpSetup({ server: "github" });

    const configPath = String(mockWriteFileSync.mock.calls[0][0]);
    expect(configPath).toContain(".bashenv.secrets");
  });

  it("uses .profile for unknown shells", async () => {
    process.env.SHELL = "/bin/unknown";
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );

    mockInput.mockResolvedValueOnce("ghp_unk");
    mockConfirm.mockResolvedValueOnce(true);
    mockShellConfigFs({ exists: false });

    await runMcpSetup({ server: "github" });

    const configPath = String(mockWriteFileSync.mock.calls[0][0]);
    expect(configPath).toContain(".zshenv.secrets");
  });
});

// ── Batch setup: collectMissingVars ─────────────────────────────────────────

describe("collectMissingVars", () => {
  it("deduplicates vars shared across multiple servers", async () => {
    const { collectMissingVars } = await import("./mcp-setup.js");
    const servers: McpServerStatus[] = [
      {
        name: "a",
        description: "",
        category: "",
        installed: true,
        requiredVars: ["TOKEN"],
        missingVars: ["TOKEN"],
        ready: false,
      },
      {
        name: "b",
        description: "",
        category: "",
        installed: true,
        requiredVars: ["TOKEN", "KEY"],
        missingVars: ["TOKEN", "KEY"],
        ready: false,
      },
    ];
    const result = collectMissingVars(servers);
    expect(result.size).toBe(2);
    expect(result.get("TOKEN")).toEqual(["a", "b"]);
    expect(result.get("KEY")).toEqual(["b"]);
  });

  it("returns empty map when no vars are missing", async () => {
    const { collectMissingVars } = await import("./mcp-setup.js");
    const servers: McpServerStatus[] = [
      {
        name: "a",
        description: "",
        category: "",
        installed: true,
        requiredVars: ["TOKEN"],
        missingVars: [],
        ready: true,
      },
    ];
    expect(collectMissingVars(servers).size).toBe(0);
  });
});

// ── Non-interactive: setupFromEnv ───────────────────────────────────────────

describe("setupFromEnv", () => {
  it("parses KEY=VAL pairs and writes to shell config", async () => {
    const { setupFromEnv } = await import("./mcp-setup.js");
    mockShellConfigFs({ exists: false });

    setupFromEnv(["GITHUB_TOKEN=ghp_123", "API_KEY=sk_456"]);

    expect(process.env.GITHUB_TOKEN).toBe("ghp_123");
    expect(process.env.API_KEY).toBe("sk_456");
    expect(mockWriteFileSync).toHaveBeenCalled();

    // Cleanup
    delete process.env.GITHUB_TOKEN;
    delete process.env.API_KEY;
  });

  it("skips invalid pairs without =", async () => {
    const { setupFromEnv } = await import("./mcp-setup.js");
    setupFromEnv(["INVALID_NO_EQUALS"]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Skipping invalid pair"));
  });

  it("skips pairs with empty key or value", async () => {
    const { setupFromEnv } = await import("./mcp-setup.js");
    setupFromEnv(["=value", "KEY="]);
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

// ── Batch setup: --all path ─────────────────────────────────────────────────

describe("runMcpSetup --all", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    savedEnv.JENKINS_URL = process.env.JENKINS_URL;
    savedEnv.JENKINS_USER = process.env.JENKINS_USER;
    savedEnv.JENKINS_API_TOKEN = process.env.JENKINS_API_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.JENKINS_URL;
    delete process.env.JENKINS_USER;
    delete process.env.JENKINS_API_TOKEN;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it("prints success when all servers are ready", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [{ name: "context7", command: "npx", args: [], env: {}, source: "user" }],
      }),
    );

    await runMcpSetup({ all: true });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("fully configured"));
  });

  it("collects missing vars, prompts once per var, and saves to shell config", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );

    mockInput.mockResolvedValueOnce("ghp_batch_token");
    mockConfirm.mockResolvedValueOnce(true);
    mockShellConfigFs({ exists: false });

    await runMcpSetup({ all: true });

    expect(process.env.GITHUB_TOKEN).toBe("ghp_batch_token");
    expect(mockWriteFileSync).toHaveBeenCalled();
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("unique env var");
    expect(output).toContain("Review");
    expect(output).toContain("All servers configured");
  });

  it("deduplicates vars shared across multiple servers", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
          {
            name: "my-gh-tool",
            command: "npx",
            args: ["-y", "my-gh-tool"],
            env: { GH_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );

    // Only one prompt for GITHUB_TOKEN (shared by both servers)
    mockInput.mockResolvedValueOnce("ghp_shared");
    mockConfirm.mockResolvedValueOnce(true);
    mockShellConfigFs({ exists: false });

    await runMcpSetup({ all: true });

    expect(mockInput).toHaveBeenCalledTimes(1);
    expect(process.env.GITHUB_TOKEN).toBe("ghp_shared");
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("1 unique env var");
  });

  it("does not write to shell config when user declines save", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );

    mockInput.mockResolvedValueOnce("ghp_nosave");
    mockConfirm.mockResolvedValueOnce(false);

    await runMcpSetup({ all: true });

    expect(process.env.GITHUB_TOKEN).toBe("ghp_nosave");
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("masks values in review — short values show dots", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );

    mockInput.mockResolvedValueOnce("short");
    mockConfirm.mockResolvedValueOnce(true);
    mockShellConfigFs({ exists: false });

    await runMcpSetup({ all: true });

    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    // Short values (<=8 chars) get fully masked
    expect(output).toContain("••••");
  });

  it("masks values in review — long values show prefix/suffix", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );

    mockInput.mockResolvedValueOnce("ghp_longtoken123456");
    mockConfirm.mockResolvedValueOnce(true);
    mockShellConfigFs({ exists: false });

    await runMcpSetup({ all: true });

    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    // Long values show first 4 + dots + last 4
    expect(output).toContain("ghp_");
    expect(output).toContain("3456");
    expect(output).toContain("•");
  });

  it("rejects empty input via the validator", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [
          {
            name: "github",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
            source: "user",
          },
        ],
      }),
    );

    mockInput.mockResolvedValueOnce("ghp_val");
    mockConfirm.mockResolvedValueOnce(true);
    mockShellConfigFs({ exists: false });

    await runMcpSetup({ all: true });

    // Extract the validate function from the input mock call
    const inputOpts = mockInput.mock.calls[0][0] as { validate?: (val: string) => string | boolean };
    expect(inputOpts.validate).toBeDefined();
    expect(inputOpts.validate!("")).toBe("Value cannot be empty");
    expect(inputOpts.validate!("   ")).toBe("Value cannot be empty");
    expect(inputOpts.validate!("valid")).toBe(true);
  });
});

// ── Non-interactive: --env path ─────────────────────────────────────────────

describe("runMcpSetup --env", () => {
  it("applies env vars and writes to shell config", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockShellConfigFs({ exists: false });

    await runMcpSetup({ env: ["TEST_VAR_SETUP=hello"] });
    expect(process.env.TEST_VAR_SETUP).toBe("hello");
    expect(mockWriteFileSync).toHaveBeenCalled();

    delete process.env.TEST_VAR_SETUP;
  });
});
