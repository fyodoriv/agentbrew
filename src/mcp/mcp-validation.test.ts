import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../state.js", () => ({
  requireState: vi.fn(),
}));

vi.mock("./env-vars.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./env-vars.js")>();
  return {
    ...original,
    resolveEnvVar: vi.fn(original.resolveEnvVar),
  };
});

import { requireState } from "../state.js";
import type { McpServer } from "../types.js";
import { resolveEnvVar } from "./env-vars.js";
import {
  ENV_VAR_PATTERN,
  extractEnvVars,
  filterInvalidServers,
  isEnvVarResolved,
  isValidMcpServer,
  printValidationWarnings,
  validateMcpEnvVars,
} from "./mcp-validation.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ENV_VAR_PATTERN", () => {
  it("matches ${VAR} syntax", () => {
    const matches = [..."${FOO} and ${BAR}".matchAll(ENV_VAR_PATTERN)];
    expect(matches).toHaveLength(2);
    expect(matches[0][1]).toBe("FOO");
    expect(matches[1][1]).toBe("BAR");
  });

  it("does not match $VAR without braces", () => {
    expect([..."$FOO".matchAll(ENV_VAR_PATTERN)]).toHaveLength(0);
  });

  it("does not match ${VAR:default} with colon syntax", () => {
    const matches = [..."${FOO:default}".matchAll(ENV_VAR_PATTERN)];
    expect(matches).toHaveLength(0);
  });
});

describe("extractEnvVars", () => {
  it("extracts vars from args", () => {
    expect(extractEnvVars({ args: ["--token", "${API_TOKEN}"] })).toEqual(["API_TOKEN"]);
  });

  it("extracts vars from env values", () => {
    expect(extractEnvVars({ env: { TOKEN: "${SECRET_KEY}" } })).toEqual(["SECRET_KEY"]);
  });

  it("extracts vars from url", () => {
    expect(extractEnvVars({ url: "https://${HOST}:${PORT}" })).toEqual(["HOST", "PORT"]);
  });

  it("extracts vars from headers", () => {
    expect(extractEnvVars({ headers: { Authorization: "Bearer ${AUTH_TOKEN}" } })).toEqual(["AUTH_TOKEN"]);
  });

  it("deduplicates vars", () => {
    expect(
      extractEnvVars({
        args: ["${TOKEN}"],
        env: { T: "${TOKEN}" },
      }),
    ).toEqual(["TOKEN"]);
  });

  it("returns empty array when no vars found", () => {
    expect(extractEnvVars({ args: ["--foo", "bar"] })).toEqual([]);
  });

  it("handles empty/undefined fields gracefully", () => {
    expect(extractEnvVars({})).toEqual([]);
  });
});

describe("isEnvVarResolved", () => {
  it("returns true for always-available vars like HOME", () => {
    expect(isEnvVarResolved("HOME")).toBe(true);
    expect(isEnvVarResolved("USER")).toBe(true);
    expect(isEnvVarResolved("PATH")).toBe(true);
  });

  it("returns true when env var is set in process.env", () => {
    process.env.TEST_AGENTBREW_VAR = "value";
    try {
      expect(isEnvVarResolved("TEST_AGENTBREW_VAR")).toBe(true);
    } finally {
      delete process.env.TEST_AGENTBREW_VAR;
    }
  });

  it("returns false for undefined env var", () => {
    delete process.env.NONEXISTENT_AGENTBREW_VAR;
    expect(isEnvVarResolved("NONEXISTENT_AGENTBREW_VAR")).toBe(false);
  });

  it("returns false for empty string env var", () => {
    process.env.EMPTY_AGENTBREW_VAR = "";
    try {
      expect(isEnvVarResolved("EMPTY_AGENTBREW_VAR")).toBe(false);
    } finally {
      delete process.env.EMPTY_AGENTBREW_VAR;
    }
  });

  it("returns true when resolveEnvVar finds value via fallback", () => {
    delete process.env.FALLBACK_TEST_VAR;
    vi.mocked(resolveEnvVar).mockReturnValueOnce("fallback-value");
    expect(isEnvVarResolved("FALLBACK_TEST_VAR")).toBe(true);
  });

  it("delegates to resolveEnvVar for non-always-available vars", () => {
    delete process.env.DELEGATE_TEST_VAR;
    vi.mocked(resolveEnvVar).mockReturnValueOnce(undefined);
    expect(isEnvVarResolved("DELEGATE_TEST_VAR")).toBe(false);
    expect(resolveEnvVar).toHaveBeenCalledWith("DELEGATE_TEST_VAR");
  });
});

