import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogMcpServer } from "./types.js";

vi.mock("../state.js", () => {
  const state = { agents: [], sources: [], mcpServers: [], catalogVersion: "0.1.0", skillSourceDirs: [] };
  return { loadState: vi.fn(() => state), requireState: vi.fn(() => state), saveState: vi.fn() };
});

vi.mock("./install-other.js", () => ({
  addRuleToSharedRules: vi.fn(),
  installCliTool: vi.fn(),
  installMcpServer: vi.fn(),
  installRule: vi.fn(),
  refreshRecommendedCatalogRules: vi.fn(),
}));

vi.mock("../adapters/mcp-registry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../adapters/mcp-registry.js")>();
  return { ...original, resolveRegistryServer: vi.fn() };
});

vi.mock("./types.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./types.js")>();
  const context7: CatalogMcpServer = {
    name: "context7",
    description: "local catalog entry",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp@latest"],
    category: "docs",
    recommended: true,
  };
  return {
    ...original,
    loadCatalog: vi.fn(() => ({ version: "1", skills: [], mcp_servers: [context7], rules: [], cli_tools: [] })),
  };
});

const { install } = await import("./install.js");
const { installMcpServer } = await import("./install-other.js");
const { resolveRegistryServer } = await import("../adapters/mcp-registry.js");

const REGISTRY_SERVER: CatalogMcpServer = {
  name: "remote-docs",
  description: "from the registry",
  url: "https://docs.example.com/mcp",
  category: "registry",
  recommended: false,
};

function output(): string {
  return [
    ...vi.mocked(console.log).mock.calls,
    ...vi.mocked(console.error).mock.calls,
    ...vi.mocked(console.warn).mock.calls,
  ]
    .flat()
    .join(" ");
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(installMcpServer).mockReset();
  vi.mocked(resolveRegistryServer).mockReset();
  process.exitCode = undefined;
});

afterEach(() => {
  delete process.env.AGENTBREW_MCP_REGISTRY;
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("install with the MCP Registry flag", () => {
  it("never asks the registry when the flag is off", async () => {
    await install("ai.example/remote-docs");
    expect(resolveRegistryServer).not.toHaveBeenCalled();
    expect(output()).toContain("not found in catalog");
  });

  it("installs a registry-only server through the normal MCP install path", async () => {
    process.env.AGENTBREW_MCP_REGISTRY = "1";
    vi.mocked(resolveRegistryServer).mockResolvedValue({
      ok: true,
      registryName: "ai.example/remote-docs",
      server: REGISTRY_SERVER,
    });
    await install("ai.example/remote-docs");
    expect(installMcpServer).toHaveBeenCalledWith(REGISTRY_SERVER);
    expect(process.exitCode).toBeUndefined();
  });

  it("uses the local catalog entry when the registry name maps to it", async () => {
    process.env.AGENTBREW_MCP_REGISTRY = "1";
    vi.mocked(resolveRegistryServer).mockResolvedValue({
      ok: true,
      registryName: "io.github.upstash/context7",
      server: { ...REGISTRY_SERVER, name: "context7" },
    });
    await install("io.github.upstash/context7");
    expect(installMcpServer).toHaveBeenCalledWith(expect.objectContaining({ description: "local catalog entry" }));
  });

  it("never asks the registry for a name the local catalog has", async () => {
    process.env.AGENTBREW_MCP_REGISTRY = "1";
    await install("context7");
    expect(resolveRegistryServer).not.toHaveBeenCalled();
    expect(installMcpServer).toHaveBeenCalledWith(expect.objectContaining({ description: "local catalog entry" }));
  });

  it("warns in one line and falls back to the local catalog when the registry is down", async () => {
    process.env.AGENTBREW_MCP_REGISTRY = "1";
    vi.mocked(resolveRegistryServer).mockResolvedValue({ ok: false, reason: "unreachable", detail: "fetch failed" });
    await install("ai.example/remote-docs");
    expect(vi.mocked(console.warn).mock.calls).toHaveLength(1);
    expect(output()).toContain("MCP Registry unreachable");
    expect(output()).toContain("not found in catalog");
    expect(installMcpServer).not.toHaveBeenCalled();
  });

  it("shows a dry run without installing", async () => {
    process.env.AGENTBREW_MCP_REGISTRY = "1";
    vi.mocked(resolveRegistryServer).mockResolvedValue({
      ok: true,
      registryName: "ai.example/remote-docs",
      server: REGISTRY_SERVER,
    });
    await install("ai.example/remote-docs", { dryRun: true });
    expect(installMcpServer).not.toHaveBeenCalled();
    expect(output()).toContain("https://docs.example.com/mcp");
    expect(output()).toContain("source: MCP Registry ai.example/remote-docs");
  });
});