describe("isValidMcpServer", () => {
  it("returns true for url-based server with non-empty url", () => {
    expect(isValidMcpServer({ name: "test", url: "http://localhost:3000" } as McpServer)).toBe(true);
  });

  it("returns false for url-based server with empty url", () => {
    expect(isValidMcpServer({ name: "test", url: "  " } as McpServer)).toBe(false);
  });

  it("returns true for stdio server with non-empty command", () => {
    expect(isValidMcpServer({ name: "test", command: "npx" } as McpServer)).toBe(true);
  });

  it("returns false for stdio server with empty command", () => {
    expect(isValidMcpServer({ name: "test", command: "" } as McpServer)).toBe(false);
  });

  it("returns false for server with whitespace-only command", () => {
    expect(isValidMcpServer({ name: "test", command: "  " } as McpServer)).toBe(false);
  });

  it("returns false for server with no url and no command", () => {
    expect(isValidMcpServer({ name: "test" } as McpServer)).toBe(false);
  });
});

describe("filterInvalidServers", () => {
  it("keeps valid servers", () => {
    const servers = [{ name: "good", command: "npx" }] as McpServer[];
    const log = vi.fn();
    expect(filterInvalidServers(servers, log)).toEqual(servers);
    expect(log).not.toHaveBeenCalled();
  });

  it("removes invalid servers and logs a warning", () => {
    const servers = [
      { name: "good", command: "npx" },
      { name: "bad", command: "" },
    ] as McpServer[];
    const log = vi.fn();
    const result = filterInvalidServers(servers, log);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("good");
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toContain("bad");
  });

  it("returns empty array when all servers are invalid", () => {
    const servers = [{ name: "bad", command: "" }] as McpServer[];
    const log = vi.fn();
    expect(filterInvalidServers(servers, log)).toEqual([]);
  });
});

describe("validateMcpEnvVars", () => {
  it("returns warnings for servers with unresolved env vars", () => {
    delete process.env.MISSING_VAR_AGENTBREW;
    const servers = [{ name: "test", args: ["${MISSING_VAR_AGENTBREW}"] }] as McpServer[];
    const warnings = validateMcpEnvVars(servers);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].serverName).toBe("test");
    expect(warnings[0].missingVars).toContain("MISSING_VAR_AGENTBREW");
  });

  it("returns empty array when all vars are resolved", () => {
    const servers = [{ name: "test", args: ["${HOME}"] }] as McpServer[];
    expect(validateMcpEnvVars(servers)).toEqual([]);
  });

  it("falls back to state mcpServers when no servers provided", () => {
    vi.mocked(requireState).mockReturnValue({
      schemaVersion: 1,
      agents: [],
      mcpServers: [{ name: "from-state", args: ["${HOME}"] }],
      catalogVersion: "0.1.0",
    } as never);
    expect(validateMcpEnvVars()).toEqual([]);
  });
});

describe("printValidationWarnings", () => {
  it("returns false and prints nothing for empty warnings", () => {
    expect(printValidationWarnings([])).toBe(false);
  });

  it("returns true and prints warnings", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = printValidationWarnings([{ serverName: "test", missingVars: ["API_KEY"] }]);
    expect(result).toBe(true);
    consoleSpy.mockRestore();
  });
});
